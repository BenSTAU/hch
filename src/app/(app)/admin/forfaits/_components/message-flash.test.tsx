// Message de confirmation après une action qui a redirigé.
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MessageFlash } from "./message-flash";

describe("MessageFlash", () => {
  it("garde la région live dans le flux même sans message", () => {
    // Une région live révélée en même temps que son contenu n'est pas annoncée
    // de façon fiable par tous les couples lecteur/navigateur.
    render(<MessageFlash message="" />);

    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("annonce le message après le montage", async () => {
    render(<MessageFlash message="Forfait Révision complète ajouté" />);

    expect(
      await screen.findByText("Forfait Révision complète ajouté"),
    ).toBeInTheDocument();
  });

  it("ne présente aucune violation axe", async () => {
    const { container } = render(
      <MessageFlash message="Aucune modification" />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
