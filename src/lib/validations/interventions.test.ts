import { describe, expect, it } from "vitest";

import {
  annulerInterventionSchema,
  listerCreneauxSchema,
  reserverSchema,
} from "./interventions";

/// Schémas du domaine `interventions`.
///
/// Le motif de `photos` n'est pas de la validation de confort : c'est une
/// valeur qui vient du CLIENT et qui finit dans `photos.url`, colonne servie
/// ensuite sur un domaine public. Sans lui, un appelant direct de la Server
/// Action y écrirait un chemin de son choix. Ce fichier essaie de le contourner.

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const ADRESSE = {
  label: "12 Rue de la Bicyclette 69003 Lyon",
  street: "12 Rue de la Bicyclette",
  postcode: "69003",
  city: "Lyon",
  citycode: "69383",
  lon: 4.832,
  lat: 45.7578,
};

function reserverAvec(surcharge: Record<string, unknown>) {
  return reserverSchema.safeParse({
    serviceId: 1,
    adresse: ADRESSE,
    debut: "2026-07-13T06:00:00.000Z",
    ...surcharge,
  });
}

describe("reserverSchema — le chemin de photo", () => {
  it("accepte ce que rend réellement le dépôt", () => {
    // La forme exacte de `enregistrerPhoto` : `uploads/<uuid v4>.webp`.
    const resultat = reserverAvec({ photos: [`uploads/${UUID}.webp`] });
    expect(resultat.success).toBe(true);
  });

  /// Chaque entrée est une tentative d'écrire ailleurs que dans `uploads/`, ou
  /// d'y désigner autre chose qu'un dépôt de ce serveur.
  const HOSTILES: [string, string][] = [
    ["traversée relative", "uploads/../../etc/passwd"],
    ["traversée encodée", "uploads/%2e%2e%2f%2e%2e%2fetc%2fpasswd.webp"],
    ["traversée double-encodée", "uploads/%252e%252e%252fx.webp"],
    ["séparateur Windows", "uploads\\..\\..\\windows\\win.ini"],
    ["chemin absolu POSIX", `/uploads/${UUID}.webp`],
    ["chemin absolu Windows", `C:\\uploads\\${UUID}.webp`],
    ["URL absolue", `https://exemple.invalide/${UUID}.webp`],
    ["URL protocol-relative", `//exemple.invalide/${UUID}.webp`],
    ["data URI", "data:image/webp;base64,UklGRg=="],
    ["sous-dossier", `uploads/sous/${UUID}.webp`],
    ["double séparateur", `uploads//${UUID}.webp`],
    ["préfixe voisin", `uploads-public/${UUID}.webp`],
    ["autre dossier", `public/${UUID}.webp`],
    ["extension changée", `uploads/${UUID}.svg`],
    ["double extension", `uploads/${UUID}.webp.svg`],
    ["extension absente", `uploads/${UUID}`],
    ["hexadécimal en capitales", `uploads/${UUID.toUpperCase()}.webp`],
    ["extension en capitales", `uploads/${UUID}.WEBP`],
    ["identifiant trop court", `uploads/${UUID.slice(0, 35)}.webp`],
    ["identifiant trop long", `uploads/${UUID}0.webp`],
    ["caractère hors hexadécimal", `uploads/${UUID.replace("f", "z")}.webp`],
    ["espace de tête", ` uploads/${UUID}.webp`],
    ["espace de queue", `uploads/${UUID}.webp `],
    ["chaîne vide", ""],
  ];

  for (const [cas, chemin] of HOSTILES) {
    it(`refuse : ${cas}`, () => {
      expect(reserverAvec({ photos: [chemin] }).success, cas).toBe(false);
    });
  }

  it("refuse un saut de ligne en fin de chaîne", () => {
    // Le contournement classique d'un `$` d'ancrage dans les moteurs qui
    // tolèrent le saut de ligne final. JavaScript ne le tolère pas — mais
    // l'écrire ici fige la propriété plutôt que de la supposer, et signalerait
    // un jour où le motif basculerait en `m`.
    expect(reserverAvec({ photos: [`uploads/${UUID}.webp\n`] }).success).toBe(
      false,
    );
    expect(
      reserverAvec({ photos: [`uploads/${UUID}.webp\nuploads/x`] }).success,
    ).toBe(false);
  });

  it("refuse un octet nul", () => {
    expect(
      reserverAvec({ photos: [`uploads/${UUID}.webp\u0000`] }).success,
    ).toBe(false);
    expect(
      reserverAvec({ photos: [`uploads/${UUID}.webp\u0000.svg`] }).success,
    ).toBe(false);
  });

  it("refuse un chemin qui n'est pas une chaîne", () => {
    // Une charge utile JSON n'a aucune obligation d'envoyer des chaînes.
    for (const valeur of [null, 42, {}, [], true]) {
      expect(reserverAvec({ photos: [valeur] }).success, String(valeur)).toBe(
        false,
      );
    }
    expect(reserverAvec({ photos: "uploads/x.webp" }).success).toBe(false);
  });

  it("plafonne à cinq photos, et compte les doublons", () => {
    const cinq = Array.from(
      { length: 5 },
      (_, i) => `uploads/${UUID.slice(0, 35)}${i}.webp`,
    );
    expect(reserverAvec({ photos: cinq }).success).toBe(true);

    expect(
      reserverAvec({ photos: [...cinq, `uploads/${UUID}.webp`] }).success,
    ).toBe(false);

    // Le même chemin six fois reste six entrées : le plafond porte sur la
    // taille du tableau, pas sur le nombre de fichiers distincts.
    const memeSixFois = Array.from({ length: 6 }, () => `uploads/${UUID}.webp`);
    expect(reserverAvec({ photos: memeSixFois }).success).toBe(false);
  });

  it("réserve sans photo quand le champ est absent", () => {
    const resultat = reserverAvec({});
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.photos).toEqual([]);
  });
});

describe("reserverSchema — le reste de la charge utile", () => {
  it("écarte les champs que le schéma ne déclare pas", () => {
    // `client_id` vient de la SESSION. S'il passait par le schéma, il
    // arriverait jusqu'à `reserverIntervention`.
    const resultat = reserverAvec({
      clientId: "99999999-9999-4999-8999-999999999999",
      techId: "tech-usurpé",
      zoneId: 1,
    });

    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data).not.toHaveProperty("clientId");
      expect(resultat.data).not.toHaveProperty("techId");
      // La zone se recalcule côté serveur (Constitution §2.2) : l'accepter ici
      // contournerait la sectorisation.
      expect(resultat.data).not.toHaveProperty("zoneId");
    }
  });

  it("refuse un identifiant de forfait qui n'est pas un entier positif", () => {
    for (const serviceId of [0, -1, 1.5, "1", null, Number.NaN]) {
      expect(reserverAvec({ serviceId }).success, String(serviceId)).toBe(
        false,
      );
    }
  });

  it("refuse un instant illisible", () => {
    for (const debut of ["", "pas une date", "2026-13-45T99:99:99Z", null, 0]) {
      expect(reserverAvec({ debut }).success, String(debut)).toBe(false);
    }
  });

  it("convertit l'instant une seule fois, à la frontière", () => {
    // `Date` ne survit pas à la sérialisation d'une Server Action : la chaîne
    // est validée, puis transformée ici et nulle part ailleurs.
    const resultat = reserverAvec({ debut: "2026-07-13T06:00:00.000Z" });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.debut).toBeInstanceOf(Date);
      expect(resultat.data.debut.toISOString()).toBe(
        "2026-07-13T06:00:00.000Z",
      );
    }
  });

  it("accepte un instant décalé équivalent", () => {
    // 08 h 00 à Paris en été, c'est le même instant que 06:00Z. Refuser cette
    // écriture rendrait le tunnel dépendant du format produit par le navigateur.
    const resultat = reserverAvec({ debut: "2026-07-13T08:00:00+02:00" });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.debut.toISOString()).toBe(
        "2026-07-13T06:00:00.000Z",
      );
    }
  });

  it("exige une adresse complète", () => {
    expect(reserverAvec({ adresse: undefined }).success).toBe(false);
    expect(reserverAvec({ adresse: { ...ADRESSE, label: "" } }).success).toBe(
      false,
    );
    expect(
      reserverAvec({ adresse: { ...ADRESSE, postcode: "6900" } }).success,
    ).toBe(false);
    expect(reserverAvec({ adresse: { ...ADRESSE, lat: 91 } }).success).toBe(
      false,
    );
  });
});

describe("listerCreneauxSchema", () => {
  it("accepte un couple forfait/zone bien formé", () => {
    expect(
      listerCreneauxSchema.safeParse({ serviceId: 1, zoneId: 7 }).success,
    ).toBe(true);
  });

  it("refuse des identifiants qui ne sont pas des entiers positifs", () => {
    for (const valeur of [0, -3, 2.5, "7", null]) {
      expect(
        listerCreneauxSchema.safeParse({ serviceId: 1, zoneId: valeur })
          .success,
        String(valeur),
      ).toBe(false);
    }
  });
});

describe("annulerInterventionSchema", () => {
  const VALIDE = { interventionId: 847, motif: "Empechement" };

  it("accepte un motif renseigne", () => {
    expect(annulerInterventionSchema.safeParse(VALIDE).success).toBe(true);
  });

  it("refuse un motif vide, absent ou fait d'espaces", () => {
    // « Motif d'annulation requis » est un cas d'erreur de l'US. Le `trim`
    // precede le `min` : sans lui, une suite d'espaces satisfait la longueur et
    // s'ecrit en base comme un motif vide - le technicien lirait une chaine
    // blanche la ou l'US lui promet une explication.
    for (const motif of ["", "   ", "  \n\t ", undefined]) {
      expect(
        annulerInterventionSchema.safeParse({ ...VALIDE, motif }).success,
        JSON.stringify(motif),
      ).toBe(false);
    }
  });

  it("rogne les espaces autour du motif retenu", () => {
    const lecture = annulerInterventionSchema.safeParse({
      ...VALIDE,
      motif: "   Report   ",
    });

    expect(lecture.success && lecture.data.motif).toBe("Report");
  });

  it("refuse un motif au-dela du plafond", () => {
    // Le plafond ne vient d'aucune source - `cancellation_reason` est un TEXT
    // sans contrainte. Il est arbitre, et le test le rend explicite plutot que
    // de laisser une colonne sans borne recevoir ce qu'un appelant direct
    // voudrait y ecrire.
    expect(
      annulerInterventionSchema.safeParse({ ...VALIDE, motif: "x".repeat(501) })
        .success,
    ).toBe(false);
    expect(
      annulerInterventionSchema.safeParse({ ...VALIDE, motif: "x".repeat(500) })
        .success,
    ).toBe(true);
  });

  it("refuse un identifiant qui n'est pas un entier positif", () => {
    for (const valeur of [0, -3, 2.5, "847", null]) {
      expect(
        annulerInterventionSchema.safeParse({
          ...VALIDE,
          interventionId: valeur,
        }).success,
        String(valeur),
      ).toBe(false);
    }
  });
});
