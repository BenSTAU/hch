"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/permissions";
import {
  updateAppSettings,
  type UpdateSettingsResult,
} from "@/lib/db/queries/parametres";
import { actionClient } from "@/lib/safe-action";
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
/// Server Action exportée est un endpoint POST public**. `requireAdmin()` est
/// donc en première ligne, avant toute lecture — une garde placée après la
/// lecture protège le résultat affiché, pas la donnée.
export const updateSettings = actionClient
  .inputSchema(updateSettingsSchema)
  .action(async ({ parsedInput: { settings } }) => {
    const admin = await requireAdmin();

    const result = await updateAppSettings(settings, admin.id);

    if (!result.ok) {
      // Pas de revalidation : rien n'a été écrit, et invalider le cache
      // laisserait croire le contraire.
      return { error: refusalMessage(result) };
    }

    revalidatePath(SETTINGS_PATH);
    return { changedKeys: result.changedKeys };
  });
