import { describe, expect, it } from "vitest";

import {
  affecterCreneaux,
  affecterPremierLibre,
  deriverCreneaux,
  type Creneau,
  type HorairesSemaine,
  type PlageOccupee,
} from "./derivation";
import { FUSEAU_EXPLOITATION, instantUtc, jourLocal } from "./horaires";

/// `deriverCreneaux` attaqué par ses entrées, pas par son chemin nominal.
///
/// Le module est **pur** : rien ne le protège d'une configuration absurde en
/// amont. Les sept clés `business_hours.*` sont éditables par la CRUD
/// d'administration (T-J0-05), `services.duration` par la CRUD catalogue, et ni
/// l'une ni l'autre ne connaît les invariants d'ici. Une plage qui recule, un
/// forfait plus long que la journée ou un pas nul doivent produire une grille
/// vide — jamais une boucle qui ne se termine pas, sur une Server Action
/// publique rafraîchie toutes les 30 secondes.

const SEMAINE = { debutMinutes: 8 * 60, finMinutes: 18 * 60 };

const HORAIRES: HorairesSemaine = {
  monday: SEMAINE,
  tuesday: SEMAINE,
  wednesday: SEMAINE,
  thursday: SEMAINE,
  friday: SEMAINE,
  saturday: { debutMinutes: 9 * 60, finMinutes: 13 * 60 },
  sunday: null,
};

/// Lundi 13 juillet 2026, 02 h 00 à Lyon — avant toute ouverture.
const LUNDI = new Date("2026-07-13T00:00:00Z");

function isos(creneaux: readonly Creneau[]): string[] {
  return creneaux.map((c) => c.debut.toISOString());
}

describe("deriverCreneaux — configurations qui ne devraient jamais exister", () => {
  it("rend une grille vide sur une plage qui recule", () => {
    // `lirePlageHoraire` refuse déjà « 18:00-08:00 », mais `deriverCreneaux` est
    // exporté et prend une `PlageHoraire` directement : il doit se défendre
    // seul. Une borne de boucle mal orientée, ici, tourne à l'infini.
    const creneaux = deriverCreneaux({
      horaires: { monday: { debutMinutes: 18 * 60, finMinutes: 8 * 60 } },
      dureeMinutes: 60,
      maintenant: LUNDI,
      horizonJours: 1,
    });

    expect(creneaux).toEqual([]);
  });

  it("rend une grille vide sur une plage de durée nulle", () => {
    const creneaux = deriverCreneaux({
      horaires: { monday: { debutMinutes: 9 * 60, finMinutes: 9 * 60 } },
      dureeMinutes: 30,
      maintenant: LUNDI,
      horizonJours: 1,
    });

    expect(creneaux).toEqual([]);
  });

  it("rend une grille vide quand le forfait dépasse la journée d'ouverture", () => {
    // Dix heures d'ouverture, forfait de onze heures. Le créneau doit tenir
    // ENTIER avant la fermeture — il n'y a donc aucun départ possible.
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 11 * 60,
      maintenant: LUNDI,
      horizonJours: 7,
    });

    expect(creneaux).toEqual([]);
  });

  it("propose exactement un départ quand le forfait remplit la journée", () => {
    // Le cas limite juste en dessous : dix heures pile dans dix heures
    // d'ouverture. Un `<` au lieu d'un `<=` sur la borne le ferait disparaître.
    const creneaux = deriverCreneaux({
      horaires: { monday: SEMAINE },
      dureeMinutes: 10 * 60,
      maintenant: LUNDI,
      horizonJours: 1,
    });

    expect(isos(creneaux)).toEqual(["2026-07-13T06:00:00.000Z"]);
  });

  it("rend une grille vide sur un pas nul ou négatif", () => {
    // Sans la garde, l'incrément de boucle vaut zéro : la Server Action ne rend
    // jamais la main et emporte le processus avec elle.
    for (const pasMinutes of [0, -30]) {
      const creneaux = deriverCreneaux({
        horaires: HORAIRES,
        dureeMinutes: 60,
        maintenant: LUNDI,
        horizonJours: 1,
        pasMinutes,
      });
      expect(creneaux, String(pasMinutes)).toEqual([]);
    }
  });

  it("rend une grille vide sur un horizon nul ou négatif", () => {
    for (const horizonJours of [0, -5]) {
      const creneaux = deriverCreneaux({
        horaires: HORAIRES,
        dureeMinutes: 60,
        maintenant: LUNDI,
        horizonJours,
      });
      expect(creneaux, String(horizonJours)).toEqual([]);
    }
  });

  it("rend une grille vide quand les sept jours sont fermés", () => {
    // L'état que produit une configuration entièrement effacée depuis l'écran
    // d'administration. La SPEC veut alors le message « aucun créneau », pas une
    // erreur.
    const creneaux = deriverCreneaux({
      horaires: {},
      dureeMinutes: 60,
      maintenant: LUNDI,
      horizonJours: 30,
    });

    expect(creneaux).toEqual([]);
  });

  it("tient un horizon d'un an sans exploser", () => {
    // Rien ne borne `horizonJours` côté appelant hormis la constante. Un ordre
    // de grandeur au-dessus doit rester linéaire, pas quadratique.
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      maintenant: LUNDI,
      horizonJours: 365,
    });

    expect(creneaux.length).toBeGreaterThan(4_000);
    expect(new Set(isos(creneaux)).size).toBe(creneaux.length);
  });
});

describe("deriverCreneaux — invariants de la grille", () => {
  /// Ce que toute grille doit vérifier, quelle que soit l'entrée. Ce sont ces
  /// propriétés que le tunnel suppose : l'écran groupe par jour, la Server
  /// Action cherche une égalité exacte d'instant, et la base refuse un
  /// chevauchement.
  function verifierInvariants(
    creneaux: readonly Creneau[],
    maintenant: Date,
    dureeMinutes: number,
  ) {
    const vus = new Set<number>();

    for (const creneau of creneaux) {
      // Aucun créneau passé : `US-INTERVENTION-RESERVER` ne propose que du
      // futur.
      expect(creneau.debut.getTime()).toBeGreaterThanOrEqual(
        maintenant.getTime(),
      );

      // La durée réelle est celle du forfait, en temps ÉCOULÉ et non en heure
      // murale — c'est elle qui alimente `duration_snapshot`, donc la fenêtre
      // `reservation_range` de la migration 010.
      expect(creneau.fin.getTime() - creneau.debut.getTime()).toBe(
        dureeMinutes * 60_000,
      );

      // Un instant ne peut apparaître qu'une fois : l'écran l'utilise comme clé
      // React (`etape-creneau.tsx:120`) et la Server Action le cherche par
      // égalité. Un doublon donnerait deux boutons pour un seul rendez-vous.
      expect(vus.has(creneau.debut.getTime())).toBe(false);
      vus.add(creneau.debut.getTime());
    }

    // Ordre croissant : l'écran affiche dans l'ordre reçu.
    const instants = creneaux.map((c) => c.debut.getTime());
    expect([...instants].sort((a, b) => a - b)).toEqual(instants);
  }

  it("les tient sur une semaine ordinaire", () => {
    const maintenant = new Date("2026-07-13T09:17:43Z");
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 90,
      maintenant,
      horizonJours: 7,
    });

    expect(creneaux.length).toBeGreaterThan(0);
    verifierInvariants(creneaux, maintenant, 90);
  });

  it("les tient sur un horizon qui franchit la bascule d'octobre", () => {
    // 25 octobre 2026 : une heure locale est vécue DEUX fois. Un décalage figé
    // produirait ici soit un doublon d'instant, soit un trou d'une heure.
    const maintenant = new Date("2026-10-20T05:00:00Z");
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      maintenant,
      horizonJours: 14,
    });

    verifierInvariants(creneaux, maintenant, 60);
  });

  it("les tient sur un horizon qui franchit la bascule de mars", () => {
    // 29 mars 2026 : une heure locale n'existe PAS. C'est le sens de bascule
    // qui fabrique des doublons quand la conversion n'est pas idempotente.
    const maintenant = new Date("2026-03-23T05:00:00Z");
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      maintenant,
      horizonJours: 14,
    });

    verifierInvariants(creneaux, maintenant, 60);
  });

  it("ne dédouble aucun instant quand l'ouverture enjambe l'heure qui n'existe pas", () => {
    // Le 29 mars 2026, 02 h 00 locales n'existe pas : l'horloge saute de 02:00
    // CET à 03:00 CEST. Une ouverture qui enjambe ce trou fait converger DEUX
    // heures murales distinctes vers le MÊME instant UTC.
    //
    // Configuration volontairement artificielle — aucun réparateur n'ouvre à
    // 02 h — mais atteignable : `lirePlageHoraire` accepte « 02:00-05:00 », et
    // la CRUD `app_settings` de T-J0-05 laisse saisir n'importe quelle plage
    // valide. Le module est pur, rien en amont ne l'en protège.
    const dimanche = { debutMinutes: 2 * 60, finMinutes: 5 * 60 };

    const creneaux = deriverCreneaux({
      horaires: { sunday: dimanche },
      dureeMinutes: 30,
      maintenant: new Date("2026-03-29T00:00:00Z"),
      horizonJours: 1,
    });

    const instants = creneaux.map((c) => c.debut.toISOString());
    expect(
      new Set(instants).size,
      `deux heures murales pour un seul instant : ${instants.join(", ")}`,
    ).toBe(instants.length);
  });

  it("garde la même journée de travail de part et d'autre des deux bascules", () => {
    // La boutique ouvre à 08 h 00 LOCALES toute l'année. Le nombre de départs
    // d'un lundi ne doit pas dépendre du mois.
    const compter = (maintenant: Date) =>
      deriverCreneaux({
        horaires: HORAIRES,
        dureeMinutes: 60,
        maintenant,
        horizonJours: 1,
      }).length;

    // Quatre lundis : deux en heure d'été, deux en heure d'hiver.
    expect(compter(new Date("2026-03-23T00:00:00Z"))).toBe(19);
    expect(compter(new Date("2026-03-30T00:00:00Z"))).toBe(19);
    expect(compter(new Date("2026-10-19T00:00:00Z"))).toBe(19);
    expect(compter(new Date("2026-10-26T00:00:00Z"))).toBe(19);
  });

  it("ouvre toujours à 08 h 00 MURALES, quelle que soit la saison", () => {
    // L'assertion que la base ne peut pas faire : `appointment_at` est un
    // instant UTC, et c'est ici que se joue sa correspondance avec l'heure que
    // le client lit à l'écran.
    for (const [jour, attendu] of [
      ["2026-03-23T00:00:00Z", "2026-03-23T07:00:00.000Z"],
      ["2026-03-30T00:00:00Z", "2026-03-30T06:00:00.000Z"],
      ["2026-10-19T00:00:00Z", "2026-10-19T06:00:00.000Z"],
      ["2026-10-26T00:00:00Z", "2026-10-26T07:00:00.000Z"],
    ] as const) {
      const creneaux = deriverCreneaux({
        horaires: HORAIRES,
        dureeMinutes: 60,
        maintenant: new Date(jour),
        horizonJours: 1,
      });
      expect(isos(creneaux)[0], jour).toBe(attendu);
    }
  });

  it("place chaque créneau à l'heure murale que l'écran affichera", () => {
    // Le contrôle croisé de la propriété précédente, sur toute la grille : on
    // re-projette chaque instant en heure locale et on vérifie qu'il tombe bien
    // dans la plage d'ouverture. C'est l'écart « grille affichée ↔
    // reservation_range » que ce test rendrait visible.
    const maintenant = new Date("2026-10-20T05:00:00Z");
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      maintenant,
      horizonJours: 14,
    });

    const heureLocale = new Intl.DateTimeFormat("fr-FR", {
      timeZone: FUSEAU_EXPLOITATION,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    for (const creneau of creneaux) {
      const [h, m] = heureLocale.format(creneau.debut).split(":").map(Number);
      const minutes = (h ?? 0) * 60 + (m ?? 0);

      const jour = jourLocal(creneau.debut);
      const attendue = instantUtc(jour, minutes);
      expect(attendue.getTime()).toBe(creneau.debut.getTime());

      // Toujours dans une plage d'ouverture — jamais 03 h du matin.
      expect(minutes).toBeGreaterThanOrEqual(8 * 60);
      expect(minutes).toBeLessThanOrEqual(17 * 60);
    }
  });
});

describe("deriverCreneaux — chevauchements partiels", () => {
  /// Le créneau nominal du lundi : 09 h 00 → 10 h 00 locales.
  const NEUF_HEURES = "2026-07-13T07:00:00.000Z";

  function avecOccupation(occupes: PlageOccupee[]): string[] {
    return isos(
      deriverCreneaux({
        horaires: HORAIRES,
        dureeMinutes: 60,
        occupes,
        maintenant: LUNDI,
        horizonJours: 1,
      }),
    );
  }

  it("écarte un créneau que l'occupation recouvre exactement", () => {
    expect(
      avecOccupation([
        {
          debut: new Date(NEUF_HEURES),
          fin: new Date("2026-07-13T08:00:00.000Z"),
        },
      ]),
    ).not.toContain(NEUF_HEURES);
  });

  it("écarte un créneau dont l'occupation ne mord que la FIN", () => {
    // L'occupation commence à 09 h 30 : le créneau 09 h 00-10 h 00 est mordu sur
    // sa seconde moitié. Une comparaison sur le seul début le laisserait passer.
    expect(
      avecOccupation([
        {
          debut: new Date("2026-07-13T07:30:00.000Z"),
          fin: new Date("2026-07-13T08:30:00.000Z"),
        },
      ]),
    ).not.toContain(NEUF_HEURES);
  });

  it("écarte un créneau dont l'occupation ne mord que le DÉBUT", () => {
    // Occupation 08 h 30-09 h 30, créneau 09 h 00-10 h 00.
    expect(
      avecOccupation([
        {
          debut: new Date("2026-07-13T06:30:00.000Z"),
          fin: new Date("2026-07-13T07:30:00.000Z"),
        },
      ]),
    ).not.toContain(NEUF_HEURES);
  });

  it("écarte un créneau strictement contenu dans l'occupation", () => {
    // Une intervention longue de la veille au soir, ou un forfait de 4 h posé
    // par un autre client : elle avale des créneaux entiers.
    expect(
      avecOccupation([
        {
          debut: new Date("2026-07-13T06:00:00.000Z"),
          fin: new Date("2026-07-13T10:00:00.000Z"),
        },
      ]),
    ).not.toContain(NEUF_HEURES);
  });

  it("écarte un créneau qui contient strictement l'occupation", () => {
    // Occupation de 15 minutes au milieu du créneau. C'est le cas que seul un
    // test d'intersection attrape — deux bornes comparées séparément le ratent.
    expect(
      avecOccupation([
        {
          debut: new Date("2026-07-13T07:15:00.000Z"),
          fin: new Date("2026-07-13T07:30:00.000Z"),
        },
      ]),
    ).not.toContain(NEUF_HEURES);
  });

  it("garde les créneaux qui se TOUCHENT sans se chevaucher", () => {
    // Bornes `[début, fin[`, comme le `'[)'` du tstzrange de la migration 010.
    // Une convention `[]` retirerait silencieusement un rendez-vous par heure.
    const grille = avecOccupation([
      {
        debut: new Date("2026-07-13T06:00:00.000Z"),
        fin: new Date(NEUF_HEURES),
      },
    ]);

    expect(grille).toContain(NEUF_HEURES);
  });

  it("garde un créneau qu'une occupation d'un autre jour ne concerne pas", () => {
    expect(
      avecOccupation([
        {
          debut: new Date("2026-07-14T07:00:00.000Z"),
          fin: new Date("2026-07-14T08:00:00.000Z"),
        },
      ]),
    ).toContain(NEUF_HEURES);
  });

  it("supporte une occupation à durée nulle sans écarter personne", () => {
    // `duration_snapshot` vaut zéro sur une ligne mal écrite : la plage est
    // vide, elle ne chevauche rien. Elle ne doit surtout pas tout écarter.
    expect(
      avecOccupation([
        { debut: new Date(NEUF_HEURES), fin: new Date(NEUF_HEURES) },
      ]),
    ).toContain(NEUF_HEURES);
  });

  it("vide la journée quand l'occupation couvre toute l'ouverture", () => {
    expect(
      avecOccupation([
        {
          debut: new Date("2026-07-13T00:00:00.000Z"),
          fin: new Date("2026-07-14T00:00:00.000Z"),
        },
      ]),
    ).toEqual([]);
  });
});

describe("affecterCreneaux — la zone et ses techniciens", () => {
  const CRENEAU: Creneau = {
    debut: new Date("2026-07-13T08:00:00Z"),
    fin: new Date("2026-07-13T09:00:00Z"),
  };

  it("ne sert personne quand la zone n'a aucun technicien", () => {
    // Constitution §2.2 : une zone sans technicien affecté ne couvre rien. Elle
    // existe pourtant en base — rien n'oblige l'administrateur à affecter
    // quelqu'un en dessinant un polygone.
    const grille = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      maintenant: LUNDI,
      horizonJours: 7,
    });

    expect(grille.length).toBeGreaterThan(0);
    expect(affecterCreneaux(grille, [])).toEqual([]);
  });

  it("garde un ordre d'affectation STABLE entre deux appels", () => {
    // Le créneau ne doit pas changer de technicien entre l'affichage de la
    // grille et la validation : `reserver` re-résout l'affectation à
    // l'écriture, et une règle instable ferait réserver chez quelqu'un d'autre
    // que celui dont on a vérifié la disponibilité.
    const techniciens = [
      { id: "tech-a", occupes: [] },
      { id: "tech-b", occupes: [] },
    ];

    const premier = affecterCreneaux([CRENEAU], techniciens);
    const second = affecterCreneaux([CRENEAU], techniciens);

    expect(premier[0]?.techId).toBe(second[0]?.techId);
    expect(premier[0]?.techId).toBe("tech-a");
  });

  it("ne retient que les créneaux qu'au moins un technicien peut prendre", () => {
    const occupes = [{ debut: CRENEAU.debut, fin: CRENEAU.fin }];

    expect(
      affecterCreneaux(
        [CRENEAU],
        [
          { id: "tech-a", occupes },
          { id: "tech-b", occupes },
        ],
      ),
    ).toEqual([]);
  });

  it("ne se laisse pas désigner un technicien par une liste vide d'occupations manquante", () => {
    // `occupes` est `readonly PlageOccupee[]` : une liste vide est un technicien
    // entièrement libre, jamais un technicien indisponible.
    expect(affecterPremierLibre(CRENEAU, [{ id: "tech-a", occupes: [] }])).toBe(
      "tech-a",
    );
  });
});
