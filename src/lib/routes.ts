/// Chemins d'application partagés entre le serveur et le navigateur.
///
/// **Module pur** : aucun import, aucun `server-only`, aucune dépendance. C'est
/// sa raison d'être. Ces constantes vivaient dans `src/lib/auth/after-login.ts`,
/// qui tirait alors `permissions.ts` marqué `server-only` : un composant client
/// qui l'importait faisait échouer le build. Or ces chemins sont exactement ce
/// que les deux côtés doivent partager - la destination post-connexion, la
/// cible du `revalidatePath` des Server Actions, les entrées de navigation, le
/// lien du menu utilisateur et celui de l'écran de confirmation du tunnel.
///
/// T-V2-05 a déplacé le vocabulaire des rôles dans `src/lib/auth/roles.ts`, pur
/// lui aussi, pour la même raison et sur le même précédent : `after-login.ts`
/// ne tire donc plus `server-only`. Le motif de ce module-ci est inchangé, la
/// frontière s'est simplement déplacée d'un cran.
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

/// Tournée du jour du technicien — `US-INTERVENTIONS-LISTER-TECH-DU-JOUR`,
/// écran T1. Destination post-connexion du `ROLE_TECH`
/// ([[module-1-utilisateurs]] §250), et fin du provisoire posé par T-V3-03.
///
/// **Pas sous `/tech/`**, alors que `src/proxy.ts` matche déjà ce préfixe :
/// c'est le chemin que la SPEC nomme, les routes sont en français, et le
/// précédent est `/mes-interventions` côté client (T-V3-10). Les deux dossiers
/// `(app)/tech/` et `(app)/client/` étaient restés vides derrière un découpage
/// par rôle abandonné ; ils disparaissent avec cette tâche. Cadrage du plancher
/// V2, D2.
export const CHEMIN_TOURNEE_DU_JOUR = "/interventions/du-jour";

/// Les deux autres vues de l'espace technicien - `US-INTERVENTIONS-LISTER-TECH-
/// A-VENIR` et `US-INTERVENTIONS-LISTER-TECH-PASSEES`, promues en v1 le
/// 2026-08-12 et portées par T-V2-05.
///
/// ⚠️ **Les chemins suivent l'identifiant de l'US, pas le libellé de l'onglet.**
/// La maquette T1 nomme ses onglets « Cette semaine » et « Historique », et les
/// deux le restent à l'écran. Mais la règle du produit est celle qui a donné
/// `/mes-interventions/a-venir` à `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR` -
/// coïncidence de libellé côté client, qui avait masqué la règle. Argument qui
/// tranche : « semaine » deviendrait un mensonge dès `?jours=30`.
export const CHEMIN_TOURNEE_A_VENIR = "/interventions/a-venir";
export const CHEMIN_TOURNEE_PASSEES = "/interventions/passees";

/// Back-office - destination post-connexion de l'administrateur, livrée par
/// T-J0-05. Elle vivait en littéral dans `src/lib/auth/after-login.ts` ;
/// T-V2-05 l'amène ici parce que la navigation principale y pose une entrée, et
/// que cette navigation est calculée pour une feuille cliente.
export const CHEMIN_ADMIN_PARAMETRES = "/admin/parametres";

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
