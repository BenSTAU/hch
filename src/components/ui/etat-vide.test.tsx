// État vide d'une liste. Rendu par `admin/forfaits/page.tsx`, un RSC
// asynchrone que ni Vitest ni RTL ne déroulent : sans ce fichier, la branche
// « état vide avec appel à l'ajout » de la DoD 2 n'était couverte **nulle
// part**. Relevé par la session vérificatrice (É1).
import { axe } from "jest-axe";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";

import { EtatVide } from "./etat-vide";

describe("EtatVide", () => {
  it("annonce le titre comme un paragraphe, pas comme un titre de section", () => {
    // Un `<h2>` ici casserait la hiérarchie de la page, dont le `<h1>` est
    // déjà posé par l'écran (RGAA 9.1).
    render(<EtatVide titre="Aucun forfait au catalogue" />);

    expect(screen.getByText("Aucun forfait au catalogue")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("affiche la description quand elle est fournie", () => {
    render(
      <EtatVide
        titre="Aucun forfait au catalogue"
        description="Tant que le catalogue est vide, aucun client ne peut réserver."
      />,
    );

    expect(
      screen.getByText(/aucun client ne peut réserver/),
    ).toBeInTheDocument();
  });

  it("se passe de description", () => {
    const { container } = render(<EtatVide titre="Rien ici" />);

    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("porte l'action qui sort de l'état vide", () => {
    // `US-FORFAIT-LISTER` : « si le catalogue est vide, un CTA Ajouter un
    // premier forfait pointe sur US-FORFAIT-AJOUTER ». L'action est passée en
    // `children` parce que selon l'écran c'est un lien, un bouton, ou rien.
    render(
      <EtatVide titre="Aucun forfait au catalogue">
        <Button asChild>
          <Link href="/admin/forfaits/nouveau">Ajouter un premier forfait</Link>
        </Button>
      </EtatVide>,
    );

    expect(
      screen.getByRole("link", { name: "Ajouter un premier forfait" }),
    ).toHaveAttribute("href", "/admin/forfaits/nouveau");
  });

  it("se passe d'action", () => {
    render(<EtatVide titre="Rien ici" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("ne présente aucune violation axe", async () => {
    const { container } = render(
      <EtatVide titre="Aucun forfait au catalogue" description="Rien à voir.">
        <Button asChild>
          <Link href="/admin/forfaits/nouveau">Ajouter un premier forfait</Link>
        </Button>
      </EtatVide>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
