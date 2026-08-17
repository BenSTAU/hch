// Formulaire de suppression de compte - `US-COMPTE-SUPPRIMER`, écran **C12**
// (bloc « Zone dangereuse »), monté ici sur sa route autonome.
//
// Ce fichier n'éprouve aucune règle métier : elles vivent dans le helper et y
// sont testées. Il éprouve ce que l'écran garantit à quelqu'un qui s'apprête à
// effacer son compte :
//
//   · **la double confirmation existe** - le champ de mot de passe n'est pas
//     atteignable sans avoir ouvert la boîte de dialogue, protection contre le
//     clic accidentel que l'US nomme explicitement ;
//   · **le déclencheur est un vrai déclencheur de dialogue** - `aria-haspopup`,
//     `aria-expanded`, focus piégé. Le manque ne serait signalé par aucun scan
//     `jest-axe` (leçon T-V3-11) ;
//   · **un refus reste lisible sur place** - rien n'a changé en base, l'écran
//     ne bouge pas, le message doit donc s'afficher à côté du champ et être
//     annoncé.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supprimerCompte = vi.fn();
vi.mock("@/lib/actions/users/supprimer-compte", () => ({
  supprimerCompte: (args: unknown) => supprimerCompte(args),
}));

const { FormulaireSuppressionCompte } =
  await import("./formulaire-suppression-compte");

function declencheur() {
  return screen.getByRole("button", { name: "Supprimer mon compte" });
}

function champMotDePasse() {
  return screen.getByLabelText(/saisissez votre mot de passe/i);
}

async function ouvrir() {
  const utilisateur = userEvent.setup();
  await utilisateur.click(declencheur());
  return utilisateur;
}

beforeEach(() => {
  vi.clearAllMocks();
  supprimerCompte.mockResolvedValue({ data: { ok: true } });
});

describe("FormulaireSuppressionCompte - la double confirmation", () => {
  it("ne présente pas le champ de mot de passe avant l'ouverture", () => {
    render(<FormulaireSuppressionCompte />);

    // C'est la protection contre le clic accidentel : un champ visible
    // d'emblée ferait de la suppression un geste à une seule étape.
    expect(
      screen.queryByLabelText(/saisissez votre mot de passe/i),
    ).not.toBeInTheDocument();
    expect(declencheur()).toBeInTheDocument();
  });

  it("annonce le déclencheur comme ouvrant une boîte de dialogue", () => {
    render(<FormulaireSuppressionCompte />);

    // `DialogTrigger` de Radix, pas un bouton nu. Sans lui, un lecteur d'écran
    // annonce un bouton ordinaire là où le geste ouvre une modale, et rien ne
    // dit qu'elle est ouverte. Aucun scan axe ne le signale.
    expect(declencheur()).toHaveAttribute("aria-haspopup", "dialog");
    expect(declencheur()).toHaveAttribute("aria-expanded", "false");
  });

  it("ouvre une modale nommée qui redit l'irréversibilité", async () => {
    render(<FormulaireSuppressionCompte />);
    await ouvrir();

    const modale = screen.getByRole("dialog");
    expect(modale).toHaveAccessibleName("Confirmation de suppression");
    expect(modale).toHaveTextContent(/irréversible/i);

    // `hidden: true` est nécessaire, et c'est en soi la preuve d'une propriété :
    // Radix pose `aria-hidden` sur tout le document hors du panneau tant qu'il
    // est ouvert, donc le déclencheur sort de l'arbre accessible. Sans cette
    // option la requête ne le trouve plus - ce qui a fait rougir ce test.
    expect(
      screen.getByRole("button", {
        name: "Supprimer mon compte",
        hidden: true,
      }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("ne promet jamais l'effacement des données", async () => {
    render(<FormulaireSuppressionCompte />);
    await ouvrir();

    // PLAN S4 §4.4 l'interdit explicitement, et la maquette C12 l'écrivait
    // (« Toutes vos données seront effacées »). Annoncer une disparition là où
    // l'opération est une pseudonymisation exposerait à un rappel CNIL.
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/effacé/i);
    expect(screen.getByRole("dialog")).toHaveTextContent(/anonymes/i);
  });

  it("demande le mot de passe COURANT au gestionnaire de mots de passe", async () => {
    render(<FormulaireSuppressionCompte />);
    await ouvrir();

    // `new-password` ferait proposer un secret inventé, qui ne confirmerait
    // rien et ferait échouer la suppression.
    expect(champMotDePasse()).toHaveAttribute(
      "autoComplete",
      "current-password",
    );
    expect(champMotDePasse()).toHaveAttribute("type", "password");
  });

  it("transmet le mot de passe saisi à l'action", async () => {
    render(<FormulaireSuppressionCompte />);
    const utilisateur = await ouvrir();

    await utilisateur.type(champMotDePasse(), "mon-secret");
    await utilisateur.click(
      screen.getByRole("button", { name: /Supprimer définitivement/ }),
    );

    expect(supprimerCompte).toHaveBeenCalledWith({ motDePasse: "mon-secret" });
  });

  it("n'envoie qu'une fois, même sur un double clic", async () => {
    // La mutation est irréversible et l'écran ne bouge pas tant que la
    // redirection serveur n'a pas répondu : un second clic pendant ce temps est
    // le geste le plus probable de quelqu'un qui hésite. Il ne doit pas
    // atteindre le réseau une seconde fois - la course des deux transactions
    // fait perdre la seconde sur l'anti-rejeu de la base
    // (`src/lib/db/queries/users.ts:104-105`), qui lève, et l'écran afficherait
    // une erreur générique sur une suppression pourtant réussie.
    //
    // L'action est tenue en vol : c'est exactement l'état dans lequel vit le
    // composant entre l'envoi et la navigation serveur.
    let repondre: (valeur: unknown) => void = () => {};
    supprimerCompte.mockImplementation(
      () =>
        new Promise((resoudre) => {
          repondre = resoudre;
        }),
    );

    render(<FormulaireSuppressionCompte />);
    const utilisateur = await ouvrir();
    await utilisateur.type(champMotDePasse(), "mon-secret");

    const confirmer = screen.getByRole("button", {
      name: /Supprimer définitivement/,
    });
    await utilisateur.click(confirmer);
    await utilisateur.click(confirmer);

    expect(supprimerCompte).toHaveBeenCalledTimes(1);
    expect(confirmer).toBeDisabled();
    // Le renoncement est fermé lui aussi : rouvrir la modale remettrait le
    // formulaire à zéro alors qu'une suppression est en vol.
    expect(
      screen.getByRole("button", { name: "Conserver mon compte" }),
    ).toBeDisabled();

    // ⚠️ Obligatoire, et ce n'est pas de l'hygiène décorative : une transition
    // React laissée en vol contamine **les tests suivants du fichier**, qui
    // rendent alors un formulaire indéfiniment « Suppression... ». Constaté en
    // écrivant ce test.
    await act(async () => {
      repondre({ data: { ok: true } });
    });
  });

  it("laisse renoncer sans rien envoyer", async () => {
    render(<FormulaireSuppressionCompte />);
    const utilisateur = await ouvrir();

    await utilisateur.click(
      screen.getByRole("button", { name: "Conserver mon compte" }),
    );

    expect(supprimerCompte).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("FormulaireSuppressionCompte - les refus", () => {
  it("affiche le refus métier à côté du champ, et le fait annoncer", async () => {
    supprimerCompte.mockResolvedValue({
      data: { ok: false, message: "Mot de passe incorrect" },
    });

    render(<FormulaireSuppressionCompte />);
    const utilisateur = await ouvrir();
    await utilisateur.type(champMotDePasse(), "faux");
    await utilisateur.click(
      screen.getByRole("button", { name: /Supprimer définitivement/ }),
    );

    const alerte = await screen.findByRole("alert");
    expect(alerte).toHaveTextContent("Mot de passe incorrect");
    // La modale reste ouverte : rien n'a changé en base, et refermer ferait
    // disparaître le message avec elle.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(champMotDePasse()).toHaveAccessibleDescription(
      "Mot de passe incorrect",
    );
    expect(champMotDePasse()).toHaveAttribute("aria-invalid", "true");
  });

  it("affiche le refus de validation rendu par le schéma", async () => {
    supprimerCompte.mockResolvedValue({
      validationErrors: {
        motDePasse: {
          _errors: ["Renseignez votre mot de passe pour confirmer"],
        },
      },
    });

    render(<FormulaireSuppressionCompte />);
    const utilisateur = await ouvrir();
    await utilisateur.click(
      screen.getByRole("button", { name: /Supprimer définitivement/ }),
    );

    // Le schéma est la seule source de ce libellé : l'écran ne le redit pas.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Renseignez votre mot de passe pour confirmer",
    );
  });

  it("affiche une panne serveur sans la confondre avec un refus", async () => {
    supprimerCompte.mockResolvedValue({
      serverError: "Une erreur est survenue. Réessayez dans un instant.",
    });

    render(<FormulaireSuppressionCompte />);
    const utilisateur = await ouvrir();
    await utilisateur.type(champMotDePasse(), "secret");
    await utilisateur.click(
      screen.getByRole("button", { name: /Supprimer définitivement/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Une erreur est survenue/,
    );
  });

  it("efface le message précédent quand on referme et rouvre", async () => {
    supprimerCompte.mockResolvedValue({
      data: { ok: false, message: "Mot de passe incorrect" },
    });

    render(<FormulaireSuppressionCompte />);
    const utilisateur = await ouvrir();
    await utilisateur.type(champMotDePasse(), "faux");
    await utilisateur.click(
      screen.getByRole("button", { name: /Supprimer définitivement/ }),
    );
    await screen.findByRole("alert");

    await utilisateur.click(
      screen.getByRole("button", { name: "Conserver mon compte" }),
    );
    await utilisateur.click(declencheur());

    // Un message d'erreur qui survit à la fermeture parlerait d'une tentative
    // que la personne a déjà abandonnée, et le champ rouvrirait déjà rempli.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(champMotDePasse()).toHaveValue("");
  });
});

describe("FormulaireSuppressionCompte - accessibilité", () => {
  it("ne présente aucune violation, déclencheur seul", async () => {
    const { container } = render(<FormulaireSuppressionCompte />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it("ne présente aucune violation, modale ouverte", async () => {
    render(<FormulaireSuppressionCompte />);
    await ouvrir();

    // Le panneau est rendu dans un portail : scanner `container` ne verrait
    // rien. C'est le document entier qu'il faut passer à axe.
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
