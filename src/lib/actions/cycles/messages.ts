import type {
  ResultatCycle,
  ResultatRattachement,
} from "@/lib/db/queries/cycles";

/// Libellés des refus du domaine `cycles`, partagés par les trois mutations.
/// Un même refus lu différemment selon l'écran ferait croire à deux causes.

/// « Introuvable » couvre le vélo inconnu **et** celui d'autrui : deux réponses
/// distinctes confirmeraient l'existence du second à qui incrémente un entier.
/// Arbitrage B2 du 2026-08-14, contre le 403 de `US-CYCLE-MODIFIER`.
const MESSAGE_CYCLE_INTROUVABLE = "Cycle introuvable.";

export function messageRefusCycle(
  echec: Extract<ResultatCycle, { ok: false }>,
): string {
  // Un `switch` sur un seul motif plutôt qu'un retour direct : l'exhaustivité
  // est tenue par l'union, et ajouter un refus à `ResultatCycle` sans l'écrire
  // ici ne compilera pas.
  switch (echec.reason) {
    case "introuvable":
      return MESSAGE_CYCLE_INTROUVABLE;
  }
}

export function messageRefusRattachement(
  echec: Extract<ResultatRattachement, { ok: false }>,
): string {
  switch (echec.reason) {
    case "introuvable":
      // Le même libellé que les deux mutations produits, pour la même raison
      // et sur la même entité.
      return "Intervention introuvable.";
    case "verrouillee":
      return "Le vélo ne peut plus être changé sur une intervention démarrée, terminée ou annulée.";
    case "cycle_introuvable":
      return MESSAGE_CYCLE_INTROUVABLE;
  }
}
