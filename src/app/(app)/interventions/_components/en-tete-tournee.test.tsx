// Onglets porteurs de l'espace technicien - T-V2-05.
//
// Ce que ces tests fixent est **la navigation en mobile**. La barre latérale de
// la maquette T1 disparaît sous 768 px (`hidden md:flex`) sans rien pour la
// remplacer : ces onglets-ci sont ce qui rend les trois vues atteignables sur un
// téléphone, et le parcours technicien est celui qui se vit sur le terrain.
//
// Le second point fixé est le **motif ARIA** : ce sont trois routes, donc un
// `nav` de liens avec `aria-current`, pas un widget `Tabs` qui ne produirait
// aucune URL.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";

import { EnTeteTournee } from "./en-tete-tournee";

describe("EnTeteTournee", () => {
  it("porte les trois vues, et elles seules", () => {
    // Ni « Ma zone », ni « Profil », ni « Aide » : la maquette les dessine,
    // aucune US ne les porte. Un lien mort dans une navigation permanente est
    // la leçon `T-T2-16` d'Argo.
    render(<EnTeteTournee actif="du-jour" />);

    const onglets = within(
      screen.getByRole("navigation", { name: "Mes interventions" }),
    ).getAllByRole("link");

    expect(onglets.map((lien) => lien.textContent)).toEqual([
      "Aujourd'hui",
      "Cette semaine",
      "Historique",
    ]);
  });

  it("mène chaque onglet à sa route", () => {
    // ⚠️ Le libellé suit la maquette, le chemin suit l'identifiant de l'US :
    // « Cette semaine » mène à `/interventions/a-venir`, parce que
    // `US-INTERVENTIONS-LISTER-TECH-A-VENIR` est son nom et que « semaine »
    // deviendrait faux dès `?jours=30`.
    render(<EnTeteTournee actif="du-jour" />);

    expect(screen.getByRole("link", { name: "Aujourd'hui" })).toHaveAttribute(
      "href",
      "/interventions/du-jour",
    );
    expect(screen.getByRole("link", { name: "Cette semaine" })).toHaveAttribute(
      "href",
      "/interventions/a-venir",
    );
    expect(screen.getByRole("link", { name: "Historique" })).toHaveAttribute(
      "href",
      "/interventions/passees",
    );
  });

  it("marque l'onglet courant, et lui seul", () => {
    render(<EnTeteTournee actif="a-venir" />);

    expect(screen.getByRole("link", { name: "Cette semaine" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Aujourd'hui" }),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("link", { name: "Historique" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("marque le bon onglet sur chacune des trois vues", () => {
    for (const [actif, libelle] of [
      ["du-jour", "Aujourd'hui"],
      ["a-venir", "Cette semaine"],
      ["passees", "Historique"],
    ] as const) {
      const vue = render(<EnTeteTournee actif={actif} />);

      expect(screen.getByRole("link", { name: libelle })).toHaveAttribute(
        "aria-current",
        "page",
      );
      vue.unmount();
    }
  });

  it("nomme son repère de navigation", () => {
    // La page en porte plusieurs - celui-ci, la barre latérale, l'en-tête du
    // site et les deux colonnes du pied de page. Sans nom, un lecteur d'écran
    // les annonce à l'identique (WCAG 1.3.1, RGAA A).
    render(<EnTeteTournee actif="du-jour" />);

    expect(
      screen.getByRole("navigation", { name: "Mes interventions" }),
    ).toBeInTheDocument();
  });

  it("n'affiche aucun compteur", () => {
    // Écart assumé au modèle `en-tete-espace.tsx`, qui en porte. Celui
    // d'« Aujourd'hui » divergerait d'une liste repollée toutes les 30 s, et
    // celui de « Cette semaine » dépendrait du sélecteur 7 j / 30 j. Arbitrage
    // du 2026-08-12 : chaque vue porte ses propres puces à la place.
    render(<EnTeteTournee actif="du-jour" />);

    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument();
  });

  it("ne présente aucune violation d'accessibilité", async () => {
    const { container } = render(<EnTeteTournee actif="passees" />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
