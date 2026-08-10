// @vitest-environment node
//
// Rappel d'ADR-006 v2, porté par `src/lib/safe-action.ts` : **une Server Action
// exportée est un endpoint POST public**. Tout ce qui est testé ici est donc
// appelé sans passer par aucun écran - ce qui est exactement la surface que le
// détail d'intervention ne pourra jamais prouver, l'écran n'étant qu'un des
// appelants possibles.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const ajouterProduitIntervention = vi.fn();
vi.mock("@/lib/db/queries/produits", () => ({
  ajouterProduitIntervention: (args: unknown) =>
    ajouterProduitIntervention(args),
}));

const { ajouterProduit } = await import("./ajouter-produit");

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({
    id: CLIENT,
    email: "client@example.test",
  });
  ajouterProduitIntervention.mockResolvedValue({ ok: true, total: "97.90" });
});

describe("ajouterProduit", () => {
  it("prend le propriétaire dans la SESSION, jamais dans la charge utile", async () => {
    // `interventions.id` est un SERIAL, donc énumérable. Si le client de la
    // ligne venait de l'entrée, ajouter un produit à la commande du voisin
    // serait une question d'entier.
    await ajouterProduit({
      interventionId: 42,
      productId: 2,
      quantity: 1,
    });

    expect(ajouterProduitIntervention).toHaveBeenCalledWith({
      interventionId: 42,
      productId: 2,
      quantity: 1,
      clientId: CLIENT,
    });
  });

  it("rend le total recalculé après l'ajout", async () => {
    const resultat = await ajouterProduit({
      interventionId: 42,
      productId: 2,
      quantity: 1,
    });

    expect(resultat?.data).toEqual({ ok: true, total: "97.90" });
  });

  it("refuse une quantité nulle ou négative avant d'atteindre la base", async () => {
    const resultat = await ajouterProduit({
      interventionId: 42,
      productId: 2,
      quantity: 0,
    });

    expect(resultat?.validationErrors).toBeDefined();
    expect(ajouterProduitIntervention).not.toHaveBeenCalled();
  });

  it("dit le plafond quand le stock ne suffit pas", async () => {
    // Le libellé de `US-INTERVENTION-PRODUIT-AJOUTER` §Cas d'erreur, au
    // cadratin près : le dépôt n'en porte aucun (CLAUDE.md §Typographie).
    ajouterProduitIntervention.mockResolvedValue({
      ok: false,
      reason: "stock_insuffisant",
      label: "Antivol en U",
      disponible: 2,
    });

    const resultat = await ajouterProduit({
      interventionId: 42,
      productId: 2,
      quantity: 5,
    });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Stock insuffisant, quantité maximale : 2.",
    });
  });

  it("dit la rupture plutôt qu'un plafond de zéro", async () => {
    ajouterProduitIntervention.mockResolvedValue({
      ok: false,
      reason: "stock_insuffisant",
      label: "Antivol en U",
      disponible: 0,
    });

    const resultat = await ajouterProduit({
      interventionId: 42,
      productId: 2,
      quantity: 1,
    });

    expect(resultat?.data).toMatchObject({
      message: "Antivol en U est en rupture de stock.",
    });
  });

  it("refuse l'ajout sur une intervention démarrée", async () => {
    ajouterProduitIntervention.mockResolvedValue({
      ok: false,
      reason: "verrouillee",
    });

    const resultat = await ajouterProduit({
      interventionId: 42,
      productId: 2,
      quantity: 1,
    });

    expect(resultat?.data).toMatchObject({
      message:
        "Ajout impossible sur une intervention déjà démarrée ou clôturée.",
    });
  });

  it("ne distingue pas l'intervention inconnue de celle d'un tiers", async () => {
    ajouterProduitIntervention.mockResolvedValue({
      ok: false,
      reason: "introuvable",
    });

    const resultat = await ajouterProduit({
      interventionId: 999,
      productId: 2,
      quantity: 1,
    });

    expect(resultat?.data).toMatchObject({
      message: "Intervention introuvable.",
    });
  });
});
