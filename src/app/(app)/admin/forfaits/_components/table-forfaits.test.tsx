// Tableau du catalogue des forfaits, écran **A3**.
//
// Trois règles s'y vérifient et nulle part ailleurs :
//
//   · les forfaits inactifs restent VISIBLES, là où la vitrine les masque ;
//   · leur statut est porté par un texte, pas seulement par le gris (RGAA 3.1,
//     l'information ne doit pas reposer sur la seule couleur) ;
//   · le tri vit dans l'URL et `aria-sort` le déclare sur la colonne.
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { lireTriForfaits } from "@/lib/validations/forfaits";

import { TableForfaits } from "./table-forfaits";

const REVISION = {
  id: 1,
  label: "Révision complète",
  description: "Entretien complet pour rouler en sécurité",
  duration: 60,
  price: "85.00",
  isActive: true,
  version: "jeton-1",
};

const RETIRE = {
  id: 2,
  label: "Réglage dérailleurs",
  description: null,
  duration: 15,
  price: "35.00",
  isActive: false,
  version: "jeton-2",
};

function rendre(forfaits = [REVISION, RETIRE]) {
  return render(<TableForfaits forfaits={forfaits} tri="label" sens="asc" />);
}

describe("TableForfaits, contenu", () => {
  it("affiche les forfaits inactifs au lieu de les masquer", () => {
    rendre();

    expect(screen.getByText("Réglage dérailleurs")).toBeInTheDocument();
  });

  it("nomme le statut en toutes lettres, pas seulement par la couleur", () => {
    rendre();

    expect(screen.getByText("Actif")).toBeInTheDocument();
    expect(screen.getByText("Désactivé")).toBeInTheDocument();
  });

  it("formate le prix en euros et la durée en minutes", () => {
    rendre([REVISION]);

    expect(screen.getByText(/85,00/)).toBeInTheDocument();
    expect(screen.getByText("60 min")).toBeInTheDocument();
  });

  it("mène à la fiche de chaque forfait par son nom", () => {
    rendre([REVISION]);

    expect(
      screen.getByRole("link", { name: "Révision complète" }),
    ).toHaveAttribute("href", "/admin/forfaits/1");
  });

  it("accepte un forfait sans description", () => {
    // `services.description` est NULLable : la ligne doit tenir sans.
    rendre([RETIRE]);

    expect(screen.getByText("Réglage dérailleurs")).toBeInTheDocument();
  });
});

describe("TableForfaits, tri", () => {
  it("déclare la colonne triée et son sens", () => {
    rendre();

    expect(screen.getByRole("columnheader", { name: /Nom/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /Prix/ })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("inverse le sens de la colonne déjà triée", () => {
    rendre();

    expect(screen.getByRole("link", { name: /Nom/ })).toHaveAttribute(
      "href",
      "/admin/forfaits?tri=label&sens=desc",
    );
  });

  it("démarre toujours en croissant sur une autre colonne", () => {
    rendre();

    expect(screen.getByRole("link", { name: /Prix/ })).toHaveAttribute(
      "href",
      "/admin/forfaits?tri=price&sens=asc",
    );
  });

  it("annonce l'effet du clic, que l'icône ne dit pas", () => {
    rendre();

    expect(
      screen.getByRole("link", { name: /Prix, trier par ordre croissant/ }),
    ).toBeInTheDocument();
  });

  it("propose les trois colonnes triables de la SPEC", () => {
    rendre();

    for (const colonne of [/Nom/, /Prix/, /Durée/]) {
      expect(screen.getByRole("link", { name: colonne })).toBeInTheDocument();
    }
  });
});

describe("TableForfaits, accessibilité", () => {
  it("porte une légende de tableau pour le lecteur d'écran", () => {
    rendre();

    expect(
      screen.getByRole("table", { name: /Catalogue des forfaits/ }),
    ).toBeInTheDocument();
  });

  it("ne présente aucune violation axe", async () => {
    const { container } = rendre();

    expect(await axe(container)).toHaveNoViolations();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur la PR de fond de
// T-B1-01, constat F4.
// ─────────────────────────────────────────────────────────────────────────

describe("TableForfaits, l'URL écrite est celle que la page relit", () => {
  // ⚠️ **Le découplage a créé deux sources pour un même nom.**
  //
  // Le constat F4 sort `page`, `tri` et `sens` des primitives et les met dans
  // `PARAM_PAGE` / `PARAM_TRI` / `PARAM_SENS` (`src/lib/routes.ts`). Mais la
  // LECTURE, elle, les nomme toujours en propriétés d'objet - `searchParams`
  // de Next et `lireTriForfaits` - et `routes.ts` le reconnaît en commentaire.
  //
  // Conséquence : renommer une constante produirait des liens que le lecteur
  // ignore en silence, en retombant sur ses défauts (`label`, `asc`, page 1).
  // Aucun écran ne planterait, aucun test livré ne rougirait, et le tri
  // cesserait simplement de fonctionner. Ce test ferme la boucle : ce que le
  // tableau ÉCRIT dans le lien est relu par le lecteur de la page.
  //
  // Les tests livrés de `tri-colonne.test.tsx` passent des noms arbitraires
  // (`order`, `dir`) : ils prouvent que la prop est honorée, pas que la
  // convention des deux bouts coïncide.
  it("produit un lien que `lireTriForfaits` sait relire", () => {
    rendre();

    const lien = screen.getByRole("link", { name: /Prix/ });
    const requete = new URL(
      lien.getAttribute("href") ?? "",
      "https://exemple.test",
    ).searchParams;

    // Exactement ce que fait la page : les paramètres d'URL arrivent en objet.
    const relu = lireTriForfaits(Object.fromEntries(requete));

    expect(relu).toEqual({ tri: "price", sens: "asc", page: 1 });
  });

  it("produit un lien de tri descendant que le lecteur relit aussi", () => {
    // Le second clic sur la colonne courante inverse le sens : c'est la seule
    // valeur de `sens` que le lecteur distingue de son défaut, donc la seule
    // qui prouve que le nom du paramètre porte.
    render(<TableForfaits forfaits={[REVISION]} tri="price" sens="asc" />);

    const lien = screen.getByRole("link", { name: /Prix/ });
    const requete = new URL(
      lien.getAttribute("href") ?? "",
      "https://exemple.test",
    ).searchParams;

    expect(lireTriForfaits(Object.fromEntries(requete))).toEqual({
      tri: "price",
      sens: "desc",
      page: 1,
    });
  });
});
