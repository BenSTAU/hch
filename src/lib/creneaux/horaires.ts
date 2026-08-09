/// Horaires d'ouverture de la société, et passage heure locale ↔ UTC.
///
/// Module **pur** : aucune base, aucun contexte Next, aucun `server-only`. Il
/// est la moitié calculable de `planning(tech affecté à zone)` de la
/// Constitution §2.1, dont l'autre moitié — les créneaux déjà pris — vit dans
/// `derivation.ts`.
///
/// La lecture des sept clés `business_hours.*` appartient à la couche d'accès
/// (`lib/db/queries/`), pas ici : c'est ce qui rend tout ce fichier testable
/// sans base.

/// Fuseau d'exploitation. L'entreprise opère en France métropolitaine, et la
/// base est en UTC (PLAN S2 T5) : les horaires saisis par l'administrateur sont
/// donc des heures **locales** qu'il faut ancrer avant toute comparaison.
export const FUSEAU_EXPLOITATION = "Europe/Paris";

/// Ordre de `Date.prototype.getUTCDay()` — dimanche en tête. Les clés
/// `app_settings` portent ces mêmes libellés anglais.
export const JOURS_SEMAINE = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type JourSemaine = (typeof JOURS_SEMAINE)[number];

export function cleHoraires(jour: JourSemaine): string {
  return `business_hours.${jour}`;
}

/// Minutes depuis minuit, en heure locale. Pas de `Date` ici : une plage
/// d'ouverture est un motif hebdomadaire, elle n'a pas de date.
export type PlageHoraire = {
  debutMinutes: number;
  finMinutes: number;
};

/// Union discriminée plutôt qu'un `PlageHoraire | null` : « fermé ce jour-là »
/// et « valeur illisible » commandent deux réactions opposées. Le premier est
/// une décision de gestion, le second un défaut de configuration qui doit se
/// voir — les confondre ferme la boutique en silence.
export type LectureHoraires =
  | { ouvert: true; plage: PlageHoraire }
  | { ouvert: false; raison: "ferme" | "invalide" };

const FORMAT_PLAGE = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

const MINUTES_PAR_JOUR = 24 * 60;

export function lirePlageHoraire(valeur: string | null): LectureHoraires {
  // `null` est une clé jamais renseignée, `""` la fermeture explicite. Les
  // deux ferment la journée ; seule l'absence totale de clé serait un défaut,
  // et elle se détecte à la lecture en base, pas ici.
  const brut = (valeur ?? "").trim();
  if (brut === "") return { ouvert: false, raison: "ferme" };

  const correspondance = FORMAT_PLAGE.exec(brut);
  if (!correspondance) return { ouvert: false, raison: "invalide" };

  const [, hd, md, hf, mf] = correspondance;
  const debutMinutes = Number(hd) * 60 + Number(md);
  const finMinutes = Number(hf) * 60 + Number(mf);

  // 24:00 comme borne de fin serait tentant pour « jusqu'à minuit », mais
  // ouvrirait la porte à `24:30`. La borne haute est exclusive côté minutes,
  // pas côté écriture.
  if (Number(hd) > 23 || Number(hf) > 23) {
    return { ouvert: false, raison: "invalide" };
  }
  if (Number(md) > 59 || Number(mf) > 59) {
    return { ouvert: false, raison: "invalide" };
  }
  // Une plage qui se referme sur elle-même ou qui recule ne décrit aucune
  // journée. Pas de passage minuit en v1 : un technicien ne se déplace pas à
  // 23 h.
  if (finMinutes <= debutMinutes) return { ouvert: false, raison: "invalide" };

  return { ouvert: true, plage: { debutMinutes, finMinutes } };
}

/// Décalage du fuseau, en minutes, **à cet instant précis**.
///
/// Positif à l'est de Greenwich : +120 pour Paris en été, +60 en hiver. La
/// valeur dépend de l'instant et non de la zone seule — c'est tout le sujet.
function decalageMinutes(instant: Date, fuseau: string): number {
  const parties = new Intl.DateTimeFormat("en-US", {
    timeZone: fuseau,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const lire = (type: Intl.DateTimeFormatPartTypes): number => {
    const partie = parties.find((p) => p.type === type);
    return partie ? Number(partie.value) : 0;
  };

  // `hour` peut valoir 24 à minuit selon l'implémentation d'`hour12: false`.
  const heure = lire("hour") % 24;

  const murUtc = Date.UTC(
    lire("year"),
    lire("month") - 1,
    lire("day"),
    heure,
    lire("minute"),
    lire("second"),
  );

  return (murUtc - instant.getTime()) / 60_000;
}

/// Instant UTC correspondant à une heure murale locale.
///
/// Deux passes, et la seconde n'est pas du zèle : la première estime le
/// décalage à partir d'un instant faux — l'heure murale lue comme si elle était
/// UTC — ce qui tombe du mauvais côté de la bascule les deux nuits par an où
/// elle a lieu. On re-mesure le décalage à l'instant estimé, et on corrige s'il
/// a bougé. C'est exactement le `02:30` du dernier dimanche d'octobre que PLAN
/// S2 T5 donne en exemple.
export function instantUtc(
  jourLocal: { annee: number; mois: number; jour: number },
  minutesLocales: number,
  fuseau: string = FUSEAU_EXPLOITATION,
): Date {
  const heures = Math.floor(minutesLocales / 60);
  const minutes = minutesLocales % 60;

  const mur = Date.UTC(
    jourLocal.annee,
    jourLocal.mois - 1,
    jourLocal.jour,
    heures,
    minutes,
  );

  const premierDecalage = decalageMinutes(new Date(mur), fuseau);
  const estimation = new Date(mur - premierDecalage * 60_000);

  const secondDecalage = decalageMinutes(estimation, fuseau);
  if (secondDecalage === premierDecalage) return estimation;

  return new Date(mur - secondDecalage * 60_000);
}

/// Date civile locale d'un instant — l'inverse de `instantUtc`, sans l'heure.
export function jourLocal(
  instant: Date,
  fuseau: string = FUSEAU_EXPLOITATION,
): { annee: number; mois: number; jour: number } {
  const parties = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const lire = (type: Intl.DateTimeFormatPartTypes): number => {
    const partie = parties.find((p) => p.type === type);
    return partie ? Number(partie.value) : 0;
  };

  return { annee: lire("year"), mois: lire("month"), jour: lire("day") };
}

/// Jour de la semaine d'une date civile.
///
/// Il se déduit de la date locale, jamais de l'instant UTC : le 1er janvier à
/// 00 h 30 à Paris est encore le 31 décembre à Greenwich, et le planning suivrait
/// les horaires de la veille.
export function jourSemaine(jourLocal: {
  annee: number;
  mois: number;
  jour: number;
}): JourSemaine {
  const index = new Date(
    Date.UTC(jourLocal.annee, jourLocal.mois - 1, jourLocal.jour),
  ).getUTCDay();

  // `getUTCDay` rend 0..6 et `JOURS_SEMAINE` a exactement sept entrées :
  // l'accès ne peut pas manquer, mais `noUncheckedIndexedAccess` l'ignore.
  return JOURS_SEMAINE[index] ?? "sunday";
}

/// Avance d'un nombre de jours **civils**, pas de 24 h.
///
/// La distinction compte les deux nuits de bascule : « demain 08 h 00 » n'est
/// pas « dans 24 h » quand une heure disparaît entre les deux.
export function ajouterJours(
  jour: { annee: number; mois: number; jour: number },
  nombre: number,
): { annee: number; mois: number; jour: number } {
  const avance = new Date(
    Date.UTC(jour.annee, jour.mois - 1, jour.jour + nombre),
  );
  return {
    annee: avance.getUTCFullYear(),
    mois: avance.getUTCMonth() + 1,
    jour: avance.getUTCDate(),
  };
}

export { MINUTES_PAR_JOUR };
