import { describe, expect, it } from "vitest";

import { deriverCreneaux, type HorairesSemaine } from "./derivation";

/// Horaires de référence, ceux du seed : semaine 08:00-18:00, samedi matin,
/// dimanche fermé. Heures LOCALES — c'est tout l'enjeu des assertions en `Z`
/// ci-dessous.
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

/// Lundi 13 juillet 2026, 02:00 à Lyon — avant l'ouverture, donc aucun créneau
/// n'est écarté comme passé.
const LUNDI_ETE = new Date("2026-07-13T00:00:00Z");

function heuresUtc(creneaux: { debut: Date }[]): string[] {
  return creneaux.map((c) => c.debut.toISOString());
}

describe("deriverCreneaux", () => {
  it("découpe la journée au pas de 30 minutes, dernier créneau terminé avant la fermeture", () => {
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      occupes: [],
      maintenant: LUNDI_ETE,
      horizonJours: 1,
    });

    // 08:00 → 17:00 inclus, par pas de 30 : dix-neuf créneaux. Le suivant
    // (17:30) finirait à 18:30, après la fermeture.
    expect(creneaux).toHaveLength(19);
    expect(heuresUtc(creneaux)[0]).toBe("2026-07-13T06:00:00.000Z");
    expect(heuresUtc(creneaux).at(-1)).toBe("2026-07-13T15:00:00.000Z");
  });

  it("refuse de proposer un créneau qui déborderait la fermeture", () => {
    // Samedi 09:00-13:00, forfait de 2 h : le dernier départ possible est 11:00.
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 120,
      occupes: [],
      maintenant: new Date("2026-07-11T00:00:00Z"),
      horizonJours: 1,
    });

    expect(creneaux).toHaveLength(5);
    expect(heuresUtc(creneaux).at(-1)).toBe("2026-07-11T09:00:00.000Z");
  });

  it("ne propose rien un jour de fermeture", () => {
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      occupes: [],
      maintenant: new Date("2026-07-12T00:00:00Z"),
      horizonJours: 1,
    });

    expect(creneaux).toEqual([]);
  });

  it("aligne le premier créneau sur le pas, pas sur l'heure d'ouverture", () => {
    const creneaux = deriverCreneaux({
      horaires: { monday: { debutMinutes: 8 * 60 + 15, finMinutes: 18 * 60 } },
      dureeMinutes: 60,
      occupes: [],
      maintenant: LUNDI_ETE,
      horizonJours: 1,
    });

    // Ouverture à 08:15, premier créneau à 08:30 — soit 06:30 UTC en été.
    expect(heuresUtc(creneaux)[0]).toBe("2026-07-13T06:30:00.000Z");
  });

  it("écarte les créneaux qui chevauchent une intervention déjà planifiée", () => {
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      occupes: [
        // 09:00-10:00 locales.
        {
          debut: new Date("2026-07-13T07:00:00Z"),
          fin: new Date("2026-07-13T08:00:00Z"),
        },
      ],
      maintenant: LUNDI_ETE,
      horizonJours: 1,
    });

    // Trois départs deviennent impossibles : 08:30, 09:00 et 09:30.
    expect(creneaux).toHaveLength(16);
    expect(heuresUtc(creneaux)).not.toContain("2026-07-13T06:30:00.000Z");
    expect(heuresUtc(creneaux)).not.toContain("2026-07-13T07:30:00.000Z");
  });

  it("laisse réserver un créneau qui touche exactement le précédent", () => {
    // Bornes `[début, fin[` des deux côtés, comme le `'[)'` du tstzrange de la
    // migration 010. Si les deux divergeaient, la grille proposerait un créneau
    // que la contrainte d'exclusion refuserait au dernier écran du tunnel.
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      occupes: [
        {
          debut: new Date("2026-07-13T07:00:00Z"),
          fin: new Date("2026-07-13T08:00:00Z"),
        },
      ],
      maintenant: LUNDI_ETE,
      horizonJours: 1,
    });

    // 10:00 locales démarre à la seconde où l'occupation se termine.
    expect(heuresUtc(creneaux)).toContain("2026-07-13T08:00:00.000Z");
  });

  it("n'offre aucun créneau déjà passé", () => {
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      occupes: [],
      // 11:00 locales.
      maintenant: new Date("2026-07-13T09:00:00Z"),
      horizonJours: 1,
    });

    expect(creneaux).toHaveLength(13);
    expect(heuresUtc(creneaux)[0]).toBe("2026-07-13T09:00:00.000Z");
  });

  it("suit l'heure murale de part et d'autre de la bascule d'octobre", () => {
    // Le cœur du sujet. Deux lundis encadrant le changement d'heure : la
    // boutique ouvre à 08:00 LOCALES les deux fois, donc à deux instants UTC
    // différents. Une grille calculée sur un décalage figé décalerait d'une
    // heure toutes les réservations d'un des deux côtés.
    const avant = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      occupes: [],
      maintenant: new Date("2026-10-19T00:00:00Z"),
      horizonJours: 1,
    });

    const apres = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      occupes: [],
      maintenant: new Date("2026-10-26T00:00:00Z"),
      horizonJours: 1,
    });

    expect(heuresUtc(avant)[0]).toBe("2026-10-19T06:00:00.000Z");
    expect(heuresUtc(apres)[0]).toBe("2026-10-26T07:00:00.000Z");
    // Même nombre de créneaux : la journée de travail n'a pas changé de durée.
    expect(apres).toHaveLength(avant.length);
  });

  it("borne la recherche à l'horizon demandé", () => {
    const creneaux = deriverCreneaux({
      horaires: HORAIRES,
      dureeMinutes: 60,
      occupes: [],
      maintenant: LUNDI_ETE,
      horizonJours: 7,
    });

    // Cinq jours pleins à 19 créneaux, plus le samedi à 7, plus le dimanche
    // fermé.
    expect(creneaux).toHaveLength(19 * 5 + 7);
  });

  it("rend une grille vide plutôt que de boucler sur une durée absurde", () => {
    for (const dureeMinutes of [0, -30]) {
      const creneaux = deriverCreneaux({
        horaires: HORAIRES,
        dureeMinutes,
        occupes: [],
        maintenant: LUNDI_ETE,
        horizonJours: 1,
      });
      expect(creneaux, String(dureeMinutes)).toEqual([]);
    }
  });
});
