// Liste et panneau de detail de l'espace client - ecrans C8 et C10.
//
// Ce que ce fichier verifie tient en trois propositions, et aucune n'est
// cosmetique :
//
//   · **le statut gouverne les actions, pas la route.** Le meme composant sert
//     les deux onglets ; un panneau qui proposerait d'ajouter un produit sur une
//     intervention cloturee offrirait un geste que l'action refuse ;
//   · **un identifiant inconnu ne produit aucune erreur.** `interventions.id`
//     est un SERIAL, et un message « introuvable » distinct du cas nominal
//     confirmerait l'existence du rendez-vous d'un tiers ;
//   · **le montant s'appelle « Montant », pas « Montant paye ».** La table
//     `payments` n'existe pas encore (T-V2-03), et nommer « paye » un total
//     calcule affirmerait un encaissement qu'aucune donnee ne porte.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { axe } from "jest-axe";
import type { ReactNode } from "react";

vi.mock("@/lib/actions/produits/ajouter-produit", () => ({
  ajouterProduit: vi.fn(),
}));
vi.mock("@/lib/actions/produits/retirer-produit", () => ({
  retirerProduit: vi.fn(),
}));
vi.mock("@/lib/actions/interventions/ajouter-photo", () => ({
  ajouterPhoto: vi.fn(),
}));

const { InterventionsVue } = await import("./interventions-vue");

const VIDE = {
  message: "Vous n'avez pas de rendez-vous prevu.",
  href: "/reserver",
  libelle: "Reserver un creneau",
};

/// `hasMemory` : sans lui l'adaptateur GELE les parametres sur leur valeur
/// initiale, et une selection changee revient a la precedente (leçon T-V3-08).
function Enveloppe({
  children,
  searchParams = "",
}: {
  children: ReactNode;
  searchParams?: string;
}) {
  return (
    <NuqsTestingAdapter searchParams={searchParams} hasMemory>
      {children}
    </NuqsTestingAdapter>
  );
}

function intervention(surcharge: Record<string, unknown> = {}) {
  return {
    id: 847,
    status: "PLANNED",
    appointmentAt: new Date("2026-08-08T08:00:00.000Z"),
    durationSnapshot: 60,
    priceSnapshot: "85.00",
    cancellationReason: null,
    forfait: "Revision complete",
    adresse: {
      label: "Domicile",
      street: "12 rue de la Republique",
      zipCode: "69002",
      city: "Lyon",
    },
    technicien: "Marc L.",
    produits: [],
    total: "85.00",
    photos: [],
    ...surcharge,
  };
}

const PRODUITS = [
  {
    id: 2,
    label: "Antivol en U",
    description: null,
    price: "39.90",
    stock: 15,
  },
];

describe("InterventionsVue - liste vide", () => {
  it("propose de reserver plutot que de laisser un ecran nu", () => {
    // Les deux US exigent le message ET son appel a l'action : « Vous n'avez
    // pas de rendez-vous prevu → Reserver un creneau ».
    render(
      <Enveloppe>
        <InterventionsVue interventions={[]} produits={[]} vide={VIDE} />
      </Enveloppe>,
    );

    expect(screen.getByText(VIDE.message)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: VIDE.libelle })).toHaveAttribute(
      "href",
      "/reserver",
    );
  });
});

describe("InterventionsVue - liste", () => {
  it("porte statut, date, technicien, commune et montant sur chaque carte", () => {
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[intervention()]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    const carte = screen.getByRole("button", { current: true });

    expect(within(carte).getByText("Planifiée")).toBeInTheDocument();
    expect(within(carte).getByText("Marc L.")).toBeInTheDocument();
    expect(within(carte).getByText("Lyon")).toBeInTheDocument();
    expect(within(carte).getByText("85,00 €")).toBeInTheDocument();
  });

  it("selectionne la premiere intervention par defaut", () => {
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[intervention(), intervention({ id: 848 })]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    // `aria-current` porte la selection : deux cartes ne peuvent pas etre
    // courantes a la fois.
    expect(screen.getAllByRole("button", { current: true })).toHaveLength(1);
  });

  it("ouvre l'intervention nommee dans l'URL", () => {
    render(
      <Enveloppe searchParams="?intervention=848">
        <InterventionsVue
          interventions={[
            intervention(),
            intervention({ id: 848, forfait: "Diagnostic express" }),
          ]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(screen.getByText("Diagnostic express")).toBeInTheDocument();
  });

  it("retombe sur la premiere sans rien dire quand l'identifiant est inconnu", async () => {
    // C'est la propriete, pas un effet de bord : un « intervention
    // introuvable » distinct du cas nominal confirmerait l'existence du
    // rendez-vous d'un tiers a qui incremente un SERIAL.
    render(
      <Enveloppe searchParams="?intervention=999999">
        <InterventionsVue
          interventions={[intervention()]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(screen.getByText("Revision complete")).toBeInTheDocument();
    expect(screen.queryByText(/introuvable/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("change de panneau au clic sur une autre carte", async () => {
    const utilisateur = userEvent.setup();
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[
            intervention(),
            intervention({ id: 848, forfait: "Diagnostic express" }),
          ]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    const cartes = screen.getAllByRole("button", { name: /Marc L\./ });
    await utilisateur.click(cartes[1]!);

    expect(screen.getByText("Diagnostic express")).toBeInTheDocument();
  });
});

describe("InterventionsVue - panneau de detail", () => {
  it("rend l'adresse, le technicien, le forfait et la duree", () => {
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[intervention()]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(screen.getByText(/12 rue de la Republique/)).toBeInTheDocument();
    expect(screen.getByText(/69002 Lyon/)).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
  });

  it("nomme le total « Montant », jamais « Montant paye »", () => {
    // ⚠️ `payments` n'existe pas : la table arrive avec T-V2-03 « Cloture et
    // paiement terrain » (migration 009). Ce total est celui de
    // l'intervention, pas un encaissement constate.
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[intervention()]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(screen.getByText("Montant")).toBeInTheDocument();
    expect(screen.queryByText(/Montant pay/i)).not.toBeInTheDocument();
  });

  it("affiche le deplacement comme inclus", () => {
    // Constitution §1.1 : le technicien se deplace, et le deplacement n'est pas
    // facture a part.
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[intervention()]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(screen.getByText("Déplacement")).toBeInTheDocument();
    expect(screen.getByText("Inclus")).toBeInTheDocument();
  });

  it("detaille la ligne produits quand il y en a", () => {
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[
            intervention({
              produits: [
                {
                  productId: 2,
                  label: "Pack usure standard",
                  quantity: 1,
                  unitPriceSnapshot: "22.00",
                },
              ],
              total: "107.00",
            }),
          ]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(screen.getByText("Pack usure standard x 1")).toBeInTheDocument();
    expect(screen.getAllByText("107,00 €").length).toBeGreaterThan(0);
  });

  it("rend le motif d'annulation d'une intervention annulee", () => {
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[
            intervention({
              status: "CANCELLED",
              cancellationReason: "Client absent",
            }),
          ]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(screen.getByText(/Client absent/)).toBeInTheDocument();
  });

  it("ne porte NI bouton d'annulation NI reference inventee", () => {
    // Le bloc d'annulation appartient a T-V3-11, qui le montera ici. Aucun
    // emplacement reserve : une place gardee pour une tache future est un
    // mort-vivant si la tache glisse.
    // « Ref: INT-2026-0847 » n'existe nulle part au modele, `interventions.id`
    // est un SERIAL.
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[intervention()]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(screen.queryByText(/Annuler cette intervention/i)).toBeNull();
    expect(screen.queryByText(/INT-20/)).toBeNull();
    expect(screen.queryByText(/recapitulatif complet/i)).toBeNull();
  });
});

describe("InterventionsVue - le statut gouverne les actions", () => {
  it("propose d'ajouter un produit et une photo sur une intervention planifiee", () => {
    render(
      <Enveloppe>
        <InterventionsVue
          interventions={[intervention()]}
          produits={PRODUITS}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    expect(
      screen.getByRole("button", { name: /Ajouter un produit/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ajouter une photo pour le technicien/),
    ).toBeInTheDocument();
  });

  it("retire les deux blocs de mutation des que l'intervention est demarree", () => {
    for (const status of ["IN_PROGRESS", "DONE", "CANCELLED"]) {
      const { unmount } = render(
        <Enveloppe>
          <InterventionsVue
            interventions={[intervention({ status })]}
            produits={PRODUITS}
            vide={VIDE}
          />
        </Enveloppe>,
      );

      expect(
        screen.queryByRole("button", { name: /Ajouter un produit/ }),
      ).toBeNull();
      expect(
        screen.queryByText(/Ajouter une photo pour le technicien/),
      ).toBeNull();

      unmount();
    }
  });
});

describe("InterventionsVue - accessibilite", () => {
  it("ne presente aucune violation, avec ou sans produits", async () => {
    const vue = render(
      <Enveloppe>
        <InterventionsVue
          interventions={[
            intervention({
              produits: [
                {
                  productId: 2,
                  label: "Pack usure standard",
                  quantity: 1,
                  unitPriceSnapshot: "22.00",
                },
              ],
              photos: [{ id: 7 }],
              total: "107.00",
            }),
          ]}
          produits={PRODUITS}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });

  it("ne presente aucune violation sur la liste vide", async () => {
    const vue = render(
      <Enveloppe>
        <InterventionsVue interventions={[]} produits={[]} vide={VIDE} />
      </Enveloppe>,
    );

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });
});
