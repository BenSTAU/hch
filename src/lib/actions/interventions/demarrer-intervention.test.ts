// @vitest-environment node
//
// Le demarrage - `US-INTERVENTION-DEMARRER`, ecran T2.
//
// Eprouve l'orchestration, pas la machine a etats ni le verrou, qui vivent
// dans le helper metier : le TECHNICIEN vient de la session, les refus
// revalident AUSSI, et `techActionClient` refuse un client authentifie.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

// ⚠️ **Le `digest` n'est pas decoratif, il EST le contrat.**
// `next-safe-action` reconnait `forbidden()` par `isHTTPAccessFallbackError`,
// qui lit `error.digest` et ignore le message. Un mock qui ne pose que le
// message serait traite comme une erreur serveur ordinaire, donc avale par
// `handleServerError` et rendu en « Une erreur est survenue » : le test
// passerait - il verifie un refus - en prouvant l'inverse de ce qui se produit
// en execution reelle, ou l'erreur remonte et Next rend un 403. Meme harnais
// que `lister-tournee.test.ts`, ou ce piege est documente.
//
// La vraie `requireTech()` n'est PAS doublee : c'est elle qu'on eprouve.
const forbidden = vi.fn(() => {
  const erreur = new Error("NEXT_HTTP_ERROR_FALLBACK;403") as Error & {
    digest: string;
  };
  erreur.digest = "NEXT_HTTP_ERROR_FALLBACK;403";
  throw erreur;
});
vi.mock("next/navigation", () => ({ forbidden: () => forbidden() }));

const demarrerInterventionDuTech = vi.fn();
vi.mock("@/lib/db/queries/interventions", () => ({
  demarrerInterventionDuTech: (args: unknown) =>
    demarrerInterventionDuTech(args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => revalidatePath(chemin),
}));

const { demarrerIntervention } = await import("./demarrer-intervention");

const TECH = "22222222-2222-4222-8222-222222222222";
const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";
const DEBUT = new Date("2026-08-20T08:02:00.000Z");

const TECHNICIEN = {
  id: TECH,
  email: "tech@homecyclhome.fr",
  firstname: "Marc",
  lastname: "Lefevre",
  roles: ["ROLE_TECH"],
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(TECHNICIEN);
  demarrerInterventionDuTech.mockResolvedValue({ ok: true, startedAt: DEBUT });
});

describe("demarrerIntervention - le cloisonnement", () => {
  it("passe le technicien de la SESSION, jamais un identifiant recu", async () => {
    // 🔴 La propriete de securite de l'action. Un `techId` accepte en charge
    // utile serait le demarrage de l'intervention d'autrui pour qui sait
    // poster : le schema n'en porte pas, et le contexte fournit le seul qui
    // compte.
    await demarrerIntervention({ interventionId: 847 });

    expect(demarrerInterventionDuTech).toHaveBeenCalledWith(
      expect.objectContaining({ interventionId: 847, techId: TECH }),
    );
  });

  it("refuse un client authentifie, et n'ecrit jamais en base", async () => {
    // 🔴 Le coeur de la garde. `src/proxy.ts` laisse deliberement passer les
    // requetes portant `Next-Action` (rediriger un POST d'action casse le
    // client) : sans cette ligne, un client authentifie qui poste ici
    // demarrerait l'intervention de quelqu'un d'autre.
    getCurrentUser.mockResolvedValue({
      ...TECHNICIEN,
      id: CLIENT,
      roles: ["ROLE_CLIENT"],
    });

    await expect(
      demarrerIntervention({ interventionId: 847 }),
    ).rejects.toThrow();

    expect(forbidden).toHaveBeenCalledOnce();
    // La garde est en MIDDLEWARE, donc avant la validation Zod comme avant le
    // corps : la transaction ne part pas.
    expect(demarrerInterventionDuTech).not.toHaveBeenCalled();
  });

  it("refuse un administrateur sans ROLE_TECH", async () => {
    // Meme regle que la tournee : la vision transverse de l'administration est
    // une autre US, un autre ecran.
    getCurrentUser.mockResolvedValue({ ...TECHNICIEN, roles: ["ROLE_ADMIN"] });

    await expect(
      demarrerIntervention({ interventionId: 847 }),
    ).rejects.toThrow();

    expect(demarrerInterventionDuTech).not.toHaveBeenCalled();
  });

  it("date le demarrage cote SERVEUR", async () => {
    // Une horloge recue du client daterait un jalon d'execution sur la montre
    // du navigateur. `started_at` est une preuve terrain horodatee.
    await demarrerIntervention({ interventionId: 847 });

    const args = demarrerInterventionDuTech.mock.calls[0]?.[0] as {
      maintenant: Date;
    };

    expect(args.maintenant).toBeInstanceOf(Date);
  });

  it("ecarte un identifiant qui n'est pas un entier positif", async () => {
    // Il vient de la charge utile, donc de n'importe qui. Zod le refuse avant
    // que la base ne le voie.
    const resultat = await demarrerIntervention({ interventionId: -3 });

    expect(resultat?.validationErrors).toBeDefined();
    expect(demarrerInterventionDuTech).not.toHaveBeenCalled();
  });
});

describe("demarrerIntervention - l'invalidation", () => {
  it("invalide le detail ET la tournee au succes", async () => {
    // Les deux surfaces montrent le statut : le detail par son hub d'actions,
    // la tournee par l'etiquette de la ligne et son bouton.
    await demarrerIntervention({ interventionId: 847 });

    expect(revalidatePath).toHaveBeenCalledWith("/interventions/847");
    expect(revalidatePath).toHaveBeenCalledWith("/interventions/du-jour");
  });

  it("invalide AUSSI quand la transition est refusee", async () => {
    // 🐛 La lecon de la PR #33, transposee : les deux refus disent que la vue de
    // l'appelant est PERIMEE - le statut a change sous ses yeux, ou
    // l'intervention ne lui appartient plus. Sans invalidation, l'ecran garde
    // « Planifiee » et son bouton, et le technicien reessaie indefiniment
    // contre une liste fausse.
    demarrerInterventionDuTech.mockResolvedValue({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "IN_PROGRESS",
    });

    await demarrerIntervention({ interventionId: 847 });

    expect(revalidatePath).toHaveBeenCalledWith("/interventions/847");
    expect(revalidatePath).toHaveBeenCalledWith("/interventions/du-jour");
  });
});

describe("demarrerIntervention - ce qu'elle rend", () => {
  it("rend le succes sans rien de la ligne", async () => {
    // L'instant arrive par la relecture, pas par la reponse : une seule source
    // pour une valeur affichee.
    const resultat = await demarrerIntervention({ interventionId: 847 });

    expect(resultat?.data).toEqual({ ok: true });
  });

  it("nomme le statut courant quand l'intervention est deja demarree", async () => {
    // Le technicien vient de cliquer : il doit savoir ce qui a change sous ses
    // yeux, pas recevoir un message generique.
    demarrerInterventionDuTech.mockResolvedValue({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "IN_PROGRESS",
    });

    const resultat = await demarrerIntervention({ interventionId: 847 });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Cette intervention est déjà démarrée.",
    });
  });

  it.each([["DONE"], ["CANCELLED"]])(
    "distingue le statut terminal %s du deja-demarre",
    async (statut) => {
      demarrerInterventionDuTech.mockResolvedValue({
        ok: false,
        reason: "transition_illegale",
        statutCourant: statut,
      });

      const resultat = await demarrerIntervention({ interventionId: 847 });

      expect(resultat?.data).toEqual({
        ok: false,
        message:
          "Cette intervention n'est plus démarrable : elle est terminée ou annulée.",
      });
    },
  );

  it("ne distingue pas l'inconnue de celle d'un collegue", async () => {
    demarrerInterventionDuTech.mockResolvedValue({
      ok: false,
      reason: "introuvable",
    });

    const resultat = await demarrerIntervention({ interventionId: 999 });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Intervention introuvable.",
    });
  });
});
