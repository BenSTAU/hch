// Page de connexion — ajoutée par l'agent testeur.
//
// La page est un Server Component **synchrone** : RTL sait la dérouler, à la
// différence d'un RSC asynchrone qui relèverait de l'E2E (ADR-014). Elle porte
// deux critères que le formulaire seul ne peut pas satisfaire — le repère de
// contenu principal et la hiérarchie de titres.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/auth/login", () => ({
  login: vi.fn(),
}));

const { default: ConnexionPage } = await import("./page");

describe("ConnexionPage — repères et titres", () => {
  it("expose un repère de contenu principal", () => {
    render(<ConnexionPage />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("porte un H1 unique et nommé", () => {
    // WCAG 1.3.1 (A), RGAA 9.1. Un H1 par page, et il décrit la page.
    render(<ConnexionPage />);

    const titres = screen.getAllByRole("heading", { level: 1 });
    expect(titres).toHaveLength(1);
    expect(titres[0]).toHaveTextContent("Connexion");
  });

  it("ne saute aucun niveau de titre", () => {
    render(<ConnexionPage />);

    const niveaux = screen
      .getAllByRole("heading")
      .map((titre) => Number(titre.tagName.slice(1)));

    expect(niveaux[0]).toBe(1);
    for (let i = 1; i < niveaux.length; i += 1) {
      expect(niveaux[i]! - niveaux[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it("monte réellement le formulaire de connexion", () => {
    // La frontière `"use client"` descend au composant feuille : la page reste
    // serveur, le formulaire est client, et l'assemblage doit tenir.
    render(<ConnexionPage />);

    expect(screen.getByLabelText("Adresse email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Se connecter" }),
    ).toBeInTheDocument();
  });
});
