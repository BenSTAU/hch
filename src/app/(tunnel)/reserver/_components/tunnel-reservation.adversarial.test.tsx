import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADRESSE, EnveloppeTunnel, FORFAITS, PRODUITS } from "@/test/tunnel";

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

/// Cas hostiles de la garde d'état du tunnel.
///
/// `tunnel-reservation.test.tsx` éprouve la garde dans le sens où elle mord :
/// une étape en avance retombe sur la première incomplète. Ce fichier éprouve
/// l'autre sens, celui que `premiereIncomplete` ne regarde pas - la
/// **cohérence entre les prérequis eux-mêmes**. Un créneau non nul satisfait la
/// garde, même quand il a été dérivé d'un forfait ou d'une zone qui ne sont
/// plus ceux du tunnel (Constitution §2.1 : le forfait dicte le créneau).
///
/// ⚠️ Les scénarios passent par l'URL plutôt que par une longue suite de clics.
/// Motif de harnais, pas de produit : `NuqsTestingAdapter` perd un paramètre
/// quand deux `useQueryState` écrivent coup sur coup, et le test échouerait
/// alors sur l'adaptateur. L'URL est de toute façon une entrée de plein droit
/// ici - le tunnel la revendique partageable et rechargeable
/// (`tunnel-reservation.tsx:38-42`), et c'est par elle que la landing
/// pré-sélectionne un forfait.

/// Deux grilles disjointes, une par forfait : c'est ce qui rend l'oracle
/// falsifiable. Si le créneau retenu survit à un changement de forfait, il
/// désigne un instant que la grille du forfait courant ne contient pas.
const CRENEAU_REVISION = new Date(2027, 4, 10, 9, 0).toISOString();
const CRENEAU_DIAGNOSTIC = new Date(2027, 4, 10, 9, 20).toISOString();

/// `FORFAITS` du seed : 1 = Révision complète (60 min), 2 = Diagnostic express
/// (20 min).
const REVISION = 1;
const DIAGNOSTIC = 2;

function poser(searchParams = "", estConnecte = true) {
  const utilisateur = userEvent.setup();
  render(
    <EnveloppeTunnel searchParams={searchParams}>
      <TunnelReservation
        forfaits={FORFAITS}
        produits={PRODUITS}
        estConnecte={estConnecte}
      />
    </EnveloppeTunnel>,
  );
  return { utilisateur };
}

/// Le bandeau de rappel et la barre basse portent tous deux un contrôle dont le
/// nom accessible est « Modifier l'adresse » - l'un par `aria-label`, l'autre
/// par son texte. Les deux mènent au même endroit, on prend le premier.
function premierBouton(nom: RegExp): HTMLElement {
  const [bouton] = screen.getAllByRole("button", { name: nom });
  return bouton as HTMLElement;
}

/// `nuqs` diffère l'écriture de l'URL derrière une file limitée en débit
/// (50 ms). Sans cette attente, la file d'un tunnel démonté se vide DANS le
/// tunnel suivant et lui repose des paramètres périmés - le forfait retombe à
/// `null` et l'écran de reprise s'affiche pour une raison qui n'a rien à voir
/// avec ce qui est testé. Artefact de harnais, pas un constat sur le produit.
async function laisserRetomberLaFileNuqs(): Promise<void> {
  await new Promise((resoudre) => setTimeout(resoudre, 200));
}

/// Compose le tunnel jusqu'au créneau retenu, par l'interface - jamais en
/// écrivant `sessionStorage` à la main. La clé de reprise est un détail
/// d'implémentation ; ce qui est éprouvé ici est le parcours.
async function composerJusquAuCreneau(
  utilisateur: ReturnType<typeof userEvent.setup>,
  forfait: RegExp,
  heure: string,
) {
  await utilisateur.click(screen.getByRole("radio", { name: forfait }));
  await utilisateur.click(screen.getByRole("button", { name: /^continuer$/i }));

  await utilisateur.type(
    await screen.findByRole("combobox", { name: /adresse/i }),
    "12 rue de la bicyclette",
  );
  const [precise] = await screen.findAllByRole("option");
  await utilisateur.click(precise as HTMLElement);
  await screen.findByText(/adresse dans notre zone/i);

  await utilisateur.click(
    screen.getByRole("button", { name: /continuer vers les créneaux/i }),
  );
  await utilisateur.click(await screen.findByRole("button", { name: heure }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();

  verifierAdresse.mockResolvedValue({
    data: { ok: true, adresse: ADRESSE, zoneId: 1, zoneName: "Lyon centre" },
  });
  listerCreneaux.mockImplementation(
    (entree: { serviceId: number; zoneId: number }) =>
      Promise.resolve({
        data: {
          ok: true,
          creneaux:
            entree.serviceId === REVISION
              ? [CRENEAU_REVISION]
              : [CRENEAU_DIAGNOSTIC],
        },
      }),
  );
  reserver.mockResolvedValue({
    data: {
      ok: true,
      interventionId: 42,
      debut: CRENEAU_REVISION,
      prix: "85.00",
    },
  });
});

describe("TunnelReservation - cohérence forfait / créneau", () => {
  it("ne présente pas un créneau dérivé d'un autre forfait", async () => {
    // Constitution §2.1 : « le pool des créneaux se dérive à la volée -
    // planning(tech de la zone) × durée(forfait) ». Changer de forfait change
    // la durée, donc la grille. Le créneau retenu sous l'ancienne durée ne
    // désigne plus rien de réservable.
    //
    // L'état conservé porte l'adresse, la zone et le créneau ; le forfait, lui,
    // vit dans l'URL. Rien ne les rattache l'un à l'autre, et c'est le trou.
    const { utilisateur } = poser(`?etape=forfait&forfait=${String(REVISION)}`);
    await composerJusquAuCreneau(utilisateur, /Révision complète/, "09:00");
    await laisserRetomberLaFileNuqs();

    cleanup();
    poser(`?etape=recapitulatif&forfait=${String(DIAGNOSTIC)}`);

    // Le récapitulatif ne peut pas engager sur un couple impossible : soit il
    // redemande un créneau, soit il n'annonce pas celui-là. Le `h1` est le
    // repère d'écran du tunnel - on attend qu'il paraisse, puis on lit lequel.
    const titre = await screen.findByRole("heading", { level: 1 });
    expect(titre).not.toHaveTextContent(/finalisez votre réservation/i);
  });

  it("ne propose pas de valider sur un créneau d'un autre forfait", async () => {
    // Le serveur refuse bien (`reserver.ts:105-122`), mais avec « ce créneau
    // vient d'être réservé » : un message faux, qui impute à un tiers un état
    // que le tunnel a produit seul. L'écran ne doit donc pas conduire là.
    //
    // ⚠️ Écrit par l'agent testeur avec une garde `if (valider === null)
    // return`, qui le rendait **vide** une fois le défaut corrigé. Il le
    // signalait lui-même. Réécrit en oracle direct : l'absence du bouton EST
    // l'invariant, et l'affirmer se falsifie.
    const { utilisateur } = poser(`?etape=forfait&forfait=${String(REVISION)}`);
    await composerJusquAuCreneau(utilisateur, /Révision complète/, "09:00");
    await laisserRetomberLaFileNuqs();

    cleanup();
    poser(`?etape=recapitulatif&forfait=${String(DIAGNOSTIC)}`);
    await screen.findByRole("heading", { level: 1 });

    expect(
      screen.queryByRole("button", { name: /valider ma réservation/i }),
    ).toBeNull();
    expect(reserver).not.toHaveBeenCalled();
  });
});

describe("TunnelReservation - cohérence zone / créneau", () => {
  it("ne présente pas un créneau dérivé de la zone précédente", async () => {
    // La grille est demandée par le couple `(serviceId, zoneId)`
    // (`etape-creneau.tsx:119`). Changer d'adresse pour une autre zone change
    // le pool de techniciens, donc la grille - `verifier()` remet l'adresse et
    // la zone à zéro (`tunnel-reservation.tsx:214-215`) mais jamais le créneau.
    const { utilisateur } = poser(`?etape=forfait&forfait=${String(REVISION)}`);
    await composerJusquAuCreneau(utilisateur, /Révision complète/, "09:00");

    // Seconde adresse, autre zone, aucune disponibilité.
    verifierAdresse.mockResolvedValue({
      data: {
        ok: true,
        adresse: { ...ADRESSE, label: "5 Rue du Guignol 69005 Lyon" },
        zoneId: 2,
        zoneName: "Lyon ouest",
      },
    });
    listerCreneaux.mockImplementation(
      (entree: { serviceId: number; zoneId: number }) =>
        Promise.resolve({
          data: {
            ok: true,
            creneaux: entree.zoneId === 1 ? [CRENEAU_REVISION] : [],
          },
        }),
    );

    await utilisateur.click(premierBouton(/modifier l'adresse/i));
    const champ = await screen.findByRole("combobox", { name: /adresse/i });
    await utilisateur.clear(champ);
    await utilisateur.type(champ, "5 rue du guignol");
    const [autre] = await screen.findAllByRole("option");
    await utilisateur.click(autre as HTMLElement);
    await screen.findByText(/adresse dans notre zone/i);

    await utilisateur.click(
      screen.getByRole("button", { name: /continuer vers les créneaux/i }),
    );
    await screen.findByText(/aucun créneau disponible dans les 30/i);

    // La zone 2 n'offre rien : le tunnel ne doit pas laisser avancer sur un
    // créneau hérité de la zone 1.
    expect(
      screen.getByRole("button", { name: /continuer vers le récapitulatif/i }),
    ).toBeDisabled();
  });
});

describe("TunnelReservation - barre d'action du récapitulatif", () => {
  it("ne pose aucune barre d'action sur le récapitulatif réellement atteint", async () => {
    // C5 n'a pas de pied de page : l'appel à l'action vit dans la colonne
    // collante ([[maquettage]] §Notes portage).
    //
    // Le test homonyme de `tunnel-reservation.test.tsx` porte ce nom mais pose
    // `?etape=forfait` et vérifie la PRÉSENCE du lien d'accueil : il n'atteint
    // jamais le récapitulatif, et resterait vert si celui-ci reprenait une
    // barre. Celui-ci l'atteint.
    const { utilisateur } = poser(`?etape=forfait&forfait=${String(REVISION)}`);

    await composerJusquAuCreneau(utilisateur, /Révision complète/, "09:00");
    await utilisateur.click(
      screen.getByRole("button", { name: /continuer vers le récapitulatif/i }),
    );
    await screen.findByRole("heading", {
      name: /finalisez votre réservation/i,
    });

    expect(screen.queryByRole("button", { name: /^continuer/i })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /retour à l'accueil/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /modifier l'adresse/i }),
    ).toBeNull();
  });
});

describe("TunnelReservation - reprise après création de compte", () => {
  it("retrouve la sélection au retour de la destination que C5 annonce", async () => {
    // `RETOUR_TUNNEL` (`tunnel-reservation.tsx:49`) est la destination que C5
    // promet : « votre sélection reste en place, et vous revenez au
    // récapitulatif » (`etape-coordonnees.tsx:65-67`). Elle sert aux DEUX
    // branches - le lien d'activation, et `/connexion?next=…` pour un client
    // déjà inscrit.
    //
    // Le cas éprouvé ici est le NOMINAL, pas le cross-appareil que l'écran de
    // reprise couvre à juste titre : même onglet, même `sessionStorage`,
    // connexion depuis C5 puis retour à l'URL annoncée.
    const { utilisateur } = poser(
      `?etape=forfait&forfait=${String(REVISION)}`,
      false,
    );

    await composerJusquAuCreneau(utilisateur, /Révision complète/, "09:00");
    await utilisateur.click(
      screen.getByRole("button", { name: /continuer vers le récapitulatif/i }),
    );
    await screen.findByRole("heading", {
      name: /finalisez votre réservation/i,
    });

    const destination = screen
      .getByRole("link", { name: /j'ai déjà un compte/i })
      .getAttribute("href");
    expect(destination).toBe(
      "/connexion?next=%2Freserver%3Fetape%3Drecapitulatif",
    );

    // Retour à cette destination exacte, dans le même onglet : `sessionStorage`
    // porte toujours adresse, zone et créneau.
    await laisserRetomberLaFileNuqs();
    cleanup();
    poser("?etape=recapitulatif", true);

    expect(
      await screen.findByRole("heading", {
        name: /finalisez votre réservation/i,
      }),
    ).toBeInTheDocument();
    // Et non l'écran de reprise, qui annonce une perte qui n'a pas eu lieu.
    expect(
      screen.queryByRole("heading", { name: /reprenons votre réservation/i }),
    ).toBeNull();
  });
});
