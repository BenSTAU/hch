// @vitest-environment node
//
// La tournee du jour - `US-INTERVENTIONS-LISTER-TECH-DU-JOUR`, ecran T1.
//
// Ce fichier n'eprouve PAS le filtre de la journee ni la projection : elles
// vivent dans le helper metier et y sont testees. Il eprouve la GARDE, qui n'a
// pas d'autre surface :
//
//   · un client authentifie qui poste cette action recoit un refus, et la base
//     n'est jamais lue ;
//   · le technicien vient de la SESSION, jamais de la charge utile ;
//   · la journee est recalculee au serveur, donc une tournee laissee ouverte
//     bascule d'elle-meme a minuit.
//
// Le motif de la garde est ecrit dans `src/proxy.ts` : le matcher laisse passer
// `Next-Action` deliberement, donc aucune route ne protege cette action.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

// ⚠️ **Le `digest` n'est pas decoratif, il EST le contrat.**
// `next-safe-action` reconnait `forbidden()` par `isHTTPAccessFallbackError`,
// qui lit `error.digest` et ignore le message
// (node_modules/next-safe-action/dist/errors-9ViDxi_K.mjs). Un mock qui ne
// pose que le message serait traite comme une erreur serveur ordinaire, donc
// avale par `handleServerError` et rendu en « Une erreur est survenue ». Le
// test passerait - il verifie un refus - en prouvant l'inverse de ce qui se
// produit en execution reelle, ou l'erreur remonte et Next rend un 403.
const forbidden = vi.fn(() => {
  const erreur = new Error("NEXT_HTTP_ERROR_FALLBACK;403") as Error & {
    digest: string;
  };
  erreur.digest = "NEXT_HTTP_ERROR_FALLBACK;403";
  throw erreur;
});
vi.mock("next/navigation", () => ({ forbidden: () => forbidden() }));

const listerTourneeDuJour = vi.fn();
vi.mock("@/lib/db/queries/interventions", () => ({
  listerTourneeDuJour: (args: unknown) => listerTourneeDuJour(args),
}));

const { listerTournee } = await import("./lister-tournee");
const { jourLocal } = await import("@/lib/creneaux/horaires");

const TECH_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const AUTRE_ID = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";

const TECHNICIEN = {
  id: TECH_ID,
  email: "tech@homecyclhome.fr",
  firstname: "Marc",
  lastname: "Lefevre",
  roles: ["ROLE_TECH"],
};

const LIGNE = {
  id: 1,
  status: "PLANNED",
  appointmentAt: "2026-08-13T08:00:00.000Z",
  durationSnapshot: 60,
  forfait: "Revision complete",
  client: { nom: "Sophie Dumas", telephone: "+33612345678" },
  adresse: {
    label: null,
    street: "12 rue de la Republique",
    zipCode: "69002",
    city: "Lyon",
  },
  point: { lon: 4.8357, lat: 45.764 },
  produits: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  listerTourneeDuJour.mockResolvedValue([LIGNE]);
});

describe("listerTournee", () => {
  it("rend la tournee du technicien connecte", async () => {
    getCurrentUser.mockResolvedValue(TECHNICIEN);

    const resultat = await listerTournee();

    expect(resultat?.data?.interventions).toEqual([LIGNE]);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("rend AVEC la tournee le debut de la journee listee", async () => {
    // Le titre « Aujourd'hui — jeudi 13 aout » se derive de cette valeur, et
    // elle voyage avec les donnees plutot que d'etre figee au rendu de la page :
    // un onglet reste ouvert bascule au jour suivant a minuit, et un titre fige
    // au chargement afficherait la date d'hier au-dessus de la tournee du jour.
    getCurrentUser.mockResolvedValue(TECHNICIEN);

    const resultat = await listerTournee();

    // Minuit a Paris, donc jamais minuit UTC : le suffixe est 22:00 ou 23:00
    // selon la saison.
    expect(resultat?.data?.debutJournee).toMatch(/T2[23]:00:00\.000Z$/);
  });

  it("prend le technicien dans la SESSION, jamais dans la charge utile", async () => {
    // La propriete que ce test protege : il n'existe aucun parametre par lequel
    // demander la tournee d'un autre. `AUTRE_ID` n'a aucune voie d'entree.
    getCurrentUser.mockResolvedValue(TECHNICIEN);

    await listerTournee();

    expect(listerTourneeDuJour).toHaveBeenCalledWith(
      expect.objectContaining({ techId: TECH_ID }),
    );
    expect(listerTourneeDuJour).not.toHaveBeenCalledWith(
      expect.objectContaining({ techId: AUTRE_ID }),
    );
  });

  it("recalcule la journee au serveur plutot que de la recevoir", async () => {
    // Consequence directe : la tournee bascule d'elle-meme au jour suivant a
    // minuit, sans rechargement. Une journee figee au chargement de l'onglet
    // afficherait la veille jusqu'au prochain F5.
    getCurrentUser.mockResolvedValue(TECHNICIEN);

    await listerTournee();

    expect(listerTourneeDuJour).toHaveBeenCalledWith(
      expect.objectContaining({ jour: jourLocal(new Date()) }),
    );
  });

  it("refuse un client authentifie, et ne lit jamais la base", async () => {
    // Le coeur de la DoD. Sans cette garde, un client qui poste cette action
    // recoit le nom, le telephone et l'adresse des clients d'un technicien.
    getCurrentUser.mockResolvedValue({
      ...TECHNICIEN,
      id: AUTRE_ID,
      roles: ["ROLE_CLIENT"],
    });

    await expect(listerTournee()).rejects.toThrow();
    expect(forbidden).toHaveBeenCalledOnce();
    // La garde est en MIDDLEWARE, donc avant le corps : la requete ne part pas.
    expect(listerTourneeDuJour).not.toHaveBeenCalled();
  });

  it("refuse un administrateur sans ROLE_TECH", async () => {
    // `US-INTERVENTIONS-LISTER-TECH-DU-JOUR` §Cas d'erreur : « client OU ADMIN
    // SANS ROLE TECH → 403 ».
    getCurrentUser.mockResolvedValue({ ...TECHNICIEN, roles: ["ROLE_ADMIN"] });

    await expect(listerTournee()).rejects.toThrow();
    expect(listerTourneeDuJour).not.toHaveBeenCalled();
  });

  it("laisse remonter le refus en erreur de navigation, pas en erreur serveur", async () => {
    // `handleServerError` de `src/lib/safe-action.ts` rend « Une erreur est
    // survenue » sur toute exception ordinaire. Si le refus y tombait, le refus
    // serait indiscernable d'une panne : pas de 403, pas de `noindex`, et un
    // technicien devant une vraie panne croirait a un probleme de droits.
    getCurrentUser.mockResolvedValue({ ...TECHNICIEN, roles: ["ROLE_CLIENT"] });

    await expect(listerTournee()).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;403",
    });
  });

  it("laisse la DAL rediriger quand il n'y a pas de session", async () => {
    // Absence de session et role insuffisant sont deux situations distinctes :
    // la premiere se repare en se connectant, la seconde non. Les confondre en
    // 403 enfermerait un visiteur anonyme.
    //
    // Meme precaution de `digest` que pour `forbidden` ci-dessus, et le format
    // compte : `isRedirectError` exige `NEXT_REDIRECT`, un type `replace` ou
    // `push`, une destination et un code de redirection valide. Un `digest`
    // approximatif serait avale par `handleServerError`, et le test affirmerait
    // une redirection la ou l'utilisateur verrait « Une erreur est survenue ».
    const redirection = new Error("NEXT_REDIRECT") as Error & {
      digest: string;
    };
    redirection.digest = "NEXT_REDIRECT;replace;/connexion;307;";
    getCurrentUser.mockRejectedValue(redirection);

    await expect(listerTournee()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT;replace;/connexion;307;",
    });
    expect(forbidden).not.toHaveBeenCalled();
    expect(listerTourneeDuJour).not.toHaveBeenCalled();
  });
});
