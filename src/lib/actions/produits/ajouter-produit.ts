"use server";

import { revalidatePath } from "next/cache";

import { CHEMIN_ESPACE_CLIENT } from "@/lib/routes";
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
/// Le `revalidatePath` que T-V3-09 avait laissé en report : l'écran de détail
/// (C8) n'existait pas encore, revalider une route absente aurait été un chemin
/// mort. Il arrive avec le montage, en T-V3-10. Même mécanique que les adresses
/// de PR #23, montées par T-V3-07.
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

    if (!resultat.ok) {
      return { ok: false as const, message: messageRefus(resultat, "ajout") };
    }

    // Le panneau de détail rend les lignes et le total : sans invalidation, le
    // produit ajouté n'apparaîtrait qu'à la navigation suivante.
    revalidatePath(CHEMIN_ESPACE_CLIENT);

    return { ok: true as const, total: resultat.total };
  });
