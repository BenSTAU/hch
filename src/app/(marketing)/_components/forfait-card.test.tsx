// Une carte du catalogue public.
//
// Elle porte les trois données que Constitution §5.1 rend obligatoires — nom,
// durée, prix — et une quatrième contrainte qui ne se voit pas : les trois
// cartes pointent la MÊME URL tant que T-V3-08 n'a pas livré l'état
// pré-sélectionné. Sans complément lu par les lecteurs d'écran, la grille
// offrirait trois liens de nom accessible identique dans un contexte de
// comparaison.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ForfaitCard } from "./forfait-card";

const REVISION = {
  id: 1,
  label: "Révision complète",
  description: "Réglage des patins et disques, indexation des dérailleurs.",
  duration: 60,
  price: "85.00",
};

describe("ForfaitCard", () => {
  it("affiche le nom du forfait comme titre", () => {
    render(<ForfaitCard forfait={REVISION} />);

    expect(
      screen.getByRole("heading", { name: "Révision complète" }),
    ).toBeInTheDocument();
  });

  it("affiche le prix en euros, mention TTC comprise", () => {
    // Constitution §5.1 : « les tarifs sont publics, complets ». Sans la mention
    // TTC, « complet » n'est pas démontré — le visiteur ne sait pas si une taxe
    // s'ajoute au moment de payer.
    render(<ForfaitCard forfait={REVISION} />);

    expect(screen.getByText(/85,00\s€/u)).toBeInTheDocument();
    expect(screen.getByText("TTC")).toBeInTheDocument();
  });

  it("affiche la durée en minutes", () => {
    // Même unité que le moteur de créneaux, qui dérive la grille de la durée du
    // forfait (Constitution §2.1). Deux unités pour la même donnée feraient dire
    // au client autre chose qu'au planning.
    render(<ForfaitCard forfait={REVISION} />);

    expect(screen.getByText(/60\smin/u)).toBeInTheDocument();
  });

  it("affiche la description issue du catalogue", () => {
    render(<ForfaitCard forfait={REVISION} />);

    expect(
      screen.getByText(/Réglage des patins et disques/),
    ).toBeInTheDocument();
  });

  it("se passe d'une description absente", () => {
    // `services.description` est NULLable : c'est le prix qui conditionne
    // l'affichage d'un forfait, pas son texte.
    render(<ForfaitCard forfait={{ ...REVISION, description: null }} />);

    expect(
      screen.getByRole("heading", { name: "Révision complète" }),
    ).toBeInTheDocument();
  });

  it("n'invente aucune puce de prestation", () => {
    // C1 `code.html:317-330` liste « Diagnostic 30 points », « 2 Pneus renforcés
    // inclus », « Recyclage anciens pneus ». Aucune source. Une puce inventée
    // sur une page de tarifs est un engagement commercial que personne n'a pris.
    render(<ForfaitCard forfait={REVISION} />);

    expect(screen.queryByText(/points de contrôle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/inclus/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("mène à l'entrée du tunnel, sans état pré-rempli", () => {
    // DoD T-V3-13 : « si T-V3-13 passe avant, poser le lien vers l'entrée du
    // tunnel et non un état pré-rempli ». Donc pas de `?forfait=1`.
    render(<ForfaitCard forfait={REVISION} />);

    const lien = screen.getByRole("link", { name: /Réserver/ });

    expect(lien).toHaveAttribute("href", "/reserver");
  });

  it("distingue son lien de ceux des autres forfaits", () => {
    // Le nom accessible porte le libellé du forfait en plus du verbe. Oracle en
    // expression régulière et non en chaîne : le séparateur est un tiret
    // cadratin, invisible à la relecture et facile à retaper de travers — un
    // test qui échoue là-dessus fait douter du composant, pas de lui-même.
    render(<ForfaitCard forfait={REVISION} />);

    expect(screen.getByRole("link", { name: /Réserver/ })).toHaveAccessibleName(
      /Révision complète/,
    );
  });
});
