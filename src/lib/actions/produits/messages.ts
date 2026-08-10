import type { EchecStock, ResultatLigne } from "@/lib/db/queries/produits";

/// Libellés des refus de vente, partagés par les trois surfaces qui vendent :
/// la validation du tunnel (T=0) et les deux mutations de l'espace client
/// (T+n). Un même refus lu différemment selon l'écran ferait croire à deux
/// causes.

/// ⚠️ Typographie : `US-INTERVENTION-PRODUIT-AJOUTER` §Cas d'erreur écrit
/// « Stock insuffisant - quantité maximale : `<stock>` », au cadratin. Le dépôt
/// n'en porte aucun (CLAUDE.md §Typographie), et la règle vaut pour la copie
/// produit y compris reprise mot pour mot d'une SPEC. La virgule remplace le
/// cadratin, l'écart est signalé en PR pour write-back.
export function messageEchecStock(echec: EchecStock): string {
  if (echec.reason === "stock_insuffisant") {
    return echec.disponible === 0
      ? `${echec.label} est en rupture de stock.`
      : `Stock insuffisant, quantité maximale : ${String(echec.disponible)}.`;
  }

  return `${echec.label} n'est plus disponible à la vente.`;
}

/// « Introuvable » couvre l'intervention inconnue **et** celle d'un tiers :
/// deux réponses distinctes confirmeraient l'existence de la seconde à qui
/// incrémente un identifiant. Défaut déjà payé une fois sur les adresses
/// (PR #26 note 4), pas une seconde.
const MESSAGE_INTROUVABLE = "Intervention introuvable.";

const MESSAGE_LIGNE_ABSENTE = "Produit déjà retiré ou introuvable.";

/// Un seul refus lisible pour les deux mutations T+n. L'exhaustivité est tenue
/// par l'union elle-même : ajouter un motif à `ResultatLigne` sans l'écrire ici
/// ne compile pas.
export function messageRefus(
  echec: Extract<ResultatLigne, { ok: false }>,
  operation: "ajout" | "retrait",
): string {
  switch (echec.reason) {
    case "introuvable":
      return MESSAGE_INTROUVABLE;
    case "verrouillee":
      // Libellés de la SPEC, §Cas d'erreur des deux US.
      return operation === "ajout"
        ? "Ajout impossible sur une intervention déjà démarrée ou clôturée."
        : "Retrait impossible sur une intervention déjà démarrée ou clôturée.";
    case "ligne_absente":
      return MESSAGE_LIGNE_ABSENTE;
    case "produit_indisponible":
    case "stock_insuffisant":
      return messageEchecStock(echec);
  }
}
