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
/// ── Pourquoi un écart de jours CALENDAIRES et non de millisecondes
///
/// Un rendez-vous demain à 9 h est « demain », qu'on le lise à 8 h ou à 23 h.
/// Un écart en millisecondes le dirait « aujourd'hui » le soir même, et
/// changerait de réponse entre le rendu serveur et l'hydratation - c'est la
/// divergence d'hydratation payée sur le stepper du tunnel (PR #29 note 8). La
/// borne de jour ne bouge qu'à minuit.
///
/// ── Une date passée ne rend AUCUN chip
///
/// L'onglet « À venir » retient `status = PLANNED` **sans borne de date**
/// (arbitrage du 2026-08-11) : un rendez-vous que le technicien n'a pas clôturé
/// y reste. « Dans -2 jours » n'a pas de sens, et aucune source ne dit quoi
/// afficher à la place. La date complète est déjà sur la carte, elle suffit.
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
