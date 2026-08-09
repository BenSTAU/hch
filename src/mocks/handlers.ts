import { http, HttpResponse, type RequestHandler } from "msw";

import { BAN_SEARCH_URL } from "@/lib/geo/ban";

/// Handlers MSW partagés par la suite Vitest.
///
/// Le premier appel réseau sortant du projet est celui de la BAN (ADR-015 v2),
/// et c'est bien le cas qu'ADR-014 §2 réservait à MSW : `vi.mock(fetch)` ne
/// couvre pas une frontière réseau, il remplace une fonction.
///
/// Combinés à `onUnhandledRequest: "error"` (`vitest.setup.ts:24`), ces
/// handlers laissent toujours échouer tout appel sortant non déclaré.
///
/// Playwright ne s'en sert pas : ses deux jeux tapent des URL réelles, et le
/// seul test d'adresse qu'il porte interroge PostGIS, pas la BAN.

/// Fabrique une entité GeoJSON au format BAN.
///
/// `type` est le champ qui décide : seules les entités `housenumber` sont
/// sélectionnables, et pouvoir en produire d'autres est ce qui permet de tester
/// le filtre plutôt que de le supposer.
export function entiteBan(options: {
  label: string;
  type: "housenumber" | "street" | "municipality";
  name?: string;
  postcode?: string;
  city?: string;
  citycode?: string;
  lon: number;
  lat: number;
}) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      // GeoJSON : longitude d'abord.
      coordinates: [options.lon, options.lat],
    },
    properties: {
      label: options.label,
      type: options.type,
      name: options.name ?? options.label,
      postcode: options.postcode ?? "69003",
      city: options.city ?? "Lyon",
      citycode: options.citycode ?? "69383",
      // Champs renvoyés par la BAN et jamais lus par HCH — présents pour que le
      // mock ressemble à la vraie réponse, dont le schéma doit tolérer le
      // surplus.
      score: 0.97,
      importance: 0.7,
    },
  };
}

export function reponseBan(entites: ReturnType<typeof entiteBan>[]) {
  return HttpResponse.json({
    type: "FeatureCollection",
    features: entites,
    limit: entites.length,
  });
}

/// Adresse de démonstration, place Bellecour — le même point que celui dont
/// `tests/e2e/sectorisation-geo.spec.ts` prouve qu'il tombe dans la zone seedée.
/// Aucune donnée personnelle réelle, ici comme partout ailleurs.
export const ADRESSE_DEMO = {
  label: "12 Rue de la Bicyclette 69003 Lyon",
  name: "12 Rue de la Bicyclette",
  lon: 4.832,
  lat: 45.7578,
};

export const handlers: RequestHandler[] = [
  http.get(BAN_SEARCH_URL, () =>
    reponseBan([
      entiteBan({ ...ADRESSE_DEMO, type: "housenumber" }),
      // Une voie sans numéro : la BAN en renvoie spontanément, et elle ne doit
      // jamais atteindre la liste de suggestions.
      entiteBan({
        label: "Rue de la Bicyclette 69003 Lyon",
        name: "Rue de la Bicyclette",
        type: "street",
        lon: 4.8321,
        lat: 45.7579,
      }),
    ]),
  ),
];
