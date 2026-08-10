import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { FORFAITS } from "@/test/tunnel";

import { EtapeForfait } from "./etape-forfait";

/// Écran **C2**. Deux familles d'oracles, et la seconde compte autant que la
/// première :
///
///   · le choix est **exclusif** et se pilote comme un groupe de boutons
///     radio, flèches comprises ;
///   · **trois formulations de la maquette ne doivent pas revenir** - les puces
///     de prestation inventées, le badge « Le plus demandé », et le bandeau qui
///     annonçait des frais kilométriques.

function poser(forfaitId: number | null = null) {
  const onSelection = vi.fn();
  const utilisateur = userEvent.setup();
  const { container } = render(
    <>
      <h1 id="titre-c2">Quel forfait vous convient ?</h1>
      <EtapeForfait
        forfaits={FORFAITS}
        forfaitId={forfaitId}
        onSelection={onSelection}
        idTitre="titre-c2"
      />
    </>,
  );
  return { onSelection, utilisateur, container };
}

describe("EtapeForfait - choix exclusif", () => {
  it("nomme chaque option par son forfait et son tarif", () => {
    // Constaté au navigateur : un `<button role="radio">` étiqueté par un
    // `<label for>` n'obtient AUCUN nom accessible sous Chrome. Sans
    // `aria-labelledby`, la liste s'annonce « bouton radio, 1 sur 3 » sans
    // jamais dire de quel forfait il s'agit (RGAA 11.1).
    poser();

    // ⚠️ `\s` et non un espace littéral : `getByRole` ne normalise **pas** le
    // nom accessible, contrairement aux requêtes de texte. Or `formatDuree`
    // pose une espace insécable et `Intl` en pose une fine devant l'euro - une
    // regex écrite avec des espaces ordinaires ne matcherait jamais, et le
    // test échouerait sur la typographie au lieu du contenu.
    expect(
      screen.getByRole("radio", {
        name: /Diagnostic express[\s\S]*25,00[\s\S]*20\smin/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", {
        name: /Révision complète[\s\S]*85,00[\s\S]*60\smin/,
      }),
    ).toBeInTheDocument();
  });

  it("nomme le groupe par le titre de l'écran", () => {
    poser();

    expect(
      screen.getByRole("radiogroup", { name: /quel forfait vous convient/i }),
    ).toBeInTheDocument();
  });

  it("remonte le forfait retenu, une seule fois", async () => {
    const { onSelection, utilisateur } = poser();

    await utilisateur.click(
      screen.getByRole("radio", { name: /Changement pneus/ }),
    );

    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(onSelection).toHaveBeenCalledWith(3);
  });

  it("se parcourt aux flèches et se retient à la barre d'espace", async () => {
    // C'est ce que le motif ARIA apporte gratuitement et qu'une grille de
    // `<button>` n'aurait pas : une seule tabulation pour entrer dans le
    // groupe, puis les flèches (RGAA 7.1).
    //
    // ⚠️ **La sélection ne suit PAS le focus** dans cette version de Radix,
    // vérifié sur un `RadioGroup` nu : la flèche déplace, l'espace retient.
    // Le motif ARIA autorise les deux, mais l'oracle d'origine de ce test
    // supposait l'autre - c'était le test qui avait tort.
    const { onSelection, utilisateur } = poser(2);

    screen.getByRole("radio", { name: /Diagnostic express/ }).focus();
    await utilisateur.keyboard("{ArrowDown}");

    expect(
      screen.getByRole("radio", { name: /Changement pneus/ }),
    ).toHaveFocus();
    expect(onSelection).not.toHaveBeenCalled();

    await utilisateur.keyboard("[Space]");
    expect(onSelection).toHaveBeenCalledWith(3);
  });

  it("marque le forfait retenu, et lui seul", () => {
    poser(1);

    const retenu = screen.getByRole("radio", { name: /Révision complète/ });
    expect(retenu).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Diagnostic express/ }),
    ).not.toBeChecked();
  });

  it("n'annonce pas deux fois l'état retenu", () => {
    // La pastille « Sélectionné » est décorative : `aria-checked` le dit déjà,
    // et la laisser dans l'arbre d'accessibilité le ferait entendre deux fois.
    poser(1);

    expect(screen.getByText("Sélectionné")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});

describe("EtapeForfait - divergences de portage", () => {
  it("affiche la description du catalogue, pas des puces inventées", () => {
    // `c2:162-175` liste « Vérification de 20 points de contrôle » et « 2 pneus
    // urbains renforcés » : aucune source. Une puce inventée sur un écran de
    // tarifs est un engagement que personne n'a pris.
    poser();

    expect(
      screen.getByText(/contrôle rapide de l'état général du vélo/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/points de contrôle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/renforcés/i)).not.toBeInTheDocument();
  });

  it("ne met aucun forfait en avant", () => {
    // `c2:183-186` : le badge suppose un marqueur absent de `services`, et un
    // catalogue de trois forfaits exactement.
    poser();

    expect(screen.queryByText(/le plus demandé/i)).not.toBeInTheDocument();
  });

  it("ne promet ni communes hors zone ni frais kilométriques", () => {
    // `c2:259-260` annonçait Bron et Vénissieux, hors de la zone seedée, puis
    // « des frais kilométriques peuvent s'appliquer au-delà » - ce qui contredit
    // le prix figé (Constitution §4.1) et ce que la landing déjà livrée promet.
    poser();

    expect(screen.queryByText(/bron/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/vénissieux/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/frais kilométriques/i)).not.toBeInTheDocument();
    expect(screen.getByText(/déplacement compris/i)).toBeInTheDocument();
    expect(screen.getByText(/sans supplément kilométrique/i)).toBeVisible();
  });

  it("affiche des tarifs complets, mention TTC comprise", () => {
    // Constitution §5.1 : « les tarifs sont publics, complets ». Sans TTC, le
    // visiteur ne sait pas si une taxe s'ajoute au paiement.
    poser();

    expect(screen.getAllByText(/TTC \/ \d+ min/)).toHaveLength(FORFAITS.length);
  });
});

describe("EtapeForfait - accessibilité", () => {
  it("ne présente aucune violation axe, sans sélection", async () => {
    const { container } = poser();

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation axe, forfait retenu", async () => {
    const { container } = poser(1);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
