// Formulaire de connexion — ajouté par l'agent testeur.
//
// Le formulaire n'avait aucun test, alors qu'il porte les critères
// d'accessibilité les plus contraignants du projet : la SPEC §6.3.2 place la
// connexion au niveau **AA**, quand tout le reste de la v1 est au niveau A,
// au motif que c'est le point d'entrée absolu de l'application.
//
// Les tests ci-dessous vérifient à la main ce qu'un audit outillé vérifie.
// `jest-axe` est posé depuis T-J0-09 et couvre cet écran en E2E, au navigateur
// — le seul endroit où les contrastes se mesurent vraiment.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

// C'est `loginFormAction` que le formulaire référence depuis T-J0-04 fix :
// `useActionState` l'appelle avec `(prevState, formData)`, et c'est cette
// signature qui rend la soumission fonctionnelle avant hydratation.
const loginFormAction = vi.fn();
vi.mock("@/lib/actions/auth/login", () => ({
  loginFormAction: (prevState: unknown, formData: FormData) =>
    loginFormAction(prevState, formData),
}));

const { LoginForm } = await import("./login-form");
const { LOGIN_REFUSED_MESSAGE, LOGIN_RATE_LIMITED_MESSAGE } =
  await import("@/lib/validations/auth");

// Sans ça les appels s'accumulent d'un test à l'autre et toute assertion de
// CARDINALITÉ devient fausse — défaut de ce fichier, corrigé après l'avoir
// constaté (le test « touche Entrée » comptait 8 appels au lieu de 1).
beforeEach(() => vi.clearAllMocks());

/// Remplit les deux champs et soumet. Les champs portent `required` : sans
/// valeurs, la validation native du navigateur bloque la soumission avant que
/// React ne voie l'événement.
async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Adresse email"),
    "admin@homecyclhome.fr",
  );
  await user.type(screen.getByLabelText("Mot de passe"), "un-mot-de-passe");
  await user.click(screen.getByRole("button", { name: "Se connecter" }));
}

describe("LoginForm — structure accessible", () => {
  it("associe un label explicite à chaque champ", () => {
    // WCAG 3.3.2 (A), RGAA 11.1. `getByLabelText` échoue si l'association
    // `<label for>` ↔ `id` est absente — c'est le test, pas un détour.
    render(<LoginForm />);

    expect(screen.getByLabelText("Adresse email")).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByLabelText("Mot de passe")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("renseigne les `autocomplete` attendus", () => {
    // WCAG 1.3.5 (AA) « Identify Input Purpose », exigé nommément par
    // US-COMPTE-CONNECTER §Accessibilité AA v1.
    render(<LoginForm />);

    expect(screen.getByLabelText("Adresse email")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("Mot de passe")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("expose un bouton de soumission nommé", () => {
    render(<LoginForm />);
    expect(
      screen.getByRole("button", { name: "Se connecter" }),
    ).toBeInTheDocument();
  });

  it("suit un ordre de tabulation logique et sans piège", () => {
    // WCAG 2.1.1 + 2.1.2 (A) : on traverse tout le formulaire au clavier et
    // on en ressort.
    //
    // ⚠️ Oracle ÉLARGI en T-V3-03, pas affaibli. Le portage de l'écran C6 pose
    // deux commandes supplémentaires que le formulaire du jalon 0 n'avait
    // pas — la bascule d'affichage du mot de passe et le lien « Mot de passe
    // oublié ? », ce dernier exigé nommément par US-COMPTE-CONNECTER
    // §Accessibilité AA (WCAG 2.4.6). L'ancien oracle décrivait trois arrêts
    // et devenait faux ; celui-ci décrit les cinq, dans l'ordre du document.
    render(<LoginForm />);
    const user = userEvent.setup();

    return (async () => {
      await user.tab();
      expect(screen.getByLabelText("Adresse email")).toHaveFocus();
      await user.tab();
      expect(screen.getByLabelText("Mot de passe")).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole("button", { name: /Afficher le mot de passe/i }),
      ).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole("link", { name: /Mot de passe oublié/i }),
      ).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole("button", { name: "Se connecter" }),
      ).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole("button", { name: "Se connecter" }),
      ).not.toHaveFocus();
    })();
  });

  it("expose le lien « Mot de passe oublié ? » vers le parcours de reset", () => {
    // WCAG 2.4.6 (AA), exigé nommément par US-COMPTE-CONNECTER §Accessibilité,
    // et pointé par US-COMPTE-MOT-DE-PASSE-OUBLIE §Cas nominal comme unique
    // point d'entrée du parcours. La page est livrée par T-V3-05 : d'ici là le
    // lien mène à un 404, même précédent que la mention RGPD de T-V3-02.
    render(<LoginForm />);

    expect(
      screen.getByRole("link", { name: /Mot de passe oublié/i }),
    ).toHaveAttribute("href", "/mot-de-passe-oublie");
  });

  it("ne porte pas de case « Se souvenir de moi »", () => {
    // La maquette C6 en pose une ; aucun critère d'acceptation ne la prescrit,
    // et ADR-005 v2 fixe la session à 7 jours fermes — la case n'aurait donc
    // rien à commander. Arbitré le 2026-08-09, même raisonnement que la case
    // CGV non portée en T-V3-02.
    render(<LoginForm />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Se souvenir/i)).not.toBeInTheDocument();
  });
});

describe("LoginForm — affichage du mot de passe", () => {
  // Commande de la maquette C6, conservée au portage : elle sert directement
  // la saisie sur mobile, où une faute de frappe invisible est le premier
  // motif d'échec de connexion.

  it("bascule le champ en texte, puis le remasque", async () => {
    render(<LoginForm />);
    const user = userEvent.setup();

    const champ = screen.getByLabelText("Mot de passe");
    expect(champ).toHaveAttribute("type", "password");

    await user.click(
      screen.getByRole("button", { name: /Afficher le mot de passe/i }),
    );
    expect(screen.getByLabelText("Mot de passe")).toHaveAttribute(
      "type",
      "text",
    );

    await user.click(
      screen.getByRole("button", { name: /Masquer le mot de passe/i }),
    );
    expect(screen.getByLabelText("Mot de passe")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("ne soumet pas le formulaire en basculant", async () => {
    // Un `<button>` sans `type` vaut `type="submit"` : sans l'attribut
    // explicite, révéler son mot de passe enverrait le formulaire.
    loginFormAction.mockResolvedValue({});
    render(<LoginForm />);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: /Afficher le mot de passe/i }),
    );

    expect(loginFormAction).not.toHaveBeenCalled();
  });
});

describe("LoginForm — plafond d'échecs", () => {
  // « formulaire bloqué en front ET serveur » (US-COMPTE-CONNECTER §Cas
  // d'erreur). Le serveur refuse dans tous les cas ; le blocage côté front
  // évite de laisser marteler un bouton qui ne peut plus rien produire.

  it("annonce le message de plafond dans la région `alert`", async () => {
    loginFormAction.mockResolvedValue({
      error: LOGIN_RATE_LIMITED_MESSAGE,
      blocked: true,
    });
    render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        LOGIN_RATE_LIMITED_MESSAGE,
      ),
    );
  });

  it("désactive le bouton une fois le plafond atteint", async () => {
    loginFormAction.mockResolvedValue({
      error: LOGIN_RATE_LIMITED_MESSAGE,
      blocked: true,
    });
    render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Se connecter/ }),
      ).toBeDisabled(),
    );
  });

  it("laisse le bouton actif sur un refus ordinaire", async () => {
    // Le refus générique n'est pas un blocage : la personne doit pouvoir
    // corriger sa saisie et réessayer immédiatement.
    loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
    render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toBeEmptyDOMElement(),
    );
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeEnabled();
  });
});

describe("LoginForm — refus", () => {
  it("annonce le message générique dans une région `alert`", async () => {
    // WCAG 4.1.3 (AA) « Status Messages ». `role="alert"` porte un
    // `aria-live="assertive"` implicite : le lecteur d'écran annonce le
    // message sans que l'utilisateur ait à aller le chercher.
    loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
    render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        LOGIN_REFUSED_MESSAGE,
      ),
    );
  });

  it("ramène le focus sur le premier champ après un refus", async () => {
    // WCAG 3.3.3 (AA), exigé nommément par US-COMPTE-CONNECTER.
    loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
    render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);

    await waitFor(() =>
      expect(screen.getByLabelText("Adresse email")).toHaveFocus(),
    );
  });

  it("affiche le même message quelle que soit la cause du refus", async () => {
    // L'action renvoie déjà un message unique. Ce test garde la frontière
    // côté client : c'est ici qu'une « amélioration » d'ergonomie du genre
    // « cet email nous est inconnu » se glisserait.
    const messages: string[] = [];

    for (const _cause of ["email inconnu", "mot de passe faux", "désactivé"]) {
      loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
      const view = render(<LoginForm />);
      const user = userEvent.setup();

      await submit(user);
      await waitFor(() =>
        expect(screen.getByRole("alert")).not.toBeEmptyDOMElement(),
      );
      messages.push(screen.getByRole("alert").textContent ?? "");
      view.unmount();
    }

    expect(new Set(messages).size).toBe(1);
  });

  it("ne laisse fuir aucun détail technique sur une erreur serveur", async () => {
    // `handleServerError` remplace déjà le détail côté serveur
    // (src/lib/safe-action.ts:13-16). Ce test vérifie que le formulaire
    // affiche ce qu'on lui donne sans rien reconstituer.
    loginFormAction.mockResolvedValue({
      error: "Une erreur est survenue. Réessayez dans un instant.",
    });
    render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Une erreur est survenue. Réessayez dans un instant.",
      ),
    );
    expect(screen.getByRole("alert").textContent).not.toMatch(
      /prisma|postgres|localhost|5433|P\d{4}/i,
    );
  });

  it("ne conserve pas le mot de passe saisi dans le DOM après un refus", async () => {
    // Le champ garde sa valeur — comportement natif attendu, l'utilisateur
    // doit pouvoir corriger seulement l'email. On vérifie en revanche que la
    // valeur n'est pas recopiée ailleurs (attribut `value` sérialisé, message
    // d'erreur, champ caché).
    loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
    const { container } = render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);
    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toBeEmptyDOMElement(),
    );

    expect(container.innerHTML).not.toContain("un-mot-de-passe");
  });
});

// Audit outillé des ÉTATS du formulaire — ajout de l'agent testeur.
//
// `connexion-view.test.tsx` couvre l'écran au repos ; ce qu'il ne peut pas
// couvrir, c'est ce que le formulaire devient APRÈS une soumission, parce que
// ces états ne naissent que d'un aller-retour avec l'action. Or ce sont eux qui
// portent les critères AA propres à `US-COMPTE-CONNECTER` §Accessibilité :
// région live annoncée, focus déplacé, commande désactivée.
describe("LoginForm — audit jest-axe des états", () => {
  it("ne présente aucune violation au repos", async () => {
    const { container } = render(<LoginForm />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation après un refus", async () => {
    loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
    const { container } = render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);
    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toBeEmptyDOMElement(),
    );

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation une fois le plafond atteint", async () => {
    // L'état le moins audité de tous : il n'apparaît qu'à la 6ᵉ soumission. Le
    // bouton y est `disabled`, donc RETIRÉ de l'ordre de tabulation — et c'est
    // le moment où il faut vérifier que le message qui l'explique reste, lui,
    // annoncé et atteignable.
    loginFormAction.mockResolvedValue({
      error: LOGIN_RATE_LIMITED_MESSAGE,
      blocked: true,
    });
    const { container } = render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Se connecter/ })).toBeDisabled(),
    );

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation le mot de passe démasqué", async () => {
    // La bascule change le `type` du champ ET le nom accessible du bouton. Un
    // `aria-label` oublié sur l'un des deux états laisserait un bouton anonyme.
    const { container } = render(<LoginForm />);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: /Afficher le mot de passe/i }),
    );

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});

describe("LoginForm — soumission", () => {
  it("se soumet à la touche Entrée, sans passer par la souris", async () => {
    // WCAG 2.1.1 (A) : tout ce qui se fait à la souris doit se faire au
    // clavier. Le formulaire pose `action={formAction}` : c'est l'événement
    // `submit` natif qui reste le déclencheur, et la touche Entrée doit
    // continuer de le produire.
    loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
    render(<LoginForm />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Adresse email"),
      "admin@homecyclhome.fr",
    );
    await user.type(
      screen.getByLabelText("Mot de passe"),
      "un-mot-de-passe{Enter}",
    );

    await waitFor(() => expect(loginFormAction).toHaveBeenCalledOnce());
  });

  it("transmet les identifiants saisis à la Server Action", async () => {
    loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
    render(<LoginForm />);
    const user = userEvent.setup();

    await submit(user);

    // Un `FormData` et non un objet : c'est ce que `useActionState` passe, et
    // c'est ce qui permet au navigateur de soumettre sans JavaScript.
    await waitFor(() => expect(loginFormAction).toHaveBeenCalledOnce());
    const formData = loginFormAction.mock.calls[0]?.[1] as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("email")).toBe("admin@homecyclhome.fr");
    expect(formData.get("password")).toBe("un-mot-de-passe");
  });

  it("porte `next` dans un champ caché, pas dans une prop", async () => {
    // Une prop de composant ne traverse pas une soumission native : sans ce
    // champ, la destination serait perdue dès que React n'a pas hydraté.
    loginFormAction.mockResolvedValue({ error: LOGIN_REFUSED_MESSAGE });
    render(<LoginForm next="/admin/parametres" />);
    const user = userEvent.setup();

    await submit(user);

    await waitFor(() => expect(loginFormAction).toHaveBeenCalledOnce());
    const formData = loginFormAction.mock.calls[0]?.[1] as FormData;
    expect(formData.get("next")).toBe("/admin/parametres");
  });
});
