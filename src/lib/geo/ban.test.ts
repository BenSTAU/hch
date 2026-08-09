import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ADRESSE_DEMO, entiteBan, reponseBan } from "@/mocks/handlers";
import { server } from "@/mocks/node";

import { BAN_SEARCH_URL, geocoderAdresse, rechercherSuggestions } from "./ban";

describe("rechercherSuggestions", () => {
  it("ne retient que les adresses précises et écarte les voies", async () => {
    // Le handler par défaut renvoie une entité `housenumber` et une `street`.
    const resultat = await rechercherSuggestions("12 rue de la bicyclette");

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;

    expect(resultat.data).toHaveLength(1);
    expect(resultat.data[0]?.label).toBe(ADRESSE_DEMO.label);
  });

  it("lit les coordonnées GeoJSON dans l'ordre longitude puis latitude", async () => {
    const resultat = await rechercherSuggestions("bellecour");

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;

    // L'inversion lon/lat ne lève jamais : elle place l'adresse ailleurs. Sans
    // cette assertion, une permutation passerait toute la suite au vert et se
    // découvrirait au premier refus « hors zone » inexplicable.
    expect(resultat.data[0]?.lon).toBe(ADRESSE_DEMO.lon);
    expect(resultat.data[0]?.lat).toBe(ADRESSE_DEMO.lat);
  });

  it("transmet la requête et borne les suggestions à cinq", async () => {
    let url: URL | undefined;
    server.use(
      http.get(BAN_SEARCH_URL, ({ request }) => {
        url = new URL(request.url);
        return reponseBan([]);
      }),
    );

    await rechercherSuggestions("12 rue de la bicyclette");

    expect(url?.searchParams.get("q")).toBe("12 rue de la bicyclette");
    expect(url?.searchParams.get("autocomplete")).toBe("1");
    expect(url?.searchParams.get("limit")).toBe("5");
  });

  it("rend le service indisponible quand la BAN répond en erreur", async () => {
    server.use(
      http.get(BAN_SEARCH_URL, () => new HttpResponse(null, { status: 503 })),
    );

    const resultat = await rechercherSuggestions("bellecour");

    expect(resultat).toEqual({ ok: false, reason: "indisponible" });
  });

  it("traite une réponse 200 illisible comme une indisponibilité, pas comme une adresse introuvable", async () => {
    // La distinction n'est pas cosmétique : « introuvable » invite à corriger
    // sa saisie, ce qui ne réparerait rien ici.
    server.use(
      http.get(BAN_SEARCH_URL, () =>
        HttpResponse.json({ features: [{ geometry: null }] }),
      ),
    );

    const resultat = await rechercherSuggestions("bellecour");

    expect(resultat).toEqual({ ok: false, reason: "indisponible" });
  });

  it("rend le service indisponible quand la requête est abandonnée", async () => {
    const abandon = new AbortController();
    abandon.abort();

    const resultat = await rechercherSuggestions("bellecour", {
      signal: abandon.signal,
    });

    expect(resultat).toEqual({ ok: false, reason: "indisponible" });
  });
});

describe("geocoderAdresse", () => {
  it("demande explicitement une adresse précise, sans autocomplétion", async () => {
    let url: URL | undefined;
    server.use(
      http.get(BAN_SEARCH_URL, ({ request }) => {
        url = new URL(request.url);
        return reponseBan([
          entiteBan({ ...ADRESSE_DEMO, type: "housenumber" }),
        ]);
      }),
    );

    await geocoderAdresse(ADRESSE_DEMO.label);

    expect(url?.searchParams.get("type")).toBe("housenumber");
    expect(url?.searchParams.get("autocomplete")).toBe("0");
    expect(url?.searchParams.get("limit")).toBe("1");
  });

  it("renvoie le point que la BAN attribue au libellé", async () => {
    const resultat = await geocoderAdresse(ADRESSE_DEMO.label);

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;

    // C'est la moitié serveur de « les lon/lat du client ne font jamais foi » :
    // le point vient d'ici, jamais de la charge utile.
    expect(resultat.data.lon).toBe(ADRESSE_DEMO.lon);
    expect(resultat.data.lat).toBe(ADRESSE_DEMO.lat);
  });

  it("déclare l'adresse introuvable quand la BAN ne renvoie aucune adresse précise", async () => {
    server.use(
      http.get(BAN_SEARCH_URL, () =>
        reponseBan([
          entiteBan({
            label: "Lyon",
            type: "municipality",
            lon: 4.84,
            lat: 45.75,
          }),
        ]),
      ),
    );

    const resultat = await geocoderAdresse("Lyon");

    expect(resultat).toEqual({ ok: false, reason: "introuvable" });
  });
});
