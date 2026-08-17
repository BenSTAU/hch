/// Vocabulaire des rôles - les trois valeurs et la seule façon de les comparer.
///
/// **Module pur**, sans `server-only`, et c'est sa raison d'être : ces
/// constantes vivaient dans `permissions.ts`, que son `server-only` rend
/// inimportable depuis une feuille cliente comme `site-nav-mobile.tsx`. Rien
/// ici ne lit la session ni ne décide d'une autorisation, la décision restant
/// dans `permissions.ts`. Même motif que `src/lib/routes.ts`.
///
/// ⚠️ Aucun réexport depuis `permissions.ts` : deux chemins d'import pour un
/// même symbole finissent par désigner deux valeurs différentes.

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
