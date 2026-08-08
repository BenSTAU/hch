import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/// Preuve de la sectorisation géographique — T-V3-01.
///
/// Ce fichier ne pilote aucune page : il interroge PostGIS. Il vit ici parce
/// que le projet `barriere` est la SEULE surface de la CI qui dispose d'un
/// vrai PostGIS seedé (job `e2e`, `docker-compose.test.yml`). `pnpm test`
/// tourne sous Vitest en jsdom, sans base : la même vérification y serait
/// rouge, ou silencieusement sautée — pire.
///
/// ADR-014 §3 rattachait cette preuve au `globalSetup` Playwright et à
/// `GP-04 admin-creation-zone`, qui appartient à la vague V1. T-V3-01 en a
/// besoin maintenant : c'est sa DoD qui l'exige, et le seed qu'elle vérifie
/// existe déjà. Écart signalé, pas absorbé.
///
/// Localement, Playwright lève `pnpm dev` avant de jouer ce fichier alors
/// qu'aucun test n'en a besoin — conséquence du `webServer` conditionnel de
/// `playwright.config.ts`. Sans gravité, et `reuseExistingServer` l'évite dès
/// qu'un serveur tourne.

/// La zone seedée par `prisma/seed.ts`. Le tracé, lui, n'est PAS recopié ici :
/// le sommet de la frontière est demandé à la base (cf. plus bas), pour que ce
/// fichier reste vrai si le polygone change.
const ZONE = "Lyon";

/// Place Bellecour — au cœur de la presqu'île, à bonne distance de toute
/// frontière communale.
const DANS_LA_ZONE = { lon: 4.832, lat: 45.7578 };

/// Villeurbanne, commune limitrophe à l'est. Environ 1,7 km au-delà du bord
/// est du polygone : la marge est assez large pour qu'un affinement du tracé
/// ne fasse pas basculer le verdict.
const HORS_ZONE = { lon: 4.895, lat: 45.776 };

let db: PrismaClient;

test.beforeAll(() => {
  db = new PrismaClient();
});

test.afterAll(async () => {
  await db.$disconnect();
});

/// `ST_MakePoint` attend des `double precision`. Les paramètres liés par
/// Prisma arrivent sans type déclaré et Postgres refuse alors de trancher —
/// d'où les casts explicites, qui ne sont pas décoratifs.
async function estCouvert(point: {
  lon: number;
  lat: number;
}): Promise<boolean> {
  const lignes = await db.$queryRaw<{ couvert: boolean }[]>`
    SELECT ST_Covers(
             "area",
             ST_SetSRID(
               ST_MakePoint(${point.lon}::double precision, ${point.lat}::double precision),
               4326
             )::geography
           ) AS couvert
      FROM zones
     WHERE "name" = ${ZONE}
  `;

  const ligne = lignes[0];
  if (!ligne) {
    throw new Error(
      `Aucune zone « ${ZONE} » en base. Le seed n'a pas tourné sur cette ` +
        "base, ou il a échoué avant d'insérer la zone.",
    );
  }
  return ligne.couvert;
}

test("une adresse dans la zone est couverte, une adresse hors zone ne l'est pas", async () => {
  expect(await estCouvert(DANS_LA_ZONE)).toBe(true);
  expect(await estCouvert(HORS_ZONE)).toBe(false);
});

test("un point exactement sur la frontière est couvert — c'est le motif du choix de ST_Covers", async () => {
  // Le point testé est un SOMMET du polygone, lu depuis la base. Un milieu
  // d'arête ne conviendrait pas : en `geography` les arêtes sont des
  // géodésiques, pas des segments droits en lon/lat, et un point « visuellement
  // sur la frontière » tombe alors d'un côté ou de l'autre. Un sommet, lui,
  // appartient à l'anneau sous n'importe quelle interprétation.
  const lignes = await db.$queryRaw<
    { couvert: boolean; contenu: boolean; wkt: string }[]
  >`
    WITH z AS (
      SELECT "area",
             ST_PointN(ST_ExteriorRing("area"::geometry), 1) AS sommet
        FROM zones
       WHERE "name" = ${ZONE}
    )
    SELECT ST_Covers("area", sommet::geography) AS couvert,
           ST_Contains("area"::geometry, sommet) AS contenu,
           ST_AsText(sommet)                     AS wkt
      FROM z
  `;

  const ligne = lignes[0];
  expect(ligne, `Aucune zone « ${ZONE} » en base.`).toBeDefined();
  if (!ligne) return;

  // `ST_Covers` inclut la frontière.
  expect(ligne.couvert, `sommet testé : ${ligne.wkt}`).toBe(true);

  // `ST_Contains` l'exclut — même géométrie, même point, verdict inverse.
  // C'est exactement l'écart qui a fait retenir `ST_Covers` au cadrage amont
  // V3 : une zone de service dessinée le long d'une rue a des adresses sur sa
  // frontière, et elles doivent être servies.
  //
  // Le test passe par `::geometry` parce que `ST_Contains` n'a AUCUNE
  // signature `geography` (doc PostGIS §13.4) — second motif du même choix, et
  // la raison pour laquelle la question ne se pose plus une fois le type
  // tranché.
  expect(ligne.contenu, `sommet testé : ${ligne.wkt}`).toBe(false);
});

test("le référentiel seedé porte la zone, le technicien affecté, 3 forfaits et 3 produits", async () => {
  const [zones, forfaits, produits] = await Promise.all([
    db.zone.count(),
    db.service.count(),
    db.product.count(),
  ]);

  expect(zones).toBeGreaterThanOrEqual(1);
  expect(forfaits).toBeGreaterThanOrEqual(3);
  expect(produits).toBeGreaterThanOrEqual(3);

  // L'affectation est ce qui rend le pool de créneaux non vide : sans
  // technicien sur la zone, le tunnel de réservation n'a rien à proposer
  // (Constitution §2.1).
  const affectations = await db.technicianZone.findMany({
    include: { user: true, zone: true },
  });
  expect(affectations.length).toBeGreaterThanOrEqual(1);
  for (const affectation of affectations) {
    expect(affectation.user.roles).toContain("ROLE_TECH");
  }
});

test("le trigger check_technician_role() refuse d'affecter un non-technicien", async () => {
  // Second filet de PLAN S2 §5.3, et le SEUL qui existe aujourd'hui : le garde
  // applicatif vit dans la Server Action d'affectation, qui naîtra en V1
  // admin. Le vérifier n'est pas du zèle — un trigger jamais mis en échec ne
  // prouve rien, le seed ne présentant que des cas valides.
  const admin = await db.user.findFirstOrThrow({
    where: { roles: { has: "ROLE_ADMIN" } },
  });
  const zone = await db.zone.findFirstOrThrow();

  // L'insertion échoue, donc elle ne laisse aucune ligne derrière elle.
  await expect(
    db.technicianZone.create({ data: { userId: admin.id, zoneId: zone.id } }),
  ).rejects.toThrow(/does not have ROLE_TECH or is not active/);
});
