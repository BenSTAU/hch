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
    // en entrant dans le groupe. Défaut mesuré sur C1 en T-V3-16, pas déduit.
    poser();

    expect(screen.getByRole("radiogroup")).toHaveAccessibleName(
      "Vélo concerné",
    );
  });
});
