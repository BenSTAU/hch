// Étiquette de type de vélo - une variante shadcn par valeur d'ENUM (DoD L4).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { BadgeTypeCycle, LIBELLES_TYPE_CYCLE } from "./badge-type-cycle";

describe("BadgeTypeCycle", () => {
  it("traduit les trois valeurs de l'ENUM", () => {
    render(
      <>
        <BadgeTypeCycle type="CLASSIC" />
        <BadgeTypeCycle type="ELECTRIC" />
        <BadgeTypeCycle type="CARGO" />
      </>,
    );

    expect(screen.getByText("Classique")).toBeInTheDocument();
    expect(screen.getByText("Électrique")).toBeInTheDocument();
    expect(screen.getByText("Cargo")).toBeInTheDocument();
  });

  it("donne une variante DISTINCTE à chacune", () => {
    // Trois valeurs peintes pareil rendraient le badge décoratif : il ne
    // dirait plus rien que le texte ne dise déjà.
    const { container } = render(
      <>
        <BadgeTypeCycle type="CLASSIC" />
        <BadgeTypeCycle type="ELECTRIC" />
        <BadgeTypeCycle type="CARGO" />
      </>,
    );

    const classes = [...container.querySelectorAll("span[data-slot]")]
      .filter((noeud) => noeud.getAttribute("data-slot") === "badge")
      .map((noeud) => noeud.className);

    expect(new Set(classes).size).toBe(3);
  });

  it("affiche une valeur inconnue telle quelle plutôt que de la masquer", () => {
    // Le symptôme d'une divergence entre le CHECK SQL et cette table. La
    // masquer la rendrait invisible jusqu'au support.
    render(<BadgeTypeCycle type="BMX" />);

    expect(screen.getByText("BMX")).toBeInTheDocument();
  });

  it("couvre exactement les trois valeurs du CHECK SQL", () => {
    expect(Object.keys(LIBELLES_TYPE_CYCLE)).toEqual([
      "CLASSIC",
      "ELECTRIC",
      "CARGO",
    ]);
  });
});
