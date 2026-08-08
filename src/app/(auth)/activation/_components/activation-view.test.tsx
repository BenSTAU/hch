// Écran d'activation — maquette C9, `US-COMPTE-ACTIVER`.
//
// L'écran est interactif de bout en bout : il porte le bouton qui consomme le
// jeton, puis, selon l'issue, le formulaire de renvoi. La frontière
// `"use client"` est donc ce composant entier — ce n'est pas un layout, c'est le
// contenu de la page.
//
// Quatre issues à couvrir, toutes nommées par la SPEC : activé (redirection,
// invisible ici), expiré + renvoi, déjà consommé, invalide.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

const activateFormAction = vi.fn();
const resendActivationFormAction = vi.fn();
vi.mock("@/lib/actions/auth/activate", () => ({
  activateFormAction: (prevState: unknown, formData: FormData) =>
    activateFormAction(prevState, formData),
  resendActivationFormAction: (prevState: unknown, formData: FormData) =>
    resendActivationFormAction(prevState, formData),
}));

const { ActivationView } = await import("./activation-view");

const JETON = "a".repeat(43);

beforeEach(() => {
  vi.clearAllMocks();
  activateFormAction.mockResolvedValue({});
  resendActivationFormAction.mockResolvedValue({});
});

describe("ActivationView — structure", () => {
  it("expose un repère principal et un H1 unique", () => {
    render(<ActivationView token={JETON} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("ne porte aucune violation détectable par axe-core", async () => {
    const { container } = render(<ActivationView token={JETON} />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});

describe("ActivationView — le lien ne consomme pas le jeton", () => {
  it("n'appelle aucune action au rendu", () => {
    // Le point le plus important du fichier. Les webmails préchargent les liens
    // qu'ils reçoivent : consommer au rendu revient à laisser un robot activer
    // — puis brûler — le compte, et l'échec se manifeste chez le client, qui
    // n'a plus de lien valide et un jeton marqué consommé.
    render(<ActivationView token={JETON} />);

    expect(activateFormAction).not.toHaveBeenCalled();
  });

  it("demande une action explicite, portée par un bouton", () => {
    render(<ActivationView token={JETON} />);

    expect(
      screen.getByRole("button", { name: "Activer mon compte" }),
    ).toBeInTheDocument();
  });

  it("transporte le jeton par un champ caché, pas par une prop", async () => {
    // Seule voie qui survive à l'absence de JavaScript : une prop de composant
    // ne traverse pas une soumission native.
    const user = userEvent.setup();
    render(<ActivationView token={JETON} />);

    await user.click(screen.getByRole("button", { name: "Activer mon compte" }));

    await waitFor(() => expect(activateFormAction).toHaveBeenCalledOnce());
    const [, formData] = activateFormAction.mock.calls[0] as [unknown, FormData];
    expect(formData.get("token")).toBe(JETON);
  });
});

describe("ActivationView — lien absent", () => {
  it("dit « lien invalide » sans proposer d'activer", () => {
    // Arriver sur `/activation` sans jeton n'est pas un cas d'attaque, c'est un
    // lien tronqué par un client de messagerie. Le message reste générique : pas
    // d'énumération des jetons valides (SPEC §Cas d'erreur).
    render(<ActivationView />);

    expect(screen.getByRole("alert")).toHaveTextContent(/invalide/i);
    expect(
      screen.queryByRole("button", { name: "Activer mon compte" }),
    ).not.toBeInTheDocument();
  });
});

describe("ActivationView — issues", () => {
  async function activer(): Promise<void> {
    const user = userEvent.setup();
    render(<ActivationView token={JETON} />);
    await user.click(screen.getByRole("button", { name: "Activer mon compte" }));
  }

  it("annonce « lien expiré » et propose un renvoi", async () => {
    // SPEC : « message “Lien expiré” + bouton “Renvoyer un email d'activation” ».
    activateFormAction.mockResolvedValue({ outcome: "expired" });

    await activer();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/expiré/i),
    );
    expect(
      screen.getByRole("button", { name: /Renvoyer/i }),
    ).toBeInTheDocument();
  });

  it("annonce « compte déjà activé » et renvoie vers la connexion", async () => {
    activateFormAction.mockResolvedValue({ outcome: "already_used" });

    await activer();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/déjà activé/i),
    );
    expect(screen.getByRole("link", { name: /connect/i })).toHaveAttribute(
      "href",
      "/connexion",
    );
  });

  it("annonce « lien invalide » sans proposer de renvoi", async () => {
    // Un formulaire de renvoi sur un jeton inconnu inviterait à essayer des
    // adresses : le renvoi appartient au cas « expiré », où l'on sait qu'un
    // compte existe.
    activateFormAction.mockResolvedValue({ outcome: "invalid" });

    await activer();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/invalide/i),
    );
    expect(
      screen.queryByRole("button", { name: /Renvoyer/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ActivationView — renvoi", () => {
  async function jusquAuRenvoi(): Promise<
    ReturnType<typeof userEvent.setup>
  > {
    activateFormAction.mockResolvedValue({ outcome: "expired" });
    const user = userEvent.setup();
    render(<ActivationView token={JETON} />);
    await user.click(screen.getByRole("button", { name: "Activer mon compte" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Adresse email")).toBeInTheDocument(),
    );
    return user;
  }

  it("demande l'email plutôt que de le déduire du jeton expiré", async () => {
    // Le porteur du jeton n'est pas forcément le titulaire de l'adresse — un
    // lien transféré, une boîte partagée. Afficher l'adresse rattachée au jeton
    // la révélerait à qui détient le lien.
    const user = await jusquAuRenvoi();

    await user.type(
      screen.getByLabelText("Adresse email"),
      "camille@example.test",
    );
    await user.click(screen.getByRole("button", { name: /Renvoyer/i }));

    await waitFor(() =>
      expect(resendActivationFormAction).toHaveBeenCalledOnce(),
    );
    const [, formData] = resendActivationFormAction.mock.calls[0] as [
      unknown,
      FormData,
    ];
    expect(formData.get("email")).toBe("camille@example.test");
  });

  it("confirme l'envoi par un message générique", async () => {
    resendActivationFormAction.mockResolvedValue({ sent: true });
    const user = await jusquAuRenvoi();

    await user.type(
      screen.getByLabelText("Adresse email"),
      "camille@example.test",
    );
    await user.click(screen.getByRole("button", { name: /Renvoyer/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /Si un compte existe/i,
      ),
    );
  });
});
