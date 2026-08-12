// Bascule d'affichage du mot de passe - chantier 4 de l'audit du 2026-08-12.
//
// Le composant naît d'un dédoublonnage, et **les deux copies ne se comportaient
// pas pareil** : la connexion portait un `aria-label` changeant, l'inscription
// un `aria-pressed` plus un `sr-only` changeant. Ce fichier fixe le traitement
// retenu, sans quoi la prochaine surface en inventerait un troisième.
//
// ⚠️ Aucun test n'éprouvait la version de l'inscription : la fusion a donc
// changé son comportement sans qu'un seul oracle ne bouge. C'est exactement ce
// que ces tests empêchent de refaire.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { BasculeMotDePasse } from "./bascule-mot-de-passe";

/// L'échafaudage porte un `<label>` : sans lui, `axe` signale « Form elements
/// must have labels » sur l'input du DÉCOR, et le test rougirait pour un défaut
/// qui n'est pas celui du composant.
function champ(visible: boolean, onBascule: () => void) {
  return (
    <div className="relative">
      <label htmlFor="password">Mot de passe</label>
      <input id="password" type={visible ? "text" : "password"} />
      <BasculeMotDePasse
        visible={visible}
        onBascule={onBascule}
        controle="password"
      />
    </div>
  );
}

function rendre(visible: boolean, onBascule = vi.fn()) {
  return { ...render(champ(visible, onBascule)), onBascule };
}

describe("BasculeMotDePasse", () => {
  it("annonce l'action à faire, pas l'état courant", () => {
    rendre(false);

    expect(
      screen.getByRole("button", { name: "Afficher le mot de passe" }),
    ).toBeInTheDocument();
  });

  it("change de nom accessible une fois basculée", () => {
    rendre(true);

    expect(
      screen.getByRole("button", { name: "Masquer le mot de passe" }),
    ).toBeInTheDocument();
  });

  it("ne cumule PAS `aria-pressed` avec un nom changeant", () => {
    // 🔴 La propriété qui motive le dédoublonnage. L'inscription portait les
    // deux : un lecteur d'écran y annonçait « Masquer le mot de passe, activé »,
    // soit l'état une fois par le nom et une fois par l'attribut. Les deux
    // conventions sont valides séparément, leur cumul est ambigu.
    const { rerender } = rendre(false);

    expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed");

    rerender(champ(true, vi.fn()));

    expect(screen.getByRole("button")).not.toHaveAttribute("aria-pressed");
  });

  it("porte `type=button`, sinon révéler son mot de passe soumet le formulaire", () => {
    // Un `<button>` sans type vaut `submit`. Le défaut est piégeux : le
    // formulaire partirait avec le mot de passe en clair à l'écran.
    rendre(false);

    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("désigne le champ qu'elle pilote", () => {
    rendre(false);

    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-controls",
      "password",
    );
  });

  it("bascule au clic et au clavier", async () => {
    const utilisateur = userEvent.setup();
    const { onBascule } = rendre(false);

    await utilisateur.click(screen.getByRole("button"));
    expect(onBascule).toHaveBeenCalledOnce();

    // Le clic laisse le focus sur le bouton : `Entrée` l'actionne sans qu'il
    // faille tabuler, et tabuler l'en ferait sortir - c'est le dernier élément
    // focusable du décor.
    expect(screen.getByRole("button")).toHaveFocus();
    await utilisateur.keyboard("{Enter}");
    expect(onBascule).toHaveBeenCalledTimes(2);

    await utilisateur.keyboard(" ");
    expect(onBascule).toHaveBeenCalledTimes(3);
  });

  it("masque ses icônes au lecteur d'écran", () => {
    // Le nom vient de `aria-label` : une icône annoncée en plus le dirait deux
    // fois, comme le faisait la version de l'inscription avec son `sr-only`.
    const { container } = rendre(true);

    for (const svg of container.querySelectorAll("svg")) {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("ne présente aucune violation, dans les deux états", async () => {
    const masque = rendre(false);
    await expect(axe(masque.container)).resolves.toHaveNoViolations();
    masque.unmount();

    const visible = rendre(true);
    await expect(axe(visible.container)).resolves.toHaveNoViolations();
  });
});
