"use server";

import { revalidatePath } from "next/cache";

import {
  demarrerInterventionDuTech,
  type ResultatDemarrage,
} from "@/lib/db/queries/interventions";
import { cheminIntervention, CHEMIN_TOURNEE_DU_JOUR } from "@/lib/routes";
import { techActionClient } from "@/lib/safe-action";
import { demarrerInterventionSchema } from "@/lib/validations/interventions";

/// Démarrage d'une intervention par son technicien,
/// `US-INTERVENTION-DEMARRER`, écran **T2**. Les gardes de propriété et de
/// statut vivent dans le helper métier : elles décident d'une écriture, donc
/// appartiennent à sa transaction.
///
/// `techActionClient` applique `requireTech()` en middleware, donc avant Zod :
/// un appelant anonyme n'atteint jamais la forme du schéma. La garde de la
/// page ne couvre pas cet appel, `src/proxy.ts` laissant passer `Next-Action`.
///
/// ⚠️ **Le rôle ne suffit pas** : il prouve que l'appelant est technicien, pas
/// que l'intervention est la sienne. La propriété se joue dans la clause
/// `where` de `demarrerInterventionDuTech`, qui reçoit `ctx.tech.id`.

/// Le libellé rendu à l'écran pour chacun des deux refus. `switch` exhaustif :
/// ajouter une branche à `ResultatDemarrage` sans la traiter ne compile pas.
function messageRefus(
  echec: Extract<ResultatDemarrage, { ok: false }>,
): string {
  switch (echec.reason) {
    case "introuvable":
      // L'intervention inconnue et celle d'un collègue ne se distinguent pas.
      return "Intervention introuvable.";
    case "transition_illegale":
      // Le statut courant est nommé plutôt que sous-entendu : le technicien
      // vient de cliquer, il doit savoir ce qui a changé sous ses yeux.
      return echec.statutCourant === "IN_PROGRESS"
        ? "Cette intervention est déjà démarrée."
        : "Cette intervention n'est plus démarrable : elle est terminée ou annulée.";
  }
}

export const demarrerIntervention = techActionClient
  .inputSchema(demarrerInterventionSchema)
  .action(async ({ parsedInput, ctx: { tech } }) => {
    const resultat = await demarrerInterventionDuTech({
      interventionId: parsedInput.interventionId,
      // Le technicien vient du CONTEXTE, jamais de la charge utile.
      techId: tech.id,
      // L'instant est fixé **ici**, une fois, et traverse la transaction : le
      // lire deux fois daterait le statut et l'audit sur deux valeurs.
      maintenant: new Date(),
    });

    // Les refus revalident AUSSI : ils disent que la vue de l'appelant est
    // périmée. Sans invalidation, l'écran garde « Planifiée » et son bouton, et
    // le technicien réessaie indéfiniment contre une liste fausse.
    revalidatePath(cheminIntervention(parsedInput.interventionId));
    revalidatePath(CHEMIN_TOURNEE_DU_JOUR);

    if (!resultat.ok) {
      return { ok: false as const, message: messageRefus(resultat) };
    }

    return { ok: true as const };
  });
