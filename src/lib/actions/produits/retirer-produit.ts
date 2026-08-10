"use server";

import { retirerProduitIntervention } from "@/lib/db/queries/produits";
import { authActionClient } from "@/lib/safe-action";
import { retirerProduitSchema } from "@/lib/validations/produits";

import { messageRefus } from "./messages";

/// Retrait d'un produit d'une intervention planifiée (T+n) -
/// `US-INTERVENTION-PRODUIT-SUPPRIMER`.
///
/// La restitution du stock est la moitié qui manquait à toute DoD jusqu'au
/// 2026-08-08 : sans elle, un catalogue se vide au fil des paniers abandonnés,
/// et rien ne le signale avant la rupture.
///
/// Pas de `revalidatePath` - même motif que l'ajout, l'écran appartient à
/// T-V3-10.
export const retirerProduit = authActionClient
  .inputSchema(retirerProduitSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    const resultat = await retirerProduitIntervention({
      ...parsedInput,
      clientId: user.id,
    });

    return resultat.ok
      ? { ok: true as const, total: resultat.total }
      : { ok: false as const, message: messageRefus(resultat, "retrait") };
  });
