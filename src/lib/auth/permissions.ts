import "server-only";

import { forbidden } from "next/navigation";

import { getCurrentUser, type CurrentUser } from "./dal";

/// Les trois rôles de la v1 (CLAUDE.md §Authentication, PLAN S1 §7.1). Ils
/// vivent dans `users.roles` en `VARCHAR[]`, pas en ENUM Postgres.
export const ROLE_ADMIN = "ROLE_ADMIN";
export const ROLE_TECH = "ROLE_TECH";
export const ROLE_CLIENT = "ROLE_CLIENT";

export type Role = typeof ROLE_ADMIN | typeof ROLE_TECH | typeof ROLE_CLIENT;

/// Comparaison exacte, et c'est le point. Un `some(r => r.includes(role))`
/// ferait de `ROLE_ADMINISTRATIF` un administrateur, et une comparaison
/// insensible à la casse ferait de `role_admin` une élévation de privilège
/// exploitable dès qu'une écriture de `roles` échappe au seed.
export function hasRole(roles: readonly string[], role: Role): boolean {
  return roles.includes(role);
}

/// Garde de rôle des pages et des Server Actions d'administration.
///
/// Deux échecs distincts, et les confondre serait un défaut :
///   · pas de session → `getCurrentUser` redirige vers `/connexion` (DAL). Le
///     visiteur peut réparer en se connectant.
///   · session valide, rôle insuffisant → **403**, pas une page vide et pas
///     une redirection. Se reconnecter n'y changerait rien, et une page vide
///     laisserait croire à un bug (DoD T-J0-05 : « un refus, pas une page
///     vide »).
///
/// `forbidden()` interrompt le rendu par un throw et pose `noindex` de
/// lui-même. Il exige `experimental.authInterrupts` dans `next.config.ts`
/// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/forbidden.md).
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!hasRole(user.roles, ROLE_ADMIN)) forbidden();
  return user;
}
