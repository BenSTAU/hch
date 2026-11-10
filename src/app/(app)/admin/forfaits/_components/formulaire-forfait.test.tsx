// Formulaire de forfait, **écran sans maquette** : [[maquettage]] couvre
// l'ajout (A3, en panneau latéral) mais aucun écran de modification. Ces tests
// sont donc la seule spécification que la fiche possède.
//
// Un seul composant pour l'ajout et la modification : ce qui se vérifie ici est
// qu'il se comporte comme deux écrans distincts selon qu'il reçoit un forfait
// ou non, et surtout qu'il **transporte le jeton de version** quand il en a un.
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const ajouterForfait = vi.fn();
vi.mock("@/lib/actions/forfaits/ajouter-forfait", () => ({
  ajouterForfait: (input: unknown) => ajouterForfait(input),
}));

const modifierForfaitAction = vi.fn();
vi.mock("@/lib/actions/forfaits/modifier-forfait", () => ({
  modifierForfaitAction: (input: unknown) => modifierForfaitAction(input),
}));

const { FormulaireForfait } = await import("./formulaire-forfait");

const FORFAIT = {
  id: 1,
  label: "Révision complète",
  description: "Entretien complet",
  duration: 60,
  price: "85.00",
  isActive: true,
  version: "jeton-de-la-fiche",
};

/// Remplit les trois champs `required` du formulaire d'ajout.
///
/// ⚠️ jsdom applique la **validation de contrainte HTML** : un formulaire dont
/// un champ `required` est vide n'émet jamais d'évènement `submit`, et un test
/// qui clique sans remplir n'atteint donc pas l'action. Piège silencieux - il
/// ne produit pas d'erreur, juste un `waitFor` qui expire.
async function remplir(
  utilisateur: ReturnType<typeof userEvent.setup>,
  valeurs: { label?: string; price?: string; duration?: string } = {},
) {
  await utilisateur.type(
    screen.getByLabelText("Nom du forfait"),
    valeurs.label ?? "Diagnostic",
  );
  await utilisateur.type(
    screen.getByLabelText("Prix TTC (€)"),
    valeurs.price ?? "25",
  );
  await utilisateur.type(
    screen.getByLabelText("Durée (min)"),
    valeurs.duration ?? "20",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // `useAction` appelle `.then()` sur le retour de l'action : sans valeur par
  // défaut, toute soumission échoue sur un `undefined`.
  ajouterForfait.mockResolvedValue({ data: undefined });
  modifierForfaitAction.mockResolvedValue({ data: undefined });
});

describe("FormulaireForfait, ajout", () => {
  it("part d'un formulaire vide, sans offrir la disponibilité", () => {
    // ⚠️ **Renversement assumé de T-B1-01 (constat F5).** Ce test exigeait la
    // case cochée ; `US-FORFAIT-AJOUTER` n'énumère pas ce champ et pose
    // `is_active = true` en défaut. L'offrir permettait de créer un forfait
    // déjà désactivé, état que rien ne spécifie - et la désactivation est une
    // action sur une fiche qui existe (`US-FORFAIT-MODIFIER`).
    render(<FormulaireForfait />);

    expect(screen.getByLabelText("Nom du forfait")).toHaveValue("");
    expect(
      screen.queryByLabelText("Proposé à la réservation"),
    ).not.toBeInTheDocument();
  });

  it("ne transporte aucun jeton de version", () => {
    const { container } = render(<FormulaireForfait />);

    expect(container.querySelector('input[name="version"]')).toBeNull();
  });

  it("soumet les champs saisis à l'action d'ajout", async () => {
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait />);

    await remplir(utilisateur);
    await utilisateur.click(
      screen.getByRole("button", { name: "Ajouter au catalogue" }),
    );

    await waitFor(() => {
      expect(ajouterForfait).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "Diagnostic",
          price: "25",
          duration: "20",
        }),
      );
    });
    expect(modifierForfaitAction).not.toHaveBeenCalled();
  });
});

describe("FormulaireForfait, modification", () => {
  it("affiche les valeurs de la fiche", () => {
    render(<FormulaireForfait forfait={FORFAIT} />);

    expect(screen.getByLabelText("Nom du forfait")).toHaveValue(
      "Révision complète",
    );
    expect(screen.getByLabelText("Prix TTC (€)")).toHaveValue("85.00");
    expect(screen.getByLabelText("Durée (min)")).toHaveValue("60");
  });

  it("transporte le jeton de version de la fiche ouverte", async () => {
    // Sans lui, l'enregistrement ne pourrait pas dire sur quelle version il
    // porte, et le refus de concurrence n'aurait rien à comparer.
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait forfait={FORFAIT} />);

    await utilisateur.click(
      screen.getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => {
      expect(modifierForfaitAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1, version: "jeton-de-la-fiche" }),
      );
    });
  });

  it("rappelle que les rendez-vous pris gardent leur prix et leur durée", () => {
    // `US-FORFAIT-MODIFIER` §Cas nominal le demande explicitement : sans ce
    // rappel, l'administrateur peut croire qu'il modifie des factures.
    render(<FormulaireForfait forfait={FORFAIT} />);

    expect(
      screen.getByText(/gardent leur prix et leur durée/),
    ).toBeInTheDocument();
  });

  it("permet de désactiver un forfait", async () => {
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait forfait={FORFAIT} />);

    await utilisateur.click(screen.getByLabelText("Proposé à la réservation"));
    await utilisateur.click(
      screen.getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => {
      expect(modifierForfaitAction).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  it("permet de réactiver un forfait retiré de la vente", async () => {
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait forfait={{ ...FORFAIT, isActive: false }} />);

    expect(screen.getByLabelText("Proposé à la réservation")).not.toBeChecked();

    await utilisateur.click(screen.getByLabelText("Proposé à la réservation"));
    await utilisateur.click(
      screen.getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => {
      expect(modifierForfaitAction).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
    });
  });
});

describe("FormulaireForfait, refus", () => {
  it("annonce le refus de concurrence dans une région d'alerte", async () => {
    modifierForfaitAction.mockResolvedValue({
      data: {
        error: "Ce forfait a été modifié entre-temps, rechargez la fiche",
      },
    });
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait forfait={FORFAIT} />);

    await utilisateur.click(
      screen.getByRole("button", { name: "Enregistrer" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ce forfait a été modifié entre-temps, rechargez la fiche",
    );
  });

  it("déplace le focus sur le message de refus", async () => {
    // Sans ça, un utilisateur au clavier soumet, ne voit rien bouger sous son
    // curseur, et doit remonter tout le formulaire pour trouver la cause.
    modifierForfaitAction.mockResolvedValue({
      data: { error: "Un forfait actif portant ce nom existe déjà" },
    });
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait forfait={FORFAIT} />);

    await utilisateur.click(
      screen.getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveFocus();
    });
  });

  it("marque le champ fautif et nomme l'erreur à côté de lui", async () => {
    ajouterForfait.mockResolvedValue({
      validationErrors: {
        price: { _errors: ["Le prix doit être un nombre positif"] },
      },
    });
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait />);

    // Les trois champs `required` sont remplis : jsdom applique la validation
    // de contrainte HTML, et un formulaire incomplet n'émet jamais `submit`.
    // C'est aussi le cas réel visé - une valeur refusée par Zod, pas absente.
    await remplir(utilisateur, { price: "0" });
    await utilisateur.click(
      screen.getByRole("button", { name: "Ajouter au catalogue" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Prix TTC (€)")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    });
    expect(
      screen.getByText("Le prix doit être un nombre positif"),
    ).toBeInTheDocument();
  });

  it("ne confond pas l'erreur d'un champ avec celle d'un autre", async () => {
    ajouterForfait.mockResolvedValue({
      validationErrors: {
        price: { _errors: ["Le prix doit être un nombre positif"] },
      },
    });
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait />);

    await remplir(utilisateur, { price: "0" });
    await utilisateur.click(
      screen.getByRole("button", { name: "Ajouter au catalogue" }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Prix TTC (€)")).toHaveAttribute(
        "aria-invalid",
      );
    });
    expect(screen.getByLabelText("Durée (min)")).not.toHaveAttribute(
      "aria-invalid",
    );
  });
});

describe("FormulaireForfait, accessibilité", () => {
  it("étiquette chacun de ses champs", () => {
    render(<FormulaireForfait forfait={FORFAIT} />);

    for (const champ of [
      "Nom du forfait",
      "Description",
      "Prix TTC (€)",
      "Durée (min)",
      "Proposé à la réservation",
    ]) {
      expect(screen.getByLabelText(champ)).toBeInTheDocument();
    }
  });

  it("ne présente aucune violation axe, à l'ajout comme à la modification", async () => {
    const ajout = render(<FormulaireForfait />);
    expect(await axe(ajout.container)).toHaveNoViolations();
    ajout.unmount();

    const fiche = render(<FormulaireForfait forfait={FORFAIT} />);
    expect(await axe(fiche.container)).toHaveNoViolations();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur T-B1-01.
//
// Les assertions de soumission ci-dessus passent toutes par
// `expect.objectContaining`, qui ne dit rien des champs absents : la
// **description** n'est vérifiée nulle part, ni à l'ajout ni à la
// modification. Un oubli dans la lecture du `FormData` la perdrait
// silencieusement, et la modification l'effacerait - `descriptionSchema`
// transforme la chaîne vide en `NULL`.
// ─────────────────────────────────────────────────────────────────────────

describe("FormulaireForfait, charge utile complète", () => {
  it("transporte la description saisie à l'ajout", async () => {
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait />);

    await remplir(utilisateur);
    await utilisateur.type(
      screen.getByLabelText("Description"),
      "Contrôle rapide",
    );
    await utilisateur.click(
      screen.getByRole("button", { name: "Ajouter au catalogue" }),
    );

    await waitFor(() => {
      // Charge utile EXACTE, et c'est l'oracle : `isActive` n'en fait plus
      // partie, et un champ oublié dans la lecture du `FormData` rougirait ici.
      expect(ajouterForfait).toHaveBeenCalledWith({
        label: "Diagnostic",
        description: "Contrôle rapide",
        duration: "20",
        price: "25",
      });
    });
  });

  it("transporte la description de la fiche sans la perdre", async () => {
    // Le piège : la description n'est pas `required`, elle ne bloque donc
    // aucune soumission, et son absence de la charge utile ne se verrait qu'en
    // constatant une colonne vidée en base.
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait forfait={FORFAIT} />);

    await utilisateur.click(
      screen.getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => {
      expect(modifierForfaitAction).toHaveBeenCalledWith({
        id: 1,
        version: "jeton-de-la-fiche",
        label: "Révision complète",
        description: "Entretien complet",
        duration: "60",
        price: "85.00",
        isActive: true,
      });
    });
  });

  it("transporte une description vidée, qui vaut `NULL` côté schéma", async () => {
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait forfait={FORFAIT} />);

    await utilisateur.clear(screen.getByLabelText("Description"));
    await utilisateur.click(
      screen.getByRole("button", { name: "Enregistrer" }),
    );

    await waitFor(() => {
      expect(modifierForfaitAction).toHaveBeenCalledWith(
        expect.objectContaining({ description: "" }),
      );
    });
  });

  it("n'envoie aucune disponibilité à la création", async () => {
    // ⚠️ **Renversement assumé de T-B1-01 (constat F5).** Ce test exigeait
    // l'inverse : qu'une case décochée fasse partir `isActive: false`. Le
    // champ n'existe plus à la création, et ce qui compte désormais est qu'il
    // ne se glisse pas dans la charge utile par un autre chemin - un `name`
    // resté dans le DOM, un `FormData` relu trop largement.
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait />);

    await remplir(utilisateur);
    await utilisateur.click(
      screen.getByRole("button", { name: "Ajouter au catalogue" }),
    );

    await waitFor(() => {
      expect(ajouterForfait).toHaveBeenCalledWith(
        expect.not.objectContaining({ isActive: expect.anything() }),
      );
    });
  });
});

describe("FormulaireForfait, le jeton ne se régénère pas tout seul", () => {
  it("resoumet le même jeton après un refus de concurrence", async () => {
    // Le message dit « rechargez la fiche », et c'est la seule sortie : le
    // composant ne doit PAS se rafraîchir un jeton de lui-même, ce qui
    // transformerait un refus en écrasement au second clic.
    modifierForfaitAction.mockResolvedValue({
      data: {
        error: "Ce forfait a été modifié entre-temps, rechargez la fiche",
      },
    });
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait forfait={FORFAIT} />);

    const enregistrer = screen.getByRole("button", { name: "Enregistrer" });
    await utilisateur.click(enregistrer);
    await screen.findByRole("alert");
    await utilisateur.click(enregistrer);

    await waitFor(() => {
      expect(modifierForfaitAction).toHaveBeenCalledTimes(2);
    });
    for (const appel of modifierForfaitAction.mock.calls) {
      expect(appel[0]).toMatchObject({ version: "jeton-de-la-fiche" });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur la PR de fond de
// T-B1-01, constats F1 et F5.
// ─────────────────────────────────────────────────────────────────────────

describe("FormulaireForfait, aucun reste de la case à la création", () => {
  it("ne porte aucun contrôle nommé `isActive` dans le DOM", () => {
    // ⚠️ L'oracle livré interroge le LABEL (`queryByLabelText`), et c'est
    // exactement ce qu'un reste de la case ne porterait pas : un `<input
    // type="hidden" name="isActive">` ou une case sans label passeraient
    // inaperçus, tout en remettant la clé dans le `FormData` que la
    // soumission relit.
    const { container } = render(<FormulaireForfait />);

    expect(container.querySelector('[name="isActive"]')).toBeNull();
  });

  it("la garde encore en modification, et une seule fois", () => {
    // Contre-épreuve : le sélecteur ci-dessus trouve bien quelque chose quand
    // le champ doit exister. Sans ce test, supprimer la case des DEUX
    // formulaires laisserait le précédent vert.
    const { container } = render(<FormulaireForfait forfait={FORFAIT} />);

    expect(container.querySelectorAll('[name="isActive"]')).toHaveLength(1);
  });
});

describe("FormulaireForfait, le câblage des champs survit au passage par la pièce partagée", () => {
  // ⚠️ Le constat F1 remplace quatre triplets recopiés par `ChampTexte` /
  // `ChampZoneTexte`. La pièce est testée chez elle, mais rien ne vérifiait
  // que CE formulaire en reçoit bien le câblage : un `id` mal choisi, un
  // `erreurs` non branché sur `validationErrors`, et l'attribut disparaît
  // sans que l'écran change d'apparence.
  it("marque les quatre champs refusés par Zod et les décrit par leur message", async () => {
    ajouterForfait.mockResolvedValue({
      validationErrors: {
        label: { _errors: ["Le nom est requis"] },
        description: { _errors: ["Description trop longue"] },
        price: { _errors: ["Renseignez un montant"] },
        duration: { _errors: ["Renseignez une durée"] },
      },
    });
    const utilisateur = userEvent.setup();
    render(<FormulaireForfait />);

    // Les trois champs `required` sont remplis : jsdom applique la validation
    // de contrainte HTML, et un formulaire incomplet n'émet jamais `submit`.
    // Piège déjà payé plus haut dans ce fichier - c'est bien le refus de Zod
    // qu'on exerce, pas l'absence de saisie.
    await remplir(utilisateur);
    await utilisateur.click(
      screen.getByRole("button", { name: "Ajouter au catalogue" }),
    );

    const attendus: [string, string][] = [
      ["Nom du forfait", "Le nom est requis"],
      ["Description", "Description trop longue"],
      ["Prix TTC (€)", "Renseignez un montant"],
      ["Durée (min)", "Renseignez une durée"],
    ];

    for (const [libelle, message] of attendus) {
      await waitFor(() =>
        expect(screen.getByLabelText(libelle)).toHaveAttribute(
          "aria-invalid",
          "true",
        ),
      );
      const champ = screen.getByLabelText(libelle);
      const decrit = document.getElementById(
        champ.getAttribute("aria-describedby") ?? "",
      );
      expect(decrit).toHaveTextContent(message);
    }
  });

  it("ne marque aucun champ quand l'action ne refuse rien", () => {
    render(<FormulaireForfait />);

    for (const libelle of [
      "Nom du forfait",
      "Description",
      "Prix TTC (€)",
      "Durée (min)",
    ]) {
      expect(screen.getByLabelText(libelle)).not.toHaveAttribute(
        "aria-invalid",
      );
    }
  });
});
