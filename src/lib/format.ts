/// Formats d'affichage du catalogue - prix et durée d'un forfait.
///
/// Hors des vues parce que trois surfaces affichent les mêmes valeurs : la
/// landing publique, le tunnel de réservation (T-V3-08) et le back-office
/// catalogue (V1). Un prix formaté à trois endroits finit par diverger d'un
/// séparateur ou d'un symbole, et c'est le genre d'écart qu'aucun test ne
/// rattrape parce que chacun teste sa propre version.

import { FUSEAU_EXPLOITATION } from "@/lib/creneaux/horaires";

const EUROS = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

/// `services.price` traverse la couche d'accès en **chaîne**, jamais en
/// `number` : un DECIMAL(10,2) passé par un flottant binaire perd ses centimes.
/// La conversion ci-dessous ne sert qu'au formatage - la valeur d'origine reste
/// la chaîne, et c'est elle qui sera figée en `price_snapshot` à la réservation
/// (Constitution §4.1).
export function formatPrixEuros(price: string): string {
  return EUROS.format(Number(price));
}

/// Multiplie un montant par une quantité, **en centimes**.
///
/// `Number("12.90") * 3` vaut `38.699999999999996` en flottant binaire. L'écart
/// est invisible tant qu'on formate à deux décimales, et cesse de l'être dès
/// qu'on additionne quelques lignes. Le calcul passe donc par des entiers, comme
/// le DECIMAL(10,2) de la base.
export function multiplierEuros(prix: string, quantite: number): string {
  return ((Math.round(Number(prix) * 100) * quantite) / 100).toFixed(2);
}

/// Somme de montants décimaux, même motif.
///
/// Total **d'affichage** uniquement : celui qui fait foi est recalculé côté
/// serveur à partir des instantanés figés (Constitution §4.1). Deux calculs, une
/// seule source - les prix viennent de la base dans les deux cas.
export function sommeEuros(montants: readonly string[]): string {
  const centimes = montants.reduce(
    (total, montant) => total + Math.round(Number(montant) * 100),
    0,
  );
  return (centimes / 100).toFixed(2);
}

/// Date et heure d'un rendez-vous, **ancrées sur le fuseau d'exploitation**.
///
/// Les deux US de l'espace client demandent « `appointment_at` timezone
/// client ». Le fuseau est nommé explicitement plutôt que laissé au fuseau
/// local, pour deux motifs qui vont dans le même sens : l'entreprise n'opère
/// qu'en France métropolitaine, donc le fuseau du client **est** celui-là ; et
/// un formatage implicite rend une chaîne différente au serveur (conteneur en
/// UTC) et dans le navigateur, ce qui produit une divergence d'hydratation sur
/// la donnée la plus lue de l'écran.
const DATE_LONGUE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU_EXPLOITATION,
  dateStyle: "full",
  timeStyle: "short",
});

const DATE_COURTE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU_EXPLOITATION,
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/// « vendredi 8 août 2026 à 10:00 » — titre du panneau de détail.
export function formatDateLongue(instant: Date): string {
  return DATE_LONGUE.format(instant);
}

/// « ven. 8 août, 10:00 » — cartes de la liste.
export function formatDateCourte(instant: Date): string {
  return DATE_COURTE.format(instant);
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
