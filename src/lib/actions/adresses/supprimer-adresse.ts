"use server";

import { desactiverAdresse } from "@/lib/db/queries/adresses";
import { authActionClient } from "@/lib/safe-action";
import { supprimerAdresseSchema } from "@/lib/validations/adresses";

/// Retrait d'une adresse du profil — `US-ADRESSE-SUPPRIMER`.
///
/// Soft-delete : `is_active = false`. Une adresse référencée par une
/// intervention passée doit rester lisible, et casser la clé étrangère est
/// précisément ce que la Constitution §4.1 interdit.
///
/// **Refus** quand une intervention encore active la référence : la seconde
/// moitié de la règle, livrée avec la table `interventions` (migration 008).

const MESSAGE_INTROUVABLE = "Cette adresse n'existe plus.";
const MESSAGE_INTERVENTION_ACTIVE =
  "Cette adresse est celle d'une intervention à venir — annulez-la d'abord.";

export const supprimerAdresse = authActionClient
  .inputSchema(supprimerAdresseSchema)
  .action(async ({ parsedInput: { adresseId }, ctx: { user } }) => {
    // L'identifiant du propriétaire vient du contexte, jamais de la charge
    // utile : `addresses.id` est un SERIAL, donc énumérable. Sans ce filtre,
    // l'action supprimerait l'adresse du voisin en incrémentant un entier.
    const resultat = await desactiverAdresse({ adresseId, userId: user.id });

    if (!resultat.ok) {
      return {
        error:
          resultat.reason === "intervention_active"
            ? MESSAGE_INTERVENTION_ACTIVE
            : MESSAGE_INTROUVABLE,
      };
    }

    return { adresseId };
  });
