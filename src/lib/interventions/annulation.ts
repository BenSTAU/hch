/// Fenêtre d'annulation en self-service - `US-INTERVENTION-ANNULER-CLIENT`.
///
/// **Module pur, sans `server-only`, et c'est sa raison d'être** : le bloc
/// d'annulation est un composant client, et `db/queries/interventions.ts` est
/// `server-only`. Une fenêtre recopiée dans l'écran divergerait de la fenêtre
/// appliquée, et l'écart ne se verrait qu'au refus. Même motif que
/// `src/lib/photos/quotas.ts` et `src/lib/routes.ts`.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une valeur ou un calcul : ce module
/// part dans le paquet envoyé au navigateur.

/// **24 heures pleines** avant le rendez-vous. L'US la formule en miroir :
/// nominal si `appointment_at - NOW() > 24 h`, refus si `<= 24 h`. L'égalité
/// stricte tombe donc du côté du refus.
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

/// Longueur maximale du motif d'annulation. Ici et non dans le schéma Zod, que
/// la zone de saisie ne peut pas importer : `validations/interventions.ts` tire
/// `photos/stockage.ts`, donc `sharp`, donc `node:fs`. Le schéma la relit
/// d'ici et reste la seule autorité côté serveur.
///
/// ⚠️ La valeur ne vient d'aucune source : `cancellation_reason` est un TEXT
/// sans contrainte et l'US ne dit que « obligatoire ».
export const MOTIF_ANNULATION_MAX = 500;
