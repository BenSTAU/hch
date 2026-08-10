// @vitest-environment node
//
// Vente additionnelle : le verrou de stock, la symétrie du retrait, et les deux
// gardes qui décident qui peut encore toucher au panier.
//
// ⚠️ Ce que ces tests ne prouvent PAS : qu'un `SELECT … FOR UPDATE` sérialise
// réellement deux ventes concurrentes. Un `tx` simulé exécute les callbacks
// l'un après l'autre par construction, il rendrait vert un code sans aucun
// verrou. Ce qui se vérifie ici est la FORME de la requête et l'ordre des
// écritures.
//
// Le filet qui tient quand même, lui, se prouve sur un vrai PostgreSQL :
// `tests/e2e/produits-stock.spec.ts` montre que la contrainte
// `products_stock_non_negative` refuse le stock négatif **sans** le garde
// applicatif. C'est la seconde moitié du double filet, et la seule des deux
// qu'un chemin d'écriture futur ne pourra pas oublier.
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requetes: string[] = [];
const queryRaw = vi.fn();
const productUpdate = vi.fn();
const interventionProductCreate = vi.fn();
const interventionProductUpsert = vi.fn();
const interventionProductDelete = vi.fn();
const interventionProductFindUnique = vi.fn();
const interventionProductFindMany = vi.fn();
const interventionFindFirst = vi.fn();

const tx = {
  $queryRaw: (strings: TemplateStringsArray, ...valeurs: unknown[]) => {
    requetes.push(strings.join(" ? "));
    return queryRaw(valeurs);
  },
  product: { update: productUpdate },
  interventionProduct: {
    create: interventionProductCreate,
    upsert: interventionProductUpsert,
    delete: interventionProductDelete,
    findUnique: interventionProductFindUnique,
    findMany: interventionProductFindMany,
  },
  intervention: { findFirst: interventionFindFirst },
};

vi.mock("@/lib/db/client", () => ({
  db: {
    $transaction: (rappel: (client: typeof tx) => unknown) => rappel(tx),
    product: { findMany: vi.fn() },
  },
}));

const {
  ajouterProduitIntervention,
  retirerProduitIntervention,
  vendreProduits,
} = await import("./produits");

const ANTIVOL = {
  id: 2,
  label: "Antivol en U",
  price: new Prisma.Decimal("39.90"),
  stock: 5,
  isActive: true,
};

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";
const TIERS = "9c8b7a65-4321-4fed-8cba-0987654321fe";

beforeEach(() => {
  vi.clearAllMocks();
  requetes.length = 0;
  queryRaw.mockResolvedValue([ANTIVOL]);
  interventionFindFirst.mockResolvedValue({
    status: "PLANNED",
    priceSnapshot: new Prisma.Decimal("85.00"),
  });
  interventionProductFindMany.mockResolvedValue([]);
});

describe("vendreProduits - T=0, dans la transaction de réservation", () => {
  it("fige le prix du CATALOGUE, jamais celui reçu de l'écran", async () => {
    // Constitution §4.1. Un `unit_price_snapshot` qui viendrait de la charge
    // utile serait un prix choisi par l'acheteur.
    const resultat = await vendreProduits(tx as never, {
      interventionId: 42,
      panier: [{ productId: 2, quantity: 2 }],
    });

    expect(resultat.ok).toBe(true);
    expect(interventionProductCreate).toHaveBeenCalledWith({
      data: {
        interventionId: 42,
        productId: 2,
        quantity: 2,
        unitPriceSnapshot: ANTIVOL.price,
      },
    });
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { stock: { decrement: 2 } },
    });
  });

  it("rend le total des lignes vendues", async () => {
    const resultat = await vendreProduits(tx as never, {
      interventionId: 42,
      panier: [{ productId: 2, quantity: 3 }],
    });

    expect(resultat.ok && resultat.total.toFixed(2)).toBe("119.70");
  });

  it("verrouille les lignes dans un ordre déterministe", async () => {
    // Deux paniers qui se croisent sur les mêmes produits doivent verrouiller
    // dans le MÊME ordre, sinon ils se tiennent chacun la ligne que l'autre
    // attend. C'est la seule protection contre l'interblocage, et elle est
    // invisible à la relecture du reste de la fonction.
    await vendreProduits(tx as never, {
      interventionId: 42,
      panier: [{ productId: 2, quantity: 1 }],
    });

    expect(requetes[0]).toContain("FOR UPDATE");
    expect(requetes[0]).toContain('ORDER BY "id"');
  });

  it("verrouille TOUT le panier en une fois, avant la première écriture", async () => {
    // ⚠️ Ajouté par l'agent testeur, 2026-08-10. Le test ci-dessus lit la forme
    // de la requête sur un panier d'UN produit : un refactor qui verrouillerait
    // ligne par ligne dans la boucle le laisserait vert, et perdrait pourtant
    // la seule protection contre l'interblocage. `ORDER BY "id"` ne trie que
    // l'intérieur d'une requête - il ne dit rien de l'ordre entre deux.
    queryRaw.mockResolvedValue([
      ANTIVOL,
      {
        id: 1,
        label: "Chambre a air",
        price: new Prisma.Decimal("12.90"),
        stock: 40,
        isActive: true,
      },
    ]);

    await vendreProduits(tx as never, {
      interventionId: 42,
      panier: [
        { productId: 2, quantity: 1 },
        { productId: 1, quantity: 1 },
      ],
    });

    expect(requetes).toHaveLength(1);
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      productUpdate.mock.invocationCallOrder[0] ?? 0,
    );
    expect(productUpdate).toHaveBeenCalledTimes(2);
  });

  it("n'écrit aucune ligne quand le stock ne suffit plus", async () => {
    queryRaw.mockResolvedValue([{ ...ANTIVOL, stock: 1 }]);

    const resultat = await vendreProduits(tx as never, {
      interventionId: 42,
      panier: [{ productId: 2, quantity: 3 }],
    });

    expect(resultat).toMatchObject({
      ok: false,
      reason: "stock_insuffisant",
      label: "Antivol en U",
      disponible: 1,
    });
    expect(interventionProductCreate).not.toHaveBeenCalled();
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("refuse un produit dépublié pendant la composition du panier", async () => {
    queryRaw.mockResolvedValue([{ ...ANTIVOL, isActive: false }]);

    const resultat = await vendreProduits(tx as never, {
      interventionId: 42,
      panier: [{ productId: 2, quantity: 1 }],
    });

    expect(resultat).toMatchObject({
      ok: false,
      reason: "produit_indisponible",
    });
  });

  it("ne touche pas la base pour un panier vide", async () => {
    const resultat = await vendreProduits(tx as never, {
      interventionId: 42,
      panier: [],
    });

    expect(resultat.ok && resultat.total.toFixed(2)).toBe("0.00");
    expect(requetes).toHaveLength(0);
  });
});

describe("ajouterProduitIntervention - T+n", () => {
  it("répond « introuvable » sur l'intervention d'un tiers", async () => {
    // Le filtre porte sur le COUPLE (id, client). Une réponse distincte de
    // « inconnue » confirmerait l'existence de l'intervention du voisin à qui
    // incrémente un entier - défaut déjà payé sur les adresses (PR #26 note 4).
    interventionFindFirst.mockResolvedValue(null);

    const resultat = await ajouterProduitIntervention({
      interventionId: 42,
      productId: 2,
      quantity: 1,
      clientId: TIERS,
    });

    expect(resultat).toEqual({ ok: false, reason: "introuvable" });
    expect(interventionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42, clientId: TIERS },
      }),
    );
  });

  it("refuse dès que l'intervention est démarrée", async () => {
    // Décision B7 Q2a : bloqué dès `IN_PROGRESS`, pas seulement une fois
    // terminée.
    interventionFindFirst.mockResolvedValue({
      status: "IN_PROGRESS",
      priceSnapshot: new Prisma.Decimal("85.00"),
    });

    const resultat = await ajouterProduitIntervention({
      interventionId: 42,
      productId: 2,
      quantity: 1,
      clientId: CLIENT,
    });

    expect(resultat).toEqual({ ok: false, reason: "verrouillee" });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("plafonne sur le DELTA, pas sur la quantité déjà commandée", async () => {
    // Trois unités déjà sur l'intervention, deux au catalogue : en ajouter deux
    // est légitime. Plafonner sur le total (5 > 2) refuserait une vente
    // possible, et le refus serait muet - le client ne comprendrait pas
    // pourquoi deux exemplaires affichés « disponibles » lui sont refusés.
    queryRaw.mockResolvedValue([{ ...ANTIVOL, stock: 2 }]);

    const resultat = await ajouterProduitIntervention({
      interventionId: 42,
      productId: 2,
      quantity: 2,
      clientId: CLIENT,
    });

    expect(resultat.ok).toBe(true);
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { stock: { decrement: 2 } },
    });
  });

  it("incrémente la quantité et CONSERVE le prix figé au premier achat", async () => {
    // La clé primaire est le couple `(intervention_id, product_id)` : le modèle
    // ne peut pas porter deux prix pour le même produit. Réactualiser le
    // snapshot réécrirait le prix d'unités déjà vendues (Constitution §4.1).
    await ajouterProduitIntervention({
      interventionId: 42,
      productId: 2,
      quantity: 1,
      clientId: CLIENT,
    });

    expect(interventionProductUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: { increment: 1 } },
      }),
    );
  });

  it("rend le total forfait + produits", async () => {
    interventionProductFindMany.mockResolvedValue([
      { quantity: 2, unitPriceSnapshot: new Prisma.Decimal("39.90") },
      { quantity: 1, unitPriceSnapshot: new Prisma.Decimal("12.90") },
    ]);

    const resultat = await ajouterProduitIntervention({
      interventionId: 42,
      productId: 2,
      quantity: 1,
      clientId: CLIENT,
    });

    // 85.00 + 79.80 + 12.90
    expect(resultat).toMatchObject({ ok: true, total: "177.70" });
  });
});

describe("symétrie du stock", () => {
  it("retrait puis ré-ajout laissent le stock INCHANGÉ", async () => {
    // La DoD de T-V3-09, mot pour mot : c'est cette égalité qui prouve la
    // symétrie. Un décrément sans restitution ne se voit pas à l'écran - il se
    // voit trois semaines plus tard, sur un catalogue vidé par des paniers
    // remaniés, et plus rien alors ne dit d'où vient le manque.
    //
    // Le faux `tx` TIENT ici un stock, au lieu d'enregistrer des appels : la
    // propriété porte sur la valeur finale, pas sur la forme des deux écritures
    // prises séparément.
    let stock = 5;
    productUpdate.mockImplementation(
      ({
        data,
      }: {
        data: { stock: { increment?: number; decrement?: number } };
      }) => {
        stock += (data.stock.increment ?? 0) - (data.stock.decrement ?? 0);
        return { stock };
      },
    );
    queryRaw.mockImplementation(() => [{ ...ANTIVOL, stock }]);
    interventionProductFindUnique.mockResolvedValue({ quantity: 2 });

    const depart = stock;

    await retirerProduitIntervention({
      interventionId: 42,
      productId: 2,
      clientId: CLIENT,
    });
    expect(stock).toBe(depart + 2);

    await ajouterProduitIntervention({
      interventionId: 42,
      productId: 2,
      quantity: 2,
      clientId: CLIENT,
    });

    expect(stock).toBe(depart);
  });
});

describe("retirerProduitIntervention - T+n", () => {
  it("restitue exactement la quantité retirée", async () => {
    // La symétrie du décrément. Sans elle, un catalogue se vide au fil des
    // paniers remaniés et rien ne le signale avant la rupture.
    interventionProductFindUnique.mockResolvedValue({ quantity: 3 });

    const resultat = await retirerProduitIntervention({
      interventionId: 42,
      productId: 2,
      clientId: CLIENT,
    });

    expect(resultat.ok).toBe(true);
    expect(productUpdate).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { stock: { increment: 3 } },
    });
    expect(interventionProductDelete).toHaveBeenCalled();
  });

  it("verrouille le produit AVANT de lire la ligne", async () => {
    // Deux retraits concurrents de la même ligne restitueraient sinon le stock
    // deux fois : les deux liraient `quantity: 3` avant que l'un ait supprimé.
    interventionProductFindUnique.mockResolvedValue({ quantity: 1 });

    await retirerProduitIntervention({
      interventionId: 42,
      productId: 2,
      clientId: CLIENT,
    });

    expect(requetes[0]).toContain("FOR UPDATE");
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      interventionProductFindUnique.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("ne restitue rien quand la ligne a déjà disparu", async () => {
    // Double-clic, ou onglet resté ouvert sur un état périmé.
    interventionProductFindUnique.mockResolvedValue(null);

    const resultat = await retirerProduitIntervention({
      interventionId: 42,
      productId: 2,
      clientId: CLIENT,
    });

    expect(resultat).toEqual({ ok: false, reason: "ligne_absente" });
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it("refuse dès que l'intervention est démarrée", async () => {
    interventionFindFirst.mockResolvedValue({
      status: "IN_PROGRESS",
      priceSnapshot: new Prisma.Decimal("85.00"),
    });

    const resultat = await retirerProduitIntervention({
      interventionId: 42,
      productId: 2,
      clientId: CLIENT,
    });

    expect(resultat).toEqual({ ok: false, reason: "verrouillee" });
    expect(interventionProductDelete).not.toHaveBeenCalled();
  });
});
