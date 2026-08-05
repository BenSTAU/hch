// @vitest-environment node
//
// Environnement Node et non jsdom : `jose` signe via WebCrypto et vérifie
// `payload instanceof Uint8Array`. Le `TextEncoder` de jsdom produit un
// Uint8Array d'un autre realm, dont l'`instanceof` échoue — la signature
// devient impossible alors que le code est correct. Le runtime réel de ce
// module est Node, l'environnement du test doit le refléter.
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env["SESSION_SECRET"] = "secret-de-test-au-moins-32-octets-long!!";

const store = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(store) }));

const { createSession, destroySession, readSessionToken, SESSION_COOKIE } =
  await import("./session");

beforeEach(() => vi.clearAllMocks());

describe("createSession", () => {
  it("pose le cookie avec les attributs exigés par ADR-005", async () => {
    await createSession("user-1", ["ROLE_ADMIN"]);

    expect(store.set).toHaveBeenCalledOnce();
    const [name, value, options] = store.set.mock.calls[0]!;

    expect(name).toBe(SESSION_COOKIE);
    expect(typeof value).toBe("string");
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 jours
    });
  });

  it("émet un JWT relisible qui porte l'identifiant et les rôles", async () => {
    await createSession("user-1", ["ROLE_ADMIN", "ROLE_TECH"]);
    const token = store.set.mock.calls[0]![1] as string;

    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toEqual({
      sub: "user-1",
      roles: ["ROLE_ADMIN", "ROLE_TECH"],
    });
  });
});

describe("readSessionToken", () => {
  it("renvoie null en l'absence de cookie", async () => {
    store.get.mockReturnValue(undefined);
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("renvoie null sur un jeton dont la signature ne tient pas", async () => {
    await createSession("user-1", ["ROLE_ADMIN"]);
    const token = store.set.mock.calls[0]![1] as string;
    // Un caractère modifié dans la signature suffit à invalider le jeton.
    store.get.mockReturnValue({ value: `${token.slice(0, -1)}X` });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("renvoie null sur un jeton qui n'est pas un JWT", async () => {
    store.get.mockReturnValue({ value: "pas.un.jwt" });
    await expect(readSessionToken()).resolves.toBeNull();
  });
});

describe("destroySession", () => {
  it("supprime le cookie de session", async () => {
    await destroySession();
    expect(store.delete).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});
