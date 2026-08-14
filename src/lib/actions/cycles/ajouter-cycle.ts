"use server";

import { revalidatePath } from "next/cache";

import { creerCycle } from "@/lib/db/queries/cycles";
import { CHEMIN_CYCLES, CHEMIN_ESPACE_CLIENT } from "@/lib/routes";
import { authActionClient } from "@/lib/safe-action";
import { ajouterCycleSchema } from "@/lib/validations/cycles";

/// Ajout d'un vélo - `US-CYCLE-AJOUTER`.
///
/// ⚠️ La SPEC §Cas d'erreur décrit un `POST /cycles` et une redirection vers la
/// connexion : cet endpoint REST n'existe pas, c'est une Server Action, et
/// l'appelant anonyme est arrêté par le middleware d'`authActionClient` avant
/// la validation Zod - il n'atteint ni le corps ni la forme du schéma.
export const ajouterCycle = authActionClient
  .inputSchema(ajouterCycleSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    // Le propriétaire vient du CONTEXTE, jamais de la charge utile. Rappel
    // d'ADR-006 v2 : cette action est un endpoint POST public.
    const cycle = await creerCycle({ ...parsedInput, userId: user.id });

    revalidatePath(CHEMIN_CYCLES);
    // 🐛 **L'espace client aussi**, relevé par l'agent testeur : le sélecteur de
    // rattachement du panneau de détail liste ces mêmes vélos, et un vélo créé
    // pour le rendez-vous de demain n'y serait pas proposé. DoD 517 écrit
    // « après CHAQUE mutation », et `modifierCycle` le faisait déjà - l'écart
    // entre les deux actions n'était pas un arbitrage, c'était un oubli.
    revalidatePath(CHEMIN_ESPACE_CLIENT);

    return { ok: true as const, cycle };
  });
