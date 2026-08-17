// Bouton de déconnexion — `US-COMPTE-DECONNECTER`.
//
// Un `<form action={…}>` et non un `onClick` : la déconnexion est une mutation,
// donc une Server Action (CLAUDE.md §Server Actions), et le formulaire part en
// POST que React ait hydraté ou non. C'est la même leçon que le `<form action>`
// de la connexion — un bouton sans formulaire ne fait
// strictement rien tant que le JavaScript n'est pas chargé.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const logout = vi.fn();
vi.mock("@/lib/actions/auth/logout", () => ({
  logout: () => logout(),
}));

const { LogoutButton } = await import("./logout-button");

// Sans ça les appels s'accumulent d'un test à l'autre et toute assertion de
// CARDINALITÉ devient fausse — même défaut que dans `login-form.test.tsx`, où
// il avait été corrigé après coup.
beforeEach(() => vi.clearAllMocks());

describe("LogoutButton", () => {
  it("expose un bouton nommé, dans un formulaire", () => {
    const { container } = render(<LogoutButton />);

    expect(
      screen.getByRole("button", { name: "Se déconnecter" }),
    ).toBeInTheDocument();
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("soumet la Server Action au clic", async () => {
    render(<LogoutButton />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  });

  it("se déclenche au clavier", async () => {
    // WCAG 2.1.1 (A). Le bouton est le dernier maillon du parcours authentifié,
    // et sur un poste partagé c'est celui qu'on veut atteindre vite.
    render(<LogoutButton />);
    const user = userEvent.setup();

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Se déconnecter" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  });

  it("porte `type=submit` explicitement", () => {
    render(<LogoutButton />);

    expect(
      screen.getByRole("button", { name: "Se déconnecter" }),
    ).toHaveAttribute("type", "submit");
  });
});
