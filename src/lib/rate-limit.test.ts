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
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MS,
  activationRateLimitKey,
  clearRateLimit,
  consumeRateLimit,
  loginRateLimitKey,
  peekRateLimit,
  recordRateLimitAttempt,
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

  it("plafonne les échecs de connexion à 5 par 15 min", () => {
    // module-1-utilisateurs.md:285-287, repris par PLAN S4 §11.1.
    expect(LOGIN_FAILURE_LIMIT).toBe(5);
    expect(LOGIN_FAILURE_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it("donne à la connexion un préfixe distinct de l'activation", () => {
    expect(loginRateLimitKey("client@example.test")).toBe(
      "login:client@example.test",
    );
    expect(loginRateLimitKey("client@example.test")).not.toBe(
      activationRateLimitKey("client@example.test"),
    );
  });
});

// La connexion compte les tentatives ÉCHOUÉES (SPEC §285-287), pas les
// tentatives tout court : on ne sait pas si l'authentification échoue avant de
// l'avoir tentée. `consumeRateLimit` — qui lit et enregistre d'un seul geste —
// ne peut donc pas servir tel quel, d'où les deux temps ci-dessous. Il reste,
// inchangé, pour les deux usages qui décomptent à l'appel.
describe("peekRateLimit — lecture seule", () => {
  it("autorise sous le seuil sans rien enregistrer", async () => {
    findMany.mockResolvedValue([ilYA(10), ilYA(5)]);

    const verdict = await peekRateLimit("login:a@b.test", 5, 15 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuse au seuil et donne le délai depuis la tentative la plus ancienne", async () => {
    findMany.mockResolvedValue([ilYA(14), ilYA(10), ilYA(6), ilYA(3), ilYA(1)]);

    const verdict = await peekRateLimit("login:a@b.test", 5, 15 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: false, retryAfterMs: 60_000 });
  });

  it("n'enregistre rien même quand il refuse", async () => {
    // Sinon une soumission bloquée repousserait sa propre échéance, et le
    // plafond deviendrait un bannissement définitif pour qui insiste.
    findMany.mockResolvedValue([ilYA(14), ilYA(10), ilYA(6), ilYA(3), ilYA(1)]);

    await peekRateLimit("login:a@b.test", 5, 15 * 60_000, { now: MAINTENANT });

    expect(create).not.toHaveBeenCalled();
  });

  it("compte pour une chaîne qui ne désigne aucun compte", async () => {
    // PLAN S4 §11.2. C'est la propriété qui empêche « trop de tentatives » de
    // devenir un oracle d'existence : le helper ne consulte jamais `users`.
    const verdict = await peekRateLimit(
      "login:inconnu@example.test",
      5,
      15 * 60_000,
      { now: MAINTENANT },
    );

    expect(verdict).toEqual({ allowed: true });
  });
});

describe("recordRateLimitAttempt", () => {
  it("enregistre une tentative sur la clé", async () => {
    await recordRateLimitAttempt("login:a@b.test", { now: MAINTENANT });

    expect(create).toHaveBeenCalledWith({
      data: { key: "login:a@b.test", attemptedAt: MAINTENANT },
    });
  });

  it("ne relit pas la fenêtre pour enregistrer", async () => {
    // L'appelant vient de la lire. Un second aller-retour se paierait dans le
    // tunnel SSH, sur le chemin d'un utilisateur qui vient déjà d'attendre un
    // bcrypt.
    await recordRateLimitAttempt("login:a@b.test", { now: MAINTENANT });

    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("clearRateLimit", () => {
  it("efface les tentatives de la seule clé visée", async () => {
    // Purge après une connexion réussie : quatre erreurs de frappe suivies du
    // bon mot de passe ne doivent pas laisser une mine à retardement pour les
    // quinze minutes suivantes. Non tranché par S4 §11 — arbitré le 2026-08-09,
    // à répercuter au write-back.
    await clearRateLimit("login:a@b.test");

    expect(deleteMany).toHaveBeenCalledWith({
      where: { key: "login:a@b.test" },
    });
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

    const verdict = await consumeRateLimit(
      "activation:a@b.test",
      3,
      60 * 60_000,
      {
        now: MAINTENANT,
      },
    );

    expect(verdict).toEqual({ allowed: true });
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("consumeRateLimit — au seuil", () => {
  it("refuse quand la fenêtre est pleine", async () => {
    findMany.mockResolvedValue([ilYA(30), ilYA(20), ilYA(10)]);

    const verdict = await consumeRateLimit(
      "activation:a@b.test",
      3,
      60 * 60_000,
      {
        now: MAINTENANT,
      },
    );

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
