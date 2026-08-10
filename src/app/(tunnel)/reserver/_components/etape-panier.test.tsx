import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { PRODUITS } from "@/test/tunnel";

import { EtapePanier } from "./etape-panier";

/// Bloc panier de C5. Ce fichier vérifie la composition du panier côté écran ;
/// ce qui se vend et à quel prix se décide en base, et se vérifie dans
/// `src/lib/db/queries/produits.test.ts`.

function poser(
  panier: { productId: number; quantity: number }[] = [],
  produits = PRODUITS,
) {
  const onChangement = vi.fn();
  const utilisateur = userEvent.setup();
  const { container } = render(
    <EtapePanier
      produits={produits}
      panier={panier}
      onChangement={onChangement}
    />,
  );
  return { container, onChangement, utilisateur };
}

describe("EtapePanier - composition", () => {
  it("ajoute un produit avec la quantité 1 par défaut", async () => {
    const { onChangement, utilisateur } = poser();

    await utilisateur.click(
      screen.getByRole("button", { name: /ajouter.*antivol en u/i }),
    );

    expect(onChangement).toHaveBeenCalledWith([{ productId: 2, quantity: 1 }]);
  });

  it("incrémente sans dupliquer la ligne", async () => {
    // La clé primaire de `intervention_products` est le couple
    // `(intervention_id, product_id)` : une seconde ligne du même produit
    // ferait échouer l'écriture en base.
    const { onChangement, utilisateur } = poser([
      { productId: 2, quantity: 1 },
    ]);

    await utilisateur.click(
      screen.getByRole("button", { name: /ajouter une unité de antivol/i }),
    );

    expect(onChangement).toHaveBeenCalledWith([{ productId: 2, quantity: 2 }]);
  });

  it("retire la ligne quand la quantité retombe à zéro", async () => {
    // Et non une ligne à `quantity: 0`, que le schéma refuserait à la
    // validation - le refus arriverait alors au dernier écran, pour un geste
    // fait trois pas plus tôt.
    const { onChangement, utilisateur } = poser([
      { productId: 2, quantity: 1 },
    ]);

    await utilisateur.click(
      screen.getByRole("button", { name: /retirer une unité de antivol/i }),
    );

    expect(onChangement).toHaveBeenCalledWith([]);
  });

  it("plafonne la quantité au stock disponible", async () => {
    // `US-INTERVENTION-PRODUIT-AJOUTER` : « plafond = stock disponible ».
    const { utilisateur } = poser(
      [{ productId: 9, quantity: 2 }],
      [
        {
          id: 9,
          label: "Dernier antivol",
          description: null,
          price: "39.90",
          stock: 2,
        },
      ],
    );

    expect(
      screen.getByRole("button", { name: /ajouter une unité de/i }),
    ).toBeDisabled();
    await utilisateur.click(
      screen.getByRole("button", { name: /retirer une unité de/i }),
    );
  });
});

describe("EtapePanier - rupture", () => {
  it("montre la rupture et n'offre aucun moyen d'ajouter", async () => {
    const { container } = poser(
      [],
      [
        {
          id: 9,
          label: "Antivol épuisé",
          description: null,
          price: "39.90",
          stock: 0,
        },
      ],
    );

    expect(screen.getByText(/rupture/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ajouter/i })).toBeNull();
    // Le grisé ne suffit pas : l'information doit aussi être textuelle
    // (RGAA A, l'information ne passe pas par la seule couleur).
    expect(screen.getByText(/indisponible/i)).toBeInTheDocument();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("laisse retirer une ligne dont le produit est tombé en rupture", async () => {
    // ⚠️ **Rouge à l'écriture, agent testeur, 2026-08-10. Défaut de produit,
    // pas d'oracle.**
    //
    // Le cas est celui que la DoD décrit elle-même : le panier survit à
    // l'aller-retour d'activation, le catalogue est relu par le serveur au
    // retour, et le produit a pu partir entre-temps. La carte bascule alors sur
    // la branche `rupture`, qui rend « Indisponible » AU LIEU du sélecteur de
    // quantité (`etape-panier.tsx:178-181`) : la ligne reste dans le panier,
    // elle continue de compter dans le total du récapitulatif, la validation la
    // refuse - et l'écran n'offre aucun moyen de l'enlever. Le tunnel est en
    // impasse sur son dernier écran.
    //
    // La DoD dit « ne rien modifier dans le panier dans le dos du client » ;
    // elle suppose que le client peut le corriger lui-même. Ici il ne peut pas.
    const { onChangement, utilisateur } = poser(
      [{ productId: 9, quantity: 1 }],
      [
        {
          id: 9,
          label: "Antivol épuisé",
          description: null,
          price: "39.90",
          stock: 0,
        },
      ],
    );

    await utilisateur.click(
      screen.getByRole("button", { name: /retirer.*antivol épuisé/i }),
    );

    expect(onChangement).toHaveBeenCalledWith([]);
  });

  it("dit le catalogue vide au lieu d'afficher une dalle nue", async () => {
    poser([], []);

    expect(
      screen.getByText(/aucun produit n'est proposé/i),
    ).toBeInTheDocument();
  });
});

describe("EtapePanier - accessibilité", () => {
  it("ne présente aucune violation axe, panier vide", async () => {
    const { container } = poser();

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation axe, panier composé", async () => {
    const { container } = poser([
      { productId: 2, quantity: 2 },
      { productId: 1, quantity: 1 },
    ]);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("nomme le produit dans chaque commande de quantité", async () => {
    // Deux boutons « + » côte à côte sans nom distinct sont indiscernables à la
    // navigation clavier comme au lecteur d'écran.
    poser([
      { productId: 2, quantity: 1 },
      { productId: 1, quantity: 1 },
    ]);

    expect(
      screen.getByRole("button", {
        name: /ajouter une unité de antivol en u/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /ajouter une unité de chambre à air/i,
      }),
    ).toBeInTheDocument();
  });
});
