// @vitest-environment node
//
// Rappel d'ADR-006 v2, porte par `src/lib/safe-action.ts` : **une Server Action
// exportee est un endpoint POST public**. Tout ce qui est teste ici est donc
// appele sans passer par aucun ecran, ce qui est exactement la surface que le
// panneau de detail ne pourra jamais prouver.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const attacherPhoto = vi.fn();
vi.mock("@/lib/db/queries/photos", () => ({
  attacherPhoto: (args: unknown) => attacherPhoto(args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => revalidatePath(chemin),
}));

const { ajouterPhoto } = await import("./ajouter-photo");

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";
const CHEMIN = "uploads/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.webp";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: CLIENT });
  attacherPhoto.mockResolvedValue({ ok: true, photoId: 7, nbPhotos: 1 });
});

describe("ajouterPhoto", () => {
  it("prend le proprietaire dans la SESSION, jamais dans la charge utile", async () => {
    await ajouterPhoto({ interventionId: 42, url: CHEMIN });

    expect(attacherPhoto).toHaveBeenCalledWith({
      interventionId: 42,
      url: CHEMIN,
      clientId: CLIENT,
    });
  });

  it("invalide l'espace client apres un depot", async () => {
    await ajouterPhoto({ interventionId: 42, url: CHEMIN });

    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/a-venir");
  });

  it("n'invalide rien quand le depot est refuse", async () => {
    attacherPhoto.mockResolvedValue({ ok: false, reason: "quota_atteint" });

    await ajouterPhoto({ interventionId: 42, url: CHEMIN });

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("ajouterPhoto - chemins hostiles", () => {
  // Le chemin vient du client et finit dans `photos.url`, que la route de
  // lecture concatene ensuite au repertoire de depot. C'est la premiere des
  // deux gardes ; `lirePhoto` porte la seconde.
  it("refuse une traversee de repertoire sans toucher a la base", async () => {
    for (const hostile of [
      "../../etc/passwd",
      "uploads/../../etc/passwd",
      "/etc/passwd",
      "uploads/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.js",
      "https://exemple.test/photo.webp",
      "uploads/pas-un-uuid.webp",
    ]) {
      vi.clearAllMocks();
      getCurrentUser.mockResolvedValue({ id: CLIENT });

      const resultat = await ajouterPhoto({ interventionId: 42, url: hostile });

      expect(resultat?.validationErrors).toBeDefined();
      expect(attacherPhoto).not.toHaveBeenCalled();
    }
  });

  it("refuse un identifiant d'intervention nul ou negatif", async () => {
    const resultat = await ajouterPhoto({ interventionId: 0, url: CHEMIN });

    expect(resultat?.validationErrors).toBeDefined();
    expect(attacherPhoto).not.toHaveBeenCalled();
  });
});

describe("ajouterPhoto - refus lisibles", () => {
  it("nomme le quota atteint avec la valeur de la SPEC", async () => {
    attacherPhoto.mockResolvedValue({ ok: false, reason: "quota_atteint" });

    const resultat = await ajouterPhoto({ interventionId: 42, url: CHEMIN });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "5 photos maximum par intervention.",
    });
  });

  it("repond « introuvable » sur l'intervention d'un tiers", async () => {
    // Meme libelle que les deux mutations produits : l'inconnue et celle d'un
    // tiers ne se distinguent pas.
    attacherPhoto.mockResolvedValue({ ok: false, reason: "introuvable" });

    const resultat = await ajouterPhoto({ interventionId: 42, url: CHEMIN });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Intervention introuvable.",
    });
  });

  it("refuse le depot sur une intervention verrouillee", async () => {
    attacherPhoto.mockResolvedValue({ ok: false, reason: "verrouillee" });

    const resultat = await ajouterPhoto({ interventionId: 42, url: CHEMIN });

    expect(resultat?.data?.message).toMatch(/demarree ou cloturee|clôturée/i);
  });
});
