import "server-only";

import { db } from "@/lib/db/client";
import { MAX_PHOTOS } from "@/lib/photos/stockage";

/// Photos client attachées à une intervention.
///
/// Ce module ne couvre que le **T+n**, sur une intervention qui existe déjà.
/// Le T=0 du tunnel écrit ses lignes dans la transaction de la réservation,
/// `photos.intervention_id` étant NOT NULL.

/// Statut qui autorise le dépôt : une intervention commencée n'accepte plus de
/// modification du client. Après `IN_PROGRESS`, les photos sont celles du
/// technicien, `type: 'AFTER'` (Constitution §2.5).
const STATUT_MODIFIABLE = "PLANNED";

export type ResultatPhoto =
  | { ok: true; photoId: number; nbPhotos: number }
  /// Intervention inconnue **ou** appartenant à quelqu'un d'autre : une seule
  /// réponse pour les deux. `interventions.id` est un `SERIAL`, énumérable, et
  /// distinguer les deux cas confirmerait l'existence du rendez-vous d'un
  /// tiers.
  | { ok: false; reason: "introuvable" }
  | { ok: false; reason: "verrouillee" }
  | { ok: false; reason: "quota_atteint" };

/// Attache une photo déjà déposée sur le disque : ce qui naît ici est la
/// **ligne**, pas le fichier. Le quota des cinq photos est le seul contrôle que
/// ce parcours puisse porter, l'endpoint d'upload ne sachant pas encore à
/// quelle intervention le fichier se destine.
///
/// ⚠️ **Le verrou pessimiste est l'UNIQUE garde du quota, ne pas le retirer.**
/// Une transaction seule ne suffit pas : en READ COMMITTED, le `count` ne voit
/// pas l'insertion non commitée d'une transaction voisine, et deux dépôts
/// concurrents comptent quatre puis franchissent tous deux le plafond.
/// `photos` ne porte aucune contrainte de cardinalité, un comptage n'étant pas
/// exprimable en `CHECK`.
export async function attacherPhoto(params: {
  interventionId: number;
  clientId: string;
  url: string;
}): Promise<ResultatPhoto> {
  return db.$transaction(async (tx) => {
    const intervention = await tx.intervention.findFirst({
      where: { id: params.interventionId, clientId: params.clientId },
      select: { status: true },
    });

    if (!intervention)
      return { ok: false as const, reason: "introuvable" as const };
    if (intervention.status !== STATUT_MODIFIABLE) {
      return { ok: false as const, reason: "verrouillee" as const };
    }

    // Verrou pris sur l'INTERVENTION et non sur `photos` : `FOR UPDATE` ne
    // verrouille que les lignes qu'il lit, et le quota se définit justement par
    // celles qui n'existent pas encore.
    //
    // ⚠️ Après la garde de propriété, jamais avant : un appelant qui incrémente
    // des identifiants ne doit pas pouvoir verrouiller le rendez-vous d'autrui.
    await tx.$queryRaw`
      SELECT "id" FROM "interventions"
      WHERE "id" = ${params.interventionId}
      FOR UPDATE
    `;

    const deja = await tx.photo.count({
      where: { interventionId: params.interventionId },
    });

    if (deja >= MAX_PHOTOS) {
      return { ok: false as const, reason: "quota_atteint" as const };
    }

    const photo = await tx.photo.create({
      data: {
        url: params.url,
        // `AFTER` appartient au technicien, sur le terrain.
        type: "BEFORE",
        uploadedByUserId: params.clientId,
        interventionId: params.interventionId,
      },
      select: { id: true },
    });

    return { ok: true as const, photoId: photo.id, nbPhotos: deja + 1 };
  });
}

/// Le chemin disque d'une photo, **si le demandeur a le droit de la voir**.
/// Garde de `GET /api/intervention-photos/[id]`, elle vit ici et non dans le
/// Route Handler pour être éprouvable sans contexte Next.
///
/// Deux titulaires : le **client** de l'intervention et le **technicien qui
/// lui est affecté**.
///
/// ⚠️ Une seule fonction pour les deux : deux requêtes répondant à la même
/// question finiraient par diverger, et c'est la plus permissive qui
/// déciderait.
export async function chargerPhotoAutorisee(params: {
  photoId: number;
  /// Le compte connecté, **pas** qualifié par rôle : c'est le rendez-vous qui
  /// décide. Un technicien reste sans droit sur les photos d'une intervention
  /// qui n'est pas la sienne.
  userId: string;
}): Promise<{ url: string } | null> {
  const photo = await db.photo.findFirst({
    where: {
      id: params.photoId,
      // La propriété se lit sur l'INTERVENTION, pas sur `uploaded_by_user_id` :
      // une photo déposée par le technicien sur mon intervention m'est
      // destinée, et réciproquement.
      intervention: {
        OR: [{ clientId: params.userId }, { techId: params.userId }],
      },
    },
    select: { url: true },
  });

  return photo;
}
