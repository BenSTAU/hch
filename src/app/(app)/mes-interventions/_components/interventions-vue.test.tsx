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
import type { ComponentProps, ReactNode } from "react";

vi.mock("@/lib/actions/produits/ajouter-produit", () => ({
  ajouterProduit: vi.fn(),
}));
vi.mock("@/lib/actions/produits/retirer-produit", () => ({
  retirerProduit: vi.fn(),
}));
vi.mock("@/lib/actions/interventions/ajouter-photo", () => ({
  ajouterPhoto: vi.fn(),
}));
vi.mock("@/lib/actions/interventions/annuler-intervention", () => ({
  annulerIntervention: vi.fn(),
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

/// Horloge du rendu, sept jours avant le rendez-vous des fixtures : la fenetre
/// d'annulation H-24 y est donc OUVERTE, et le bloc de T-V3-11 se rend dans son
/// etat nominal. Sa fermeture est eprouvee par `bloc-annulation.test.tsx`, qui
/// en est le proprietaire.
///
/// Fixe et non `new Date()` : le composant en derive le chip « Dans X jours » et
/// l'etat du bouton, une horloge reelle rendrait ce fichier vert aujourd'hui et
/// rouge la semaine prochaine.
const MAINTENANT = new Date("2026-08-01T08:00:00.000Z");

const CONTACT = { telephone: "+33639980000", email: "contact@exemple.fr" };

/// Injecte les deux props que T-V3-11 a ajoutees, sans les redire a chaque
/// appel. Elles sont **requises** a dessein cote composant : `maintenant` doit
/// venir du serveur, un defaut l'aurait laisse se lire au rendu.
function Vue(
  props: Omit<
    ComponentProps<typeof InterventionsVue>,
    "contact" | "maintenant"
  >,
) {
  return (
    <InterventionsVue contact={CONTACT} maintenant={MAINTENANT} {...props} />
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
        <Vue interventions={[]} produits={[]} vide={VIDE} />
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
        <Vue interventions={[intervention()]} produits={[]} vide={VIDE} />
      </Enveloppe>,
    );

    const carte = screen.getByRole("button", { current: true });

    expect(within(carte).getByText("Planifiée")).toBeInTheDocument();
    expect(within(carte).getByText("Marc L.")).toBeInTheDocument();
    expect(within(carte).getByText("Lyon")).toBeInTheDocument();
    expect(within(carte).getByText("85,00 €")).toBeInTheDocument();
  });

  it("porte le chip « Dans X jours » sur une intervention a venir", () => {
    // Divergence de portage C8 attribuee a T-V3-11 (§Ecrans) : « chip "Dans X
    // jours" manquant sur les cards ». Sept jours separent MAINTENANT du
    // rendez-vous des fixtures.
    render(
      <Enveloppe>
        <Vue interventions={[intervention()]} produits={[]} vide={VIDE} />
      </Enveloppe>,
    );

    const carte = screen.getByRole("button", { current: true });
    expect(within(carte).getByText("Dans 7 jours")).toBeInTheDocument();
  });

  it("n'affiche AUCUN chip sur un rendez-vous dont la date est passee", () => {
    // L'onglet « A venir » retient `status = PLANNED` **sans borne de date**
    // (arbitrage du 2026-08-11) : un rendez-vous que le technicien n'a pas
    // cloture y reste, et « Dans -2 jours » ne veut rien dire. La date
    // complete est deja sur la carte.
    render(
      <Enveloppe>
        <Vue
          interventions={[
            intervention({
              appointmentAt: new Date("2026-07-20T08:00:00.000Z"),
            }),
          ]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    const carte = screen.getByRole("button", { current: true });
    expect(within(carte).queryByText(/^Dans /)).toBeNull();
    expect(within(carte).queryByText(/Aujourd|Demain/)).toBeNull();
  });

  it("selectionne la premiere intervention par defaut", () => {
    render(
      <Enveloppe>
        <Vue
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
        <Vue
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
        <Vue interventions={[intervention()]} produits={[]} vide={VIDE} />
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
        <Vue
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
        <Vue interventions={[intervention()]} produits={[]} vide={VIDE} />
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
        <Vue interventions={[intervention()]} produits={[]} vide={VIDE} />
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
        <Vue interventions={[intervention()]} produits={[]} vide={VIDE} />
      </Enveloppe>,
    );

    expect(screen.getByText("Déplacement")).toBeInTheDocument();
    expect(screen.getByText("Inclus")).toBeInTheDocument();
  });

  it("detaille la ligne produits quand il y en a", () => {
    render(
      <Enveloppe>
        <Vue
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
        <Vue
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

  it("ne chiffre AUCUN montant sur une intervention annulee", () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-11. RED au moment de l'ecriture.
    //
    // Deux sources disent la meme chose, et le code fait l'inverse :
    //
    //   · `US-INTERVENTIONS-LISTER-CLIENT-PASSEES` §Cas nominal enumere « ...
    //     montant paye (`payments.amount_snapshot` si `DONE`) **ou** motif
    //     d'annulation (`interventions.cancellation_reason` si `CANCELLED`) ».
    //     Le « ou » est exclusif, il est indexe sur le statut ;
    //   · l'arbitrage (1) de T-V3-10 du 2026-08-11 : « Cette tache affiche le
    //     total calcule sous le libelle "Montant" [...] et **rien sur une
    //     `CANCELLED`** ».
    //
    // Le panneau rend son recapitulatif tarifaire sans condition de statut
    // (`interventions-vue.tsx:276-301`), et la carte de liste son total
    // (`:159-161`). Un rendez-vous annule affiche donc « Montant 85,00 € » en
    // gras, dans la couleur `primary`, juste sous le motif de son annulation -
    // soit un chiffre qui ressemble a une somme due pour une intervention qui
    // n'a pas eu lieu.
    //
    // Ce test porte sur le PANNEAU, la surface que l'arbitrage nomme. Le meme
    // ecart existe sur la carte, il est rapporte sans etre teste ici : c'est la
    // meme decision, pas deux.
    render(
      <Enveloppe>
        <Vue
          interventions={[
            intervention({
              status: "CANCELLED",
              cancellationReason: "Client absent",
              total: "85.00",
            }),
          ]}
          produits={[]}
          vide={VIDE}
        />
      </Enveloppe>,
    );

    // Le panneau est nomme par son titre, la date du rendez-vous : les blocs
    // produits et photos sont eux aussi des `region`.
    const panneau = within(screen.getByRole("region", { name: /\d{4}/ }));

    expect(panneau.getByText(/Client absent/)).toBeInTheDocument();
    expect(panneau.queryByText("Montant")).toBeNull();
    expect(panneau.queryByText("85,00 €")).toBeNull();
  });

  it("ne porte AUCUNE reference ni recapitulatif inventes", () => {
    // ⚠️ **Regle du test rouge, cas 3** - oracle reecrit par T-V3-11.
    //
    // Ce test s'appelait « ne porte NI bouton d'annulation NI reference
    // inventee » et assertait `queryByText(/Annuler cette intervention/i)`
    // nul. Cette moitie-la datait le fichier plutot qu'elle ne decrivait une
    // propriete : elle disait « T-V3-11 n'a pas encore livre », ce qui devient
    // faux le jour ou elle livre - et l'arbitrage C8 du 2026-08-10 l'annonçait
    // (« cette tache monte son propre bouton dans la coquille livree »).
    //
    // Ce qui reste EST une propriete, et ne bouge pas : « Ref: INT-2026-0847 »
    // n'existe nulle part au modele (`interventions.id` est un SERIAL), et
    // « Voir le recapitulatif complet » est renvoye en v2 par la note SPEC de
    // `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`.
    render(
      <Enveloppe>
        <Vue interventions={[intervention()]} produits={[]} vide={VIDE} />
      </Enveloppe>,
    );

    expect(screen.queryByText(/INT-20/)).toBeNull();
    expect(screen.queryByText(/recapitulatif complet/i)).toBeNull();
  });
});

describe("InterventionsVue - le statut gouverne les actions", () => {
  it("propose d'ajouter un produit et une photo sur une intervention planifiee", () => {
    render(
      <Enveloppe>
        <Vue interventions={[intervention()]} produits={PRODUITS} vide={VIDE} />
      </Enveloppe>,
    );

    expect(
      screen.getByRole("button", { name: /Ajouter un produit/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ajouter une photo pour le technicien/),
    ).toBeInTheDocument();
  });

  it("monte le bloc d'annulation sur une planifiee dans la fenetre", () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-11.
    //
    // La DoD 6 de T-V3-11 dit « le bloc annulation est **monte** dans la
    // coquille de C8 ». Apres la reecriture de l'oracle « ne porte NI bouton
    // d'annulation NI reference inventee », plus AUCUN test unitaire ne le
    // disait : le fichier proprietaire du bloc le monte seul, hors de la vue,
    // et seuls les E2E traversaient les deux. Une prop `contact` ou
    // `maintenant` oubliee au montage passait donc la barriere unitaire.
    render(
      <Enveloppe>
        <Vue interventions={[intervention()]} produits={PRODUITS} vide={VIDE} />
      </Enveloppe>,
    );

    expect(
      screen.getByRole("button", { name: /Annuler cette intervention/ }),
    ).toBeInTheDocument();
  });

  it("ne propose NI bouton NI bandeau d'annulation hors du statut PLANNED", () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-11.
    //
    // `US-INTERVENTION-ANNULER-CLIENT` §Cas d'erreur : « le bouton "Annuler"
    // n'est pas affiche sur la liste » des que le statut n'est plus `PLANNED`.
    // Le test voisin ne couvrait que les produits et les photos, et la moitie
    // « bouton d'annulation » de l'oracle reecrit portait cette propriete par
    // accident - elle a disparu avec lui.
    //
    // Le bandeau de contact ne doit pas s'y substituer non plus : sur une
    // terminee ou une annulee il n'y a rien a annuler, donc rien a renvoyer
    // vers l'atelier.
    for (const status of ["IN_PROGRESS", "DONE", "CANCELLED"]) {
      const { unmount } = render(
        <Enveloppe>
          <Vue
            interventions={[intervention({ status })]}
            produits={PRODUITS}
            vide={VIDE}
          />
        </Enveloppe>,
      );

      expect(
        screen.queryByRole("button", { name: /Annuler cette intervention/ }),
        status,
      ).toBeNull();
      expect(
        screen.queryByText(/Annulation impossible en ligne/),
        status,
      ).toBeNull();

      unmount();
    }
  });

  it("retire les deux blocs de mutation des que l'intervention est demarree", () => {
    for (const status of ["IN_PROGRESS", "DONE", "CANCELLED"]) {
      const { unmount } = render(
        <Enveloppe>
          <Vue
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
        <Vue
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
        <Vue interventions={[]} produits={[]} vide={VIDE} />
      </Enveloppe>,
    );

    await expect(axe(vue.container)).resolves.toHaveNoViolations();
  });
});
