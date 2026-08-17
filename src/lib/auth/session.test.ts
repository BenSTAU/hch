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

    // ⚠️ Mutation du PREMIER caractère de la signature, jamais du dernier.
    // Une signature HS256 fait 256 bits pour 43 caractères base64url, soit
    // 258 : les deux bits de poids faible du dernier caractère ne codent RIEN,
    // et le muter est sans effet une fois sur seize. Les deux sondes plus bas
    // rendent le diagnostic vérifiable.
    const [header, payload, signature] = token.split(".") as [
      string,
      string,
      string,
    ];
    const premier = signature.startsWith("A") ? "B" : "A";
    store.get.mockReturnValue({
      value: `${header}.${payload}.${premier}${signature.slice(1)}`,
    });

    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("renvoie null sur un jeton qui n'est pas un JWT", async () => {
    store.get.mockReturnValue({ value: "pas.un.jwt" });
    await expect(readSessionToken()).resolves.toBeNull();
  });
});

// Sondes du padding base64url : elles démontrent pourquoi le test ci-dessus
// mute le PREMIER caractère de la signature. Remplacer le dernier ne change
// les octets que 60 fois sur 64, et dans les 4 autres cas le jeton reste
// valide - `readSessionToken` a alors raison de l'accepter.

const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Renvoie un jeton textuellement différent dont la signature se décode vers
/// LES MÊMES octets : seuls les deux bits morts du dernier caractère changent.
function jumeauDeSignature(token: string): string {
  const [header, payload, signature] = token.split(".") as [
    string,
    string,
    string,
  ];
  const index = BASE64URL.indexOf(signature.at(-1)!);
  const jumeau = BASE64URL[(index & 0b111100) | (((index & 0b11) + 1) % 4)]!;

  return `${header}.${payload}.${signature.slice(0, -1)}${jumeau}`;
}

describe("readSessionToken — pourquoi le test de signature est intermittent", () => {
  it("accepte une réécriture du dernier caractère qui ne change aucun octet", async () => {
    await createSession("user-1", ["ROLE_ADMIN"]);
    const token = store.set.mock.calls[0]![1] as string;
    const jumeau = jumeauDeSignature(token);

    // Deux chaînes différentes, une seule signature.
    expect(jumeau).not.toBe(token);

    store.get.mockReturnValue({ value: jumeau });
    await expect(readSessionToken()).resolves.toEqual({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
  });

  it("refuse une signature dont un octet a réellement changé", async () => {
    // Le PREMIER caractère de la signature porte 6 bits utiles : le modifier
    // est toujours une vraie mutation. C'est la forme que devrait prendre le
    // test intermittent.
    await createSession("user-1", ["ROLE_ADMIN"]);
    const token = store.set.mock.calls[0]![1] as string;
    const [header, payload, signature] = token.split(".") as [
      string,
      string,
      string,
    ];
    const premier = signature[0] === "A" ? "B" : "A";

    store.get.mockReturnValue({
      value: `${header}.${payload}.${premier}${signature.slice(1)}`,
    });
    await expect(readSessionToken()).resolves.toBeNull();
  });
});

describe("destroySession", () => {
  it("supprime le cookie de session", async () => {
    await destroySession();
    expect(store.delete).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});
