// Coquille de la page de connexion — tests écrits par l'agent testeur en
// T-J0-04 sur `page.tsx`, **retargés** en T-J0-05 sur `ConnexionView`.
//
// Règle du test rouge, 3ᵉ ligne du tableau (dépendance à un détail
// d'implémentation invalidé par un refactor légitime) : la page a dû devenir
// asynchrone pour lire `searchParams` — Next 16 la type `Promise` — et un RSC
// asynchrone ne se déroule pas sous RTL (ADR-014). Les oracles ci-dessous sont
// **inchangés**, seul leur sujet a bougé : tout ce qu'ils observaient vit
// désormais dans `ConnexionView`, synchrone. Aucune assertion n'a été
// affaiblie, aucun test n'a été supprimé.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/actions/auth/login", () => ({
  loginFormAction: vi.fn(),
}));

const { ConnexionView } = await import("./connexion-view");

describe("ConnexionView — repères et titres", () => {
  it("expose un repère de contenu principal", () => {
    render(<ConnexionView />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("porte un H1 unique et nommé", () => {
    // WCAG 1.3.1 (A), RGAA 9.1. Un H1 par page, et il décrit la page.
    render(<ConnexionView />);

    const titres = screen.getAllByRole("heading", { level: 1 });
    expect(titres).toHaveLength(1);
    expect(titres[0]).toHaveTextContent("Connexion");
  });

  it("ne saute aucun niveau de titre", () => {
    render(<ConnexionView />);

    const niveaux = screen
      .getAllByRole("heading")
      .map((titre) => Number(titre.tagName.slice(1)));

    expect(niveaux[0]).toBe(1);
    for (let i = 1; i < niveaux.length; i += 1) {
      expect(niveaux[i]! - niveaux[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it("monte réellement le formulaire de connexion", () => {
    // La frontière `"use client"` descend au composant feuille : la coquille
    // reste serveur, le formulaire est client, et l'assemblage doit tenir.
    render(<ConnexionView />);

    expect(screen.getByLabelText("Adresse email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Se connecter" }),
    ).toBeInTheDocument();
  });

  it("place le formulaire AVANT le panneau latéral dans le document", () => {
    // Écran C6 porté en T-V3-03 : le panneau vert passe à gauche à partir de
    // `lg` par `order`, jamais par l'ordre du DOM. C'est le formulaire que la
    // personne est venue remplir — il doit venir en premier au clavier et au
    // lecteur d'écran, et donner sa hiérarchie de titres (H1 avant H2).
    render(<ConnexionView />);

    const titres = screen.getAllByRole("heading");
    expect(titres[0]).toHaveTextContent("Connexion");
    expect(titres[0]?.tagName).toBe("H1");
  });
});

describe("ConnexionView — sorties de l'écran", () => {
  it("propose le renvoi d'un email d'activation", () => {
    // `US-COMPTE-CONNECTER` §Cas d'erreur : « un bouton “Renvoyer un email
    // d'activation” est présent en dessous du formulaire ». T-V3-02 a livré
    // l'action et le formulaire de renvoi sur l'écran C9 ; il manquait le
    // point d'entrée, seul chemin praticable pour qui n'a plus son lien.
    render(<ConnexionView />);

    expect(
      screen.getByRole("link", { name: /Renvoyer un email d'activation/i }),
    ).toHaveAttribute("href", "/activation?renvoi=1");
  });

  it("renvoie vers l'inscription", () => {
    render(<ConnexionView />);

    expect(
      screen.getByRole("link", { name: /Créer un compte/i }),
    ).toHaveAttribute("href", "/inscription");
  });
});

describe("ConnexionView — retours d'un autre parcours", () => {
  it("annonce l'activation réussie sans voler le repère d'alerte", () => {
    // `US-COMPTE-ACTIVER` §Cas nominal redirige ici avec ce message.
    // `role="status"` et non `alert` : le repère `alert` de cet écran
    // appartient au refus de connexion, et deux le rendraient ambigu.
    render(<ConnexionView activated />);

    const statut = screen.getByRole("status");
    expect(statut).toHaveTextContent(/Compte activé/i);
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("n'affiche rien de tel sur une visite ordinaire", () => {
    render(<ConnexionView />);

    expect(screen.queryByText(/Compte activé/i)).not.toBeInTheDocument();
  });
});

describe("ConnexionView — destination transmise", () => {
  it("transporte la destination jusqu'au formulaire", async () => {
    // Ajouté en T-J0-05. Le `next` traverse trois couches — page, coquille,
    // formulaire — et un maillon muet ne se verrait qu'à l'exécution, sous la
    // forme d'un utilisateur ramené au mauvais endroit après connexion.
    const { loginFormAction } = await import("@/lib/actions/auth/login");
    const userEvent = (await import("@testing-library/user-event")).default;
    vi.mocked(loginFormAction).mockResolvedValue({});

    render(<ConnexionView next="/admin/parametres?onglet=societe" />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Adresse email"),
      "admin@homecyclhome.fr",
    );
    await user.type(screen.getByLabelText("Mot de passe"), "un-mot-de-passe");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    // `next` traverse désormais un champ caché du formulaire, seule voie qui
    // survive à une soumission sans JavaScript. L'oracle porte donc sur le
    // FormData reçu, pas sur un objet de props.
    const { loginFormAction: recue } = await import("@/lib/actions/auth/login");
    const formData = vi.mocked(recue).mock.calls[0]?.[1] as FormData;
    expect(formData.get("next")).toBe("/admin/parametres?onglet=societe");
  });
});
