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
/// Le quota des cinq photos par intervention est le seul contrôle que ce
/// parcours puisse porter : l'endpoint d'upload, lui, ne sait pas encore à
/// quelle intervention le fichier se destine
/// (US-INTERVENTION-PHOTOS-AJOUTER §Quotas).
///
/// 🐛 **Ouvrir une transaction ne suffisait pas**, relevé par l'agent testeur.
/// `db.$transaction` sans `isolationLevel` s'exécute en **READ COMMITTED**, le
/// défaut PostgreSQL : le `count` ci-dessous ne voit pas l'insertion non
/// commitée d'une transaction voisine. Deux dépôts concurrents lisaient quatre,
/// franchissaient tous les deux le plafond, et l'intervention se retrouvait
/// avec six photos. Deux onglets ouverts suffisaient, et le commentaire
/// affirmait pourtant la protection - dans ce fichier **et** dans le composant
/// qui s'y appuyait.
///
/// Le correctif est un **verrou pessimiste sur la ligne d'intervention**, le
/// même mécanisme que `verrouillerProduits` pour le stock : la seconde
/// transaction attend le commit de la première, donc compte cinq et se voit
/// refusée. Il n'y a pas de second filet en base ici - `photos` ne porte aucune
/// contrainte de cardinalité, et une contrainte de comptage n'est pas
/// exprimable en `CHECK`. Le verrou est donc l'unique garde, et c'est pourquoi
/// il ne doit pas être retiré.
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

    // Le verrou est pris sur l'INTERVENTION et non sur les lignes `photos` :
    // `FOR UPDATE` ne verrouille que les lignes qu'il lit, et le dossier est
    // justement défini par celles qui n'existent pas encore. Verrouiller le
    // parent sérialise tous les dépôts d'une même intervention, et n'en gêne
    // aucun autre.
    //
    // Après la garde de propriété, jamais avant : un appelant qui incrémente
    // des identifiants ne doit pas pouvoir poser un verrou sur le rendez-vous
    // d'un tiers.
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

/// Le chemin disque d'une photo, **si le demandeur a le droit de la voir**.
///
/// C'est la garde de `GET /api/intervention-photos/[id]`. Elle vit ici et non
/// dans le Route Handler pour être éprouvable sans contexte Next : le
/// cloisonnement d'une photo prise au domicile de quelqu'un est une propriété
/// de sécurité, elle se teste.
///
/// ── Deux titulaires, et le second arrive avec T-V2-02
///
/// Le **client** de l'intervention, et le **technicien qui lui est affecté**.
/// Jusqu'ici la clause ne portait que le premier, et `US-INTERVENTION-AFFICHER`
/// §Cas nominal exige que le technicien voie « photos existantes (client à la
/// réservation + tech déjà déposées) » : sans cette seconde branche, l'écran de
/// détail rendrait des images cassées.
///
/// ⚠️ **L'élargissement se fait ICI et pas dans une seconde fonction.** Deux
/// requêtes pour une même question finiraient par diverger, et c'est la plus
/// permissive des deux qui déciderait. C'est le motif déjà écrit sur
/// `cheminPhotoSchema` (`validations/interventions.ts`).
///
/// La case correspondante de **T-V2-04** (« le contrôle de propriété doit
/// accepter le technicien affecté ») est donc close par anticipation : un
/// critère v1 du plancher ne pouvait pas dépendre de la seule tâche sacrifiable
/// de la page.
export async function chargerPhotoAutorisee(params: {
  photoId: number;
  /// Le compte connecté. Il n'est **pas** qualifié par rôle : c'est le
  /// rendez-vous qui décide, pas la session. Un technicien reste sans droit sur
  /// les photos d'une intervention qui n'est pas la sienne.
  userId: string;
}): Promise<{ url: string } | null> {
  const photo = await db.photo.findFirst({
    where: {
      id: params.photoId,
      // La propriété se lit sur l'INTERVENTION, pas sur `uploaded_by_user_id` :
      // une photo déposée par le technicien sur mon intervention m'est
      // destinée, et c'est le rendez-vous qui décide de qui la voit. Le même
      // raisonnement vaut dans l'autre sens, d'où les deux branches.
      intervention: {
        OR: [{ clientId: params.userId }, { techId: params.userId }],
      },
    },
    select: { url: true },
  });

  return photo;
}
