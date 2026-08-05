// Révocation et fraîcheur des rôles — ajoutés par l'agent testeur.
//
// `dal.test.ts` couvre la redirection et la forme du DTO. Ce fichier couvre la
// question que la DAL tranche sans la nommer : **combien de temps une décision
// d'administration met-elle à produire son effet ?** Un JWT de 7 jours porte
// une photographie des rôles ; la base porte leur état courant. Les deux
// fonctions de la DAL ne lisent pas la même source, et l'écart est le sujet.
import { beforeEach, describe, expect, it, vi } from "vitest";

const readSessionToken = vi.fn();
vi.mock("./session", () => ({ readSessionToken: () => readSessionToken() }));

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

describe("verifySession — ce qu'elle ne vérifie pas", () => {
  it("n'interroge jamais la base", async () => {
    // Constat, pas reproche : `verifySession` est le contrôle bon marché,
    // rejouable dans chaque composant serveur. Mais la conséquence doit être
    // explicite — voir le test suivant.
    readSessionToken.mockResolvedValue({ sub: "user-1", roles: ["ROLE_TECH"] });

    await verifySession();

    expect(findUserById).not.toHaveBeenCalled();
  });

  it("renvoie les rôles du JETON, donc potentiellement périmés", async () => {
    // Scénario : un administrateur rétrograde un technicien. Le jeton du
    // technicien, lui, porte encore ROLE_TECH pendant 7 jours au maximum.
    // Toute garde d'autorisation bâtie sur `verifySession().roles` héritera
    // de ce délai.
    //
    // CLAUDE.md §Authentication impose la « vérification réelle du rôle dans
    // chaque Server Action […] via src/lib/auth/permissions.ts » — module qui
    // n'existe pas encore au HEAD courant. Ce test fixe la propriété AVANT
    // qu'il soit écrit, pour que sa source de vérité soit un choix conscient.
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });

    const session = await verifySession();

    expect(session.roles).toEqual(["ROLE_ADMIN"]);
    expect(findUserById).not.toHaveBeenCalled();
  });
});

describe("getCurrentUser — révocation effective", () => {
  it("préfère les rôles de la base à ceux du jeton", async () => {
    // C'est la propriété qui rend la révocation possible. Un appelant qui
    // passe par `getCurrentUser` voit l'état courant ; un appelant qui se
    // contente de `verifySession` voit l'état d'il y a 7 jours.
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
    findUserById.mockResolvedValue({
      id: "user-1",
      email: "ancien-admin@homecyclhome.fr",
      firstname: "Ancien",
      lastname: "Admin",
      roles: ["ROLE_CLIENT"],
    });

    const user = await getCurrentUser();

    expect(user.roles).toEqual(["ROLE_CLIENT"]);
  });

  it("coupe la session d'un compte désactivé depuis l'émission du jeton", async () => {
    // `findUserById` filtre sur `isActive: true`
    // (src/lib/db/queries/auth.ts:32) : un compte désactivé remonte `null`,
    // donc redirection. Le soft-delete administrateur produit bien une
    // déconnexion, sans attendre l'expiration du jeton.
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
    findUserById.mockResolvedValue(null);

    await expect(getCurrentUser()).rejects.toThrow("NEXT_REDIRECT:/connexion");
  });

  it("coupe la session d'un compte pseudonymisé", async () => {
    // Même mécanique via le filtre `deletedAt: null`. Le droit à l'oubli
    // (Constitution §4.1) ne doit pas laisser une session ouverte derrière
    // lui.
    readSessionToken.mockResolvedValue({
      sub: "user-oublie",
      roles: ["ROLE_CLIENT"],
    });
    findUserById.mockResolvedValue(null);

    await expect(getCurrentUser()).rejects.toThrow("NEXT_REDIRECT:/connexion");
    expect(findUserById).toHaveBeenCalledWith("user-oublie");
  });

  it("ne recopie jamais un champ ajouté au `select` de la requête", async () => {
    // `dal.test.ts` vérifie déjà la forme du DTO sur un jeu de champs donné.
    // Celui-ci vérifie la propriété générale : quoi qu'ajoute demain le
    // `select` de `findUserById`, la projection de la DAL reste fermée.
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
      passwordHash: "$2b$10$hash-qui-n-a-rien-a-faire-la",
      resetToken: "jeton-secret",
      phone: "+33639980001",
    });

    const user = await getCurrentUser();

    expect(Object.keys(user).sort()).toEqual([
      "email",
      "firstname",
      "id",
      "lastname",
      "roles",
    ]);
    expect(JSON.stringify(user)).not.toContain("$2b$10$");
  });
});
