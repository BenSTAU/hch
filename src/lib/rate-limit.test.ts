// @vitest-environment node
//
// Compteur anti-abus. PLAN S4 §11 : une table générique, une clé, et deux
// régimes depuis l'amendement du 2026-08-09. Fenêtre GLISSANTE pour les renvois
// d'activation et les demandes de réinitialisation (T-V3-05), servie par
// `consumeRateLimit`. Blocage FERME de 10 minutes pour les échecs de connexion
// (T-V3-03), servi par `peekLoginLockout`.
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
  LOGIN_LOCKOUT_MS,
  activationRateLimitKey,
  clearRateLimit,
  consumeRateLimit,
  loginRateLimitKey,
  peekLoginLockout,
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

  it("bloque la connexion 10 minutes fermes au bout de 5 échecs", () => {
    // module-1-utilisateurs.md:298-300 amendée le 2026-08-09, reprise par PLAN
    // S4 §11.1. La durée n'est plus une fenêtre qui glisse mais un blocage qui
    // expire, d'où le nom : `WINDOW` sur une valeur qui ne glisse plus serait
    // un identifiant menteur.
    expect(LOGIN_FAILURE_LIMIT).toBe(5);
    expect(LOGIN_LOCKOUT_MS).toBe(10 * 60 * 1000);
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

// La connexion compte les tentatives ÉCHOUÉES (SPEC §298-300), pas les
// tentatives tout court : on ne sait pas si l'authentification échoue avant de
// l'avoir tentée. `consumeRateLimit`, qui lit et enregistre d'un seul geste, ne
// peut donc pas servir ici, d'où les deux temps `peekLoginLockout` puis
// `recordRateLimitAttempt`. Il reste, inchangé, pour les usages qui décomptent
// à l'appel.
//
// Régime propre au préfixe `login:`, amendé le 2026-08-09 (SPEC §298-309, PLAN
// S4 §11.1). Cinq échecs arment un blocage de 10 minutes FERMES, puis le
// compteur repart de zéro. La fenêtre ne glisse plus : c'est ce qui ferme le
// verrou indéfini qu'une requête toutes les 3 minutes suffisait à tenir sur le
// compte d'un tiers. Les deux autres usages gardent la fenêtre glissante, et
// c'est `consumeRateLimit` qui les sert, plus bas dans ce fichier.
describe("peekLoginLockout - blocage ferme", () => {
  it("autorise sous le seuil sans rien enregistrer", async () => {
    findMany.mockResolvedValue([ilYA(10), ilYA(5)]);

    const verdict = await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: true });
    expect(create).not.toHaveBeenCalled();
  });

  it("bloque au 5e échec et date l'échéance sur CET échec, pas sur le premier", async () => {
    // Le pivot du changement. En fenêtre glissante le délai partait de la plus
    // ANCIENNE des cinq (ici 60 000 ms) : c'est elle qui allait sortir et
    // libérer un jeton. Un blocage ferme part du 5e échec, celui qui arme le
    // verrou, et dure 10 minutes pleines quoi qu'il arrive ensuite.
    findMany.mockResolvedValue([ilYA(14), ilYA(10), ilYA(6), ilYA(3), ilYA(1)]);

    const verdict = await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: false, retryAfterMs: 9 * 60_000 });
  });

  it("n'enregistre rien même quand il refuse", async () => {
    findMany.mockResolvedValue([ilYA(14), ilYA(10), ilYA(6), ilYA(3), ilYA(1)]);

    await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(create).not.toHaveBeenCalled();
  });

  it("ne prolonge pas l'échéance quand on insiste pendant le blocage", async () => {
    // La 6e tentative, puis la 7e deux minutes plus tard, lisent le même 5e
    // échec : l'échéance ne bouge pas d'une milliseconde, elle se rapproche.
    // C'est exactement le défaut relevé le 2026-08-09 - marteler tenait le
    // verrou ouvert indéfiniment.
    findMany.mockResolvedValue([ilYA(14), ilYA(10), ilYA(6), ilYA(3), ilYA(1)]);

    const sixieme = await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });
    const septieme = await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: new Date(MAINTENANT.getTime() + 2 * 60_000),
    });

    expect(sixieme).toEqual({ allowed: false, retryAfterMs: 9 * 60_000 });
    expect(septieme).toEqual({ allowed: false, retryAfterMs: 7 * 60_000 });
    expect(create).not.toHaveBeenCalled();
  });

  it("tient encore une seconde avant l'échéance", async () => {
    findMany.mockResolvedValue([
      ilYA(14),
      ilYA(13),
      ilYA(12),
      ilYA(11),
      { attemptedAt: new Date(MAINTENANT.getTime() - (10 * 60_000 - 1_000)) },
    ]);

    const verdict = await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: false, retryAfterMs: 1_000 });
  });

  it("remet le compteur à zéro à l'expiration, et l'efface vraiment", async () => {
    // « puis compteur remis à zéro » (SPEC §300). La remise à zéro doit être
    // ÉCRITE : laisser les cinq lignes en place ferait retomber la 6e tentative
    // sur un compteur déjà plein, et le blocage se rearmerait tout seul.
    findMany.mockResolvedValue([
      ilYA(24),
      ilYA(20),
      ilYA(16),
      ilYA(14),
      ilYA(10),
    ]);

    const verdict = await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: true });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        key: "login:a@b.test",
        // Borné aux lignes RELUES, pas la clé entière : un échec concurrent
        // enregistré entre la lecture et la suppression appartient au cycle
        // suivant et ne doit pas disparaître avec l'ancien.
        attemptedAt: { lte: new Date(MAINTENANT.getTime() - 10 * 60_000) },
      },
    });
  });

  it("ne fait plus glisser la fenêtre : cinq échecs étalés bloquent quand même", async () => {
    // Quatre échecs très anciens et un récent. En fenêtre glissante de 15 min,
    // les quatre premiers étaient sortis et la tentative passait. Le compteur
    // ferme ne les oublie plus : seuls une connexion réussie (`clearRateLimit`)
    // ou la purge des 24 h les effacent. Conséquence assumée de l'amendement.
    findMany.mockResolvedValue([
      ilYA(90),
      ilYA(88),
      ilYA(86),
      ilYA(84),
      ilYA(5),
    ]);

    const verdict = await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(verdict).toEqual({ allowed: false, retryAfterMs: 5 * 60_000 });
  });

  it("compte pour une chaîne qui ne désigne aucun compte", async () => {
    // PLAN S4 §11.2. C'est la propriété qui empêche « trop de tentatives » de
    // devenir un oracle d'existence : le helper ne consulte jamais `users`.
    const verdict = await peekLoginLockout(
      "login:inconnu@example.test",
      5,
      10 * 60_000,
      { now: MAINTENANT },
    );

    expect(verdict).toEqual({ allowed: true });
  });

  it("lit la clé sans borne de fenêtre, et laisse la purge des 24 h trancher", async () => {
    // Plus de borne `gte` : une ligne dans la table appartient au cycle
    // courant tant que le blocage n'a pas expiré, quel que soit son âge.
    await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "login:a@b.test" } }),
    );
  });

  it("purge sur 24 h, la plus large des fenêtres", async () => {
    // Purger sur 10 min effacerait les lignes que le renvoi d'activation compte
    // encore sur 24 h, et un attaquant obtiendrait un quota de renvoi neuf en
    // soumettant une connexion.
    await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        attemptedAt: { lt: new Date(MAINTENANT.getTime() - 24 * 60 * 60_000) },
      },
    });
  });

  it("borne la lecture au plafond", async () => {
    // `take: limit`, en ordre croissant : la 5e ligne lue est l'échec qui arme
    // le verrou. La lecture est faite à chaque soumission, y compris par qui
    // martèle - sans borne, chaque refus coûterait de plus en plus cher.
    await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, orderBy: { attemptedAt: "asc" } }),
    );
  });

  it("ne lit que la clé demandée, jamais l'ensemble de la table", async () => {
    // Un plafond global transformerait cinq erreurs de frappe d'un visiteur en
    // déni de service pour tous les autres.
    findMany.mockResolvedValue([ilYA(1), ilYA(2), ilYA(3), ilYA(4), ilYA(5)]);

    await peekLoginLockout("login:a@b.test", 5, 10 * 60_000, {
      now: MAINTENANT,
    });

    const args = findMany.mock.calls[0]?.[0] as { where: { key: string } };
    expect(args.where.key).toBe("login:a@b.test");
  });
});

describe("cloisonnement des usages", () => {
  // Ajouts de l'agent testeur. La table est PARTAGÉE entre des compteurs aux
  // plafonds très différents, et depuis le 2026-08-09 aux régimes différents :
  // 5 échecs puis 10 min de verrou ferme pour la connexion, 3/24 h glissantes
  // pour le renvoi d'activation, autant pour la réinitialisation en T-V3-05. Le
  // seul séparateur est le préfixe de clé : s'il fuit, le quota le plus
  // permissif rouvre le plus strict.

  it("n'ouvre aucune collision entre les deux espaces de noms", async () => {
    // Ni l'un ni l'autre des préfixes n'est préfixe de l'autre, donc aucune
    // adresse - si tordue soit-elle - ne peut fabriquer une clé `login:` qui
    // vaille une clé `activation:`.
    const tordues = [
      "activation:victime@example.test",
      "login:victime@example.test",
      "",
      ":",
      "a@b.test",
    ];

    for (const valeur of tordues) {
      expect(loginRateLimitKey(valeur)).not.toBe(
        activationRateLimitKey(valeur),
      );
      expect(loginRateLimitKey(valeur).startsWith("activation:")).toBe(false);
      expect(activationRateLimitKey(valeur).startsWith("login:")).toBe(false);
    }
  });

  it("n'efface que la clé visée, pas les autres compteurs du même email", async () => {
    // `clearRateLimit` est appelé par la connexion RÉUSSIE
    // (src/lib/actions/auth/login.ts:64). S'il effaçait par email plutôt que
    // par clé, une connexion réussie remettrait à zéro le quota de renvoi
    // d'activation - 3 emails par 24 h deviendrait 3 par connexion, soit un
    // relais de spam authentifié.
    await clearRateLimit(loginRateLimitKey("victime@example.test"));

    expect(deleteMany).toHaveBeenCalledWith({
      where: { key: "login:victime@example.test" },
    });
    expect(deleteMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          key: "activation:victime@example.test",
        }),
      }),
    );
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
    // quinze minutes suivantes. Non tranché par S4 §11 - arbitré le 2026-08-09,
    // à répercuter au write-back.
    await clearRateLimit("login:a@b.test");

    expect(deleteMany).toHaveBeenCalledWith({
      where: { key: "login:a@b.test" },
    });
  });
});

describe("consumeRateLimit - sous le seuil", () => {
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

describe("consumeRateLimit - au seuil", () => {
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

describe("consumeRateLimit - purge", () => {
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

describe("consumeRateLimit - la clé compte pour toute chaîne", () => {
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
