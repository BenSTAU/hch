// @vitest-environment node
//
// Server Action de connexion — ajoutée par l'agent testeur.
//
// Aucun test ne couvrait cette action, alors qu'elle est le seul point où les
// trois couches se rencontrent : validation Zod, authentification, pose de
// session. Rappel d'ADR-006 v2 repris dans `src/lib/safe-action.ts:5-7` —
// **une Server Action exportée est un endpoint POST public**. Elle est donc
// appelable avec n'importe quelle charge utile, y compris celles qu'aucun
// formulaire n'enverrait.
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

const { login } = await import("./login");
const { LOGIN_REFUSED_MESSAGE } = await import("@/lib/validations/auth");

const CREDENTIALS = {
  email: "admin@homecyclhome.fr",
  password: "bon-mot-de-passe",
};

beforeEach(() => vi.clearAllMocks());

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
    // `redirect()` fonctionne par throw. Si next-safe-action le confondait
    // avec une erreur applicative, `handleServerError` le convertirait en
    // `{ serverError }` et l'utilisateur resterait sur le formulaire, connecté
    // mais sans le savoir.
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
    // Ajouté après le correctif de casse. `validations/auth.test.ts` prouve que
    // le schéma transforme ; ce test-ci prouve que la transformation ARRIVE
    // jusqu'à la recherche en base. C'est la moitié qui manquait : un schéma
    // qui normalise dans son coin ne sert à rien si l'action lit la valeur
    // brute plutôt que `parsedInput`.
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
    // Symétrique du précédent, et il compte : un `.toLowerCase()` appliqué par
    // erreur au mot de passe amputerait silencieusement l'espace de recherche
    // et invaliderait tous les hashs existants portant une majuscule.
    authenticateWithPassword.mockResolvedValue({ ok: false });

    await login({ email: "admin@homecyclhome.fr", password: "MoTdEpAsSe-42" });

    expect(authenticateWithPassword).toHaveBeenCalledWith(
      "admin@homecyclhome.fr",
      "MoTdEpAsSe-42",
    );
  });

  it("ignore les champs surnuméraires — les rôles ne se soumettent pas", async () => {
    // Élévation de privilège par affectation de masse : on POSTe des rôles
    // avec les identifiants. Ils doivent être écartés par le schéma, et la
    // session doit être posée avec les rôles LUS EN BASE, jamais avec ceux
    // reçus du client.
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
