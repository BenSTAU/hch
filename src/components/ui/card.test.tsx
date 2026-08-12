// `ui/card.tsx` porte DEUX modifications volontaires du registry shadcn, et ce
// fichier est leur garde - même dispositif que le « Close » traduit de
// `ui/sheet.tsx`.
//
// Un `pnpm dlx shadcn@latest add card` régénère le composant et écrase les
// deux. Sans ces oracles, la bordure redeviendrait un anneau et `asChild`
// disparaîtrait, silencieusement : le premier ne casse aucun rendu, le second
// ferait perdre les `<section>` sémantiques des pages qui l'utilisent.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Card, CardContent } from "./card";

describe("Card - modifications du registry a garder", () => {
  it("rend une BORDURE et non l'anneau du registry", () => {
    // Audit du 2026-08-12 : dix endroits redessinaient une card à la main parce
    // que le composant ne bordait pas. ADR-012 §D4 fait foi - T1 et C8 bordent
    // leurs cards, donc c'est le registry qui s'aligne.
    render(<Card data-testid="carte">contenu</Card>);

    const classes = screen.getByTestId("carte").className;

    expect(classes).toContain("border");
    expect(classes).toContain("border-border");
    expect(classes).not.toContain("ring-1");
  });

  it("accepte `asChild` et préserve alors la balise fournie", () => {
    // C'est ce qui permet à `<section aria-labelledby>` de gagner le style sans
    // perdre son repère : sans `asChild`, migrer ces pages échangerait une
    // duplication de style contre une perte de sémantique.
    render(
      <Card asChild>
        <section aria-labelledby="titre">
          <h2 id="titre">Données effacées</h2>
        </section>
      </Card>,
    );

    const region = screen.getByRole("region", { name: "Données effacées" });

    expect(region.tagName).toBe("SECTION");
    expect(region.className).toContain("border-border");
  });

  it("reste un `div` sans `asChild`", () => {
    render(<Card data-testid="carte">contenu</Card>);

    expect(screen.getByTestId("carte").tagName).toBe("DIV");
  });

  it("laisse l'appelant annuler la bordure", () => {
    // `border-0` est la sortie prévue - deux surfaces l'utilisent, la landing
    // et la carte de forfait. Avant, elles écrivaient `ring-0`, qui ne veut
    // plus rien dire.
    render(
      <Card data-testid="carte" className="border-0">
        contenu
      </Card>,
    );

    expect(screen.getByTestId("carte").className).toContain("border-0");
  });

  it("compose avec ses sous-parties", () => {
    render(
      <Card>
        <CardContent>contenu</CardContent>
      </Card>,
    );

    expect(screen.getByText("contenu")).toBeInTheDocument();
  });
});
