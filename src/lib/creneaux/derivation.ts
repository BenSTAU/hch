import {
  ajouterJours,
  FUSEAU_EXPLOITATION,
  instantUtc,
  jourLocal,
  jourSemaine,
  type JourSemaine,
  type PlageHoraire,
} from "./horaires";

/// Dérivation du pool de créneaux disponibles.
///
/// `planning(tech affecté à zone) × durée(forfait) − créneaux occupés`
/// (Constitution §2.1). **Aucune table `availabilities`** : rien n'est stocké,
/// tout se recalcule à la demande, et c'est un axiome du produit — un créneau
/// naît de la vente, il ne lui préexiste pas.
///
/// Module **pur**, sans base ni contexte Next : les horaires et les créneaux
/// occupés lui sont donnés. C'est ce qui permet d'éprouver le passage à l'heure
/// d'hiver sous Vitest, là où le reste du tunnel exige un vrai PostgreSQL.

/// Pas de la grille, en minutes. Les créneaux tombent donc à `:00` et `:30`.
///
/// Un forfait plus court que le pas ne « perd » pas la différence : un forfait
/// de 20 minutes occupe une case de 30, et les 10 minutes restantes sont la
/// marge de déplacement du technicien. C'est voulu.
export const PAS_MINUTES = 30;

/// Un mois glissant. Au-delà, `US-INTERVENTION-RESERVER` prescrit le message
/// « Aucun créneau disponible » plutôt qu'une grille qui s'étire.
export const HORIZON_JOURS = 30;

export type Creneau = {
  debut: Date;
  fin: Date;
};

/// Une intervention déjà planifiée pour ce technicien.
export type PlageOccupee = {
  debut: Date;
  fin: Date;
};

/// Sept entrées attendues, `null` pour un jour de fermeture. `Partial` parce
/// qu'une clé absente en base est indiscernable d'un jour fermé du point de vue
/// de la grille — la distinction, elle, se fait à la lecture.
export type HorairesSemaine = Partial<Record<JourSemaine, PlageHoraire | null>>;

function seChevauchent(creneau: Creneau, occupe: PlageOccupee): boolean {
  // Bornes `[début, fin[` des deux côtés : deux interventions qui se touchent
  // exactement ne se chevauchent pas. Même convention que le `'[)'` du
  // `tstzrange` de la migration 010 — les deux doivent dire la même chose, sinon
  // la grille propose un créneau que la base refusera.
  return creneau.debut < occupe.fin && occupe.debut < creneau.fin;
}

/// Un technicien de la zone et ses interventions déjà planifiées.
export type TechnicienCharge = {
  id: string;
  occupes: readonly PlageOccupee[];
};

/// Créneau retenu, avec le technicien qui s'y rendra.
export type CreneauAffecte = Creneau & { techId: string };

/// **Premier technicien libre, dans l'ordre croissant des identifiants.**
///
/// Règle écrite, et non comportement émergent d'un `ORDER BY` : ni round-robin
/// ni équilibrage de charge, qui exigeraient tous deux un état que rien ne
/// tient en v1. L'ordre est stable pour qu'un même créneau ne change pas de
/// technicien entre l'affichage de la grille et la validation.
///
/// ⚠️ Non démontrable en démonstration : le seed ne porte qu'un technicien.
export function affecterPremierLibre(
  creneau: Creneau,
  techniciens: readonly TechnicienCharge[],
): string | null {
  for (const technicien of techniciens) {
    const libre = !technicien.occupes.some((occupe) =>
      seChevauchent(creneau, occupe),
    );
    if (libre) return technicien.id;
  }
  return null;
}

/// Filtre la grille sur les créneaux qu'au moins un technicien peut prendre, et
/// nomme lequel.
export function affecterCreneaux(
  creneaux: readonly Creneau[],
  techniciens: readonly TechnicienCharge[],
): CreneauAffecte[] {
  const affectes: CreneauAffecte[] = [];

  for (const creneau of creneaux) {
    const techId = affecterPremierLibre(creneau, techniciens);
    if (techId === null) continue;
    affectes.push({ ...creneau, techId });
  }

  return affectes;
}

export function deriverCreneaux(params: {
  horaires: HorairesSemaine;
  /// Durée du forfait choisi, en minutes. C'est lui qui dimensionne le créneau.
  dureeMinutes: number;
  /// Facultatif : la grille brute ignore l'occupation, que `affecterCreneaux`
  /// traite ensuite technicien par technicien.
  occupes?: readonly PlageOccupee[];
  /// Instant de référence — tout créneau qui commence avant est écarté.
  maintenant: Date;
  horizonJours?: number;
  pasMinutes?: number;
  fuseau?: string;
}): Creneau[] {
  const {
    horaires,
    dureeMinutes,
    occupes = [],
    maintenant,
    horizonJours = HORIZON_JOURS,
    pasMinutes = PAS_MINUTES,
    fuseau = FUSEAU_EXPLOITATION,
  } = params;

  // Un forfait de durée nulle ou négative ne décrit aucun créneau. La donnée
  // vient de `services.duration`, hors de portée de ce module : on rend une
  // grille vide plutôt que de boucler indéfiniment.
  if (dureeMinutes <= 0 || pasMinutes <= 0) return [];

  const creneaux: Creneau[] = [];
  /// Instants déjà retenus.
  ///
  /// Deux heures murales distinctes peuvent rendre le MÊME instant, la nuit où
  /// une heure disparaît : le 29 mars 2026, 02:00 locales n'existe pas, et
  /// `instantUtc` projette cette heure absente sur 03:00. Sans ce garde, une
  /// plage `02:00-05:00` proposerait deux boutons pour un seul rendez-vous, et
  /// deux clés React identiques.
  ///
  /// Inatteignable avec les horaires seedés (08:00-18:00 n'enjambe pas le
  /// trou), mais la CRUD `app_settings` laisse saisir n'importe quelle plage.
  /// Relevé par l'agent testeur.
  const instantsRetenus = new Set<number>();
  const depart = jourLocal(maintenant, fuseau);

  for (let decalage = 0; decalage < horizonJours; decalage += 1) {
    const jour = ajouterJours(depart, decalage);
    const plage = horaires[jourSemaine(jour)];
    if (!plage) continue;

    // Premier multiple du pas au niveau ou au-delà de l'ouverture : une
    // boutique qui ouvre à 08 h 15 propose son premier créneau à 08 h 30.
    const premier = Math.ceil(plage.debutMinutes / pasMinutes) * pasMinutes;

    for (
      let minutes = premier;
      // Le créneau doit tenir ENTIER avant la fermeture. Un forfait de 2 h ne
      // se propose pas à 17 h 30 dans une journée qui ferme à 18 h.
      minutes + dureeMinutes <= plage.finMinutes;
      minutes += pasMinutes
    ) {
      const debut = instantUtc(jour, minutes, fuseau);
      const fin = new Date(debut.getTime() + dureeMinutes * 60_000);

      if (debut.getTime() < maintenant.getTime()) continue;

      // Voir `instantsRetenus` : deux heures murales peuvent désigner le même
      // instant la nuit où une heure disparaît.
      if (instantsRetenus.has(debut.getTime())) continue;

      const creneau = { debut, fin };
      if (occupes.some((occupe) => seChevauchent(creneau, occupe))) continue;

      instantsRetenus.add(debut.getTime());
      creneaux.push(creneau);
    }
  }

  return creneaux;
}
