// @vitest-environment node
//
// Server Action de connexion. C'est le seul point où les trois couches se
// rencontrent : validation Zod, authentification, pose de session. Rappel
// d'ADR-006 v2 repris dans `src/lib/safe-action.ts` — **une Server Action
// exportée est un endpoint POST public**, donc appelable avec n'importe quelle
// charge utile, y compris celles qu'aucun formulaire n'enverrait.
import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateWithPassword = vi.fn();
vi.mock("@/lib/auth/authenticate", () => ({
  authenticateWithPassword: (email: string, password: string) =>
    authenticateWithPassword(email, password),
}));

const createSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  createSession: (userId: string, roles: string[]) =>
    createSession(userId, roles),
}));

// `redirect()` de Next fonctionne par throw, et next-safe-action ne relance une
// interruption de framework que si elle porte un `digest` de la bonne forme —
// sans quoi elle est absorbée en `serverError`. Le mock reproduit les deux
// moitiés du contrat : il enregistre la destination ET lève avec un digest
// conforme. Un mock qui se contenterait d'enregistrer laisserait passer un code
// qui continue son exécution après la redirection.
const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;push;${url};307;`,
  });
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

// Le module de quota reste RÉEL pour ses constantes et sa fonction de clé — ce
// sont elles que l'orchestration doit employer, et les dupliquer ici ferait un
// second oracle. Seules ses trois fonctions d'accès sont remplacées, et le
// client Prisma qu'il importe est neutralisé pour que rien ne parte vers le
// tunnel.
vi.mock("@/lib/db/client", () => ({ db: {} }));

// Le quota vit dans son propre module (`src/lib/rate-limit.ts`, PLAN S4 §11) et
// il est testé là-bas. Ici, ce qui compte est l'ORCHESTRATION : quand il est
// lu, quand il est alimenté, et ce que l'action fait de son verdict.
const peekRateLimit = vi.fn();
const recordRateLimitAttempt = vi.fn();
const clearRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  peekRateLimit: (...args: unknown[]) => peekRateLimit(...args),
  recordRateLimitAttempt: (...args: unknown[]) =>
    recordRateLimitAttempt(...args),
  clearRateLimit: (...args: unknown[]) => clearRateLimit(...args),
}));

const { login } = await import("./login");
const { LOGIN_REFUSED_MESSAGE, LOGIN_RATE_LIMITED_MESSAGE } =
  await import("@/lib/validations/auth");

const CREDENTIALS = {
  email: "admin@homecyclhome.fr",
  password: "bon-mot-de-passe",
};

/// Destination de l'ADMINISTRATEUR depuis T-V3-03 — c'était celle de tout le
/// monde depuis T-J0-05, ce qui déposait un client fraîchement activé sur le
/// 403 de `requireAdmin()`. Les identifiants de ce fichier portent un compte
/// `ROLE_ADMIN`, la destination par rôle est couverte plus bas.
const DEFAULT_DESTINATION = "/admin/parametres";

beforeEach(() => {
  vi.clearAllMocks();
  // Quota disponible par défaut : les tests qui ne parlent pas du plafond ne
  // doivent pas dépendre de son état.
  peekRateLimit.mockResolvedValue({ allowed: true });
});

describe("login — refus", () => {
  it("renvoie le message générique et ne pose aucune session", async () => {
    authenticateWithPassword.mockResolvedValue({ ok: false });

    const result = await login(CREDENTIALS);

    expect(result?.data).toEqual({ error: LOGIN_REFUSED_MESSAGE });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("n'ouvre aucun autre canal que `data.error`", async () => {
    // `serverError` et `validationErrors` sont deux canaux distincts de
    // next-safe-action. Un refus qui emprunterait l'un d'eux serait
    // distinguable d'un refus normal côté navigateur, même à message égal.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    const result = await login(CREDENTIALS);

    expect(result?.serverError).toBeUndefined();
    expect(result?.validationErrors).toBeUndefined();
    expect(Object.keys(result?.data ?? {})).toEqual(["error"]);
  });

  it("ne réfléchit jamais le mot de passe soumis dans sa réponse", async () => {
    authenticateWithPassword.mockResolvedValue({ ok: false });

    const result = await login({
      email: "admin@homecyclhome.fr",
      password: "ceci-est-un-secret-reconnaissable",
    });

    expect(JSON.stringify(result)).not.toContain(
      "ceci-est-un-secret-reconnaissable",
    );
  });
});

describe("login — succès", () => {
  it("pose la session avec l'identifiant et les rôles issus de la base", async () => {
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "user-1", roles: ["ROLE_ADMIN"] },
    });

    await login(CREDENTIALS).catch(() => undefined); // redirect() lève

    expect(createSession).toHaveBeenCalledWith("user-1", ["ROLE_ADMIN"]);
  });

  it("redirige, et la redirection n'est pas absorbée en erreur serveur", async () => {
    // Si next-safe-action confondait le throw de `redirect()` avec une erreur
    // applicative, `handleServerError` le convertirait en `{ serverError }` et
    // l'utilisateur resterait sur le formulaire, connecté mais sans le savoir.
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "user-1", roles: ["ROLE_ADMIN"] },
    });

    await expect(login(CREDENTIALS)).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});

describe("login — entrées hostiles", () => {
  it("refuse une charge utile sans email ni mot de passe sans toucher à la base", async () => {
    const result = await login({ email: "", password: "" });

    expect(result?.validationErrors).toBeDefined();
    expect(authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("refuse un email mal formé sans toucher à la base", async () => {
    const result = await login({ email: "pas-un-email", password: "x" });

    expect(result?.validationErrors).toBeDefined();
    expect(authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("transmet l'email NORMALISÉ à l'authentification, pas la saisie brute", async () => {
    // `validations/auth.test.ts` prouve que le schéma transforme ; celui-ci
    // prouve que la transformation ARRIVE jusqu'à la recherche en base. Un
    // schéma qui normalise dans son coin ne sert à rien si l'action lit la
    // valeur brute plutôt que `parsedInput`.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login({
      email: "Admin@HomeCyclHome.FR",
      password: "bon-mot-de-passe",
    });

    expect(authenticateWithPassword).toHaveBeenCalledWith(
      "admin@homecyclhome.fr",
      "bon-mot-de-passe",
    );
  });

  it("ne normalise pas le mot de passe", async () => {
    // Un `.toLowerCase()` appliqué par erreur au mot de passe amputerait
    // l'espace de recherche et invaliderait tous les hashs portant une
    // majuscule.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login({ email: "admin@homecyclhome.fr", password: "MoTdEpAsSe-42" });

    expect(authenticateWithPassword).toHaveBeenCalledWith(
      "admin@homecyclhome.fr",
      "MoTdEpAsSe-42",
    );
  });

  it("ignore les champs surnuméraires — les rôles ne se soumettent pas", async () => {
    // Élévation de privilège par affectation de masse : on POSTe des rôles
    // avec les identifiants. Le schéma les écarte, et la session est posée
    // avec les rôles LUS EN BASE.
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "user-1", roles: ["ROLE_CLIENT"] },
    });

    const hostile = {
      ...CREDENTIALS,
      roles: ["ROLE_ADMIN"],
      isActive: true,
    } as unknown as typeof CREDENTIALS;

    await login(hostile).catch(() => undefined);

    expect(createSession).toHaveBeenCalledWith("user-1", ["ROLE_CLIENT"]);
    expect(authenticateWithPassword).toHaveBeenCalledWith(
      CREDENTIALS.email,
      CREDENTIALS.password,
    );
  });
});

describe("destination post-connexion", () => {
  // `src/proxy.ts` pose `?next=<chemin>` sur sa redirection. La valeur est donc
  // contrôlée par l'attaquant et atterrit dans un `redirect()` : c'est la
  // définition de l'open redirect. Un lien portant le vrai domaine, servant la
  // vraie page et encaissant une vraie connexion dépose ensuite l'utilisateur
  // ailleurs.

  beforeEach(() => {
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", roles: ["ROLE_ADMIN"] },
    });
  });

  describe("destination acceptée", () => {
    it("suit un `next` interne", async () => {
      await login({
        ...CREDENTIALS,
        next: "/admin/parametres?onglet=societe",
      }).catch(() => undefined);

      expect(redirect).toHaveBeenCalledWith("/admin/parametres?onglet=societe");
    });

    it("retombe sur la destination par défaut sans `next`", async () => {
      await login(CREDENTIALS).catch(() => undefined);

      expect(redirect).toHaveBeenCalledWith(DEFAULT_DESTINATION);
    });
  });

  describe("`next` hostile", () => {
    // Un `next` refusé ne doit pas faire échouer la connexion : elle a réussi.
    // Il est ignoré au profit de la destination par défaut.
    const HOSTILES = [
      "https://phishing.example",
      "//phishing.example",
      "/\\phishing.example",
      "/%2Fphishing.example",
      "javascript:alert(1)",
      "admin/parametres",
    ];

    for (const next of HOSTILES) {
      it(`ignore \`${next}\` et redirige vers la destination par défaut`, async () => {
        await login({ ...CREDENTIALS, next }).catch(() => undefined);

        expect(redirect).toHaveBeenCalledWith(DEFAULT_DESTINATION);
      });
    }

    it("ne redirige jamais hors du site, quelle que soit la forme", async () => {
      for (const next of HOSTILES) {
        redirect.mockClear();
        await login({ ...CREDENTIALS, next }).catch(() => undefined);
        const [destination] = redirect.mock.calls[0] ?? [];
        expect(destination).toMatch(/^\/[^/\\]/);
      }
    });

    it("n'ouvre pas la redirection à un échec de connexion", async () => {
      // Le `next` n'est consommé qu'APRÈS authentification. Sans cela, la page
      // de connexion serait un redirecteur ouvert utilisable sans compte.
      authenticateWithPassword.mockResolvedValue({ ok: false });

      await login({ ...CREDENTIALS, next: "/admin/parametres" });

      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("selon le rôle", () => {
    // DoD T-V3-03, reportée de T-V3-02. Les destinations métier de la SPEC
    // n'existent pas encore : le client et le technicien vont à l'accueil,
    // T-V3-10 porte la DoD finale côté client.
    it("dépose le client sur l'accueil, pas sur le back-office", async () => {
      authenticateWithPassword.mockResolvedValue({
        ok: true,
        user: { id: "client-1", roles: ["ROLE_CLIENT"] },
      });

      await login(CREDENTIALS).catch(() => undefined);

      expect(redirect).toHaveBeenCalledWith("/");
    });

    it("dépose le technicien sur l'accueil", async () => {
      authenticateWithPassword.mockResolvedValue({
        ok: true,
        user: { id: "tech-1", roles: ["ROLE_TECH"] },
      });

      await login(CREDENTIALS).catch(() => undefined);

      expect(redirect).toHaveBeenCalledWith("/");
    });

    it("laisse `next` primer sur la destination de rôle", async () => {
      // La personne demandait une page précise avant d'être renvoyée au
      // formulaire par `src/proxy.ts`. La lui rendre est tout l'objet du
      // paramètre.
      authenticateWithPassword.mockResolvedValue({
        ok: true,
        user: { id: "client-1", roles: ["ROLE_CLIENT"] },
      });

      await login({ ...CREDENTIALS, next: "/client/mes-velos" }).catch(
        () => undefined,
      );

      expect(redirect).toHaveBeenCalledWith("/client/mes-velos");
    });
  });
});

describe("login — plafond d'échecs", () => {
  // 5 échecs / 15 min par email, fenêtre glissante (SPEC §285-287, PLAN S4
  // §11.1). Reporté de T-J0-04 : le leurre bcrypt ferme la fuite
  // d'INFORMATION, pas celle de DÉBIT — sans plafond, un attaquant garde le
  // droit d'essayer sans fin.

  it("refuse la 6ᵉ tentative sans même vérifier le mot de passe", async () => {
    peekRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 120_000 });

    const result = await login(CREDENTIALS);

    expect(result?.data).toMatchObject({ error: LOGIN_RATE_LIMITED_MESSAGE });
    expect(authenticateWithPassword).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("signale le blocage au formulaire, pour qu'il puisse fermer la porte", async () => {
    // « bloqué front ET serveur » (SPEC §287). Le serveur refuse ; le drapeau
    // est ce qui permet au formulaire de ne pas laisser marteler le bouton.
    peekRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 120_000 });

    const result = await login(CREDENTIALS);

    expect(result?.data?.blocked).toBe(true);
  });

  it("lit le quota sur la clé `login:` de l'email normalisé", async () => {
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login({ ...CREDENTIALS, email: "Admin@HomeCyclHome.FR" });

    expect(peekRateLimit).toHaveBeenCalledWith(
      "login:admin@homecyclhome.fr",
      5,
      15 * 60 * 1000,
    );
  });

  it("enregistre une tentative APRÈS un échec, pas avant", async () => {
    // Décompter à l'entrée ferait tomber le plafond sur les connexions
    // réussies : cinq connexions légitimes dans le quart d'heure — un
    // technicien qui change d'appareil — bloqueraient le compte.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login(CREDENTIALS);

    expect(recordRateLimitAttempt).toHaveBeenCalledWith(
      "login:admin@homecyclhome.fr",
    );
  });

  it("n'enregistre rien quand la tentative est déjà refusée par le plafond", async () => {
    peekRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 120_000 });

    await login(CREDENTIALS);

    expect(recordRateLimitAttempt).not.toHaveBeenCalled();
  });

  it("purge le compteur après une connexion réussie", async () => {
    // Quatre erreurs de frappe suivies du bon mot de passe ne doivent pas
    // laisser quatre tentatives armées pour le quart d'heure suivant.
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "user-1", roles: ["ROLE_CLIENT"] },
    });

    await login(CREDENTIALS).catch(() => undefined);

    expect(clearRateLimit).toHaveBeenCalledWith("login:admin@homecyclhome.fr");
    expect(recordRateLimitAttempt).not.toHaveBeenCalled();
  });

  it("compte pour un email qui ne correspond à aucun compte", async () => {
    // DoD T-V3-03 : sans ça, « trop de tentatives » ne s'afficherait que pour
    // les comptes existants et redeviendrait l'oracle d'énumération que le
    // durcissement à temps constant de T-J0-04 a fermé.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login({ email: "personne@example.test", password: "peu-importe" });

    expect(peekRateLimit).toHaveBeenCalledWith(
      "login:personne@example.test",
      5,
      15 * 60 * 1000,
    );
    expect(recordRateLimitAttempt).toHaveBeenCalledWith(
      "login:personne@example.test",
    );
  });

  it("affiche le même blocage que le compte existe ou non", async () => {
    peekRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 120_000 });

    const connu = await login(CREDENTIALS);
    const inconnu = await login({
      email: "personne@example.test",
      password: "peu-importe",
    });

    expect(connu?.data).toEqual(inconnu?.data);
  });

  it("ne divulgue pas le délai restant dans le message", async () => {
    // Le message de la SPEC est « réessayez dans quelques minutes ». Un délai
    // à la seconde dirait quand la première des cinq tentatives a eu lieu,
    // donc l'activité d'un tiers sur cette adresse.
    peekRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 421_000 });

    const result = await login(CREDENTIALS);

    expect(JSON.stringify(result?.data)).not.toContain("421");
  });
});
