// Barre latérale de l'espace technicien - T-V2-05, maquette **T1**.
//
// Ce que ces tests fixent tient en une phrase : **trois entrées, pas six**. La
// maquette en dessine six et trois n'ont aucune US (« Ma zone », « Profil »,
// « Aide »). Les poser produirait trois liens morts dans une navigation
// permanente, ce que la leçon `T-T2-16` d'Argo proscrit et ce que la barre de
// l'espace client évite déjà nommément.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";

const usePathname = vi.fn(() => "/interventions/du-jour");
vi.mock("next/navigation", () => ({ usePathname: () => usePathname() }));

const { BarreLateraleTechnicien } = await import("./barre-laterale");

function barre() {
  return within(screen.getByRole("navigation", { name: "Espace technicien" }));
}

beforeEach(() => {
  usePathname.mockReturnValue("/interventions/du-jour");
});

describe("BarreLateraleTechnicien", () => {
  it("porte trois entrées, et exactement celles qui ont une US", () => {
    render(<BarreLateraleTechnicien />);

    const entrees = barre().getAllByRole("link");

    expect(entrees.map((lien) => lien.textContent)).toEqual([
      "Aujourd'hui",
      "Cette semaine",
      "Historique",
    ]);
  });

  it("ne porte ni « Ma zone », ni « Profil », ni « Aide »", () => {
    render(<BarreLateraleTechnicien />);

    for (const absent of ["Ma zone", "Profil", "Aide"]) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
  });

  it("ne porte pas le CTA « Nouvelle Intervention »", () => {
    // `US-INTERVENTION-CREER` est **v2 admin**, pas technicien. La maquette le
    // place pourtant en tête de barre.
    render(<BarreLateraleTechnicien />);

    expect(
      screen.queryByText(/Nouvelle Intervention/i),
    ).not.toBeInTheDocument();
  });

  it("ne duplique pas l'identité que le header porte déjà", () => {
    // C8 comme T1 placent l'identité en bas de barre.
    // `US-COMPTE-DECONNECTER` §Contexte l'impose « dans le header », où
    // `UserMenu` la rend. La dupliquer donnerait deux menus pour une personne.
    render(<BarreLateraleTechnicien />);

    expect(
      screen.queryByRole("button", { name: /Ouvrir le menu/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Technicien/i)).not.toBeInTheDocument();
  });

  it("marque l'entrée de la route courante", () => {
    usePathname.mockReturnValue("/interventions/passees");
    render(<BarreLateraleTechnicien />);

    expect(barre().getByRole("link", { name: "Historique" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      barre().getByRole("link", { name: "Aujourd'hui" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("ne marque rien sur une route de l'espace qu'elle ne liste pas", () => {
    // `/interventions/[id]` arrive avec T-V2-02 et vivra sous le même layout :
    // aucune des trois entrées n'est alors « la page courante », et en marquer
    // une au hasard mentirait au lecteur d'écran.
    usePathname.mockReturnValue("/interventions/42");
    render(<BarreLateraleTechnicien />);

    for (const lien of barre().getAllByRole("link")) {
      expect(lien).not.toHaveAttribute("aria-current");
    }
  });

  it("nomme son repère de navigation", () => {
    render(<BarreLateraleTechnicien />);

    expect(
      screen.getByRole("navigation", { name: "Espace technicien" }),
    ).toBeInTheDocument();
  });

  it("ne présente aucune violation d'accessibilité", async () => {
    const { container } = render(<BarreLateraleTechnicien />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
