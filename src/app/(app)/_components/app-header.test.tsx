// En-tête de l'espace connecté — point d'accès à la déconnexion.
//
// `US-COMPTE-DECONNECTER` §Contexte place l'action « dans le menu utilisateur
// (avatar / initiales dans le header) ». Le menu déroulant appartient au
// portage des écrans C7/C8, qui revient à T-V3-10 ; ici c'est le strict
// nécessaire pour que la déconnexion soit ATTEIGNABLE — sans quoi elle
// n'existerait que comme endpoint.
//
// Le composant reçoit son utilisateur en prop et ne lit rien : la lecture vit
// dans le layout serveur, et la garde de rôle reste dans chaque page
// (CLAUDE.md §Authentication — jamais de check d'autorisation en layout).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/auth/logout", () => ({ logout: vi.fn() }));

const { AppHeader } = await import("./app-header");

const CAMILLE = { firstname: "Camille", lastname: "Durand" };

describe("AppHeader", () => {
  it("expose un repère d'en-tête", () => {
    // WCAG 1.3.1 (A) : les repères ARIA structurent la page pour la navigation
    // au lecteur d'écran. `<header>` hors de tout `<main>` porte `banner`.
    render(<AppHeader user={CAMILLE} />);

    expect(screen.getByRole("banner")).toBeInTheDocument();
  });

  it("nomme la personne connectée", () => {
    render(<AppHeader user={CAMILLE} />);

    expect(screen.getByText(/Camille Durand/)).toBeInTheDocument();
  });

  it("porte le bouton de déconnexion", () => {
    render(<AppHeader user={CAMILLE} />);

    expect(
      screen.getByRole("button", { name: "Se déconnecter" }),
    ).toBeInTheDocument();
  });

  it("ramène à l'accueil par un lien nommé", () => {
    render(<AppHeader user={CAMILLE} />);

    expect(screen.getByRole("link", { name: /HomeCycl'Home/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("n'affiche ni email ni rôle", () => {
    // Le DTO du DAL porte l'email et les rôles ; l'en-tête n'a besoin ni de
    // l'un ni de l'autre. Sur un poste partagé, l'adresse affichée en
    // permanence est une donnée personnelle exposée sans motif.
    render(
      <AppHeader user={{ ...CAMILLE }} />,
    );

    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ROLE_/)).not.toBeInTheDocument();
  });
});
