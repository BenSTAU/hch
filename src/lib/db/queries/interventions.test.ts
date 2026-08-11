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

const tx = {
  $queryRaw: (_strings: TemplateStringsArray, ...valeurs: unknown[]) =>
    queryRaw(valeurs),
  product: { update: productUpdate },
  intervention: { create: interventionCreate },
  interventionProduct: { create: interventionProductCreate },
  photo: { createMany: photoCreateMany },
  service: { findUniqueOrThrow: serviceFindUniqueOrThrow },
  address: { findFirst: addressFindFirst },
};

/// Ce que la base fait du rappel : commit s'il rend, rollback s'il lève.
const commits: string[] = [];
const rollbacks: string[] = [];

const transaction = vi.fn(async (rappel: (client: typeof tx) => unknown) => {
  try {
    const valeur = await rappel(tx);
    commits.push("commit");
    return valeur;
  } catch (erreur) {
    rollbacks.push("rollback");
    throw erreur;
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
    $transaction: (rappel: (client: typeof tx) => unknown) =>
      transaction(rappel),
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

const {
  abregerNom,
  chargerInterventionDuClient,
  compterInterventionsClient,
  listerInterventionsAVenir,
  listerInterventionsPassees,
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
    photos: [],
    panier: [],
    ...surcharge,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  commits.length = 0;
  rollbacks.length = 0;

  addressFindFirst.mockResolvedValue({ id: 77 });
  serviceFindUniqueOrThrow.mockResolvedValue({
    price: new Prisma.Decimal("85.00"),
    duration: 60,
    label: "Revision complete",
  });
  interventionCreate.mockResolvedValue({ id: 4242 });
  queryRaw.mockResolvedValue([ANTIVOL, CHAMBRE]);
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
// Lectures de l'espace client — T-V3-10.
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
    // Une borne `<= 2026-08-11T00:00Z` ecarterait tout ce qui a eu lieu dans la
    // journee du 11, ce qui est faux pour qui vient de saisir cette date comme
    // fin de periode. Le defaut ne se voit que sur la derniere journee choisie.
    await listerInterventionsPassees({
      clientId: CLIENT,
      du: new Date("2026-01-01T00:00:00.000Z"),
      au: new Date("2026-08-11T00:00:00.000Z"),
    });

    const args = interventionFindMany.mock.calls[0]?.[0] as {
      where: { appointmentAt: { gte: Date; lt: Date } };
    };

    expect(args.where.appointmentAt.gte).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(args.where.appointmentAt.lt).toEqual(
      new Date("2026-08-12T00:00:00.000Z"),
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

describe("chargerInterventionDuClient", () => {
  it("repond `null` sur l'intervention d'un tiers, sans la distinguer d'une inconnue", async () => {
    // `interventions.id` est un SERIAL, donc enumerable : une reponse « acces
    // refuse » distincte d'un « introuvable » confirmerait l'existence du
    // rendez-vous d'autrui a qui s'amuse a incrementer. Meme arbitrage que
    // PR #32 note 6.
    interventionFindFirst.mockResolvedValue(null);

    await expect(
      chargerInterventionDuClient({ interventionId: 848, clientId: CLIENT }),
    ).resolves.toBeNull();

    expect(interventionFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 848, clientId: CLIENT },
    });
  });

  it("projette comme les listes", async () => {
    interventionFindFirst.mockResolvedValue(ligneLue());

    const intervention = await chargerInterventionDuClient({
      interventionId: 847,
      clientId: CLIENT,
    });

    expect(intervention).toMatchObject({
      id: 847,
      forfait: "Revision complete",
      technicien: "Marc L.",
      total: "85.00",
      adresse: {
        label: "Domicile",
        street: "12 rue de la Republique",
        zipCode: "69002",
        city: "Lyon",
      },
    });
  });
});

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
