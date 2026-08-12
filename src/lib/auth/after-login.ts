import {
  CHEMIN_ADMIN_PARAMETRES,
  CHEMIN_ESPACE_CLIENT,
  CHEMIN_TOURNEE_DU_JOUR,
} from "@/lib/routes";

import { ROLE_ADMIN, ROLE_TECH, hasRole } from "./roles";

/// Destinations post-connexion - `US-COMPTE-CONNECTER` §Cas nominal
/// ([[module-1-utilisateurs]] §287).
///
/// Les trois sont **réexportées** de `src/lib/routes.ts` et non redéclarées :
/// le menu utilisateur, la navigation et l'écran de confirmation du tunnel
/// visent les mêmes chemins, et deux littéraux qui doivent rester égaux
/// finissent par diverger.
export const AFTER_LOGIN_ADMIN = CHEMIN_ADMIN_PARAMETRES;
export const AFTER_LOGIN_CLIENT = CHEMIN_ESPACE_CLIENT;
export const AFTER_LOGIN_TECH = CHEMIN_TOURNEE_DU_JOUR;

/// Repli des rôles inconnus, qui ne sert plus aucun rôle nommé.
export const AFTER_LOGIN_DEFAULT = "/";

/// Sortie de session - `US-COMPTE-DECONNECTER`. Le message voyage dans l'URL et
/// non en cookie : rien à nettoyer, et la page reste partageable.
///
/// ⚠️ Ici et non dans `actions/auth/logout.ts` : un fichier `"use server"` ne
/// peut exporter que des fonctions asynchrones, Next refuse le build sinon.
export const AFTER_LOGOUT = "/?deconnecte=1";

/// ⚠️ **Le rôle le plus large gagne, et l'ordre de ces trois lignes EST la
/// règle.** `users.roles` est un tableau : un technicien qui porte aussi
/// `ROLE_CLIENT` doit atterrir sur sa tournée, pas sur l'espace client. Se fier
/// au premier élément ferait dépendre la destination de l'ordre d'insertion.
///
/// `navigationPrincipale()` reprend cet ordre, et un test relie les deux.
export function afterLoginPath(roles: readonly string[]): string {
  if (hasRole(roles, ROLE_ADMIN)) return AFTER_LOGIN_ADMIN;
  if (hasRole(roles, ROLE_TECH)) return AFTER_LOGIN_TECH;

  return AFTER_LOGIN_CLIENT;
}
