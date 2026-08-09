import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/// Sectorisation d'une adresse — T-V3-06.
///
/// Ce fichier ne pilote aucune page : il interroge PostGIS, comme
/// `sectorisation-geo.spec.ts` et pour la même raison — le projet `barriere`
/// est la seule surface de la CI qui dispose d'un vrai PostGIS seedé. `pnpm
/// test` tourne sous Vitest en jsdom, sans base.
///
/// **Ce qu'il prouve et ce qu'il ne prouve pas.** La requête ci-dessous est
/// celle de `src/lib/geo/postgis.ts`, recopiée. Elle ne peut pas être importée :
/// le module porte `import 'server-only'`, dont Playwright n'a pas la condition
/// de résolution — seul Vitest le neutralise, et Vitest n'a pas de base. Le test
/// atteste donc la **sémantique SQL** du helper, pas l'exécution de son corps.
/// Écart signalé, pas absorbé.
///
/// La seconde moitié de la règle « les lon/lat du client ne font jamais foi »
/// vit dans `src/lib/geo/ban.test.ts` : le point retenu est celui que la BAN
/// attribue au libellé. Les deux moitiés réunies couvrent la propriété ; aucune
/// ne la couvre seule.

/// Place Bellecour, au cœur de la zone seedée.
const DANS_LA_ZONE = { lon: 4.832, lat: 45.7578 };

/// Villeurbanne, environ 1,7 km au-delà du bord est du polygone. La marge est
/// assez large pour qu'un affinement du tracé ne fasse pas basculer le verdict.
const HORS_ZONE = { lon: 4.895, lat: 45.776 };

/// Plein Atlantique : des coordonnées parfaitement valides au sens WGS84, que
/// `adresseSelectionneeSchema` accepte sans broncher. C'est le rappel que la
/// validation de forme ne sectorise rien.
const COORDONNEES_FORGEES = { lon: -30, lat: 0 };

let db: PrismaClient;

test.beforeAll(() => {
  db = new PrismaClient();
});

test.afterAll(async () => {
  await db.$disconnect();
});

/// Réplique de `trouverZoneCouvrante`, casts compris. Les `::double precision`
/// ne sont pas décoratifs : Prisma lie ses paramètres sans type déclaré, et
/// Postgres refuse alors de choisir une signature pour `ST_MakePoint`.
async function zoneCouvrante(point: {
  lon: number;
  lat: number;
}): Promise<{ id: number; name: string } | null> {
  const lignes = await db.$queryRaw<{ id: number; name: string }[]>`
    SELECT "id", "name"
      FROM zones
     WHERE ST_Covers(
             "area",
             ST_SetSRID(
               ST_MakePoint(${point.lon}::double precision, ${point.lat}::double precision),
               4326
             )::geography
           )
     ORDER BY "id"
     LIMIT 1
  `;

  return lignes[0] ?? null;
}

test("une adresse dans une zone servie retourne la zone qui la couvre", async () => {
  const zone = await zoneCouvrante(DANS_LA_ZONE);

  expect(
    zone,
    "Aucune zone ne couvre la place Bellecour : le seed n'a pas tourné sur cette base.",
  ).not.toBeNull();
  // Le nom accompagne l'identifiant parce que c'est la zone qui portera le
  // technicien affecté au moment de dériver les créneaux (Constitution §2.1).
  expect(zone?.name).toBeTruthy();
});

test("une adresse hors zone ne retourne aucune zone", async () => {
  expect(await zoneCouvrante(HORS_ZONE)).toBeNull();
});

test("des coordonnées valides mais hors zone sont refusées — la forme ne sectorise pas", async () => {
  // Le pendant serveur de ce refus est le re-géocodage : ces coordonnées-là
  // n'atteignent jamais la requête, puisque l'action ne retient que le point
  // rendu par la BAN pour le libellé soumis.
  expect(await zoneCouvrante(COORDONNEES_FORGEES)).toBeNull();
});

test("la requête est bornée à une zone même si plusieurs se chevauchent", async () => {
  // Rien en base n'interdit à deux zones de se recouvrir, et deux secteurs
  // voisins partagent leur frontière par construction. `LIMIT 1` sur un
  // `ORDER BY id` rend le verdict stable d'un appel à l'autre.
  const lignes = await db.$queryRaw<{ id: number }[]>`
    SELECT "id"
      FROM zones
     WHERE ST_Covers(
             "area",
             ST_SetSRID(
               ST_MakePoint(${DANS_LA_ZONE.lon}::double precision, ${DANS_LA_ZONE.lat}::double precision),
               4326
             )::geography
           )
     ORDER BY "id"
     LIMIT 1
  `;

  expect(lignes).toHaveLength(1);
});
