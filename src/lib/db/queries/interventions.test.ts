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

vi.mock("@/lib/db/client", () => ({
  db: {
    $transaction: (rappel: (client: typeof tx) => unknown) =>
      transaction(rappel),
  },
}));

vi.mock("@/lib/db/queries/adresses", () => ({
  resoudreCommune: () => Promise.resolve(69_383),
  creerAdresse: () => Promise.resolve(77),
}));

const { reserverIntervention } = await import("./interventions");

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
