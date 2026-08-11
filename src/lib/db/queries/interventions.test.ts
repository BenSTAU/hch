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

const {
  abregerNom,
  annulerInterventionDuClient,
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
  fileDesVerrous = Promise.resolve();

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
