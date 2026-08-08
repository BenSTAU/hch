// @vitest-environment node
//
// Compteur anti-abus. PLAN S4 §11 : une table générique, une clé, une fenêtre
// glissante, un helper pour les trois usages — renvois d'activation (ici),
// échecs de connexion (T-V3-03) et demandes de réinitialisation (T-V3-05).
//
// Le motif du choix est l'anti-énumération, pas le stockage : un compteur porté
// par des colonnes de `users` n'existerait pas pour un email inconnu, et
// « trop de tentatives » ne s'afficherait que pour les comptes existants. La
// propriété à préserver, c'est que la clé compte pour **toute chaîne tentée**.
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const create = vi.fn();
const deleteMany = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: { rateLimit: { findMany, create, deleteMany } },
}));

const {
  ACTIVATION_RESEND_LIMIT,
  ACTIVATION_RESEND_WINDOW_MS,
  activationRateLimitKey,
  consumeRateLimit,
} = await import("./rate-limit");

const MAINTENANT = new Date("2026-08-08T12:00:00.000Z");

function ilYA(minutes: number): { attemptedAt: Date } {
  return { attemptedAt: new Date(MAINTENANT.getTime() - minutes * 60_000) };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  deleteMany.mockResolvedValue({ count: 0 });
});

describe("seuils", () => {
  it("plafonne les renvois d'activation à 3 par 24 h", () => {
    // module-1-utilisateurs.md:233, repris par PLAN S4 §11.1.
    expect(ACTIVATION_RESEND_LIMIT).toBe(3);
    expect(ACTIVATION_RESEND_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("préfixe la clé par l'usage, jamais l'email seul", () => {
    // Trois usages partagent la table. Sans préfixe, un échec de connexion
    // consommerait le quota de renvoi d'activation du même email.
    expect(activationRateLimitKey("client@example.test")).toBe(
      "activation:client@example.test",
    );
  });
});

describe("consumeRateLimit — sous le seuil", () => {
  it("autorise et enregistre la tentative", async () => {
    const verdict = await consumeRateLimit("activation:a@b.test", 3, 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: true });
    expect(create).toHaveBeenCalledWith({
      data: { key: "activation:a@b.test", attemptedAt: MAINTENANT },
    });
  });

  it("ne compte que les tentatives DANS la fenêtre", async () => {
    await consumeRateLimit("activation:a@b.test", 3, 15 * 60_000, {
      now: MAINTENANT,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          key: "activation:a@b.test",
          attemptedAt: { gte: new Date(MAINTENANT.getTime() - 15 * 60_000) },
        },
      }),
    );
  });

  it("autorise la tentative qui atteint tout juste le seuil", async () => {
    findMany.mockResolvedValue([ilYA(10), ilYA(5)]);

    const verdict = await consumeRateLimit("activation:a@b.test", 3, 60 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: true });
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("consumeRateLimit — au seuil", () => {
  it("refuse quand la fenêtre est pleine", async () => {
    findMany.mockResolvedValue([ilYA(30), ilYA(20), ilYA(10)]);

    const verdict = await consumeRateLimit("activation:a@b.test", 3, 60 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: false, retryAfterMs: 30 * 60_000 });
  });

  it("n'enregistre RIEN sur un refus", async () => {
    // Sinon la fenêtre ne se vide jamais : chaque tentative refusée repousse
    // l'échéance, et le plafond devient un bannissement définitif.
    findMany.mockResolvedValue([ilYA(30), ilYA(20), ilYA(10)]);

    await consumeRateLimit("activation:a@b.test", 3, 60 * 60_000, {
      now: MAINTENANT,
    });

    expect(create).not.toHaveBeenCalled();
  });

  it("calcule le délai depuis la tentative la PLUS ANCIENNE de la fenêtre", async () => {
    // C'est elle qui sortira la première, donc elle qui libère un jeton. Partir
    // de la plus récente ferait attendre une fenêtre entière à quelqu'un dont
    // le quota se libère dans une minute.
    findMany.mockResolvedValue([ilYA(23 * 60), ilYA(60), ilYA(1)]);

    const verdict = await consumeRateLimit(
      "activation:a@b.test",
      3,
      24 * 60 * 60_000,
      { now: MAINTENANT },
    );

    expect(verdict).toEqual({ allowed: false, retryAfterMs: 60 * 60_000 });
  });
});

describe("consumeRateLimit — purge", () => {
  it("supprime les lignes de plus de 24 h à chaque lecture", async () => {
    // Purge opportuniste, pas de tâche planifiée (PLAN S4 §11.2). 24 h est la
    // plus large des trois fenêtres : purger sur la fenêtre de l'appelant
    // effacerait les lignes que les deux autres usages comptent encore.
    await consumeRateLimit("activation:a@b.test", 3, 15 * 60_000, {
      now: MAINTENANT,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        attemptedAt: {
          lt: new Date(MAINTENANT.getTime() - 24 * 60 * 60 * 1000),
        },
      },
    });
  });
});

describe("consumeRateLimit — la clé compte pour toute chaîne", () => {
  it("compte un email qui ne correspond à aucun compte", async () => {
    // La propriété anti-énumération de PLAN S4 §11.2. Le helper ne consulte
    // JAMAIS `users` : il ne sait pas, et ne doit pas savoir, si la clé
    // désigne un compte existant.
    const verdict = await consumeRateLimit(
      "activation:inconnu@example.test",
      3,
      60_000,
      { now: MAINTENANT },
    );

    expect(verdict).toEqual({ allowed: true });
    expect(create).toHaveBeenCalledWith({
      data: {
        key: "activation:inconnu@example.test",
        attemptedAt: MAINTENANT,
      },
    });
  });
});
