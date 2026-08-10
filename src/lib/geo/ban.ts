import { z } from "zod";

/// Client de la Base Adresse Nationale, via la Géoplateforme IGN.
///
/// ADR-015 v2 remplace la Geocoding API de Google par la BAN sur tout le
/// parcours client : une seule requête fait l'autocomplétion **et** le
/// géocodage, et aucune clé n'est nécessaire — d'où l'absence de variable
/// d'environnement pour ce flux.
///
/// Ce module n'est **pas** `server-only`, et c'est délibéré : il a deux
/// appelants aux deux bords de la frontière. Le composant d'autocomplétion
/// l'appelle depuis le navigateur, et la Server Action le rappelle à la
/// soumission pour refuser de croire les coordonnées qu'on lui envoie.

/// `data.geopf.fr` et non `api-adresse.data.gouv.fr` : l'IGN annonce la seconde
/// comme sortante, même si elle répond encore aujourd'hui.
export const BAN_SEARCH_URL = "https://data.geopf.fr/geocodage/search/";

/// Surcharge de l'URL de base, **pour la barrière E2E seulement**.
///
/// Motif : `verifierAdresse` et `reserver` re-géocodent **côté serveur**, et
/// cet appel sortant part du processus Next - `page.route()` de Playwright, qui
/// intercepte au niveau du contexte navigateur, ne le voit pas. Sans point
/// d'injection, `GP-02` ne pouvait pas dépasser l'autocomplétion sans taper la
/// vraie BAN depuis la CI, ce que la DoD interdit.
///
/// L'alternative évaluée était `instrumentation.ts` montant MSW côté Node.
/// Écartée : la barrière tourne contre **l'image de production**
/// (`docker-compose.test.yml`, profil `e2e`), donc MSW aurait voyagé jusqu'en
/// staging et en production. C'est l'objection exacte qui avait fait rejeter le
/// worker MSW navigateur en T-V3-08. Une variable non renseignée, elle, est
/// inerte : le code de repli est l'URL réelle.
///
/// ⚠️ Divergence assumée contre la DoD 265 de T-V3-06, « aucune variable
/// d'environnement pour ce flux » - qui parlait d'une CLÉ Google, pas d'un
/// point d'injection de test. Arbitré par Benjamin le 2026-08-10.
///
/// Lue à l'appel et jamais au chargement du module : `src/lib/env.ts` en fait
/// une règle, et ce module est importé par un Client Component - côté
/// navigateur `process.env` ne porte que les clés `NEXT_PUBLIC_`, la surcharge
/// y vaut donc toujours `undefined` et l'autocomplétion tape la vraie BAN,
/// qu'un `page.route()` intercepte très bien.
function urlRecherche(): string {
  return process.env["HCH_BAN_BASE_URL"] ?? BAN_SEARCH_URL;
}

/// Cinq suggestions : au-delà, la liste déroulante dépasse le pli sur mobile et
/// le choix devient plus coûteux que la saisie.
const LIMITE_SUGGESTIONS = 5;

/// Seul ce niveau de précision permet de réserver. Une rue ou une commune
/// désigne une surface, pas un point de livraison — et c'est ce filtre qui rend
/// effectif le « jamais de saisie libre non contrôlée » de la Constitution
/// §2.2. Le paramètre est passé à l'API *et* revérifié sur la réponse : le
/// filtre serveur de la BAN n'est pas contractuel.
const TYPE_ADRESSE_PRECISE = "housenumber";

/// Réponse GeoJSON de la BAN, restreinte à ce que HCH consomme.
///
/// Volontairement tolérant sur le reste : la BAN renvoie une quinzaine de
/// propriétés par entité, et un ajout côté IGN ne doit pas faire échouer le
/// parsing d'un champ qu'on ne lit pas.
const banFeatureSchema = z.object({
  geometry: z.object({
    /// GeoJSON ordonne **[longitude, latitude]**, l'inverse de la convention
    /// orale « lat/lon ». L'inversion est silencieuse : elle ne lève pas, elle
    /// place l'adresse ailleurs sur la carte.
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    label: z.string(),
    type: z.string(),
    postcode: z.string(),
    city: z.string(),
    citycode: z.string(),
    /// Numéro + voie, sans la commune. Absent sur les entités qui ne sont pas
    /// des adresses précises — donc toujours présent après notre filtre, mais
    /// le schéma décrit la réponse, pas notre usage.
    name: z.string().optional(),
  }),
});

const banResponseSchema = z.object({
  features: z.array(banFeatureSchema),
});

export type SuggestionAdresse = {
  /// Libellé complet tel que la BAN le compose. C'est lui qu'on renvoie au
  /// serveur pour le re-géocodage : il est stable et non ambigu, là où une
  /// recomposition maison réintroduirait de la saisie libre.
  label: string;
  /// Alimente `addresses.street`.
  street: string;
  postcode: string;
  city: string;
  /// Code INSEE. **Lu, jamais stocké** : `cities` ne porte aucune colonne pour
  /// l'accueillir (`prisma/schema.prisma:219-233`), la commune se résout par le
  /// couple (code postal, nom). Arbitré le 2026-08-09, cf. PR §Divergences.
  citycode: string;
  lon: number;
  lat: number;
};

/// Deux échecs, deux messages distincts côté écran — la SPEC les sépare
/// explicitement (`US-ADRESSE-SAISIR` §Cas d'erreur), et les confondre
/// donnerait « réessayez » à quelqu'un dont l'adresse n'existe pas.
export type ResultatBan<T> =
  { ok: true; data: T } | { ok: false; reason: "indisponible" | "introuvable" };

/// Une entrée de la liste de suggestions.
///
/// **Deux natures, et une seule réserve.** Une entité `housenumber` est une
/// adresse : elle porte un point, elle peut être retenue. Une rue, une place ou
/// une commune n'en est pas une - le technicien se déplace à un point de
/// livraison, pas sur une surface (Constitution §2.2, T-V3-06 §DoD). Elle est
/// tout de même proposée, comme **piste de raffinement** : la choisir relance
/// la recherche sur son libellé pour que l'utilisateur ajoute son numéro.
///
/// C'est l'arbitrage du 2026-08-10 : taper « place Bellecour » ne rendait
/// aucune suggestion, ce qui se lit comme une panne. Le filtre n'est pas
/// relâché pour autant - il se déplace de l'affichage vers la sélection.
export type SuggestionBan =
  | { precise: true; adresse: SuggestionAdresse }
  | { precise: false; label: string };

type BanFeature = z.infer<typeof banFeatureSchema>;

function versSuggestion(feature: BanFeature): SuggestionAdresse | null {
  const { properties, geometry } = feature;
  if (properties.type !== TYPE_ADRESSE_PRECISE) return null;

  const [lon, lat] = geometry.coordinates;

  return {
    label: properties.label,
    // `name` est le numéro + la voie. Son absence sur une entité `housenumber`
    // serait une anomalie de la BAN ; on retombe sur le libellé complet plutôt
    // que d'écarter une adresse par ailleurs valide.
    street: properties.name ?? properties.label,
    postcode: properties.postcode,
    city: properties.city,
    citycode: properties.citycode,
    lon,
    lat,
  };
}

function versSuggestionBan(feature: BanFeature): SuggestionBan {
  const adresse = versSuggestion(feature);
  return adresse
    ? { precise: true, adresse }
    : { precise: false, label: feature.properties.label };
}

async function interrogerBan(
  parametres: Record<string, string>,
  signal?: AbortSignal,
): Promise<ResultatBan<BanFeature[]>> {
  const url = new URL(urlRecherche());
  for (const [cle, valeur] of Object.entries(parametres)) {
    url.searchParams.set(cle, valeur);
  }

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      signal: signal ?? null,
      // Le géocodage d'une adresse ne se met pas en cache côté Next : la
      // réponse est propre à une saisie, et la mémoriser ferait grossir le
      // cache d'entrées à usage unique.
      cache: "no-store",
    });
  } catch {
    // Inclut l'abandon volontaire d'une requête obsolète (`AbortError`) :
    // l'appelant qui annule ignore le résultat, la distinction ne lui sert à
    // rien.
    return { ok: false, reason: "indisponible" };
  }

  if (!reponse.ok) return { ok: false, reason: "indisponible" };

  let brut: unknown;
  try {
    brut = await reponse.json();
  } catch {
    return { ok: false, reason: "indisponible" };
  }

  // Une réponse 200 mal formée est traitée comme une indisponibilité, et non
  // comme une adresse introuvable : le service a répondu quelque chose qu'on ne
  // sait pas lire, ce qui se répare en réessayant, pas en corrigeant sa saisie.
  const parsee = banResponseSchema.safeParse(brut);
  if (!parsee.success) return { ok: false, reason: "indisponible" };

  return { ok: true, data: parsee.data.features };
}

/// Autocomplétion — appelée **depuis le navigateur** à chaque frappe utile.
///
/// `signal` sert à abandonner la requête d'une frappe dépassée : sans lui, deux
/// réponses concurrentes peuvent arriver dans le désordre et la liste affiche
/// les suggestions d'une saisie antérieure.
export async function rechercherSuggestions(
  requete: string,
  options: { signal?: AbortSignal } = {},
): Promise<ResultatBan<SuggestionBan[]>> {
  const resultat = await interrogerBan(
    {
      q: requete,
      autocomplete: "1",
      limit: String(LIMITE_SUGGESTIONS),
    },
    options.signal,
  );

  if (!resultat.ok) return resultat;

  return { ok: true, data: resultat.data.map(versSuggestionBan) };
}

/// Géocodage de contrôle — appelé **depuis le serveur** à la soumission.
///
/// C'est la moitié serveur de « les `lon`/`lat` venus du client ne font jamais
/// foi » : le point retenu est celui que la BAN renvoie ici, jamais celui que
/// la charge utile transportait. Rejouer `ST_Covers` sur des coordonnées
/// fournies par l'appelant ne prouverait rien — il suffirait d'en forger une
/// paire tombant dans la zone.
export async function geocoderAdresse(
  libelle: string,
): Promise<ResultatBan<SuggestionAdresse>> {
  const resultat = await interrogerBan({
    q: libelle,
    // Pas d'`autocomplete` ici : on ne complète pas une saisie en cours, on
    // résout un libellé déjà choisi.
    autocomplete: "0",
    type: TYPE_ADRESSE_PRECISE,
    limit: "1",
  });

  if (!resultat.ok) return resultat;

  // Le filtre `housenumber` est **rejoué sur la réponse**, et pas seulement
  // demandé à l'API : le filtrage serveur de la BAN n'est pas contractuel. Ce
  // rejeu est ce qui rend impossible de faire valider une rue en la faisant
  // passer par la liste de raffinement.
  const premiere = resultat.data
    .map(versSuggestion)
    .find((suggestion): suggestion is SuggestionAdresse => suggestion !== null);

  if (!premiere) return { ok: false, reason: "introuvable" };

  return { ok: true, data: premiere };
}
