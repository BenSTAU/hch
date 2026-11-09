"use server";

import { redirect } from "next/navigation";

import { modifierForfait as ecrireModification } from "@/lib/db/queries/forfaits";
import { CHEMIN_ADMIN_FORFAITS } from "@/lib/routes";
import { adminActionClient } from "@/lib/safe-action";
import { modifierForfaitSchema } from "@/lib/validations/forfaits";

import { messageRefusModification } from "./messages";
import { revalidationCatalogue } from "./revalidation";

/// Modification d'un forfait - `US-FORFAIT-MODIFIER`, désactivation et
/// réactivation comprises.
///
/// ⚠️ **Le jeton de version arrive par la charge utile**, et c'est sans
/// conséquence : il ne confère aucun droit, il désigne une version. Un jeton
/// forgé ne permet qu'un enregistrement refusé, le contrôle qui compte étant
/// le prédicat de l'écriture, côté base.
export const modifierForfaitAction = adminActionClient
  .inputSchema(modifierForfaitSchema)
  .action(async ({ parsedInput, ctx: { admin } }) => {
    const resultat = await ecrireModification(parsedInput, admin.id);

    if (!resultat.ok) {
      // Pas de revalidation : aucun des trois refus n'a écrit quoi que ce
      // soit, refus de concurrence compris.
      return { error: messageRefusModification(resultat) };
    }

    // « Je valide sans avoir rien changé » : aucune écriture, donc aucune
    // invalidation - le cache est exact.
    if (resultat.changements.length === 0) {
      redirect(`${CHEMIN_ADMIN_FORFAITS}?inchange=1`);
    }

    revalidationCatalogue();

    // L'identifiant, pas le libellé - même motif que l'ajout.
    redirect(`${CHEMIN_ADMIN_FORFAITS}?modifie=${String(parsedInput.id)}`);
  });
