// Coquille de l'espace client - barre latérale partagée par C8, C10 et C11.
//
// Ce qui est vérifié, et le motif de chaque point :
//
//   · **deux entrées, exactement** - la coquille documente en toutes lettres
//     que trois entrées de la maquette n'ont aucune route (Tableau de bord,
//     Profil, Aide). Un lien mort dans une navigation permanente est la leçon
//     T-T2-16 d'Argo, citée par le fichier lui-même ;
//   · **`aria-current="page"` sur la seule entrée courante** - la couleur ne
//     dit rien à un lecteur d'écran, et deux entrées courantes ne veulent rien
//     dire (RGAA A) ;
//   · **les `href` viennent de `routes.ts`** - une constante recopiée à la main
//     donnerait une navigation qui pointe à côté de ce que les Server Actions
//     invalident.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { CHEMIN_CYCLES, CHEMIN_ESPACE_CLIENT } from "@/lib/routes";

import { CoquilleEspaceClient } from "./coquille-espace-client";

function barre() {
  return screen.getByRole("navigation", { name: "Espace client" });
}

describe("CoquilleEspaceClient", () => {
  it("ne propose que les deux entrées qui ont une route", () => {
    render(
      <CoquilleEspaceClient actif="interventions">
        <p>contenu</p>
      </CoquilleEspaceClient>,
    );

    const liens = within(barre()).getAllByRole("link");

    expect(liens.map((lien) => lien.getAttribute("href"))).toEqual([
      CHEMIN_ESPACE_CLIENT,
      CHEMIN_CYCLES,
    ]);
    expect(liens.map((lien) => lien.textContent)).toEqual([
      "Interventions",
      "Mes vélos",
    ]);
  });

  it("marque une seule entrée courante, et c'est celle du segment", () => {
    render(
      <CoquilleEspaceClient actif="cycles">
        <p>contenu</p>
      </CoquilleEspaceClient>,
    );

    const courantes = within(barre())
      .getAllByRole("link")
      .filter((lien) => lien.getAttribute("aria-current") === "page");

    expect(courantes).toHaveLength(1);
    expect(courantes[0]).toHaveAttribute("href", CHEMIN_CYCLES);
  });

  it("n'est masquée à AUCUNE largeur", () => {
    // Un `hidden md:block` orphelinerait C11 au téléphone, « Mes vélos » ne
    // figurant dans aucune autre navigation.
    //
    // ⚠️ **Oracle de substitution** : la propriété réelle est une media query,
    // que jsdom n'évalue pas - `toBeVisible()` rendrait vert un `hidden` de
    // Tailwind. Ce test lit donc une CLASSE, ce que le dépôt évite partout
    // ailleurs : il encode la régression, il ne prouve pas le rendu.
    render(
      <CoquilleEspaceClient actif="cycles">
        <p>contenu</p>
      </CoquilleEspaceClient>,
    );

    expect(barre().className).not.toMatch(/(^|\s)hidden(\s|$)/);
  });

  it("rend le contenu du segment, la coquille n'étant qu'un gabarit", () => {
    render(
      <CoquilleEspaceClient actif="interventions">
        <h1>Mes vélos</h1>
      </CoquilleEspaceClient>,
    );

    expect(screen.getByRole("heading", { name: "Mes vélos" })).toBeVisible();
  });
});
