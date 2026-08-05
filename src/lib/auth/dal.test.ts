import { beforeEach, describe, expect, it, vi } from "vitest";

const readSessionToken = vi.fn();
vi.mock("./session", () => ({ readSessionToken: () => readSessionToken() }));

// `redirect()` de Next fonctionne par throw. On reproduit ce contrat : un test
// qui se contenterait de vérifier l'appel laisserait passer un code qui
// continue son exécution après la redirection.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

const findUserById = vi.fn();
vi.mock("@/lib/db/queries/auth", () => ({
  findUserById: (id: string) => findUserById(id),
}));

const { verifySession, getCurrentUser } = await import("./dal");

beforeEach(() => vi.clearAllMocks());

describe("verifySession", () => {
  it("redirige vers la connexion quand aucune session n'est présente", async () => {
    readSessionToken.mockResolvedValue(null);
    await expect(verifySession()).rejects.toThrow("NEXT_REDIRECT:/connexion");
    expect(redirect).toHaveBeenCalledWith("/connexion");
  });

  it("renvoie la charge utile quand la session est valide", async () => {
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
    await expect(verifySession()).resolves.toEqual({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("getCurrentUser", () => {
  it("redirige quand la session est absente, sans interroger la base", async () => {
    readSessionToken.mockResolvedValue(null);
    await expect(getCurrentUser()).rejects.toThrow("NEXT_REDIRECT:/connexion");
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("ne renvoie qu'un DTO, jamais l'entité complète", async () => {
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
    findUserById.mockResolvedValue({
      id: "user-1",
      email: "admin@homecyclhome.fr",
      firstname: "Admin",
      lastname: "Principal",
      roles: ["ROLE_ADMIN"],
      phone: "+33639980001",
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
    });

    const user = await getCurrentUser();

    // CLAUDE.md §Authentication : « MUST NOT renvoyer un objet User complet au
    // client — DTO ». Le téléphone et les horodatages n'ont rien à faire dans
    // ce qui traverse la frontière serveur/client.
    expect(user).toEqual({
      id: "user-1",
      email: "admin@homecyclhome.fr",
      firstname: "Admin",
      lastname: "Principal",
      roles: ["ROLE_ADMIN"],
    });
  });

  it("redirige quand la session désigne un utilisateur absent de la base", async () => {
    readSessionToken.mockResolvedValue({ sub: "fantome", roles: [] });
    findUserById.mockResolvedValue(null);
    await expect(getCurrentUser()).rejects.toThrow("NEXT_REDIRECT:/connexion");
  });
});
