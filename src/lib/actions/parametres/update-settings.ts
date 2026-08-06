"use server";

import { revalidatePath } from "next/cache";

import {
  updateAppSettings,
  type UpdateSettingsResult,
} from "@/lib/db/queries/parametres";
import { adminActionClient } from "@/lib/safe-action";
import { updateSettingsSchema } from "@/lib/validations/parametres";

const SETTINGS_PATH = "/admin/parametres";

/// Message d'un refus métier. `unknown_keys` ne peut pas venir de l'écran —
/// c'est un appel direct à l'endpoint — donc son message ne cherche pas à
/// aider l'utilisateur à corriger : il n'y a personne à aider.
function refusalMessage(
  result: Extract<UpdateSettingsResult, { ok: false }>,
): string {
  switch (result.reason) {
    case "unknown_keys":
      return "Paramètre inconnu — la page a peut-être changé, rechargez-la.";
    case "invalid_values":
      return `Valeur invalide pour : ${result.keys.join(", ")}`;
    default: {
      const exhaustive: never = result;
      return String(exhaustive);
    }
  }
}

/// Rappel d'ADR-006 v2, repris dans `src/lib/safe-action.ts:5-7` : **une
/// Server Action exportée est un endpoint POST public**. La garde vit dans
/// `adminActionClient`, en middleware, donc **avant** la validation Zod —
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
      // `invalidKeys` accompagne le message pour que le formulaire puisse
      // marquer les champs fautifs (`aria-invalid`) et les nommer par leur
      // libellé plutôt que par leur clé technique — RGAA 11.10, relevé par
      // l'agent testeur.
      return {
        error: refusalMessage(result),
        invalidKeys: result.reason === "invalid_values" ? result.keys : [],
      };
    }

    revalidatePath(SETTINGS_PATH);
    return { changedKeys: result.changedKeys };
  });
