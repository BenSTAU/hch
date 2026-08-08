// @vitest-environment node
//
// Server Actions d'activation et de renvoi — `US-COMPTE-ACTIVER`.
//
// Le lien reçu par email n'est PAS ce qui mute : il mène à un écran qui porte un
// bouton, et c'est le bouton qui poste. Deux raisons, dont une seule est une
// règle du dépôt. La règle : CLAUDE.md réserve les Route Handlers à trois cas
// dont l'activation ne fait pas partie, exige les mutations en Server Action, et
// interdit d'appeler une Server Action depuis un Server Component. Le fait : les
// webmails préchargent les liens qu'ils reçoivent — un jeton consommé par un
// robot laisse un compte inactivable, et l'échec arrive chez le client.
//
// Écart au G/W/T de la SPEC (module-1-utilisateurs.md:211, un seul clic),
// assumé et signalé dans le body de PR.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findEmailVerificationToken = vi.fn();
const activateAccountWithToken = vi.fn();
const findAccountForSignup = vi.fn();
const replacePendingEmailVerificationToken = vi.fn();
vi.mock("@/lib/db/queries/auth", () => ({
  findEmailVerificationToken: (hash: string) =>
    findEmailVerificationToken(hash),
  activateAccountWithToken: (input: unknown) => activateAccountWithToken(input),
  findAccountForSignup: (email: string) => findAccountForSignup(email),
  replacePendingEmailVerificationToken: (input: unknown) =>
    replacePendingEmailVerificationToken(input),
}));

const sendActivationEmail = vi.fn();
vi.mock("@/lib/email/activation", () => ({
  sendActivationEmail: (input: unknown) => sendActivationEmail(input),
}));

const consumeRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: (key: string, limit: number, windowMs: number) =>
    consumeRateLimit(key, limit, windowMs),
  activationRateLimitKey: (email: string) => `activation:${email}`,
  ACTIVATION_RESEND_LIMIT: 3,
  ACTIVATION_RESEND_WINDOW_MS: 24 * 60 * 60 * 1000,
}));

const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;push;${url};307;`,
  });
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

const { activateAccount, resendActivation } = await import("./activate");
const { hashVerificationToken } = await import("@/lib/auth/verification-token");

const JETON = "a".repeat(43);
const APRES_ACTIVATION = "/connexion?compte=active";

/// `redirect()` lève, et next-safe-action relance l'interruption : l'activation
/// réussie REJETTE. Même précaution qu'à la connexion (`login.test.ts:95`). Sur
/// les trois refus, le `.catch` est transparent et le résultat passe.
function activer(input: Parameters<typeof activateAccount>[0]) {
  return activateAccount(input).catch(() => undefined);
}

function jetonEnBase(overrides: Record<string, unknown> = {}) {
  return {
    id: "token-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findEmailVerificationToken.mockResolvedValue(null);
  findAccountForSignup.mockResolvedValue(null);
  consumeRateLimit.mockResolvedValue({ allowed: true });
  sendActivationEmail.mockResolvedValue(undefined);
});

describe("activateAccount — cas nominal", () => {
  it("cherche le jeton par son HASH", async () => {
    findEmailVerificationToken.mockResolvedValue(jetonEnBase());

    await activer({ token: JETON });

    expect(findEmailVerificationToken).toHaveBeenCalledWith(
      hashVerificationToken(JETON),
    );
  });

  it("consomme le jeton et active le compte", async () => {
    findEmailVerificationToken.mockResolvedValue(jetonEnBase());

    await activer({ token: JETON });

    expect(activateAccountWithToken).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: "token-1", userId: "user-1" }),
    );
  });

  it("redirige vers la connexion avec le marqueur d'activation", async () => {
    // US-COMPTE-ACTIVER §Cas nominal : « je suis redirigé vers la page de
    // connexion avec message “Compte activé, vous pouvez vous connecter” ».
    findEmailVerificationToken.mockResolvedValue(jetonEnBase());

    await activer({ token: JETON });

    expect(redirect).toHaveBeenCalledWith(APRES_ACTIVATION);
  });

  it("n'ouvre AUCUNE session au passage", async () => {
    // Activer n'est pas se connecter. La SPEC renvoie explicitement vers le
    // formulaire de connexion : un lien d'email qui ouvrirait une session
    // ferait du contenu d'une boîte email un identifiant suffisant.
    findEmailVerificationToken.mockResolvedValue(jetonEnBase());

    await activer({ token: JETON });

    expect(redirect).toHaveBeenCalledWith(APRES_ACTIVATION);
    expect(JSON.stringify(activateAccountWithToken.mock.calls)).not.toContain(
      "session",
    );
  });
});

describe("activateAccount — refus", () => {
  it("dit « invalide » pour un jeton inconnu", async () => {
    const result = await activer({ token: JETON });

    expect(result?.data).toEqual({ outcome: "invalid" });
    expect(activateAccountWithToken).not.toHaveBeenCalled();
  });

  it("dit « déjà consommé » pour un jeton déjà utilisé", async () => {
    findEmailVerificationToken.mockResolvedValue(
      jetonEnBase({ usedAt: new Date() }),
    );

    const result = await activer({ token: JETON });

    expect(result?.data).toEqual({ outcome: "already_used" });
    expect(activateAccountWithToken).not.toHaveBeenCalled();
  });

  it("dit « expiré » au-delà des 24 h", async () => {
    findEmailVerificationToken.mockResolvedValue(
      jetonEnBase({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    const result = await activer({ token: JETON });

    expect(result?.data).toEqual({ outcome: "expired" });
    expect(activateAccountWithToken).not.toHaveBeenCalled();
  });

  it("annonce « déjà consommé » avant « expiré » sur un jeton vieux ET utilisé", async () => {
    // L'ordre porte le message le plus utile : « connectez-vous » plutôt que
    // « demandez un nouveau lien » à quelqu'un dont le compte est déjà activé.
    findEmailVerificationToken.mockResolvedValue(
      jetonEnBase({
        usedAt: new Date(Date.now() - 90_000),
        expiresAt: new Date(Date.now() - 1_000),
      }),
    );

    const result = await activer({ token: JETON });

    expect(result?.data).toEqual({ outcome: "already_used" });
  });

  it("traite une expiration à l'instant exact comme expirée", async () => {
    // Frontière incluse : `expires_at` est une échéance, pas une durée de grâce.
    const maintenant = new Date("2026-08-09T12:00:00.000Z");
    vi.setSystemTime(maintenant);
    findEmailVerificationToken.mockResolvedValue(
      jetonEnBase({ expiresAt: maintenant }),
    );

    const result = await activer({ token: JETON });

    expect(result?.data).toEqual({ outcome: "expired" });
    vi.useRealTimers();
  });

  it("refuse un jeton mal formé sans interroger la base", async () => {
    const result = await activer({ token: "pas/un+jeton=" });

    expect(result?.validationErrors).toBeDefined();
    expect(findEmailVerificationToken).not.toHaveBeenCalled();
  });

  it("ne réfléchit jamais le jeton soumis dans sa réponse", async () => {
    const result = await activer({ token: JETON });

    expect(JSON.stringify(result)).not.toContain(JETON);
  });
});

describe("resendActivation — anti-abus", () => {
  it("décompte le quota AVANT toute lecture de compte", async () => {
    // PLAN S4 §11.2 : « le compteur doit exister pour toute chaîne tentée ».
    // Décompter après la lecture laisserait un attaquant marteler l'action avec
    // des adresses inconnues sans jamais consommer de jeton.
    await resendActivation({ email: "inconnu@example.test" });

    expect(consumeRateLimit).toHaveBeenCalledWith(
      "activation:inconnu@example.test",
      3,
      24 * 60 * 60 * 1000,
    );
  });

  it("n'envoie rien quand le quota est épuisé", async () => {
    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterMs: 3_600_000,
    });
    findAccountForSignup.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      hasCompletedEmailVerification: false,
    });

    await resendActivation({ email: "camille@example.test" });

    expect(sendActivationEmail).not.toHaveBeenCalled();
  });

  it("renvoie un nouveau lien à un compte jamais activé", async () => {
    findAccountForSignup.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      hasCompletedEmailVerification: false,
    });

    await resendActivation({ email: "camille@example.test" });

    expect(replacePendingEmailVerificationToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(sendActivationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "camille@example.test",
        firstname: "Camille",
      }),
    );
  });

  it("n'envoie rien à un compte déjà activé", async () => {
    findAccountForSignup.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: true,
      hasCompletedEmailVerification: true,
    });

    await resendActivation({ email: "camille@example.test" });

    expect(sendActivationEmail).not.toHaveBeenCalled();
  });

  it("n'envoie rien à un compte désactivé par un administrateur", async () => {
    // Le lien réactiverait un compte que l'administrateur a fermé — cf. la
    // consolidation `is_activated` → `is_active` du dictionnaire v2.
    findAccountForSignup.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      hasCompletedEmailVerification: true,
    });

    await resendActivation({ email: "camille@example.test" });

    expect(sendActivationEmail).not.toHaveBeenCalled();
    expect(replacePendingEmailVerificationToken).not.toHaveBeenCalled();
  });
});

describe("resendActivation — réponse indiscernable", () => {
  it("répond la même chose sur un email inconnu et sur un renvoi réel", async () => {
    const surInconnu = await resendActivation({
      email: "inconnu@example.test",
    });

    findAccountForSignup.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      hasCompletedEmailVerification: false,
    });
    const surRenvoi = await resendActivation({ email: "camille@example.test" });

    expect(surInconnu?.data).toEqual(surRenvoi?.data);
  });

  it("répond la même chose quand le quota est épuisé", async () => {
    // Sinon « trop de tentatives » ne s'afficherait que pour les adresses ayant
    // un compte en attente, et le message deviendrait l'oracle que la table
    // `rate_limits` existe précisément pour éviter (PLAN S4 §11.2).
    const normal = await resendActivation({ email: "camille@example.test" });

    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterMs: 3_600_000,
    });
    const epuise = await resendActivation({ email: "camille@example.test" });

    expect(epuise?.data).toEqual(normal?.data);
  });

  it("signale un échec d'envoi", async () => {
    // ADR-017 : bruyant ici aussi. C'est le seul cas où la réponse diffère, et
    // il ne dépend pas de l'existence du compte — il dépend du transport.
    findAccountForSignup.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      hasCompletedEmailVerification: false,
    });
    sendActivationEmail.mockRejectedValue(new Error("EAUTH"));

    const result = await resendActivation({ email: "camille@example.test" });

    expect(result?.data?.error).toBeTruthy();
  });
});
