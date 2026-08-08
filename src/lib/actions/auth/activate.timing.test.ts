// @vitest-environment node
//
// Canal auxiliaire temporel du RENVOI d'activation.
//
// ── Ajouté par l'agent testeur (T-V3-02). ROUGE ATTENDU ──────────────────────
//
// `signup.timing.test.ts` existe et fait son travail : l'inscription paie
// bcrypt sur ses trois chemins (signup.ts:49), et son résiduel SMTP est déclaré.
// `resendActivation` est l'autre porte du même parcours, et elle n'a **aucun**
// équivalent de ce durcissement :
//
//   chemin éligible   → consumeRateLimit · findAccountForSignup ·
//                       replacePendingEmailVerificationToken · sendActivationEmail
//   chemin inéligible → consumeRateLimit · findAccountForSignup, puis `return`
//
// (`activate.ts:82-116`.) Le second s'arrête après deux lectures, sans rien
// payer pour compenser. La réponse est bien identique — `activate.test.ts` le
// prouve — mais l'anti-énumération de la Constitution §4.2 porte sur ce qu'un
// attaquant OBSERVE, et la durée en fait partie. C'est la classe de fuite
// mesurée à 1 300×-16 000× sur la connexion en T-J0-04
// (`src/lib/auth/authenticate.timing.test.ts`), rouverte par une troisième
// porte après celle que `signup` a fermée.
//
// Le quota de 3/24 h ne la ferme pas : il est indexé PAR EMAIL
// (`activation:<email>`, rate-limit.ts:27). Balayer un million d'adresses
// distinctes ne consomme jamais qu'un jeton sur chacune, et une seule mesure
// par adresse suffit à classer.
//
// ⚠️ Ce que ce fichier mesure, et ce qu'il ne mesure pas. Les mocks n'ont aucun
// coût réel : les latences ci-dessous sont INJECTÉES, et elles modélisent la
// production plutôt qu'elles ne la mesurent — un aller-retour Postgres par le
// tunnel SSH, un aller-retour `smtp.gmail.com`. Le test ne prouve donc pas une
// valeur d'écart ; il prouve que l'écart est STRUCTUREL, c'est-à-dire qu'il
// existe pour tout couple de latences non nulles. Les constantes sont
// volontairement modestes : à 0 ms de SMTP le test passerait encore, ce qui
// serait le seul cas où la conclusion serait fausse.
import { beforeEach, describe, expect, it, vi } from "vitest";

/// Un aller-retour vers Postgres à travers le tunnel SSH (CLAUDE.md §Deux postes
/// de développement fixe le seuil de repli à 80 ms de latence de tunnel ; 10 ms
/// est une hypothèse basse, favorable au code testé).
const LATENCE_DB = 10;

/// Un aller-retour `smtp.gmail.com` : connexion, STARTTLS, AUTH, DATA. 150 ms
/// est également une hypothèse basse — ADR-017 §Décision retient Gmail, pas un
/// relais local.
const LATENCE_SMTP = 150;

function apres<T>(ms: number, valeur: T): Promise<T> {
  return new Promise((resoudre) => setTimeout(() => resoudre(valeur), ms));
}

const findAccountForSignup = vi.fn();
const replacePendingEmailVerificationToken = vi.fn();
vi.mock("@/lib/db/queries/auth", () => ({
  findEmailVerificationToken: async () => null,
  activateAccountWithToken: async () => undefined,
  findAccountForSignup: (email: string) => findAccountForSignup(email),
  replacePendingEmailVerificationToken: (input: unknown) =>
    replacePendingEmailVerificationToken(input),
}));

const sendActivationEmail = vi.fn();
vi.mock("@/lib/email/activation", () => ({
  sendActivationEmail: (input: unknown) => sendActivationEmail(input),
}));

// ── Ajouté par la session principale en réponse à ce constat (B3) ────────────
//
// `src/lib/email/dispatch.ts` n'existait pas quand ce fichier a été écrit : c'est
// la couture posée POUR fermer le canal qu'il mesure. Elle confie l'envoi à
// `after()` de Next, donc hors du chemin de réponse. Le mock reproduit la seule
// propriété qui compte ici — lancé, jamais attendu.
//
// **L'oracle du fichier n'est pas touché** : les deux seuils `< 3` et les
// latences injectées sont ceux de l'agent testeur, inchangés. Sans ce mock,
// `after()` s'exécuterait hors de tout contexte de requête Next, ce que la
// documentation ne définit pas.
vi.mock("@/lib/email/dispatch", () => ({
  dispatchEmail: (_libelle: string, envoyer: () => Promise<void>) => {
    void envoyer().catch(() => undefined);
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  // Payé sur les DEUX chemins : `activate.ts:82` décompte avant toute lecture
  // de compte, et c'est le bon ordre. Ce n'est pas ce coût-là qui trahit.
  consumeRateLimit: () => apres(LATENCE_DB, { allowed: true }),
  activationRateLimitKey: (email: string) => `activation:${email}`,
  ACTIVATION_RESEND_LIMIT: 3,
  ACTIVATION_RESEND_WINDOW_MS: 24 * 60 * 60 * 1000,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;push;${url};307;`,
    });
  },
}));

const { resendActivation } = await import("./activate");

const EN_ATTENTE = {
  id: "user-1",
  firstname: "Camille",
  isActive: false,
  hasCompletedEmailVerification: false,
};

const DEJA_ACTIVE = {
  id: "user-2",
  firstname: "Alix",
  isActive: true,
  hasCompletedEmailVerification: true,
};

/// Médiane plutôt que moyenne : un hoquet du ramasse-miettes emporte une
/// moyenne, pas une médiane. Même helper que `signup.timing.test.ts:84`.
async function medianDuration(run: () => Promise<unknown>, samples = 5) {
  const durations: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    await run();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  return durations[Math.floor(durations.length / 2)]!;
}

function renvoyer(email: string) {
  return resendActivation({ email }).catch(() => undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  findAccountForSignup.mockImplementation((email: string) =>
    apres(LATENCE_DB, email === "camille@example.test" ? EN_ATTENTE : null),
  );
  replacePendingEmailVerificationToken.mockImplementation(() =>
    apres(LATENCE_DB, undefined),
  );
  sendActivationEmail.mockImplementation(() => apres(LATENCE_SMTP, undefined));
});

describe("resendActivation — indiscernabilité au chronomètre", () => {
  it("répond en un temps comparable sur une adresse inconnue et sur un renvoi réel", async () => {
    const inconnu = await medianDuration(() => renvoyer("absent@example.test"));
    const renvoiReel = await medianDuration(() =>
      renvoyer("camille@example.test"),
    );

    // Garde-fou : sans coût mesurable sur le chemin court, la comparaison ne
    // voudrait rien dire et un échec ne serait pas interprétable.
    expect(inconnu).toBeGreaterThan(5);

    // Seuil large, comme sur `authenticate` et `signup` : on ne cherche pas
    // l'égalité au nanoseconde, on cherche l'absence de décrochage.
    expect(renvoiReel / inconnu).toBeLessThan(3);
  });

  it("répond en un temps comparable sur un compte déjà activé", async () => {
    // Variante qui compte davantage que la précédente : ici l'adresse EXISTE
    // dans les deux cas, et seul l'état du compte change. C'est la mesure qui
    // sépare « ce compte est en attente d'activation » de « ce compte est
    // activé » — donc celle qui dit à un attaquant quels comptes n'ont jamais
    // été activés, et sur lesquels un lien d'activation est encore en vol.
    findAccountForSignup.mockImplementation(() =>
      apres(LATENCE_DB, DEJA_ACTIVE),
    );
    const active = await medianDuration(() => renvoyer("alix@example.test"));

    findAccountForSignup.mockImplementation(() =>
      apres(LATENCE_DB, EN_ATTENTE),
    );
    const enAttente = await medianDuration(() =>
      renvoyer("camille@example.test"),
    );

    expect(active).toBeGreaterThan(5);
    expect(enAttente / active).toBeLessThan(3);
  });
});
