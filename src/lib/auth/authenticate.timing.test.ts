// Canal auxiliaire temporel de l'anti-énumération — ajouté par l'agent testeur.
//
// `authenticate.test.ts` prouve que les quatre causes de refus produisent un
// objet IDENTIQUE. C'est nécessaire et insuffisant : l'anti-énumération de la
// Constitution §4.2 et de la SPEC §6.1 porte sur ce qu'un attaquant peut
// OBSERVER, et le temps de réponse en fait partie au même titre que le corps
// de la réponse.
//
// L'implémentation le sait et l'a écrit en commentaire
// (src/lib/actions/auth/login.ts:22-24). Ce fichier le transforme en constat
// exécutable : tant qu'il est rouge, l'écart existe.
//
// Ces tests sont ROUGES à dessein. Ils ne doivent pas être neutralisés — la
// correction attendue est un `bcrypt.compare` de leurre sur les chemins qui
// sortent avant la vérification du mot de passe.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUserForLogin = vi.fn();
vi.mock("@/lib/db/queries/auth", () => ({
  findUserForLogin: (email: string) => findUserForLogin(email),
}));

const { authenticateWithPassword } = await import("./authenticate");
const { hashPassword } = await import("./password");

const HASH = await hashPassword("bon-mot-de-passe");

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    roles: ["ROLE_ADMIN"],
    isActive: true,
    authProviders: [{ provider: "local", passwordHash: HASH }],
    ...overrides,
  };
}

/// Médiane sur plusieurs passes : une moyenne se laisse emporter par un seul
/// hoquet du ramasse-miettes, une médiane non.
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

/// Référence : le chemin qui exécute réellement bcrypt. Tout chemin de refus
/// notablement plus rapide que celui-ci est distinguable au chronomètre.
async function bcryptBaseline() {
  findUserForLogin.mockResolvedValue(user());
  const baseline = await medianDuration(() =>
    authenticateWithPassword("connu@homecyclhome.fr", "mauvais-mot-de-passe"),
  );
  // Garde-fou : si bcrypt lui-même est instantané, la mesure ne veut rien
  // dire et l'échec du test ne serait pas interprétable.
  expect(baseline).toBeGreaterThan(5);
  return baseline;
}

beforeEach(() => vi.clearAllMocks());

describe("authenticateWithPassword — indiscernabilité au chronomètre", () => {
  it("ne répond pas plus vite sur un email inconnu que sur un mot de passe faux", async () => {
    const baseline = await bcryptBaseline();

    findUserForLogin.mockResolvedValue(null);
    const unknownEmail = await medianDuration(() =>
      authenticateWithPassword(
        "inconnu@homecyclhome.fr",
        "mauvais-mot-de-passe",
      ),
    );

    // Seuil délibérément large — on ne cherche pas une égalité stricte, mais
    // un ordre de grandeur. Un `return REFUSED` avant bcrypt
    // (src/lib/auth/authenticate.ts:30) produit un rapport de l'ordre de 100x,
    // mesurable à distance et sur un réseau bruité.
    expect(unknownEmail).toBeGreaterThan(baseline * 0.5);
  });

  it("ne répond pas plus vite sur un compte sans provider local", async () => {
    const baseline = await bcryptBaseline();

    // Un compte OAuth pur EXISTE. Répondre instantanément revient à confirmer
    // à la fois l'existence du compte et le fait qu'il n'a pas de mot de
    // passe — soit exactement l'énumération que la Constitution §4.2 interdit.
    findUserForLogin.mockResolvedValue(user({ authProviders: [] }));
    const noLocalProvider = await medianDuration(() =>
      authenticateWithPassword("oauth@homecyclhome.fr", "mauvais-mot-de-passe"),
    );

    expect(noLocalProvider).toBeGreaterThan(baseline * 0.5);
  });

  it("garde les quatre causes de refus dans le même ordre de grandeur", async () => {
    // Formulation DIRECTE de la propriété, ajoutée après le correctif : les
    // trois tests ci-dessus comparent chaque cause à une référence, celui-ci
    // compare les causes ENTRE ELLES. C'est ce que voit un attaquant — il n'a
    // pas de référence, il a quatre séries de mesures et cherche laquelle
    // décroche.
    //
    // Il n'avait aucun sens avant le leurre : le rapport était de 1 300× à
    // 16 000×, et l'échec n'aurait rien appris de plus que les deux tests
    // précédents.
    const causes: Array<[string, unknown, string]> = [
      ["email inconnu", null, "mauvais-mot-de-passe"],
      ["mot de passe faux", user(), "mauvais-mot-de-passe"],
      ["sans provider local", user({ authProviders: [] }), "peu-importe"],
      ["compte désactivé", user({ isActive: false }), "bon-mot-de-passe"],
    ];

    const mesures = new Map<string, number>();
    for (const [libelle, valeur, motDePasse] of causes) {
      findUserForLogin.mockResolvedValue(valeur);
      mesures.set(
        libelle,
        await medianDuration(() =>
          authenticateWithPassword("cible@homecyclhome.fr", motDePasse),
        ),
      );
    }

    const durees = [...mesures.values()];
    const min = Math.min(...durees);
    const max = Math.max(...durees);

    // Garde-fou : sans bcrypt réellement exécuté, le rapport serait trivial.
    expect(min).toBeGreaterThan(5);
    // Seuil large — on ne cherche pas l'égalité au nanoseconde, on cherche
    // l'absence de décrochage. 3× reste indétectable derrière la variance
    // réseau ; 1 300× ne l'était pas.
    expect(max / min).toBeLessThan(3);
  });

  it("ne répond pas plus vite sur un compte désactivé", async () => {
    // Celui-ci devrait passer : `isActive` est vérifié APRÈS le mot de passe
    // (src/lib/auth/authenticate.ts:35-38), donc bcrypt s'exécute quand même.
    // C'est un ordre correct, et ce test est là pour qu'un refactor qui
    // remonterait le garde `isActive` avant bcrypt se voie immédiatement.
    const baseline = await bcryptBaseline();

    findUserForLogin.mockResolvedValue(user({ isActive: false }));
    const disabled = await medianDuration(() =>
      authenticateWithPassword("desactive@homecyclhome.fr", "bon-mot-de-passe"),
    );

    expect(disabled).toBeGreaterThan(baseline * 0.5);
  });
});
