import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { ADRESSE, FORFAITS } from "@/test/tunnel";

import { EtapeAdresse, type RefusAdresse } from "./etape-adresse";

/// Écran **C3**. La colonne de droite portait une carte Google dans la
/// maquette ; [[adr-015-provider-carto|ADR-015 v2]] l'a retirée du parcours
/// client. Ce qui est vérifié ici est ce qui l'a remplacée : l'état de la
/// vérification de couverture, dans ses quatre formes.

const FORFAIT = FORFAITS[2] as (typeof FORFAITS)[number];

function poser(
  options: {
    adresse?: typeof ADRESSE | null;
    refus?: RefusAdresse | null;
    enCours?: boolean;
  } = {},
) {
  const onSelectionner = vi.fn();
  const onModifierForfait = vi.fn();
  const { container } = render(
    <EtapeAdresse
      forfait={FORFAIT}
      adresse={options.adresse ?? null}
      refus={options.refus ?? null}
      enCours={options.enCours ?? false}
      onSelectionner={onSelectionner}
      onReinitialiser={vi.fn()}
      onModifierForfait={onModifierForfait}
      idTitre="titre-c3"
    />,
  );
  return { container, onModifierForfait, onSelectionner };
}

describe("EtapeAdresse - rappel du forfait", () => {
  it("rappelle le forfait retenu, avec sa durée et son prix", () => {
    poser();

    expect(screen.getByText(/Révision complète/)).toHaveTextContent(/60\smin/);
    expect(screen.getByText(/Révision complète/)).toHaveTextContent(/85,00/);
  });

  it("permet de revenir au choix du forfait", async () => {
    const { onModifierForfait } = poser();
    const { default: userEvent } = await import("@testing-library/user-event");

    // `\s+` : `getByRole` ne normalise pas le nom accessible, et JSX laisse un
    // saut de ligne entre « Modifier » et son complément lecture d'écran.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /modifier\s+le forfait/i }));

    expect(onModifierForfait).toHaveBeenCalledTimes(1);
  });
});

describe("EtapeAdresse - états de la vérification", () => {
  it("invite à saisir avant toute recherche, sans faux fond de carte", () => {
    // ADR-015 v2 : aucune cartographie dans le parcours client. Un décor qui
    // imiterait une carte laisserait croire qu'on situe l'adresse.
    poser();

    expect(
      screen.getByText(/la couverture s'affiche ici/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("annonce la vérification en cours", () => {
    // Le champ d'autocomplétion porte déjà une région `status` : on vise le
    // message par son texte, puis on vérifie que c'est bien lui qui est annoncé.
    poser({ enCours: true });

    expect(screen.getByText(/vérification de la couverture/i)).toHaveAttribute(
      "role",
      "status",
    );
  });

  it("confirme la couverture et rappelle l'adresse retenue", () => {
    poser({ adresse: ADRESSE });

    expect(
      screen.getByText(/adresse dans notre zone d'intervention/i),
    ).toBeInTheDocument();
    expect(screen.getByText(ADRESSE.label)).toBeInTheDocument();
  });

  it("refuse net une adresse hors zone, sans repli ni liste d'attente", () => {
    // Constitution §2.2 : hors zone est un refus net. `c3:297-301` proposait un
    // bouton « M'alerter » sur une liste d'extension qui n'existe pas.
    poser({
      refus: {
        message: "Aucun service disponible à cette adresse.",
        horsZone: true,
      },
    });

    const alerte = screen.getByRole("alert");
    expect(alerte).toHaveTextContent(/hors de notre zone d'intervention/i);
    expect(
      screen.getByText(/aucun service disponible à cette adresse/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /m'alerter/i }),
    ).not.toBeInTheDocument();
  });

  it("distingue la panne du refus géographique", () => {
    // `US-ADRESSE-SAISIR` §Cas d'erreur sépare les deux, et les confondre
    // dirait « hors zone » à quelqu'un dont le service est simplement tombé.
    poser({
      refus: {
        message: "Service de géolocalisation temporairement indisponible.",
        horsZone: false,
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /vérification impossible/i,
    );
    expect(screen.queryByText(/hors de notre zone/i)).not.toBeInTheDocument();
  });
});

describe("EtapeAdresse - divergences de portage", () => {
  it("ne rouvre pas la saisie manuelle d'adresse", () => {
    // `c3:190-219` : n°, voie, code postal, ville, complément. Ce serait
    // exactement la saisie libre non contrôlée que Constitution §2.2 ferme.
    poser();

    expect(screen.queryByLabelText(/code postal/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/complément/i)).not.toBeInTheDocument();
  });

  it("ne demande ni téléphone ni instructions sur cet écran", () => {
    // `c3:221-233`. `addresses` ne porte aucune de ces deux colonnes, et le
    // téléphone est demandé une seule fois, au compte (C5).
    poser();

    expect(screen.queryByLabelText(/téléphone/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/instructions/i)).not.toBeInTheDocument();
  });

  it("n'affiche ni technicien nommé ni note", () => {
    // `c3:254-275` : « Marc L., 4.9, 120 avis ». Il n'existe ni avis ni
    // notation en v1, et l'affectation est décidée à la réservation.
    poser({ adresse: ADRESSE });

    expect(screen.queryByText(/avis/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/4[.,]9/)).not.toBeInTheDocument();
  });

  it("dit « technicien » et jamais « mécanicien »", () => {
    poser();

    expect(screen.queryByText(/mécanicien/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nos techniciens/i)).toBeInTheDocument();
  });
});

describe("EtapeAdresse - accessibilité", () => {
  it.each([
    ["état initial", {}],
    ["couverture confirmée", { adresse: ADRESSE }],
    [
      "hors zone",
      { refus: { message: "Aucun service disponible.", horsZone: true } },
    ],
  ])("ne présente aucune violation axe, %s", async (_cas, options) => {
    const { container } = poser(options);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
