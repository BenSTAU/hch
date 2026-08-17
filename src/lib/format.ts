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
/// ⚠️ Fuseau nommé explicitement, jamais le fuseau local : un formatage
/// implicite rend une chaîne différente au serveur (conteneur en UTC) et dans
/// le navigateur, donc une divergence d'hydratation sur la donnée la plus lue
/// de l'écran. L'entreprise n'opère qu'en France métropolitaine.
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

/// « vendredi 8 août 2026 à 10:00 » - titre du panneau de détail.
export function formatDateLongue(instant: Date): string {
  return DATE_LONGUE.format(instant);
}

/// « ven. 8 août, 10:00 » - cartes de la liste.
export function formatDateCourte(instant: Date): string {
  return DATE_COURTE.format(instant);
}

/// Jour calendaire d'un instant, dans le fuseau d'exploitation, au format
/// `AAAA-MM-JJ`. `fr-CA` est le seul locale courant qui rende l'ISO.
const JOUR_CALENDAIRE = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU_EXPLOITATION,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/// « Dans 3 jours » - chip des cartes de la liste (écran **C8**).
///
/// ⚠️ **Écart de jours CALENDAIRES, pas de millisecondes.** Un rendez-vous
/// demain à 9 h est « demain », qu'on le lise à 8 h ou à 23 h ; un écart en
/// millisecondes le dirait « aujourd'hui » le soir même et changerait de
/// réponse entre le rendu serveur et l'hydratation.
///
/// Une date passée ne rend **aucun** chip : l'onglet « À venir » retient
/// `status = PLANNED` sans borne de date, donc un rendez-vous non clôturé y
/// reste, et « Dans -2 jours » n'a pas de sens.
///
/// `maintenant` est un paramètre, jamais `new Date()` : l'appelant le fixe une
/// fois côté serveur, sinon le rendu et l'hydratation lisent deux horloges.
export function formatDelaiRelatif(
  quand: Date,
  maintenant: Date,
): string | null {
  const enJours = (instant: Date): number =>
    Date.parse(`${JOUR_CALENDAIRE.format(instant)}T00:00:00Z`) / 86_400_000;

  const ecart = Math.round(enJours(quand) - enJours(maintenant));

  if (ecart < 0) return null;
  if (ecart === 0) return "Aujourd'hui";
  if (ecart === 1) return "Demain";
  // Deux semaines pleines : au-delà, « Dans 23 jours » se compte, « Dans
  // 3 semaines » se lit. La maquette C8 écrit « Dans X jours/semaines » sans
  // dire où passe la bascule.
  if (ecart < 14) return `Dans ${String(ecart)} jours`;

  return `Dans ${String(Math.round(ecart / 7))} semaines`;
}

/// « 09:00 » — heure seule, dans le fuseau d'exploitation. Colonne de gauche
/// des lignes de la tournée technicien (écran **T1**), où la date est déjà dans
/// le titre de la page et n'a pas à être répétée quinze fois.
const HEURE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU_EXPLOITATION,
  hour: "2-digit",
  minute: "2-digit",
});

export function formatHeure(instant: Date): string {
  return HEURE.format(instant);
}

/// « jeudi 13 août » — titre de la tournée du jour. Sans l'année : la page ne
/// montre qu'aujourd'hui, et la préciser ferait lire une information sans
/// usage. Sans capitale initiale non plus — `Intl` rend « jeudi », et la
/// capitale de la maquette se pose en CSS (`first-letter:uppercase`) plutôt
/// qu'en découpant la chaîne, ce qui casserait sur d'autres locales.
const JOUR_LONG = new Intl.DateTimeFormat("fr-FR", {
  timeZone: FUSEAU_EXPLOITATION,
  weekday: "long",
  day: "numeric",
  month: "long",
});

export function formatJourLong(instant: Date): string {
  return JOUR_LONG.format(instant);
}

/// « 2 h 50 » — charge de travail cumulée d'une journée (écran **T1**).
///
/// ⚠️ **Distinct de `formatDuree`, et ce n'est pas une redondance.** Celui-là
/// rend des minutes parce que `US-FORFAIT-CONSULTER` impose cette unité pour un
/// forfait, celle-là même dont le moteur de créneaux dérive la grille. Une
/// SOMME de journée n'est pas une durée de forfait : « 170 min » ne se lit pas.
///
/// Sous l'heure on retombe sur les minutes, « 0 h 45 » se lisant moins bien.

/// Espace insécable U+00A0, même séparateur que `formatDuree` — « 2 h 50 » ne se
/// coupe pas en fin de ligne sur un chip étroit.
///
/// ⚠️ Il est INVISIBLE dans un diff comme dans un éditeur, et rend un test
/// rouge illisible : « expected '90 min' to be '90 min' », deux chaînes
/// identiques à l'œil. D'où la constante nommée plutôt que le caractère semé
/// dans les gabarits.
const INSECABLE = " ";

export function formatDureeCumulee(minutes: number): string {
  if (minutes < 60) return `${String(minutes)}${INSECABLE}min`;

  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;

  return reste === 0
    ? `${String(heures)}${INSECABLE}h`
    : `${String(heures)}${INSECABLE}h${INSECABLE}${String(reste).padStart(2, "0")}`;
}

/// La durée reste **en minutes**, y compris au-delà de l'heure.
///
/// Ce n'est pas un oubli de « 1 h 30 » : c'est l'unité qu'impose
/// `US-FORFAIT-CONSULTER`, et celle dont le moteur de créneaux dérive la grille
/// (Constitution §2.1). Deux unités pour la même donnée feraient dire au client
/// autre chose qu'au planning.
export function formatDuree(minutes: number): string {
  return `${minutes} min`;
}
