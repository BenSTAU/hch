/// Les quatre étapes du tunnel, partagées par l'orchestrateur, le stepper et
/// les tests. Un seul endroit décide de l'ordre : le stepper le rend, l'URL le
/// porte, et `parseAsStringLiteral` s'en sert pour refuser une valeur inventée.

export const ETAPES = [
  "forfait",
  "adresse",
  "creneau",
  "recapitulatif",
] as const;

export type Etape = (typeof ETAPES)[number];

/// Libellés du stepper. La maquette nomme le 4ᵉ pas « Panier » (`c2:135`,
/// `c5:155`) : le panier de produits appartient à T-V3-09 et n'existe pas
/// encore, un pas nommé d'après un contenu absent promettrait ce que l'écran ne
/// montre pas. Divergence signalée en PR, à réviser quand T-V3-09 livrera.
export const ETIQUETTES: Record<Etape, string> = {
  forfait: "Forfait",
  adresse: "Adresse",
  creneau: "Créneau",
  recapitulatif: "Récapitulatif",
};

/// Titres d'écran, repris **mot pour mot des maquettes** sauf mention contraire.
///
///   · C2 `code.html:147` - « Quel forfait vous convient ? »
///   · C3 `code.html:151` - « Où intervenons-nous ? »
///   · C4 `code.html:145` - « Choisissez votre créneau »
///   · C5 `code.html:163` - « Finalisez votre réservation »
///
/// Ils remplacent les quatre libellés fonctionnels posés par T-V3-08, qui
/// n'étaient d'aucune maquette.
export const TITRES: Record<Etape, string> = {
  forfait: "Quel forfait vous convient ?",
  adresse: "Où intervenons-nous ?",
  creneau: "Choisissez votre créneau",
  recapitulatif: "Finalisez votre réservation",
};

/// Gouttières de page du brief Stitch : `margin-page-mobile` 20 px,
/// `margin-page-desktop` 64 px, conteneur `max-w-7xl` (`c2:144`, `c3:148`,
/// `c4:134`, `c5:161`). La landing, elle, ouvre à `max-w-[1920px]` parce que sa
/// maquette le fait : ce n'est pas une incohérence, un tunnel se lit sur une
/// colonne plus étroite qu'une page d'accueil.
export const CONTENEUR = "mx-auto w-full max-w-7xl px-5 md:px-16";
