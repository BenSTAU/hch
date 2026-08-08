// Formulaire d'inscription — `US-COMPTE-CREER` §Accessibilité AA v1.
//
// C'est l'un des deux écrans que la SPEC §6.3.2 place au niveau **AA**, quand
// tout le reste de la v1 est au niveau A, au motif que c'est un point d'entrée.
// Les critères AA de cet écran sont plus exigeants que ceux de la connexion :
// erreurs liées champ par champ (3.3.1), focus déplacé sur le premier champ
// fautif (3.3.3), règles du mot de passe annoncées AVANT la soumission (3.3.2).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

const signupFormAction = vi.fn();
vi.mock("@/lib/actions/auth/signup", () => ({
  signupFormAction: (prevState: unknown, formData: FormData) =>
    signupFormAction(prevState, formData),
}));

const { SignupForm } = await import("./signup-form");

const CHAMPS = {
  firstname: "Prénom",
  lastname: "Nom",
  email: "Adresse email",
  password: "Mot de passe",
  passwordConfirmation: "Confirmer le mot de passe",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  signupFormAction.mockResolvedValue({});
});

async function remplirEtSoumettre(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByLabelText(CHAMPS.firstname), "Camille");
  await user.type(screen.getByLabelText(CHAMPS.lastname), "Durand");
  await user.type(screen.getByLabelText(CHAMPS.email), "camille@example.test");
  await user.type(
    screen.getByLabelText(CHAMPS.password),
    "un-mot-de-passe-long",
  );
  await user.type(
    screen.getByLabelText(CHAMPS.passwordConfirmation),
    "un-mot-de-passe-long",
  );
  await user.click(screen.getByRole("button", { name: "Créer mon compte" }));
}

describe("SignupForm — structure accessible", () => {
  it("associe un label explicite à chacun des cinq champs", () => {
    // WCAG 3.3.2 (A), RGAA 11.1. `getByLabelText` échoue si l'association
    // `<label for>` ↔ `id` manque — c'est le test, pas un détour.
    render(<SignupForm />);

    for (const label of Object.values(CHAMPS)) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("renseigne les `autocomplete` attendus", () => {
    // WCAG 1.3.5 (AA). `new-password` et non `current-password` : c'est ce qui
    // fait proposer un mot de passe fort au gestionnaire, au lieu de remplir
    // celui d'un autre compte.
    render(<SignupForm />);

    expect(screen.getByLabelText(CHAMPS.firstname)).toHaveAttribute(
      "autocomplete",
      "given-name",
    );
    expect(screen.getByLabelText(CHAMPS.lastname)).toHaveAttribute(
      "autocomplete",
      "family-name",
    );
    expect(screen.getByLabelText(CHAMPS.email)).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText(CHAMPS.password)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(screen.getByLabelText(CHAMPS.passwordConfirmation)).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("annonce la règle des 12 caractères AVANT toute soumission", () => {
    // WCAG 3.3.2 (AA), exigé mot pour mot par la SPEC
    // (module-1-utilisateurs.md:192) : « affichées **avant** la soumission et
    // associées au champ via `aria-describedby` ». Un message qui n'apparaît
    // qu'après l'échec fait deviner la règle.
    render(<SignupForm />);

    const champ = screen.getByLabelText(CHAMPS.password);
    const decrits = champ.getAttribute("aria-describedby")?.split(/\s+/) ?? [];

    expect(decrits.length).toBeGreaterThan(0);
    const textes = decrits
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(textes).toContain("12 caractères");
  });

  it("poste par `action` et non par `onSubmit`", () => {
    // Leçon T-J0-04 : un `<form>` sans attribut `action` se soumet NATIVEMENT en
    // GET tant que React n'a pas hydraté — tous les champs en query string, mots
    // de passe compris, donc dans l'historique, les journaux nginx et le
    // `Referer`.
    render(<SignupForm />);

    const form = screen
      .getByRole("button", { name: "Créer mon compte" })
      .closest("form");
    expect(form).toHaveAttribute("action");
  });

  it("ne porte aucune violation détectable par axe-core", async () => {
    // DoD T-V3-02 : « `jest-axe` : zéro violation sur la page d'inscription ».
    // axe-core en jsdom ne mesure pas les contrastes — c'est
    // `@axe-core/playwright` qui le fait, au navigateur, sur les golden paths.
    const { container } = render(<SignupForm />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});

describe("SignupForm — soumission", () => {
  it("transmet les cinq champs à l'action", async () => {
    const user = userEvent.setup();
    render(<SignupForm />);

    await remplirEtSoumettre(user);

    await waitFor(() => expect(signupFormAction).toHaveBeenCalledOnce());
    const [, formData] = signupFormAction.mock.calls[0] as [unknown, FormData];
    expect(formData.get("firstname")).toBe("Camille");
    expect(formData.get("email")).toBe("camille@example.test");
    expect(formData.get("passwordConfirmation")).toBe("un-mot-de-passe-long");
  });

  it("désactive le bouton pendant la soumission", async () => {
    // Sans ça, un double clic produit deux inscriptions concurrentes pour le
    // même email, dont l'une échouera sur l'index unique — en 500.
    let resoudre: (state: unknown) => void = () => {};
    signupFormAction.mockImplementation(
      () => new Promise((r) => (resoudre = r)),
    );
    const user = userEvent.setup();
    render(<SignupForm />);

    await remplirEtSoumettre(user);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Création/ })).toBeDisabled(),
    );
    resoudre({});
  });
});

describe("SignupForm — restitution des erreurs", () => {
  const ERREURS = {
    fieldErrors: {
      email: "Email invalide",
      password: "Mot de passe : 12 caractères minimum",
    },
    values: { firstname: "Camille", lastname: "Durand", email: "pas-un-email" },
  };

  it("lie chaque message d'erreur à son champ par `aria-describedby`", async () => {
    // WCAG 3.3.1 (AA). Un message affiché à côté du champ mais non associé n'est
    // pas lu par un lecteur d'écran au moment où il compte.
    signupFormAction.mockResolvedValue(ERREURS);
    const user = userEvent.setup();
    render(<SignupForm />);

    await remplirEtSoumettre(user);

    await waitFor(() => {
      const champ = screen.getByLabelText(CHAMPS.email);
      const decrits =
        champ.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
      const textes = decrits
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      expect(textes).toContain("Email invalide");
    });
  });

  it("marque les champs fautifs `aria-invalid`", async () => {
    signupFormAction.mockResolvedValue(ERREURS);
    const user = userEvent.setup();
    render(<SignupForm />);

    await remplirEtSoumettre(user);

    await waitFor(() =>
      expect(screen.getByLabelText(CHAMPS.email)).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(screen.getByLabelText(CHAMPS.firstname)).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("déplace le focus sur le PREMIER champ fautif", async () => {
    // WCAG 3.3.3 (AA). L'ordre suit le formulaire, pas l'ordre des clés de
    // l'objet d'erreurs : ici `email` précède `password`.
    signupFormAction.mockResolvedValue(ERREURS);
    const user = userEvent.setup();
    render(<SignupForm />);

    await remplirEtSoumettre(user);

    await waitFor(() =>
      expect(screen.getByLabelText(CHAMPS.email)).toHaveFocus(),
    );
  });

  it("annonce les erreurs dans une région live", async () => {
    // WCAG 4.1.3. Sans elle, un lecteur d'écran ne signale rien : la page n'a
    // pas changé d'adresse et le focus vient d'ailleurs.
    signupFormAction.mockResolvedValue(ERREURS);
    const user = userEvent.setup();
    render(<SignupForm />);

    await remplirEtSoumettre(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/./),
    );
  });

  it("réaffiche prénom, nom et email, mais jamais les mots de passe", async () => {
    // Refaire saisir cinq champs pour une virgule est un défaut
    // d'utilisabilité ; réafficher un mot de passe le remet dans le HTML de la
    // réponse, donc dans le cache du navigateur.
    signupFormAction.mockResolvedValue(ERREURS);
    const user = userEvent.setup();
    render(<SignupForm />);

    await remplirEtSoumettre(user);

    await waitFor(() =>
      expect(screen.getByLabelText(CHAMPS.firstname)).toHaveValue("Camille"),
    );
    expect(screen.getByLabelText(CHAMPS.email)).toHaveValue("pas-un-email");
    expect(screen.getByLabelText(CHAMPS.password)).toHaveValue("");
    expect(screen.getByLabelText(CHAMPS.passwordConfirmation)).toHaveValue("");
  });

  it("affiche l'échec d'envoi d'email comme une erreur de formulaire", async () => {
    // ADR-017 : bruyant. C'est ici que « bruyant » devient visible pour la
    // personne qui vient de s'inscrire.
    signupFormAction.mockResolvedValue({
      error: "L'email d'activation n'a pas pu être envoyé.",
    });
    const user = userEvent.setup();
    render(<SignupForm />);

    await remplirEtSoumettre(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "L'email d'activation n'a pas pu être envoyé.",
      ),
    );
  });
});
