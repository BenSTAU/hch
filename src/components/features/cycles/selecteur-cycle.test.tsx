import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CYCLES } from "@/test/tunnel";

const { SelecteurCycle } = await import("./selecteur-cycle");

/// Le sélecteur partagé par les deux surfaces qui désignent un vélo : le
/// panneau de `/mes-interventions` (T+n) et l'écran C5 du tunnel (T=0).
///
/// Ce fichier tient la propriété qui justifie l'extraction : **le composant
/// choisit, il n'écrit jamais**. Les deux appelants écrivent à des moments
/// différents, et c'est ce qui interdisait de réutiliser `bloc-cycle.tsx` tel
/// quel.

function poser(valeur: number | null = null, disabled = false) {
  const onChangement = vi.fn();
  render(
    <>
      <h2 id="titre">Vélo concerné</h2>
      <SelecteurCycle
        idLibelle="titre"
        cycles={CYCLES}
        valeur={valeur}
        onChangement={onChangement}
        disabled={disabled}
      />
    </>,
  );
  return { onChangement, utilisateur: userEvent.setup() };
}

describe("SelecteurCycle", () => {
  it("propose « Aucun vélo » et un bouton par vélo", () => {
    poser();

    expect(screen.getAllByRole("radio")).toHaveLength(CYCLES.length + 1);
    expect(
      screen.getByRole("radio", { name: "Aucun vélo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Decathlon Elops 900/ }),
    ).toBeInTheDocument();
  });

  it("nomme un vélo sans modèle par sa seule marque", () => {
    // `cycles.model` est facultatif au dictionnaire. Sans cette lecture, un
    // vélo sans modèle rendrait « Moustache undefined ».
    poser();

    expect(
      screen.getByRole("radio", { name: /Moustache/ }),
    ).toHaveAccessibleName(expect.not.stringContaining("undefined"));
  });

  it("coche ce que la valeur désigne, pas ce qui a été cliqué", async () => {
    // La valeur est **contrôlée** : elle vient du serveur pour le panneau, de
    // l'état du tunnel pour C5. Un composant qui cocherait le clic pourrait
    // afficher un choix que personne n'a enregistré.
    const { onChangement, utilisateur } = poser(7);

    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      /Decathlon Elops 900/,
    );

    await utilisateur.click(screen.getByRole("radio", { name: /Moustache/ }));

    expect(onChangement).toHaveBeenCalledWith(4);
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      /Decathlon Elops 900/,
    );
  });

  it("rend `null` pour « Aucun vélo », jamais la chaîne sentinelle", async () => {
    // La sentinelle `"aucun"` est un détail de Radix, qui refuse `""`. Elle ne
    // doit pas traverser vers l'appelant : `interventions.cycle_id` attend
    // `null`.
    const { onChangement, utilisateur } = poser(7);

    await utilisateur.click(screen.getByRole("radio", { name: "Aucun vélo" }));

    expect(onChangement).toHaveBeenCalledWith(null);
  });

  it("coche « Aucun vélo » quand rien n'est désigné", () => {
    poser(null);

    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      "Aucun vélo",
    );
  });

  it("se désarme pendant une écriture en cours", async () => {
    const { onChangement, utilisateur } = poser(null, true);

    expect(screen.getByRole("radio", { name: /Moustache/ })).toBeDisabled();

    await utilisateur.click(screen.getByRole("radio", { name: /Moustache/ }));

    expect(onChangement).not.toHaveBeenCalled();
  });

  it("porte le nom de son titre visible", () => {
    // WCAG 1.3.1 : c'est le `role="radiogroup"` qu'un lecteur d'écran annonce
    // en entrant dans le groupe. Défaut mesuré sur C1, pas déduit.
    poser();

    expect(screen.getByRole("radiogroup")).toHaveAccessibleName(
      "Vélo concerné",
    );
  });

  it("se parcourt entièrement au clavier", async () => {
    // ⚠️ RGAA A : le bouton radio est
    // `sr-only`, donc invisible - c'est la dalle qui se voit. Le clavier est le
    // SEUL chemin qui reste si le masquage dérape en `display: none` ou en
    // `tabindex="-1"`, et rien ne le vérifiait. Le groupe est aussi le premier
    // du dépôt à être monté deux fois sur des écrans différents.
    // ⚠️ **La sélection ne suit PAS le focus** dans cette version de Radix : la
    // flèche déplace, l'espace retient. Même constat que sur le sélecteur de
    // forfait (`etape-forfait.test.tsx`), où l'oracle inverse avait été écrit
    // puis corrigé - le motif ARIA autorise les deux comportements.
    const { onChangement, utilisateur } = poser(null);

    await utilisateur.tab();

    // Une seule tabulation pour tout le groupe (roving tabindex), et elle
    // atterrit sur l'option cochée - ici « Aucun vélo », l'état nominal.
    expect(screen.getByRole("radio", { name: "Aucun vélo" })).toHaveFocus();

    await utilisateur.keyboard("{ArrowDown}");
    expect(
      screen.getByRole("radio", { name: /Decathlon Elops 900/ }),
    ).toHaveFocus();
    expect(onChangement).not.toHaveBeenCalled();

    await utilisateur.keyboard("[Space]");
    expect(onChangement).toHaveBeenCalledWith(7);

    // La sortie du groupe se fait en une tabulation, pas en autant que d'options.
    await utilisateur.tab();
    expect(screen.getByRole("radio", { name: /Moustache/ })).not.toHaveFocus();
  });
});

describe("SelecteurCycle - deux sélecteurs sur une même page", () => {
  // 🔴 La justification écrite du `useId()` de l'extraction : « deux sélecteurs
  // sur une même page se voleraient leurs `<label for>` ». Rien ne l'éprouvait,
  // et c'est la seule régression que l'extraction pouvait introduire seule -
  // `bloc-cycle.tsx` posait des identifiants littéraux (`cycle-7`, `cycle-aucun`).
  //
  // Le cas n'est pas hypothétique : le panneau de `/mes-interventions` et le
  // tunnel montent le même composant, et rien n'interdit qu'un écran futur en
  // porte deux.
  function poserDeux() {
    const premier = vi.fn();
    const second = vi.fn();

    render(
      <>
        <h2 id="titre-1">Premier vélo</h2>
        <SelecteurCycle
          idLibelle="titre-1"
          cycles={CYCLES}
          valeur={null}
          onChangement={premier}
        />
        <h2 id="titre-2">Second vélo</h2>
        <SelecteurCycle
          idLibelle="titre-2"
          cycles={CYCLES}
          valeur={null}
          onChangement={second}
        />
      </>,
    );

    return { premier, second, utilisateur: userEvent.setup() };
  }

  it("garde deux groupes distincts, chacun nommé par son propre titre", () => {
    poserDeux();

    const groupes = screen.getAllByRole("radiogroup");

    expect(groupes).toHaveLength(2);
    expect(groupes[0]).toHaveAccessibleName("Premier vélo");
    expect(groupes[1]).toHaveAccessibleName("Second vélo");
  });

  it("n'active que le sélecteur dont la dalle a été cliquée", async () => {
    // La dalle entière est l'étiquette (`<Label htmlFor>`). Avec des
    // identifiants littéraux, `htmlFor` du second pointerait sur le bouton du
    // premier : cliquer en bas de l'écran cocherait en haut.
    const { premier, second, utilisateur } = poserDeux();

    const dalles = screen.getAllByText("Moustache");
    expect(dalles).toHaveLength(2);

    await utilisateur.click(dalles[1] as HTMLElement);

    expect(second).toHaveBeenCalledWith(4);
    expect(premier).not.toHaveBeenCalled();
  });
});
