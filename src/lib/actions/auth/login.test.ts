// @vitest-environment node
//
// Server Action de connexion. C'est le seul point où les trois couches se
// rencontrent : validation Zod, authentification, pose de session. Rappel
// d'ADR-006 v2 repris dans `src/lib/safe-action.ts` - **une Server Action
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
// interruption de framework que si elle porte un `digest` de la bonne forme -
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

// Le module de quota reste RÉEL pour ses constantes et sa fonction de clé - ce
// sont elles que l'orchestration doit employer, et les dupliquer ici ferait un
// second oracle. Seules ses trois fonctions d'accès sont remplacées, et le
// client Prisma qu'il importe est neutralisé pour que rien ne parte vers le
// tunnel.
vi.mock("@/lib/db/client", () => ({ db: {} }));

// Le quota vit dans son propre module (`src/lib/rate-limit.ts`, PLAN S4 §11) et
// il est testé là-bas. Ici, ce qui compte est l'ORCHESTRATION : quand il est
// lu, quand il est alimenté, et ce que l'action fait de son verdict.
const peekLoginLockout = vi.fn();
const recordRateLimitAttempt = vi.fn();
const clearRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  peekLoginLockout: (...args: unknown[]) => peekLoginLockout(...args),
  recordRateLimitAttempt: (...args: unknown[]) =>
    recordRateLimitAttempt(...args),
  clearRateLimit: (...args: unknown[]) => clearRateLimit(...args),
}));

// Trace `LOGIN`, ajoutée par T-V3-10 (migration 014, report de T-V3-03).
// ADR-005 §Flux la code littéralement, ADR-014 §5 en fait le lieu où `GP-01`
// la vérifie. Non mockée, elle atteindrait le client Prisma neutralisé
// ci-dessus et ferait échouer toute connexion en `serverError`.
const writeAuditLog = vi.fn();
vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: (entree: unknown) => writeAuditLog(entree),
  ENTITE_SESSION: "session",
}));

const { login, loginFormAction } = await import("./login");
const { LOGIN_REFUSED_MESSAGE, LOGIN_RATE_LIMITED_MESSAGE } =
  await import("@/lib/validations/auth");

const CREDENTIALS = {
  email: "admin@homecyclhome.fr",
  password: "bon-mot-de-passe",
};

/// Destination de l'ADMINISTRATEUR depuis T-V3-03 - c'était celle de tout le
/// monde depuis T-J0-05, ce qui déposait un client fraîchement activé sur le
/// 403 de `requireAdmin()`. Les identifiants de ce fichier portent un compte
/// `ROLE_ADMIN`, la destination par rôle est couverte plus bas.
const DEFAULT_DESTINATION = "/admin/parametres";

beforeEach(() => {
  vi.clearAllMocks();
  // Quota disponible par défaut : les tests qui ne parlent pas du plafond ne
  // doivent pas dépendre de son état.
  peekLoginLockout.mockResolvedValue({ allowed: true });
});

describe("login - refus", () => {
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

describe("login - succès", () => {
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

// DoD T-V3-10, reportée de T-V3-03 : la migration 014 étend l'ENUM
// `audit_logs.action`, et ces écritures sont ce qu'elle rend possible.
describe("login - audit de connexion", () => {
  it("trace la connexion sur la session, pas sur l'utilisateur", async () => {
    // `entity_type = 'session'`, comme ADR-005 l'écrit. Constitution §4.2 vise
    // « toute action ADMINISTRATIVE sensible » : une connexion n'en est pas
    // une, c'est un évènement de sécurité. Le corollaire tient toujours -
    // créer un compte n'est pas administrer, et T-V3-02 n'audite rien.
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "user-1", roles: ["ROLE_ADMIN"] },
    });

    await login(CREDENTIALS).catch(() => undefined);

    expect(writeAuditLog).toHaveBeenCalledWith({
      entityType: "session",
      entityId: "user-1",
      action: "LOGIN",
      actorId: "user-1",
    });
  });

  it("écrit la trace APRÈS avoir posé la session", async () => {
    // Une trace de connexion écrite pour une session qui n'a pas été créée est
    // un journal qui ment, et il n'y a pas de transaction ici pour rattraper
    // l'ordre inverse : le cookie n'est pas une écriture de base.
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "user-1", roles: ["ROLE_ADMIN"] },
    });

    await login(CREDENTIALS).catch(() => undefined);

    expect(createSession.mock.invocationCallOrder[0]).toBeLessThan(
      writeAuditLog.mock.invocationCallOrder[0]!,
    );
  });

  it("ne trace aucun échec", async () => {
    // `audit_logs.actor_id` est une vraie clé étrangère NOT NULL : une
    // tentative sur un email inconnu n'a pas d'acteur à nommer. Le plafond
    // d'échecs, lui, est déjà compté par `rate_limits` (PLAN S4 §11.1).
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login(CREDENTIALS).catch(() => undefined);

    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("ne trace rien quand le plafond d'échecs ferme la porte", async () => {
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 60_000,
    });

    await login(CREDENTIALS).catch(() => undefined);

    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(authenticateWithPassword).not.toHaveBeenCalled();
  });
});

describe("login - entrées hostiles", () => {
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

  it("ignore les champs surnuméraires - les rôles ne se soumettent pas", async () => {
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
    // ⚠️ **Oracle déplacé par T-V3-10**, qui livre l'espace client et porte donc
    // la DoD finale de la destination. T-V3-03 avait posé l'accueil en
    // provisoire, refusant de créer une coquille vide (leçon T-T2-16 d'Argo).
    // Le TECHNICIEN reste sur l'accueil : son espace n'existe toujours pas.
    it("dépose le client sur son espace, pas sur le back-office", async () => {
      authenticateWithPassword.mockResolvedValue({
        ok: true,
        user: { id: "client-1", roles: ["ROLE_CLIENT"] },
      });

      await login(CREDENTIALS).catch(() => undefined);

      expect(redirect).toHaveBeenCalledWith("/mes-interventions/a-venir");
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

describe("login - plafond d'échecs", () => {
  // 5 échecs par email, puis 10 minutes de blocage FERME (SPEC §298-300 amendée
  // le 2026-08-09, PLAN S4 §11.1). Reporté de T-J0-04 : le leurre bcrypt ferme
  // la fuite d'INFORMATION, pas celle de DÉBIT, et sans plafond un attaquant
  // garde le droit d'essayer sans fin.
  //
  // Les assertions de durée de ce bloc lisaient 15 min tant que la fenêtre
  // glissait. Leur oracle vient de la SPEC, et la SPEC a été amendée : c'est
  // l'exception écrite de la règle du test rouge, tracée dans la PR.

  it("refuse la 6ᵉ tentative sans même vérifier le mot de passe", async () => {
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 120_000,
    });

    const result = await login(CREDENTIALS);

    expect(result?.data).toMatchObject({ error: LOGIN_RATE_LIMITED_MESSAGE });
    expect(authenticateWithPassword).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("signale le blocage au formulaire, pour qu'il puisse fermer la porte", async () => {
    // « bloqué front ET serveur » (SPEC §287). Le serveur refuse ; le drapeau
    // est ce qui permet au formulaire de ne pas laisser marteler le bouton.
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 120_000,
    });

    const result = await login(CREDENTIALS);

    expect(result?.data?.blocked).toBe(true);
  });

  it("lit le quota sur la clé `login:` de l'email normalisé", async () => {
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login({ ...CREDENTIALS, email: "Admin@HomeCyclHome.FR" });

    expect(peekLoginLockout).toHaveBeenCalledWith(
      "login:admin@homecyclhome.fr",
      5,
      10 * 60 * 1000,
    );
  });

  it("enregistre une tentative APRÈS un échec, pas avant", async () => {
    // Décompter à l'entrée ferait tomber le plafond sur les connexions
    // réussies : cinq connexions légitimes d'affilée, un technicien qui change
    // d'appareil, et le compte se ferme.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login(CREDENTIALS);

    expect(recordRateLimitAttempt).toHaveBeenCalledWith(
      "login:admin@homecyclhome.fr",
    );
  });

  it("n'enregistre rien quand la tentative est déjà refusée par le plafond", async () => {
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 120_000,
    });

    await login(CREDENTIALS);

    expect(recordRateLimitAttempt).not.toHaveBeenCalled();
  });

  it("purge le compteur après une connexion réussie", async () => {
    // Quatre erreurs de frappe suivies du bon mot de passe ne doivent pas
    // laisser quatre tentatives armées pour la suite. Le compteur ferme
    // n'oublie plus au fil du temps : c'est le succès qui l'efface.
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

    expect(peekLoginLockout).toHaveBeenCalledWith(
      "login:personne@example.test",
      5,
      10 * 60 * 1000,
    );
    expect(recordRateLimitAttempt).toHaveBeenCalledWith(
      "login:personne@example.test",
    );
  });

  it("affiche le même blocage que le compte existe ou non", async () => {
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 120_000,
    });

    const connu = await login(CREDENTIALS);
    const inconnu = await login({
      email: "personne@example.test",
      password: "peu-importe",
    });

    expect(connu?.data).toEqual(inconnu?.data);
  });

  it("ne divulgue pas le délai restant dans le message", async () => {
    // Le message porte la durée du verrou, une CONSTANTE identique pour tout le
    // monde. Le délai restant, lui, ne doit pas traverser : à la seconde près,
    // il daterait le 5e échec, donc l'activité d'un tiers sur cette adresse.
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 421_000,
    });

    const result = await login(CREDENTIALS);

    expect(JSON.stringify(result?.data)).not.toContain("421");
  });

  // Ajouts de l'agent testeur - les trois cas par lesquels un plafond se
  // contourne en pratique.

  it("ne se contourne pas en variant la casse de l'adresse", async () => {
    // Le compteur est porté par une CHAÎNE. Si la clé était construite sur la
    // saisie brute plutôt que sur `parsedInput`, `Admin@…`, `ADMIN@…` et
    // `admin@…` ouvriraient trois compteurs de cinq tentatives pour un seul
    // compte - quinze essais au lieu de cinq, sans rien de plus qu'un clavier.
    //
    // Le test existant vérifie la LECTURE du quota sur la clé normalisée ;
    // celui-ci vérifie l'ÉCRITURE, qui est ce qui fait effectivement monter le
    // compteur.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    for (const saisie of [
      "Admin@HomeCyclHome.FR",
      "ADMIN@HOMECYCLHOME.FR",
      "aDmIn@homecyclhome.fr",
    ]) {
      await login({ email: saisie, password: "peu-importe" });
    }

    const cles = recordRateLimitAttempt.mock.calls.map(([cle]) => cle);
    expect(new Set(cles)).toEqual(new Set(["login:admin@homecyclhome.fr"]));
  });

  it("refuse même des identifiants VALIDES une fois le plafond atteint", async () => {
    // « formulaire bloqué en front ET serveur » (SPEC §300) : le plafond est un
    // contrôle d'accès, pas un simple compteur d'erreurs. La conséquence est
    // assumée et doit rester visible : cinq échecs sur une adresse ferment la
    // connexion à son titulaire, y compris avec le bon mot de passe. C'est le
    // coût d'un plafond par email, et c'est ce que la SPEC demande. L'amendement
    // du 2026-08-09 ne le supprime pas, il le BORNE à 10 minutes.
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 120_000,
    });
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "user-1", roles: ["ROLE_ADMIN"] },
    });

    const result = await login(CREDENTIALS);

    expect(result?.data).toMatchObject({ error: LOGIN_RATE_LIMITED_MESSAGE });
    expect(createSession).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    // Et le compteur n'est pas purgé : une soumission refusée d'avance n'est
    // pas une connexion réussie.
    expect(clearRateLimit).not.toHaveBeenCalled();
  });

  it("ne redirige pas sur `next` quand le plafond a refusé", async () => {
    // Sans cette garde, un lien `?next=…` transformerait l'écran de connexion
    // en redirecteur utilisable SANS aucun identifiant, simplement en saturant
    // d'abord le compteur d'une adresse quelconque.
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 120_000,
    });

    await login({ ...CREDENTIALS, next: "/admin/parametres" });

    expect(redirect).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// `loginFormAction` - l'adaptateur `useActionState`. Ajouts de l'agent testeur.
//
// Il était livré SANS AUCUN test direct : `login.test.ts` n'exerçait que
// `login`, et `login-form.test.tsx` le REMPLACE par un mock. Or c'est lui que
// `<form action={…}>` référence, donc lui qui est réellement exposé comme
// endpoint POST public - `login` n'est atteint qu'à travers lui depuis un
// navigateur.
//
// Trois responsabilités vivaient là sans oracle : la conversion `FormData` →
// objet, l'omission de `next` vide, et la chaîne de priorité des trois canaux
// d'erreur de next-safe-action.
// ───────────────────────────────────────────────────────────────────────────
describe("loginFormAction - adaptateur de formulaire", () => {
  function champs(valeurs: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [nom, valeur] of Object.entries(valeurs)) {
      formData.set(nom, valeur);
    }
    return formData;
  }

  it("transmet les identifiants saisis à l'authentification", async () => {
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await loginFormAction(
      {},
      champs({ email: "Admin@HomeCyclHome.FR", password: "un-mot-de-passe" }),
    );

    // Normalisé à l'arrivée, comme par l'appel direct : la conversion ne doit
    // pas court-circuiter le schéma.
    expect(authenticateWithPassword).toHaveBeenCalledWith(
      "admin@homecyclhome.fr",
      "un-mot-de-passe",
    );
  });

  it("rend le message générique sur un refus, sans drapeau de blocage", async () => {
    authenticateWithPassword.mockResolvedValue({ ok: false });

    const state = await loginFormAction(
      {},
      champs({ email: "admin@homecyclhome.fr", password: "faux" }),
    );

    expect(state).toEqual({ error: LOGIN_REFUSED_MESSAGE });
    // `blocked` ABSENT et non `false` : le formulaire teste la présence du
    // drapeau, un `false` traînant brouillerait la lecture de l'état.
    expect("blocked" in state).toBe(false);
  });

  it("propage le drapeau de blocage jusqu'au formulaire", async () => {
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 120_000,
    });

    const state = await loginFormAction(
      {},
      champs({ email: "admin@homecyclhome.fr", password: "peu-importe" }),
    );

    expect(state).toEqual({
      error: LOGIN_RATE_LIMITED_MESSAGE,
      blocked: true,
    });
  });

  it("laisse la redirection traverser sur un succès", async () => {
    // `redirect()` fonctionne par throw. Un `try/catch` posé ici l'absorberait
    // et la personne resterait sur le formulaire - connectée sans le savoir,
    // avec un cookie déjà posé.
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "user-1", roles: ["ROLE_CLIENT"] },
    });

    await expect(
      loginFormAction(
        {},
        champs({ email: "admin@homecyclhome.fr", password: "bon" }),
      ),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it("refuse un formulaire vide sans toucher à l'authentification", async () => {
    const state = await loginFormAction({}, new FormData());

    expect(state.error).toBe("Vérifiez les champs du formulaire.");
    expect(authenticateWithPassword).not.toHaveBeenCalled();
    // Une saisie invalide n'est pas une tentative : elle ne doit pas consommer
    // le quota de quelqu'un d'autre.
    expect(recordRateLimitAttempt).not.toHaveBeenCalled();
  });

  it("ne réfléchit jamais le mot de passe soumis dans l'état rendu", async () => {
    // L'état retourné est SÉRIALISÉ dans le document envoyé au navigateur par
    // `useActionState`. Un mot de passe qui y entre finit dans le HTML, donc
    // dans le cache disque et dans toute copie de page.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    const state = await loginFormAction(
      {},
      champs({
        email: "admin@homecyclhome.fr",
        password: "ceci-est-un-secret-reconnaissable",
      }),
    );

    expect(JSON.stringify(state)).not.toContain(
      "ceci-est-un-secret-reconnaissable",
    );
  });

  it("ignore un `next` vide au profit de la destination de rôle", async () => {
    // Le champ caché est absent du document quand la page n'a pas reçu de
    // destination, mais une soumission forgée peut poser `next=""`. Une clé
    // présente à vide n'a pas le même sens qu'une clé absente, et l'omettre est
    // ce qui laisse `afterLoginPath` décider.
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "client-1", roles: ["ROLE_CLIENT"] },
    });

    await loginFormAction(
      {},
      champs({ email: "admin@homecyclhome.fr", password: "bon", next: "" }),
    ).catch(() => undefined);

    expect(redirect).toHaveBeenCalledWith("/mes-interventions/a-venir");
  });

  it("refiltre un `next` hostile posé dans le champ caché", async () => {
    // Le champ est dans le document, donc modifiable au DevTools avant
    // soumission. `page.tsx` filtre au rendu ; ce test vérifie que la frontière
    // tient aussi quand la valeur n'est jamais passée par ce rendu.
    authenticateWithPassword.mockResolvedValue({
      ok: true,
      user: { id: "client-1", roles: ["ROLE_CLIENT"] },
    });

    for (const hostile of [
      "https://phishing.example",
      "//phishing.example",
      "/\\phishing.example",
      "/%2Fphishing.example",
    ]) {
      redirect.mockClear();
      await loginFormAction(
        {},
        champs({
          email: "admin@homecyclhome.fr",
          password: "bon",
          next: hostile,
        }),
      ).catch(() => undefined);

      expect(redirect).toHaveBeenCalledWith("/mes-interventions/a-venir");
    }
  });

  it("ne fait aucune confiance à l'état précédent qu'on lui passe", async () => {
    // `_prevState` vient de React en usage normal, mais l'action est un
    // endpoint POST public : un appelant direct en fournit ce qu'il veut. Un
    // code qui s'y fierait - pour lever un blocage, par exemple - offrirait le
    // contournement du plafond au premier `curl` venu.
    peekLoginLockout.mockResolvedValue({
      allowed: false,
      retryAfterMs: 120_000,
    });

    const state = await loginFormAction(
      { blocked: false, error: "" },
      champs({ email: "admin@homecyclhome.fr", password: "peu-importe" }),
    );

    expect(state.blocked).toBe(true);
    expect(authenticateWithPassword).not.toHaveBeenCalled();
  });
});
