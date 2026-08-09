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
/// La seconde moitié de la règle — **refus** quand une intervention *active* la
/// référence — est reportée à T-V3-08, qui crée la table `interventions`.

const MESSAGE_INTROUVABLE = "Cette adresse n'existe plus.";

export const supprimerAdresse = authActionClient
  .inputSchema(supprimerAdresseSchema)
  .action(async ({ parsedInput: { adresseId }, ctx: { user } }) => {
    // L'identifiant du propriétaire vient du contexte, jamais de la charge
    // utile : `addresses.id` est un SERIAL, donc énumérable. Sans ce filtre,
    // l'action supprimerait l'adresse du voisin en incrémentant un entier.
    const resultat = await desactiverAdresse({ adresseId, userId: user.id });

    if (!resultat.ok) {
      return { error: MESSAGE_INTROUVABLE };
    }

    return { adresseId };
  });
