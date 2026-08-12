// @vitest-environment node
//
// `pseudonymiserCompte` - le droit à l'oubli, seule mutation **irréversible**
// du parcours client. Ce qui est éprouvé ici n'est pas « la fonction écrit les
// bonnes valeurs » mais les quatre propriétés dont dépend la déclaration faite
// au client dans `/politique-confidentialite` :
//
//   · rien n'est effacé sans que le mot de passe ait été vérifié ;
//   · la trace d'audit part dans la MÊME transaction que l'effacement, sinon
//     elle ment (Constitution §4.2) ;
//   · le point GPS du domicile part avec l'adresse, pas seulement la rue ;
//   · l'historique d'intervention n'est jamais touché.
import { beforeEach, describe, expect, it, vi } from "vitest";

const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const userCount = vi.fn();
const authProviderDeleteMany = vi.fn();
const verificationTokenDeleteMany = vi.fn();
const addressUpdateMany = vi.fn();
const executeRaw = vi.fn();
const auditCreate = vi.fn();
const authProviderFindUnique = vi.fn();
const cycleUpdateMany = vi.fn();
const rateLimitDeleteMany = vi.fn();
/// Le `SELECT … FOR UPDATE` qui sérialise les suppressions d'administrateurs.
const queryRaw = vi.fn();

/// Le faux client transactionnel, et ce qu'il OBSERVE : le rappel a-t-il rendu
/// une valeur (commit) ou levé (rollback) ? Même modèle que
/// `interventions.test.ts`.
///
/// La file d'attente de verrous d'`interventions.test.ts` n'est pas reprise, et
/// c'est un choix déclaré : le `SELECT … FOR UPDATE` de la garde des
/// administrateurs est ici observé dans sa FORME et son ORDRE, pas dans son
/// effet. Modéliser l'effet reviendrait à rejouer notre propre hypothèse sur
/// PostgreSQL - constat de l'agent testeur, qui a refusé le test correspondant
/// pour ce motif. L'anti-rejeu du compte, lui, ne repose sur aucun verrou :
/// c'est la clause `deletedAt: null` du `where`, prouvée en base par l'E2E.
const commits: string[] = [];
const rollbacks: string[] = [];

/// Tout ce que le helper touche sur le client transactionnel, dans l'ordre.
///
/// Un `expect(...).not.toHaveBeenCalled()` par modèle non désiré ne vaut rien :
/// il faut connaître d'avance le modèle qu'on redoute. Ce journal-ci prend le
/// problème par l'autre bout et permet d'asserter l'ensemble EXACT des tables
/// écrites, donc de rougir quand une écriture apparaît, quelle qu'elle soit.
const modelesTouches: string[] = [];

function creerTx() {
  const client = {
    user: {
      findUnique: (args: unknown) => userFindUnique(args),
      update: (args: unknown) => userUpdate(args),
      count: (args: unknown) => userCount(args),
    },
    authProvider: {
      deleteMany: (args: unknown) => authProviderDeleteMany(args),
    },
    verificationToken: {
      deleteMany: (args: unknown) => verificationTokenDeleteMany(args),
    },
    address: { updateMany: (args: unknown) => addressUpdateMany(args) },
    cycle: { updateMany: (args: unknown) => cycleUpdateMany(args) },
    rateLimit: { deleteMany: (args: unknown) => rateLimitDeleteMany(args) },
    $executeRaw: (strings: TemplateStringsArray, ...valeurs: unknown[]) =>
      executeRaw(strings.join("?"), valeurs),
    $queryRaw: (strings: TemplateStringsArray, ...valeurs: unknown[]) =>
      queryRaw(strings.join("?"), valeurs),
    auditLog: { create: (args: unknown) => auditCreate(args) },
  };

  return new Proxy(client, {
    get(cible, propriete, recepteur) {
      if (typeof propriete === "string") modelesTouches.push(propriete);
      return Reflect.get(cible, propriete, recepteur);
    },
  });
}

type FauxTx = ReturnType<typeof creerTx>;

const transaction = vi.fn(async (rappel: (client: FauxTx) => unknown) => {
  try {
    const valeur = await rappel(creerTx());
    commits.push("commit");
    return valeur;
  } catch (erreur) {
    rollbacks.push("rollback");
    throw erreur;
  }
});

vi.mock("@/lib/db/client", () => ({
  db: {
    $transaction: (rappel: (client: FauxTx) => unknown) => transaction(rappel),
    // Hors transaction, délibérément : la lecture du hash précède l'ouverture
    // de la transaction, et le test doit pouvoir le constater.
    authProvider: {
      findUnique: (args: unknown) => authProviderFindUnique(args),
    },
  },
}));

const verifyPassword = vi.fn();
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: (clair: string, hash: string) => verifyPassword(clair, hash),
}));

const {
  pseudonymiserCompte,
  emailPseudonyme,
  MARQUE_PSEUDONYME,
  PRENOM_PSEUDONYME,
  NOM_PSEUDONYME,
  RUE_PSEUDONYME,
} = await import("./users");

const UTILISATEUR = "11111111-1111-4111-8111-111111111111";
const MAINTENANT = new Date("2026-08-11T10:00:00.000Z");

function appeler(motDePasse = "correct") {
  return pseudonymiserCompte({
    userId: UTILISATEUR,
    motDePasse,
    maintenant: MAINTENANT,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  commits.length = 0;
  rollbacks.length = 0;
  modelesTouches.length = 0;

  // Réassignés et pas seulement effacés : `clearAllMocks` remet les compteurs à
  // zéro, il ne retire pas une implémentation posée par un test précédent - un
  // `mockRejectedValue` fuirait sur tout ce qui suit.
  userUpdate.mockResolvedValue(undefined);
  authProviderDeleteMany.mockResolvedValue({ count: 1 });
  verificationTokenDeleteMany.mockResolvedValue({ count: 0 });
  addressUpdateMany.mockResolvedValue({ count: 1 });
  cycleUpdateMany.mockResolvedValue({ count: 0 });
  rateLimitDeleteMany.mockResolvedValue({ count: 0 });
  executeRaw.mockResolvedValue(1);
  queryRaw.mockResolvedValue([]);
  auditCreate.mockResolvedValue(undefined);
  authProviderFindUnique.mockResolvedValue({ passwordHash: "$2b$10$hash" });
  verifyPassword.mockResolvedValue(true);
  userFindUnique.mockResolvedValue({
    roles: ["ROLE_CLIENT"],
    email: "camille@exemple.fr",
  });
  userCount.mockResolvedValue(1);
});

describe("pseudonymiserCompte - ce qui empêche d'écrire", () => {
  it("refuse un compte sans mot de passe local sans ouvrir de transaction", async () => {
    authProviderFindUnique.mockResolvedValue(null);

    const resultat = await appeler();

    expect(resultat).toEqual({ ok: false, reason: "sans_mot_de_passe" });
    // La propriété qui compte n'est pas le libellé du refus : c'est qu'un
    // compte Google pur ne peut PAS déclencher la transaction, donc ne peut pas
    // être effacé par une confirmation que personne n'a pu fournir.
    expect(transaction).not.toHaveBeenCalled();
  });

  it("traite un provider local sans hash comme un compte sans mot de passe", async () => {
    // `password_hash` est NULLable et vaut NULL en OAuth pur : une ligne
    // `auth_providers` existante ne prouve pas qu'un mot de passe existe.
    authProviderFindUnique.mockResolvedValue({ passwordHash: null });

    const resultat = await appeler();

    expect(resultat).toEqual({ ok: false, reason: "sans_mot_de_passe" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuse un mot de passe faux sans ouvrir de transaction", async () => {
    verifyPassword.mockResolvedValue(false);

    const resultat = await appeler("faux");

    expect(resultat).toEqual({ ok: false, reason: "mot_de_passe_invalide" });
    expect(transaction).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("vérifie le mot de passe contre le hash stocké, pas contre autre chose", async () => {
    await appeler("secret-du-client");

    expect(verifyPassword).toHaveBeenCalledWith(
      "secret-du-client",
      "$2b$10$hash",
    );
  });

  it("lit le hash du provider `local`, jamais celui d'un autre fournisseur", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-12.
    //
    // Rien n'éprouvait QUEL identifiant sert de second facteur. Le test
    // précédent prouve que le hash lu est bien celui comparé, pas qu'il vient
    // de la bonne ligne : `auth_providers` porte un couple (userId, provider)
    // et `password_hash` est NULLable sur les deux. Une lecture élargie -
    // `findFirst({ where: { userId } })` - rendrait le premier provider venu, et
    // la confirmation de la suppression la plus irréversible du produit se
    // ferait contre un secret que l'US ne désigne pas.
    await appeler();

    expect(authProviderFindUnique).toHaveBeenCalledWith({
      where: { userId_provider: { userId: UTILISATEUR, provider: "local" } },
      select: { passwordHash: true },
    });
  });

  it("refuse le dernier administrateur actif, et n'écrit rien", async () => {
    userFindUnique.mockResolvedValue({
      roles: ["ROLE_ADMIN"],
      email: "camille@exemple.fr",
    });
    userCount.mockResolvedValue(0);

    const resultat = await appeler();

    expect(resultat).toEqual({ ok: false, reason: "dernier_admin" });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(addressUpdateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("déclenche la garde sur un compte qui cumule les rôles", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-12.
    //
    // `users.roles` est un TABLEAU (dictionnaire §users) : l'administrateur du
    // seed porte aussi `ROLE_CLIENT`, et c'est le cas nominal, pas un cas
    // tordu. Une garde écrite `roles[0] === "ROLE_ADMIN"` ou
    // `roles.length === 1` passerait les huit autres tests de ce fichier et
    // laisserait le dernier administrateur s'effacer.
    userFindUnique.mockResolvedValue({
      roles: ["ROLE_CLIENT", "ROLE_ADMIN"],
    });
    userCount.mockResolvedValue(0);

    await expect(appeler()).resolves.toEqual({
      ok: false,
      reason: "dernier_admin",
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("laisse partir un administrateur quand il en reste un autre", async () => {
    userFindUnique.mockResolvedValue({
      roles: ["ROLE_ADMIN"],
      email: "camille@exemple.fr",
    });
    userCount.mockResolvedValue(1);

    await expect(appeler()).resolves.toEqual({ ok: true });
    expect(userUpdate).toHaveBeenCalled();
  });

  it("ne compte les administrateurs restants que parmi les comptes vivants", async () => {
    userFindUnique.mockResolvedValue({
      roles: ["ROLE_ADMIN"],
      email: "camille@exemple.fr",
    });

    await appeler();

    // Un admin désactivé ou déjà pseudonymisé ne peut plus administrer : le
    // compter comme remplaçant laisserait le produit sans aucun administrateur
    // utilisable, ce que Constitution §4.2 interdit.
    expect(userCount).toHaveBeenCalledWith({
      where: {
        id: { not: UTILISATEUR },
        roles: { has: "ROLE_ADMIN" },
        isActive: true,
        deletedAt: null,
      },
    });
  });

  it("n'interroge pas la garde du dernier admin pour un client", async () => {
    await appeler();

    expect(userCount).not.toHaveBeenCalled();
  });

  it("rend un succès sans rien écrire quand le compte est déjà pseudonymisé", async () => {
    // Double soumission, ou lien rejoué. Du point de vue de l'appelant il n'y a
    // plus rien à effacer : c'est un succès, pas une erreur à lui montrer.
    userFindUnique.mockResolvedValue(null);

    await expect(appeler()).resolves.toEqual({ ok: true });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});

describe("pseudonymiserCompte - ce qui est écrit", () => {
  it("remplace les quatre champs identifiants par les valeurs de PLAN S2 T6", async () => {
    await appeler();

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: UTILISATEUR, deletedAt: null },
      data: {
        firstname: PRENOM_PSEUDONYME,
        lastname: NOM_PSEUDONYME,
        email: emailPseudonyme(UTILISATEUR),
        phone: null,
        isActive: false,
        deletedAt: MAINTENANT,
      },
    });
  });

  it("porte l'anti-rejeu dans le where de l'update, pas seulement dans la lecture", async () => {
    await appeler();

    // Deux soumissions concurrentes passent toutes les deux la lecture. C'est
    // cette clause qui fait perdre la seconde, au niveau de la BASE.
    const [args] = userUpdate.mock.calls[0] as [{ where: { deletedAt: null } }];
    expect(args.where.deletedAt).toBeNull();
  });

  it("compose l'email pseudonyme sur un domaine qui n'existe pas", async () => {
    expect(emailPseudonyme(UTILISATEUR)).toBe(
      `deleted-${UTILISATEUR}@anon.local`,
    );
    // Minuscules : le CHECK `users_email_normalized` impose `email = lower(email)`,
    // et une majuscule ferait échouer l'update - donc l'effacement.
    expect(emailPseudonyme(UTILISATEUR)).toBe(
      emailPseudonyme(UTILISATEUR).toLowerCase(),
    );
  });

  it("supprime les identifiants d'authentification et les jetons en attente", async () => {
    await appeler();

    expect(authProviderDeleteMany).toHaveBeenCalledWith({
      where: { userId: UTILISATEUR },
    });
    expect(verificationTokenDeleteMany).toHaveBeenCalledWith({
      where: { userId: UTILISATEUR },
    });
  });

  it("anonymise la rue et retire l'adresse du sélecteur", async () => {
    await appeler();

    expect(addressUpdateMany).toHaveBeenCalledWith({
      where: { userId: UTILISATEUR },
      data: { street: RUE_PSEUDONYME, label: null, isActive: false },
    });
  });

  it("efface le point GPS du domicile, et pas seulement la rue", async () => {
    await appeler();

    // La propriété la plus importante du lot, et celle qu'aucune écriture
    // Prisma ne peut porter : `location` est une colonne `Unsupported`. Sans
    // cette requête, effacer la rue garderait la donnée LA PLUS précise et
    // n'effacerait que la moins sensible - exactement ce que l'amendement du
    // 2026-08-11 à S4 §4.5 refuse pour les photos.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [gabarit, valeurs] = executeRaw.mock.calls[0] as [string, unknown[]];
    expect(gabarit).toMatch(/UPDATE "addresses" SET "location" = NULL/);
    expect(gabarit).toMatch(/WHERE "user_id" =/);
    expect(valeurs).toEqual([UTILISATEUR]);
  });

  it("écrit la trace d'audit dans la transaction, avec l'action du dictionnaire", async () => {
    await appeler();

    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        entityType: "users",
        entityId: UTILISATEUR,
        // `ANONYMIZE`, pas `RGPD_DELETION` : le CHECK SQL de la migration 003
        // ne connaît que six valeurs, et une valeur hors liste ferait échouer
        // l'insertion, donc la suppression qu'elle devait tracer.
        action: "ANONYMIZE",
        // L'acteur est le client lui-même, pas un administrateur.
        actorId: UTILISATEUR,
        details: { deletion_reason: "client_right_to_be_forgotten" },
      },
    });
    expect(commits).toHaveLength(1);
    expect(rollbacks).toHaveLength(0);
  });

  it("n'écrit la trace que si l'effacement a eu lieu", async () => {
    // Une trace d'audit qui survit au rollback de la mutation qu'elle décrit
    // est pire qu'une trace absente : c'est la pièce qu'on produit en cas de
    // contestation. Le seul moyen de le garantir est de la faire échouer AVEC.
    userUpdate.mockRejectedValue(new Error("perte de connexion"));

    await expect(appeler()).rejects.toThrow("perte de connexion");

    expect(auditCreate).not.toHaveBeenCalled();
    expect(rollbacks).toHaveLength(1);
    expect(commits).toHaveLength(0);
  });

  it("n'écrit rien de plus quand l'anti-rejeu de la base fait perdre la course", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-12.
    //
    // Le commentaire du helper décrit ce chemin - « deux soumissions
    // concurrentes passent toutes les deux la lecture, c'est cette clause qui
    // fait perdre la seconde en levant P2025 » - et rien ne l'éprouvait. Le
    // perdant lève DEPUIS l'update, c'est-à-dire APRÈS la lecture des rôles et
    // AVANT les quatre écritures qui suivent : ce qui compte est qu'il ne
    // laisse pas une moitié d'effacement derrière lui.
    //
    // ⚠️ **Oracle inversé le 2026-08-12, sur arbitrage.** L'agent testeur avait
    // fixé la conséquence observable d'alors - le perdant LEVAIT, donc
    // atterrissait en `serverError` générique - en signalant que la divergence
    // avec le rejeu séquentiel (`{ ok: true }`) était à trancher et pas à
    // graver. Elle est tranchée : les deux chemins mènent au même état final,
    // ils rendent la même réponse. Le compte EST effacé, laisser quelqu'un
    // devant « une erreur est survenue » sur une opération irréversible réussie
    // était le vrai défaut (B4).
    //
    // Ce que le test continue de tenir, et qui est l'essentiel : le perdant ne
    // laisse **aucune moitié d'effacement** derrière lui.
    userUpdate.mockRejectedValue(
      Object.assign(new Error("Record to update not found."), {
        code: "P2025",
      }),
    );

    await expect(appeler()).resolves.toEqual({ ok: true });

    expect(authProviderDeleteMany).not.toHaveBeenCalled();
    expect(verificationTokenDeleteMany).not.toHaveBeenCalled();
    expect(addressUpdateMany).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(cycleUpdateMany).not.toHaveBeenCalled();
    expect(rateLimitDeleteMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    // Et il ne fait pas échouer la transaction : il n'y a rien à annuler, la
    // voisine a déjà tout commité.
    expect(rollbacks).toHaveLength(0);
  });

  it("laisse remonter une panne d'écriture qui n'est pas une course", async () => {
    // La contrepartie du test ci-dessus : seul P2025 devient un succès. Une
    // panne quelconque doit continuer de faire échouer la transaction, sinon
    // l'écran annoncerait un effacement qui n'a pas eu lieu.
    userUpdate.mockRejectedValue(
      Object.assign(new Error("deadlock detected"), { code: "P2034" }),
    );

    await expect(appeler()).rejects.toThrow(/deadlock/);
    expect(rollbacks).toHaveLength(1);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("ne touche à aucune table au-delà des sept attendues", async () => {
    await appeler();

    // L'obligation comptable de dix ans porte sur `interventions`, `payments`
    // et `photos`, et c'est ce que la politique de confidentialité déclare au
    // client. L'assertion est volontairement **exhaustive** plutôt que ciblée :
    // une écriture ajoutée ici sur n'importe quelle autre table fait rougir ce
    // test, y compris une table qui n'existe pas encore aujourd'hui.
    //
    // ⚠️ **Passé de cinq à sept le 2026-08-12.** L'agent testeur avait relevé
    // que cet oracle FIGEAIT deux omissions au lieu de les révéler : `cycles`
    // et `rate_limits` portent des données personnelles qu'aucune obligation
    // comptable ne couvre, et le test serait resté vert tant que personne ne
    // les aurait effacées - et aurait rougi le jour où quelqu'un aurait bien
    // fait. C'est le pire des deux mondes, et c'est le motif du correctif.
    expect(new Set(modelesTouches)).toEqual(
      new Set([
        "user",
        "authProvider",
        "verificationToken",
        "address",
        "cycle",
        "rateLimit",
        "$executeRaw",
        "auditLog",
      ]),
    );
  });

  it("anonymise les vélos sans casser leur clé étrangère", async () => {
    await appeler();

    // Supprimer les lignes casserait `interventions.cycle_id` le jour où
    // quelque chose l'écrira, et transformerait un droit à l'oubli en perte
    // d'historique. `brand` est NOT NULL, les deux autres colonnes tombent.
    expect(cycleUpdateMany).toHaveBeenCalledWith({
      where: { userId: UTILISATEUR },
      data: { brand: MARQUE_PSEUDONYME, model: null, year: null },
    });
  });

  it("purge les compteurs de rate-limit portant l'ancienne adresse", async () => {
    await appeler();

    // La table n'a aucune clé étrangère et sa purge est opportuniste : sans ce
    // geste, l'adresse réelle survit à son propre effacement jusqu'à ce qu'un
    // visiteur quelconque déclenche la purge des lignes de plus de 24 h.
    expect(rateLimitDeleteMany).toHaveBeenCalledWith({
      where: {
        key: {
          in: ["login:camille@exemple.fr", "activation:camille@exemple.fr"],
        },
      },
    });
  });

  it("verrouille les administrateurs avant de compter les remplaçants", async () => {
    userFindUnique.mockResolvedValue({
      roles: ["ROLE_ADMIN"],
      email: "camille@exemple.fr",
    });

    await appeler();

    // 🐛 Sans ce verrou, deux administrateurs qui se suppriment simultanément
    // se comptent mutuellement comme vivants et passent tous les deux : il n'en
    // reste aucun, l'état est irrécupérable par l'interface, et aucun trigger
    // ne rattrape (le double filet de PLAN S2 §5 appartient à V1).
    const [gabarit] = queryRaw.mock.calls[0] as [string];
    expect(gabarit).toMatch(/FOR UPDATE/);
    expect(gabarit).toMatch(/ROLE_ADMIN/);
    // Le verrou est pris AVANT le comptage : l'inverse ne protégerait rien.
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      userCount.mock.invocationCallOrder[0] as number,
    );
  });

  it("ne verrouille rien pour un client", async () => {
    await appeler();

    // Le verrou sérialise les suppressions d'administrateurs entre elles, et
    // elles seules : le faire payer à tous les clients transformerait un
    // parcours self-service en file d'attente.
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
