import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

/// Réception et stockage des photos du tunnel — `US-INTERVENTION-PHOTOS-AJOUTER`.
///
/// **Le strip EXIF n'est pas une option de confort.** Une photo de vélo est
/// prise au domicile du client, elle porte donc ses coordonnées GPS, et
/// `uploads/` est servi sur un domaine public (PLAN S4 §4.5). Publier le fichier
/// tel quel publierait l'adresse de quelqu'un.
///
/// La méthode retenue **ré-encode** au lieu de retrancher : l'image entrante est
/// décodée puis ré-écrite en WebP par `sharp`, qui n'émet aucune métadonnée sauf
/// demande explicite. L'EXIF disparaît par construction et non par soustraction
/// — il n'y a pas de segment qu'on aurait pu oublier.
///
/// Le même geste règle le HEIC, format par défaut des iPhone qu'aucun navigateur
/// ne sait afficher : il entre en HEIF, il ressort en WebP.

/// Cinq photos par intervention, cinq mégaoctets chacune
/// ([[module-3-interventions]] §Quotas).
export const MAX_PHOTOS = 5;
export const MAX_OCTETS = 5 * 1024 * 1024;

/// Types acceptés à l'entrée. La sortie est toujours du WebP.
///
/// Le type déclaré par le navigateur ne fait pas foi — il est trivial à
/// falsifier. Il sert à écarter tôt ce qui n'a pas à monter ; c'est le décodage
/// par `sharp` qui tranche réellement.
const TYPES_ACCEPTES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

/// Dossier de dépôt. `./uploads` en local, `/app/uploads` dans le conteneur —
/// c'est le même chemin relatif au répertoire de travail, et c'est le bind mount
/// déclaré par PLAN S3 §2 (`./uploads:/app/uploads`). Volontairement HORS de
/// `public/` : rien ici ne doit être servi par Next sans passer par un contrôle.
function dossierUploads(): string {
  return path.join(process.cwd(), "uploads");
}

/// Décode puis ré-encode en WebP. `null` quand l'image est illisible.
///
/// Séparée de l'écriture disque pour être éprouvable : le strip EXIF est une
/// propriété de sécurité, elle doit se prouver sur un tampon et non sur un
/// effet de bord.
export async function depouiller(entree: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(entree)
      // `rotate()` sans argument applique l'orientation EXIF puis la retire du
      // résultat. Sans lui, retirer les métadonnées coucherait les photos prises
      // à la verticale : l'information d'orientation vit précisément dans le
      // bloc qu'on supprime.
      .rotate()
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    // Décodage impossible : extension mensongère, fichier tronqué, ou HEIC
    // encodé avec un profil que la build de `sharp` ne connaît pas. Refus
    // explicite — jamais d'écriture d'un contenu qu'on n'a pas su lire.
    return null;
  }
}

export type EnregistrementPhoto =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: "type_refuse" | "trop_lourde" | "illisible";
    };

export function messageRefus(
  reason: Extract<EnregistrementPhoto, { ok: false }>["reason"],
): string {
  switch (reason) {
    case "type_refuse":
      return "Formats acceptés : JPG, PNG, WebP ou HEIC.";
    case "trop_lourde":
      return "Chaque photo doit peser 5 Mo au maximum.";
    case "illisible":
      return "Cette image n'a pas pu être lue — réessayez avec un autre fichier.";
    default: {
      const exhaustive: never = reason;
      return String(exhaustive);
    }
  }
}

export async function enregistrerPhoto(
  fichier: File,
): Promise<EnregistrementPhoto> {
  if (
    !TYPES_ACCEPTES.includes(fichier.type as (typeof TYPES_ACCEPTES)[number])
  ) {
    return { ok: false, reason: "type_refuse" };
  }

  // Le quota de poids est vérifié AVANT de lire le corps : lire d'abord ferait
  // passer par la mémoire du serveur un fichier qu'on s'apprête à refuser.
  if (fichier.size > MAX_OCTETS) {
    return { ok: false, reason: "trop_lourde" };
  }

  const entree = Buffer.from(await fichier.arrayBuffer());

  const depouillee = await depouiller(entree);
  if (!depouillee) return { ok: false, reason: "illisible" };

  const nom = `${randomUUID()}.webp`;
  const dossier = dossierUploads();

  await mkdir(dossier, { recursive: true });
  await writeFile(path.join(dossier, nom), depouillee);

  // Chemin relatif, jamais absolu : il part en base dans `photos.url`, et le
  // préfixe change entre le poste de développement et le conteneur.
  return { ok: true, url: `uploads/${nom}` };
}
