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
