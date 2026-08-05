import { beforeEach, describe, expect, it, vi } from "vitest";

const findUserForLogin = vi.fn();
vi.mock("@/lib/db/queries/auth", () => ({
  findUserForLogin: (email: string) => findUserForLogin(email),
}));

const { authenticateWithPassword } = await import("./authenticate");
const { hashPassword } = await import("./password");

const HASH = await hashPassword("bon-mot-de-passe");

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    roles: ["ROLE_ADMIN"],
    isActive: true,
    authProviders: [{ provider: "local", passwordHash: HASH }],
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("authenticateWithPassword", () => {
  it("accepte des identifiants corrects sur un compte actif", async () => {
    findUserForLogin.mockResolvedValue(user());
    const result = await authenticateWithPassword(
      "admin@homecyclhome.fr",
      "bon-mot-de-passe",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe("11111111-1111-4111-8111-111111111111");
      expect(result.user.roles).toEqual(["ROLE_ADMIN"]);
    }
  });

  it("rejette un mauvais mot de passe", async () => {
    findUserForLogin.mockResolvedValue(user());
    const result = await authenticateWithPassword(
      "admin@homecyclhome.fr",
      "mauvais-mot-de-passe",
    );
    expect(result.ok).toBe(false);
  });

  it("rejette un email inconnu", async () => {
    findUserForLogin.mockResolvedValue(null);
    const result = await authenticateWithPassword(
      "inconnu@homecyclhome.fr",
      "bon-mot-de-passe",
    );
    expect(result.ok).toBe(false);
  });

  it("rejette un compte désactivé même avec le bon mot de passe", async () => {
    findUserForLogin.mockResolvedValue(user({ isActive: false }));
    const result = await authenticateWithPassword(
      "admin@homecyclhome.fr",
      "bon-mot-de-passe",
    );
    expect(result.ok).toBe(false);
  });

  it("rejette un compte sans provider local (OAuth pur)", async () => {
    findUserForLogin.mockResolvedValue(user({ authProviders: [] }));
    const result = await authenticateWithPassword(
      "admin@homecyclhome.fr",
      "bon-mot-de-passe",
    );
    expect(result.ok).toBe(false);
  });

  // Anti-énumération (Constitution §4.2, SPEC §6.1) : les quatre causes de
  // refus doivent être indiscernables de l'extérieur. Un appelant qui pourrait
  // distinguer « email inconnu » de « mot de passe faux » permettrait de
  // savoir quels comptes existent.
  it("renvoie un refus strictement identique quelle que soit la cause", async () => {
    const causes = [
      { label: "email inconnu", value: null },
      { label: "mauvais mot de passe", value: user() },
      { label: "compte désactivé", value: user({ isActive: false }) },
      { label: "sans provider local", value: user({ authProviders: [] }) },
    ];

    const results = [];
    for (const cause of causes) {
      findUserForLogin.mockResolvedValue(cause.value);
      results.push(
        await authenticateWithPassword(
          "admin@homecyclhome.fr",
          cause.label === "mauvais mot de passe" ? "faux" : "bon-mot-de-passe",
        ),
      );
    }

    for (const result of results) {
      expect(result).toEqual(results[0]);
    }
  });
});
