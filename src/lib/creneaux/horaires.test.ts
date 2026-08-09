import { describe, expect, it } from "vitest";

import {
  ajouterJours,
  cleHoraires,
  instantUtc,
  jourLocal,
  jourSemaine,
  lirePlageHoraire,
} from "./horaires";

/// Les deux bascules d'heure de 2026, en Europe centrale :
///   · dimanche 29 mars — 02:00 CET devient 03:00 CEST (une heure disparaît)
///   · dimanche 25 octobre — 03:00 CEST redevient 02:00 CET (une heure double)
/// Ce sont les deux seuls jours de l'année où un décalage figé se trahit.

describe("lirePlageHoraire", () => {
  it("lit une plage bien formée", () => {
    const lecture = lirePlageHoraire("08:00-18:00");

    expect(lecture.ouvert).toBe(true);
    if (!lecture.ouvert) return;
    expect(lecture.plage).toEqual({ debutMinutes: 480, finMinutes: 1080 });
  });

  it("traite la valeur vide et la clé absente comme une fermeture", () => {
    for (const valeur of ["", "   ", null]) {
      const lecture = lirePlageHoraire(valeur);
      expect(lecture).toEqual({ ouvert: false, raison: "ferme" });
    }
  });

  it("distingue une valeur illisible d'une fermeture", () => {
    // La distinction n'est pas cosmétique : « fermé » est une décision de
    // gestion, « invalide » une faute de frappe de l'administrateur. Les
    // confondre ferme la boutique en silence.
    for (const valeur of ["8h-18h", "08:00", "08:00-", "08:00–18:00", "abc"]) {
      const lecture = lirePlageHoraire(valeur);
      expect(lecture, valeur).toEqual({ ouvert: false, raison: "invalide" });
    }
  });

  it("refuse une heure hors cadran", () => {
    for (const valeur of ["25:00-26:00", "08:60-18:00", "08:00-18:99"]) {
      expect(lirePlageHoraire(valeur), valeur).toEqual({
        ouvert: false,
        raison: "invalide",
      });
    }
  });

  it("refuse une plage qui recule ou se referme sur elle-même", () => {
    for (const valeur of ["18:00-08:00", "09:00-09:00"]) {
      expect(lirePlageHoraire(valeur), valeur).toEqual({
        ouvert: false,
        raison: "invalide",
      });
    }
  });
});

describe("instantUtc", () => {
  it("applique +2 h en été et +1 h en hiver", () => {
    // Même heure murale, deux instants différents. C'est précisément ce qu'un
    // décalage figé dans le code manquerait.
    expect(
      instantUtc({ annee: 2026, mois: 7, jour: 13 }, 8 * 60).toISOString(),
    ).toBe("2026-07-13T06:00:00.000Z");

    expect(
      instantUtc({ annee: 2026, mois: 1, jour: 12 }, 8 * 60).toISOString(),
    ).toBe("2026-01-12T07:00:00.000Z");
  });

  it("place correctement les heures de part et d'autre de la bascule de mars", () => {
    // 01:00 est encore en CET, 08:00 est déjà en CEST — le même jour civil.
    expect(
      instantUtc({ annee: 2026, mois: 3, jour: 29 }, 60).toISOString(),
    ).toBe("2026-03-29T00:00:00.000Z");

    expect(
      instantUtc({ annee: 2026, mois: 3, jour: 29 }, 8 * 60).toISOString(),
    ).toBe("2026-03-29T06:00:00.000Z");
  });

  it("place correctement les heures de part et d'autre de la bascule d'octobre", () => {
    // 01:00 est encore en CEST — donc la veille en UTC.
    expect(
      instantUtc({ annee: 2026, mois: 10, jour: 25 }, 60).toISOString(),
    ).toBe("2026-10-24T23:00:00.000Z");

    expect(
      instantUtc({ annee: 2026, mois: 10, jour: 25 }, 8 * 60).toISOString(),
    ).toBe("2026-10-25T07:00:00.000Z");
  });

  it("rend un instant défini pour l'heure qui existe deux fois", () => {
    // 02:30 le 25 octobre est vécu deux fois. Aucune des deux réponses n'est
    // fausse ; ce qui serait fautif, c'est de lever ou de rendre `Invalid Date`.
    const instant = instantUtc({ annee: 2026, mois: 10, jour: 25 }, 150);

    expect(Number.isNaN(instant.getTime())).toBe(false);
    expect([
      "2026-10-25T00:30:00.000Z",
      "2026-10-25T01:30:00.000Z",
    ]).toContain(instant.toISOString());
  });

  it("fait durer 23 h le jour où une heure disparaît", () => {
    // Le test le plus parlant du lot : deux « 08:00 » consécutifs séparés par
    // 23 heures réelles. Un calcul en « +24 h » décalerait toute la grille du
    // lendemain.
    const veille = instantUtc({ annee: 2026, mois: 3, jour: 28 }, 8 * 60);
    const bascule = instantUtc({ annee: 2026, mois: 3, jour: 29 }, 8 * 60);

    const heures = (bascule.getTime() - veille.getTime()) / 3_600_000;
    expect(heures).toBe(23);
  });
});

describe("jourLocal", () => {
  it("rend la date civile locale, pas la date UTC", () => {
    // 23:30 UTC le 12 juillet, c'est déjà le 13 à Lyon. Suivre l'UTC ferait
    // appliquer les horaires de la veille.
    expect(jourLocal(new Date("2026-07-12T23:30:00Z"))).toEqual({
      annee: 2026,
      mois: 7,
      jour: 13,
    });
  });
});

describe("jourSemaine", () => {
  it("nomme le jour de la semaine d'une date civile", () => {
    expect(jourSemaine({ annee: 2026, mois: 7, jour: 13 })).toBe("monday");
    expect(jourSemaine({ annee: 2026, mois: 7, jour: 11 })).toBe("saturday");
    expect(jourSemaine({ annee: 2026, mois: 7, jour: 12 })).toBe("sunday");
  });
});

describe("ajouterJours", () => {
  it("franchit les fins de mois", () => {
    expect(ajouterJours({ annee: 2026, mois: 1, jour: 31 }, 1)).toEqual({
      annee: 2026,
      mois: 2,
      jour: 1,
    });
  });

  it("franchit la fin d'année", () => {
    expect(ajouterJours({ annee: 2026, mois: 12, jour: 31 }, 1)).toEqual({
      annee: 2027,
      mois: 1,
      jour: 1,
    });
  });
});

describe("cleHoraires", () => {
  it("compose la clé attendue par app_settings", () => {
    // Le seed écrit ces clés-là ; une divergence de nom rendrait la grille
    // vide sans aucun message d'erreur.
    expect(cleHoraires("monday")).toBe("business_hours.monday");
    expect(cleHoraires("sunday")).toBe("business_hours.sunday");
  });
});
