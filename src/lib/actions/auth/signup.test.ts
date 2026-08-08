// @vitest-environment node
//
// Server Action d'inscription — `US-COMPTE-CREER`. Rappel d'ADR-006 v2 repris
// dans `src/lib/safe-action.ts` : **une Server Action exportée est un endpoint
// POST public**, donc appelable avec n'importe quelle charge utile.
//
// Ce que ce fichier surveille avant tout : les trois issues de l'inscription —
// email libre, compte existant non activé, compte existant déjà activé —
// doivent être **indiscernables de l'extérieur**. Même redirection, même écran,
// aucun canal d'erreur distinct. C'est l'anti-énumération de la Constitution
// §4.2 appliquée à un formulaire que la SPEC, elle, décrit avec deux messages
// différents (module-1-utilisateurs.md:160 et :165) — écart signalé en PR.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hashPassword = vi.fn();
vi.mock("@/lib/auth/password", () => ({
  hashPassword: (plain: string) => hashPassword(plain),
}));

const findAccountForSignup = vi.fn();
const createLocalAccount = vi.fn();
const replacePendingEmailVerificationToken = vi.fn();
vi.mock("@/lib/db/queries/auth", () => ({
  findAccountForSignup: (email: string) => findAccountForSignup(email),
  createLocalAccount: (input: unknown) => createLocalAccount(input),
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

// Même contrat que dans `login.test.ts` : `redirect()` fonctionne par throw, et
// next-safe-action ne relance une interruption de framework que si elle porte un
// `digest` de la bonne forme. Un mock qui se contenterait d'enregistrer
// laisserait passer un code qui continue après la redirection.
const redirect = vi.fn((url: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), {
    digest: `NEXT_REDIRECT;push;${url};307;`,
  });
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const { signup, signupFormAction } = await import("./signup");

const FORMULAIRE = {
  firstname: "Camille",
  lastname: "Durand",
  email: "camille@example.test",
  password: "un-mot-de-passe-long",
  passwordConfirmation: "un-mot-de-passe-long",
};

const CONFIRMATION = "/inscription/confirmation";

function compte(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    firstname: "Camille",
    isActive: false,
    hasCompletedEmailVerification: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hashPassword.mockResolvedValue("$2b$10$hashbcryptfictif");
  findAccountForSignup.mockResolvedValue(null);
  createLocalAccount.mockResolvedValue({ userId: "user-1" });
  sendActivationEmail.mockResolvedValue(undefined);
  consumeRateLimit.mockResolvedValue({ allowed: true });
});

describe("signup — email libre", () => {
  it("crée le compte avec le hash bcrypt du mot de passe soumis", async () => {
    await signup(FORMULAIRE);

    expect(hashPassword).toHaveBeenCalledWith("un-mot-de-passe-long");
    expect(createLocalAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "camille@example.test",
        firstname: "Camille",
        lastname: "Durand",
        passwordHash: "$2b$10$hashbcryptfictif",
      }),
    );
  });

  it("émet un jeton hashé et une échéance à 24 h", async () => {
    await signup(FORMULAIRE);

    const [input] = createLocalAccount.mock.calls[0] as [
      { tokenHash: string; expiresAt: Date },
    ];
    expect(input.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(input.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      23 * 60 * 60 * 1000,
    );
  });

  it("envoie le jeton EN CLAIR par email, jamais son hash", async () => {
    // Le clair ne vit que dans l'URL (dictionnaire §verification_tokens).
    // Envoyer le hash produirait un lien qui ne peut par construction
    // correspondre à aucune ligne.
    await signup(FORMULAIRE);

    const [input] = createLocalAccount.mock.calls[0] as [{ tokenHash: string }];
    const [message] = sendActivationEmail.mock.calls[0] as [
      { to: string; token: string },
    ];

    expect(message.to).toBe("camille@example.test");
    expect(message.token).not.toBe(input.tokenHash);
    expect(message.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("redirige vers l'écran de confirmation", async () => {
    await signup(FORMULAIRE);

    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
  });

  it("ne consomme pas le quota de renvoi", async () => {
    // Le rate-limit couvre les RENVOIS (module-1-utilisateurs.md:233). Le
    // décompter à la première inscription retirerait un jeton à la personne qui
    // en aura besoin ensuite.
    await signup(FORMULAIRE);

    expect(consumeRateLimit).not.toHaveBeenCalled();
  });
});

describe("signup — compte existant jamais activé", () => {
  beforeEach(() => {
    findAccountForSignup.mockResolvedValue(compte());
  });

  it("ne crée pas un second compte", async () => {
    // US-COMPTE-CREER §Cas d'erreur : « aucune ligne `users` supplémentaire
    // n'est créée ».
    await signup(FORMULAIRE);

    expect(createLocalAccount).not.toHaveBeenCalled();
  });

  it("remplace le jeton en attente et renvoie l'email", async () => {
    await signup(FORMULAIRE);

    expect(replacePendingEmailVerificationToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(sendActivationEmail).toHaveBeenCalledOnce();
  });

  it("personnalise l'email avec le prénom ENREGISTRÉ", async () => {
    // Pas celui du formulaire : l'email part à l'adresse d'un tiers, et son
    // contenu ne doit pas être choisi par qui soumet.
    findAccountForSignup.mockResolvedValue(compte({ firstname: "Alix" }));

    await signup({ ...FORMULAIRE, firstname: "Camille" });

    expect(sendActivationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ firstname: "Alix" }),
    );
  });

  it("décompte le renvoi sur la clé de l'email", async () => {
    await signup(FORMULAIRE);

    expect(consumeRateLimit).toHaveBeenCalledWith(
      "activation:camille@example.test",
      3,
      24 * 60 * 60 * 1000,
    );
  });

  it("n'envoie rien quand le quota est épuisé", async () => {
    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterMs: 3_600_000,
    });

    await signup(FORMULAIRE);

    expect(sendActivationEmail).not.toHaveBeenCalled();
    expect(replacePendingEmailVerificationToken).not.toHaveBeenCalled();
  });

  it("redirige quand même vers la confirmation, quota épuisé ou non", async () => {
    // Un écran différent en cas de quota épuisé dirait « cet email a un compte
    // en attente », donc énumérerait les comptes non activés.
    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterMs: 3_600_000,
    });

    await signup(FORMULAIRE);

    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
  });
});

describe("signup — compte existant déjà activé", () => {
  beforeEach(() => {
    findAccountForSignup.mockResolvedValue(
      compte({ isActive: true, hasCompletedEmailVerification: true }),
    );
  });

  it("n'envoie aucun email et ne touche à rien", async () => {
    await signup(FORMULAIRE);

    expect(createLocalAccount).not.toHaveBeenCalled();
    expect(replacePendingEmailVerificationToken).not.toHaveBeenCalled();
    expect(sendActivationEmail).not.toHaveBeenCalled();
  });

  it("redirige vers le MÊME écran de confirmation", async () => {
    await signup(FORMULAIRE);

    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
  });

  it("ne consomme pas le quota de renvoi d'un compte déjà activé", async () => {
    // Sinon un tiers épuiserait le quota du titulaire en soumettant trois fois
    // son adresse, et lui bloquerait le renvoi dont il pourrait avoir besoin.
    await signup(FORMULAIRE);

    expect(consumeRateLimit).not.toHaveBeenCalled();
  });
});

describe("signup — compte désactivé par un administrateur", () => {
  it("n'envoie aucun lien qui le réactiverait", async () => {
    // Conséquence de la consolidation `is_activated` → `is_active` du
    // dictionnaire v2 (mcd-dictionnaire.md:89) : les deux états sont
    // indistinguables sur cette colonne. Le discriminant retenu est l'historique
    // des jetons — un compte qui a DÉJÀ consommé un jeton d'activation a été
    // activé une fois, donc son `is_active = false` vient de l'administrateur.
    findAccountForSignup.mockResolvedValue(
      compte({ isActive: false, hasCompletedEmailVerification: true }),
    );

    await signup(FORMULAIRE);

    expect(sendActivationEmail).not.toHaveBeenCalled();
    expect(replacePendingEmailVerificationToken).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
  });
});

describe("signup — échec d'envoi", () => {
  it("le signale au lieu de rediriger", async () => {
    // ADR-017 §Contraintes : « échec d'envoi bruyant, jamais silencieux ». Un
    // envoi raté suivi d'une redirection vers « vérifiez votre email » envoie la
    // personne attendre un message qui n'arrivera jamais.
    sendActivationEmail.mockRejectedValue(new Error("EAUTH"));

    const result = await signup(FORMULAIRE);

    expect(redirect).not.toHaveBeenCalled();
    expect(result?.data?.error).toBeTruthy();
  });

  it("emploie le même message quel que soit le chemin d'envoi", async () => {
    // Un message qui dirait « votre compte a été créé » sur un chemin et autre
    // chose sur l'autre révélerait si l'email était libre.
    sendActivationEmail.mockRejectedValue(new Error("EAUTH"));

    const surCreation = await signup(FORMULAIRE);

    findAccountForSignup.mockResolvedValue(compte());
    const surRenvoi = await signup(FORMULAIRE);

    expect(surCreation?.data?.error).toBe(surRenvoi?.data?.error);
  });

  it("ne fait pas fuiter le détail SMTP vers le navigateur", async () => {
    sendActivationEmail.mockRejectedValue(
      new Error("EAUTH 535 seizecaracteres refusé par smtp.gmail.com"),
    );

    const result = await signup(FORMULAIRE);

    expect(JSON.stringify(result)).not.toContain("seizecaracteres");
    expect(JSON.stringify(result)).not.toContain("smtp.gmail.com");
  });
});

describe("signup — validation", () => {
  it("refuse deux mots de passe différents sans toucher à la base", async () => {
    const result = await signup({
      ...FORMULAIRE,
      passwordConfirmation: "autre-chose",
    });

    expect(result?.validationErrors).toBeDefined();
    expect(hashPassword).not.toHaveBeenCalled();
    expect(createLocalAccount).not.toHaveBeenCalled();
  });

  it("ignore un rôle injecté dans la charge utile", async () => {
    // L'action est un endpoint public : la charge n'a aucune raison de
    // ressembler à ce que le formulaire envoie.
    await signup({ ...FORMULAIRE, roles: ["ROLE_ADMIN"] } as never);

    expect(createLocalAccount).toHaveBeenCalledWith(
      expect.not.objectContaining({ roles: expect.anything() }),
    );
  });

  it("ne réfléchit jamais le mot de passe soumis dans sa réponse", async () => {
    const result = await signup({
      ...FORMULAIRE,
      password: "court",
      passwordConfirmation: "court",
    });

    expect(JSON.stringify(result)).not.toContain("court");
  });
});

describe("signupFormAction — adaptateur `useActionState`", () => {
  it("convertit le FormData et aboutit à la redirection", async () => {
    const formData = new FormData();
    formData.set("firstname", "Camille");
    formData.set("lastname", "Durand");
    formData.set("email", "camille@example.test");
    formData.set("password", "un-mot-de-passe-long");
    formData.set("passwordConfirmation", "un-mot-de-passe-long");

    await expect(signupFormAction({}, formData)).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(createLocalAccount).toHaveBeenCalledOnce();
  });

  it("remonte les erreurs de validation champ par champ", async () => {
    // WCAG 3.3.1 (AA) : chaque champ fautif doit pouvoir porter son message par
    // `aria-describedby`. Un message global ne le permet pas.
    const formData = new FormData();
    formData.set("firstname", "");
    formData.set("lastname", "Durand");
    formData.set("email", "pas-un-email");
    formData.set("password", "court");
    formData.set("passwordConfirmation", "court");

    const state = await signupFormAction({}, formData);

    expect(state.fieldErrors?.firstname).toBeTruthy();
    expect(state.fieldErrors?.email).toContain("Email invalide");
    expect(state.fieldErrors?.password).toContain(
      "Mot de passe : 12 caractères minimum",
    );
  });

  it("renvoie les valeurs saisies sauf les mots de passe", async () => {
    // Réafficher un formulaire vide après un refus fait tout retaper. Réafficher
    // les mots de passe les remettrait dans le HTML de la réponse, donc dans le
    // cache navigateur et l'historique.
    const formData = new FormData();
    formData.set("firstname", "Camille");
    formData.set("lastname", "Durand");
    formData.set("email", "pas-un-email");
    formData.set("password", "un-mot-de-passe-long");
    formData.set("passwordConfirmation", "un-mot-de-passe-long");

    const state = await signupFormAction({}, formData);

    expect(state.values).toEqual({
      firstname: "Camille",
      lastname: "Durand",
      email: "pas-un-email",
    });
    expect(JSON.stringify(state)).not.toContain("un-mot-de-passe-long");
  });
});
