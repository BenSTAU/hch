// Coquille de la page de connexion — tests écrits par l'agent testeur en
// T-J0-04 sur `page.tsx`, **retargés** en T-J0-05 sur `ConnexionView`.
//
// Règle du test rouge, 3ᵉ ligne du tableau (dépendance à un détail
// d'implémentation invalidé par un refactor légitime) : la page a dû devenir
// asynchrone pour lire `searchParams` — Next 16 la type `Promise` — et un RSC
// asynchrone ne se déroule pas sous RTL (ADR-014). Les oracles ci-dessous sont
// **inchangés**, seul leur sujet a bougé : tout ce qu'ils observaient vit
// désormais dans `ConnexionView`, synchrone. Aucune assertion n'a été
// affaiblie, aucun test n'a été supprimé.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/auth/login", () => ({
  login: vi.fn(),
}));

const { ConnexionView } = await import("./connexion-view");

describe("ConnexionView — repères et titres", () => {
  it("expose un repère de contenu principal", () => {
    render(<ConnexionView />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("porte un H1 unique et nommé", () => {
    // WCAG 1.3.1 (A), RGAA 9.1. Un H1 par page, et il décrit la page.
    render(<ConnexionView />);

    const titres = screen.getAllByRole("heading", { level: 1 });
    expect(titres).toHaveLength(1);
    expect(titres[0]).toHaveTextContent("Connexion");
  });

  it("ne saute aucun niveau de titre", () => {
    render(<ConnexionView />);

    const niveaux = screen
      .getAllByRole("heading")
      .map((titre) => Number(titre.tagName.slice(1)));

    expect(niveaux[0]).toBe(1);
    for (let i = 1; i < niveaux.length; i += 1) {
      expect(niveaux[i]! - niveaux[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it("monte réellement le formulaire de connexion", () => {
    // La frontière `"use client"` descend au composant feuille : la coquille
    // reste serveur, le formulaire est client, et l'assemblage doit tenir.
    render(<ConnexionView />);

    expect(screen.getByLabelText("Adresse email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Se connecter" }),
    ).toBeInTheDocument();
  });
});

describe("ConnexionView — destination transmise", () => {
  it("transporte la destination jusqu'au formulaire", async () => {
    // Ajouté en T-J0-05. Le `next` traverse trois couches — page, coquille,
    // formulaire — et un maillon muet ne se verrait qu'à l'exécution, sous la
    // forme d'un utilisateur ramené au mauvais endroit après connexion.
    const { login } = await import("@/lib/actions/auth/login");
    const userEvent = (await import("@testing-library/user-event")).default;
    vi.mocked(login).mockResolvedValue(undefined as never);

    render(<ConnexionView next="/admin/parametres?onglet=societe" />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Adresse email"),
      "admin@homecyclhome.fr",
    );
    await user.type(screen.getByLabelText("Mot de passe"), "un-mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(vi.mocked(login)).toHaveBeenCalledWith(
      expect.objectContaining({ next: "/admin/parametres?onglet=societe" }),
    );
  });
});
