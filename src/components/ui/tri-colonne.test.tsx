// En-tête de colonne triable. Fichier ajouté par l'agent testeur sur T-B1-01 :
// le composant est une pièce du **patron** d'administration, et il n'avait
// aucun test co-localisé. Ce qu'il porte n'était exercé qu'à travers
// `TableForfaits`, qui ne l'appelle jamais avec `parametres` - la branche qui
// conserve les filtres de la liste était donc entièrement non couverte, alors
// que c'est précisément celle dont les onze autres écrans auront besoin.
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { TriColonne } from "./tri-colonne";

type ProprietesTriColonne = Parameters<typeof TriColonne>[0];

/// Un `<th>` hors d'un `<tr>` n'a pas le rôle `columnheader` et fait
/// avertir React. La table est le contexte minimal du composant.
function rendre(props: Partial<ProprietesTriColonne> = {}) {
  return render(
    <table>
      <thead>
        <tr>
          <TriColonne
            libelle="Prix"
            cle="price"
            triCourant="label"
            sensCourant="asc"
            base="/admin/forfaits"
            cleParametreTri="tri"
            cleParametreSens="sens"
            {...props}
          />
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>ligne</td>
        </tr>
      </tbody>
    </table>,
  );
}

describe("TriColonne, état annoncé", () => {
  it("déclare `none` sur une colonne qui n'est pas celle du tri courant", () => {
    rendre();

    expect(screen.getByRole("columnheader")).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("déclare le sens sur la colonne triée", () => {
    rendre({ triCourant: "price", sensCourant: "desc" });

    expect(screen.getByRole("columnheader")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("porte `aria-sort` sur la colonne et non sur le lien", () => {
    // RGAA 11 / motif ARIA `table` : c'est la COLONNE qui est triée, pas le
    // contrôle qui la trie. Posé sur le lien, l'attribut est ignoré.
    rendre({ triCourant: "price", sensCourant: "asc" });

    expect(screen.getByRole("link")).not.toHaveAttribute("aria-sort");
    expect(screen.getByRole("columnheader")).toHaveAttribute("aria-sort");
  });
});

describe("TriColonne, cible du lien", () => {
  it("conserve les filtres de la liste", () => {
    // Branche jamais exercée par `TableForfaits`. Les perdre trierait une
    // autre liste que celle regardée - sur le planning admin, changer le tri
    // effacerait la date affichée.
    rendre({
      parametres: { du: "2026-11-01", au: "2026-11-30", statut: "PLANNED" },
    });

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/admin/forfaits?du=2026-11-01&au=2026-11-30&statut=PLANNED&tri=price&sens=asc",
    );
  });

  it("ignore un filtre vide ou absent plutôt que de l'écrire", () => {
    rendre({ parametres: { du: "", au: undefined } });

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/admin/forfaits?tri=price&sens=asc",
    );
  });

  it("inverse le sens quand la colonne est déjà triée en croissant", () => {
    rendre({ triCourant: "price", sensCourant: "asc" });

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/admin/forfaits?tri=price&sens=desc",
    );
  });

  it("revient au croissant quand la colonne est triée en décroissant", () => {
    // Bascule à deux états, pas trois : il n'y a pas de retour à « non trié »,
    // la liste a toujours un ordre.
    rendre({ triCourant: "price", sensCourant: "desc" });

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/admin/forfaits?tri=price&sens=asc",
    );
  });

  it("prend les noms des paramètres de tri dans ses props", () => {
    // L'oracle du découplage de T-B1-01 : le composant écrivait `tri` et
    // `sens` en dur, donc il ne marchait pas tel quel ailleurs
    // (`04-folder-structure` §8.1). Un retour aux littéraux rougit ici.
    rendre({ cleParametreTri: "order", cleParametreSens: "dir" });

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/admin/forfaits?order=price&dir=asc",
    );
  });

  it("démarre en croissant sur une colonne non triée, quel que soit le sens courant", () => {
    rendre({ triCourant: "label", sensCourant: "desc" });

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/admin/forfaits?tri=price&sens=asc",
    );
  });
});

describe("TriColonne, accessibilité", () => {
  it("annonce l'effet du clic, que l'icône ne dit pas", () => {
    rendre({ triCourant: "price", sensCourant: "asc" });

    expect(
      screen.getByRole("link", { name: "Prix, trier par ordre décroissant" }),
    ).toBeInTheDocument();
  });

  it("ne présente aucune violation axe", async () => {
    const { container } = rendre();

    expect(await axe(container)).toHaveNoViolations();
  });
});
