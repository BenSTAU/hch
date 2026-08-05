// @vitest-environment node
//
// Même contrainte que `session.test.ts`, et vérifiée ici avant d'être reprise :
// sous jsdom, `jose` lève `TypeError: payload must be an instance of
// Uint8Array` dans `FlattenedSign` (jose@6.2.8/webapi/jws/flattened/sign.js:9).
// Le `TextEncoder` global de jsdom appartient à un autre realm que le
// `Uint8Array` global de Node, l'`instanceof` de jose échoue. Rien du code
// applicatif n'est en cause — `session.ts` porte `import "server-only"` en
// ligne 1 et ne s'exécute jamais dans un navigateur.
//
// Tests adversariaux du jeton de session — ajoutés par l'agent testeur.
//
// `session.test.ts` couvre le cas nominal et trois refus évidents. Ce fichier
// couvre ce qu'un attaquant essaie réellement : forger, rejouer, tronquer,
// élever ses privilèges en réécrivant la charge utile, et faire accepter un
// jeton non signé.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, UnsecuredJWT } from "jose";

const SECRET = "secret-de-test-au-moins-32-octets-long!!";
process.env["SESSION_SECRET"] = SECRET;

const store = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(store) }));

const { createSession, readSessionToken } = await import("./session");

const now = () => Math.floor(Date.now() / 1000);

/// Fabrique un jeton signé avec la clé de notre choix et la charge utile de
/// notre choix — ce que `createSession` ne permet pas, et c'est justement ce
/// dont on a besoin pour attaquer.
async function forge(
  payload: Record<string, unknown>,
  options: { secret?: string; exp?: number; nbf?: number } = {},
) {
  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(options.nbf ?? now());
  if (options.exp !== undefined) jwt = jwt.setExpirationTime(options.exp);
  if (options.nbf !== undefined) jwt = jwt.setNotBefore(options.nbf);
  return jwt.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

beforeEach(() => vi.clearAllMocks());

describe("readSessionToken — jetons forgés et rejoués", () => {
  it("refuse un jeton expiré", async () => {
    const token = await forge({ roles: ["ROLE_ADMIN"] }, { exp: now() - 3600 });
    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("refuse un jeton signé avec une autre clé", async () => {
    const token = await forge(
      { sub: "user-1", roles: ["ROLE_ADMIN"] },
      {
        secret: "une-tout-autre-clef-de-32-octets-au-moins!!",
        exp: now() + 60,
      },
    );
    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("refuse un jeton non signé (alg: none)", async () => {
    // L'attaque canonique contre une vérification JWT trop permissive : on
    // retire la signature et on annonce `alg: none`. Une bibliothèque qui
    // fait confiance à l'en-tête accepte le jeton.
    const unsecured = new UnsecuredJWT({ roles: ["ROLE_ADMIN"] })
      .setSubject("user-1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .encode();
    store.get.mockReturnValue({ value: unsecured });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("refuse un jeton dont la charge utile a été réécrite sous une signature valide", async () => {
    // Élévation de privilège : on part d'un jeton légitime de client, on
    // remplace la charge utile par la même avec ROLE_ADMIN, et on garde la
    // signature d'origine.
    await createSession("user-1", ["ROLE_CLIENT"]);
    const legit = store.set.mock.calls[0]![1] as string;
    const [header, , signature] = legit.split(".");

    const escalated = Buffer.from(
      JSON.stringify({ sub: "user-1", roles: ["ROLE_ADMIN"], exp: now() + 60 }),
    ).toString("base64url");

    store.get.mockReturnValue({ value: `${header}.${escalated}.${signature}` });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("refuse un jeton dont le `nbf` est dans le futur", async () => {
    const token = await forge(
      { sub: "user-1", roles: ["ROLE_ADMIN"] },
      { nbf: now() + 3600, exp: now() + 7200 },
    );
    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("refuse une chaîne vide dans le cookie", async () => {
    store.get.mockReturnValue({ value: "" });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("refuse HS384 et HS512 — l'algorithme est épinglé sur HS256", async () => {
    // INVERSÉ après durcissement. Ce test constatait l'inverse : jusqu'au
    // correctif, `jwtVerify(token, secret())` était appelé sans option
    // `algorithms`, et jose acceptait alors tout algorithme compatible avec la
    // clé — les trois HMAC — alors que `createSession` n'émet que du HS256.
    // La surface acceptée était plus large que la surface émise.
    //
    // `src/lib/auth/session.ts:67-69` pose désormais
    // `{ algorithms: ["HS256"] }`. Les deux surfaces coïncident.
    //
    // Ce n'a jamais été l'attaque de confusion d'algorithme classique
    // (RS256 → HS256), qui suppose une clé asymétrique — il n'y en a pas ici,
    // et il faut de toute façon le secret pour signer. C'était un durcissement
    // OWASP (« always pin the algorithm »), pas une faille exploitable.
    for (const alg of ["HS384", "HS512"] as const) {
      const token = await new SignJWT({ roles: ["ROLE_ADMIN"] })
        .setProtectedHeader({ alg })
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(SECRET));

      store.get.mockReturnValue({ value: token });
      await expect(readSessionToken()).resolves.toBeNull();
    }
  });

  it("accepte toujours le HS256 que `createSession` émet", async () => {
    // Contrepartie indispensable de l'épinglage : une liste d'algorithmes trop
    // étroite — ou mal orthographiée — refuserait TOUTES les sessions, y
    // compris les légitimes. Le symptôme serait une boucle de redirection vers
    // `/connexion` que rien ne distingue d'un cookie absent.
    await createSession("user-1", ["ROLE_ADMIN"]);
    const token = store.set.mock.calls[0]![1] as string;

    const header = JSON.parse(
      Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
    ) as { alg: string };
    expect(header.alg).toBe("HS256");

    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toEqual({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
  });
});

describe("readSessionToken — charge utile mal formée", () => {
  it("refuse un jeton sans `sub`", async () => {
    const token = await forge({ roles: ["ROLE_ADMIN"] }, { exp: now() + 60 });
    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("refuse un jeton dont `roles` n'est pas un tableau", async () => {
    const token = await forge(
      { sub: "user-1", roles: "ROLE_ADMIN" },
      { exp: now() + 60 },
    );
    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("refuse un jeton sans `roles` du tout", async () => {
    const token = await forge({ sub: "user-1" }, { exp: now() + 60 });
    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("écarte silencieusement les entrées non textuelles de `roles`", async () => {
    const token = await forge(
      { sub: "user-1", roles: ["ROLE_ADMIN", 42, null, { r: "ROLE_TECH" }] },
      { exp: now() + 60 },
    );
    store.get.mockReturnValue({ value: token });
    await expect(readSessionToken()).resolves.toEqual({
      sub: "user-1",
      roles: ["ROLE_ADMIN"],
    });
  });

  it("refuse un `sub` vide", async () => {
    // INVERSÉ après durcissement. Ce test constatait l'inverse : le garde
    // s'écrivait `typeof sub !== "string"`, et la chaîne vide est une chaîne.
    // Un jeton de `sub: ""` passait donc la vérification et remontait à
    // `getCurrentUser`, qui appelait `findUserById("")` sur une colonne
    // `@db.Uuid` (prisma/schema.prisma:39) : Postgres rejette la valeur
    // (22P02) et l'erreur partait en 500 là où une redirection est attendue.
    //
    // `src/lib/auth/session.ts:76` teste désormais `sub.length === 0`.
    // Ce ne fut jamais exploitable — il faut la clé de signature pour émettre
    // un tel jeton, et `createSession` n'est appelée qu'avec un `id` venu de
    // la base. C'était de la robustesse, refermée au bon endroit.
    const token = await forge({ sub: "", roles: [] }, { exp: now() + 60 });
    store.get.mockReturnValue({ value: token });

    await expect(readSessionToken()).resolves.toBeNull();
  });

  it("accepte un `sub` non vide qui n'est pas un UUID", async () => {
    // Borne haute du garde, pour qu'il ne dérive pas vers une validation de
    // FORMAT. `readSessionToken` n'a pas à savoir à quoi ressemble un
    // identifiant : c'est `findUserById` qui ne trouve rien, et la DAL
    // redirige (src/lib/auth/dal.ts:39-40). Un garde qui vérifierait l'UUID
    // ici dupliquerait une connaissance du modèle dans la couche jeton.
    const token = await forge(
      { sub: "user-1", roles: ["ROLE_CLIENT"] },
      { exp: now() + 60 },
    );
    store.get.mockReturnValue({ value: token });

    await expect(readSessionToken()).resolves.toEqual({
      sub: "user-1",
      roles: ["ROLE_CLIENT"],
    });
  });

  it("ne remonte que `sub` et `roles`, jamais les revendications surnuméraires", async () => {
    // Un jeton forgé par une version future du code, ou par un composant
    // tiers, pourrait porter des revendications supplémentaires. La DAL ne
    // doit exposer que ce qu'elle a promis dans `SessionPayload`.
    const token = await forge(
      {
        sub: "user-1",
        roles: ["ROLE_CLIENT"],
        email: "victime@homecyclhome.fr",
        isAdmin: true,
      },
      { exp: now() + 60 },
    );
    store.get.mockReturnValue({ value: token });
    const payload = await readSessionToken();
    expect(Object.keys(payload ?? {}).sort()).toEqual(["roles", "sub"]);
  });
});

describe("createSession — contenu du jeton émis", () => {
  it("n'écrit aucune donnée personnelle dans la charge utile", async () => {
    // Le cookie est `httpOnly`, mais le JWT n'est pas chiffré : quiconque met
    // la main dessus (log, proxy, sauvegarde de navigateur) lit sa charge
    // utile en clair. Elle ne doit donc porter que l'identifiant opaque et
    // les rôles — ni email, ni nom, ni téléphone.
    await createSession("user-1", ["ROLE_ADMIN"]);
    const token = store.set.mock.calls[0]![1] as string;
    const body = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["exp", "iat", "roles", "sub"]);
  });

  it("aligne l'expiration du jeton sur le `maxAge` du cookie", async () => {
    // Deux durées de 7 jours écrites à deux endroits : si l'une dérive, on
    // obtient soit un cookie qui survit à un jeton mort (redirections en
    // boucle), soit un jeton qui survit au cookie (session perdue sans
    // raison).
    await createSession("user-1", ["ROLE_ADMIN"]);
    const [, token, options] = store.set.mock.calls[0]! as [
      string,
      string,
      { maxAge: number },
    ];
    const body = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    ) as { iat: number; exp: number };

    expect(body.exp - body.iat).toBe(options.maxAge);
  });
});

describe("readSessionToken — secret absent", () => {
  it("renvoie null au lieu de lever quand SESSION_SECRET a disparu", async () => {
    // Comportement constaté, documenté ici pour qu'un changement soit visible.
    // `secret()` lève, mais l'appel est DANS le try de `readSessionToken` :
    // l'exception est absorbée et la session devient simplement invalide.
    // Fail-closed, donc sûr — mais silencieux, là où `createSession` échoue
    // bruyamment sur la même cause.
    await createSession("user-1", ["ROLE_ADMIN"]);
    const token = store.set.mock.calls[0]![1] as string;
    store.get.mockReturnValue({ value: token });

    const saved = process.env["SESSION_SECRET"];
    try {
      delete process.env["SESSION_SECRET"];
      await expect(readSessionToken()).resolves.toBeNull();
    } finally {
      process.env["SESSION_SECRET"] = saved;
    }
  });

  it("lève à la création de session quand SESSION_SECRET a disparu", async () => {
    const saved = process.env["SESSION_SECRET"];
    try {
      delete process.env["SESSION_SECRET"];
      await expect(createSession("user-1", ["ROLE_ADMIN"])).rejects.toThrow(
        /SESSION_SECRET/,
      );
      expect(store.set).not.toHaveBeenCalled();
    } finally {
      process.env["SESSION_SECRET"] = saved;
    }
  });
});
