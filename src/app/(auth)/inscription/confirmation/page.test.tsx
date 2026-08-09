// Écran de sortie de l'inscription — la porte d'entrée du parcours
// d'activation, et le seul écran que voit une personne qui vient de créer son
// compte.
//
// Il n'avait aucun test : la barrière E2E ne l'observe que par son titre
// (« Vérifiez votre email »), qui sert d'oracle d'anti-énumération. Ce qu'il
// PROPOSE ensuite n'était vérifié nulle part — et c'est justement là qu'une
// consigne fausse est passée, signalée à l'usage par Benjamin le 2026-08-09.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

const { default: ConfirmationInscriptionPage } = await import("./page");

describe("écran de confirmation d'inscription", () => {
  it("porte un H1 unique et nommé", () => {
    render(<ConfirmationInscriptionPage />);

    const titres = screen.getAllByRole("heading", { level: 1 });
    expect(titres).toHaveLength(1);
    expect(titres[0]).toHaveTextContent(/Vérifiez votre email/i);
  });

  it("répond la même chose quelle que soit l'issue de l'inscription", () => {
    // Écran de sortie UNIQUE des trois issues — email libre, compte non activé,
    // compte déjà activé. Il ne prend aucune prop : c'est ce qui rend
    // l'énumération impossible, et c'est vérifiable ici par sa signature.
    expect(ConfirmationInscriptionPage.length).toBe(0);
  });

  it("mène au renvoi d'un email d'activation", () => {
    // La consigne précédente disait « demandez un nouvel envoi depuis le lien
    // d'activation expiré ou la page de connexion » : circulaire pour qui n'a
    // rien reçu — donc aucun lien sous la main — et la page de connexion
    // n'offrait alors aucune entrée vers le renvoi. T-V3-03 en pose une, cet
    // écran pointe droit dessus.
    render(<ConfirmationInscriptionPage />);

    expect(
      screen.getByRole("link", { name: /Renvoyer un email d'activation/i }),
    ).toHaveAttribute("href", "/activation?renvoi=1");
  });

  it("ne renvoie plus vers un lien que la personne n'a pas", () => {
    render(<ConfirmationInscriptionPage />);

    expect(
      screen.queryByText(/lien d'activation expiré/i),
    ).not.toBeInTheDocument();
  });

  it("garde l'accès à la connexion", () => {
    render(<ConfirmationInscriptionPage />);

    expect(
      screen.getByRole("link", { name: /Aller à la page de connexion/i }),
    ).toHaveAttribute("href", "/connexion");
  });

  it("ne présente aucune violation jest-axe", async () => {
    const { container } = render(<ConfirmationInscriptionPage />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
