// @vitest-environment node
//
// Garde de rôle. PLAN S1 §7.1 pose deux niveaux et un seul fait autorité :
// `src/proxy.ts` redirige de façon optimiste sur la présence d'un cookie, la
// **vérification réelle** vit ici et dans la DAL. CLAUDE.md §Authentication le
// redit — *la page protège ≠ l'action protège*.
//
// Ce que ces tests exigent : un porteur de `ROLE_CLIENT` ou `ROLE_TECH` reçoit
// un **refus**, pas une page vide (DoD T-J0-05), et l'absence de session ne se
// confond pas avec un rôle insuffisant.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("./dal", () => ({ getCurrentUser: () => getCurrentUser() }));

const forbidden = vi.fn(() => {
  throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
});
vi.mock("next/navigation", () => ({ forbidden: () => forbidden() }));

const { hasRole, requireAdmin, ROLE_ADMIN, ROLE_CLIENT, ROLE_TECH } =
  await import("./permissions");

const ADMIN = {
  id: "admin-1",
  email: "admin@homecyclhome.fr",
  firstname: "Admin",
  lastname: "Principal",
  roles: [ROLE_ADMIN],
};

beforeEach(() => vi.clearAllMocks());

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

  it("compare exactement — pas de préfixe, pas de casse tolérée", () => {
    // Un `includes()` sur une chaîne concaténée, ou une comparaison
    // insensible à la casse, transformerait `ROLE_ADMINISTRATIF` ou
    // `role_admin` en passe-droit.
    expect(hasRole(["ROLE_ADMINISTRATIF"], ROLE_ADMIN)).toBe(false);
    expect(hasRole(["role_admin"], ROLE_ADMIN)).toBe(false);
    expect(hasRole([" ROLE_ADMIN"], ROLE_ADMIN)).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("laisse passer un administrateur et renvoie son DTO", async () => {
    getCurrentUser.mockResolvedValue(ADMIN);

    await expect(requireAdmin()).resolves.toEqual(ADMIN);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("refuse un client par un 403, pas par une page vide", async () => {
    getCurrentUser.mockResolvedValue({ ...ADMIN, roles: [ROLE_CLIENT] });

    await expect(requireAdmin()).rejects.toThrow();
    expect(forbidden).toHaveBeenCalledOnce();
  });

  it("refuse un technicien", async () => {
    getCurrentUser.mockResolvedValue({ ...ADMIN, roles: [ROLE_TECH] });

    await expect(requireAdmin()).rejects.toThrow();
    expect(forbidden).toHaveBeenCalledOnce();
  });

  it("refuse un compte sans aucun rôle", async () => {
    getCurrentUser.mockResolvedValue({ ...ADMIN, roles: [] });

    await expect(requireAdmin()).rejects.toThrow();
    expect(forbidden).toHaveBeenCalledOnce();
  });

  it("laisse la DAL décider quand il n'y a pas de session", async () => {
    // `getCurrentUser` redirige vers /connexion quand la session manque
    // (src/lib/auth/dal.ts). Absence de session et rôle insuffisant sont deux
    // situations distinctes : la première se répare en se connectant, la
    // seconde non. Les confondre en 403 enfermerait un visiteur anonyme.
    getCurrentUser.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
    expect(forbidden).not.toHaveBeenCalled();
  });
});
