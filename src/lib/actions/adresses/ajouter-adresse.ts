"use server";

import { creerAdresse, resoudreCommune } from "@/lib/db/queries/adresses";
import { geocoderAdresse } from "@/lib/geo/ban";
import { authActionClient } from "@/lib/safe-action";
import { ajouterAdresseSchema } from "@/lib/validations/adresses";

/// Ajout d'une adresse au profil — `US-ADRESSE-AJOUTER`, **hors tunnel**.
///
/// Pas de test `ST_Covers` ici : la vérification de couverture appartient au
/// tunnel de réservation, pas à l'enregistrement d'une adresse (décision B7
/// Q5a). Un client peut enregistrer l'adresse d'un proche non desservi ; c'est
/// au moment de réserver que la question se pose.
///
/// Le re-géocodage, lui, a bien lieu : la règle « les coordonnées du client ne
/// font jamais foi » ne dépend pas de l'usage qu'on fait ensuite du point.

const MESSAGE_INDISPONIBLE =
  "Service de géolocalisation temporairement indisponible — réessayez.";
const MESSAGE_INTROUVABLE = "Adresse introuvable — vérifiez les informations.";

export const ajouterAdresse = authActionClient
  .inputSchema(ajouterAdresseSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    const geocodage = await geocoderAdresse(parsedInput.label);
    if (!geocodage.ok) {
      return {
        error:
          geocodage.reason === "indisponible"
            ? MESSAGE_INDISPONIBLE
            : MESSAGE_INTROUVABLE,
      };
    }

    // La commune vient de la réponse BAN, jamais de la charge utile : c'est la
    // même règle que pour le point, appliquée aux champs qui l'accompagnent.
    const adresse = geocodage.data;
    const cityId = await resoudreCommune({
      postcode: adresse.postcode,
      city: adresse.city,
    });

    const adresseId = await creerAdresse({
      street: adresse.street,
      cityId,
      point: { lon: adresse.lon, lat: adresse.lat },
      userId: user.id,
      memo: parsedInput.memo,
    });

    // Aucune invalidation de cache : la fiche client qui affiche cette liste
    // n'existe pas encore. Elle arrive avec l'écran C12, en T-V3-07, qui posera
    // le `revalidatePath` en même temps que la page.
    return { adresseId };
  });
