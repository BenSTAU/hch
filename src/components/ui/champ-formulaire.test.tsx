// Pièce « champs » du patron d'administration, créée sur le constat F1 de la
// session vérificatrice : la DoD 8 de T-B1-01 en nomme trois (tableau, champs,
// aide à l'audit) et il n'y en avait que deux. Le triplet label plus contrôle
// plus message d'erreur était recopié quatre fois dans un seul formulaire.
//
// Ce que ces tests figent est exactement ce que la duplication menaçait :
// le câblage `aria-invalid` / `aria-describedby`. Onze écrans vont en hériter,
// et une copie qui perd un attribut ne casse rien de visible - elle rend juste
// le champ muet au lecteur d'écran.
import { axe } from "jest-axe";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ChampTexte, ChampZoneTexte } from "./champ-formulaire";

describe("ChampTexte, étiquetage", () => {
  it("lie le label au contrôle par son `id`", () => {
    render(<ChampTexte id="label" libelle="Nom du forfait" erreurs={[]} />);

    expect(screen.getByLabelText("Nom du forfait")).toBeInTheDocument();
  });

  it("répand les props de saisie sur le contrôle", () => {
    render(
      <ChampTexte
        id="price"
        libelle="Prix TTC"
        erreurs={[]}
        name="price"
        inputMode="decimal"
        defaultValue="85.00"
        required
      />,
    );

    const champ = screen.getByLabelText("Prix TTC");
    expect(champ).toHaveAttribute("name", "price");
    expect(champ).toHaveAttribute("inputmode", "decimal");
    expect(champ).toBeRequired();
    expect(champ).toHaveValue("85.00");
  });

  it("pose `className` sur le conteneur, pas sur le contrôle", () => {
    // La largeur du bloc est ce que les mises en page en colonnes règlent.
    // Posée sur l'`<input>`, elle ne ferait rien d'utile et écraserait
    // silencieusement les classes de la primitive.
    render(
      <ChampTexte
        id="duration"
        libelle="Durée"
        erreurs={[]}
        className="flex-1"
      />,
    );

    expect(screen.getByLabelText("Durée")).not.toHaveClass("flex-1");
  });
});

describe("ChampTexte, câblage de l'erreur", () => {
  it("décrit le contrôle par son emplacement d'erreur, même vide", () => {
    // L'emplacement reste dans le flux : une zone de message révélée en même
    // temps que son contenu n'est pas annoncée de façon fiable.
    const { container } = render(
      <ChampTexte id="label" libelle="Nom du forfait" erreurs={[]} />,
    );

    expect(screen.getByLabelText("Nom du forfait")).toHaveAttribute(
      "aria-describedby",
      "label-erreur",
    );
    expect(container.querySelector("#label-erreur")).toBeInTheDocument();
  });

  it("n'affirme rien tant que le champ est sain", () => {
    // `aria-invalid="false"` est une affirmation de plus à relire : l'attribut
    // doit disparaître du DOM, pas valoir « non ».
    render(<ChampTexte id="label" libelle="Nom du forfait" erreurs={[]} />);

    expect(screen.getByLabelText("Nom du forfait")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("marque le champ et rend le message quand une erreur arrive", () => {
    render(
      <ChampTexte
        id="label"
        libelle="Nom du forfait"
        erreurs={["Le nom est requis"]}
      />,
    );

    expect(screen.getByLabelText("Nom du forfait")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("Le nom est requis")).toBeInTheDocument();
  });

  it("rend toutes les erreurs du champ, pas seulement la première", () => {
    // Zod rend un tableau par champ. N'en afficher qu'une ferait corriger une
    // saisie fautive en deux allers-retours au lieu d'un.
    render(
      <ChampTexte
        id="price"
        libelle="Prix TTC"
        erreurs={["Le prix doit être un nombre positif", "Deux décimales"]}
      />,
    );

    expect(
      screen.getByText("Le prix doit être un nombre positif Deux décimales"),
    ).toBeInTheDocument();
  });
});

describe("ChampZoneTexte", () => {
  it("rend une zone de texte câblée comme un champ simple", () => {
    render(
      <ChampZoneTexte
        id="description"
        libelle="Description"
        erreurs={["Trop long"]}
        rows={4}
      />,
    );

    const champ = screen.getByLabelText("Description");
    expect(champ.tagName).toBe("TEXTAREA");
    expect(champ).toHaveAttribute("rows", "4");
    expect(champ).toHaveAttribute("aria-describedby", "description-erreur");
    expect(champ).toHaveAttribute("aria-invalid", "true");
  });
});

describe("champ-formulaire, audit outillé", () => {
  it("ne présente aucune violation axe, champ sain", async () => {
    const { container } = render(
      <ChampTexte id="label" libelle="Nom du forfait" erreurs={[]} />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });

  it("ne présente aucune violation axe, champ en erreur", async () => {
    const { container } = render(
      <ChampZoneTexte
        id="description"
        libelle="Description"
        erreurs={["Trop long"]}
      />,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur la PR de fond de
// T-B1-01, constat F1.
// ─────────────────────────────────────────────────────────────────────────

/// Ce qu'un appelant tenterait de passer s'il contournait le type. `id`,
/// `aria-invalid` et `aria-describedby` sont retirés de la surface de props :
/// la tentative échoue à la compilation, d'où le cast - et c'est bien le
/// RUNTIME qu'on exerce ici.
const propsRetirees = {
  "aria-invalid": false,
  "aria-describedby": "une-autre-zone",
} as unknown as Partial<ComponentProps<typeof ChampTexte>>;

describe("champ-formulaire, le câblage gagne contre l'appelant", () => {
  // ⚠️ **La propriété centrale de la pièce, et elle n'était pas testée.**
  //
  // Le module revendique que le câblage est appliqué APRÈS les props de
  // l'appelant « donc il gagne ». Le type retire les trois props de la
  // surface, ce qui arrête un appelant de bonne foi ; il n'arrête ni un
  // `satisfies` mal placé, ni un spread de props typées large, ni un futur
  // refactor qui inverserait les deux spreads dans `ChampTexte`. Onze écrans
  // d'administration vont hériter de cette pièce, et un attribut perdu ne
  // casse rien de visible : il rend le champ muet au lecteur d'écran.

  it("n'accepte pas qu'on éteigne `aria-invalid` sur un champ en erreur", () => {
    render(
      <ChampTexte
        id="label"
        libelle="Nom du forfait"
        erreurs={["Le nom est requis"]}
        {...propsRetirees}
      />,
    );

    expect(screen.getByLabelText("Nom du forfait")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("n'accepte pas qu'on détourne `aria-describedby` ailleurs", () => {
    // Le détournement est le pire des deux : l'attribut reste présent, donc
    // rien ne paraît manquer, et il désigne une zone qui ne porte pas le
    // message de validation.
    render(
      <ChampTexte
        id="label"
        libelle="Nom du forfait"
        erreurs={["Le nom est requis"]}
        {...propsRetirees}
      />,
    );

    expect(screen.getByLabelText("Nom du forfait")).toHaveAttribute(
      "aria-describedby",
      "label-erreur",
    );
  });

  it("n'accepte pas qu'on allume `aria-invalid` sur un champ sain", () => {
    // L'autre sens : le câblage impose l'ABSENCE de l'attribut quand il n'y a
    // pas d'erreur, et un appelant ne doit pas pouvoir affirmer le contraire.
    render(
      <ChampTexte
        id="label"
        libelle="Nom du forfait"
        erreurs={[]}
        {...({ "aria-invalid": true } as unknown as Partial<
          ComponentProps<typeof ChampTexte>
        >)}
      />,
    );

    expect(screen.getByLabelText("Nom du forfait")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("tient la même règle sur la zone de texte", () => {
    render(
      <ChampZoneTexte
        id="description"
        libelle="Description"
        erreurs={["Trop long"]}
        {...(propsRetirees as unknown as Partial<
          ComponentProps<typeof ChampZoneTexte>
        >)}
      />,
    );

    const champ = screen.getByLabelText("Description");
    expect(champ).toHaveAttribute("aria-invalid", "true");
    expect(champ).toHaveAttribute("aria-describedby", "description-erreur");
  });

  it("laisse passer les props de saisie qui ne sont pas du câblage", () => {
    // Contre-épreuve : si le câblage écrasait tout le `...controle` au lieu des
    // trois attributs qu'il revendique, les quatre tests ci-dessus passeraient
    // pour une mauvaise raison.
    render(
      <ChampTexte
        id="label"
        libelle="Nom du forfait"
        erreurs={["Le nom est requis"]}
        name="label"
        placeholder="Révision complète"
        {...propsRetirees}
      />,
    );

    const champ = screen.getByLabelText("Nom du forfait");
    expect(champ).toHaveAttribute("name", "label");
    expect(champ).toHaveAttribute("placeholder", "Révision complète");
  });
});

describe("champ-formulaire, le message d'erreur est atteignable", () => {
  it("relie le contrôle à l'élément qui porte vraiment le message", () => {
    // `aria-describedby` peut pointer sur un `id` absent sans que rien ne le
    // signale : le lecteur d'écran n'annonce alors rien. Le test livré vérifie
    // la présence de l'élément sur un champ SAIN ; celui-ci exige en plus que
    // l'élément désigné contienne le texte du message quand il y en a un.
    render(
      <ChampTexte
        id="price"
        libelle="Prix TTC"
        erreurs={["Renseignez un montant"]}
      />,
    );

    const champ = screen.getByLabelText("Prix TTC");
    const idDecrit = champ.getAttribute("aria-describedby") ?? "";
    const decrit = document.getElementById(idDecrit);

    expect(decrit).not.toBeNull();
    expect(decrit).toHaveTextContent("Renseignez un montant");
  });
});
