import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { FORMATS_ACCEPTES, MAX_OCTETS } from "./quotas";

/// Réception et stockage des photos du tunnel — `US-INTERVENTION-PHOTOS-AJOUTER`.
///
/// **Le strip EXIF n'est pas une option de confort.** Une photo de vélo est
/// prise au domicile du client, elle porte donc les coordonnées GPS de ce
/// domicile.
///
/// ⚠️ **Son motif a changé le 2026-08-11, pas son caractère obligatoire.** PLAN
/// S4 §4.5 le justifiait par « `uploads/` est servi sur un domaine public » ;
/// l'arbitrage de T-V3-10 a tranché l'inverse (route de lecture contrôlée, cf.
/// `src/app/api/intervention-photos/[id]/route.ts`), et §4.5 est amendé en
/// conséquence côté vault. Ce qui reste : la défense en profondeur, et le fait
/// que le technicien qui verra cette photo en V2 n'a pas à recevoir l'adresse
/// du client avec elle.
///
/// La méthode retenue **ré-encode** au lieu de retrancher : l'image entrante est
/// décodée puis ré-écrite en WebP par `sharp`, qui n'émet aucune métadonnée sauf
/// demande explicite. L'EXIF disparaît par construction et non par soustraction
/// — il n'y a pas de segment qu'on aurait pu oublier.
///
/// Le même geste règle le HEIC, format par défaut des iPhone qu'aucun navigateur
/// ne sait afficher : il entre en HEIF, il ressort en WebP.

/// Réexportés depuis `./quotas`, seul module que le navigateur peut aussi
/// importer : les deux zones de dépôt sont des composants clients, et ce
/// fichier-ci tire `sharp`. Les appelants serveur continuent de les lire ici.
export { MAX_OCTETS, MAX_PHOTOS } from "./quotas";

/// Types acceptés à l'entrée, dérivés de la liste que l'attribut `accept`
/// annonce à l'écran. Une seule source : deux listes finiraient par diverger, et
/// c'est la plus permissive qui déciderait.
///
/// Le type déclaré par le navigateur ne fait pas foi — il est trivial à
/// falsifier. Il sert à écarter tôt ce qui n'a pas à monter ; c'est le décodage
/// par `sharp` qui tranche réellement.
const TYPES_ACCEPTES = FORMATS_ACCEPTES.split(",");

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
  if (!TYPES_ACCEPTES.includes(fichier.type)) {
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

/// Motif exact de ce que `enregistrerPhoto` écrit. Il sert deux fois : à la
/// validation des chemins qui remontent du client
/// (`src/lib/validations/interventions.ts`) et ci-dessous, à la relecture.
const CHEMIN_ATTENDU = /^uploads\/[0-9a-f-]{36}\.webp$/;

/// Relit un fichier déposé. `null` s'il a disparu du disque.
///
/// **La garde de traversée est ici et non chez l'appelant.** `photos.url` a
/// beau avoir été validé à l'écriture, c'est une colonne de base : une
/// migration, un correctif en `psql` ou un chemin d'écriture futur pourraient y
/// poser autre chose, et cette fonction concatène une valeur de base à un
/// chemin de système de fichiers. Le motif est revérifié plutôt que supposé -
/// `path.join` résout `..` sans se plaindre.
///
/// L'autorisation, elle, n'est PAS ici : elle vit dans
/// `chargerPhotoDuClient` (`src/lib/db/queries/photos.ts`), qui décide si ce
/// client a le droit de voir cette photo. Ce module ne connaît que le disque.
export async function lirePhoto(url: string): Promise<Buffer | null> {
  if (!CHEMIN_ATTENDU.test(url)) return null;

  try {
    // `path.basename` en plus du motif : deux gardes indépendantes pour la même
    // propriété, parce que celle-ci se paie en lecture de fichier arbitraire.
    return await readFile(path.join(dossierUploads(), path.basename(url)));
  } catch {
    // Fichier absent : ligne en base sans fichier sur le disque. Le cas se
    // produit après une restauration partielle, ou si le bind mount `uploads/`
    // n'est pas monté. Ce n'est pas une erreur de l'appelant.
    return null;
  }
}
