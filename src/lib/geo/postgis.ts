import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db/client";

/// Accès PostGIS typé — la seule porte du code applicatif vers `geography`.
///
/// Prisma ne représente pas ce type : `zones.area` et `addresses.location` sont
/// des colonnes `Unsupported(...)` (`prisma/schema.prisma:246`, `:266`), que le
/// client masque même en lecture. Tout passe donc par `$queryRaw`, et ADR-008
/// veut que ce SQL vive ici plutôt que dispersé dans les requêtes métier.
///
/// Reporté de T-V3-01 : à la clôture du seed, seul un test interrogeait
/// PostGIS (`tests/e2e/sectorisation-geo.spec.ts`), et figer une API à ce
/// moment-là aurait préempté sa conception. Ce module a son premier
/// consommateur applicatif avec T-V3-06.

/// Point WGS84, dans l'ordre où on le lit à voix haute. La conversion vers
/// l'ordre GeoJSON (`[lon, lat]`) se fait à la frontière, dans `ban.ts`.
export type PointWgs84 = {
  lon: number;
  lat: number;
};

/// Union discriminée plutôt qu'un booléen : l'appelant qui accepte l'adresse a
/// besoin de la zone retenue — c'est elle qui portera le technicien affecté au
/// moment de dériver les créneaux (Constitution §2.1).
export type CouvertureZone =
  | { ok: true; zoneId: number; zoneName: string }
  | { ok: false; reason: "hors_zone" };

/// Fragment SQL d'un point `geography(Point, 4326)`.
///
/// Les casts `::double precision` ne sont pas décoratifs : Prisma lie ses
/// paramètres sans type déclaré, et Postgres refuse alors de choisir une
/// signature pour `ST_MakePoint`. Sans eux, la requête échoue à la planification
/// avec un « could not determine polymorphic type ».
export function pointGeography(point: PointWgs84): Prisma.Sql {
  return Prisma.sql`ST_SetSRID(
    ST_MakePoint(${point.lon}::double precision, ${point.lat}::double precision),
    4326
  )::geography`;
}

/// Zone de service couvrant ce point, s'il en existe une.
///
/// `ST_Covers` et non `ST_Contains` : la frontière est **incluse**. Une zone
/// dessinée le long d'une rue a des adresses exactement sur son bord, et elles
/// doivent être servies. Second motif, décisif : `ST_Contains` n'a aucune
/// signature `geography` (doc PostGIS §13.4). Tranché au cadrage amont V3.
///
/// L'index GiST de `zones.area` (`prisma/schema.prisma:253`) rend ce filtre
/// indexable ; sans lui la requête balaie la table.
export async function trouverZoneCouvrante(
  point: PointWgs84,
): Promise<CouvertureZone> {
  const lignes = await db.$queryRaw<{ id: number; name: string }[]>`
    SELECT "id", "name"
      FROM zones
     WHERE ST_Covers("area", ${pointGeography(point)})
     -- Les zones peuvent se chevaucher : rien en base ne l'interdit, et deux
     -- secteurs voisins partagent leur frontière par construction. L'ordre sur
     -- l'identifiant départage de façon stable, pour qu'une même adresse ne
     -- bascule pas d'une zone à l'autre entre deux appels.
     ORDER BY "id"
     LIMIT 1
  `;

  const ligne = lignes[0];
  if (!ligne) return { ok: false, reason: "hors_zone" };

  return { ok: true, zoneId: ligne.id, zoneName: ligne.name };
}
