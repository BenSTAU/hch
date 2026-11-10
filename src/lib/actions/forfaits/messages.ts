import type {
  ResultatCreationForfait,
  ResultatModificationForfait,
} from "@/lib/db/queries/forfaits";

/// Libellés des refus du domaine `forfaits`, partagés par les deux mutations.
/// Un même refus lu différemment selon l'écran ferait croire à deux causes.
///
/// Repris de `US-FORFAIT-AJOUTER` et `US-FORFAIT-MODIFIER` §Cas d'erreur, à la
/// typographie près (CLAUDE.md §Typographie : le cadratin de la SPEC ne voyage
/// pas).

const MESSAGE_NOM_PRIS = "Un forfait actif portant ce nom existe déjà";

/// Le message dit **quoi faire**, et pas seulement ce qui s'est passé :
/// recharger est la seule action qui règle ce refus. Corriger le champ ne sert
/// à rien, la fiche affichée n'est plus celle de la base.
const MESSAGE_PERIME =
  "Ce forfait a été modifié entre-temps, rechargez la fiche";

export function messageRefusCreation(
  echec: Extract<ResultatCreationForfait, { ok: false }>,
): string {
  // Un `switch` sur un seul motif plutôt qu'un retour direct : l'exhaustivité
  // est tenue par l'union, et ajouter un refus sans l'écrire ici ne compilera
  // pas.
  switch (echec.reason) {
    case "nom_pris":
      return MESSAGE_NOM_PRIS;
  }
}

export function messageRefusModification(
  echec: Extract<ResultatModificationForfait, { ok: false }>,
): string {
  switch (echec.reason) {
    case "introuvable":
      // ⚠️ Libellé **inventé ici** : `US-FORFAIT-MODIFIER` §Cas d'erreur ne
      // prévoit pas ce refus, alors que la fiche peut disparaître entre son
      // ouverture et son enregistrement. À verser au write-back.
      return "Forfait introuvable";
    case "perime":
      return MESSAGE_PERIME;
    case "nom_pris":
      return MESSAGE_NOM_PRIS;
  }
}
