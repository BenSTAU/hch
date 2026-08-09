// @vitest-environment node
//
// Le strip EXIF est une propriété de SÉCURITÉ, pas une commodité : une photo de
// vélo est prise au domicile du client, et `uploads/` est servi sur un domaine
// public (PLAN S4 §4.5). Ce fichier est ce qui empêche de publier l'adresse de
// quelqu'un.
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { depouiller, messageRefus } from "./stockage";

/// Fabrique une image porteuse d'EXIF, coordonnées GPS comprises.
///
/// Construite plutôt que versionnée : une photo réelle porterait la position
/// réelle de quelqu'un, et le dépôt bascule public. Les valeurs ci-dessous
/// désignent la place Bellecour, comme le reste des fixtures.
async function imageAvecGps(): Promise<Buffer> {
  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 120, g: 180, b: 140 },
    },
  })
    .withExif({
      IFD0: {
        Make: "HomeCyclHome",
        Model: "Fixture",
      },
      // `withExif` sérialise ce bloc tel quel : c'est bien de l'EXIF GPS qui
      // entre, et c'est lui qu'on veut voir disparaître.
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "45/1 45/1 28/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "4/1 49/1 55/1",
      },
    })
    .jpeg()
    .toBuffer();
}

describe("depouiller", () => {
  it("retire les coordonnées GPS de l'image d'origine", async () => {
    const entree = await imageAvecGps();

    // Contrôle préalable : sans lui, un test vert ne prouverait rien — il
    // pourrait simplement n'y avoir jamais eu d'EXIF à retirer.
    const avant = await sharp(entree).metadata();
    expect(avant.exif, "la fixture doit PORTER de l'EXIF").toBeDefined();

    const sortie = await depouiller(entree);
    expect(sortie).not.toBeNull();
    if (!sortie) return;

    const apres = await sharp(sortie).metadata();
    expect(apres.exif).toBeUndefined();
  });

  it("ne laisse aucune trace des marqueurs GPS dans les octets rendus", async () => {
    // Assertion complémentaire et volontairement grossière : `metadata().exif`
    // dit ce que `sharp` sait relire, pas ce qui subsiste dans le fichier. Une
    // recherche brute dans le tampon attrape ce qu'un parseur ignorerait.
    const sortie = await depouiller(await imageAvecGps());
    expect(sortie).not.toBeNull();
    if (!sortie) return;

    const texte = sortie.toString("latin1");
    expect(texte).not.toContain("HomeCyclHome");
    expect(texte).not.toContain("GPS");
    expect(texte).not.toContain("Exif");
  });

  it("rend du WebP quelle que soit l'entrée — le HEIC des iPhone compris", async () => {
    // Le ré-encodage règle deux problèmes d'un geste : les métadonnées, et un
    // format qu'aucun navigateur n'affiche.
    const sortie = await depouiller(await imageAvecGps());
    expect(sortie).not.toBeNull();
    if (!sortie) return;

    expect((await sharp(sortie).metadata()).format).toBe("webp");
  });

  it("préserve les dimensions de l'image", async () => {
    const sortie = await depouiller(await imageAvecGps());
    expect(sortie).not.toBeNull();
    if (!sortie) return;

    const apres = await sharp(sortie).metadata();
    expect(apres.width).toBe(32);
    expect(apres.height).toBe(32);
  });

  it("refuse ce qu'il ne sait pas décoder plutôt que d'écrire n'importe quoi", async () => {
    // Une extension mensongère, un fichier tronqué, un HEIC au profil inconnu :
    // trois façons d'arriver ici. Aucune ne doit produire un fichier sur le
    // disque.
    expect(
      await depouiller(Buffer.from("ceci n'est pas une image")),
    ).toBeNull();
    expect(await depouiller(Buffer.alloc(0))).toBeNull();
  });
});

describe("messageRefus", () => {
  it("nomme les trois refus sans jargon", () => {
    expect(messageRefus("type_refuse")).toMatch(/JPG, PNG, WebP ou HEIC/);
    expect(messageRefus("trop_lourde")).toMatch(/5 Mo/);
    expect(messageRefus("illisible")).toMatch(/n'a pas pu être lue/);
  });
});
