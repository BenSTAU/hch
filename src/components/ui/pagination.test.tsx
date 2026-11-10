// Pagination partagée. Montée de `features/interventions/` à son deuxième
// usage ; ces tests figent ce qui, en la généralisant, aurait pu se perdre :
// la conservation des paramètres de la liste, et l'absence de `?page=1`.
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Pagination } from "./pagination";

describe("Pagination", () => {
  it("ne s'affiche pas quand il n'y a qu'une page", () => {
    const { container } = render(
      <Pagination page={1} pages={1} base="/admin/forfaits" libelle="Pages" />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("rend un lien par page", () => {
    render(
      <Pagination page={1} pages={3} base="/admin/forfaits" libelle="Pages" />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("omet `page=1` de l'URL de la première page", () => {
    // Deux URL pour la même liste seraient deux entrées de cache et deux
    // adresses partagées pour un seul écran.
    render(
      <Pagination page={2} pages={3} base="/admin/forfaits" libelle="Pages" />,
    );

    expect(screen.getByRole("link", { name: /^1/ })).toHaveAttribute(
      "href",
      "/admin/forfaits",
    );
  });

  it("conserve les paramètres de la liste d'une page à l'autre", () => {
    // Les perdre afficherait la page 2 d'une autre liste que celle regardée.
    render(
      <Pagination
        page={1}
        pages={3}
        base="/admin/forfaits"
        parametres={{ tri: "price", sens: "desc" }}
        libelle="Pages"
      />,
    );

    expect(screen.getByRole("link", { name: /^2/ })).toHaveAttribute(
      "href",
      "/admin/forfaits?tri=price&sens=desc&page=2",
    );
  });

  it("ignore un paramètre vide ou absent", () => {
    render(
      <Pagination
        page={1}
        pages={2}
        base="/mes-interventions/passees"
        parametres={{ du: "", au: undefined }}
        libelle="Pages"
      />,
    );

    expect(screen.getByRole("link", { name: /^2/ })).toHaveAttribute(
      "href",
      "/mes-interventions/passees?page=2",
    );
  });

  it("marque la page courante et nomme la navigation", () => {
    render(
      <Pagination
        page={2}
        pages={3}
        base="/admin/forfaits"
        libelle="Pagination du catalogue"
      />,
    );

    expect(screen.getByRole("link", { name: /page courante/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("navigation", { name: "Pagination du catalogue" }),
    ).toBeInTheDocument();
  });

  it("ne présente aucune violation axe", async () => {
    const { container } = render(
      <Pagination page={2} pages={4} base="/admin/forfaits" libelle="Pages" />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
