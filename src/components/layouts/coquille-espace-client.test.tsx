// Coquille de l'espace client - barre latérale partagée par C8, C10 et C11.
//
// Fichier ajouté par l'agent testeur (T-V3-16). La coquille vient d'être
// extraite de `mes-interventions/layout.tsx` et de gagner une seconde entrée,
// et **rien ne l'exerçait** : ni avant l'extraction, ni après. Deux DoD de la
// tâche portent pourtant dessus, et aucune n'avait d'oracle exécutable.
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
    // 🐛 Elle était `hidden md:block`, héritage du temps où elle ne portait
    // qu'« Interventions », que l'en-tête du site atteint par ailleurs. Avec
    // « Mes vélos », qui n'est dans aucune autre navigation, la même règle
    // **orphelinait C11 au téléphone** : constaté au navigateur en 375 px, pas
    // déduit.
    //
    // ⚠️ **Oracle de substitution, et il faut le dire** : la propriété réelle
    // est « la barre est visible en 375 px », c'est une media query, et jsdom
    // n'en évalue aucune - `toBeVisible()` rendrait vert un `hidden` de
    // Tailwind. Ce test lit donc une CLASSE, ce que le dépôt évite partout
    // ailleurs. Il encode exactement la régression, il ne prouve pas le rendu.
    // La preuve, elle, demande Playwright sur un viewport mobile, et l'espace
    // client n'a pas encore de scénario E2E.
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
