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

describe("portée de `cache()` — la mémoïsation ne franchit pas la requête", () => {
  // Vérifier la déduplication passerait aussi avec une mémoïsation maison au
  // niveau du module — et celle-là serait une faille : le module vit aussi
  // longtemps que le processus Next, donc un `Map` module-level servirait la
  // session du premier utilisateur à tous les suivants. On vérifie donc
  // l'inverse de l'intuition : hors scope de requête React, AUCUNE mémoïsation.
  describe("verifySession — la mémoïsation ne franchit pas la requête", () => {
    it("relit le jeton à chaque appel hors scope de requête React", async () => {
      // Deux appels successifs = deux requêtes distinctes, du point de vue de
      // ce test. Si le compteur restait à 1, la valeur serait retenue quelque
      // part au-delà de la requête, et la session d'un utilisateur pourrait
      // être servie à un autre.
      readSessionToken.mockResolvedValue({
        sub: "user-1",
        roles: ["ROLE_TECH"],
      });
      await verifySession();

      readSessionToken.mockResolvedValue({
        sub: "user-2",
        roles: ["ROLE_ADMIN"],
      });
      const seconde = await verifySession();

      expect(readSessionToken).toHaveBeenCalledTimes(2);
      expect(seconde.sub).toBe("user-2");
    });

    it("ne retient pas une redirection passée", async () => {
      // Symétrique du précédent : une absence de session mémorisée
      // interdirait de se connecter sans redémarrer le serveur.
      readSessionToken.mockResolvedValue(null);
      await expect(verifySession()).rejects.toThrow("NEXT_REDIRECT:/connexion");

      readSessionToken.mockResolvedValue({ sub: "user-1", roles: [] });
      await expect(verifySession()).resolves.toEqual({
        sub: "user-1",
        roles: [],
      });
    });
  });

  describe("getCurrentUser — la mémoïsation ne franchit pas la requête", () => {
    const dbUser = (id: string, roles: string[]) => ({
      id,
      email: `${id}@homecyclhome.fr`,
      firstname: "Prénom",
      lastname: "Nom",
      roles,
    });

    it("réinterroge la base à chaque appel hors scope de requête React", async () => {
      readSessionToken.mockResolvedValue({
        sub: "user-1",
        roles: ["ROLE_ADMIN"],
      });
      findUserById.mockResolvedValue(dbUser("user-1", ["ROLE_ADMIN"]));
      await getCurrentUser();

      readSessionToken.mockResolvedValue({
        sub: "user-2",
        roles: ["ROLE_CLIENT"],
      });
      findUserById.mockResolvedValue(dbUser("user-2", ["ROLE_CLIENT"]));
      const seconde = await getCurrentUser();

      expect(findUserById).toHaveBeenCalledTimes(2);
      expect(seconde.id).toBe("user-2");
    });

    it("voit immédiatement une rétrogradation appliquée en base", async () => {
      // Conséquence directe de l'absence de cache trans-requête : révoquer un
      // rôle prend effet au rendu suivant, pas à l'expiration du jeton.
      readSessionToken.mockResolvedValue({
        sub: "user-1",
        roles: ["ROLE_ADMIN"],
      });

      findUserById.mockResolvedValue(dbUser("user-1", ["ROLE_ADMIN"]));
      expect((await getCurrentUser()).roles).toEqual(["ROLE_ADMIN"]);

      findUserById.mockResolvedValue(dbUser("user-1", ["ROLE_CLIENT"]));
      expect((await getCurrentUser()).roles).toEqual(["ROLE_CLIENT"]);
    });
  });
});

describe("révocation et fraîcheur des rôles", () => {
  // Un JWT de 7 jours porte une photographie des rôles, la base porte leur état
  // courant. `verifySession` lit le jeton, `getCurrentUser` lit la base : c'est
  // cet écart qui décide du délai avant qu'une décision d'administration
  // produise son effet.
  describe("verifySession — ce qu'elle ne vérifie pas", () => {
    it("n'interroge jamais la base", async () => {
      // Constat, pas reproche : `verifySession` est le contrôle bon marché,
      // rejouable dans chaque composant serveur. Mais la conséquence doit être
      // explicite — voir le test suivant.
      readSessionToken.mockResolvedValue({
        sub: "user-1",
        roles: ["ROLE_TECH"],
      });

      await verifySession();

      expect(findUserById).not.toHaveBeenCalled();
    });

    it("renvoie les rôles du JETON, donc potentiellement périmés", async () => {
      // Scénario : un administrateur rétrograde un technicien. Le jeton du
      // technicien, lui, porte encore ROLE_TECH pendant 7 jours au maximum.
      // Toute garde d'autorisation bâtie sur `verifySession().roles` héritera
      // de ce délai.
      //
      // C'est pourquoi `src/lib/auth/permissions.ts` bâtit `requireAdmin` sur
      // `getCurrentUser` et non sur `verifySession` : la garde de rôle lit la
      // base, pas le jeton.
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

      await expect(getCurrentUser()).rejects.toThrow(
        "NEXT_REDIRECT:/connexion",
      );
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

      await expect(getCurrentUser()).rejects.toThrow(
        "NEXT_REDIRECT:/connexion",
      );
      expect(findUserById).toHaveBeenCalledWith("user-oublie");
    });

    it("ne recopie jamais un champ ajouté au `select` de la requête", async () => {
      // Le bloc `getCurrentUser` plus haut vérifie la forme du DTO sur un jeu
      // de champs donné. Celui-ci vérifie la propriété générale : quoi
      // qu'ajoute demain le `select` de `findUserById`, la projection reste
      // fermée.
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
});
