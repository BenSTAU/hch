import { type JourCivil } from "@/lib/creneaux/horaires";

/// Lecture des paramètres d'URL qui bornent une liste d'interventions.
///
/// **Module pur** : aucune base, aucun contexte Next. Ce qu'il traite vient de
/// l'URL, donc de n'importe qui - un chiffre négatif, un `NaN`, un 31 février,
/// une chaîne de mille caractères. Rien ici ne doit lever ; tout ce qui n'est
/// pas lisible retombe sur un défaut, parce qu'une liste qui ne filtre pas est
/// une réponse correcte quand une page en erreur n'en est pas une.

/// Les deux fenêtres que `US-INTERVENTIONS-LISTER-TECH-A-VENIR` écrit, « 7 j /
/// 30 j ». Une énumération et non une date libre, et c'est un choix de
/// conception : ça **supprime** la surface de validation au lieu de la garder.
/// Il n'y a aucune date à borner sur cette vue, seulement deux valeurs à
/// reconnaître.
export const FENETRES_JOURS = [7, 30] as const;

export type FenetreJours = (typeof FENETRES_JOURS)[number];

export const FENETRE_PAR_DEFAUT: FenetreJours = 7;

export function lireFenetre(valeur: string | undefined): FenetreJours {
  const demandee = Number(valeur);
  return (
    FENETRES_JOURS.find((fenetre) => fenetre === demandee) ?? FENETRE_PAR_DEFAUT
  );
}

const FORMAT_JOUR = /^(\d{4})-(\d{2})-(\d{2})$/;

/// Une date civile depuis un `<input type="date">`, ou rien.
///
/// 🐛 **Remplace `new Date(\`${valeur}T00:00:00.000Z\`)`**, qui vivait dans
/// `mes-interventions/passees/page.tsx` et qui est le bug UTC du filtre de C10
/// versé dans [[points-ouverts-hch]] : minuit **UTC** n'est pas minuit à Paris,
/// donc un filtre « du 11 août » écartait les rendez-vous du 11 entre 00 h 00 et
/// 02 h 00. Même famille de défaut que la borne de journée que le cadrage du
/// plancher V2 a corrigée sur la tournée (D1).
///
/// La fonction rend une date **civile**, pas un instant : l'ancrage dans
/// `Europe/Paris` appartient à la couche d'accès, qui le fait par `instantUtc`
/// et `ajouterJours` comme `listerTourneeDuJour`. Un instant fabriqué ici
/// remettrait le fuseau dans la vue.
///
/// ⚠️ Le format seul ne suffit pas : `2026-02-31` passe la regex, et
/// `Date.UTC` le roulerait au 3 mars sans rien dire. On vérifie l'aller-retour.
export function lireJourCivil(
  valeur: string | undefined,
): JourCivil | undefined {
  if (!valeur) return undefined;

  const correspondance = FORMAT_JOUR.exec(valeur);
  if (!correspondance) return undefined;

  const [, a, m, j] = correspondance;
  const annee = Number(a);
  const mois = Number(m);
  const jour = Number(j);

  const controle = new Date(Date.UTC(annee, mois - 1, jour));
  const reel =
    controle.getUTCFullYear() === annee &&
    controle.getUTCMonth() + 1 === mois &&
    controle.getUTCDate() === jour;

  return reel ? { annee, mois, jour } : undefined;
}

/// Numéro de page, plancher à 1.
///
/// Le durcissement de `listerInterventionsPassees` reste en place derrière :
/// `?page=2.3` produisait un `skip` fractionnaire que Prisma refuse, et un
/// numéro qui ne pouvait plus être marqué `aria-current`. Deux couches pour un
/// paramètre d'URL, c'est le régime normal - celle-ci vaut pour l'affichage,
/// celle de la couche d'accès pour la requête.
export function lirePage(valeur: string | undefined): number {
  const demandee = Number(valeur);
  return Number.isFinite(demandee) ? Math.max(1, Math.trunc(demandee)) : 1;
}
