// Le hub d'actions du detail - `US-INTERVENTION-AFFICHER` §Cas nominal, ecran
// **T2**.
//
// Ce fichier eprouve la propriete centrale de l'ecran, et la seule que la revue
// humaine de la tache demande de regarder : **les actions proposees dependent
// de l'etat courant, et aucune n'est inerte**. La transition elle-meme et sa
// garde ont leurs propres tests.
//
// ⚠️ La PAGE, elle, n'est pas testee ici : c'est un Server Component
// asynchrone, que Vitest et RTL ne savent pas derouler (CLAUDE.md §Testing).
// Son 403 et son rendu vivent en E2E.
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import type { InterventionDetail } from "@/lib/db/queries/interventions";

// Les deux boutons tirent leur Server Action, donc `safe-action`, la DAL et
// Prisma.
vi.mock("@/lib/actions/interventions/demarrer-intervention", () => ({
  demarrerIntervention: vi.fn(() => Promise.resolve({ data: { ok: true } })),
}));

vi.mock("@/lib/actions/paiements/cloturer-intervention", () => ({
  cloturerIntervention: vi.fn(() =>
    Promise.resolve({ data: { ok: true, issue: "encaisse" } }),
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { HubStatut } = await import("./hub-statut");

const DETAIL: InterventionDetail = {
  id: 847,
  status: "PLANNED",
  // 08 h 00 UTC = 10 h 00 a Paris en ete.
  appointmentAt: new Date("2026-08-20T08:00:00.000Z"),
  startedAt: null,
  durationSnapshot: 60,
  priceSnapshot: "85.00",
  total: "85.00",
  cancellationReason: null,
  forfait: { label: "Revision complete", description: null },
  client: {
    nom: "Julien Marceau",
    telephone: "0612345678",
    email: "julien@exemple.fr",
  },
  adresse: { street: "8 quai Saint-Antoine", zipCode: "69002", city: "Lyon" },
  point: null,
  cycle: null,
  produits: [],
  photos: [],
  techComment: null,
};

function rendre(surcharge: Partial<InterventionDetail> = {}) {
  return render(<HubStatut intervention={{ ...DETAIL, ...surcharge }} />);
}

function boutonDemarrer() {
  return screen.queryByRole("button", { name: /Démarrer l'intervention/ });
}

describe("HubStatut - les actions suivent le statut", () => {
  it("propose de demarrer sur une intervention PLANNED", () => {
    rendre();

    expect(boutonDemarrer()).toBeInTheDocument();
    expect(screen.getByText(/Rendez-vous à 10:00/)).toBeInTheDocument();
  });

  it.each([["IN_PROGRESS"], ["DONE"], ["CANCELLED"]])(
    "ne propose plus de demarrer depuis %s",
    (status) => {
      rendre({ status, startedAt: new Date("2026-08-20T08:02:00.000Z") });

      expect(boutonDemarrer()).not.toBeInTheDocument();
    },
  );

  it("propose de cloturer, et RIEN d'autre, en IN_PROGRESS", () => {
    // 🔄 **Ce test disait « aucun bouton en IN_PROGRESS », et il a ete REMPLACE
    // par son symetrique, pas supprime ni classe « test fautif ».**
    //
    // Sa version d'origine figeait un ecart de perimetre que T-V2-02 assumait
    // par ecrit : « Deposer des photos » est T-V2-04 et la cloture est
    // T-V2-03, aucune des deux n'etait livree. Elle annoncait elle-meme son
    // remplacement - « ce test rougira le jour ou l'une des deux atterrit [...]
    // il faudra alors le reecrire en connaissance de cause, pas ajouter un
    // bouton en silence ». C'est ce jour-la.
    //
    // La proposition qu'il portait est conservee entiere : le jeu d'actions
    // d'`IN_PROGRESS` est EXACTEMENT celui des US livrees. Il en compte
    // desormais un, et le second - le depot de photos - reste absent plutot que
    // pose desactive, parce qu'un bouton inerte est ce que la DoD interdit
    // nommement. Ce test rougira encore a l'arrivee de T-V2-04, pour la meme
    // raison et avec la meme suite a donner.
    rendre({
      status: "IN_PROGRESS",
      startedAt: new Date("2026-08-20T08:02:00.000Z"),
    });

    expect(
      screen.getByRole("button", { name: /Marquer comme faite/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /photo/i }),
    ).not.toBeInTheDocument();
  });

  it("affiche le jalon date plutot qu'un vide en IN_PROGRESS", () => {
    // Ce que la maquette porte dans son apercu « etat EN COURS ». Un ecran qui
    // dit ou il en est renseigne ; l'absence d'action n'est pas l'absence
    // d'information.
    rendre({
      status: "IN_PROGRESS",
      startedAt: new Date("2026-08-20T08:02:00.000Z"),
    });

    expect(
      screen.getByText("Intervention démarrée à 10:02."),
    ).toBeInTheDocument();
  });

  it("se replie sur une mention neutre si `startedAt` manque", () => {
    // Une ligne passee en IN_PROGRESS autrement que par l'action - correction
    // en base, jeu de test - ne doit pas afficher « demarree a Invalid Date ».
    rendre({ status: "IN_PROGRESS", startedAt: null });

    expect(screen.getByText("Intervention en cours.")).toBeInTheDocument();
  });

  it("montre le motif d'annulation, seul contenu utile d'une ligne CANCELLED", () => {
    // Il est saisi par le client (`US-INTERVENTION-ANNULER-CLIENT`, motif
    // obligatoire) et aide le technicien a comprendre sa journee.
    rendre({ status: "CANCELLED", cancellationReason: "Vélo déjà réparé" });

    expect(screen.getByText(/Vélo déjà réparé/)).toBeInTheDocument();
  });

  it("ne plante pas sur une annulation sans motif", () => {
    rendre({ status: "CANCELLED", cancellationReason: null });

    expect(screen.getByText("Intervention annulée.")).toBeInTheDocument();
  });

  it("affiche un statut inconnu sans proposer d'action", () => {
    // Le symptome d'une divergence entre le CHECK SQL et la table de libelles.
    // Le repli ne ment pas et ne propose rien.
    rendre({ status: "SUSPENDED" });

    expect(screen.getByText(/aucune action disponible/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("HubStatut - accessibilite", () => {
  it.each([["PLANNED"], ["IN_PROGRESS"], ["DONE"], ["CANCELLED"]])(
    "ne presente aucune violation en %s",
    async (status) => {
      const { container } = rendre({
        status,
        startedAt: new Date("2026-08-20T08:02:00.000Z"),
        cancellationReason: "Vélo déjà réparé",
      });

      await expect(axe(container)).resolves.toHaveNoViolations();
    },
  );
});
