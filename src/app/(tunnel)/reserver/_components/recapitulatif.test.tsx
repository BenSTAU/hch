import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { ADRESSE, FORFAITS } from "@/test/tunnel";

vi.mock("@/lib/actions/auth/signup", () => ({
  signupFormAction: vi.fn(),
}));

const { Recapitulatif } = await import("./recapitulatif");

/// Écran **C5**. C'est l'écran qui décide : il porte la validation, et la
/// bascule vers l'inscription quand le visiteur n'a pas de compte
/// (Constitution §3.2, renversée le 2026-08-09 - le compte activé PRÉCÈDE la
/// validation).

const FORFAIT = FORFAITS[2] as (typeof FORFAITS)[number];

/// Heure locale : un littéral en `Z` afficherait une autre date selon le fuseau
/// du runner.
const CRENEAU = new Date(2027, 4, 10, 9, 0).toISOString();

function poser(estConnecte: boolean, enCours = false) {
  const onValider = vi.fn();
  const { container } = render(
    <Recapitulatif
      forfait={FORFAIT}
      adresse={ADRESSE}
      creneau={CRENEAU}
      photos={[]}
      onChangementPhotos={vi.fn()}
      estConnecte={estConnecte}
      enCours={enCours}
      onValider={onValider}
      retour="/reserver?etape=recapitulatif"
      idTitre="titre-c5"
    />,
  );
  return { container, onValider, utilisateur: userEvent.setup() };
}

describe("Recapitulatif - ce que le visiteur relit", () => {
  it("rappelle la prestation, le créneau et le lieu", () => {
    poser(true);

    // Deux fois : dans le détail du rendez-vous et dans la ligne de prix.
    expect(screen.getAllByText(/Révision complète/)).toHaveLength(2);
    expect(screen.getByText(/lundi 10 mai 2027/i)).toBeInTheDocument();
    expect(screen.getByText(ADRESSE.label)).toBeInTheDocument();
  });

  it("détaille le prix et annonce le déplacement compris", () => {
    poser(true);

    expect(screen.getAllByText(/85,00/).length).toBeGreaterThan(0);
    expect(screen.getByText("Inclus")).toBeInTheDocument();
  });

  it("nomme un total, jamais une estimation", () => {
    // « Total estimé » dans la maquette (`c5:334`). Le prix est FIGÉ à la
    // réservation (Constitution §4.1) : il n'est pas estimé.
    poser(true);

    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.queryByText(/estimé/i)).toBeNull();
  });
});

describe("Recapitulatif - la validation exige un compte", () => {
  it("propose de valider quand la session existe", async () => {
    const { onValider, utilisateur } = poser(true);

    await utilisateur.click(
      screen.getByRole("button", { name: /valider ma réservation/i }),
    );

    expect(onValider).toHaveBeenCalledTimes(1);
  });

  it("ne propose pas de valider sans session", () => {
    // Ce n'est pas la protection - elle vit dans la Server Action - mais un
    // écran qui ne promet pas ce qu'il ne peut pas tenir.
    poser(false);

    expect(
      screen.queryByRole("button", { name: /valider ma réservation/i }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /créer mon compte/i }),
    ).toBeInTheDocument();
  });

  it("offre la seconde branche, pour un client déjà inscrit", () => {
    // `users.email` est unique : un client déjà inscrit qui ne verrait que
    // « créer un compte » serait bloqué sans recours.
    poser(false);

    expect(
      screen.getByRole("link", { name: /j'ai déjà un compte/i }),
    ).toHaveAttribute(
      "href",
      "/connexion?next=%2Freserver%3Fetape%3Drecapitulatif",
    );
  });

  it("n'offre le dépôt de photos qu'une fois connecté", () => {
    // Le dépôt exige une session : proposer un champ qui refuserait le fichier
    // serait une promesse qu'on ne tient pas.
    poser(false);
    expect(screen.queryByText(/photos préparatoires/i)).toBeNull();

    poser(true);
    expect(screen.getByText(/photos préparatoires/i)).toBeInTheDocument();
  });

  it("désarme le bouton pendant la validation", () => {
    poser(true, true);

    expect(screen.getByRole("button", { name: /validation/i })).toBeDisabled();
  });
});

describe("Recapitulatif - divergences de portage", () => {
  it("ne fait pas confier le vélo à un atelier", () => {
    // `c5:164` : « Dernière étape avant de confier votre vélo à nos experts ».
    // Le client ne confie rien, le technicien se déplace (Constitution §1.1).
    poser(true);

    expect(screen.queryByText(/confier votre vélo/i)).toBeNull();
    expect(screen.getByText(/à votre adresse/i)).toBeInTheDocument();
  });

  it("ne renvoie pas la création de compte après la réservation", () => {
    // `c5:263` : « Vous pourrez créer un compte à l'issue de la réservation ».
    // Le renversement de Constitution §3.2 inverse la phrase.
    poser(false);

    expect(screen.queryByText(/à l'issue de la réservation/i)).toBeNull();
  });

  it("ne porte pas de case CGV", () => {
    // `c5:340-348` : page hors périmètre v1, remplacée par la mention RGPD,
    // même traitement que C6.
    poser(false);

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/conditions générales/i)).toBeNull();
  });

  it("n'énumère pas des moyens de paiement que rien ne fixe", () => {
    // `c5:363-364` : « Espèces, chèque, CB (terminal mobile) ». Il n'existe ni
    // table `payments` ni ligne de SPEC qui les fixe en v1.
    poser(true);

    expect(screen.queryByText(/espèces/i)).toBeNull();
    expect(screen.queryByText(/chèque/i)).toBeNull();
    expect(screen.getByText(/paiement sur place/i)).toBeInTheDocument();
  });

  it("ne nomme aucun technicien avant la réservation", () => {
    // `c5:301-310` pose une ligne « Technicien : Marc L. » avec ses initiales.
    // L'affectation est décidée par la réservation, pas montrée avant. Le mot
    // subsiste ailleurs - le bloc photos explique à quoi elles servent - d'où
    // l'ancrage sur l'intitulé exact de la ligne du récapitulatif.
    poser(true);

    expect(screen.queryByText(/^technicien$/i)).toBeNull();
    expect(screen.queryByText(/marc l/i)).toBeNull();
  });

  it("ne montre aucun bloc produits", () => {
    // `c5:170-244` appartient à T-V3-09. Un bloc « bientôt disponible » sur un
    // écran de validation est une promesse, pas une maquette.
    poser(true);

    expect(screen.queryByText(/produits additionnels/i)).toBeNull();
  });
});

describe("Recapitulatif - accessibilité", () => {
  it("ne présente aucune violation axe, visiteur connecté", async () => {
    const { container } = poser(true);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation axe, visiteur anonyme", async () => {
    const { container } = poser(false);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
