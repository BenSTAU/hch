"use server";

import { ajouterProduitIntervention } from "@/lib/db/queries/produits";
import { authActionClient } from "@/lib/safe-action";
import { ajouterProduitSchema } from "@/lib/validations/produits";

import { messageRefus } from "./messages";

/// Ajout d'un produit à une intervention déjà planifiée (T+n) -
/// `US-INTERVENTION-PRODUIT-AJOUTER`.
///
/// Le jumeau T=0 est la validation du tunnel, qui vend le panier dans la
/// transaction de la réservation : deux moments, une seule règle de stock.
///
/// **Aucun `revalidatePath` ici**, et c'est délibéré : l'écran de détail
/// d'intervention (C8) n'existe pas encore, T-V3-10 en est propriétaire depuis
/// l'arbitrage du 2026-08-10 et porte la DoD de montage. Revalider une route
/// absente serait un chemin mort à relire dans deux semaines. Même précédent
/// que les adresses de PR #23, montées par T-V3-07.
export const ajouterProduit = authActionClient
  .inputSchema(ajouterProduitSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    // Le propriétaire vient du CONTEXTE, jamais de la charge utile. Rappel
    // d'ADR-006 v2 : cette action est un endpoint POST public, et
    // `interventions.id` est un SERIAL donc énumérable.
    const resultat = await ajouterProduitIntervention({
      ...parsedInput,
      clientId: user.id,
    });

    return resultat.ok
      ? { ok: true as const, total: resultat.total }
      : { ok: false as const, message: messageRefus(resultat, "ajout") };
  });
