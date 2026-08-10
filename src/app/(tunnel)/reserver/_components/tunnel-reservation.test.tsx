import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADRESSE, EnveloppeTunnel, FORFAITS } from "@/test/tunnel";

const verifierAdresse = vi.fn();
const reserver = vi.fn();
const listerCreneaux = vi.fn();

vi.mock("@/lib/actions/adresses/verifier-adresse", () => ({
  verifierAdresse: (entree: unknown) => verifierAdresse(entree),
}));
vi.mock("@/lib/actions/interventions/reserver", () => ({
  reserver: (entree: unknown) => reserver(entree),
}));
vi.mock("@/lib/actions/interventions/lister-creneaux", () => ({
  listerCreneaux: (entree: unknown) => listerCreneaux(entree),
}));
vi.mock("@/lib/actions/auth/signup", () => ({ signupFormAction: vi.fn() }));

const { TunnelReservation } = await import("./tunnel-reservation");

/// L'orchestrateur des quatre écrans. Ce fichier vérifie ce qu'aucun test de
/// composant isolé ne peut voir : l'enchaînement des étapes, et la **garde**
/// qui empêche d'atterrir sur une étape dont les prérequis manquent.

const CRENEAU = new Date(2027, 4, 10, 9, 0).toISOString();

function poser(searchParams = "", estConnecte = false) {
  const utilisateur = userEvent.setup();
  const { container } = render(
    <EnveloppeTunnel searchParams={searchParams}>
      <TunnelReservation forfaits={FORFAITS} estConnecte={estConnecte} />
    </EnveloppeTunnel>,
  );
  return { container, utilisateur };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  verifierAdresse.mockResolvedValue({
    data: { ok: true, adresse: ADRESSE, zoneId: 1, zoneName: "Lyon centre" },
  });
  listerCreneaux.mockResolvedValue({ data: { ok: true, creneaux: [CRENEAU] } });
  reserver.mockResolvedValue({
    data: {
      ok: true,
      interventionId: 42,
      debut: CRENEAU,
      prix: "85.00",
    },
  });
});

describe("TunnelReservation - progression", () => {
  it("n'autorise le pas suivant qu'une fois l'étape satisfaite", async () => {
    const { utilisateur } = poser();

    const continuer = screen.getByRole("button", { name: /^continuer$/i });
    expect(continuer).toBeDisabled();

    await utilisateur.click(
      screen.getByRole("radio", { name: /Révision complète/ }),
    );

    expect(continuer).toBeEnabled();
  });

  it("mène du forfait au récapitulatif, en quatre pas", async () => {
    const { utilisateur } = poser();

    // 1. Forfait
    await utilisateur.click(
      screen.getByRole("radio", { name: /Révision complète/ }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /^continuer$/i }),
    );

    // 2. Adresse. La BAN est mockée par MSW (`src/mocks/handlers.ts`) : c'est
    // une frontière réseau, pas une fonction à remplacer.
    expect(
      await screen.findByRole("heading", { name: /où intervenons-nous/i }),
    ).toBeInTheDocument();

    await utilisateur.type(
      screen.getByRole("combobox", { name: /adresse/i }),
      "12 rue de la bicyclette",
    );
    const [precise] = await screen.findAllByRole("option");
    await utilisateur.click(precise as HTMLElement);

    expect(
      await screen.findByText(/adresse dans notre zone/i),
    ).toBeInTheDocument();
    await utilisateur.click(
      screen.getByRole("button", { name: /continuer vers les créneaux/i }),
    );

    // 3. Créneau
    await utilisateur.click(
      await screen.findByRole("button", { name: "09:00" }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /continuer vers le récapitulatif/i }),
    );

    // 4. Récapitulatif
    expect(
      await screen.findByRole("heading", { name: /finalisez votre/i }),
    ).toBeInTheDocument();
  });

  it("n'affiche pas de barre d'action au récapitulatif", async () => {
    // C5 n'a pas de pied de page : l'appel à l'action vit dans la colonne
    // collante ([[maquettage]] §Notes portage).
    poser("?etape=forfait");

    expect(
      screen.getByRole("link", { name: /retour à l'accueil/i }),
    ).toBeInTheDocument();
  });
});

describe("TunnelReservation - garde d'état", () => {
  it("ne rend pas une page blanche quand l'état manque", async () => {
    // Le cas nominal n'est pas une URL forgée : c'est le retour d'activation
    // sur un AUTRE appareil, où `sessionStorage` est vide par construction.
    poser("?etape=recapitulatif&forfait=1");

    expect(
      await screen.findByRole("heading", {
        name: /reprenons votre réservation/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /valider ma réservation/i }),
    ).toBeNull();
  });

  it("dit la limite de la reprise, au lieu de la masquer", async () => {
    poser("?etape=recapitulatif&forfait=1");

    expect(
      await screen.findByText(/sur un autre appareil/i),
    ).toBeInTheDocument();
    // Aucun créneau n'est tenu pendant l'absence : le dire évite de laisser
    // croire à une réservation en attente.
    expect(screen.getByText(/aucun créneau n'est bloqué/i)).toBeInTheDocument();
  });

  it("ramène à la première étape incomplète", async () => {
    const { utilisateur } = poser("?etape=creneau");

    await utilisateur.click(
      await screen.findByRole("button", { name: /choisir un forfait/i }),
    );

    expect(
      screen.getByRole("heading", { name: /quel forfait vous convient/i }),
    ).toBeInTheDocument();
  });
});

describe("TunnelReservation - validation", () => {
  it("renvoie à la grille quand le créneau est parti entre-temps", async () => {
    // Forme minimale des « alternatives proposées » de la SPEC : la grille
    // rafraîchie MONTRE ce qui reste.
    reserver.mockResolvedValue({
      data: {
        ok: false,
        message: "Ce créneau vient d'être réservé.",
        creneauPerdu: true,
      },
    });

    const { utilisateur } = poser("?etape=forfait", true);

    await utilisateur.click(
      screen.getByRole("radio", { name: /Révision complète/ }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /^continuer$/i }),
    );
    await utilisateur.type(
      await screen.findByRole("combobox", { name: /adresse/i }),
      "12 rue de la bicyclette",
    );
    const [precise] = await screen.findAllByRole("option");
    await utilisateur.click(precise as HTMLElement);
    await utilisateur.click(
      await screen.findByRole("button", {
        name: /continuer vers les créneaux/i,
      }),
    );
    await utilisateur.click(
      await screen.findByRole("button", { name: "09:00" }),
    );
    await utilisateur.click(
      screen.getByRole("button", { name: /continuer vers le récapitulatif/i }),
    );
    await utilisateur.click(
      await screen.findByRole("button", { name: /valider ma réservation/i }),
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /vient d'être réservé/i,
      );
    });
    expect(
      screen.getByRole("heading", { name: /choisissez votre créneau/i }),
    ).toBeInTheDocument();
  });
});

describe("TunnelReservation - accessibilité", () => {
  it("ne présente aucune violation axe, première étape", async () => {
    const { container } = poser();

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation axe, état vide", async () => {
    const { container } = poser("?etape=recapitulatif&forfait=1");
    await screen.findByRole("heading", { name: /reprenons/i });

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
