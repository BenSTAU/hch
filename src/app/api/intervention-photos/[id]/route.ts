import { NextResponse } from "next/server";

import { getOptionalUser } from "@/lib/auth/dal";
import { chargerPhotoAutorisee } from "@/lib/db/queries/photos";
import { lirePhoto } from "@/lib/photos/stockage";

/// Lecture d'une photo d'intervention, **sous contrôle de propriété**.
///
/// `uploads/` vit hors de `public/` : Next n'en sert rien, et c'est voulu. Une
/// photo prise au domicile d'un client ne doit pas être joignable par qui
/// connaît son URL. Servir le dossier statiquement aurait fait reposer toute la
/// confidentialité sur le caractère non devinable d'un UUID, ce qui ne tient
/// pas : une URL voyage dans les journaux nginx, les en-têtes `Referer` et
/// l'historique du navigateur.
///
/// Arbitré le 2026-08-11 (hypothèse B). C'est ce qui permet à T-V3-12 de
/// déclarer quelque chose de **vrai** dans la politique de confidentialité, et
/// c'est le sens que `src/lib/photos/stockage.ts` avait déjà choisi en écrivant
/// hors de `public/`. PLAN S4 §4.5 est amendé côté vault : le strip EXIF reste
/// obligatoire, au titre de la défense en profondeur.
///
/// CLAUDE.md §Server Actions autorise le Route Handler quand le canal HTTP est
/// nécessaire en soi, flux binaire entrant ou sortant compris. Celui-ci est un
/// flux sortant : une Server Action sérialise sa réponse, elle ne peut pas
/// rendre un flux binaire. C'est cette route qui a fait remplacer la liste de
/// trois cas par le critère.
///
/// Pas de vignette, pas de redimensionnement. `photo_metadata` et les
/// thumbnails sont reportés en v2 (ADR-011), et l'image sort telle qu'elle a
/// été ré-encodée à l'upload.

export async function GET(
  _requete: Request,
  contexte: RouteContext<"/api/intervention-photos/[id]">,
): Promise<NextResponse> {
  const utilisateur = await getOptionalUser();

  // 404 et non 401, y compris pour l'anonyme : cette route ne dit jamais si un
  // identifiant existe. Un 401 distinct apprendrait à un visiteur non connecté
  // quelles photos existent, ce qui est exactement ce que le contrôle cherche à
  // empêcher.
  if (!utilisateur) return introuvable();

  const { id } = await contexte.params;

  // `photos.id` est un SERIAL : tout ce qui n'est pas un entier positif est
  // écarté avant d'atteindre la base.
  const photoId = Number(id);
  if (!Number.isInteger(photoId) || photoId <= 0) return introuvable();

  // La garde de propriété est en base, dans la clause `where` : elle ne peut
  // donc pas être contournée par un `if` oublié. Une photo qui n'est sur
  // l'intervention ni de ce client ni de ce technicien est indistinguable d'une
  // photo inexistante.
  //
  // Aucun contrôle de rôle ici, et c'est voulu : la règle est « titulaire du
  // rendez-vous », pas « porteur de ROLE_TECH ». Elle vit entièrement dans
  // `chargerPhotoAutorisee`, qui la rend testable.
  const photo = await chargerPhotoAutorisee({
    photoId,
    userId: utilisateur.id,
  });
  if (!photo) return introuvable();

  const contenu = await lirePhoto(photo.url);
  if (!contenu) return introuvable();

  return new NextResponse(new Uint8Array(contenu), {
    headers: {
      // Toujours du WebP : `enregistrerPhoto` ré-encode tout ce qui entre.
      "Content-Type": "image/webp",
      // `private` : la réponse dépend de la session, un cache partagé qui la
      // retiendrait la servirait au visiteur suivant. `no-store` serait
      // excessif, le navigateur du propriétaire a le droit de la garder.
      "Cache-Control": "private, max-age=3600",
      // La photo s'affiche, elle ne se télécharge pas. `nosniff` empêche un
      // navigateur d'interpréter le flux autrement que comme l'image annoncée.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/// Une seule réponse pour quatre causes : anonyme, identifiant malformé, photo
/// d'un tiers, fichier absent du disque. Les distinguer renseignerait sur
/// l'existence de ce qu'on protège.
function introuvable(): NextResponse {
  return new NextResponse(null, { status: 404 });
}
