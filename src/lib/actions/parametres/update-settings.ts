"use server";

import { revalidatePath } from "next/cache";

import {
  updateAppSettings,
  type UpdateSettingsResult,
} from "@/lib/db/queries/parametres";
import { adminActionClient } from "@/lib/safe-action";
import { updateSettingsSchema } from "@/lib/validations/parametres";

const SETTINGS_PATH = "/admin/parametres";

/// Message d'un refus métier. `unknown_keys` ne peut pas venir de l'écran -
/// c'est un appel direct à l'endpoint - donc son message ne cherche pas à
/// aider l'utilisateur à corriger : il n'y a personne à aider.
function refusalMessage(
  result: Extract<UpdateSettingsResult, { ok: false }>,
): string {
  switch (result.reason) {
    case "unknown_keys":
      return "Paramètre inconnu - la page a peut-être changé, rechargez-la.";
    case "invalid_values":
      return `Valeur invalide pour : ${result.keys.join(", ")}`;
    // Le message dit quoi faire, pas ce qui s'est passé : recharger est la
    // seule action qui règle ce refus, et modifier le champ ne sert à rien.
    case "stale":
      return "Ces paramètres ont été modifiés entre-temps, rechargez la page.";
    default: {
      const exhaustive: never = result;
      return String(exhaustive);
    }
  }
}

/// Rappel d'ADR-006 v2, repris dans `src/lib/safe-action.ts:5-7` : **une
/// Server Action exportée est un endpoint POST public**. La garde vit dans
/// `adminActionClient`, en middleware, donc **avant** la validation Zod -
/// l'administrateur arrive par `ctx`, il n'est jamais lu depuis la charge
/// utile.
export const updateSettings = adminActionClient
  .inputSchema(updateSettingsSchema)
  .action(async ({ parsedInput: { settings }, ctx: { admin } }) => {
    const result = await updateAppSettings(settings, admin.id);

    if (!result.ok) {
      // Pas de revalidation : rien n'a été écrit, et invalider le cache
      // laisserait croire le contraire.
      //
      // `invalidKeys` accompagne le message pour que le formulaire marque les
      // champs fautifs en `aria-invalid` (RGAA 11.10). Il les marque, et c'est
      // tout : il ne les nomme pas, ni par leur clé ni par leur libellé.
      //
      // ⚠️ Ce commentaire affirmait « et les nomme par leur libellé plutôt que
      // par leur clé technique », ce qui était faux des deux côtés : le
      // formulaire ne nomme rien, et le message de `invalid_values` ci-dessus
      // injecte les clés TECHNIQUES, que l'écran s'interdit par ailleurs
      // d'afficher (`settings-form.tsx`, commentaire de la ligne de méta).
      // Incohérence antérieure à cette PR, hors de son périmètre, versée au
      // write-back. Relevé par l'agent testeur (B1).
      //
      // `staleKeys` marque de la même façon les lignes du refus de
      // concurrence. Depuis que le jeton porte la LIGNE et non le formulaire
      // (T-B1-01, constat F3), un refus ne concerne plus qu'une partie des
      // champs : les désigner est le seul moyen de dire lesquels afficheront
      // une autre valeur après rechargement.
      return {
        error: refusalMessage(result),
        invalidKeys: result.reason === "invalid_values" ? result.keys : [],
        staleKeys: result.reason === "stale" ? result.keys : [],
      };
    }

    revalidatePath(SETTINGS_PATH);
    return { changedKeys: result.changedKeys };
  });
