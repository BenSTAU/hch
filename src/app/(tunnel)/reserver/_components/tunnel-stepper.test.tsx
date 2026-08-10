import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";

import { TunnelStepper } from "./tunnel-stepper";

/// Barre d'étapes du tunnel - la seule indication de progression des quatre
/// écrans. Ce qui est vérifié ici est ce qu'un lecteur d'écran entend : le rang
/// courant, les pas franchis, et le fait qu'on ne puisse pas sauter d'étape.

describe("TunnelStepper", () => {
  it("marque l'étape courante et elle seule", () => {
    render(<TunnelStepper courante="creneau" />);

    const items = screen.getAllByRole("listitem");
    const courants = items.filter(
      (item) => item.getAttribute("aria-current") === "step",
    );

    expect(courants).toHaveLength(1);
    expect(courants[0]).toHaveTextContent("Créneau");
  });

  it("annonce les étapes franchies, sans les rendre cliquables", () => {
    // La maquette C5 pose des `<a href="#">` sur les pas franchis
    // (`c5:128-152`). Revenir en arrière passe par « Retour », qui repose la
    // question de la validité de l'état : sauter au pas 3 depuis le pas 1
    // afficherait une grille de créneaux sans adresse.
    render(<TunnelStepper courante="creneau" />);

    const nav = screen.getByRole("navigation", {
      name: /progression de la réservation/i,
    });
    const items = within(nav).getAllByRole("listitem");

    expect(items[0]).toHaveTextContent(/terminée/i);
    expect(items[1]).toHaveTextContent(/terminée/i);
    expect(items[2]).not.toHaveTextContent(/terminée/i);
    expect(within(nav).queryAllByRole("link")).toHaveLength(0);
  });

  it("porte le rang de chaque étape franchie, que l'icône ne dit pas", () => {
    // L'icône de validation est décorative : sans le complément lecture
    // d'écran, un pas franchi perdrait son numéro.
    render(<TunnelStepper courante="recapitulatif" />);

    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Étape 1");
  });

  it("offre une sortie nommée", () => {
    render(<TunnelStepper courante="forfait" />);

    expect(
      screen.getByRole("link", { name: /quitter la réservation/i }),
    ).toHaveAttribute("href", "/");
  });

  it("ne présente aucune violation axe", async () => {
    const { container } = render(<TunnelStepper courante="adresse" />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
