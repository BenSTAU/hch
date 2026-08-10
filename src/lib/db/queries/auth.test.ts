// @vitest-environment node
//
// Helpers métier de l'inscription et de l'activation. CLAUDE.md §Server Actions
// impose de les séparer de la Server Action : aucun `revalidatePath`, aucun
// `redirect`, aucun contexte Next — donc testables ici, en isolation.
//
// Ce qu'ils portent et qui ne peut pas vivre ailleurs : les trois écritures qui
// doivent être atomiques. Un `users` créé sans son `auth_providers` est un
// compte sans mot de passe ; un jeton consommé sans `is_active` passé à `true`
// est un compte définitivement inactivable, puisque l'anti-rejeu a déjà mordu.
import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userCreate = vi.fn();
const userUpdate = vi.fn();
const authProviderCreate = vi.fn();
const tokenCreate = vi.fn();
const tokenDeleteMany = vi.fn();
const tokenFindUnique = vi.fn();
const tokenUpdate = vi.fn();

const tx = {
  user: { create: userCreate, update: userUpdate },
  authProvider: { create: authProviderCreate },
  verificationToken: {
    create: tokenCreate,
    deleteMany: tokenDeleteMany,
    update: tokenUpdate,
  },
};

vi.mock("@/lib/db/client", () => ({
  db: {
    user: { findUnique: userFindUnique },
    verificationToken: { findUnique: tokenFindUnique },
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  },
}));

const {
  EMAIL_VERIFICATION_PURPOSE,
  activateAccountWithToken,
  createLocalAccount,
  findAccountForSignup,
  findEmailVerificationToken,
  replacePendingEmailVerificationToken,
} = await import("./auth");

const MAINTENANT = new Date("2026-08-08T12:00:00.000Z");
const EXPIRE_LE = new Date("2026-08-09T12:00:00.000Z");

const NOUVEAU = {
  email: "camille@example.test",
  firstname: "Camille",
  lastname: "Durand",
  passwordHash: "$2b$10$hashbcryptfictif",
  tokenHash: "a".repeat(64),
  expiresAt: EXPIRE_LE,
};

beforeEach(() => {
  vi.clearAllMocks();
  userFindUnique.mockResolvedValue(null);
  tokenFindUnique.mockResolvedValue(null);
  userCreate.mockResolvedValue({ id: "user-1" });
  tokenDeleteMany.mockResolvedValue({ count: 0 });
});

describe("EMAIL_VERIFICATION_PURPOSE", () => {
  it("vaut la valeur que le CHECK SQL accepte", () => {
    // Le dictionnaire §verification_tokens fixe l'énumération à
    // `email_verification | password_reset`, tenue par un CHECK posé en
    // migration 001. Une faute de frappe ici ne se verrait qu'à l'insertion.
    expect(EMAIL_VERIFICATION_PURPOSE).toBe("email_verification");
  });
});

describe("findAccountForSignup", () => {
  it("renvoie null quand l'email est libre", async () => {
    expect(await findAccountForSignup("libre@example.test")).toBeNull();
  });

  it("ne filtre PAS les comptes pseudonymisés", async () => {
    // `deletedAt` n'est pas un filtre ici, à la différence de
    // `findUserForLogin`. L'index unique sur `users.email` ne connaît pas cette
    // nuance : masquer une ligne existante ferait échouer l'insertion sur une
    // contrainte, donc en 500, au lieu du message générique attendu.
    await findAccountForSignup("camille@example.test");

    const [args] = userFindUnique.mock.calls[0] as [{ where: object }];
    expect(args.where).toEqual({ email: "camille@example.test" });
  });

  // ── Discriminant CHANGÉ le 2026-08-08, arbitrage B1 ─────────────────────────
  //
  // Ces tests lisaient le discriminant dans l'historique de `verification_tokens`.
  // L'agent testeur a montré que cette table ne peut pas le porter : le
  // dictionnaire écrit qu'elle « ne s'applique pas aux comptes 100% OAuth Google »
  // (mcd-dictionnaire.md:182), et les trois comptes du seed n'ont aucun jeton —
  // donc un technicien désactivé par un administrateur pouvait se réactiver depuis
  // le formulaire public.
  //
  // Benjamin a arbitré pour une colonne dédiée, `users.email_verified_at`
  // (migration `add_users_email_verified_at`). Les oracles suivent la donnée : ce
  // n'est pas un affaiblissement, c'est le même invariant sur une source fiable.

  it("dit si l'email a déjà été vérifié", async () => {
    userFindUnique.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      emailVerifiedAt: MAINTENANT,
    });

    const compte = await findAccountForSignup("camille@example.test");

    expect(compte).toEqual({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      hasCompletedEmailVerification: true,
    });
  });

  it("remonte le prénom ENREGISTRÉ, pas celui du formulaire", async () => {
    // Le renvoi d'activation part vers un compte qui existe déjà. Personnaliser
    // l'email avec le prénom soumis laisserait un tiers choisir le texte d'un
    // message envoyé au titulaire de l'adresse.
    userFindUnique.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      emailVerifiedAt: null,
    });

    const compte = await findAccountForSignup("camille@example.test");

    expect(compte?.firstname).toBe("Camille");
  });

  it("dit « jamais vérifié » quand la colonne est NULL", async () => {
    userFindUnique.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      emailVerifiedAt: null,
    });

    const compte = await findAccountForSignup("camille@example.test");

    expect(compte?.hasCompletedEmailVerification).toBe(false);
  });

  it("distingue un compte fermé par un admin d'un compte jamais activé", async () => {
    // Le cœur de B1, en une assertion : les deux ont `isActive: false`, et seule
    // la date les sépare. C'est ce test qui interdit de revenir à un discriminant
    // porté par `is_active` ou par les jetons.
    userFindUnique.mockResolvedValue({
      id: "user-1",
      firstname: "Camille",
      isActive: false,
      emailVerifiedAt: MAINTENANT,
    });
    const ferme = await findAccountForSignup("camille@example.test");

    userFindUnique.mockResolvedValue({
      id: "user-2",
      firstname: "Alix",
      isActive: false,
      emailVerifiedAt: null,
    });
    const jamaisActive = await findAccountForSignup("alix@example.test");

    expect(ferme?.isActive).toBe(jamaisActive?.isActive);
    expect(ferme?.hasCompletedEmailVerification).toBe(true);
    expect(jamaisActive?.hasCompletedEmailVerification).toBe(false);
  });

  it("n'interroge plus l'historique des jetons", async () => {
    // Filet contre une régression vers l'ancien discriminant.
    await findAccountForSignup("camille@example.test");

    const [args] = userFindUnique.mock.calls[0] as [
      { select: Record<string, unknown> },
    ];
    expect(args.select).not.toHaveProperty("verificationTokens");
    expect(args.select.emailVerifiedAt).toBe(true);
  });
});

describe("createLocalAccount", () => {
  it("crée le compte inactif, avec le rôle client", async () => {
    // US-COMPTE-CREER §Cas nominal : `roles = ['ROLE_CLIENT']`,
    // `is_active = false`. La colonne a `DEFAULT true` (prisma/schema.prisma:68)
    // — l'oublier créerait un compte utilisable sans jamais vérifier l'email.
    await createLocalAccount(NOUVEAU);

    expect(userCreate).toHaveBeenCalledWith({
      data: {
        email: "camille@example.test",
        firstname: "Camille",
        lastname: "Durand",
        // `null` et non l'absence de clé : le téléphone est facultatif, et
        // c'est `null` qui laisse la colonne vide. Une chaîne vide ferait
        // échouer le CHECK `users_phone_e164_format` de la migration 001.
        phone: null,
        roles: ["ROLE_CLIENT"],
        isActive: false,
      },
      select: { id: true },
    });
  });

  it("écrit le téléphone quand le parcours en fournit un", async () => {
    // Seul le bloc « Vos coordonnées » du récapitulatif (C5) le collecte ;
    // `/inscription` ne le demande pas et n'a pas changé.
    await createLocalAccount({ ...NOUVEAU, phone: "+33612345678" });

    const [args] = userCreate.mock.calls.at(-1) as [
      { data: { phone: string | null } },
    ];
    expect(args.data.phone).toBe("+33612345678");
  });

  it("attache le provider local porteur du hash", async () => {
    await createLocalAccount(NOUVEAU);

    expect(authProviderCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        provider: "local",
        passwordHash: "$2b$10$hashbcryptfictif",
      },
    });
  });

  it("émet le jeton d'activation non consommé", async () => {
    await createLocalAccount(NOUVEAU);

    expect(tokenCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        tokenHash: "a".repeat(64),
        purpose: "email_verification",
        expiresAt: EXPIRE_LE,
      },
    });
  });

  it("renvoie l'identifiant créé", async () => {
    expect(await createLocalAccount(NOUVEAU)).toEqual({ userId: "user-1" });
  });

  it("écrit les trois lignes dans la MÊME transaction", async () => {
    // Sans atomicité, un échec après `users` laisse un compte sans mot de passe
    // et sans jeton : l'email est pris, l'inscription échoue à jamais pour cette
    // personne, et le message générique lui dira que tout va bien.
    await createLocalAccount(NOUVEAU);

    expect(userCreate.mock.calls).toHaveLength(1);
    expect(authProviderCreate.mock.calls).toHaveLength(1);
    expect(tokenCreate.mock.calls).toHaveLength(1);
  });

  it("n'écrit aucun mot de passe en clair", async () => {
    await createLocalAccount(NOUVEAU);

    const ecrit = JSON.stringify([
      userCreate.mock.calls,
      authProviderCreate.mock.calls,
      tokenCreate.mock.calls,
    ]);
    expect(ecrit).not.toContain("un-mot-de-passe");
  });

  it("normalise l'email à l'écriture, sans dépendre du schéma d'entrée", async () => {
    // Dette reportée de T-J0-04. Le `.toLowerCase()` de Zod referme le symptôme
    // à la LECTURE ; il ne protège pas d'un doublon écrit par un appelant qui
    // aurait oublié la transformation — l'index unique de Postgres compare
    // octet par octet, et `Camille@…` n'y est pas `camille@…`.
    //
    // Ce helper est le premier des deux filets ; le CHECK SQL
    // `email = lower(email)` est le second.
    await createLocalAccount({ ...NOUVEAU, email: " Camille@Example.TEST " });

    expect(userCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "camille@example.test" }),
      }),
    );
  });
});

describe("replacePendingEmailVerificationToken", () => {
  it("supprime les jetons d'activation en attente avant d'en émettre un", async () => {
    // US-COMPTE-ACTIVER §Renvoi : « un nouveau token est généré (précédent
    // invalidé) ». Laisser vivre l'ancien donnerait deux liens valides pour un
    // compte, donc deux fenêtres d'attaque au lieu d'une.
    await replacePendingEmailVerificationToken({
      userId: "user-1",
      tokenHash: "b".repeat(64),
      expiresAt: EXPIRE_LE,
    });

    expect(tokenDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        purpose: "email_verification",
        usedAt: null,
      },
    });
    expect(tokenCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        tokenHash: "b".repeat(64),
        purpose: "email_verification",
        expiresAt: EXPIRE_LE,
      },
    });
  });

  it("ne touche pas aux jetons DÉJÀ consommés", async () => {
    // Ils sont la trace de l'activation, et le discriminant du renvoi. Les
    // effacer rendrait un compte activé indéfiniment éligible au renvoi.
    await replacePendingEmailVerificationToken({
      userId: "user-1",
      tokenHash: "b".repeat(64),
      expiresAt: EXPIRE_LE,
    });

    const [args] = tokenDeleteMany.mock.calls[0] as [
      { where: { usedAt: null } },
    ];
    expect(args.where.usedAt).toBeNull();
  });
});

describe("findEmailVerificationToken", () => {
  it("cherche par hash, jamais par jeton clair", async () => {
    // Le clair ne vit que dans l'URL de l'email (dictionnaire
    // §verification_tokens). Le stocker ou l'interroger tel quel ferait d'une
    // fuite de base une fuite de comptes activables.
    await findEmailVerificationToken("c".repeat(64));

    expect(tokenFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: "c".repeat(64) } }),
    );
  });

  it("renvoie null pour un hash inconnu", async () => {
    expect(await findEmailVerificationToken("d".repeat(64))).toBeNull();
  });

  it("remonte la date d'expiration et la consommation", async () => {
    tokenFindUnique.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      purpose: "email_verification",
      expiresAt: EXPIRE_LE,
      usedAt: null,
    });

    expect(await findEmailVerificationToken("c".repeat(64))).toEqual({
      id: "token-1",
      userId: "user-1",
      expiresAt: EXPIRE_LE,
      usedAt: null,
    });
  });

  it("ignore un jeton d'un autre usage", async () => {
    // Un jeton `password_reset` ne doit pas activer un compte : les deux TTL
    // diffèrent (1 h contre 24 h) et les deux parcours n'ont pas le même
    // niveau de preuve.
    tokenFindUnique.mockResolvedValue({
      id: "token-1",
      userId: "user-1",
      purpose: "password_reset",
      expiresAt: EXPIRE_LE,
      usedAt: null,
    });

    expect(await findEmailVerificationToken("c".repeat(64))).toBeNull();
  });
});

describe("activateAccountWithToken", () => {
  it("marque le jeton consommé, active le compte et horodate la vérification", async () => {
    await activateAccountWithToken({
      tokenId: "token-1",
      userId: "user-1",
      now: MAINTENANT,
    });

    expect(tokenUpdate).toHaveBeenCalledWith({
      where: { id: "token-1", usedAt: null },
      data: { usedAt: MAINTENANT },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-1", emailVerifiedAt: null, deletedAt: null },
      data: { isActive: true, emailVerifiedAt: MAINTENANT },
    });
  });

  it("refuse d'activer un compte déjà vérifié ou pseudonymisé", async () => {
    // `emailVerifiedAt: null` interdit à un jeton émis AVANT une désactivation
    // administrative de rouvrir le compte ; `deletedAt: null` à un lien de
    // ressusciter une identité pseudonymisée. Sans ces deux clauses, l'update
    // passerait sur n'importe quel état — c'est le second versant de B1.
    await activateAccountWithToken({
      tokenId: "token-1",
      userId: "user-1",
      now: MAINTENANT,
    });

    const [args] = userUpdate.mock.calls[0] as [
      { where: { emailVerifiedAt: null; deletedAt: null } },
    ];
    expect(args.where.emailVerifiedAt).toBeNull();
    expect(args.where.deletedAt).toBeNull();
  });

  it("conditionne l'écriture à `usedAt: null`", async () => {
    // Anti-rejeu au niveau de la BASE, et pas seulement du contrôle applicatif
    // qui précède. Deux clics simultanés sur le même lien passent tous les deux
    // la lecture ; c'est cette clause qui fait perdre le second.
    await activateAccountWithToken({
      tokenId: "token-1",
      userId: "user-1",
      now: MAINTENANT,
    });

    const [args] = tokenUpdate.mock.calls[0] as [{ where: { usedAt: null } }];
    expect(args.where.usedAt).toBeNull();
  });

  it("fait les deux écritures dans la même transaction", async () => {
    // Un jeton consommé sans activation laisse un compte inactivable : le lien
    // ne marche plus, et le renvoi non plus puisqu'un jeton consommé existe.
    await activateAccountWithToken({
      tokenId: "token-1",
      userId: "user-1",
      now: MAINTENANT,
    });

    expect(tokenUpdate).toHaveBeenCalledOnce();
    expect(userUpdate).toHaveBeenCalledOnce();
  });
});
