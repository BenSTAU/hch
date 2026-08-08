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

// `dispatchEmail` confie l'envoi à `after()` de Next, hors du chemin de réponse
// (`src/lib/email/dispatch.ts`). Le mock l'appelle IMMÉDIATEMENT et ne l'attend
// pas : les assertions sur `sendActivationEmail` restent valides, et l'échec du
// transport ne peut par construction pas atteindre la réponse.
vi.mock("@/lib/email/dispatch", () => ({
  dispatchEmail: (_libelle: string, envoyer: () => Promise<void>) => {
    void envoyer().catch(() => undefined);
  },
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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

const { signup, signupFormAction } = await import("./signup");

const FORMULAIRE = {
  firstname: "Camille",
  lastname: "Durand",
  email: "camille@example.test",
  password: "un-mot-de-passe-long",
  passwordConfirmation: "un-mot-de-passe-long",
};

const CONFIRMATION = "/inscription/confirmation";

/// `redirect()` lève, et next-safe-action **relance** l'interruption dès qu'elle
/// porte un digest `NEXT_REDIRECT` : une action qui redirige REJETTE. Même
/// précaution qu'à la connexion (`login.test.ts:95`). Sur les chemins qui ne
/// redirigent pas, le `.catch` est transparent et le résultat passe.
function soumettre(input: Parameters<typeof signup>[0]) {
  return signup(input).catch(() => undefined);
}

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
    await soumettre(FORMULAIRE);

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
    await soumettre(FORMULAIRE);

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
    await soumettre(FORMULAIRE);

    const [input] = createLocalAccount.mock.calls[0] as [{ tokenHash: string }];
    const [message] = sendActivationEmail.mock.calls[0] as [
      { to: string; token: string },
    ];

    expect(message.to).toBe("camille@example.test");
    expect(message.token).not.toBe(input.tokenHash);
    expect(message.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("redirige vers l'écran de confirmation", async () => {
    await soumettre(FORMULAIRE);

    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
  });

  it("ne consomme pas le quota de renvoi", async () => {
    // Le rate-limit couvre les RENVOIS (module-1-utilisateurs.md:233). Le
    // décompter à la première inscription retirerait un jeton à la personne qui
    // en aura besoin ensuite.
    await soumettre(FORMULAIRE);

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
    await soumettre(FORMULAIRE);

    expect(createLocalAccount).not.toHaveBeenCalled();
  });

  it("remplace le jeton en attente et renvoie l'email", async () => {
    await soumettre(FORMULAIRE);

    expect(replacePendingEmailVerificationToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
    expect(sendActivationEmail).toHaveBeenCalledOnce();
  });

  it("personnalise l'email avec le prénom ENREGISTRÉ", async () => {
    // Pas celui du formulaire : l'email part à l'adresse d'un tiers, et son
    // contenu ne doit pas être choisi par qui soumet.
    findAccountForSignup.mockResolvedValue(compte({ firstname: "Alix" }));

    await soumettre({ ...FORMULAIRE, firstname: "Camille" });

    expect(sendActivationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ firstname: "Alix" }),
    );
  });

  it("décompte le renvoi sur la clé de l'email", async () => {
    await soumettre(FORMULAIRE);

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

    await soumettre(FORMULAIRE);

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

    await soumettre(FORMULAIRE);

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
    await soumettre(FORMULAIRE);

    expect(createLocalAccount).not.toHaveBeenCalled();
    expect(replacePendingEmailVerificationToken).not.toHaveBeenCalled();
    expect(sendActivationEmail).not.toHaveBeenCalled();
  });

  it("redirige vers le MÊME écran de confirmation", async () => {
    await soumettre(FORMULAIRE);

    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
  });

  it("ne consomme pas le quota de renvoi d'un compte déjà activé", async () => {
    // Sinon un tiers épuiserait le quota du titulaire en soumettant trois fois
    // son adresse, et lui bloquerait le renvoi dont il pourrait avoir besoin.
    await soumettre(FORMULAIRE);

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

    await soumettre(FORMULAIRE);

    expect(sendActivationEmail).not.toHaveBeenCalled();
    expect(replacePendingEmailVerificationToken).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
  });
});

describe("signup — échec d'envoi", () => {
  // ── Oracles RETOURNÉS le 2026-08-08, arbitrage B2 ───────────────────────────
  //
  // Ces trois tests exigeaient l'inverse : que l'échec d'envoi soit signalé à
  // l'écran et suspende la redirection (ADR-017 §Contraintes, « échec bruyant »).
  // L'agent testeur a montré que ce message est un ORACLE : il ne peut naître que
  // sur un chemin ayant TENTÉ un envoi, donc jamais sur « compte déjà activé ».
  // Benjamin a tranché pour la Constitution §4.2 — réponse uniforme, bruit dans
  // les logs. Ce que voulait ADR-017 reste tenu autrement : la trace côté
  // exploitant (`src/lib/email/dispatch.ts`) et le renvoi d'activation côté
  // client, livré par cette même tâche.
  //
  // Les oracles ci-dessous sont donc l'inverse des précédents, à dessein.

  it("redirige quand même, transport en panne ou non", async () => {
    sendActivationEmail.mockRejectedValue(new Error("EAUTH"));

    const result = await soumettre(FORMULAIRE);

    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
    expect(result).toBeUndefined();
  });

  it("n'ouvre aucun canal de réponse que l'envoi puisse teinter", async () => {
    // La propriété directe : le sort du transport ne doit apparaître NULLE PART
    // dans ce que voit l'appelant.
    sendActivationEmail.mockRejectedValue(
      new Error("EAUTH 535 seizecaracteres refusé par smtp.gmail.com"),
    );

    const enPanne = await soumettre(FORMULAIRE);

    vi.clearAllMocks();
    findAccountForSignup.mockResolvedValue(null);
    createLocalAccount.mockResolvedValue({ userId: "user-1" });
    sendActivationEmail.mockResolvedValue(undefined);
    const nominal = await soumettre(FORMULAIRE);

    // `undefined` des deux côtés : la redirection a levé, donc l'appelant ne
    // reçoit RIEN — et deux « rien » sont indiscernables par construction.
    // `?? {}` parce que `JSON.stringify(undefined)` ne renvoie pas une chaîne.
    expect(enPanne).toEqual(nominal);
    expect(JSON.stringify(enPanne ?? {})).not.toContain("seizecaracteres");
    expect(JSON.stringify(enPanne ?? {})).not.toContain("smtp.gmail.com");
  });

  it("tente quand même l'envoi — ce n'est pas un renoncement", async () => {
    // Le corollaire à ne pas perdre : l'envoi uniforme ne veut pas dire pas
    // d'envoi. Le compte est créé ET le lien part ; seul son sort est muet.
    sendActivationEmail.mockRejectedValue(new Error("EAUTH"));

    await soumettre(FORMULAIRE);

    expect(createLocalAccount).toHaveBeenCalledOnce();
    expect(sendActivationEmail).toHaveBeenCalledOnce();
  });
});

describe("signup — le canal d'échec d'envoi face à l'anti-énumération", () => {
  // ── Ajouté par l'agent testeur (T-V3-02). ROUGE ATTENDU ────────────────────
  //
  // `src/lib/validations/auth.ts:44-46` affirme d'EMAIL_DELIVERY_FAILED_MESSAGE
  // qu'il est le « seul message qui ne dépend PAS de l'existence du compte : il
  // dépend du transport ». Le flot de `signup.ts` dit autre chose : le message
  // naît de `envoye === false`, et `envoye` ne peut valoir `false` que sur un
  // chemin qui a TENTÉ un envoi. Le chemin « déjà activé » n'en tente aucun
  // (signup.ts:66-95 ne s'exécute pas), donc il redirige toujours.
  //
  // Avec un transport en panne — scénario qu'ADR-017 §Conséquences nomme
  // explicitement, « révocation silencieuse possible » de Google —, le
  // formulaire devient l'oracle exact que la Constitution §4.2 interdit :
  //   · réponse en erreur   ⇒ l'email était libre, ou en attente d'activation
  //   · redirection normale ⇒ l'email a un compte activé
  //
  // ⚠️ Ce test met en évidence un ARBITRAGE, pas une bourde : fermer le canal
  // demande soit de taire l'échec (contre ADR-017), soit de le rendre visible
  // sur les trois chemins (message affiché sans qu'aucun envoi n'ait été
  // tenté). L'agent testeur ne tranche pas ce dilemme — il le rend rouge pour
  // qu'il soit tranché. Si Benjamin arbitre pour « bruyant d'abord », ce
  // `describe` est à supprimer avec une note, pas à rendre vert en douce.
  it("reste indiscernable quand le transport est en panne", async () => {
    sendActivationEmail.mockRejectedValue(new Error("EAUTH"));

    findAccountForSignup.mockResolvedValue(null);
    const emailLibre = await soumettre(FORMULAIRE);

    findAccountForSignup.mockResolvedValue(
      compte({ isActive: true, hasCompletedEmailVerification: true }),
    );
    const dejaActive = await soumettre(FORMULAIRE);

    expect(dejaActive?.data).toEqual(emailLibre?.data);
  });

  it("ne distingue pas non plus le quota épuisé d'un compte activé", async () => {
    // Second visage du même canal, et il mord SANS transport en panne : quota
    // épuisé ⇒ `envoye` reste à `true` (signup.ts:53 puis 80) ⇒ redirection.
    // Donc « compte en attente au quota épuisé » et « compte déjà activé »
    // répondent pareil, tandis que « compte en attente au quota disponible »
    // répond en erreur dès que le transport tombe. Trois classes observables
    // là où la SPEC en veut une.
    sendActivationEmail.mockRejectedValue(new Error("EAUTH"));

    findAccountForSignup.mockResolvedValue(compte());
    consumeRateLimit.mockResolvedValue({ allowed: true });
    const quotaDisponible = await soumettre(FORMULAIRE);

    consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterMs: 3_600_000,
    });
    const quotaEpuise = await soumettre(FORMULAIRE);

    expect(quotaEpuise?.data).toEqual(quotaDisponible?.data);
  });
});

describe("signup — course sur l'index unique de `users.email`", () => {
  // ── Ajouté par l'agent testeur (T-V3-02). ROUGE ATTENDU ────────────────────
  //
  // `findAccountForSignup` puis `createLocalAccount` ne sont pas atomiques
  // entre eux : la transaction de `createLocalAccount` couvre ses trois
  // écritures (db/queries/auth.ts:97), pas la lecture qui l'a précédée. Deux
  // soumissions concurrentes du même email libre passent donc toutes deux le
  // `if (!compte)` de signup.ts:55, et la seconde heurte
  // `users_email_key` (P2002).
  //
  // Le bouton désactivé pendant la soumission (signup-form.tsx:216) couvre le
  // double-clic, pas ce cas : une Server Action exportée est un endpoint POST
  // public, et rien n'oblige l'appelant à passer par le formulaire.
  //
  // Attendu : la même issue que les autres chemins — l'email est pris, donc la
  // redirection de confirmation. Constaté : `handleServerError` produit « Une
  // erreur est survenue », un quatrième comportement observable.
  it("ne répond pas par une erreur serveur quand l'insertion perd la course", async () => {
    createLocalAccount.mockRejectedValue(
      Object.assign(
        new Error("Unique constraint failed on the fields: (`email`)"),
        {
          code: "P2002",
          meta: { target: ["email"] },
        },
      ),
    );

    const result = await soumettre(FORMULAIRE);

    expect(result?.serverError).toBeUndefined();
    expect(redirect).toHaveBeenCalledWith(CONFIRMATION);
  });
});

describe("signup — validation", () => {
  it("refuse deux mots de passe différents sans toucher à la base", async () => {
    const result = await soumettre({
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
    await soumettre({ ...FORMULAIRE, roles: ["ROLE_ADMIN"] } as never);

    expect(createLocalAccount).toHaveBeenCalledWith(
      expect.not.objectContaining({ roles: expect.anything() }),
    );
  });

  it("ne réfléchit jamais le mot de passe soumis dans sa réponse", async () => {
    const result = await soumettre({
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
