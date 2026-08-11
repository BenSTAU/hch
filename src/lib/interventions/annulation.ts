/// Fenêtre d'annulation en self-service - `US-INTERVENTION-ANNULER-CLIENT`.
///
/// **Module pur** : aucun import, aucun `server-only`. C'est sa raison d'être.
/// Le bloc d'annulation est un composant **client**, et
/// `src/lib/db/queries/interventions.ts`, seul autre endroit où cette règle
/// pourrait vivre, est marqué `server-only` : l'importer depuis l'écran fait
/// échouer le build. Même motif que `src/lib/photos/quotas.ts` et
/// `src/lib/routes.ts`.
///
/// L'alternative était de recopier la règle dans l'écran. Une fenêtre affichée
/// qui diverge de la fenêtre appliquée fait proposer un bouton que le serveur
/// refuse, et l'écart ne se voit qu'au moment du refus.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une valeur ou un calcul. Ce module
/// part dans le paquet envoyé au navigateur.

/// **24 heures pleines** avant le rendez-vous.
///
/// Tranchée B7 Session 4 du 2026-07-08 (Q1b), et l'US la formule deux fois, en
/// miroir : nominal si `appointment_at - NOW() > 24 h`, refus si `<= 24 h`.
/// L'égalité stricte tombe donc du côté du refus, et c'est ce que le test de
/// borne vérifie.
export const FENETRE_ANNULATION_MS = 24 * 3_600_000;

/// Vrai tant que l'annulation en ligne reste ouverte.
///
/// `maintenant` est un paramètre, jamais `new Date()` : l'appelant le fixe une
/// fois côté serveur, sinon le rendu et l'hydratation lisent deux horloges et
/// le bouton peut changer d'état entre les deux.
export function annulationOuverte(
  appointmentAt: Date,
  maintenant: Date,
): boolean {
  return appointmentAt.getTime() - maintenant.getTime() > FENETRE_ANNULATION_MS;
}

/// Longueur maximale du motif d'annulation.
///
/// Elle vit **ici** et non dans le schéma Zod, pour la même raison que la
/// fenêtre : la zone de saisie la porte en `maxLength`, et
/// `src/lib/validations/interventions.ts` tire `photos/stockage.ts`, donc
/// `sharp`, donc `node:fs`. Le schéma la relit d'ici, il en reste la seule
/// autorité côté serveur.
///
/// La valeur ne vient d'aucune source : `interventions.cancellation_reason` est
/// un TEXT sans contrainte, et l'US ne dit que « obligatoire ». Arbitrée le
/// 2026-08-11 - le champ est lu par un technicien sur un téléphone, pas
/// archivé.
export const MOTIF_ANNULATION_MAX = 500;
