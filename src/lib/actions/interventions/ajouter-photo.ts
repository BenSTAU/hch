"use server";

import { revalidatePath } from "next/cache";

import { CHEMIN_ESPACE_CLIENT } from "@/lib/routes";
import { attacherPhoto, type ResultatPhoto } from "@/lib/db/queries/photos";
import { MAX_PHOTOS } from "@/lib/photos/stockage";
import { authActionClient } from "@/lib/safe-action";
import { ajouterPhotoSchema } from "@/lib/validations/interventions";

/// Dépôt d'une photo sur une intervention planifiée (T+n) -
/// `US-INTERVENTION-PHOTOS-AJOUTER`, versant espace client.
///
/// Le fichier est monté avant, par `POST /api/upload-intervention-photo`, qui
/// le dépouille de son EXIF et le ré-encode en WebP. Cette action-ci n'écrit
/// que la **ligne**. Deux surfaces, un seul chemin de traitement d'image.
///
/// Le jumeau T=0 est la validation du tunnel, qui crée ses lignes dans la
/// transaction de la réservation : `photos.intervention_id` est NOT NULL et
/// l'intervention n'existe qu'à cet instant.

function messageRefus(echec: Extract<ResultatPhoto, { ok: false }>): string {
  switch (echec.reason) {
    case "introuvable":
      // Même libellé que les deux mutations produits, et pour le même motif :
      // l'inconnue et celle d'un tiers ne se distinguent pas.
      return "Intervention introuvable.";
    case "verrouillee":
      return "Dépôt impossible sur une intervention déjà démarrée ou clôturée.";
    case "quota_atteint":
      // Libellé de `US-INTERVENTION-PHOTOS-AJOUTER` §Cas d'erreur.
      return `${String(MAX_PHOTOS)} photos maximum par intervention.`;
  }
}

export const ajouterPhoto = authActionClient
  .inputSchema(ajouterPhotoSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    // Le propriétaire vient du CONTEXTE, jamais de la charge utile. Rappel
    // d'ADR-006 v2 : cette action est un endpoint POST public.
    const resultat = await attacherPhoto({
      ...parsedInput,
      clientId: user.id,
    });

    if (!resultat.ok) {
      return { ok: false as const, message: messageRefus(resultat) };
    }

    // La liste rend les vignettes de chaque intervention : sans invalidation,
    // la photo n'apparaîtrait qu'à la navigation suivante.
    revalidatePath(CHEMIN_ESPACE_CLIENT);

    return { ok: true as const, nbPhotos: resultat.nbPhotos };
  });
