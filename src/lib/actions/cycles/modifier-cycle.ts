"use server";

import { revalidatePath } from "next/cache";

import { modifierCycleDuClient } from "@/lib/db/queries/cycles";
import {
  CHEMIN_CYCLES,
  CHEMIN_ESPACE_CLIENT,
  CHEMIN_ESPACE_CLIENT_PASSEES,
} from "@/lib/routes";
import { authActionClient } from "@/lib/safe-action";
import { modifierCycleSchema } from "@/lib/validations/cycles";

import { messageRefusCycle } from "./messages";

/// Modification d'un vélo - `US-CYCLE-MODIFIER`.
///
/// ⚠️ La SPEC décrit un `PATCH /cycles/<id>` et deux refus distincts, 403 et
/// 404. Ni l'un ni l'autre : Server Action, et un refus unique (B2).
export const modifierCycle = authActionClient
  .inputSchema(modifierCycleSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    // La propriété est vérifiée dans la clause `WHERE` du helper, pas ici : une
    // garde applicative séparée laisserait une fenêtre entre la lecture et
    // l'écriture.
    const resultat = await modifierCycleDuClient({
      ...parsedInput,
      userId: user.id,
    });

    if (!resultat.ok) {
      return { ok: false as const, message: messageRefusCycle(resultat) };
    }

    revalidatePath(CHEMIN_CYCLES);
    // Le vélo est une référence VIVANTE, pas un instantané : les deux onglets
    // de l'espace client affichent marque et modèle, qui viennent de changer -
    // « Passées » compris, en lecture seule. Sans ces invalidations, ils
    // montreraient l'ancienne valeur jusqu'à la navigation suivante.
    revalidatePath(CHEMIN_ESPACE_CLIENT);
    revalidatePath(CHEMIN_ESPACE_CLIENT_PASSEES);

    return { ok: true as const, cycle: resultat.cycle };
  });
