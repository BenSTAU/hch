import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { CYCLES } from "@/test/tunnel";

const { EtapeCycle } = await import("./etape-cycle");

/// Bloc « Vélo concerné » de l'écran **C5**, ajouté le 2026-08-16.
///
/// Ce fichier tient deux propriétés que le cadrage a explicitement tranchées,
/// et qu'un ajout de confort ferait sauter sans bruit :
///
///   · l'état vide **ne fait pas sortir du tunnel** ;
///   · le choix reste **facultatif** - « Aucun vélo » est toujours offert.

function poser(
  cycles: typeof CYCLES | [] = CYCLES,
  cycleId: number | null = null,
) {
  const onChangement = vi.fn();
  const { container } = render(
    <EtapeCycle
      cycles={cycles}
      cycleId={cycleId}
      onChangement={onChangement}
    />,
  );
  return { container, onChangement };
}

describe("EtapeCycle - le visiteur qui a des vélos", () => {
  it("propose ses vélos et l'option « Aucun vélo »", () => {
    poser();

    expect(screen.getAllByRole("radio")).toHaveLength(CYCLES.length + 1);
    expect(
      screen.getByRole("radio", { name: "Aucun vélo" }),
    ).toBeInTheDocument();
  });

  it("annonce le bloc comme facultatif", () => {
    // `interventions.cycle_id` est NULLable et le rattachement ne conditionne
    // rien. Un bloc qui se présenterait comme requis mentirait sur le contrat.
    poser();

    expect(
      screen.getByRole("heading", { name: /Vélo concerné/ }),
    ).toHaveTextContent(/facultatif/i);
  });
});

describe("EtapeCycle - le visiteur qui n'en a aucun", () => {
  // ⚠️ **C'est le cas NOMINAL à la première réservation**, pas un cas limite :
  // le seed ne pose aucun vélo, et un client qui vient de créer son compte au
  // récapitulatif n'en a aucun.

  it("n'affiche aucun bouton radio", () => {
    poser([]);

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("ne propose AUCUN lien qui ferait sortir du tunnel", () => {
    // 🔴 La propriété centrale de ce fichier. Le panneau de
    // `/mes-interventions` propose « Ajouter un vélo » vers `/mon-compte/cycles`
    // et c'est bon là-bas ; ici le même lien abandonnerait un tunnel composé, à
    // l'avant-dernier geste. Arbitré le 2026-08-16.
    poser([]);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("dit où le rattachement se fera, sans bloquer la réservation", () => {
    poser([]);

    expect(screen.getByText(/Mes vélos/)).toBeInTheDocument();
  });
});

describe("EtapeCycle - accessibilité", () => {
  it("ne porte aucune violation axe, avec ou sans vélo", async () => {
    const avec = poser();
    expect(await axe(avec.container)).toHaveNoViolations();

    const sans = poser([]);
    expect(await axe(sans.container)).toHaveNoViolations();
  });
});
