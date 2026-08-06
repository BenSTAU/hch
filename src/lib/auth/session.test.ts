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

    // Mutation du PREMIER caractère de la signature, pas du dernier.
    //
    // Règle du test rouge, 3ᵉ ligne : oracle incorrect, corrigé avec trace.
    // Ce test était **intermittent** — il a échoué pendant la vérification de
    // T-J0-05 sur un code d'authentification qui n'avait pas bougé. Il mutait
    // le dernier caractère, or une signature HS256 fait 32 octets = 256 bits
    // et son base64url 43 caractères = 258 bits : les deux bits de poids
    // faible du dernier caractère ne codent RIEN. Quatre caractères distincts
    // s'y décodent vers les mêmes octets, donc la mutation était sans effet
    // une fois sur seize environ, et le test échouait à ce rythme.
    //
    // Le premier caractère, lui, porte ses six bits. La mutation est
    // déterministe. Diagnostic établi par l'agent testeur, qui a laissé deux
    // sondes plus bas pour le rendre vérifiable au lieu de l'affirmer.
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

// ───────────────────────────────────────────────────────────────────────────
// Sondes ajoutées par l'agent testeur (T-J0-05).
//
// Le test « renvoie null sur un jeton dont la signature ne tient pas »
// ci-dessus est **intermittent** : il a échoué pendant la vérification de
// T-J0-05, sur un dépôt dont le code d'authentification n'a pas bougé.
//
// Cause, démontrée par les deux tests qui suivent : une signature HS256 fait
// 32 octets, soit 256 bits, et son encodage base64url fait 43 caractères, soit
// 258 bits. Les DEUX BITS DE POIDS FAIBLE du dernier caractère ne codent rien.
// Quatre caractères base64url distincts se décodent donc vers les mêmes
// octets, et remplacer le dernier caractère par `X` ne modifie la signature
// que 60 fois sur 64 — dans les 4 autres cas le jeton reste littéralement
// valide, et `readSessionToken` a raison de l'accepter.
//
// Ce n'est pas un défaut de `readSessionToken` : personne ne peut fabriquer
// une de ces variantes sans détenir déjà un jeton valide. C'est un défaut de
// construction du test, dont l'arrangement ne garantit pas la mutation qu'il
// annonce. L'agent testeur ne l'a PAS corrigé — il est hors du périmètre de
// T-J0-05 et sa réécriture appartient à la session principale. Ces deux
// sondes-ci rendent le diagnostic vérifiable au lieu d'affirmé.
// ───────────────────────────────────────────────────────────────────────────

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
