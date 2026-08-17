// @vitest-environment node
//
// Server Action de validation d'une réservation, le cœur du produit. Tout est
// appelé sans passer par les quatre écrans du tunnel : une Server Action
// exportée est un endpoint POST public (ADR-006 v2).
//
// La BAN passe par **MSW** et non par un `vi.mock` du module, ADR-014 §Stack
// voulant la frontière RÉSEAU mockée. Le vrai `geocoderAdresse` s'exécute donc,
// et la dérivation de la grille est RÉELLE : c'est elle l'oracle du « ce
// créneau n'existe pas ». Seul ce qui exige un PostgreSQL reste mocké.
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { entiteBan, reponseBan } from "@/mocks/handlers";
import { server } from "@/mocks/node";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const serviceFindFirst = vi.fn();
vi.mock("@/lib/db/client", () => ({
  db: { service: { findFirst: (args: unknown) => serviceFindFirst(args) } },
}));

const trouverZoneCouvrante = vi.fn();
vi.mock("@/lib/geo/postgis", () => ({
  trouverZoneCouvrante: (point: unknown) => trouverZoneCouvrante(point),
}));

const listerTechniciensCharges = vi.fn();
const reserverIntervention = vi.fn();
vi.mock("@/lib/db/queries/interventions", () => ({
  listerTechniciensCharges: (args: unknown) => listerTechniciensCharges(args),
  reserverIntervention: (args: unknown) => reserverIntervention(args),
}));

const lireHorairesSemaine = vi.fn();
vi.mock("@/lib/db/queries/parametres", () => ({
  lireHorairesSemaine: () => lireHorairesSemaine(),
}));

// `dispatchEmail` appelle `after()` de Next, qui exige un contexte de requête.
// Le mock exécute le rappel IMMÉDIATEMENT : sans ça, les assertions sur le
// contenu de l'email ne verraient jamais rien partir.
const sendReservationEmail = vi.fn();
vi.mock("@/lib/email/reservation", () => ({
  sendReservationEmail: (params: unknown) => sendReservationEmail(params),
}));
const dispatchEmail = vi.fn(
  (_libelle: string, envoyer: () => Promise<void>) => {
    void envoyer();
  },
);
vi.mock("@/lib/email/dispatch", () => ({
  dispatchEmail: (libelle: string, envoyer: () => Promise<void>) =>
    dispatchEmail(libelle, envoyer),
}));

const { reserver } = await import("./reserver");
const { BAN_SEARCH_URL } = await import("@/lib/geo/ban");

/// Lundi 13 juillet 2026, 07 h 00 à Lyon - avant l'ouverture, donc la journée
/// entière est encore offerte et aucune assertion ne dépend de l'heure réelle.
const MAINTENANT = new Date("2026-07-13T05:00:00Z");

/// Horaires du seed (`prisma/seed.ts:245-287`), en minutes locales.
const SEMAINE = { debutMinutes: 8 * 60, finMinutes: 18 * 60 };
const HORAIRES = {
  monday: SEMAINE,
  tuesday: SEMAINE,
  wednesday: SEMAINE,
  thursday: SEMAINE,
  friday: SEMAINE,
  saturday: { debutMinutes: 9 * 60, finMinutes: 13 * 60 },
  sunday: null,
};

const CLIENT = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "camille@example.test",
  firstname: "Camille",
  lastname: "Durand",
  roles: ["ROLE_CLIENT"],
};

/// Adresse renvoyée par la BAN - place Bellecour, comme toutes les fixtures.
const ADRESSE_BAN = {
  label: "12 Rue de la Bicyclette 69003 Lyon",
  name: "12 Rue de la Bicyclette",
  postcode: "69003",
  city: "Lyon",
  citycode: "69383",
  lon: 4.832,
  lat: 45.7578,
};

/// Charge utile du client. Ses `lon`/`lat` sont ceux que l'écran a affichés -
/// ils arrivent, ils ne décident de rien.
function chargeUtile(
  debut: string,
  surcharge: Record<string, unknown> = {},
): Parameters<typeof reserver>[0] {
  return {
    serviceId: 1,
    adresse: {
      label: ADRESSE_BAN.label,
      street: ADRESSE_BAN.name,
      postcode: ADRESSE_BAN.postcode,
      city: ADRESSE_BAN.city,
      citycode: ADRESSE_BAN.citycode,
      lon: ADRESSE_BAN.lon,
      lat: ADRESSE_BAN.lat,
    },
    debut,
    ...surcharge,
  } as Parameters<typeof reserver>[0];
}

/// Premier créneau du lundi : 08 h 00 locales, soit 06:00 UTC en été.
const CRENEAU_VALIDE = "2026-07-13T06:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(MAINTENANT);

  getCurrentUser.mockResolvedValue(CLIENT);
  serviceFindFirst.mockResolvedValue({ duration: 60 });
  trouverZoneCouvrante.mockResolvedValue({
    ok: true,
    zoneId: 7,
    zoneName: "Lyon Centre",
  });
  lireHorairesSemaine.mockResolvedValue({
    horaires: HORAIRES,
    clesInvalides: [],
  });
  listerTechniciensCharges.mockResolvedValue([
    { id: "tech-1", occupes: [] as { debut: Date; fin: Date }[] },
  ]);
  reserverIntervention.mockResolvedValue({
    ok: true,
    interventionId: 42,
    priceSnapshot: "85.00",
    durationSnapshot: 60,
    // Panier vide : le total vaut le forfait. `price_snapshot` porte le forfait
    // SEUL, le total porte forfait + produits (T-V3-09).
    total: "85.00",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/// MSW plutôt qu'un mock de module : la BAN est une frontière réseau.
function banRepond(entites: Parameters<typeof reponseBan>[0]) {
  server.use(http.get(BAN_SEARCH_URL, () => reponseBan(entites)));
}

function banNominale() {
  banRepond([entiteBan({ ...ADRESSE_BAN, type: "housenumber" })]);
}

describe("reserver - la garde de session", () => {
  it("n'atteint jamais le corps de l'action sans session", async () => {
    // `authActionClient` place `getCurrentUser` en MIDDLEWARE, donc AVANT le
    // parsing Zod : un appelant anonyme ne doit même pas apprendre la forme du
    // schéma. La redirection de la DAL est ce qui le prouve.
    getCurrentUser.mockImplementation(() => {
      throw Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;push;/connexion;307;",
      });
    });

    await expect(reserver(chargeUtile(CRENEAU_VALIDE))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );

    expect(reserverIntervention).not.toHaveBeenCalled();
    // Aucun appel sortant non plus : le géocodage est PAYANT en latence, et
    // l'anonyme ne doit pas pouvoir s'en servir comme proxy vers la BAN.
    expect(trouverZoneCouvrante).not.toHaveBeenCalled();
  });
});

describe("reserver - l'adresse ne se croit pas sur parole", () => {
  it("écarte les lon/lat de la charge utile au profit du re-géocodage", async () => {
    // DoD T-V3-08 : « un couple lon/lat forgé DANS une zone servie, soumis pour
    // une adresse qui n'y est pas, est refusé ». La propriété était livrée
    // depuis T-V3-06 et n'était exercée par aucun test - c'est la ligne 350 de
    // la tâche.
    banNominale();

    await reserver(
      chargeUtile(CRENEAU_VALIDE, {
        adresse: {
          label: ADRESSE_BAN.label,
          street: ADRESSE_BAN.name,
          postcode: ADRESSE_BAN.postcode,
          city: ADRESSE_BAN.city,
          citycode: ADRESSE_BAN.citycode,
          // Coordonnées forgées : un point arbitraire au milieu d'une zone
          // servie, sans rapport avec le libellé.
          lon: 2.3522,
          lat: 48.8566,
        },
      }),
    );

    expect(trouverZoneCouvrante).toHaveBeenCalledWith({
      lon: ADRESSE_BAN.lon,
      lat: ADRESSE_BAN.lat,
    });
  });

  it("écrit l'adresse RENVOYÉE par la BAN, pas celle qu'on lui a postée", async () => {
    // La voie, le code postal et la commune finissent en base. Les reprendre de
    // la charge utile laisserait un appelant direct écrire « 1 rue Bidon 00000
    // Nulle Part » sur un point pourtant géocodé.
    banRepond([
      entiteBan({
        label: ADRESSE_BAN.label,
        name: "12 Rue de la Bicyclette",
        type: "housenumber",
        postcode: "69003",
        city: "Lyon",
        citycode: "69383",
        lon: ADRESSE_BAN.lon,
        lat: ADRESSE_BAN.lat,
      }),
    ]);

    await reserver(
      chargeUtile(CRENEAU_VALIDE, {
        adresse: {
          label: ADRESSE_BAN.label,
          street: "1 rue Bidon",
          postcode: "00000",
          city: "Nulle Part",
          citycode: "00000",
          lon: 0,
          lat: 0,
        },
      }),
    );

    expect(reserverIntervention).toHaveBeenCalledWith(
      expect.objectContaining({
        adresse: {
          street: "12 Rue de la Bicyclette",
          postcode: "69003",
          city: "Lyon",
          point: { lon: ADRESSE_BAN.lon, lat: ADRESSE_BAN.lat },
        },
      }),
    );
  });

  it("refuse une adresse hors de toute zone, sans repli ni suggestion", async () => {
    // Constitution §2.2 : hors zone est un refus net. Une adresse non couverte
    // BLOQUE la réservation.
    banNominale();
    trouverZoneCouvrante.mockResolvedValue({ ok: false, reason: "hors_zone" });

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(false);
    expect(reserverIntervention).not.toHaveBeenCalled();
  });

  it("distingue le service indisponible de l'adresse introuvable", async () => {
    // `US-ADRESSE-SAISIR` §Cas d'erreur sépare les deux : on répare l'un en
    // réessayant, l'autre en corrigeant sa saisie.
    server.use(
      http.get(BAN_SEARCH_URL, () => new HttpResponse(null, { status: 503 })),
    );
    const panne = await reserver(chargeUtile(CRENEAU_VALIDE));
    expect(panne?.data?.ok).toBe(false);
    if (panne?.data?.ok === false) {
      expect(panne.data.message).toMatch(/indisponible/i);
    }

    // Une réponse vide, ou qui ne contient qu'une VOIE sans numéro : la BAN en
    // renvoie spontanément, et elles ne sont pas réservables.
    banRepond([
      entiteBan({
        label: "Rue de la Bicyclette 69003 Lyon",
        type: "street",
        lon: 4.8321,
        lat: 45.7579,
      }),
    ]);
    const introuvable = await reserver(chargeUtile(CRENEAU_VALIDE));
    expect(introuvable?.data?.ok).toBe(false);
    if (introuvable?.data?.ok === false) {
      expect(introuvable.data.message).toMatch(/introuvable/i);
    }

    expect(reserverIntervention).not.toHaveBeenCalled();
  });
});

describe("reserver - le forfait", () => {
  it("refuse un forfait retiré du catalogue", async () => {
    banNominale();
    serviceFindFirst.mockResolvedValue(null);

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(false);
    if (resultat?.data?.ok === false) {
      expect(resultat.data.message).toMatch(/n'est plus proposé/i);
      // Ce n'est pas un créneau perdu : renvoyer à la grille n'aiderait pas.
      expect(resultat.data.creneauPerdu).toBe(false);
    }
    expect(reserverIntervention).not.toHaveBeenCalled();
  });

  it("ne cherche que parmi les forfaits ACTIFS", async () => {
    // Sans base réelle, la clause est le seul oracle du « forfait inactif ».
    // Elle est vérifiée ici parce qu'un `findUnique(id)` laisserait réserver un
    // forfait désactivé, et qu'aucun autre test du dépôt ne le verrait.
    banNominale();
    await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(serviceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true }),
      }),
    );
  });

  it("dimensionne le créneau sur la durée du forfait", async () => {
    // Constitution §2.1 : « le forfait dicte le créneau ». Avec 120 minutes, le
    // dernier départ du lundi est 16 h 00 locales et non 17 h 00.
    banNominale();
    serviceFindFirst.mockResolvedValue({ duration: 120 });

    const tardif = await reserver(chargeUtile("2026-07-13T15:00:00.000Z"));
    expect(tardif?.data?.ok).toBe(false);

    const dernier = await reserver(chargeUtile("2026-07-13T14:00:00.000Z"));
    expect(dernier?.data?.ok).toBe(true);
  });
});

describe("reserver - le créneau soumis doit exister dans la grille recalculée", () => {
  beforeEach(() => {
    banNominale();
  });

  /// Chaque entrée est un créneau qu'AUCUN écran ne propose. Elles ne sont pas
  /// hypothétiques : la Server Action est un endpoint POST public, et c'est la
  /// seule ligne de défense entre `curl` et `interventions`.
  const HORS_GRILLE: [string, string][] = [
    ["un dimanche, jour de fermeture", "2026-07-19T08:00:00.000Z"],
    ["avant l'heure d'ouverture", "2026-07-13T05:30:00.000Z"],
    ["après le dernier départ possible", "2026-07-13T15:30:00.000Z"],
    ["en dehors du pas de 30 minutes", "2026-07-13T06:10:00.000Z"],
    ["dans le passé", "2026-07-06T06:00:00.000Z"],
    ["au-delà de l'horizon de 30 jours", "2026-08-20T06:00:00.000Z"],
    ["en pleine nuit", "2026-07-14T01:00:00.000Z"],
    ["un samedi après 13 h", "2026-07-18T11:30:00.000Z"],
  ];

  for (const [cas, debut] of HORS_GRILLE) {
    it(`refuse un créneau ${cas}`, async () => {
      const resultat = await reserver(chargeUtile(debut));

      expect(resultat?.data?.ok, cas).toBe(false);
      expect(reserverIntervention, cas).not.toHaveBeenCalled();
    });
  }

  it("accepte le premier créneau de la journée", async () => {
    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(true);
    expect(reserverIntervention).toHaveBeenCalledTimes(1);
  });

  it("accepte le samedi matin, dont les horaires diffèrent", async () => {
    // 09 h 00 locales le samedi 18 juillet.
    const resultat = await reserver(chargeUtile("2026-07-18T07:00:00.000Z"));

    expect(resultat?.data?.ok).toBe(true);
  });

  it("refuse un créneau qu'un autre client vient de prendre", async () => {
    listerTechniciensCharges.mockResolvedValue([
      {
        id: "tech-1",
        occupes: [
          {
            debut: new Date(CRENEAU_VALIDE),
            fin: new Date("2026-07-13T07:00:00.000Z"),
          },
        ],
      },
    ]);

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(false);
    if (resultat?.data?.ok === false) {
      // `creneauPerdu` pilote le retour à la grille côté écran : le confondre
      // avec les autres refus enfermerait le client sur le récapitulatif.
      expect(resultat.data.creneauPerdu).toBe(true);
    }
    expect(reserverIntervention).not.toHaveBeenCalled();
  });

  it("refuse quand la zone n'a aucun technicien affecté", async () => {
    listerTechniciensCharges.mockResolvedValue([]);

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(false);
    expect(reserverIntervention).not.toHaveBeenCalled();
  });

  it("bascule sur le second technicien quand le premier est pris", async () => {
    // Règle écrite de T-V3-08 : premier LIBRE par ordre d'identifiant. Non
    // démontrable en démonstration - le seed n'a qu'un technicien.
    listerTechniciensCharges.mockResolvedValue([
      {
        id: "tech-1",
        occupes: [
          {
            debut: new Date(CRENEAU_VALIDE),
            fin: new Date("2026-07-13T07:00:00.000Z"),
          },
        ],
      },
      { id: "tech-2", occupes: [] },
    ]);

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(true);
    expect(reserverIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ techId: "tech-2" }),
    );
  });
});

describe("reserver - ce qui vient de la session ne vient jamais de la charge utile", () => {
  it("ignore un clientId posté par l'appelant", async () => {
    banNominale();

    await reserver(
      chargeUtile(CRENEAU_VALIDE, {
        clientId: "99999999-9999-4999-8999-999999999999",
        techId: "tech-usurpé",
      }),
    );

    expect(reserverIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT.id, techId: "tech-1" }),
    );
  });

  it("envoie la confirmation à l'adresse de la SESSION", async () => {
    // Il n'y a plus d'email de visiteur à transporter depuis le formulaire
    // (Constitution §3.2 alignée le 2026-08-09). Un destinataire pris dans la
    // charge utile ferait de l'action un relais d'envoi.
    banNominale();

    await reserver(
      chargeUtile(CRENEAU_VALIDE, { email: "attaquant@example.test" }),
    );

    expect(sendReservationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: CLIENT.email }),
    );
  });
});

describe("reserver - le vélo désigné à C5", () => {
  beforeEach(() => {
    banNominale();
  });

  it("transporte le vélo choisi jusqu'à la transaction", async () => {
    await reserver(chargeUtile(CRENEAU_VALIDE, { cycleId: 7 }));

    expect(reserverIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: 7 }),
    );
  });

  it("vaut `null` quand la charge utile n'en porte aucun", async () => {
    // Le défaut du schéma. Il laisse valides les appelants antérieurs au
    // 2026-08-16, et `null` est l'état nominal de la colonne.
    await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(reserverIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ cycleId: null }),
    );
  });

  it("nomme le refus du vélo, sans le confondre avec un refus de stock", async () => {
    // 🔴 `messageEchecStock` ne connaît que les motifs de stock : lui passer
    // `cycle_introuvable` ferait répondre l'écran à côté de la question.
    reserverIntervention.mockResolvedValue({
      ok: false,
      reason: "cycle_introuvable",
    });

    const resultat = await reserver(
      chargeUtile(CRENEAU_VALIDE, { cycleId: 999 }),
    );

    expect(resultat?.data?.ok).toBe(false);
    if (resultat?.data?.ok === false) {
      expect(resultat.data.message).toMatch(/vélo/i);
      // Le créneau n'est pas perdu : rien ne s'est joué dessus, et rafraîchir la
      // grille ferait reprendre un choix qui reste valable.
      expect(resultat.data.creneauPerdu).toBe(false);
    }
    expect(sendReservationEmail).not.toHaveBeenCalled();
  });

  it("refuse un cycleId non entier au schéma, sans atteindre la transaction", async () => {
    const resultat = await reserver(
      chargeUtile(CRENEAU_VALIDE, { cycleId: 1.5 }),
    );

    expect(resultat?.validationErrors).toBeDefined();
    expect(reserverIntervention).not.toHaveBeenCalled();
  });

  // ───────────────────────────────────────────────────────────────────────
  // Ajouts de l'agent testeur, 2026-08-16 - l'anti-énumération.
  // ───────────────────────────────────────────────────────────────────────

  it("rend un refus RIGOUREUSEMENT identique quel que soit l'identifiant sondé", async () => {
    // 🔴 `cycles.id` est un `SERIAL` et cette action est un endpoint POST
    // public : qui incrémente doit obtenir la même réponse sur un vélo qui
    // n'existe pas, sur celui du voisin, et sur un identifiant hors domaine.
    //
    // Le helper ne rend qu'un motif pour les trois cas ; ce qui est vérifié ici
    // est que l'ACTION ne les redifférencie pas en aval - ni par le libellé, ni
    // par `creneauPerdu`, ni par un écho de la valeur sondée.
    reserverIntervention.mockResolvedValue({
      ok: false,
      reason: "cycle_introuvable",
    });

    const reponses = [];
    for (const cycleId of [1, 999, 2_147_483_647]) {
      reponses.push(
        (await reserver(chargeUtile(CRENEAU_VALIDE, { cycleId })))?.data,
      );
    }

    expect(reponses[1]).toEqual(reponses[0]);
    expect(reponses[2]).toEqual(reponses[0]);
  });

  it("n'écho jamais l'identifiant sondé dans le message", async () => {
    // Un libellé qui reprendrait la valeur (« vélo 999 introuvable ») en
    // ferait un oracle de plus : le sondeur saurait que sa valeur a bien été
    // lue jusqu'à la garde, et distinguerait un refus de schéma d'un refus de
    // propriété.
    reserverIntervention.mockResolvedValue({
      ok: false,
      reason: "cycle_introuvable",
    });

    const resultat = await reserver(
      chargeUtile(CRENEAU_VALIDE, { cycleId: 424_242 }),
    );

    expect(resultat?.data?.ok).toBe(false);
    if (resultat?.data?.ok === false) {
      expect(resultat.data.message).not.toMatch(/424242|424 242/);
    }
  });

  it("ne trace ni n'expédie rien sur un vélo refusé", async () => {
    // Une entrée d'audit ou un email partis sur un refus donneraient au sondeur
    // un canal latéral - et à un tiers un message sur un rendez-vous qui n'a
    // jamais existé.
    reserverIntervention.mockResolvedValue({
      ok: false,
      reason: "cycle_introuvable",
    });

    await reserver(chargeUtile(CRENEAU_VALIDE, { cycleId: 999 }));

    expect(dispatchEmail).not.toHaveBeenCalled();
    expect(sendReservationEmail).not.toHaveBeenCalled();
  });

  it("exige une session avant de lire le moindre vélo", async () => {
    // La garde d'authentification passe AVANT tout : sans elle, un anonyme
    // sonderait la table `cycles` en boucle. `authActionClient` la porte, la
    // vérifier ici est ce qui empêche de la perdre au prochain refactor de
    // l'ordre des étapes.
    getCurrentUser.mockResolvedValue(null);

    const resultat = await reserver(
      chargeUtile(CRENEAU_VALIDE, { cycleId: 7 }),
    );

    expect(resultat?.serverError).toBeDefined();
    expect(reserverIntervention).not.toHaveBeenCalled();
  });
});

describe("reserver - la course perdue et l'email", () => {
  beforeEach(() => {
    banNominale();
  });

  it("rend un refus intelligible quand la contrainte d'exclusion arbitre", async () => {
    reserverIntervention.mockResolvedValue({
      ok: false,
      reason: "creneau_pris",
    });

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(false);
    if (resultat?.data?.ok === false) {
      expect(resultat.data.creneauPerdu).toBe(true);
    }
    // Aucune confirmation ne part pour une réservation que la base a refusée.
    expect(sendReservationEmail).not.toHaveBeenCalled();
  });

  it("confirme avec les valeurs FIGÉES, pas avec le catalogue", async () => {
    // Constitution §4.1. L'email doit dire ce qui a été écrit en base, sinon le
    // client reçoit un prix que sa facture ne portera pas.
    reserverIntervention.mockResolvedValue({
      ok: true,
      interventionId: 4242,
      priceSnapshot: "85.00",
      durationSnapshot: 60,
      total: "85.00",
    });

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data).toMatchObject({
      ok: true,
      interventionId: 4242,
      prix: "85.00",
      debut: CRENEAU_VALIDE,
    });
    expect(sendReservationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        interventionId: 4242,
        prix: "85.00",
        dureeMinutes: 60,
      }),
    );
  });

  it("confirme le TOTAL, produits compris, et non le seul forfait", async () => {
    // Le gabarit de l'email veut le « total figé », et `price_snapshot` porte
    // le forfait seul : envoyer ce dernier annoncerait au client une somme
    // inférieure à celle que le technicien encaissera sur place.
    reserverIntervention.mockResolvedValue({
      ok: true,
      interventionId: 4243,
      priceSnapshot: "85.00",
      durationSnapshot: 60,
      total: "97.90",
    });

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data).toMatchObject({ ok: true, prix: "97.90" });
    expect(sendReservationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ prix: "97.90" }),
    );
  });

  it("nomme le produit manquant quand le stock est parti pendant la visite", async () => {
    // Composer un panier ne RETIENT rien. Le refus doit être rattrapable sans
    // support : le client lit ce qui manque et corrige lui-même.
    reserverIntervention.mockResolvedValue({
      ok: false,
      reason: "stock_insuffisant",
      label: "Antivol en U",
      disponible: 2,
    });

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(false);
    if (resultat?.data?.ok === false) {
      expect(resultat.data.message).toBe(
        "Stock insuffisant, quantité maximale : 2.",
      );
      // Le créneau, lui, n'a pas bougé : renvoyer à la grille ferait refaire un
      // pas déjà acquis, et imputerait à un tiers un refus qui vient du panier.
      expect(resultat.data.creneauPerdu).toBe(false);
    }
    expect(sendReservationEmail).not.toHaveBeenCalled();
  });

  it("envoie l'email HORS du chemin de réponse", async () => {
    // Le sort de l'aller-retour SMTP ne doit ni retarder la confirmation, ni
    // annuler une réservation que la base a acceptée (`dispatch.ts:5-27`).
    sendReservationEmail.mockRejectedValue(new Error("SMTP injoignable"));

    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(dispatchEmail).toHaveBeenCalledTimes(1);
    expect(resultat?.data?.ok).toBe(true);
  });
});

describe("reserver - les photos", () => {
  beforeEach(() => {
    banNominale();
  });

  it("transmet les chemins déposés à la transaction de création", async () => {
    const chemins = [
      "uploads/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp",
      "uploads/3f2504e0-4f89-41d3-9a0c-0305e82c3302.webp",
    ];

    await reserver(chargeUtile(CRENEAU_VALIDE, { photos: chemins }));

    expect(reserverIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ photos: chemins }),
    );
  });

  it("refuse la sixième photo avant d'atteindre la base", async () => {
    // Le quota des cinq n'est PAS tenu par le Route Handler d'upload -
    // l'intervention n'existe pas encore à ce moment-là. C'est ici qu'il mord.
    const six = Array.from(
      { length: 6 },
      (_, i) => `uploads/3f2504e0-4f89-41d3-9a0c-0305e82c330${i}.webp`,
    );

    const resultat = await reserver(
      chargeUtile(CRENEAU_VALIDE, { photos: six }),
    );

    expect(resultat?.validationErrors).toBeDefined();
    expect(reserverIntervention).not.toHaveBeenCalled();
  });

  it("refuse un chemin qui n'a pas la forme d'un dépôt", async () => {
    const resultat = await reserver(
      chargeUtile(CRENEAU_VALIDE, {
        photos: ["uploads/../../etc/passwd"],
      }),
    );

    expect(resultat?.validationErrors).toBeDefined();
    expect(reserverIntervention).not.toHaveBeenCalled();
  });

  it("réserve sans photo quand le champ est absent", async () => {
    const resultat = await reserver(chargeUtile(CRENEAU_VALIDE));

    expect(resultat?.data?.ok).toBe(true);
    expect(reserverIntervention).toHaveBeenCalledWith(
      expect.objectContaining({ photos: [] }),
    );
  });
});
