import { z } from "zod";

/// Client de la Base Adresse Nationale, via la Géoplateforme IGN.
///
/// Une seule requête fait l'autocomplétion **et** le géocodage, sans aucune
/// clé - d'où l'absence de variable d'environnement pour ce flux
/// (ADR-015 v2).
///
/// Ce module n'est **pas** `server-only`, et c'est délibéré : il a deux
/// appelants aux deux bords de la frontière. Le composant d'autocomplétion
/// l'appelle depuis le navigateur, et la Server Action le rappelle à la
/// soumission pour refuser de croire les coordonnées qu'on lui envoie.

/// `data.geopf.fr` et non `api-adresse.data.gouv.fr` : l'IGN annonce la seconde
/// comme sortante, même si elle répond encore aujourd'hui.
export const BAN_SEARCH_URL = "https://data.geopf.fr/geocodage/search/";

/// Surcharge de l'URL de base, **pour la barrière E2E seulement**. Le
/// géocodage de contrôle part du processus Next, donc `page.route()` de
/// Playwright ne le voit pas. Cf. CLAUDE.md §Folder structure, qui fait de
/// cette variable une exception nommée et interdit de la renseigner.
///
/// ⚠️ **Lue à l'appel, jamais au chargement du module**, et jamais posée dans
/// un `.env.prod` : une variable proposée finit par être renseignée, et
/// celle-ci détournerait la production vers un faux service. Non renseignée,
/// elle est inerte, le repli étant l'URL réelle.
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
/// **Deux natures, une seule retenable.** Seule une entité `housenumber` porte
/// un point : le technicien se déplace à une adresse, pas sur une surface
/// (Constitution §2.2). Une rue ou une commune est tout de même proposée comme
/// **piste de raffinement**, la choisir relançant la recherche sur son libellé.
/// Le filtre n'est pas relâché, il se déplace de l'affichage vers la sélection.
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
