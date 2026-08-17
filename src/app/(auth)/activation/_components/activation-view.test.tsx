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

    await user.click(
      screen.getByRole("button", { name: "Activer mon compte" }),
    );

    await waitFor(() => expect(activateFormAction).toHaveBeenCalledOnce());
    const [, formData] = activateFormAction.mock.calls[0] as [
      unknown,
      FormData,
    ];
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
    await user.click(
      screen.getByRole("button", { name: "Activer mon compte" }),
    );
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

// Entrée `?renvoi=1` — ajoutée par T-V3-03, livrée SANS TEST. Ajouts de
// l'agent testeur.
//
// La DoD demande un « bouton “Renvoyer un email d'activation” sous le
// formulaire de connexion » (`US-COMPTE-CONNECTER` §Cas d'erreur). Ce qui était
// vérifié : le `href` du lien (`connexion-view.test.tsx:84`). Ce qui ne l'était
// pas : que la destination en fasse quoi que ce soit. Une page qui ignorerait
// `renvoi=1` rendrait « Lien invalide » et aucun formulaire — le test du lien
// resterait vert, et la DoD serait fausse.
//
// L'enjeu est celui qui a motivé la DoD : sans cette entrée, le formulaire de
// renvoi n'était atteignable qu'en cliquant un lien EXPIRÉ, donc en l'ayant
// encore sous la main. C'est exactement ce qu'on ne peut pas supposer de
// quelqu'un qui n'a jamais reçu son email.
describe("ActivationView — entrée directe par le renvoi", () => {
  it("offre le formulaire de renvoi sans jeton", () => {
    render(<ActivationView demandeRenvoi />);

    expect(screen.getByLabelText("Adresse email")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Renvoyer/i }),
    ).toBeInTheDocument();
  });

  it("ne traite pas l'absence de jeton comme un lien cassé", () => {
    // Sans le drapeau, `token === undefined` vaut « Lien invalide »
    // (`activation-view.tsx:102-107`). Une demande explicite n'est pas un lien
    // tronqué : afficher une erreur ici découragerait le seul recours dont
    // dispose la personne.
    render(<ActivationView demandeRenvoi />);

    expect(screen.getByRole("alert")).not.toHaveTextContent(/invalide/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/Renvoyer/i);
  });

  it("ne propose pas d'activer un compte sans jeton", () => {
    render(<ActivationView demandeRenvoi />);

    expect(
      screen.queryByRole("button", { name: "Activer mon compte" }),
    ).not.toBeInTheDocument();
  });

  it("laisse un chemin de retour vers la connexion", () => {
    // La personne vient de la connexion. Sans ce lien, l'écran de renvoi est un
    // cul-de-sac : elle a demandé son email, elle doit pouvoir revenir s'en
    // servir.
    render(<ActivationView demandeRenvoi />);

    expect(screen.getByRole("link", { name: /Se connecter/i })).toHaveAttribute(
      "href",
      "/connexion",
    );
  });

  it("n'ouvre aucun droit : l'adresse est saisie, jamais déduite", async () => {
    // `?renvoi=1` ne porte aucune donnée et ne prouve rien. Le quota — 3 par
    // 24 h et par email — reste décompté côté action, sur l'adresse SAISIE.
    // Un pré-remplissage depuis l'URL ferait du paramètre un vecteur.
    const user = userEvent.setup();
    render(<ActivationView demandeRenvoi />);

    expect(screen.getByLabelText("Adresse email")).toHaveValue("");

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

  it("répond le même message générique que par le chemin du lien expiré", async () => {
    // Anti-énumération (Constitution §4.2) : la nouvelle porte d'entrée ne doit
    // pas produire une réponse plus bavarde que l'ancienne. Elle est PLUS
    // exposée — atteignable sans aucun jeton, donc utilisable pour balayer des
    // adresses.
    resendActivationFormAction.mockResolvedValue({ sent: true });
    const user = userEvent.setup();
    render(<ActivationView demandeRenvoi />);

    await user.type(
      screen.getByLabelText("Adresse email"),
      "inconnu@example.test",
    );
    await user.click(screen.getByRole("button", { name: /Renvoyer/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        /Si un compte existe/i,
      ),
    );
  });

  it("ne porte aucune violation détectable par axe-core", async () => {
    const { container } = render(<ActivationView demandeRenvoi />);

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});

describe("ActivationView — renvoi", () => {
  async function jusquAuRenvoi(): Promise<ReturnType<typeof userEvent.setup>> {
    activateFormAction.mockResolvedValue({ outcome: "expired" });
    const user = userEvent.setup();
    render(<ActivationView token={JETON} />);
    await user.click(
      screen.getByRole("button", { name: "Activer mon compte" }),
    );
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
