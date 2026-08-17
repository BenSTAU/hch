// @vitest-environment node
//
// Rappel d'ADR-006 v2, porté par `src/lib/safe-action.ts` : **une Server Action
// exportée est un endpoint POST public**. Ce qui est testé ici est donc appelé
// sans passer par aucun écran.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const creerCycle = vi.fn();
vi.mock("@/lib/db/queries/cycles", () => ({
  creerCycle: (args: unknown) => creerCycle(args),
}));

// Hors contexte de requête Next, `revalidatePath` lève, et `handleServerError`
// transformerait le succès en `serverError`.
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => revalidatePath(chemin),
}));

const { ajouterCycle } = await import("./ajouter-cycle");

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";

const SAISIE = {
  brand: "Decathlon",
  model: "Elops 900",
  type: "CLASSIC" as const,
  year: 2023,
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({
    id: CLIENT,
    email: "client@example.test",
  });
  creerCycle.mockResolvedValue({ id: 12, ...SAISIE });
});

describe("ajouterCycle", () => {
  it("prend le propriétaire dans la SESSION, jamais dans la charge utile", async () => {
    // Le schéma n'a pas de champ `userId` : même si l'appelant en pose un, il
    // est écarté à la validation et c'est la session qui décide.
    await ajouterCycle({ ...SAISIE, userId: "usurpe" } as never);

    expect(creerCycle).toHaveBeenCalledWith({ ...SAISIE, userId: CLIENT });
  });

  it("invalide la liste, sans quoi le vélo n'apparaîtrait qu'à la navigation suivante", async () => {
    await ajouterCycle(SAISIE);

    expect(revalidatePath).toHaveBeenCalledWith("/mon-compte/cycles");
    // Et l'espace client : le sélecteur de rattachement du panneau de détail
    // liste ces mêmes vélos, donc un vélo créé pour le rendez-vous de demain
    // n'y apparaîtrait qu'à la navigation suivante.
    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/a-venir");
  });

  it("rend le vélo créé, dont le message de succès a besoin", async () => {
    const resultat = await ajouterCycle(SAISIE);

    expect(resultat?.data).toEqual({ ok: true, cycle: { id: 12, ...SAISIE } });
  });

  it("n'écrit rien quand Zod refuse", async () => {
    const resultat = await ajouterCycle({ ...SAISIE, brand: "" });

    expect(creerCycle).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(resultat?.validationErrors).toBeDefined();
  });

  it("rend des refus AU FORMAT que l'écran sait lire", async () => {
    // ⚠️ `cycles-vue.tsx` lit `erreurs[champ]._errors[0]`, forme qui est un
    // défaut de next-safe-action et non un contrat écrit ici : en « flattened »
    // le parseur rendrait `null` sans lever, et l'écran n'afficherait plus que
    // « Vérifiez les champs signalés ». Ce test relie les deux surfaces.
    const resultat = await ajouterCycle({ ...SAISIE, brand: "", year: 1800 });

    expect(resultat?.validationErrors).toMatchObject({
      brand: { _errors: ["Marque requise"] },
      year: { _errors: ["Année d'achat invalide"] },
    });
  });

  it("borne la marque à 100 caractères, avant la colonne VARCHAR(100)", async () => {
    // `cycles.brand` est un `VARCHAR(100)` : sans cette borne applicative, une
    // saisie plus longue ferait lever Prisma et `handleServerError` la rendrait
    // en « Une erreur est survenue », un refus de saisie déguisé en panne.
    const resultat = await ajouterCycle({
      ...SAISIE,
      brand: "x".repeat(101),
    });

    expect(creerCycle).not.toHaveBeenCalled();
    expect(resultat?.validationErrors).toBeDefined();
  });

  it("n'atteint ni le corps ni le schéma sans session", async () => {
    // `getCurrentUser` redirige vers `/connexion` : la garde vit en middleware,
    // donc AVANT la validation Zod. Un appelant anonyme ne lit même pas la
    // forme attendue de la charge utile.
    getCurrentUser.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await ajouterCycle(SAISIE);

    expect(creerCycle).not.toHaveBeenCalled();
  });
});
