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

const { verifySession, getOptionalUser, getCurrentUser } =
  await import("./dal");

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

// ───────────────────────────────────────────────────────────────────────────
// `getOptionalUser` — ajoutée en T-V3-03, livrée SANS TEST. Ajouts de l'agent
// testeur.
//
// Elle n'est pas un doublon commode de `getCurrentUser` : c'est la seule
// lecture de session montée sur une surface **publique**
// (`src/app/(marketing)/page.tsx:36`, la destination post-connexion provisoire
// du client), et c'est ce qui alimente `AppHeader`. Trois propriétés portent
// donc plus lourd ici que sur son homologue redirigeant :
//
//   · elle NE redirige JAMAIS — un `redirect("/connexion")` glissé ici fermerait
//     l'accueil aux visiteurs anonymes, page que la Constitution §5.1 veut
//     ouverte à tous ;
//   · elle applique la MÊME révocation que `getCurrentUser` — sans quoi un
//     compte désactivé garderait son en-tête nominatif sur une page publique ;
//   · elle ferme le MÊME DTO — c'est la valeur qui descend jusqu'au rendu.
// ───────────────────────────────────────────────────────────────────────────
describe("getOptionalUser", () => {
  const EN_BASE = {
    id: "user-1",
    email: "camille@example.test",
    firstname: "Camille",
    lastname: "Durand",
    roles: ["ROLE_CLIENT"],
  };

  it("renvoie `null` sans session, sans rediriger ni interroger la base", async () => {
    readSessionToken.mockResolvedValue(null);

    await expect(getOptionalUser()).resolves.toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(findUserById).not.toHaveBeenCalled();
  });

  it("renvoie le DTO quand la session est utilisable", async () => {
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_CLIENT"],
    });
    findUserById.mockResolvedValue(EN_BASE);

    await expect(getOptionalUser()).resolves.toEqual(EN_BASE);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renvoie `null` — et ne redirige pas — sur un compte révoqué", async () => {
    // `findUserById` filtre `isActive: true` et `deletedAt: null`
    // (src/lib/db/queries/auth.ts:255). Un compte désactivé par un
    // administrateur ou pseudonymisé au titre du droit à l'oubli remonte donc
    // `null` alors que le JWT reste valide jusqu'à 7 jours.
    //
    // Sur `getCurrentUser` cet état produit une redirection ; ici il DOIT
    // produire `null`, sinon l'accueil public renverrait vers `/connexion`
    // toute personne portant un cookie périmé — y compris celle qui vient de
    // se faire fermer son compte, qui ne pourrait plus consulter le catalogue
    // que la Constitution §5.1 ouvre à tous.
    readSessionToken.mockResolvedValue({
      sub: "user-desactive",
      roles: ["ROLE_CLIENT"],
    });
    findUserById.mockResolvedValue(null);

    await expect(getOptionalUser()).resolves.toBeNull();
    expect(redirect).not.toHaveBeenCalled();
    expect(findUserById).toHaveBeenCalledWith("user-desactive");
  });

  it("préfère les rôles de la base à ceux du jeton", async () => {
    // Même exigence de fraîcheur que `getCurrentUser`. Elle compte aussi ici :
    // rien n'interdit à une surface publique de conditionner un affichage au
    // rôle, et le faire sur les rôles du JETON hériterait d'un retard de 7
    // jours sur toute rétrogradation.
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
    findUserById.mockResolvedValue({ ...EN_BASE, roles: ["ROLE_CLIENT"] });

    await expect(getOptionalUser()).resolves.toMatchObject({
      roles: ["ROLE_CLIENT"],
    });
  });

  it("ferme la projection quoi qu'ajoute le `select` de la requête", async () => {
    // Propriété générale, et non la forme d'un jeu de champs donné : c'est la
    // valeur qui descend jusqu'à `AppHeader`, sur une page servie à des
    // visiteurs anonymes. Un passe-plat de l'entité Prisma y ferait fuir le
    // hash du mot de passe dans la charge utile du rendu.
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_CLIENT"],
    });
    findUserById.mockResolvedValue({
      ...EN_BASE,
      passwordHash: "$2b$10$hash-qui-n-a-rien-a-faire-la",
      phone: "+33639980001",
      deletedAt: null,
      createdAt: new Date(),
    });

    const user = await getOptionalUser();

    expect(Object.keys(user ?? {}).sort()).toEqual([
      "email",
      "firstname",
      "id",
      "lastname",
      "roles",
    ]);
    expect(JSON.stringify(user)).not.toContain("$2b$10$");
  });

  it("ne mémoïse pas au-delà de la requête", async () => {
    // Même garde que pour les deux autres lectures : une mémoïsation au niveau
    // du module vivrait aussi longtemps que le processus Next et servirait la
    // session du premier visiteur à tous les suivants. Le risque est PLUS
    // grand ici — c'est la seule des trois montée sur une page publique, donc
    // la plus sollicitée par des visiteurs distincts.
    readSessionToken.mockResolvedValue({
      sub: "user-1",
      roles: ["ROLE_CLIENT"],
    });
    findUserById.mockResolvedValue(EN_BASE);
    await getOptionalUser();

    readSessionToken.mockResolvedValue(null);

    await expect(getOptionalUser()).resolves.toBeNull();
    expect(readSessionToken).toHaveBeenCalledTimes(2);
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
