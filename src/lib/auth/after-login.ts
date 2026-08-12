import { CHEMIN_ESPACE_CLIENT, CHEMIN_TOURNEE_DU_JOUR } from "@/lib/routes";

import { ROLE_ADMIN, ROLE_TECH, hasRole } from "./permissions";

/// Destination post-connexion selon le rôle — `US-COMPTE-CONNECTER` §Cas
/// nominal ([[module-1-utilisateurs]] §287).
///
/// La SPEC nomme trois espaces : client `/mes-interventions/a-venir`,
/// technicien `/interventions/du-jour`, administrateur back-office. **Les trois
/// existent depuis T-V2-01**, qui livre la tournée du jour ; T-V3-10 avait
/// livré l'espace client.
///
/// Avant T-V3-03, la destination était `/admin/parametres` pour tout le monde :
/// un client fraîchement activé se connectait, puis se voyait refuser l'accès
/// par `requireAdmin()`.
export const AFTER_LOGIN_ADMIN = "/admin/parametres";
/// Réexporté depuis `src/lib/routes.ts`, seul module que le navigateur peut
/// aussi importer : le menu utilisateur et l'écran de confirmation du tunnel
/// visent la même destination, et une seconde copie du littéral finirait par
/// diverger.
export const AFTER_LOGIN_CLIENT = CHEMIN_ESPACE_CLIENT;
/// Réexporté depuis `src/lib/routes.ts` pour la même raison que la destination
/// client : l'écran T1 et le menu utilisateur visent le même chemin.
export const AFTER_LOGIN_TECH = CHEMIN_TOURNEE_DU_JOUR;
/// Repli des rôles inconnus. Il ne sert plus de destination à aucun rôle nommé
/// depuis que le technicien a son écran.
export const AFTER_LOGIN_DEFAULT = "/";

/// Destination de la **sortie** de session — `US-COMPTE-DECONNECTER` : « je
/// suis redirigé vers la page publique d'accueil ». La SPEC nuançait selon le
/// rôle précédent ; ce rôle n'est plus lisible une fois la session détruite, et
/// la DoD T-V3-03 tranche une destination unique.
///
/// Le paramètre porte le message de confirmation attendu par la SPEC. Il est
/// dans l'URL et non en cookie : rien à nettoyer, et la page reste partageable
/// sans effet de bord.
///
/// Elle vit **ici et non dans `src/lib/actions/auth/logout.ts`** : un fichier
/// `"use server"` ne peut exporter que des fonctions asynchrones, et Next
/// refuse le build sur une constante exportée. Sa place naturelle est de toute
/// façon auprès des destinations d'entrée.
export const AFTER_LOGOUT = "/?deconnecte=1";

export function afterLoginPath(roles: readonly string[]): string {
  // Le rôle le plus large gagne : `users.roles` est un tableau, et rien
  // n'interdit à un administrateur de porter aussi ROLE_TECH. Se fier au
  // premier élément ferait dépendre la destination de l'ordre d'insertion.
  //
  // `hasRole` compare exactement — `ROLE_ADMINISTRATIF` n'est pas un
  // administrateur, `role_admin` non plus.
  if (hasRole(roles, ROLE_ADMIN)) return AFTER_LOGIN_ADMIN;

  // Le technicien AVANT le client, et l'ordre compte : sans cette ligne, un
  // technicien qui porte aussi ROLE_CLIENT tomberait dans le repli ci-dessous
  // et verrait la liste de ses propres rendez-vous **en tant que client**, pas
  // sa tournée.
  if (hasRole(roles, ROLE_TECH)) return AFTER_LOGIN_TECH;

  return AFTER_LOGIN_CLIENT;
}
