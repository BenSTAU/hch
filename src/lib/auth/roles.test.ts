// @vitest-environment node
//
// Vocabulaire des rôles. Ces tests vivaient dans `permissions.test.ts` jusqu'à
// T-V2-05, qui a extrait `roles.ts` pour que `navigationPrincipale()` puisse
// comparer un rôle sans faire entrer `server-only` dans une feuille cliente.
// Un module, un fichier de test (CLAUDE.md §Testing).
//
// Ce que `hasRole` garantit tient en une phrase : la comparaison est EXACTE.
// C'est la seule ligne du produit qui sépare un compte ordinaire d'un
// administrateur, et elle n'a aucune dépendance - ni session, ni base.
import { describe, expect, it } from "vitest";

import { ROLE_ADMIN, ROLE_CLIENT, ROLE_TECH, hasRole } from "./roles";

describe("hasRole", () => {
  it("reconnaît un rôle porté", () => {
    expect(hasRole([ROLE_ADMIN], ROLE_ADMIN)).toBe(true);
  });

  it("refuse un rôle absent", () => {
    expect(hasRole([ROLE_CLIENT, ROLE_TECH], ROLE_ADMIN)).toBe(false);
  });

  it("refuse une liste de rôles vide", () => {
    expect(hasRole([], ROLE_ADMIN)).toBe(false);
  });

  it("compare exactement - pas de préfixe, pas de casse tolérée", () => {
    // Un `includes()` sur une chaîne concaténée, ou une comparaison
    // insensible à la casse, transformerait `ROLE_ADMINISTRATIF` ou
    // `role_admin` en passe-droit.
    expect(hasRole(["ROLE_ADMINISTRATIF"], ROLE_ADMIN)).toBe(false);
    expect(hasRole(["role_admin"], ROLE_ADMIN)).toBe(false);
    expect(hasRole([" ROLE_ADMIN"], ROLE_ADMIN)).toBe(false);
  });

  it("porte les trois valeurs que `users.roles` accepte", () => {
    // Le seed et `creerUtilisateur` écrivent ces chaînes-là. Une faute de
    // frappe dans une constante ne se verrait qu'au premier refus en
    // production, la comparaison étant exacte par construction.
    expect([ROLE_ADMIN, ROLE_TECH, ROLE_CLIENT]).toEqual([
      "ROLE_ADMIN",
      "ROLE_TECH",
      "ROLE_CLIENT",
    ]);
  });
});
