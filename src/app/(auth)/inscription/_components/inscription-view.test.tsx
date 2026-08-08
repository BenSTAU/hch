// Coquille de la page d'inscription. Même partage qu'à la connexion : la vue est
// synchrone, donc déroulable sous RTL, et le formulaire interactif est la feuille
// `"use client"`. Un RSC asynchrone ne se déroule pas sous RTL (ADR-014 : async
// Server Components → E2E uniquement), et les critères de structure de cet écran
// — repère principal, titre unique — resteraient alors sans test unitaire.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

vi.mock("@/lib/actions/auth/signup", () => ({ signupFormAction: vi.fn() }));

const { InscriptionView } = await import("./inscription-view");

describe("InscriptionView — repères et titres", () => {
  it("expose un repère de contenu principal", () => {
    render(<InscriptionView />);

    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("porte un H1 unique et nommé", () => {
    // WCAG 1.3.1 (A), RGAA 9.1.
    render(<InscriptionView />);

    const titres = screen.getAllByRole("heading", { level: 1 });
    expect(titres).toHaveLength(1);
    expect(titres[0]).toHaveTextContent("Créer un compte");
  });

  it("ne saute aucun niveau de titre", () => {
    render(<InscriptionView />);

    const niveaux = screen
      .getAllByRole("heading")
      .map((titre) => Number(titre.tagName.slice(1)));

    expect(niveaux[0]).toBe(1);
    for (let i = 1; i < niveaux.length; i += 1) {
      expect(niveaux[i]! - niveaux[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it("monte réellement le formulaire", () => {
    render(<InscriptionView />);

    expect(
      screen.getByRole("button", { name: "Créer mon compte" }),
    ).toBeInTheDocument();
  });

  it("propose un lien vers la connexion pour qui a déjà un compte", () => {
    render(<InscriptionView />);

    expect(screen.getByRole("link", { name: /connect/i })).toHaveAttribute(
      "href",
      "/connexion",
    );
  });

  it("ne porte aucune violation détectable par axe-core", async () => {
    // DoD T-V3-02 : « zéro violation sur la page d'inscription ». Le formulaire
    // a la même sonde de son côté ; celle-ci couvre l'assemblage, où naissent
    // les défauts de structure (titre manquant, repère absent, ordre des
    // niveaux).
    const { container } = render(<InscriptionView />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
