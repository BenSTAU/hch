// @vitest-environment node
//
// Le strip EXIF, attaqué par où `stockage.test.ts` ne passe pas.
//
// Le fichier voisin prouve la propriété sur **un JPEG**. Or `TYPES_ACCEPTES`
// en admet cinq, et les métadonnées de localisation ne sont pas une exclusivité
// du JPEG : le PNG les porte dans un chunk `eXIf`, le WebP dans un chunk `EXIF`,
// et XMP comme l'ICC voyagent dans les trois. Un strip qui ne vaudrait que pour
// le JPEG publierait l'adresse de quelqu'un dès la première photo d'iPhone
// convertie, ou dès le premier envoi depuis un navigateur qui ré-encode en WebP
// avant de poster.
//
// `uploads/` est servi sur un domaine public (PLAN S4 §4.5) : ce qui sort d'ici
// est lisible par n'importe qui.
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_OCTETS, depouiller, enregistrerPhoto } from "./stockage";

/// Coordonnées de la place Bellecour, comme toutes les fixtures du dépôt. Aucune
/// donnée personnelle réelle n'entre ici — le dépôt bascule public.
const GPS = {
  GPSLatitudeRef: "N",
  GPSLatitude: "45/1 45/1 28/1",
  GPSLongitudeRef: "E",
  GPSLongitude: "4/1 49/1 55/1",
};

const MARQUEUR = "HomeCyclHomeFixture";

/// Les formats bitmap que `TYPES_ACCEPTES` admet et que `sharp` sait aussi
/// ENCODER — donc dont on peut fabriquer une fixture porteuse d'EXIF.
///
/// HEIC et HEIF manquent à l'appel, et c'est une limite assumée de ce fichier :
/// la build libvips distribuée avec `sharp` les DÉCODE mais ne les encode pas
/// (licence HEVC). Impossible d'en fabriquer une fixture ici — la couverture du
/// format d'origine des iPhone reste donc à faire, et elle est signalée comme
/// telle plutôt que simulée par un JPEG renommé.
type Format = "jpeg" | "png" | "webp";

/// Fabrique une image d'un format donné, porteuse d'EXIF GPS.
async function imageAvecGps(format: Format): Promise<Buffer> {
  const base = sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 120, g: 180, b: 140 },
    },
  }).withExif({
    IFD0: { Make: MARQUEUR, Model: "Fixture" },
    IFD3: GPS,
  });

  switch (format) {
    case "jpeg":
      return base.jpeg().toBuffer();
    case "png":
      return base.png().toBuffer();
    case "webp":
      return base.webp().toBuffer();
  }
}

const FORMATS: Format[] = ["jpeg", "png", "webp"];

describe("depouiller — les métadonnées disparaissent quel que soit le format d'entrée", () => {
  for (const format of FORMATS) {
    it(`retire l'EXIF GPS d'un ${format.toUpperCase()}`, async () => {
      const entree = await imageAvecGps(format);

      // Contrôle préalable, sans lequel un vert ne prouverait rien : il pourrait
      // n'y avoir jamais eu d'EXIF à retirer dans ce format.
      const avant = await sharp(entree).metadata();
      expect(
        avant.exif,
        `la fixture ${format} doit PORTER de l'EXIF`,
      ).toBeDefined();

      const sortie = await depouiller(entree);
      expect(sortie).not.toBeNull();
      if (!sortie) return;

      const apres = await sharp(sortie).metadata();
      expect(apres.exif, format).toBeUndefined();
      expect(apres.format, format).toBe("webp");

      // Recherche brute dans le tampon : `metadata().exif` ne dit que ce que
      // sharp sait relire, pas ce qui subsiste réellement dans le fichier.
      const octets = sortie.toString("latin1");
      expect(octets, format).not.toContain(MARQUEUR);
      expect(octets, format).not.toContain("GPS");
    });
  }
});

describe("depouiller — les métadonnées qui ne sont pas de l'EXIF", () => {
  it("ne reconduit pas le profil ICC", async () => {
    // L'ICC ne porte pas de position, mais il porte le modèle d'appareil et
    // gonfle chaque fichier de plusieurs kilo-octets. Le ré-encodage n'émet
    // aucune métadonnée sauf demande explicite — cette assertion fige le
    // « sauf demande explicite ».
    const entree = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .withIccProfile("p3")
      .jpeg()
      .toBuffer();

    const avant = await sharp(entree).metadata();
    expect(avant.icc, "la fixture doit PORTER un profil ICC").toBeDefined();

    const sortie = await depouiller(entree);
    expect(sortie).not.toBeNull();
    if (!sortie) return;

    expect((await sharp(sortie).metadata()).icc).toBeUndefined();
  });

  it("ne reconduit pas le bloc XMP", async () => {
    // XMP est le second véhicule de la géolocalisation, et le plus discret :
    // Lightroom, Google Photos et la plupart des applications mobiles y
    // recopient `exif:GPSLatitude` en clair. Retirer l'EXIF sans retirer le XMP
    // ne retirerait rien du tout.
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="45,45.4667N" exif:GPSLongitude="4,49.9167E"/></rdf:RDF></x:xmpmeta><?xpacket end="r"?>`;

    const entree = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .withXmp(xmp)
      .jpeg()
      .toBuffer();

    const avant = await sharp(entree).metadata();
    expect(avant.xmp, "la fixture doit PORTER du XMP").toBeDefined();

    const sortie = await depouiller(entree);
    expect(sortie).not.toBeNull();
    if (!sortie) return;

    expect((await sharp(sortie).metadata()).xmp).toBeUndefined();
    expect(sortie.toString("latin1")).not.toContain("GPSLatitude");
  });

  it("n'hérite pas de l'orientation en la perdant", async () => {
    // `rotate()` sans argument applique l'orientation EXIF PUIS la retire. Sans
    // lui, supprimer les métadonnées coucherait les photos prises à la
    // verticale : l'information vit dans le bloc qu'on supprime. Une image
    // 64×32 marquée « rotation d'un quart de tour » doit ressortir en 32×64.
    const entree = await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      // `withMetadata({ orientation })` et non `withExif` : ce dernier écrit le
      // bloc tel quel sans que sharp le relise comme une orientation, et la
      // fixture ressortait à `orientation: 1` — elle ne posait donc aucune
      // précondition. Constaté en exécutant, d'où le contrôle explicite en
      // dessous.
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const avant = await sharp(entree).metadata();
    expect(
      avant.orientation,
      "la fixture doit PORTER une orientation EXIF",
    ).toBe(6);

    const sortie = await depouiller(entree);
    expect(sortie).not.toBeNull();
    if (!sortie) return;

    const apres = await sharp(sortie).metadata();
    expect(apres.width).toBe(32);
    expect(apres.height).toBe(64);
    expect(apres.orientation).toBeUndefined();
  });
});

describe("depouiller — ce qui ment sur ce qu'il est", () => {
  it("décode par le CONTENU, jamais par l'extension ou le type déclaré", async () => {
    // Le type MIME est trivial à falsifier : c'est le navigateur qui l'annonce.
    // `depouiller` ne le reçoit même pas — il ne voit que des octets. Un PNG
    // présenté comme un JPEG ressort donc dépouillé comme les autres.
    const png = await imageAvecGps("png");

    const sortie = await depouiller(png);
    expect(sortie).not.toBeNull();
    if (!sortie) return;

    expect((await sharp(sortie).metadata()).format).toBe("webp");
    expect((await sharp(sortie).metadata()).exif).toBeUndefined();
  });

  it("ne rend jamais autre chose que du WebP, même pour une entrée exotique", async () => {
    // La propriété qui compte : quoi qu'il entre, ce qui sort est du WebP. Un
    // SVG traversant intact serait servi par `uploads/` avec son `<script>`.
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">` +
        `<script>alert(1)</script><rect width="32" height="32" fill="red"/></svg>`,
    );

    const sortie = await depouiller(svg);

    // Deux issues acceptables et une seule inacceptable : soit sharp refuse
    // (build sans librsvg), soit il rastérise. Dans les deux cas, aucun octet
    // du script ne doit ressortir.
    if (sortie === null) return;
    expect((await sharp(sortie).metadata()).format).toBe("webp");
    expect(sortie.toString("latin1")).not.toContain("script");
  });

  it("refuse une image dont les dimensions déclarées sont absurdes", async () => {
    // Bombe de décompression : un en-tête qui annonce des gigapixels pour
    // quelques octets. `sharp` a une borne (`limitInputPixels`) et lève ;
    // `depouiller` doit la convertir en refus, pas en 500.
    const enTetePng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0x08, 0x02, 0x00, 0x00, 0x00,
    ]);

    expect(await depouiller(enTetePng)).toBeNull();
  });

  it("refuse un fichier tronqué au milieu de l'image", async () => {
    const complet = await imageAvecGps("jpeg");
    const tronque = complet.subarray(0, Math.floor(complet.length / 3));

    expect(await depouiller(tronque)).toBeNull();
  });

  it("refuse une archive déguisée en photo", async () => {
    // `PK\x03\x04` : un ZIP. C'est le contenu qu'on obtient en renommant un
    // `.docx` ou un `.apk` en `.jpg`.
    expect(await depouiller(Buffer.from("PK\u0003\u0004aaaaaaaa"))).toBeNull();
  });
});

/// Les dépôts réellement écrits par les tests ci-dessous, pour les retirer
/// ensuite. `uploads/` est le répertoire de travail RÉEL — `dossierUploads()`
/// le résout depuis `process.cwd()`, et rien ne le redirige pendant les tests.
const ecrits: string[] = [];

const DOSSIER_UPLOADS = path.join(process.cwd(), "uploads");

/// Le dossier préexistait-il à cette suite ?
///
/// La distinction commande le nettoyage. S'il existait, il porte peut-être les
/// dépôts d'une session `pnpm dev` et on ne retire que ses propres fichiers.
/// S'il n'existait pas, c'est cette suite qui l'a créé, et le laisser derrière
/// elle salirait l'arbre de travail — `uploads/` n'est PAS ignoré par Git
/// (constat remonté dans le rapport).
let dossierPreexistant = true;

beforeAll(async () => {
  dossierPreexistant = await stat(DOSSIER_UPLOADS)
    .then(() => true)
    .catch(() => false);
});

afterAll(async () => {
  for (const url of ecrits) {
    await rm(path.join(process.cwd(), url), { force: true });
  }

  if (!dossierPreexistant) {
    await rm(DOSSIER_UPLOADS, { recursive: true, force: true });
  }
});

function fichier(contenu: Buffer | Uint8Array, type: string): File {
  // Recopie en `Uint8Array<ArrayBuffer>` : un `Buffer` Node n'est pas un
  // `BlobPart` du point de vue des types DOM, son tampon pouvant être partagé.
  return new File([new Uint8Array(contenu)], "photo", { type });
}

describe("enregistrerPhoto — le filtre d'entrée", () => {
  const REFUSES = [
    "image/svg+xml",
    "image/gif",
    "image/bmp",
    "application/pdf",
    "text/html",
    "application/octet-stream",
    "",
    // Un paramètre accolé suffit à sortir de la liste : la comparaison est
    // exacte, et c'est le bon défaut — on refuse ce qu'on n'a pas prévu.
    "image/jpeg; charset=utf-8",
  ];

  for (const type of REFUSES) {
    it(`refuse le type déclaré « ${type || "(vide)"} »`, async () => {
      const resultat = await enregistrerPhoto(
        fichier(Buffer.from("peu importe"), type),
      );

      expect(resultat.ok, type).toBe(false);
      if (!resultat.ok) expect(resultat.reason, type).toBe("type_refuse");
    });
  }

  it("voit un type déjà minusculé par la plateforme, et tranche sur le contenu", async () => {
    // Premier jet de ce test : `IMAGE/JPEG` attendu en `type_refuse`, au motif
    // qu'une casse inhabituelle trahirait une requête forgée. L'oracle était
    // FAUX — le constructeur `File` normalise `type` en minuscules (spec File
    // API), si bien que `TYPES_ACCEPTES` voit `image/jpeg` et laisse passer.
    // La casse n'est donc pas un discriminant atteignable, ici ni dans le Route
    // Handler qui reçoit un vrai `File`.
    //
    // Ce que le test doit dire à la place : le refus arrive quand même, une
    // ligne plus bas, parce que c'est le DÉCODAGE qui tranche. Le type déclaré
    // écarte tôt, il n'autorise rien.
    const fichierForge = fichier(Buffer.from("peu importe"), "IMAGE/JPEG");
    expect(fichierForge.type).toBe("image/jpeg");

    const resultat = await enregistrerPhoto(fichierForge);

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.reason).toBe("illisible");
  });

  it("place la borne de poids à 5 Mo STRICTEMENT dépassés", async () => {
    // Un octet de trop est refusé sur le poids, sans être décodé…
    const trop = await enregistrerPhoto(
      fichier(new Uint8Array(MAX_OCTETS + 1), "image/jpeg"),
    );
    expect(trop.ok).toBe(false);
    if (!trop.ok) expect(trop.reason).toBe("trop_lourde");

    // …et le fichier d'exactement 5 Mo passe le quota, pour échouer ensuite au
    // décodage. C'est ce second verdict qui prouve que la borne est `>` et non
    // `>=` : sur `>=`, on lirait encore « trop lourde ».
    const pile = await enregistrerPhoto(
      fichier(new Uint8Array(MAX_OCTETS), "image/jpeg"),
    );
    expect(pile.ok).toBe(false);
    if (!pile.ok) expect(pile.reason).toBe("illisible");
  });

  it("refuse un contenu illisible même sous un type accepté", async () => {
    const resultat = await enregistrerPhoto(
      fichier(Buffer.from("ceci n'est pas une image"), "image/jpeg"),
    );

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.reason).toBe("illisible");
  });
});

describe("enregistrerPhoto — le chemin rendu", () => {
  /// Le motif que `reserverSchema` exige (`src/lib/validations/interventions.ts:52`).
  /// Il est recopié ici À DESSEIN : c'est un contrat entre deux modules, et le
  /// test doit tomber si l'un des deux bouge sans l'autre. Un chemin produit ici
  /// mais refusé là-bas rendrait toute photo déposée inutilisable — sans aucun
  /// message, la validation ne dirait que « Vérifiez les informations saisies ».
  const MOTIF_ATTENDU = /^uploads\/[0-9a-f-]{36}\.webp$/;

  it("rend un chemin que le schéma de réservation accepte", async () => {
    const image = await imageAvecGps("jpeg");
    const resultat = await enregistrerPhoto(fichier(image, "image/jpeg"));

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    ecrits.push(resultat.url);

    expect(resultat.url).toMatch(MOTIF_ATTENDU);
  });

  it("écrit un fichier DÉPOUILLÉ sur le disque, pas seulement en mémoire", async () => {
    // Les six tests voisins prouvent la propriété sur un tampon. Celui-ci la
    // prouve sur ce qui est réellement servi — c'est le fichier du disque qui
    // part sur le domaine public, pas le retour de `depouiller`.
    const image = await imageAvecGps("jpeg");
    const resultat = await enregistrerPhoto(fichier(image, "image/jpeg"));

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    ecrits.push(resultat.url);

    // Lu en tampon plutôt que passé en CHEMIN à `sharp` : sous Windows, sharp
    // garde le descripteur ouvert assez longtemps pour que le `rm` du nettoyage
    // parte en `EBUSY` et fasse échouer la suite entière. Constaté ici même.
    const surDisque = await sharp(
      await readFile(path.join(process.cwd(), resultat.url)),
    ).metadata();

    expect(surDisque.format).toBe("webp");
    expect(surDisque.exif).toBeUndefined();
  });

  it("ne réutilise jamais un nom, même pour deux fois le même contenu", async () => {
    // Un nom dérivé du contenu écraserait la photo d'un autre client dès que
    // deux personnes envoient la même image — celle du catalogue du fabricant,
    // par exemple.
    const image = await imageAvecGps("jpeg");

    const premier = await enregistrerPhoto(fichier(image, "image/jpeg"));
    const second = await enregistrerPhoto(fichier(image, "image/jpeg"));

    expect(premier.ok && second.ok).toBe(true);
    if (!premier.ok || !second.ok) return;
    ecrits.push(premier.url, second.url);

    expect(premier.url).not.toBe(second.url);
  });

  it("n'écrit rien quand le fichier est refusé", async () => {
    // Un refus qui laisserait quand même le fichier sur le disque ferait du
    // Route Handler une écriture arbitraire déguisée en validation.
    const dossier = path.join(process.cwd(), "uploads");
    const avant = await readdir(dossier).catch(() => [] as string[]);

    await enregistrerPhoto(fichier(Buffer.from("pas une image"), "image/png"));
    await enregistrerPhoto(fichier(Buffer.from("pas une image"), "text/html"));

    const apres = await readdir(dossier).catch(() => [] as string[]);
    expect(apres.length).toBe(avant.length);
  });
});

describe("enregistrerPhoto — le dossier de dépôt", () => {
  it("écrit HORS de public/, jamais dans ce que Next sert directement", async () => {
    // `uploads/` est volontairement hors de `public/` : rien n'y doit être servi
    // sans passer par un contrôle. Un dépôt qui atterrirait dans `public/`
    // rendrait chaque fichier accessible par URL devinable dès l'écriture.
    const temoin = path.join(process.cwd(), "public", `${randomUUID()}.webp`);
    await rm(temoin, { force: true });

    const image = await imageAvecGps("jpeg");
    const resultat = await enregistrerPhoto(fichier(image, "image/jpeg"));

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    ecrits.push(resultat.url);

    expect(resultat.url.startsWith("uploads/")).toBe(true);
    expect(resultat.url).not.toContain("public");
  });

  it("garde un chemin RELATIF, jamais absolu", async () => {
    // Il part en base dans `photos.url`, et le préfixe change entre le poste de
    // développement et le conteneur. Un chemin absolu y figerait `C:\Users\...`.
    const image = await imageAvecGps("jpeg");
    const resultat = await enregistrerPhoto(fichier(image, "image/jpeg"));

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    ecrits.push(resultat.url);

    expect(path.isAbsolute(resultat.url)).toBe(false);
    expect(resultat.url).not.toMatch(/^[A-Za-z]:/);
  });
});
