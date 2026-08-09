// Pied de page de la coquille publique.
//
// Ce que ce fichier verrouille, ce sont surtout des ABSENCES — et une absence
// ne se relit pas. « Mes factures » contredit Constitution §2.3, « Recrutement »
// est hors périmètre v1, « CGV » a été remplacé par `/accessibilite` au
// tranchage du 2026-08-08. Les trois sont dans les maquettes C1 et C13 : sans
// test, elles reviendraient au premier portage d'écran suivant.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

import { SiteFooter } from "./site-footer";

describe("SiteFooter — liens légaux", () => {
  it("porte les trois pages d'US-RGPD", () => {
    // Triplet de PLAN S4 §4.2, qui fait foi contre les trois autres qui
    // circulaient dans les artefacts jusqu'au 2026-08-08.
    render(<SiteFooter />);

    expect(
      screen.getByRole("link", { name: "Mentions légales" }),
    ).toHaveAttribute("href", "/mentions-legales");
    expect(
      screen.getByRole("link", { name: "Politique de confidentialité" }),
    ).toHaveAttribute("href", "/politique-confidentialite");
    expect(screen.getByRole("link", { name: "Accessibilité" })).toHaveAttribute(
      "href",
      "/accessibilite",
    );
  });

  it("ne propose pas de CGV", () => {
    // C1 `code.html:507` et l'onglet de C13. La 3ᵉ page réelle est
    // `/accessibilite`, qui porte la déclaration RGAA formelle.
    render(<SiteFooter />);

    expect(screen.queryByText(/CGV/i)).not.toBeInTheDocument();
  });
});

describe("SiteFooter — retraits imposés par la DoD", () => {
  it("ne propose pas « Mes factures »", () => {
    // C1 `code.html:500`. Constitution §2.3 : le paiement est encaissé sur le
    // terrain, il n'existe aucune facture en ligne à consulter.
    render(<SiteFooter />);

    expect(screen.queryByText(/factures?/i)).not.toBeInTheDocument();
  });

  it("ne propose pas « Recrutement »", () => {
    // C1 `code.html:509` et C13 `code.html:285`. Hors périmètre v1.
    render(<SiteFooter />);

    expect(screen.queryByText(/recrutement/i)).not.toBeInTheDocument();
  });

  it("ne propose aucun formulaire de contact", () => {
    // Constitution §1.2 : un rappel humain intermédiaire n'est pas HCH. Les
    // coordonnées de la société vivent dans les mentions légales, pas dans un
    // formulaire qui ouvrirait une file de leads.
    render(<SiteFooter />);

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Contact$/i)).not.toBeInTheDocument();
  });
});

describe("SiteFooter — mentions", () => {
  it("date le copyright de 2026", () => {
    // [[maquettage]] §Notes portage, bloc Global : « © 2024 » des maquettes
    // C1, C9 et C13 → année réelle du projet.
    render(<SiteFooter />);

    expect(screen.getByText(/©\s*2026/)).toBeInTheDocument();
    expect(screen.queryByText(/2024/)).not.toBeInTheDocument();
  });

  it("expose un repère de pied de page", () => {
    render(<SiteFooter />);

    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });

  it("nomme chacun de ses repères de navigation", () => {
    // Deux `nav` ici, un troisième dans l'en-tête : sans nom accessible, un
    // lecteur d'écran les annonce à l'identique (WCAG 1.3.1, RGAA A).
    render(<SiteFooter />);

    expect(
      screen.getByRole("navigation", { name: "Le service" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Informations légales" }),
    ).toBeInTheDocument();
  });
});

describe("SiteFooter — accessibilité", () => {
  it("ne présente aucune violation", async () => {
    const { container } = render(<SiteFooter />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
