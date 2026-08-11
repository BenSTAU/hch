// Montage T+n du bloc produits - DoD **reçue de T-V3-09** par l'arbitrage du
// 2026-08-10.
//
// La logique, le verrou de stock et les deux Server Actions appartiennent a
// T-V3-09, qui les a livrees et testees en [PR #32]. Ce fichier ne les rejoue
// pas : il verifie ce que le montage ajoute, et rien d'autre.
//
//   · **ce que l'ecran ENVOIE** - un identifiant et une quantite, jamais un
//     prix. Un prix qui remonterait de l'ecran serait un prix choisi par
//     l'acheteur (Constitution §4.1) ;
//   · **ce que l'ecran AFFICHE d'un refus** - le stock se verifie sous verrou
//     au moment d'ecrire, et « Stock insuffisant, quantite maximale : 2 » est un
//     cas nominal, pas une panne ;
//   · **le prix rendu est celui FIGE a la vente**, pas celui du catalogue.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const ajouterProduit = vi.fn();
vi.mock("@/lib/actions/produits/ajouter-produit", () => ({
  ajouterProduit: (args: unknown) => ajouterProduit(args),
}));

const retirerProduit = vi.fn();
vi.mock("@/lib/actions/produits/retirer-produit", () => ({
  retirerProduit: (args: unknown) => retirerProduit(args),
}));

const { BlocProduits } = await import("./bloc-produits");

const CATALOGUE = [
  {
    id: 2,
    label: "Antivol en U",
    description: null,
    price: "39.90",
    stock: 15,
  },
  {
    id: 1,
    label: "Chambre a air 700x35",
    description: null,
    price: "12.90",
    stock: 0,
  },
];

const LIGNE = {
  productId: 3,
  label: "Pack usure standard",
  quantity: 2,
  unitPriceSnapshot: "22.00",
};

beforeEach(() => {
  vi.clearAllMocks();
  ajouterProduit.mockResolvedValue({ data: { ok: true, total: "107.00" } });
  retirerProduit.mockResolvedValue({ data: { ok: true, total: "85.00" } });
});

describe("BlocProduits - lignes attachees", () => {
  it("rend le libelle, la quantite et le prix FIGE a la vente", () => {
    // 22,00 × 2 = 44,00. Le prix du catalogue n'entre pas dans ce calcul : un
    // changement de tarif n'altere jamais une ligne deja vendue.
    render(
      <BlocProduits
        interventionId={42}
        lignes={[LIGNE]}
        catalogue={CATALOGUE}
        modifiable
      />,
    );

    expect(screen.getByText("Pack usure standard x 2")).toBeInTheDocument();
    expect(screen.getByText("44,00 €")).toBeInTheDocument();
  });

  it("le dit quand rien n'est attache", () => {
    render(
      <BlocProduits
        interventionId={42}
        lignes={[]}
        catalogue={CATALOGUE}
        modifiable
      />,
    );

    expect(
      screen.getByText(/Aucun produit attaché à cette intervention/),
    ).toBeInTheDocument();
  });
});

describe("BlocProduits - retrait", () => {
  it("retire la ligne ENTIERE, sans quantite", async () => {
    // `US-INTERVENTION-PRODUIT-SUPPRIMER` decrit un bouton « Retirer » sur la
    // ligne, pas un decrement unite par unite : le selecteur en pilule du
    // tunnel n'a pas d'equivalent ici, ce sont deux gestes differents.
    const utilisateur = userEvent.setup();
    render(
      <BlocProduits
        interventionId={42}
        lignes={[LIGNE]}
        catalogue={CATALOGUE}
        modifiable
      />,
    );

    await utilisateur.click(
      screen.getByRole("button", { name: /Retirer Pack usure standard/ }),
    );

    expect(retirerProduit).toHaveBeenCalledWith({
      interventionId: 42,
      productId: 3,
    });
  });

  it("n'offre aucun retrait sur une intervention verrouillee", async () => {
    render(
      <BlocProduits
        interventionId={42}
        lignes={[LIGNE]}
        catalogue={CATALOGUE}
        modifiable={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /Retirer/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Ajouter un produit/ }),
    ).toBeNull();
  });
});

describe("BlocProduits - ajout", () => {
  it("n'envoie qu'un identifiant et une quantite, jamais un prix", async () => {
    const utilisateur = userEvent.setup();
    render(
      <BlocProduits
        interventionId={42}
        lignes={[]}
        catalogue={CATALOGUE}
        modifiable
      />,
    );

    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter un produit/ }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter Antivol en U/ }),
    );

    expect(ajouterProduit).toHaveBeenCalledWith({
      interventionId: 42,
      productId: 2,
      quantity: 1,
    });
    expect(JSON.stringify(ajouterProduit.mock.calls[0])).not.toContain("39.90");
  });

  it("ne propose pas un produit en rupture", async () => {
    // Le stock affiche est celui du moment et peut partir avant l'ecriture :
    // proposer une ligne a zero produirait un refus que le client n'a aucun
    // moyen d'anticiper.
    const utilisateur = userEvent.setup();
    render(
      <BlocProduits
        interventionId={42}
        lignes={[]}
        catalogue={CATALOGUE}
        modifiable
      />,
    );

    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter un produit/ }),
    );

    expect(
      screen.getByRole("button", { name: "Ajouter Antivol en U" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chambre a air/ })).toBeNull();
  });

  it("propose encore un produit DEJA attache", async () => {
    // `quantity` est un DELTA : un client qui a deja deux unites peut en
    // vouloir une troisieme, et c'est l'`upsert` cote base qui incremente.
    const utilisateur = userEvent.setup();
    render(
      <BlocProduits
        interventionId={42}
        lignes={[{ ...LIGNE, productId: 2, label: "Antivol en U" }]}
        catalogue={CATALOGUE}
        modifiable
      />,
    );

    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter un produit/ }),
    );

    expect(
      screen.getByRole("button", { name: /Ajouter Antivol en U/ }),
    ).toBeInTheDocument();
  });

  it("le dit quand le catalogue n'a rien de vendable", async () => {
    const utilisateur = userEvent.setup();
    render(
      <BlocProduits
        interventionId={42}
        lignes={[]}
        catalogue={[CATALOGUE[1]!]}
        modifiable
      />,
    );

    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter un produit/ }),
    );

    expect(screen.getByText(/Aucun produit disponible/)).toBeInTheDocument();
  });
});

describe("BlocProduits - refus", () => {
  it("montre le refus de stock tel que l'action le formule", async () => {
    // Le message vient du serveur, pas de l'ecran : `messages.ts` est partage
    // par les trois surfaces qui vendent, et un meme refus lu differemment
    // selon l'ecran ferait croire a deux causes.
    ajouterProduit.mockResolvedValue({
      data: { ok: false, message: "Stock insuffisant, quantité maximale : 2." },
    });

    const utilisateur = userEvent.setup();
    render(
      <BlocProduits
        interventionId={42}
        lignes={[]}
        catalogue={CATALOGUE}
        modifiable
      />,
    );

    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter un produit/ }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter Antivol en U/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stock insuffisant, quantité maximale : 2.",
    );
  });

  it("efface le refus precedent a la tentative suivante", async () => {
    // Un message qui survit a la correction laisse croire que le second geste
    // a echoue lui aussi.
    ajouterProduit.mockResolvedValueOnce({
      data: { ok: false, message: "Stock insuffisant, quantité maximale : 2." },
    });

    const utilisateur = userEvent.setup();
    render(
      <BlocProduits
        interventionId={42}
        lignes={[]}
        catalogue={CATALOGUE}
        modifiable
      />,
    );

    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter un produit/ }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter Antivol en U/ }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await utilisateur.click(
      screen.getByRole("button", { name: /Ajouter Antivol en U/ }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
