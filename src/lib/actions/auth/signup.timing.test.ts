// @vitest-environment node
//
// Canal auxiliaire temporel de l'inscription.
//
// `signup.test.ts` prouve que les trois issues produisent la MÊME redirection.
// C'est nécessaire et insuffisant : l'anti-énumération de la Constitution §4.2
// porte sur ce qu'un attaquant peut OBSERVER, et le temps de réponse en fait
// partie. Le formulaire d'inscription est un oracle par nature — lui seul sait
// si une adresse est libre — et aucune DoD de T-V3-02 ne le mentionne.
//
// Sans discipline, l'écart est structurel : le chemin « email libre » exécute un
// bcrypt (~21 ms), le chemin « email déjà pris » n'en exécute aucun. C'est la
// classe de fuite mesurée sur T-J0-04 à 1 300×-16 000×
// (src/lib/auth/authenticate.timing.test.ts), réintroduite par une autre porte.
//
// ⚠️ Ce que ce fichier NE couvre pas : en production, les chemins qui envoient
// un email paient un aller-retour SMTP que le chemin « déjà activé » ne paie
// pas. Le transport est mocké ici, donc cet écart-là n'est pas mesuré. Il est
// réel, il est résiduel, et il est déclaré dans le body de PR — le supprimer
// demanderait un envoi asynchrone, ce qui contredirait l'échec bruyant
// qu'exige ADR-017.
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: async () => ({ allowed: true }),
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

// `@/lib/auth/password` n'est PAS mocké : c'est le coût de bcrypt qu'on mesure.
const { signup } = await import("./signup");

const FORMULAIRE = {
  firstname: "Camille",
  lastname: "Durand",
  email: "camille@example.test",
  password: "un-mot-de-passe-long",
  passwordConfirmation: "un-mot-de-passe-long",
};

function compte(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    firstname: "Camille",
    isActive: false,
    hasCompletedEmailVerification: false,
    ...overrides,
  };
}

/// Médiane plutôt que moyenne : un seul hoquet du ramasse-miettes emporte une
/// moyenne, pas une médiane. Même helper que `authenticate.timing.test.ts`.
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

beforeEach(() => {
  vi.clearAllMocks();
  createLocalAccount.mockResolvedValue({ userId: "user-1" });
  sendActivationEmail.mockResolvedValue(undefined);
});

describe("signup — indiscernabilité au chronomètre", () => {
  it("paie bcrypt même quand l'email est déjà pris", async () => {
    findAccountForSignup.mockResolvedValue(null);
    const emailLibre = await medianDuration(() => signup(FORMULAIRE));

    // Garde-fou : sans bcrypt réellement exécuté, la comparaison ne veut rien
    // dire et l'échec du test ne serait pas interprétable.
    expect(emailLibre).toBeGreaterThan(5);

    findAccountForSignup.mockResolvedValue(
      compte({ isActive: true, hasCompletedEmailVerification: true }),
    );
    const emailPris = await medianDuration(() => signup(FORMULAIRE));

    // Seuil large, comme sur `authenticate` : on ne cherche pas l'égalité au
    // nanoseconde, on cherche l'absence de décrochage. Une sortie anticipée
    // avant le hachage produit un rapport de deux à trois ordres de grandeur.
    expect(emailPris).toBeGreaterThan(emailLibre * 0.5);
  });

  it("garde les trois issues dans le même ordre de grandeur", async () => {
    // Formulation directe de la propriété : l'attaquant n'a pas de référence, il
    // a trois séries de mesures et cherche laquelle décroche.
    const issues: Array<[string, unknown]> = [
      ["email libre", null],
      ["existant jamais activé", compte()],
      [
        "existant déjà activé",
        compte({ isActive: true, hasCompletedEmailVerification: true }),
      ],
    ];

    const mesures: number[] = [];
    for (const [, valeur] of issues) {
      findAccountForSignup.mockResolvedValue(valeur);
      mesures.push(await medianDuration(() => signup(FORMULAIRE)));
    }

    const min = Math.min(...mesures);
    const max = Math.max(...mesures);

    expect(min).toBeGreaterThan(5);
    expect(max / min).toBeLessThan(3);
  });

  it("hache exactement une fois par soumission", async () => {
    // Deux hachages sur un chemin et un seul sur l'autre rétabliraient l'écart
    // que le premier test ferme, avec un facteur 2 au lieu de 1 000 — moins
    // visible, tout aussi exploitable sur un grand nombre de mesures.
    findAccountForSignup.mockResolvedValue(null);
    const unSeulHachage = await medianDuration(() => signup(FORMULAIRE), 3);

    findAccountForSignup.mockResolvedValue(compte());
    const surRenvoi = await medianDuration(() => signup(FORMULAIRE), 3);

    expect(surRenvoi / unSeulHachage).toBeLessThan(1.8);
  });
});
