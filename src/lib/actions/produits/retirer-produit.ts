"use server";

import { revalidatePath } from "next/cache";

import { CHEMIN_ESPACE_CLIENT } from "@/lib/routes";
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
/// `revalidatePath` posé en T-V3-10 avec le montage de l'écran, même motif que
/// l'ajout.
export const retirerProduit = authActionClient
  .inputSchema(retirerProduitSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    const resultat = await retirerProduitIntervention({
      ...parsedInput,
      clientId: user.id,
    });

    if (!resultat.ok) {
      return { ok: false as const, message: messageRefus(resultat, "retrait") };
    }

    revalidatePath(CHEMIN_ESPACE_CLIENT);

    return { ok: true as const, total: resultat.total };
  });
