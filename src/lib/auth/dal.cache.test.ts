// Portée du `cache()` de la DAL — ajouté par l'agent testeur.
//
// La DoD de T-J0-04 exige `verifySession` et `getCurrentUser` « tous deux
// wrappés dans `cache()` de React ». Un test qui se contenterait de vérifier
// la déduplication passerait aussi avec une mémoïsation maison au niveau du
// module — et celle-là serait une faille : le module vit aussi longtemps que
// le processus Next, donc un `Map` module-level servirait la session du
// premier utilisateur à tous les suivants.
//
// Ce qu'on vérifie ici est donc l'inverse de l'intuition : **hors d'un scope
// de requête React, il ne doit y avoir AUCUNE mémoïsation**. C'est la
// signature observable du `cache()` de React (dont le dispatcher est nul hors
// rendu) et c'est exactement ce qu'un `memoize()` maison ne ferait pas.
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

describe("verifySession — la mémoïsation ne franchit pas la requête", () => {
  it("relit le jeton à chaque appel hors scope de requête React", async () => {
    // Deux appels successifs = deux requêtes distinctes, du point de vue de
    // ce test. Si le compteur restait à 1, la valeur serait retenue quelque
    // part au-delà de la requête, et la session d'un utilisateur pourrait
    // être servie à un autre.
    readSessionToken.mockResolvedValue({ sub: "user-1", roles: ["ROLE_TECH"] });
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
