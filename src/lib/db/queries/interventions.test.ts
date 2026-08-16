// @vitest-environment node
//
// `reserverIntervention` - la transaction qui fait naître le rendez-vous ET sa
// vente additionnelle. Aucun test ne la couvrait avant ce fichier : `gp-02`
// éprouve le chemin nominal sur une vraie base, et `reserver.test.ts` la
// remplace par un `vi.fn()`. Ce qui manquait est la propriété qui décide de
// tout le reste :
//
//   **une intervention ne se commite jamais sans son panier, et un panier
//   refusé n'emporte jamais l'intervention avec lui.**
//
// Le faux `$transaction` ci-dessous ne simule pas Postgres - il OBSERVE ce que
// Postgres observerait : le rappel a-t-il rendu une valeur (commit) ou levé
// (rollback) ? C'est la seule distinction qui compte, et c'est celle qu'un
// `$transaction: (cb) => cb(tx)` naïf efface, en rendant vert un code qui
// commiterait une réservation amputée de sa vente.
//
// ⚠️ Ajouté par l'agent testeur en vérification de T-V3-09.
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const productUpdate = vi.fn();
const interventionCreate = vi.fn();
const interventionProductCreate = vi.fn();
const photoCreateMany = vi.fn();
const serviceFindUniqueOrThrow = vi.fn();
const addressFindFirst = vi.fn();
const queryRaw = vi.fn();
/// Garde de propriété du vélo désigné à C5 (2026-08-16). Elle vit DANS la
/// transaction : c'est elle que ce faux client doit exposer.
const cycleFindFirst = vi.fn();

// Annulation (T-V3-11). Elle lit, verrouille, relit puis écrit, le tout dans
// la transaction : ses quatre appels ont donc leur double ici.
const txInterventionFindFirst = vi.fn();
const txInterventionFindUniqueOrThrow = vi.fn();
const txInterventionUpdate = vi.fn();
const auditCreate = vi.fn();

/// ⚠️ **Modele de verrouillage etendu par l'agent testeur, 2026-08-11.**
///
/// Le faux client etait un objet UNIQUE partage par toutes les transactions, et
/// son `$queryRaw` ne faisait rien : deux annulations concurrentes s'y
/// croisaient sans que rien ne s'y oppose. **Aucune assertion n'observait donc
/// le verrou** - le seul test de concurrence stubbait la relecture au lieu de
/// faire courir deux appels, et le `SELECT … FOR UPDATE` pouvait disparaitre du
/// helper sans faire bouger un seul test. Or la relecture SEULE ne protege de
/// rien : deux transactions la passent toutes les deux avant que l'une ait
/// commite.
///
/// Ce qui est modele ici est le regime reel de PostgreSQL, comme dans
/// `photos.test.ts` :
///
///   · **READ COMMITTED** - la premiere lecture de chaque transaction ne voit
///     pas l'ecriture non commitee de la voisine ;
///   · **un verrou de ligne pris par `SELECT … FOR UPDATE`** fait attendre la
///     transaction suivante jusqu'au commit de la precedente.
///
/// Chaque transaction recoit donc son PROPRE client, avec son propre creneau de
/// verrou libere au commit comme au rollback. Le verrou est **re-entrant** : une
/// seconde requete brute dans la meme transaction (le verrou de stock de
/// `vendreProduits` en croiserait une) ne s'attendrait pas elle-meme.
let fileDesVerrous: Promise<void> = Promise.resolve();

function creerTx() {
  let liberer: () => void = () => undefined;
  let detientLeVerrou = false;

  const client = {
    $queryRaw: async (
      _strings: TemplateStringsArray,
      ...valeurs: unknown[]
    ) => {
      if (!detientLeVerrou) {
        detientLeVerrou = true;
        const precedent = fileDesVerrous;
        fileDesVerrous = new Promise<void>((resoudre) => {
          liberer = resoudre;
        });
        await precedent;
      }
      return queryRaw(valeurs);
    },
    product: { update: productUpdate },
    intervention: {
      create: interventionCreate,
      findFirst: (args: unknown) => txInterventionFindFirst(args),
      findUniqueOrThrow: (args: unknown) =>
        txInterventionFindUniqueOrThrow(args),
      update: (args: unknown) => txInterventionUpdate(args),
    },
    interventionProduct: { create: interventionProductCreate },
    photo: { createMany: photoCreateMany },
    service: { findUniqueOrThrow: serviceFindUniqueOrThrow },
    address: { findFirst: addressFindFirst },
    cycle: { findFirst: (args: unknown) => cycleFindFirst(args) },
    auditLog: { create: (args: unknown) => auditCreate(args) },
  };

  return {
    client,
    relacher: () => {
      liberer();
    },
  };
}

type FauxTx = ReturnType<typeof creerTx>["client"];

/// Ce que la base fait du rappel : commit s'il rend, rollback s'il lève.
const commits: string[] = [];
const rollbacks: string[] = [];

const transaction = vi.fn(async (rappel: (client: FauxTx) => unknown) => {
  const { client, relacher } = creerTx();
  try {
    const valeur = await rappel(client);
    commits.push("commit");
    return valeur;
  } catch (erreur) {
    rollbacks.push("rollback");
    throw erreur;
  } finally {
    // Le verrou tombe au commit comme au rollback, jamais avant : c'est
    // exactement la portee d'un verrou de ligne PostgreSQL.
    relacher();
  }
});

// Lectures de l'espace client (T-V3-10). Elles ne passent pas par
// `$transaction` : ce sont des `SELECT`, et les mocker séparément garde le faux
// client transactionnel ci-dessus concentré sur ce qu'il observe.
const interventionFindMany = vi.fn();
const interventionFindFirst = vi.fn();
const interventionCount = vi.fn();

vi.mock("@/lib/db/client", () => ({
  db: {
    $transaction: (rappel: (client: FauxTx) => unknown) => transaction(rappel),
    intervention: {
      findMany: (args: unknown) => interventionFindMany(args),
      findFirst: (args: unknown) => interventionFindFirst(args),
      count: (args: unknown) => interventionCount(args),
    },
  },
}));

vi.mock("@/lib/db/queries/adresses", () => ({
  resoudreCommune: () => Promise.resolve(69_383),
  creerAdresse: () => Promise.resolve(77),
}));

// La tournee lit `addresses.location`, colonne `Unsupported` que Prisma masque :
// elle sort d'une SECONDE requete, en SQL brut. Doublee ici parce que ce fichier
// ne monte aucune base - ce qu'elle rend est deja teste par le fait qu'un point
// absent produit `point: null`.
const lirePointsAdresses = vi.fn();
vi.mock("@/lib/geo/postgis", () => ({
  lirePointsAdresses: (ids: readonly number[]) => lirePointsAdresses(ids),
}));

const {
  abregerNom,
  annulerInterventionDuClient,
  chargerInterventionDuTech,
  compterInterventionsClient,
  demarrerInterventionDuTech,
  listerHistoriqueTech,
  listerInterventionsAVenir,
  listerInterventionsPassees,
  listerTourneeAVenir,
  listerTourneeDuJour,
  reserverIntervention,
  TAILLE_PAGE_PASSEES,
} = await import("./interventions");

const CLIENT = "11111111-1111-4111-8111-111111111111";

const ANTIVOL = {
  id: 2,
  label: "Antivol en U",
  price: new Prisma.Decimal("39.90"),
  stock: 5,
  isActive: true,
};

const CHAMBRE = {
  id: 1,
  label: "Chambre a air 700x35",
  price: new Prisma.Decimal("12.90"),
  stock: 40,
  isActive: true,
};

function parametres(
  surcharge: Partial<Parameters<typeof reserverIntervention>[0]> = {},
): Parameters<typeof reserverIntervention>[0] {
  return {
    serviceId: 1,
    adresse: {
      street: "12 Rue de la Bicyclette",
      postcode: "69003",
      city: "Lyon",
      point: { lon: 4.832, lat: 45.7578 },
    },
    techId: "22222222-2222-4222-8222-222222222222",
    appointmentAt: new Date("2027-05-10T07:00:00.000Z"),
    clientId: CLIENT,
    // Le défaut du tunnel : aucun vélo désigné. Les cas qui en désignent un
    // passent leur propre valeur par la surcharge.
    cycleId: null,
    photos: [],
    panier: [],
    ...surcharge,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  commits.length = 0;
  rollbacks.length = 0;
  fileDesVerrous = Promise.resolve();

  addressFindFirst.mockResolvedValue({ id: 77 });
  serviceFindUniqueOrThrow.mockResolvedValue({
    price: new Prisma.Decimal("85.00"),
    duration: 60,
    label: "Revision complete",
  });
  interventionCreate.mockResolvedValue({ id: 4242 });
  queryRaw.mockResolvedValue([ANTIVOL, CHAMBRE]);
  // Par defaut le velo designe appartient bien a l'appelant. Les tests du refus
  // rendent `null` explicitement.
  cycleFindFirst.mockResolvedValue({ id: 7 });
});

describe("reserverIntervention - l'intervention et son panier partagent le meme sort", () => {
  it("commite les deux ensemble quand la vente passe", async () => {
    const resultat = await reserverIntervention(
      parametres({ panier: [{ productId: 2, quantity: 2 }] }),
    );

    expect(resultat.ok).toBe(true);
    expect(commits).toHaveLength(1);
    expect(rollbacks).toHaveLength(0);
    expect(interventionProductCreate).toHaveBeenCalledTimes(1);
  });

  it("ROLLBACK et non commit quand le stock refuse la vente", async () => {
    // Le refus ne peut pas remonter par une valeur de retour : un rappel de
    // `$transaction` qui REND commite. L'intervention serait alors créée, son
    // créneau consommé par la contrainte d'exclusion, et le panier perdu - un
    // rendez-vous que le client n'a pas voulu sous cette forme.
    queryRaw.mockResolvedValue([{ ...ANTIVOL, stock: 1 }]);

    const resultat = await reserverIntervention(
      parametres({ panier: [{ productId: 2, quantity: 3 }] }),
    );

    expect(resultat).toMatchObject({ ok: false, reason: "stock_insuffisant" });
    expect(rollbacks).toHaveLength(1);
    expect(commits).toHaveLength(0);
  });

  it("rollback aussi quand la SECONDE ligne d'un panier echoue", async () => {
    // Le cas qui casse la symetrie si la transaction ne tient pas : la premiere
    // ligne a DEJA decremente son stock et ecrit sa ligne quand la seconde est
    // refusee. Sans rollback, le catalogue perd des unites pour une reservation
    // qui n'existe pas.
    queryRaw.mockResolvedValue([ANTIVOL, { ...CHAMBRE, stock: 0 }]);

    const resultat = await reserverIntervention(
      parametres({
        panier: [
          { productId: 2, quantity: 1 },
          { productId: 1, quantity: 1 },
        ],
      }),
    );

    expect(resultat).toMatchObject({ ok: false });
    // La preuve que le filet est bien la transaction et non l'ordre des
    // ecritures : la premiere ligne EST partie en base avant le refus.
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { stock: { decrement: 1 } },
    });
    expect(rollbacks).toHaveLength(1);
    expect(commits).toHaveLength(0);
  });

  it("n'ecrit aucune ligne produit avant que l'intervention existe", async () => {
    // `intervention_products.intervention_id` est la moitie de la cle primaire :
    // l'ordre inverse est impossible en base, mais il se relit mal dans le code.
    await reserverIntervention(
      parametres({ panier: [{ productId: 2, quantity: 1 }] }),
    );

    const creation = interventionCreate.mock.invocationCallOrder[0] ?? 0;
    const ligne = interventionProductCreate.mock.invocationCallOrder[0] ?? 0;
    expect(creation).toBeLessThan(ligne);
  });
});

describe("reserverIntervention - le velo designe a C5", () => {
  // Ajoute le 2026-08-16, quand le tunnel est devenu le SECOND ecrivain de
  // `interventions.cycle_id`. Le dictionnaire v2.4 ecrivait « reste NULL sur
  // toute intervention venue du tunnel » : ce bloc est ce qui rend la bascule
  // verifiable plutot que declaree.

  it("ecrit `cycle_id` quand le velo est celui de l'appelant", async () => {
    const resultat = await reserverIntervention(parametres({ cycleId: 7 }));

    expect(resultat.ok).toBe(true);
    expect(interventionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cycleId: 7 }),
      }),
    );
  });

  it("laisse `cycle_id` NULL quand aucun velo n'est designe", async () => {
    // L'etat nominal, pas une donnee manquante : la colonne est NULLable et le
    // rattachement est facultatif.
    const resultat = await reserverIntervention(parametres({ cycleId: null }));

    expect(resultat.ok).toBe(true);
    expect(interventionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cycleId: null }),
      }),
    );
    // Aucune lecture de garde : il n'y a rien a verifier quand rien n'est
    // designe, et une requete de plus par reservation se paierait sur le chemin
    // nominal du produit.
    expect(cycleFindFirst).not.toHaveBeenCalled();
  });

  it("cherche le velo SUR LE COUPLE (id, proprietaire)", async () => {
    // 🔴 La FK garantit que le velo existe, pas qu'il est a l'appelant. Sans le
    // `userId` dans le `WHERE`, un identifiant forge rattacherait le velo d'un
    // tiers - `cycles.id` est un `SERIAL`, donc enumerable.
    await reserverIntervention(parametres({ cycleId: 7 }));

    expect(cycleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7, userId: CLIENT },
      }),
    );
  });

  it("REFUSE la reservation entiere quand le velo n'est pas le sien", async () => {
    cycleFindFirst.mockResolvedValue(null);

    const resultat = await reserverIntervention(parametres({ cycleId: 999 }));

    expect(resultat).toMatchObject({
      ok: false,
      reason: "cycle_introuvable",
    });
    // Reserver en ignorant le velo en silence donnerait au client un
    // rendez-vous qu'il n'a pas demande sous cette forme.
    expect(interventionCreate).not.toHaveBeenCalled();
  });

  it("n'ecrit RIEN du tout quand le velo est refuse", async () => {
    // 🔴 La propriete qui depend de la POSITION de la garde. Rendre une valeur
    // depuis le rappel de `$transaction` COMMITE : placee apres la creation de
    // l'adresse, la garde commiterait une adresse orpheline a chaque refus.
    // Ce test echoue si quelqu'un descend le bloc de quelques lignes.
    cycleFindFirst.mockResolvedValue(null);

    await reserverIntervention(parametres({ cycleId: 999 }));

    expect(addressFindFirst).not.toHaveBeenCalled();
    expect(serviceFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(photoCreateMany).not.toHaveBeenCalled();
    expect(interventionProductCreate).not.toHaveBeenCalled();
  });

  it("refuse le velo AVANT de consommer le stock du panier", async () => {
    // L'ordre importe : un refus tardif aurait deja decremente le stock, que le
    // rollback rendrait mais apres avoir fait courir la transaction pour rien.
    cycleFindFirst.mockResolvedValue(null);

    await reserverIntervention(
      parametres({ cycleId: 999, panier: [{ productId: 2, quantity: 1 }] }),
    );

    expect(queryRaw).not.toHaveBeenCalled();
    expect(productUpdate).not.toHaveBeenCalled();
  });
});

describe("reserverIntervention - les instantanes", () => {
  it("fige le FORFAIT SEUL dans price_snapshot, produits exclus", async () => {
    // Arbitrage (2) du 2026-08-10 : le total se recalcule a l'affichage, il ne
    // se stocke pas. Un `price_snapshot` qui porterait le panier romprait le
    // miroir avec `duration_snapshot` et rendrait chaque ajout T+n obligé de
    // reecrire un instantane.
    const resultat = await reserverIntervention(
      parametres({ panier: [{ productId: 2, quantity: 2 }] }),
    );

    expect(interventionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priceSnapshot: new Prisma.Decimal("85.00"),
        }),
      }),
    );
    // 85.00 forfait + 2 x 39.90
    expect(resultat).toMatchObject({ priceSnapshot: "85.00", total: "164.80" });
  });

  it("rend le total au forfait seul quand le panier est vide", async () => {
    const resultat = await reserverIntervention(parametres());

    expect(resultat).toMatchObject({ total: "85.00" });
    expect(interventionProductCreate).not.toHaveBeenCalled();
  });

  it("fige le prix du CATALOGUE lu dans la transaction, jamais un prix recu", async () => {
    // Le panier ne transporte que des identifiants et des quantites
    // (`panierSchema`). Cette assertion tient l'autre bout : ce qui est ecrit
    // vient de la ligne verrouillee.
    await reserverIntervention(
      parametres({ panier: [{ productId: 1, quantity: 3 }] }),
    );

    expect(interventionProductCreate).toHaveBeenCalledWith({
      data: {
        interventionId: 4242,
        productId: 1,
        quantity: 3,
        unitPriceSnapshot: CHAMBRE.price,
      },
    });
  });
});

describe("reserverIntervention - la course perdue sur le creneau", () => {
  it("emporte le panier avec elle, aucune unite consommee", async () => {
    // La contrainte `no_double_booking` arbitre APRES que le stock a ete
    // decremente dans la meme transaction. C'est le sens de la vente « dans la
    // transaction de la reservation » : le stock revient tout seul.
    interventionCreate.mockRejectedValue(
      new Error(
        'conflicting key value violates exclusion constraint "no_double_booking"',
      ),
    );

    const resultat = await reserverIntervention(
      parametres({ panier: [{ productId: 2, quantity: 1 }] }),
    );

    expect(resultat).toEqual({ ok: false, reason: "creneau_pris" });
    expect(rollbacks).toHaveLength(1);
    expect(commits).toHaveLength(0);
    expect(productUpdate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Lectures de l'espace client - T-V3-10.
// ─────────────────────────────────────────────────────────────────────────

/// Une ligne telle que Prisma la rend, avec ses `Decimal` et ses relations.
/// Écrite à la main plutôt que dérivée du type : un jeu construit à partir de
/// la forme du code testerait le code contre lui-même.
function ligneLue(surcharge: Record<string, unknown> = {}) {
  return {
    id: 847,
    status: "PLANNED",
    appointmentAt: new Date("2026-08-08T08:00:00.000Z"),
    durationSnapshot: 60,
    priceSnapshot: new Prisma.Decimal("85.00"),
    cancellationReason: null,
    service: { label: "Revision complete" },
    tech: { firstname: "Marc", lastname: "Lefebvre" },
    address: {
      label: "Domicile",
      street: "12 rue de la Republique",
      city: { zipCode: "69002", city: "Lyon" },
    },
    products: [],
    photos: [],
    ...surcharge,
  };
}

describe("abregerNom - protection RGPD du technicien", () => {
  it("rend le prenom et la seule initiale du nom", () => {
    // Les deux US l'ecrivent mot pour mot : « tech (prenom + initiale nom,
    // protection RGPD) ». Le patronyme entier ne doit jamais atteindre le
    // navigateur, ou il suffit d'ouvrir les outils de developpement.
    expect(abregerNom("Marc", "Lefebvre")).toBe("Marc L.");
  });

  it("met l'initiale en capitale", () => {
    expect(abregerNom("Julie", "bernard")).toBe("Julie B.");
  });

  it("survit a un patronyme vide sans produire un point orphelin", () => {
    // Apres pseudonymisation (Constitution §4.1), `lastname` peut etre vide.
    // Un « Marc . » serait un artefact visible sur un ecran client.
    expect(abregerNom("Marc", "")).toBe("Marc");
    expect(abregerNom("Marc", "   ")).toBe("Marc");
  });
});

describe("listerInterventionsAVenir", () => {
  it("filtre sur le STATUT seul, sans borne de date", async () => {
    // ⚠️ Arbitrage du 2026-08-11. L'US ecrit « le **filtre par defaut** =
    // `appointment_at >= now()` ET `status IN (PLANNED)` », et un defaut n'est
    // pas un invariant. Applique a la lettre, un rendez-vous d'hier que le
    // technicien n'a pas cloture sortirait de « a venir » sans entrer dans
    // « passees », qui ne retient que les statuts terminaux : le client
    // perdrait de vue une intervention qui existe encore.
    interventionFindMany.mockResolvedValue([]);

    await listerInterventionsAVenir({ clientId: CLIENT });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
    };

    expect(args.where).toEqual({ clientId: CLIENT, status: "PLANNED" });
    expect(args.where).not.toHaveProperty("appointmentAt");
    expect(args.orderBy).toEqual({ appointmentAt: "asc" });
  });

  it("projette le technicien abrege et le total forfait + produits", async () => {
    interventionFindMany.mockResolvedValue([
      ligneLue({
        products: [
          {
            productId: 2,
            quantity: 1,
            unitPriceSnapshot: new Prisma.Decimal("22.00"),
            product: { label: "Pack usure standard" },
          },
        ],
      }),
    ]);

    const [intervention] = await listerInterventionsAVenir({
      clientId: CLIENT,
    });

    expect(intervention?.technicien).toBe("Marc L.");
    // `price_snapshot` porte le FORFAIT seul ; le total se recalcule.
    expect(intervention?.priceSnapshot).toBe("85.00");
    expect(intervention?.total).toBe("107.00");
    expect(intervention?.produits).toEqual([
      {
        productId: 2,
        label: "Pack usure standard",
        quantity: 1,
        unitPriceSnapshot: "22.00",
      },
    ]);
  });

  it("calcule le total en decimal, pas en flottant", async () => {
    // `12.90 x 3` vaut `38.699999999999996` en binaire. L'ecart est invisible
    // sur une ligne et cesse de l'etre des qu'on en additionne quelques-unes,
    // sur un montant que le client lit.
    interventionFindMany.mockResolvedValue([
      ligneLue({
        priceSnapshot: new Prisma.Decimal("0.00"),
        products: [
          {
            productId: 1,
            quantity: 3,
            unitPriceSnapshot: new Prisma.Decimal("12.90"),
            product: { label: "Chambre a air" },
          },
        ],
      }),
    ]);

    const [intervention] = await listerInterventionsAVenir({
      clientId: CLIENT,
    });

    expect(intervention?.total).toBe("38.70");
  });

  it("ne rend que les identifiants des photos, jamais leur chemin disque", async () => {
    // `photos.url` est un chemin de systeme de fichiers. Le descendre au
    // navigateur donnerait a qui inspecte la page le nom exact du fichier sur
    // le serveur ; la vignette passe par une route controlee.
    interventionFindMany.mockResolvedValue([
      ligneLue({ photos: [{ id: 7 }, { id: 9 }] }),
    ]);

    const [intervention] = await listerInterventionsAVenir({
      clientId: CLIENT,
    });

    expect(intervention?.photos).toEqual([{ id: 7 }, { id: 9 }]);
    expect(JSON.stringify(intervention)).not.toContain("uploads/");
  });

  it("DEMANDE le velo au select, sans quoi le selecteur serait vide en permanence", async () => {
    // Ajoute par l'agent testeur (T-V3-16). C'est exactement le defaut que
    // cette tache existe pour refermer, mais dans l'autre sens : T-V2-02
    // affichait une colonne que personne n'ecrivait, et retirer cette ligne du
    // `select` rendrait une colonne ecrite que personne ne lit. Le symptome
    // serait « Aucun velo » sur toutes les interventions, indefiniment, sans
    // aucune erreur - et rien ne le voyait.
    interventionFindMany.mockResolvedValue([]);

    await listerInterventionsAVenir({ clientId: CLIENT });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
    };

    expect(args.select).toHaveProperty("cycle");
  });

  it("descend le velo rattache jusqu'au DTO, id compris", async () => {
    // Ajoute par l'agent testeur (T-V3-16). L'`id` en fait partie et ce n'est
    // pas accessoire : c'est lui qui coche la bonne dalle du selecteur. Sans
    // lui, l'ecran afficherait le velo dans la liste mais « Aucun velo » en
    // valeur retenue.
    interventionFindMany.mockResolvedValue([
      ligneLue({
        cycle: {
          id: 12,
          brand: "Decathlon",
          model: "Elops 900",
          type: "CLASSIC",
        },
      }),
    ]);

    const [intervention] = await listerInterventionsAVenir({
      clientId: CLIENT,
    });

    expect(intervention?.cycle).toEqual({
      id: 12,
      brand: "Decathlon",
      model: "Elops 900",
      type: "CLASSIC",
    });
  });
});

describe("listerInterventionsPassees", () => {
  beforeEach(() => {
    interventionCount.mockResolvedValue(0);
    interventionFindMany.mockResolvedValue([]);
  });

  it("ne retient que les statuts terminaux, du plus recent au plus ancien", async () => {
    await listerInterventionsPassees({ clientId: CLIENT });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: { status: { in: string[] } };
      orderBy: unknown;
    };

    expect(args.where.status.in).toEqual(["DONE", "CANCELLED"]);
    expect(args.orderBy).toEqual({ appointmentAt: "desc" });
  });

  it("borne la periode de fin au LENDEMAIN, en exclusif", async () => {
    // Une borne `<= le 11` ecarterait tout ce qui a eu lieu dans la journee du
    // 11, ce qui est faux pour qui vient de saisir cette date comme fin de
    // periode. Le defaut ne se voit que sur la derniere journee choisie.
    //
    // 🐛 **Oracle corrige par T-V2-05, regle du test rouge cas 3 : le test
    // figeait le BUG.** Il passait des `Date` construites en UTC et attendait
    // ces memes instants en sortie, ce qui validait exactement le defaut verse
    // dans [[points-ouverts-hch]] le 2026-08-11 - minuit UTC n'est pas minuit a
    // Paris, donc le filtre « du 11 aout » perdait les rendez-vous du 11 entre
    // 00 h et 02 h en ete. Les bornes sont desormais des jours CIVILS, ancres
    // par `instantUtc` comme la tournee depuis le cadrage D1.
    await listerInterventionsPassees({
      clientId: CLIENT,
      du: { annee: 2026, mois: 1, jour: 1 },
      au: { annee: 2026, mois: 8, jour: 11 },
    });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: { appointmentAt: { gte: Date; lt: Date } };
    };

    // Le 1er janvier, Paris est en CET (+1) : minuit local est 23 h UTC la
    // veille. Le 12 aout, en CEST (+2) : 22 h UTC la veille. Deux decalages
    // differents dans le MEME filtre, ce qu'aucune arithmetique en heures ne
    // produit.
    expect(args.where.appointmentAt.gte).toEqual(
      new Date("2025-12-31T23:00:00.000Z"),
    );
    expect(args.where.appointmentAt.lt).toEqual(
      new Date("2026-08-11T22:00:00.000Z"),
    );
  });

  it("compte un jour CIVIL et non 24 heures sur la nuit de bascule", async () => {
    // Le 25 octobre 2026, la journee civile dure 25 heures. Une borne haute en
    // « + 24 h » - ce que faisait l'appelant avant T-V2-05 - s'arreterait une
    // heure trop tot et perdrait les rendez-vous de fin de journee.
    await listerInterventionsPassees({
      clientId: CLIENT,
      au: { annee: 2026, mois: 10, jour: 25 },
    });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: { appointmentAt: { lt: Date } };
    };

    // Minuit le 26 octobre est en CET (+1) : 23 h UTC le 25.
    expect(args.where.appointmentAt.lt).toEqual(
      new Date("2026-10-25T23:00:00.000Z"),
    );
  });

  it("n'ajoute aucune borne quand aucune periode n'est demandee", async () => {
    await listerInterventionsPassees({ clientId: CLIENT });

    const args = interventionFindMany.mock.calls[0]?.[0] as { where: object };

    expect(args.where).not.toHaveProperty("appointmentAt");
  });

  it("pagine, et compte le TOTAL du filtre et non celui de la page", async () => {
    interventionCount.mockResolvedValue(25);

    const page = await listerInterventionsPassees({
      clientId: CLIENT,
      page: 3,
    });

    expect(interventionFindMany.mock.calls[0]?.[0]).toMatchObject({
      skip: 2 * TAILLE_PAGE_PASSEES,
      take: TAILLE_PAGE_PASSEES,
    });
    expect(page.total).toBe(25);
    expect(page.pages).toBe(3);
  });

  it("ramene une page nulle ou negative a la premiere", async () => {
    // Le numero vient de l'URL, donc de n'importe qui. Un `skip` negatif ferait
    // lever Prisma, et la page repondrait 500 sur un parametre bricole.
    await listerInterventionsPassees({ clientId: CLIENT, page: -4 });

    expect(interventionFindMany.mock.calls[0]?.[0]).toMatchObject({ skip: 0 });
  });

  it("ramene un numero de page fractionnaire a un entier", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-11. RED au moment de l'ecriture.
    //
    // Meme famille que le test ci-dessus, et meme motif : le numero vient de
    // l'URL, donc de n'importe qui. `passees/page.tsx:53` le lit par
    // `Number(parametres.page) || 1`, qui rend `2.3` pour `?page=2.3` ; ici,
    // `Math.max(1, ...)` redresse le negatif mais laisse passer le
    // fractionnaire, et `skip` vaut alors `12.999999999999998`.
    //
    // Deux consequences, toutes deux visibles :
    //   · Prisma valide `skip` comme un `Int` et leve sur un flottant - la page
    //     repond 500 sur un parametre bricole, exactement ce que le test du
    //     `page: -4` cherchait a empecher ;
    //   · `page` est ressorti tel quel vers `PaginationPassees`, dont le
    //     `cible === page` ne peut plus etre vrai : plus aucun `aria-current`,
    //     donc plus de page courante annoncee (RGAA A).
    await listerInterventionsPassees({ clientId: CLIENT, page: 2.3 });

    const args = interventionFindMany.mock.calls[0]?.[0] as { skip: number };

    expect(Number.isInteger(args.skip)).toBe(true);
  });

  it("annonce une page meme quand l'historique est vide", async () => {
    // `Math.ceil(0 / 10)` vaut zero, et une pagination « page 1 sur 0 » est un
    // etat que rien ne sait rendre.
    const page = await listerInterventionsPassees({ clientId: CLIENT });

    expect(page.pages).toBe(1);
  });

  it("rend le motif d'annulation d'une intervention annulee", async () => {
    interventionFindMany.mockResolvedValue([
      ligneLue({ status: "CANCELLED", cancellationReason: "Client absent" }),
    ]);

    const page = await listerInterventionsPassees({ clientId: CLIENT });

    expect(page.interventions[0]?.cancellationReason).toBe("Client absent");
  });
});

// ⚠️ Les deux tests de `chargerInterventionDuClient` ont été retirés avec la
// fonction, au 2026-08-11 : l'agent testeur a constaté qu'elle n'avait aucun
// appelant, et ils couvraient donc du code qui ne tournait jamais en
// production. Ce n'est pas un oracle rendu vert - c'est un sujet qui a disparu.

describe("compterInterventionsClient", () => {
  it("compte les deux onglets sur le meme client", async () => {
    interventionCount.mockResolvedValueOnce(2).mockResolvedValueOnce(5);

    const compteurs = await compterInterventionsClient({ clientId: CLIENT });

    expect(compteurs).toEqual({ aVenir: 2, passees: 5 });
    expect(interventionCount.mock.calls[0]?.[0]).toMatchObject({
      where: { clientId: CLIENT, status: "PLANNED" },
    });
    expect(interventionCount.mock.calls[1]?.[0]).toMatchObject({
      where: { clientId: CLIENT, status: { in: ["DONE", "CANCELLED"] } },
    });
  });
});

describe("annulerInterventionDuClient", () => {
  const MOTIF = "Empechement de derniere minute";
  const RDV = new Date("2026-08-20T08:00:00.000Z");

  /// Une intervention planifiée, telle que la première lecture la rend.
  function planifiee(surcharge: Record<string, unknown> = {}) {
    return {
      status: "PLANNED",
      appointmentAt: RDV,
      durationSnapshot: 60,
      service: { label: "Revision complete" },
      tech: { email: "tech@exemple.fr", firstname: "Marc" },
      address: {
        street: "12 rue de la Republique",
        city: { zipCode: "69002", city: "Lyon" },
      },
      ...surcharge,
    };
  }

  function armer(surcharge: Record<string, unknown> = {}) {
    txInterventionFindFirst.mockResolvedValue(planifiee(surcharge));
    txInterventionFindUniqueOrThrow.mockResolvedValue({
      status: (surcharge["status"] as string | undefined) ?? "PLANNED",
    });
  }

  it("passe l'intervention en CANCELLED avec son motif", async () => {
    armer();

    const resultat = await annulerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
      motif: MOTIF,
      // H-25 : la fenetre est ouverte d'une heure.
      maintenant: new Date("2026-08-19T07:00:00.000Z"),
    });

    expect(resultat.ok).toBe(true);
    expect(txInterventionUpdate).toHaveBeenCalledWith({
      where: { id: 847 },
      data: { status: "CANCELLED", cancellationReason: MOTIF },
    });
    expect(commits).toHaveLength(1);
  });

  it("accepte a H-25 et refuse a H-23", async () => {
    // La DoD nomme ces deux bornes. `> 24 h` est la formulation de l'US, en
    // miroir de son cas d'erreur `<= 24 h`.
    armer();
    const accepte = await annulerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T07:00:00.000Z"),
    });
    expect(accepte.ok).toBe(true);

    vi.clearAllMocks();
    armer();
    const refuse = await annulerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T09:00:00.000Z"),
    });
    expect(refuse).toEqual({ ok: false, reason: "fenetre_depassee" });
    expect(txInterventionUpdate).not.toHaveBeenCalled();
  });

  it("refuse a exactement H-24, l'egalite tombant du cote du refus", async () => {
    // L'US ecrit le nominal en `> 24 h` et le refus en `<= 24 h` : la borne
    // exacte appartient au second. Aucune source ne laisse le choix, et c'est
    // la seule valeur ou les deux formulations pourraient diverger.
    armer();

    const resultat = await annulerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T08:00:00.000Z"),
    });

    expect(resultat).toEqual({ ok: false, reason: "fenetre_depassee" });
  });

  it("ne distingue pas l'intervention inconnue de celle d'un tiers", async () => {
    // La garde de propriete vit dans la clause `where`, pas dans un `if` :
    // l'intervention d'un tiers ne remonte simplement pas. Une reponse
    // distincte confirmerait son existence a qui incremente un SERIAL.
    txInterventionFindFirst.mockResolvedValue(null);

    const resultat = await annulerInterventionDuClient({
      interventionId: 999_999,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T07:00:00.000Z"),
    });

    expect(resultat).toEqual({ ok: false, reason: "introuvable" });
    expect(txInterventionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 999_999, clientId: CLIENT } }),
    );
  });

  it("refuse tout statut autre que PLANNED", async () => {
    // `IN_PROGRESS → CANCELLED` existe au cycle de vie (Constitution §2.4) mais
    // appartient au technicien, en repli de refus de paiement. L'ouvrir au
    // client lui permettrait d'annuler pendant que le technicien est chez lui.
    for (const status of ["IN_PROGRESS", "DONE", "CANCELLED"]) {
      vi.clearAllMocks();
      armer({ status });

      const resultat = await annulerInterventionDuClient({
        interventionId: 847,
        clientId: CLIENT,
        motif: MOTIF,
        maintenant: new Date("2026-08-19T07:00:00.000Z"),
      });

      expect(resultat).toEqual({ ok: false, reason: "non_annulable" });
      expect(txInterventionUpdate).not.toHaveBeenCalled();
    }
  });

  it("ecrit l'audit RGPD DANS la transaction", async () => {
    // Constitution §4.2. Une trace ecrite a cote de sa transaction survit a un
    // rollback, ou manque alors que l'ecriture a eu lieu : c'est la piece qu'on
    // produit en cas de contestation.
    armer();

    await annulerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T07:00:00.000Z"),
    });

    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        entityType: "interventions",
        entityId: "847",
        action: "UPDATE",
        actorId: CLIENT,
        details: {
          statutAvant: "PLANNED",
          statutApres: "CANCELLED",
          motif: MOTIF,
        },
      },
    });
  });

  it("verrouille la ligne APRES la garde de propriete", async () => {
    // Un appelant qui incremente des identifiants ne doit pas pouvoir poser un
    // verrou sur le rendez-vous d'un tiers : le `FOR UPDATE` ne part que si la
    // lecture filtree a rendu quelque chose.
    txInterventionFindFirst.mockResolvedValue(null);

    await annulerInterventionDuClient({
      interventionId: 999_999,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T07:00:00.000Z"),
    });

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("refuse quand une transaction voisine a annule entre la lecture et le verrou", async () => {
    // Deux annulations concurrentes passent toutes les deux la premiere lecture
    // sous READ COMMITTED. Sans la relecture SOUS verrou, la seconde ecrirait
    // une deuxieme entree d'audit et enverrait un deuxieme email au technicien
    // pour un rendez-vous deja annule.
    txInterventionFindFirst.mockResolvedValue(planifiee());
    txInterventionFindUniqueOrThrow.mockResolvedValue({ status: "CANCELLED" });

    const resultat = await annulerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T07:00:00.000Z"),
    });

    expect(resultat).toEqual({ ok: false, reason: "non_annulable" });
    expect(txInterventionUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("prend le verrou sur la BONNE ligne, et AVANT de la relire", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-11.
    //
    // Le test voisin (« verrouille la ligne APRES la garde de propriete »)
    // n'affirme que le NEGATIF : aucun verrou quand la lecture filtree ne rend
    // rien. Rien n'affirmait le positif, et rien n'affirmait l'ordre - le
    // helper pouvait perdre son `SELECT … FOR UPDATE` sans qu'aucun test ne
    // bouge, ou le prendre APRES la relecture, ce qui laisserait la fenetre
    // de course exactement ouverte.
    armer();

    await annulerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T07:00:00.000Z"),
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledWith([847]);

    const verrou = queryRaw.mock.invocationCallOrder[0] ?? 0;
    const relecture =
      txInterventionFindUniqueOrThrow.mock.invocationCallOrder[0] ?? 0;
    expect(verrou).toBeLessThan(relecture);
  });

  it("n'annule QU'UNE FOIS sous deux annulations concurrentes", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-11. Le test que la suite n'avait
    // pas : celui qui fait REELLEMENT courir deux transactions.
    //
    // Le module s'attribue la propriete en toutes lettres (`interventions.ts`
    // §« Le verrou n'est pas decoratif ») : deux annulations concurrentes
    // « ecriraient DEUX entrees d'audit et enverraient DEUX emails au
    // technicien ». C'est le journal qui est en cause, pas l'`UPDATE` - et
    // `audit_logs` est la piece qu'on produit en cas de contestation.
    //
    // Le scenario n'est pas theorique : deux onglets ouverts sur la meme
    // intervention suffisent, et l'action est un endpoint POST public
    // (ADR-006 v2) que rien n'empeche d'appeler deux fois.
    //
    // Chaque double de lecture porte un `await` : c'est le point
    // d'entrelacement. Sans lui les deux transactions se derouleraient l'une
    // apres l'autre par construction, et le faux client rendrait vert un code
    // sans aucun verrou.
    const enBase = { status: "PLANNED" };

    txInterventionFindFirst.mockImplementation(async () => {
      await Promise.resolve();
      return planifiee({ status: enBase.status });
    });
    txInterventionFindUniqueOrThrow.mockImplementation(async () => {
      await Promise.resolve();
      return { status: enBase.status };
    });
    txInterventionUpdate.mockImplementation(async () => {
      await Promise.resolve();
      enBase.status = "CANCELLED";
      return { id: 847 };
    });

    const maintenant = new Date("2026-08-19T07:00:00.000Z");
    const resultats = await Promise.all([
      annulerInterventionDuClient({
        interventionId: 847,
        clientId: CLIENT,
        motif: MOTIF,
        maintenant,
      }),
      annulerInterventionDuClient({
        interventionId: 847,
        clientId: CLIENT,
        motif: "Doublon",
        maintenant,
      }),
    ]);

    expect(resultats.filter((resultat) => resultat.ok)).toHaveLength(1);
    expect(resultats).toContainEqual({
      ok: false,
      reason: "non_annulable",
    });
    expect(txInterventionUpdate).toHaveBeenCalledTimes(1);
    // Une seule trace, et une seule notification a envoyer derriere.
    expect(auditCreate).toHaveBeenCalledTimes(1);

    // Ce que cette derniere assertion certifie : la fenetre de course etait
    // bien OUVERTE. La seconde transaction avait deja lu `PLANNED` avant que
    // la premiere n'ecrive - sans le verrou, sa relecture aurait lu la meme
    // chose au meme moment et les deux auraient annule. Sans elle, le test
    // pourrait passer sur deux transactions serialisees par hasard, donc ne
    // rien mesurer.
    const secondeLecture = txInterventionFindFirst.mock.invocationCallOrder[1];
    const premiereEcriture = txInterventionUpdate.mock.invocationCallOrder[0];
    expect(secondeLecture).toBeDefined();
    expect(secondeLecture ?? 0).toBeLessThan(premiereEcriture ?? 0);
  });

  it("rend au technicien de quoi etre prevenu, sans relire la base", async () => {
    armer();

    const resultat = await annulerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
      motif: MOTIF,
      maintenant: new Date("2026-08-19T07:00:00.000Z"),
    });

    expect(resultat).toEqual({
      ok: true,
      technicien: { email: "tech@exemple.fr", firstname: "Marc" },
      appointmentAt: RDV,
      durationSnapshot: 60,
      forfait: "Revision complete",
      adresse: "12 rue de la Republique, 69002 Lyon",
      motif: MOTIF,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `listerTourneeDuJour` - T-V2-01, ecran T1.
// ─────────────────────────────────────────────────────────────────────────

const TECH = "22222222-2222-4222-8222-222222222222";

/// Une ligne telle que Prisma la rend sous `SELECTION_TECH`.
function ligneTournee(surcharge: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "PLANNED",
    appointmentAt: new Date("2026-08-13T08:00:00.000Z"),
    durationSnapshot: 60,
    service: { label: "Revision complete" },
    client: {
      firstname: "Sophie",
      lastname: "Dumas",
      phone: "+33612345678",
    },
    address: {
      id: 77,
      street: "12 rue de la Republique",
      city: { zipCode: "69002", city: "Lyon" },
    },
    products: [],
    ...surcharge,
  };
}

describe("listerTourneeDuJour - les bornes de la journee", () => {
  beforeEach(() => {
    interventionFindMany.mockResolvedValue([]);
    lirePointsAdresses.mockResolvedValue(new Map());
  });

  it("borne minuit a minuit en heure de PARIS, pas en UTC", async () => {
    await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    // Le 13 aout, Paris est en CEST (+2) : minuit local est 22 h UTC la veille.
    // Des bornes construites en UTC - `2026-08-13T00:00:00.000Z` - decaleraient
    // la journee de deux heures, donc rateraient les rendez-vous de 00 h a 02 h
    // et attraperaient ceux du lendemain matin. C'est exactement le defaut du
    // filtre de l'ecran C10, releve le 2026-08-11.
    expect(interventionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          techId: TECH,
          appointmentAt: {
            gte: new Date("2026-08-12T22:00:00.000Z"),
            lt: new Date("2026-08-13T22:00:00.000Z"),
          },
        }),
      }),
    );
  });

  it("couvre les 25 heures de la nuit ou l'heure d'hiver revient", async () => {
    // Le 25 octobre 2026, dernier dimanche du mois : 03 h CEST redevient 02 h
    // CET, la journee civile dure 25 heures. Une borne haute calculee en
    // « debut + 24 h » s'arreterait a 22 h UTC et perdrait la derniere heure -
    // un rendez-vous de 23 h disparaitrait de la tournee du technicien qui doit
    // s'y rendre. `ajouterJours` raisonne en jours CIVILS, pas en 24 h.
    await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 10, jour: 25 },
    });

    const { where } = interventionFindMany.mock.calls[0]![0] as {
      where: { appointmentAt: { gte: Date; lt: Date } };
    };

    expect(where.appointmentAt.gte).toEqual(
      new Date("2026-10-24T22:00:00.000Z"),
    );
    expect(where.appointmentAt.lt).toEqual(
      new Date("2026-10-25T23:00:00.000Z"),
    );

    const heures =
      (where.appointmentAt.lt.getTime() - where.appointmentAt.gte.getTime()) /
      3_600_000;
    expect(heures).toBe(25);
  });

  it("couvre les 23 heures de la nuit ou l'heure d'ete arrive", async () => {
    // ⚠️ **Ajout de l'agent testeur, 2026-08-12.** La DoD nomme « les deux nuits
    // de bascule » et la suite n'en eprouvait qu'UNE, celle d'octobre. Les deux
    // ne se prouvent pas l'une l'autre : la journee de 25 heures ne casse
    // qu'une borne haute calculee en « + 24 h », la journee de 23 heures casse
    // en plus la SECONDE passe d'`instantUtc` - c'est le seul jour ou le
    // decalage estime (+1) et le decalage reel de la borne haute (+2) different.
    //
    // Le 29 mars 2026, dernier dimanche du mois : 02 h CET devient 03 h CEST.
    // Minuit local est 23 h UTC la veille (+1), minuit du 30 est 22 h UTC le 29
    // (+2), et la journee civile ne dure que 23 heures. Une borne haute en
    // « debut + 24 h » irait jusqu'a 23 h UTC le 29, donc **avalerait la
    // premiere heure du 30 mars** : le premier rendez-vous du lendemain matin
    // apparaitrait dans la tournee de la veille.
    await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 3, jour: 29 },
    });

    const { where } = interventionFindMany.mock.calls[0]![0] as {
      where: { appointmentAt: { gte: Date; lt: Date } };
    };

    expect(where.appointmentAt.gte).toEqual(
      new Date("2026-03-28T23:00:00.000Z"),
    );
    expect(where.appointmentAt.lt).toEqual(
      new Date("2026-03-29T22:00:00.000Z"),
    );

    const heures =
      (where.appointmentAt.lt.getTime() - where.appointmentAt.gte.getTime()) /
      3_600_000;
    expect(heures).toBe(23);
  });

  it("passe le changement de MOIS et d'ANNEE sans deborder", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-12. `ajouterJours` fabrique la borne
    // haute ; un incrementeur naif sur le champ `jour` produirait un « 32
    // decembre » que `Date.UTC` normalise silencieusement - ou pas, selon
    // l'implementation. Le 31 decembre est aussi le jour ou une tournee mal
    // bornee glisserait d'une annee entiere.
    await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 12, jour: 31 },
    });

    const { where } = interventionFindMany.mock.calls[0]![0] as {
      where: { appointmentAt: { gte: Date; lt: Date } };
    };

    // Hiver : Paris est en CET (+1) des deux cotes du reveillon.
    expect(where.appointmentAt.gte).toEqual(
      new Date("2026-12-30T23:00:00.000Z"),
    );
    expect(where.appointmentAt.lt).toEqual(
      new Date("2026-12-31T23:00:00.000Z"),
    );
  });

  it("borne en exclusif a minuit du lendemain, jamais en inclusif", async () => {
    await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    const { where } = interventionFindMany.mock.calls[0]![0] as {
      where: { appointmentAt: Record<string, unknown> };
    };

    // `lt` et non `lte` : minuit pile appartient au jour SUIVANT, et un `lte`
    // ferait apparaitre le premier rendez-vous de demain en fin de tournee.
    expect(where.appointmentAt).toHaveProperty("lt");
    expect(where.appointmentAt).not.toHaveProperty("lte");
  });
});

describe("listerTourneeDuJour - le jour, jamais le statut", () => {
  beforeEach(() => {
    lirePointsAdresses.mockResolvedValue(new Map());
  });

  it("n'applique AUCUN filtre de statut", async () => {
    interventionFindMany.mockResolvedValue([]);

    await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    const { where } = interventionFindMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };

    // ⚠️ La regle est l'INVERSE de l'onglet « A venir » du client, qui retient
    // `PLANNED` sans borne de date. Recopier le filtre du voisin par symetrie
    // ferait disparaitre de la tournee tout ce que le technicien vient de
    // terminer, alors que la SPEC exige que les statuts terminaux restent
    // affiches en fin de journee pour la tracabilite.
    expect(where).not.toHaveProperty("status");
    expect(Object.keys(where).sort()).toEqual(["appointmentAt", "techId"]);
  });

  it("rend les quatre statuts, y compris les terminaux", async () => {
    interventionFindMany.mockResolvedValue([
      ligneTournee({ id: 1, status: "DONE" }),
      ligneTournee({ id: 2, status: "IN_PROGRESS" }),
      ligneTournee({ id: 3, status: "PLANNED" }),
      ligneTournee({ id: 4, status: "CANCELLED" }),
    ]);

    const tournee = await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    expect(tournee.map((ligne) => ligne.status)).toEqual([
      "DONE",
      "IN_PROGRESS",
      "PLANNED",
      "CANCELLED",
    ]);
  });

  it("trie chronologiquement", async () => {
    interventionFindMany.mockResolvedValue([]);

    await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    expect(interventionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { appointmentAt: "asc" } }),
    );
  });
});

describe("listerTourneeDuJour - la projection", () => {
  beforeEach(() => {
    lirePointsAdresses.mockResolvedValue(
      new Map([[77, { lon: 4.83, lat: 45.76 }]]),
    );
  });

  it("rend le nom COMPLET du client, jamais abrege", async () => {
    interventionFindMany.mockResolvedValue([ligneTournee()]);

    const [ligne] = await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    // `abregerNom` abrege le TECHNICIEN pour le client, au titre de la
    // minimisation. Le symetrique masquerait le nom du client a la personne qui
    // va sonner chez lui (Constitution §1.1). La SPEC exige « client (nom ET
    // telephone) ».
    expect(ligne?.client.nom).toBe("Sophie Dumas");
    expect(ligne?.client.nom).not.toBe(abregerNom("Sophie", "Dumas"));
    expect(ligne?.client.telephone).toBe("+33612345678");
  });

  it("rend `appointmentAt` en chaine ISO, pas en Date", async () => {
    interventionFindMany.mockResolvedValue([ligneTournee()]);

    const [ligne] = await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    // Ce DTO traverse la frontiere par DEUX chemins - `initialData` au rendu et
    // le retour de la Server Action au polling - et les deux doivent porter la
    // meme forme. Une `Date` d'un cote et une chaine de l'autre casserait le
    // formatage apres 30 secondes d'affichage correct.
    expect(ligne?.appointmentAt).toBe("2026-08-13T08:00:00.000Z");
    expect(typeof ligne?.appointmentAt).toBe("string");
  });

  it("survit a un client pseudonymise - telephone absent, point absent", async () => {
    // Le droit a l'oubli remet `users.phone` a NULL et `addresses.location` a
    // NULL (queries/users.ts:143 et :182), mais l'intervention SURVIT :
    // Constitution §4.1 interdit la FK cassee. La ligne doit donc se rendre.
    lirePointsAdresses.mockResolvedValue(new Map());
    interventionFindMany.mockResolvedValue([
      ligneTournee({
        client: {
          firstname: "Utilisateur",
          lastname: "Anonymise",
          phone: null,
        },
      }),
    ]);

    const [ligne] = await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    expect(ligne?.client.telephone).toBeNull();
    expect(ligne?.point).toBeNull();
    expect(ligne?.client.nom).toBe("Utilisateur Anonymise");
  });

  it("attache le point GPS de l'adresse quand il existe", async () => {
    interventionFindMany.mockResolvedValue([ligneTournee()]);

    const [ligne] = await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    expect(ligne?.point).toEqual({ lon: 4.83, lat: 45.76 });
    expect(lirePointsAdresses).toHaveBeenCalledWith([77]);
  });

  it("n'envoie AUCUN prix au navigateur du technicien", async () => {
    interventionFindMany.mockResolvedValue([
      ligneTournee({
        products: [
          {
            productId: 2,
            quantity: 1,
            product: { label: "Antivol en U" },
          },
        ],
      }),
    ]);

    const [ligne] = await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    // La SPEC n'enumere que « produits additionnels attaches » sur les lignes de
    // la tournee, et la maquette T1 n'affiche qu'un libelle. Le total arrivera
    // avec l'encaissement, en T-V2-03.
    expect(ligne?.produits).toEqual([
      { productId: 2, label: "Antivol en U", quantity: 1 },
    ]);

    // Aucun MONTANT dans le DTO, a aucune profondeur. `durationSnapshot`, lui,
    // y est par exigence - la SPEC demande « forfait (nom ET duree) » - donc
    // chercher « Snapshot » serait un oracle faux : il echouerait sur un champ
    // que la SPEC impose.
    const serialise = JSON.stringify(ligne);
    for (const interdit of ["priceSnapshot", "unitPriceSnapshot", "total"]) {
      expect(serialise).not.toContain(interdit);
    }
  });

  it("ne rend QUE des valeurs stables a la serialisation", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-12. Le module s'attribue en toutes
    // lettres la propriete « les deux chemins portent exactement la meme
    // forme » - `initialData` au rendu, retour de la Server Action au polling -
    // et le seul oracle existant ne couvrait qu'`appointmentAt`.
    //
    // La propriete generale est plus large que ce champ : **aucune** valeur du
    // DTO ne doit changer de type en traversant la frontiere. Un `Decimal`
    // Prisma oublie dans un `select` ressortirait en objet cote serveur et en
    // chaine apres serialisation ; un `undefined` disparaitrait d'un cote et pas
    // de l'autre. Le defaut ne se verrait qu'apres 30 secondes d'affichage
    // correct, ce qu'aucune revue n'attrape.
    interventionFindMany.mockResolvedValue([
      ligneTournee({
        products: [
          { productId: 2, quantity: 3, product: { label: "Antivol en U" } },
        ],
      }),
      ligneTournee({
        id: 2,
        status: "CANCELLED",
        client: {
          firstname: "Utilisateur",
          lastname: "Anonymise",
          phone: null,
        },
        address: {
          id: 78,
          street: "Adresse supprimee",
          city: { zipCode: "69002", city: "Lyon" },
        },
      }),
    ]);

    const tournee = await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    expect(JSON.parse(JSON.stringify(tournee))).toEqual(tournee);
  });

  it("rend une liste vide sans interroger les points", async () => {
    interventionFindMany.mockResolvedValue([]);

    const tournee = await listerTourneeDuJour({
      techId: TECH,
      jour: { annee: 2026, mois: 8, jour: 13 },
    });

    expect(tournee).toEqual([]);
    expect(lirePointsAdresses).toHaveBeenCalledWith([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// `listerTourneeAVenir` et `listerHistoriqueTech` - T-V2-05, les deux
// declinaisons de T1. Les deux US ont ete promues de v2 en v1 le 2026-08-12.
// ─────────────────────────────────────────────────────────────────────────

describe("listerTourneeAVenir - la fenetre 7 j / 30 j", () => {
  beforeEach(() => {
    interventionFindMany.mockResolvedValue([]);
    lirePointsAdresses.mockResolvedValue(new Map());
  });

  function bornes() {
    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: { appointmentAt: { gte: Date; lt: Date } };
    };
    return args.where.appointmentAt;
  }

  it("commence DEMAIN et non maintenant", async () => {
    // L'US ecrit « les jours SUIVANTS », et aujourd'hui a son propre onglet.
    // Une fenetre qui partirait de `NOW()` ferait dire deux choses aux deux
    // onglets sur les memes lignes, et un rendez-vous changerait d'onglet en
    // cours de journee sans que rien ne se soit passe.
    await listerTourneeAVenir({
      techId: TECH,
      aujourdhui: { annee: 2026, mois: 8, jour: 13 },
      jours: 7,
    });

    // Minuit le 14 aout a Paris (CEST, +2) = 22 h UTC le 13.
    expect(bornes().gte).toEqual(new Date("2026-08-13T22:00:00.000Z"));
  });

  it("couvre exactement sept jours civils", async () => {
    await listerTourneeAVenir({
      techId: TECH,
      aujourdhui: { annee: 2026, mois: 8, jour: 13 },
      jours: 7,
    });

    // Du 14 au 20 inclus, borne haute exclusive a minuit le 21.
    expect(bornes().lt).toEqual(new Date("2026-08-20T22:00:00.000Z"));
  });

  it("couvre exactement trente jours civils", async () => {
    await listerTourneeAVenir({
      techId: TECH,
      aujourdhui: { annee: 2026, mois: 8, jour: 13 },
      jours: 30,
    });

    expect(bornes().lt).toEqual(new Date("2026-09-12T22:00:00.000Z"));
  });

  it("compte des jours CIVILS a travers la bascule d'heure", async () => {
    // Du 26 octobre au 1er novembre : la fenetre franchit le passage a l'heure
    // d'hiver du 25. Comptee en « 7 x 24 h » depuis une borne basse en CET,
    // elle finirait une heure a cote.
    await listerTourneeAVenir({
      techId: TECH,
      aujourdhui: { annee: 2026, mois: 10, jour: 24 },
      jours: 7,
    });

    // Minuit le 25 octobre est encore en CEST (+2), minuit le 1er novembre est
    // en CET (+1) : deux decalages differents dans la meme fenetre.
    expect(bornes().gte).toEqual(new Date("2026-10-24T22:00:00.000Z"));
    expect(bornes().lt).toEqual(new Date("2026-10-31T23:00:00.000Z"));
  });

  it("ne retient que les interventions PLANNED", async () => {
    // ⚠️ Regle INVERSE de la tournee du jour, qui n'a aucun filtre de statut
    // parce que la SPEC exige que les terminaux restent visibles en fin de
    // journee. L'ancre de `US-INTERVENTIONS-LISTER-TECH-A-VENIR` pose
    // `status = PLANNED`. Ne pas recopier le filtre du voisin.
    await listerTourneeAVenir({
      techId: TECH,
      aujourdhui: { annee: 2026, mois: 8, jour: 13 },
      jours: 7,
    });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: { status: { in: string[] } };
    };

    expect(args.where.status.in).toEqual(["PLANNED"]);
  });

  it("borne au technicien de la session et trie chronologiquement", async () => {
    await listerTourneeAVenir({
      techId: TECH,
      aujourdhui: { annee: 2026, mois: 8, jour: 13 },
      jours: 7,
    });

    expect(interventionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ techId: TECH }),
        orderBy: { appointmentAt: "asc" },
      }),
    );
  });

  it("rend le meme DTO que la tournee du jour", async () => {
    // Les trois vues partagent `SELECTION_TECH` et `projeterTournee`, donc le
    // meme composant de ligne. Une divergence de forme casserait l'une des
    // trois sans que rien ne l'annonce.
    interventionFindMany.mockResolvedValue([ligneTournee()]);
    lirePointsAdresses.mockResolvedValue(new Map());

    const [intervention] = await listerTourneeAVenir({
      techId: TECH,
      aujourdhui: { annee: 2026, mois: 8, jour: 13 },
      jours: 7,
    });

    expect(intervention).toMatchObject({
      appointmentAt: "2026-08-13T08:00:00.000Z",
      client: { nom: "Sophie Dumas", telephone: "+33612345678" },
      point: null,
    });
    // Le libelle que le client redige pour lui-meme ne traverse pas : retire du
    // `select` par l'agent testeur en T-V2-01, minimisation.
    expect(JSON.stringify(intervention)).not.toContain("label");
  });
});

describe("la frontiere entre « Aujourd'hui » et « Cette semaine »", () => {
  // 🔴 **Ajout de l'agent testeur, et rien ne tenait cette propriete.**
  //
  // Les deux fenetres sont eprouvees separement, chacune contre des litteraux
  // ISO ecrits a la main. Rien ne les relie : deux oracles justes pris un a un
  // laisseraient passer un trou d'une heure entre les deux onglets - un
  // rendez-vous de 00 h 30 qui ne serait NI dans la journee, NI dans la semaine -
  // ou un recouvrement, ou la meme ligne s'afficherait deux fois. Le trou est le
  // plus probable des deux : c'est exactement ce que produirait un « +24 h » sur
  // l'une des deux bornes, les deux nuits de bascule.
  //
  // La propriete est une EGALITE, pas deux valeurs recopiees : elle reste vraie
  // sans etre reecrite le jour ou l'une des deux fonctions change de fuseau, de
  // helper ou de convention d'inclusivite.
  beforeEach(() => {
    interventionFindMany.mockResolvedValue([]);
    lirePointsAdresses.mockResolvedValue(new Map());
  });

  async function bornesDe(
    appel: () => Promise<unknown>,
  ): Promise<{ gte: Date; lt: Date }> {
    interventionFindMany.mockClear();
    await appel();
    const { where } = interventionFindMany.mock.calls[0]![0] as {
      where: { appointmentAt: { gte: Date; lt: Date } };
    };
    return where.appointmentAt;
  }

  it.each([
    { titre: "un jour ordinaire", jour: { annee: 2026, mois: 8, jour: 13 } },
    {
      titre: "la veille du passage a l'heure d'hiver",
      jour: { annee: 2026, mois: 10, jour: 24 },
    },
    {
      titre: "le jour meme du passage a l'heure d'hiver",
      jour: { annee: 2026, mois: 10, jour: 25 },
    },
    {
      titre: "la veille du passage a l'heure d'ete",
      jour: { annee: 2026, mois: 3, jour: 28 },
    },
    {
      titre: "le jour meme du passage a l'heure d'ete",
      jour: { annee: 2026, mois: 3, jour: 29 },
    },
    {
      titre: "le dernier jour de l'annee",
      jour: { annee: 2026, mois: 12, jour: 31 },
    },
    {
      titre: "le 28 fevrier d'une annee bissextile",
      jour: { annee: 2028, mois: 2, jour: 28 },
    },
  ])(
    "$titre : la semaine commence exactement ou la journee finit",
    async ({ jour }) => {
      const journee = await bornesDe(() =>
        listerTourneeDuJour({ techId: TECH, jour }),
      );
      const semaine = await bornesDe(() =>
        listerTourneeAVenir({ techId: TECH, aujourdhui: jour, jours: 7 }),
      );

      // Ni trou, ni recouvrement : la borne haute d'« Aujourd'hui » est
      // exclusive, celle de « Cette semaine » est inclusive, et les deux
      // designent le MEME instant.
      expect(semaine.gte).toEqual(journee.lt);
      // Et la journee precede bien la semaine - un jour civil de large.
      expect(journee.gte.getTime()).toBeLessThan(semaine.gte.getTime());
    },
  );

  it("compte 7 puis 30 jours CIVILS a partir de demain, a travers le passage a l'heure d'ete", async () => {
    // Le pendant de la nuit d'octobre deja couverte. Le 29 mars 2026 est le
    // dernier dimanche du mois : la journee ne dure que 23 heures, et minuit du
    // 29 est encore en CET (+1) quand minuit du 5 avril est en CEST (+2). Deux
    // decalages dans une meme fenetre, dans le sens INVERSE d'octobre.
    const aujourdhui = { annee: 2026, mois: 3, jour: 28 };

    const sept = await bornesDe(() =>
      listerTourneeAVenir({ techId: TECH, aujourdhui, jours: 7 }),
    );
    expect(sept.gte).toEqual(new Date("2026-03-28T23:00:00.000Z"));
    expect(sept.lt).toEqual(new Date("2026-04-04T22:00:00.000Z"));

    const trente = await bornesDe(() =>
      listerTourneeAVenir({ techId: TECH, aujourdhui, jours: 30 }),
    );
    expect(trente.gte).toEqual(sept.gte);
    expect(trente.lt).toEqual(new Date("2026-04-27T22:00:00.000Z"));
  });

  it("franchit le changement d'ANNEE sans deborder", async () => {
    // `ajouterJours` passe par `Date.UTC(annee, mois - 1, jour + n)`, qui roule
    // de lui-meme. Le cas est deja couvert pour la journee ; il ne l'etait pas
    // pour la fenetre, ou le report se fait sur deux additions successives -
    // `aujourdhui + 1` puis `demain + jours`.
    const bornes = await bornesDe(() =>
      listerTourneeAVenir({
        techId: TECH,
        aujourdhui: { annee: 2026, mois: 12, jour: 31 },
        jours: 7,
      }),
    );

    expect(bornes.gte).toEqual(new Date("2026-12-31T23:00:00.000Z"));
    expect(bornes.lt).toEqual(new Date("2027-01-07T23:00:00.000Z"));
  });

  it("ne laisse AUCUNE des deux vues consulter le passe", async () => {
    // La propriete que la DoD nomme autrement (« la fenetre part de demain ») :
    // aucune borne basse de « Cette semaine » n'est anterieure a maintenant, et
    // aucun parametre d'URL ne permet de la reculer. Le seul levier est `jours`,
    // qui est enumere et n'agit que sur la borne HAUTE.
    const aujourdhui = { annee: 2026, mois: 8, jour: 13 };

    const sept = await bornesDe(() =>
      listerTourneeAVenir({ techId: TECH, aujourdhui, jours: 7 }),
    );
    const trente = await bornesDe(() =>
      listerTourneeAVenir({ techId: TECH, aujourdhui, jours: 30 }),
    );

    expect(trente.gte).toEqual(sept.gte);
    expect(trente.lt.getTime()).toBeGreaterThan(sept.lt.getTime());
  });
});

describe("listerHistoriqueTech", () => {
  beforeEach(() => {
    interventionCount.mockResolvedValue(0);
    interventionFindMany.mockResolvedValue([]);
    lirePointsAdresses.mockResolvedValue(new Map());
  });

  it("ne retient que les statuts terminaux, du plus recent au plus ancien", async () => {
    await listerHistoriqueTech({ techId: TECH });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: { status: { in: string[] }; techId: string };
      orderBy: unknown;
    };

    expect(args.where.status.in).toEqual(["DONE", "CANCELLED"]);
    expect(args.where.techId).toBe(TECH);
    expect(args.orderBy).toEqual({ appointmentAt: "desc" });
  });

  it("pagine, et compte le TOTAL du filtre et non celui de la page", async () => {
    interventionCount.mockResolvedValue(25);

    const page = await listerHistoriqueTech({ techId: TECH, page: 3 });

    expect(interventionFindMany.mock.calls[0]?.[0]).toMatchObject({
      skip: 2 * TAILLE_PAGE_PASSEES,
      take: TAILLE_PAGE_PASSEES,
    });
    expect(page.total).toBe(25);
    expect(page.pages).toBe(3);
  });

  it("durcit un numero de page bricole", async () => {
    // Meme famille de defaut que celle relevee par l'agent testeur sur C10 :
    // `?page=2.3` traversait `Math.max` intact et produisait un `skip`
    // fractionnaire que Prisma refuse - 500 sur un parametre d'URL.
    for (const [demandee, attendu] of [
      [-4, 0],
      [2.3, TAILLE_PAGE_PASSEES],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
    ] as const) {
      interventionFindMany.mockClear();
      await listerHistoriqueTech({ techId: TECH, page: demandee });

      expect(interventionFindMany.mock.calls[0]?.[0]).toMatchObject({
        skip: attendu,
      });
    }
  });

  it("ancre le filtre de periode sur Paris, comme l'espace client", async () => {
    await listerHistoriqueTech({
      techId: TECH,
      du: { annee: 2026, mois: 8, jour: 1 },
      au: { annee: 2026, mois: 8, jour: 11 },
    });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: { appointmentAt: { gte: Date; lt: Date } };
    };

    expect(args.where.appointmentAt.gte).toEqual(
      new Date("2026-07-31T22:00:00.000Z"),
    );
    expect(args.where.appointmentAt.lt).toEqual(
      new Date("2026-08-11T22:00:00.000Z"),
    );
  });

  it("n'ajoute aucune borne quand aucune periode n'est demandee", async () => {
    await listerHistoriqueTech({ techId: TECH });

    const args = interventionFindMany.mock.calls[0]?.[0] as { where: object };

    expect(args.where).not.toHaveProperty("appointmentAt");
  });

  it("rend au moins une page, meme vide", async () => {
    // `Math.ceil(0 / 10)` vaut zero : sans plancher, la pagination afficherait
    // « page 1 sur 0 ».
    const page = await listerHistoriqueTech({ techId: TECH });

    expect(page.pages).toBe(1);
    expect(page.interventions).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Detail et demarrage - `US-INTERVENTION-AFFICHER` et
// `US-INTERVENTION-DEMARRER` (T-V2-02).
// ─────────────────────────────────────────────────────────────────────────

describe("chargerInterventionDuTech", () => {
  /// Une ligne telle que Prisma la rend sous `SELECTION_DETAIL`.
  function ligne(surcharge: Record<string, unknown> = {}) {
    return {
      id: 847,
      status: "PLANNED",
      appointmentAt: new Date("2026-08-20T08:00:00.000Z"),
      startedAt: null,
      durationSnapshot: 60,
      priceSnapshot: new Prisma.Decimal("85.00"),
      cancellationReason: null,
      techComment: null,
      service: {
        label: "Revision complete",
        description: "Reglage et graissage",
      },
      client: {
        firstname: "Julien",
        lastname: "Marceau",
        phone: "0612345678",
        email: "julien@exemple.fr",
      },
      address: {
        id: 77,
        street: "8 quai Saint-Antoine",
        city: { zipCode: "69002", city: "Lyon" },
      },
      cycle: null,
      products: [],
      photos: [],
      ...surcharge,
    };
  }

  beforeEach(() => {
    lirePointsAdresses.mockResolvedValue(new Map());
  });

  it("porte la garde de propriete dans la clause `where`", async () => {
    // 🔴 La propriete de securite de l'ecran. `techId` est dans la requete, pas
    // dans un `if` qui suivrait la lecture : une branche oubliee ne peut pas
    // l'ouvrir, et l'intervention d'un collegue ne remonte simplement pas.
    interventionFindFirst.mockResolvedValue(ligne());

    await chargerInterventionDuTech({ interventionId: 847, techId: TECH });

    expect(interventionFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 847, techId: TECH },
    });
  });

  it("ne distingue pas l'intervention inconnue de celle d'un collegue", async () => {
    // Les deux rendent `null`, et c'est l'appelant qui en fait un 403 unique.
    // `interventions.id` est un SERIAL : deux reponses distinctes apprendraient
    // a qui incremente quelles interventions existent.
    interventionFindFirst.mockResolvedValue(null);

    await expect(
      chargerInterventionDuTech({ interventionId: 999, techId: TECH }),
    ).resolves.toBeNull();
  });

  it("calcule le total en forfait PLUS produits, pas le forfait seul", async () => {
    // Meme formule que `projeter()`, et c'est ce montant que T-V2-03 prereglera
    // au paiement (cadrage D9). Preregler sur `price_snapshot` sous-facturerait
    // toute intervention portant des produits.
    interventionFindFirst.mockResolvedValue(
      ligne({
        products: [
          {
            productId: 2,
            quantity: 3,
            unitPriceSnapshot: new Prisma.Decimal("12.90"),
            product: { label: "Chambre a air" },
          },
        ],
      }),
    );

    const detail = await chargerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
    });

    // 85.00 + 12.90 × 3 = 123.70, et le calcul passe par `Decimal` : en binaire
    // il perdrait ses centimes, sur un montant qui sera encaisse.
    expect(detail?.total).toBe("123.70");
    expect(detail?.priceSnapshot).toBe("85.00");
    expect(detail?.produits[0]?.unitPriceSnapshot).toBe("12.90");
  });

  it("rend le nom COMPLET du client, son telephone et son email", async () => {
    // `abregerNom` joue dans l'autre sens : il abrege le TECHNICIEN pour le
    // client. L'US assume l'exposition ici, « justification metier terrain ».
    interventionFindFirst.mockResolvedValue(ligne());

    const detail = await chargerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
    });

    expect(detail?.client).toEqual({
      nom: "Julien Marceau",
      telephone: "0612345678",
      email: "julien@exemple.fr",
    });
  });

  it("survit a un client pseudonymise, telephone et point absents", async () => {
    // L'intervention survit a l'effacement de son client (Constitution §4.1,
    // pas de FK cassee) : la ligne existe donc et doit se rendre.
    interventionFindFirst.mockResolvedValue(
      ligne({
        client: {
          firstname: "Compte",
          lastname: "supprime",
          phone: null,
          email: "supprime+847@exemple.invalid",
        },
      }),
    );

    const detail = await chargerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
    });

    expect(detail?.client.telephone).toBeNull();
    expect(detail?.point).toBeNull();
  });

  it("ne selectionne pas le libelle memo de l'adresse", async () => {
    // « Domicile », « Chez ma mere » : le client le redige pour lui-meme, et
    // aucun composant de cet ecran ne le lit. Ne pas le SELECTIONNER est plus
    // sur que ne pas l'afficher - minimisation deja appliquee a la tournee.
    interventionFindFirst.mockResolvedValue(ligne());

    await chargerInterventionDuTech({ interventionId: 847, techId: TECH });

    const args = interventionFindFirst.mock.calls[0]?.[0] as {
      select: { address: { select: Record<string, unknown> } };
    };

    expect(args.select.address.select).not.toHaveProperty("label");
  });

  it("rend les deux etats du velo", async () => {
    // Cadrage D11 : `cycle_id` a un ecrivain (T-V3-16) mais le rattachement
    // reste facultatif, donc la colonne est vide sur toute intervention venue
    // du tunnel. Les deux etats s'affichent.
    interventionFindFirst.mockResolvedValue(ligne());
    const sansVelo = await chargerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
    });
    expect(sansVelo?.cycle).toBeNull();

    interventionFindFirst.mockResolvedValue(
      ligne({
        cycle: { brand: "Btwin", model: "Riverside 500", type: "CLASSIC" },
      }),
    );
    const avecVelo = await chargerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
    });
    expect(avecVelo?.cycle).toEqual({
      brand: "Btwin",
      model: "Riverside 500",
      type: "CLASSIC",
    });
  });
});

describe("demarrerInterventionDuTech", () => {
  const MAINTENANT = new Date("2026-08-20T08:02:00.000Z");

  function armer(statut = "PLANNED", sousVerrou = statut) {
    txInterventionFindFirst.mockResolvedValue({ status: statut });
    txInterventionFindUniqueOrThrow.mockResolvedValue({ status: sousVerrou });
  }

  it("passe PLANNED a IN_PROGRESS et date le demarrage", async () => {
    armer();

    const resultat = await demarrerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
      maintenant: MAINTENANT,
    });

    expect(resultat).toEqual({ ok: true, startedAt: MAINTENANT });
    expect(txInterventionUpdate).toHaveBeenCalledWith({
      where: { id: 847 },
      data: { status: "IN_PROGRESS", startedAt: MAINTENANT },
    });
    expect(commits).toHaveLength(1);
  });

  it("porte la garde de propriete dans la clause `where`", async () => {
    armer();

    await demarrerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
      maintenant: MAINTENANT,
    });

    expect(txInterventionFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 847, techId: TECH },
    });
  });

  it("ne distingue pas l'intervention inconnue de celle d'un collegue", async () => {
    txInterventionFindFirst.mockResolvedValue(null);

    const resultat = await demarrerInterventionDuTech({
      interventionId: 999,
      techId: TECH,
      maintenant: MAINTENANT,
    });

    expect(resultat).toEqual({ ok: false, reason: "introuvable" });
    expect(txInterventionUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each([["IN_PROGRESS"], ["DONE"], ["CANCELLED"]])(
    "refuse le demarrage depuis %s",
    async (statut) => {
      // 🔴 Le refus est SERVEUR et TYPE, pas un code HTTP. La SPEC ecrit 409 :
      // ce statut n'a plus de referent depuis le pivot Next full-stack, les
      // Server Actions rendant des unions discriminees. L'exigence reelle - un
      // refus serveur, hors de l'UI - est tenue.
      armer(statut);

      const resultat = await demarrerInterventionDuTech({
        interventionId: 847,
        techId: TECH,
        maintenant: MAINTENANT,
      });

      expect(resultat).toEqual({
        ok: false,
        reason: "transition_illegale",
        statutCourant: statut,
      });
      expect(txInterventionUpdate).not.toHaveBeenCalled();
    },
  );

  it("verrouille APRES la garde de propriete, jamais avant", async () => {
    // Un appelant qui incremente des identifiants ne doit pas pouvoir poser un
    // verrou sur le rendez-vous d'un tiers. Meme ordre que l'annulation et que
    // le quota de photos.
    txInterventionFindFirst.mockResolvedValue(null);

    await demarrerInterventionDuTech({
      interventionId: 999,
      techId: TECH,
      maintenant: MAINTENANT,
    });

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("relit SOUS le verrou et refuse si le statut a change entre les deux", async () => {
    // La premiere lecture a servi aux gardes, la seconde decide. Entre les
    // deux, une transaction voisine a pu commiter son propre passage en
    // IN_PROGRESS, ou une annulation par le client.
    armer("PLANNED", "CANCELLED");

    const resultat = await demarrerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
      maintenant: MAINTENANT,
    });

    expect(resultat).toEqual({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "CANCELLED",
    });
    expect(txInterventionUpdate).not.toHaveBeenCalled();
  });

  it("ecrit l'audit DANS la transaction, avec la transition en `details`", async () => {
    // ⚠️ `details` et non `metadata` : la SPEC nomme un champ qui n'existe pas
    // dans `AuditEntry`, troisieme occurrence de l'erreur (la PR #39 l'avait
    // deja corrigee deux fois sur T-V3-12).
    armer();

    await demarrerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
      maintenant: MAINTENANT,
    });

    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        entityType: "interventions",
        entityId: "847",
        action: "UPDATE",
        actorId: TECH,
        details: { statutAvant: "PLANNED", statutApres: "IN_PROGRESS" },
      },
    });
  });

  it("n'ecrit AUCUNE trace quand la transition est refusee", async () => {
    // `audit_logs` est la piece qu'on produit en cas de contestation : une
    // entree pour une transition qui n'a pas eu lieu est pire qu'une absence.
    armer("DONE");

    await demarrerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
      maintenant: MAINTENANT,
    });

    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("serialise deux demarrages concurrents et n'ecrit QU'UNE entree d'audit", async () => {
    // 🔴 Le test que le verrou existe. Sans `FOR UPDATE`, les deux transactions
    // passent la lecture de statut sous READ COMMITTED et ecrivent DEUX entrees
    // d'audit sur la meme transition : le second `UPDATE` est inoffensif, la
    // trace ne l'est pas, elle daterait deux fois un demarrage unique.
    //
    // Le faux client modele le regime reel : premiere lecture non bloquante,
    // verrou de ligne qui fait attendre la transaction suivante jusqu'au commit
    // de la precedente.
    let commite = false;
    txInterventionFindFirst.mockResolvedValue({ status: "PLANNED" });
    txInterventionFindUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ status: commite ? "IN_PROGRESS" : "PLANNED" }),
    );
    txInterventionUpdate.mockImplementation(() => {
      commite = true;
      return Promise.resolve({});
    });

    const [premier, second] = await Promise.all([
      demarrerInterventionDuTech({
        interventionId: 847,
        techId: TECH,
        maintenant: MAINTENANT,
      }),
      demarrerInterventionDuTech({
        interventionId: 847,
        techId: TECH,
        maintenant: MAINTENANT,
      }),
    ]);

    expect([premier, second].filter((resultat) => resultat.ok)).toHaveLength(1);
    expect([premier, second]).toContainEqual({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "IN_PROGRESS",
    });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ⚠️ Ajouts de l'agent testeur, 2026-08-13 - ce que le harnais de T-V2-02 ne
// modelisait pas.
// ─────────────────────────────────────────────────────────────────────────

describe("demarrerInterventionDuTech - l'atomicite, dans l'autre sens", () => {
  const MAINTENANT = new Date("2026-08-20T08:02:00.000Z");

  it("n'ecrit PAS la transition quand la trace d'audit echoue", async () => {
    // 🔴 La DoD dit « entree `audit_logs` dans la MEME transaction ». Le test
    // livre prouve la moitie facile - la trace part bien par le client
    // transactionnel - mais pas celle qui coute : qu'un echec de la trace
    // EMPORTE la mutation. Sans elle, une intervention passerait en
    // `IN_PROGRESS` sans qu'aucune piece n'en garde le souvenir, et c'est
    // exactement l'etat que « dans la meme transaction » existe pour interdire.
    //
    // Le verdict se lit sur le rollback, pas sur la valeur rendue : le rappel de
    // `$transaction` qui LEVE annule, celui qui rend commite.
    txInterventionFindFirst.mockResolvedValue({ status: "PLANNED" });
    txInterventionFindUniqueOrThrow.mockResolvedValue({ status: "PLANNED" });
    // `…Once` et non `mockRejectedValue` : `vi.clearAllMocks()` efface
    // l'historique des appels, PAS les implementations, et une trace qui
    // resterait en echec contaminerait les tests suivants du fichier.
    auditCreate.mockRejectedValueOnce(new Error("audit_logs indisponible"));

    await expect(
      demarrerInterventionDuTech({
        interventionId: 847,
        techId: TECH,
        maintenant: MAINTENANT,
      }),
    ).rejects.toThrow();

    expect(rollbacks).toHaveLength(1);
    expect(commits).toHaveLength(0);
  });
});

describe("la course que le harnais de T-V2-02 ne joue pas : demarrage CONTRE annulation", () => {
  // ⚠️ Le test de concurrence livre fait courir **deux demarrages**, donc deux
  // fois le meme code contre lui-meme. La course qui existe reellement en
  // production oppose **deux acteurs et deux tables de decision** : le
  // technicien qui demarre et le client qui annule, chacun avec sa propre garde
  // de propriete, son propre statut cible et sa propre entree d'audit.
  //
  // Rien n'interdit qu'elles se croisent : `annulationOuverte` ouvre
  // l'annulation jusqu'a H-24, et **aucune borne temporelle n'encadre le
  // demarrage** - un technicien peut demarrer une intervention la veille. La
  // fenetre est donc reelle, pas theorique.
  //
  // Ce que la propriete exige : le verrou de ligne les serialise, une seule des
  // deux transitions a lieu, et `audit_logs` porte **une** entree et non deux
  // recits contradictoires du meme instant.
  const RDV = new Date("2026-08-20T08:00:00.000Z");
  // H-25 cote client : sa fenetre d'annulation est ouverte.
  const MAINTENANT = new Date("2026-08-19T07:00:00.000Z");

  it("serialise les deux acteurs, et n'en laisse passer qu'un", async () => {
    let statut = "PLANNED";

    // Chaque acteur lit AVEC SA PROPRE clause de propriete : le technicien par
    // `techId`, le client par `clientId`. Le faux client les distingue, sinon
    // l'un des deux lirait la ligne de l'autre et la course serait truquee.
    txInterventionFindFirst.mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if (where["techId"]) return Promise.resolve({ status: statut });

      return Promise.resolve({
        status: statut,
        appointmentAt: RDV,
        durationSnapshot: 60,
        service: { label: "Revision complete" },
        tech: { email: "tech@exemple.fr", firstname: "Marc" },
        address: {
          street: "12 rue de la Republique",
          city: { zipCode: "69002", city: "Lyon" },
        },
      });
    });

    // La relecture sous verrou voit l'etat COMMITE, ce que la file de verrous du
    // harnais garantit : la seconde transaction n'y arrive qu'apres la premiere.
    txInterventionFindUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ status: statut }),
    );
    txInterventionUpdate.mockImplementation((args: unknown) => {
      statut = (args as { data: { status: string } }).data.status;
      return Promise.resolve({});
    });

    const [demarrage, annulation] = await Promise.all([
      demarrerInterventionDuTech({
        interventionId: 847,
        techId: TECH,
        maintenant: MAINTENANT,
      }),
      annulerInterventionDuClient({
        interventionId: 847,
        clientId: CLIENT,
        motif: "Empechement de derniere minute",
        maintenant: MAINTENANT,
      }),
    ]);

    // Une seule des deux transitions, une seule ecriture, une seule trace.
    expect([demarrage, annulation].filter((issue) => issue.ok)).toHaveLength(1);
    expect(txInterventionUpdate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledTimes(1);

    // Et le perdant recoit le refus de SA propre grammaire, pas une panne : les
    // deux unions discriminees restent lisibles par leur appelant.
    const refus = demarrage.ok ? annulation : demarrage;
    expect(refus).toEqual(
      demarrage.ok
        ? { ok: false, reason: "non_annulable" }
        : {
            ok: false,
            reason: "transition_illegale",
            statutCourant: "CANCELLED",
          },
    );

    // Les deux transactions COMMITENT : un refus metier est une valeur rendue,
    // pas une exception. Un rollback ici voudrait dire qu'on paie une erreur
    // Postgres pour une reponse que le domaine sait donner.
    expect(commits).toHaveLength(2);
    expect(rollbacks).toHaveLength(0);
  });
});

describe("chargerInterventionDuTech - les champs dont l'ecran depend", () => {
  it("fait traverser `startedAt`, le compte-rendu et le TYPE des photos", async () => {
    // ⚠️ Trois champs qu'aucune assertion ne suivait jusqu'au DTO, alors que
    // l'ecran en depend directement : `startedAt` porte le jalon date du hub en
    // `IN_PROGRESS`, `techComment` decide du rendu du bloc compte-rendu, et
    // `photo.type` decide du texte alternatif (« jointe par le client » contre
    // « prise apres l'intervention »). Une projection qui les oublierait
    // rendrait un hub muet et des images mal decrites, sans faire rougir quoi
    // que ce soit.
    lirePointsAdresses.mockResolvedValue(new Map());
    interventionFindFirst.mockResolvedValue({
      id: 847,
      status: "IN_PROGRESS",
      appointmentAt: new Date("2026-08-20T08:00:00.000Z"),
      startedAt: new Date("2026-08-20T08:02:00.000Z"),
      durationSnapshot: 60,
      priceSnapshot: new Prisma.Decimal("85.00"),
      cancellationReason: null,
      techComment: "Chaine changee, cassette a surveiller.",
      service: { label: "Revision complete", description: null },
      client: {
        firstname: "Julien",
        lastname: "Marceau",
        phone: "0612345678",
        email: "julien@exemple.fr",
      },
      address: {
        id: 77,
        street: "8 quai Saint-Antoine",
        city: { zipCode: "69002", city: "Lyon" },
      },
      cycle: null,
      products: [],
      photos: [
        { id: 3, type: "BEFORE" },
        { id: 9, type: "AFTER" },
      ],
    });

    const detail = await chargerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
    });

    expect(detail?.startedAt).toEqual(new Date("2026-08-20T08:02:00.000Z"));
    expect(detail?.techComment).toBe("Chaine changee, cassette a surveiller.");
    expect(detail?.photos).toEqual([
      { id: 3, type: "BEFORE" },
      { id: 9, type: "AFTER" },
    ]);
  });

  it("ne remonte AUCUN identifiant de compte au-dela de la ligne", async () => {
    // Minimisation, meme geste que le retrait du libelle memo de l'adresse :
    // l'ecran nomme le client, il n'a besoin ni de son UUID ni de celui du
    // technicien. Un identifiant qui traverserait finirait dans le HTML rendu.
    lirePointsAdresses.mockResolvedValue(new Map());
    interventionFindFirst.mockResolvedValue({
      id: 847,
      status: "PLANNED",
      appointmentAt: new Date("2026-08-20T08:00:00.000Z"),
      startedAt: null,
      durationSnapshot: 60,
      priceSnapshot: new Prisma.Decimal("85.00"),
      cancellationReason: null,
      techComment: null,
      service: { label: "Revision complete", description: null },
      client: {
        firstname: "Julien",
        lastname: "Marceau",
        phone: "0612345678",
        email: "julien@exemple.fr",
      },
      address: {
        id: 77,
        street: "8 quai Saint-Antoine",
        city: { zipCode: "69002", city: "Lyon" },
      },
      cycle: null,
      products: [],
      photos: [],
    });

    const detail = await chargerInterventionDuTech({
      interventionId: 847,
      techId: TECH,
    });

    const serialise = JSON.stringify(detail);
    expect(serialise).not.toContain(TECH);
    expect(serialise).not.toContain(CLIENT);
  });
});
