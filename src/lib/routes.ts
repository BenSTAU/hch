/// Chemins d'application partagés entre le serveur et le navigateur.
///
/// **Module pur** : aucun import, aucun `server-only`, aucune dépendance. C'est
/// sa raison d'être. `src/lib/auth/after-login.ts`, où vivaient ces constantes,
/// tire `permissions.ts` qui est marqué `server-only` : un composant client qui
/// l'importerait ferait échouer le build. Or ces chemins sont exactement ce que
/// les deux côtés doivent partager - la destination post-connexion, la cible du
/// `revalidatePath` des Server Actions, le lien du menu utilisateur et celui de
/// l'écran de confirmation du tunnel.
///
/// L'alternative était de recopier le littéral dans chaque composant client.
/// Une route recopiée est une route qui diverge : le tunnel visait
/// `/client/interventions`, chemin qui n'a jamais existé, et personne ne l'a vu
/// avant une passe manuelle.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une chaîne. Ce module est importé
/// par du code client : tout ce qu'il exporte part dans le paquet envoyé au
/// navigateur.

/// Espace client — `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR`, écran C8. C'est
/// aussi la destination post-connexion du client ([[module-1-utilisateurs]]
/// §287).
export const CHEMIN_ESPACE_CLIENT = "/mes-interventions/a-venir";

/// Historique — `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`, écran C10.
export const CHEMIN_ESPACE_CLIENT_PASSEES = "/mes-interventions/passees";

/// Racine de l'espace « compte » du client, tranchée par Benjamin le
/// 2026-08-11 en ouvrant T-V3-12.
///
/// Le vault ne nommait aucune route d'espace client hors `/mes-interventions`,
/// et T-V3-07 (fiche client, écran C12) arrive après : sans arbitrage, elle
/// aurait posé `/profil` ou `/mon-profil` et le produit aurait eu deux racines
/// pour un seul espace. C'est ce préfixe-ci qu'elle reprend. À tracer au
/// write-back.
export const CHEMIN_COMPTE = "/mon-compte";

/// Droit à l'oubli - `US-COMPTE-SUPPRIMER`.
///
/// Route **autonome**, et c'est une propriété, pas une commodité : le second
/// point d'entrée nommé par l'US est `US-RGPD` → « Exercer mon droit à
/// l'oubli », donc le parcours reste entier même si T-V3-07 est sacrifiée et
/// que l'écran C12 n'existe jamais. Le critère de fin de phase V3 nomme ce
/// droit ; il ne peut pas dépendre d'une tâche supprimable.
export const CHEMIN_SUPPRESSION_COMPTE = "/mon-compte/supprimer";

/// Retour après pseudonymisation - `US-COMPTE-SUPPRIMER` §Cas nominal, « je
/// suis redirigé vers la page publique d'accueil avec message final ».
///
/// Le message voyage en paramètre d'URL plutôt qu'en session : il n'y a plus de
/// session à ce moment-là, c'est tout le sujet.
export const CHEMIN_COMPTE_SUPPRIME = "/?compte=supprime";
