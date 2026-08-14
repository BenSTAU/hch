/// Chemins d'application partagés entre le serveur et le navigateur.
///
/// **Module pur** : aucun import, aucun `server-only`, aucune dépendance. C'est
/// sa raison d'être - un composant client qui importerait un module marqué
/// `server-only` ferait échouer le build, et ces chemins sont exactement ce que
/// les deux côtés partagent.
///
/// ⚠️ Ne rien mettre ici qui ne soit **qu'**une chaîne. Ce module est importé
/// par du code client : tout ce qu'il exporte part dans le paquet envoyé au
/// navigateur.
///
/// ⚠️ **Un chemin porte l'identifiant de son US, pas le libellé de son écran.**
/// « Cette semaine » mène à `/interventions/a-venir` parce que l'US s'appelle
/// `US-INTERVENTIONS-LISTER-TECH-A-VENIR` : un libellé change, une US non.
///
/// Historique des arbitrages de chemin : TASKS, tâche par tâche.

/// Espace client - `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR`, écran C8, et
/// destination post-connexion du client ([[module-1-utilisateurs]] §287).
export const CHEMIN_ESPACE_CLIENT = "/mes-interventions/a-venir";

/// Historique - `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`, écran C10.
export const CHEMIN_ESPACE_CLIENT_PASSEES = "/mes-interventions/passees";

/// Tournée du jour - `US-INTERVENTIONS-LISTER-TECH-DU-JOUR`, écran T1, et
/// destination post-connexion du `ROLE_TECH` ([[module-1-utilisateurs]] §250).
///
/// ⚠️ Ne pas déplacer sous `/tech/` : `src/proxy.ts` matche ce préfixe, et le
/// produit n'a qu'une racine par espace (cadrage du plancher V2, D2).
export const CHEMIN_TOURNEE_DU_JOUR = "/interventions/du-jour";

/// Les deux autres vues de l'espace technicien -
/// `US-INTERVENTIONS-LISTER-TECH-A-VENIR` et `-PASSEES`, promues en v1 le
/// 2026-08-12.
export const CHEMIN_TOURNEE_A_VENIR = "/interventions/a-venir";
export const CHEMIN_TOURNEE_PASSEES = "/interventions/passees";

/// Détail d'une intervention - `US-INTERVENTION-AFFICHER`, écran T2.
///
/// ⚠️ **Sous le même préfixe que les trois vues, pas sous `/tech/`.** La SPEC
/// écrit `/tech/interventions/<id>` : deux racines pour un même espace, ce que
/// l'arbitrage `/mon-compte` du 2026-08-11 a évité côté client et ce que D2 du
/// cadrage du plancher V2 tranche ici.
///
/// Une fonction et non une constante, parce que le chemin porte un identifiant.
/// Elle reste **pure** au sens de ce module : une chaîne entre, une chaîne sort.
export function cheminIntervention(id: number): string {
  return `/interventions/${String(id)}`;
}

/// Back-office - destination post-connexion de l'administrateur (T-J0-05).
export const CHEMIN_ADMIN_PARAMETRES = "/admin/parametres";

/// Racine de l'espace « compte ». **Une seule racine par espace** : c'est ce
/// préfixe que T-V3-07 reprendra pour la fiche client, pas `/profil`.
export const CHEMIN_COMPTE = "/mon-compte";

/// Mes vélos - `US-CYCLES-LISTER`, écran C11.
///
/// ⚠️ **Sous `/mon-compte`, mais cloisonné à l'espace client**, contrairement à
/// `/mon-compte/supprimer` juste dessous. Le critère n'est pas le préfixe :
/// une surface qui relève du **fait d'avoir un compte** reste ouverte à tous
/// les rôles, une surface qui relève du **fait d'être client** ne l'est pas.
/// Le droit à l'oubli est le premier, une liste de vélos le second. Constitution
/// §3.1 amendée en ce sens le 2026-08-14.
export const CHEMIN_CYCLES = "/mon-compte/cycles";

/// Droit à l'oubli - `US-COMPTE-SUPPRIMER`.
///
/// ⚠️ Route **autonome**, et c'est une propriété : `US-RGPD` y mène depuis la
/// politique de confidentialité, donc le parcours survit à la suppression de
/// T-V3-07. Ne pas la rendre dépendante d'un écran.
export const CHEMIN_SUPPRESSION_COMPTE = "/mon-compte/supprimer";

/// Retour après pseudonymisation - `US-COMPTE-SUPPRIMER` §Cas nominal. Le
/// message voyage dans l'URL parce qu'il n'y a plus de session à ce moment-là.
export const CHEMIN_COMPTE_SUPPRIME = "/?compte=supprime";
