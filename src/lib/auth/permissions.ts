import "server-only";

import { forbidden } from "next/navigation";

import { ROLE_ADMIN, ROLE_TECH, hasRole } from "./roles";
import { getCurrentUser, type CurrentUser } from "./dal";

/// Gardes de rôle. Le vocabulaire (`ROLE_*`, `hasRole`) vit dans `./roles`, qui
/// est pur : ce module-ci est `server-only` parce qu'il lit la session.
///
/// Les trois gardes distinguent **deux échecs** qu'il ne faut pas confondre :
/// pas de session, et `getCurrentUser` redirige vers `/connexion` ; session
/// valide mais rôle insuffisant, et c'est **403** - se reconnecter n'y
/// changerait rien, et une page vide laisserait croire à un bug.
///
/// `forbidden()` interrompt le rendu par un throw, pose `noindex`, fonctionne
/// aussi en Server Action, et exige `experimental.authInterrupts`
/// (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/forbidden.md).

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!hasRole(user.roles, ROLE_ADMIN)) forbidden();
  return user;
}

/// ⚠️ **Un administrateur sans `ROLE_TECH` reçoit 403**, et ce n'est pas une
/// interprétation : `US-INTERVENTIONS-LISTER-TECH-DU-JOUR` §Cas d'erreur écrit
/// « client **ou admin sans rôle tech** … 403 ». La vision transverse de
/// l'administration est une autre US, un autre écran.
export async function requireTech(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!hasRole(user.roles, ROLE_TECH)) forbidden();
  return user;
}

/// Garde de l'espace client - `/mes-interventions/*`, écrans **C8** et **C10**.
///
/// ⚠️ **Garde NÉGATIVE, et ce n'est pas un raccourci.** Elle refuse `ROLE_TECH`
/// et `ROLE_ADMIN` au lieu d'exiger `ROLE_CLIENT` : sous la formulation
/// positive, un compte aux rôles vides ou porteur d'un rôle ajouté demain
/// perdrait l'accès à son propre historique.
///
/// ⚠️ Le cloisonnement porte sur les **espaces de travail**, pas sur les routes
/// transverses : `/mon-compte/*` et `/reserver` restent ouverts à tous les
/// rôles, et deux tests figent chacun de ces deux points.
///
/// Motif complet dans Constitution §3.1, clarification datée du 2026-08-12 et
/// son tableau des surfaces.
export async function requireEspaceClient(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (hasRole(user.roles, ROLE_TECH) || hasRole(user.roles, ROLE_ADMIN)) {
    forbidden();
  }
  return user;
}
