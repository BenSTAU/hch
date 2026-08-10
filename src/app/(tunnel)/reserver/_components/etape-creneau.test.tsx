import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADRESSE, EnveloppeTunnel, FORFAITS } from "@/test/tunnel";

const listerCreneaux = vi.fn();
vi.mock("@/lib/actions/interventions/lister-creneaux", () => ({
  listerCreneaux: (entree: unknown) => listerCreneaux(entree),
}));

const { EtapeCreneau } = await import("./etape-creneau");

/// Écran **C4**. La grille se dérive à la volée (Constitution §2.1) : ce fichier
/// ne teste pas la dérivation, qui a la sienne, mais ce que l'écran en fait -
/// un calendrier navigable dont les jours vides ne sont pas cliquables.
///
/// Les instants sont construits en heure **locale** puis sérialisés : un
/// littéral en `Z` tomberait la veille ou le lendemain selon le fuseau du
/// runner, et le test échouerait un jour sur deux sans rien dire d'utile.
function instant(
  jour: number,
  heures: number,
  minutes = 0,
  mois = 4,
  annee = 2027,
): string {
  return new Date(annee, mois, jour, heures, minutes).toISOString();
}

const LUNDI_10 = instant(10, 8);
const LUNDI_10_BIS = instant(10, 9);
const JEUDI_13 = instant(13, 14);

const FORFAIT = FORFAITS[2] as (typeof FORFAITS)[number];

function poser(onChoisir = vi.fn(), creneauChoisi: string | null = null) {
  const utilisateur = userEvent.setup();
  const { container } = render(
    <EnveloppeTunnel>
      <EtapeCreneau
        forfait={FORFAIT}
        adresse={ADRESSE}
        zoneId={1}
        creneauChoisi={creneauChoisi}
        onChoisir={onChoisir}
        onModifierAdresse={vi.fn()}
        idTitre="titre-c4"
      />
    </EnveloppeTunnel>,
  );
  return { container, onChoisir, utilisateur };
}

function reponse(creneaux: string[]) {
  return { data: { ok: true as const, creneaux } };
}

beforeEach(() => {
  vi.clearAllMocks();
  listerCreneaux.mockResolvedValue(reponse([LUNDI_10, LUNDI_10_BIS, JEUDI_13]));
});

describe("EtapeCreneau - grille", () => {
  it("interroge la zone et le forfait retenus, pas autre chose", async () => {
    poser();
    await screen.findByRole("grid");

    expect(listerCreneaux).toHaveBeenCalledWith({
      serviceId: FORFAIT.id,
      zoneId: 1,
    });
  });

  it("propose les heures du premier jour disponible", async () => {
    poser();

    expect(
      await screen.findByRole("button", { name: "08:00" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "09:00" })).toBeInTheDocument();
    // Le 13 est un autre jour : ses heures ne s'affichent qu'une fois ce jour
    // retenu au calendrier.
    expect(screen.queryByRole("button", { name: "14:00" })).toBeNull();
  });

  it("désactive les jours sans créneau", async () => {
    // C'est ce qui remplace le défilement d'une liste de 30 jours dont la
    // plupart étaient vides.
    poser();
    const grille = await screen.findByRole("grid");

    const onze = within(grille).getByRole("button", { name: /11 mai 2027/ });
    const treize = within(grille).getByRole("button", { name: /13 mai 2027/ });

    expect(onze).toBeDisabled();
    expect(treize).toBeEnabled();
  });

  it("change de jour au calendrier et montre ses créneaux", async () => {
    const { utilisateur } = poser();
    const grille = await screen.findByRole("grid");

    await utilisateur.click(
      within(grille).getByRole("button", { name: /13 mai 2027/ }),
    );

    expect(screen.getByRole("button", { name: "14:00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "08:00" })).toBeNull();
  });

  it("remonte l'instant retenu, pas l'heure affichée", async () => {
    const { onChoisir, utilisateur } = poser();

    await utilisateur.click(
      await screen.findByRole("button", { name: "09:00" }),
    );

    expect(onChoisir).toHaveBeenCalledWith(LUNDI_10_BIS);
  });

  it("distingue le créneau retenu des autres pour un lecteur d'écran", async () => {
    poser(vi.fn(), LUNDI_10_BIS);

    expect(
      await screen.findByRole("button", { name: "09:00" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "08:00" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("EtapeCreneau - états", () => {
  it("annonce la recherche avant d'avoir les créneaux", () => {
    poser();

    expect(screen.getByRole("status")).toHaveTextContent(
      /recherche des créneaux/i,
    );
  });

  it("dit qu'il n'y a rien plutôt que d'afficher un calendrier vide", async () => {
    // `US-INTERVENTION-RESERVER` nomme le message pour l'horizon de 30 jours.
    listerCreneaux.mockResolvedValue(reponse([]));
    poser();

    expect(
      await screen.findByText(/aucun créneau disponible dans les 30/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("remonte le refus du serveur tel quel", async () => {
    listerCreneaux.mockResolvedValue({
      data: { ok: false, message: "Zone introuvable." },
    });
    poser();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Zone introuvable.",
    );
  });
});

describe("EtapeCreneau - récapitulatif latéral", () => {
  it("reste explicite tant qu'aucun créneau n'est retenu", async () => {
    poser();
    await screen.findByRole("grid");

    expect(screen.getByText(/aucun créneau retenu/i)).toBeInTheDocument();
  });

  it("affiche le créneau retenu et le total figé", async () => {
    poser(vi.fn(), LUNDI_10_BIS);
    await screen.findByRole("grid");

    expect(screen.getByText(/lundi 10 mai 2027/i)).toBeInTheDocument();
    // « Total **estimé** » dans la maquette : le prix est figé à la réservation
    // (Constitution §4.1), rien n'est estimé.
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.queryByText(/estimé/i)).toBeNull();
  });

  it("rappelle que le paiement se fait sur place", async () => {
    poser();
    await screen.findByRole("grid");

    expect(screen.getByText(/paiement sur place/i)).toBeInTheDocument();
  });
});

describe("EtapeCreneau - divergences de portage", () => {
  it("n'affiche ni technicien assigné ni note", async () => {
    // `c4:197-207` : « Marc L., 4.9/5, 127 avis ». Ni avis ni notation en v1.
    poser();
    await screen.findByRole("grid");

    expect(screen.queryByText(/assigné/i)).toBeNull();
    expect(screen.queryByText(/avis/i)).toBeNull();
  });

  it("ne propose ni bascule Semaine/Mois ni liste d'attente", async () => {
    // `c4:154-157` et `c4:219-222` : deux vues d'un calendrier qui n'existe
    // pas, et une liste d'attente qu'aucune US ne porte.
    poser();
    await screen.findByRole("grid");

    expect(screen.queryByRole("button", { name: /semaine/i })).toBeNull();
    expect(screen.queryByText(/liste d'attente/i)).toBeNull();
  });

  it("navigue en français, jusqu'aux libellés de la primitive", async () => {
    // `react-day-picker` livre « Go to the Previous Month » et colle
    // « Today, » / « , selected » autour de chaque jour : ce sont des noms
    // accessibles, sur une application entièrement en français.
    poser();
    await screen.findByRole("grid");

    expect(
      screen.getByRole("button", { name: "Mois précédent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mois suivant" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /go to the/i })).toBeNull();
  });
});

describe("EtapeCreneau - accessibilité", () => {
  it("ne présente aucune violation axe, grille chargée", async () => {
    const { container } = poser();
    await screen.findByRole("grid");

    await expect(axe(container)).resolves.toHaveNoViolations();
  });

  it("ne présente aucune violation axe, créneau retenu", async () => {
    const { container } = poser(vi.fn(), LUNDI_10);
    await screen.findByRole("grid");

    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
