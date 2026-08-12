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

/// Garde de rôle de l'espace technicien — symétrique exacte de `requireAdmin`.
///
/// Ce module ne portait que la garde admin jusqu'à T-V2-01, et l'espace client
/// n'en a délibérément aucune : y être connecté suffit, la page filtre sur
/// `clientId = user.id`. Le technicien est le premier rôle depuis l'admin à
/// exiger un contrôle, parce que sa tournée expose le **nom et le téléphone de
/// clients tiers** (cadrage du plancher V2, D6) — un client qui atteindrait
/// cette page lirait le carnet d'adresses d'un autre.
///
/// ⚠️ **Un administrateur sans `ROLE_TECH` reçoit 403**, et ce n'est pas une
/// interprétation : `US-INTERVENTIONS-LISTER-TECH-DU-JOUR` §Cas d'erreur écrit
/// « Given je ne suis pas technicien (client **ou admin sans rôle tech**) …
/// Then je reçois 403 ». La vision transverse de l'administration est
/// `US-INTERVENTIONS-LISTER-ADMIN`, un autre écran. Un compte portant les deux
/// rôles passe, comme n'importe quel technicien — la tournée est de toute façon
/// bornée à `techId = user.id`.
///
/// `forbidden()` fonctionne aussi en Server Action
/// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/forbidden.md:235-237),
/// ce qui permet à `techActionClient` de réutiliser cette garde telle quelle
/// plutôt que d'en écrire une seconde qui pourrait diverger.
export async function requireTech(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!hasRole(user.roles, ROLE_TECH)) forbidden();
  return user;
}
