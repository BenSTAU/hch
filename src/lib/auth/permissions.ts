import "server-only";

import { forbidden } from "next/navigation";

import { ROLE_ADMIN, ROLE_TECH, hasRole } from "./roles";
import { getCurrentUser, type CurrentUser } from "./dal";

/// Gardes de rôle. Le vocabulaire (`ROLE_*`, `hasRole`) vit dans `./roles`, qui
/// est pur : ce module-ci est `server-only` parce qu'il lit la session, et un
/// composant client qui importerait les constantes par ici casserait le build.

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

/// Garde de rôle de l'espace technicien - symétrique exacte de `requireAdmin`.
///
/// Ce module ne portait que la garde admin jusqu'à T-V2-01, et l'espace client
/// n'en a délibérément aucune : y être connecté suffit, la page filtre sur
/// `clientId = user.id`. Le technicien est le premier rôle depuis l'admin à
/// exiger un contrôle, parce que sa tournée expose le **nom et le téléphone de
/// clients tiers** (cadrage du plancher V2, D6) - un client qui atteindrait
/// cette page lirait le carnet d'adresses d'un autre.
///
/// ⚠️ **Un administrateur sans `ROLE_TECH` reçoit 403**, et ce n'est pas une
/// interprétation : `US-INTERVENTIONS-LISTER-TECH-DU-JOUR` §Cas d'erreur écrit
/// « Given je ne suis pas technicien (client **ou admin sans rôle tech**) …
/// Then je reçois 403 ». La vision transverse de l'administration est
/// `US-INTERVENTIONS-LISTER-ADMIN`, un autre écran. Un compte portant les deux
/// rôles passe, comme n'importe quel technicien - la tournée est de toute façon
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

/// Garde de l'espace client - `/mes-interventions/*`, écrans **C8** et **C10**.
///
/// ── Une garde NÉGATIVE, et ce n'est pas un raccourci
///
/// Elle refuse `ROLE_TECH` et `ROLE_ADMIN` au lieu d'exiger `ROLE_CLIENT`, et
/// les deux formulations ne sont pas équivalentes : un compte aux rôles vides,
/// ou porteur d'un rôle qu'on ajouterait demain, perdrait l'accès à son propre
/// historique sous la formulation positive. Ce que la Constitution demande est
/// que les deux **espaces de travail** ne se chevauchent pas, pas qu'une carte
/// de membre soit présentée à l'entrée.
///
/// ── Ce qu'elle change, et depuis quand
///
/// L'espace client n'avait **aucune** garde de rôle, délibérément, et le
/// commentaire des deux pages invoquait Constitution §3.1 pour le justifier.
/// C'était la lecture **étroite** de l'axiome, celle du paragraphe *Conséquence
/// technique* qui ne parle que des prérogatives structurantes. La **première
/// phrase** pose « trois rôles exclusifs … avec des parcours dédiés », et c'est
/// cette lecture-là qui fait foi depuis la clarification datée du 2026-08-12
/// (Constitution §3.1, tableau des surfaces).
///
/// ⚠️ **Le cloisonnement porte sur les espaces, pas sur les routes
/// transverses.** `/mon-compte/*` reste ouvert à tous les rôles - le droit à
/// l'oubli est un droit de toute personne fichée, pas un parcours client - et
/// `/reserver` aussi, Constitution §3.2 voulant le tunnel explorable sans
/// compte. Deux tests figent chacun de ces deux points.
///
/// Conséquence assumée : un technicien qui aurait réservé pour lui-même perd
/// l'accès à ce rendez-vous. C'est le prix de l'exclusivité des rôles.
export async function requireEspaceClient(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (hasRole(user.roles, ROLE_TECH) || hasRole(user.roles, ROLE_ADMIN)) {
    forbidden();
  }
  return user;
}
