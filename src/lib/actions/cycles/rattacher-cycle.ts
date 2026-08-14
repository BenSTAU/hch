"use server";

import { revalidatePath } from "next/cache";

import { rattacherCycleAIntervention } from "@/lib/db/queries/cycles";
import { CHEMIN_ESPACE_CLIENT } from "@/lib/routes";
import { authActionClient } from "@/lib/safe-action";
import { rattacherCycleSchema } from "@/lib/validations/cycles";

import { messageRefusRattachement } from "./messages";

/// Rattachement d'un vélo à une intervention `PLANNED` - périmètre nouveau de
/// T-V3-16, promu de v2 en v1 le 2026-08-12.
///
/// Les trois gardes (propriété de l'intervention, statut, propriété du vélo)
/// vivent dans le helper, pas ici : elles décident d'une écriture, elles
/// appartiennent à sa transaction. Cette action orchestre - session, validation,
/// invalidation.
export const rattacherCycle = authActionClient
  .inputSchema(rattacherCycleSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    // Les deux identifiants transitent, le propriétaire non : il vient du
    // CONTEXTE. `interventions.id` comme `cycles.id` sont des SERIAL, donc
    // énumérables, et c'est exactement ce que cette ligne empêche d'exploiter.
    const resultat = await rattacherCycleAIntervention({
      ...parsedInput,
      clientId: user.id,
    });

    if (!resultat.ok) {
      return {
        ok: false as const,
        message: messageRefusRattachement(resultat),
      };
    }

    // Seul l'onglet « À venir » porte des interventions `PLANNED`, et c'est le
    // seul statut rattachable : invalider « Passées » n'aurait aucun effet.
    revalidatePath(CHEMIN_ESPACE_CLIENT);

    return { ok: true as const };
  });
