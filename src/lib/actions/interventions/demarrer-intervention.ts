"use server";

import { revalidatePath } from "next/cache";

import {
  demarrerInterventionDuTech,
  type ResultatDemarrage,
} from "@/lib/db/queries/interventions";
import { cheminIntervention, CHEMIN_TOURNEE_DU_JOUR } from "@/lib/routes";
import { techActionClient } from "@/lib/safe-action";
import { demarrerInterventionSchema } from "@/lib/validations/interventions";

/// Démarrage d'une intervention par son technicien -
/// `US-INTERVENTION-DEMARRER`, écran **T2**.
///
/// Les deux gardes de décision vivent dans le helper métier, pas ici :
/// propriété et statut décident d'une écriture, elles appartiennent donc à la
/// transaction qui l'exécute. Cette action-ci orchestre - rôle, validation,
/// contexte, invalidation.
///
/// ── Elle porte sa propre garde de rôle, et ce n'est pas une redondance
///
/// `techActionClient` applique `requireTech()` en **middleware**, donc avant la
/// validation Zod : un appelant anonyme n'atteint jamais la forme du schéma.
/// La garde de la page ne couvre pas cet appel, `src/proxy.ts` laissant
/// délibérément passer `Next-Action` (rediriger un POST d'action casse le
/// client). Une Server Action exportée est un endpoint POST public
/// (ADR-006 v2).
///
/// ⚠️ **Le rôle ne suffit pas**, et c'est le second étage : `requireTech()`
/// prouve que l'appelant est technicien, pas que l'intervention est la sienne.
/// La propriété se joue dans la clause `where` de `demarrerInterventionDuTech`,
/// qui reçoit `ctx.tech.id` et jamais un identifiant venu de la charge utile.

/// Le libellé rendu à l'écran pour chacun des deux refus.
///
/// `switch` exhaustif sur le discriminant : ajouter une branche à
/// `ResultatDemarrage` sans la traiter ici ne compile pas.
function messageRefus(
  echec: Extract<ResultatDemarrage, { ok: false }>,
): string {
  switch (echec.reason) {
    case "introuvable":
      // Même libellé que les mutations produits, et pour le même motif :
      // l'intervention inconnue et celle d'un collègue ne se distinguent pas.
      return "Intervention introuvable.";
    case "transition_illegale":
      // La SPEC §Cas d'erreur écrit « Transition impossible depuis ce statut ».
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

    // Les refus revalident aussi, et pour la raison démontrée sur l'annulation
    // (PR #33) : les deux disent que la vue de l'appelant est PÉRIMÉE. Sans
    // invalidation, l'écran garde « Planifiée » et son bouton, et le technicien
    // réessaie indéfiniment contre une liste fausse.
    revalidatePath(cheminIntervention(parsedInput.interventionId));
    revalidatePath(CHEMIN_TOURNEE_DU_JOUR);

    if (!resultat.ok) {
      return { ok: false as const, message: messageRefus(resultat) };
    }

    return { ok: true as const };
  });
