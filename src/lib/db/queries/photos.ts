import "server-only";

import { db } from "@/lib/db/client";
import { MAX_PHOTOS } from "@/lib/photos/stockage";

/// Photos client attachées à une intervention - helpers métier, pas Server
/// Actions. Aucun `revalidatePath` ici, il jetterait hors contexte Next.
///
/// Ce module ne couvre que le **T+n** : la photo déposée depuis l'espace
/// client, sur une intervention qui existe déjà. Le T=0 du tunnel écrit ses
/// lignes dans la transaction de la réservation
/// (`queries/interventions.ts` §reserverIntervention), parce que
/// `photos.intervention_id` est NOT NULL et que l'intervention n'existe qu'à
/// la validation.

/// Statut qui autorise le dépôt.
///
/// Le même que celui des deux mutations produits, et pour le même motif : une
/// intervention commencée n'accepte plus de modification du client. Après
/// `IN_PROGRESS`, les photos sont celles du technicien - `type: 'AFTER'`, US
/// distincte, régime obligatoire (Constitution §2.5).
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

/// Attache une photo déjà déposée sur le disque.
///
/// `url` vient de `POST /api/upload-intervention-photo`, qui a décodé le
/// fichier, l'a dépouillé de son EXIF et l'a ré-encodé en WebP. Ce qui naît
/// ici, c'est la **ligne**, pas le fichier.
///
/// Le quota des cinq photos par intervention se vérifie **dans la
/// transaction** : compté avant, deux dépôts simultanés le franchiraient tous
/// les deux. C'est le seul endroit du parcours qui connaisse le dossier
/// complet - l'endpoint d'upload, lui, ne sait pas encore à quelle
/// intervention le fichier se destine (US-INTERVENTION-PHOTOS-AJOUTER §Quotas).
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

    const deja = await tx.photo.count({
      where: { interventionId: params.interventionId },
    });

    if (deja >= MAX_PHOTOS) {
      return { ok: false as const, reason: "quota_atteint" as const };
    }

    const photo = await tx.photo.create({
      data: {
        url: params.url,
        // `BEFORE` : déposée par le client AVANT l'intervention. `AFTER`
        // appartient au technicien, sur le terrain.
        type: "BEFORE",
        uploadedByUserId: params.clientId,
        interventionId: params.interventionId,
      },
      select: { id: true },
    });

    return { ok: true as const, photoId: photo.id, nbPhotos: deja + 1 };
  });
}

/// Le chemin disque d'une photo, **si elle appartient au client**.
///
/// C'est la garde de `GET /api/intervention-photos/[id]`. Elle vit ici et non
/// dans le Route Handler pour être éprouvable sans contexte Next : le
/// cloisonnement d'une photo prise au domicile de quelqu'un est une propriété
/// de sécurité, elle se teste.
export async function chargerPhotoDuClient(params: {
  photoId: number;
  clientId: string;
}): Promise<{ url: string } | null> {
  const photo = await db.photo.findFirst({
    where: {
      id: params.photoId,
      // La propriété se lit sur l'INTERVENTION, pas sur `uploaded_by_user_id` :
      // une photo déposée par le technicien sur mon intervention m'est
      // destinée, et c'est le rendez-vous qui décide de qui la voit.
      intervention: { clientId: params.clientId },
    },
    select: { url: true },
  });

  return photo;
}
