// @vitest-environment node
//
// Ce que ces schémas protègent n'est pas la saisie - l'écran ne produit pas ces
// formes - mais l'appel direct. Une Server Action exportée est un endpoint POST
// public (ADR-006 v2).
import { describe, expect, it } from "vitest";

import {
  ajouterProduitSchema,
  lignePanierSchema,
  panierSchema,
} from "./produits";

describe("lignePanierSchema", () => {
  it("refuse une quantité nulle, négative ou fractionnaire", () => {
    for (const quantity of [0, -1, 1.5]) {
      expect(
        lignePanierSchema.safeParse({ productId: 2, quantity }).success,
      ).toBe(false);
    }
  });

  it("ne transporte AUCUN prix", () => {
    // Constitution §4.1 : `unit_price_snapshot` est lu en base à la vente. Un
    // prix accepté ici serait un prix choisi par l'acheteur - le schéma le
    // laisse tomber au lieu de le voir passer.
    const analyse = lignePanierSchema.parse({
      productId: 2,
      quantity: 1,
      price: "0.01",
    });

    expect(analyse).toEqual({ productId: 2, quantity: 1 });
  });
});

describe("panierSchema", () => {
  it("vaut le panier vide quand rien n'est envoyé", () => {
    // La très grande majorité des réservations n'a pas de produit. Exiger le
    // champ ferait échouer la validation d'un tunnel parfaitement valide.
    expect(panierSchema.parse(undefined)).toEqual([]);
  });

  it("refuse deux lignes du même produit", () => {
    // Contrainte de MODÈLE avant d'être une règle de saisie : la clé primaire
    // de `intervention_products` est le couple `(intervention_id, product_id)`.
    // Sans ce refus, l'écriture échouerait en base, et le client lirait
    // « une erreur est survenue » pour un panier qu'il croit légitime.
    const analyse = panierSchema.safeParse([
      { productId: 2, quantity: 1 },
      { productId: 2, quantity: 3 },
    ]);

    expect(analyse.success).toBe(false);
  });

  it("accepte plusieurs produits distincts", () => {
    const analyse = panierSchema.safeParse([
      { productId: 2, quantity: 1 },
      { productId: 3, quantity: 2 },
    ]);

    expect(analyse.success).toBe(true);
  });
});

describe("ajouterProduitSchema", () => {
  it("exige les trois identifiants du geste T+n", () => {
    expect(
      ajouterProduitSchema.safeParse({ interventionId: 42, productId: 2 })
        .success,
    ).toBe(false);
    expect(
      ajouterProduitSchema.safeParse({
        interventionId: 42,
        productId: 2,
        quantity: 1,
      }).success,
    ).toBe(true);
  });
});
