import { ROLE_ADMIN, hasRole } from "./permissions";

/// Destination post-connexion selon le rôle — `US-COMPTE-CONNECTER` §Cas
/// nominal, DoD T-V3-03.
///
/// La SPEC nomme trois espaces : client `/mes-interventions/a-venir`,
/// technicien `/interventions/du-jour`, administrateur back-office. Un seul
/// existe. Les deux autres ne sont pas posés en coquilles vides — une route qui
/// répond 200 sans rien porter est la leçon T-T2-16 d'Argo — et l'accueil sert
/// de destination provisoire. **T-V3-10 porte la DoD finale côté client** ;
/// la destination du technicien suivra sa vague.
///
/// Avant cette tâche, la destination était `/admin/parametres` pour tout le
/// monde : un client fraîchement activé se connectait, puis se voyait refuser
/// l'accès par `requireAdmin()`.
export const AFTER_LOGIN_ADMIN = "/admin/parametres";
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
  return hasRole(roles, ROLE_ADMIN) ? AFTER_LOGIN_ADMIN : AFTER_LOGIN_DEFAULT;
}
