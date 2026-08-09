/// Formats d'affichage du catalogue — prix et durée d'un forfait.
///
/// Hors des vues parce que trois surfaces affichent les mêmes valeurs : la
/// landing publique, le tunnel de réservation (T-V3-08) et le back-office
/// catalogue (V1). Un prix formaté à trois endroits finit par diverger d'un
/// séparateur ou d'un symbole, et c'est le genre d'écart qu'aucun test ne
/// rattrape parce que chacun teste sa propre version.

const EUROS = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

/// `services.price` traverse la couche d'accès en **chaîne**, jamais en
/// `number` : un DECIMAL(10,2) passé par un flottant binaire perd ses centimes.
/// La conversion ci-dessous ne sert qu'au formatage — la valeur d'origine reste
/// la chaîne, et c'est elle qui sera figée en `price_snapshot` à la réservation
/// (Constitution §4.1).
export function formatPrixEuros(price: string): string {
  return EUROS.format(Number(price));
}

/// La durée reste **en minutes**, y compris au-delà de l'heure.
///
/// Ce n'est pas un oubli de « 1 h 30 » : `US-FORFAIT-CONSULTER` §Cas nominal
/// écrit « la durée **en minutes** », et c'est la même unité que celle dont le
/// moteur de créneaux dérive la grille (Constitution §2.1). Deux unités pour la
/// même donnée feraient dire au client autre chose qu'au planning.
///
/// Espace insécable : « 60 » et « min » ne se séparent pas en fin de ligne.
export function formatDuree(minutes: number): string {
  return `${minutes} min`;
}
