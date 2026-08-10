// @vitest-environment node
//
// Le retrait est la moitié qui restitue le stock. Son absence ne se voit pas à
// l'écran : elle se voit trois semaines plus tard, sur un catalogue vidé par
// des paniers remaniés.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const retirerProduitIntervention = vi.fn();
vi.mock("@/lib/db/queries/produits", () => ({
  retirerProduitIntervention: (args: unknown) =>
    retirerProduitIntervention(args),
}));

const { retirerProduit } = await import("./retirer-produit");

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({
    id: CLIENT,
    email: "client@example.test",
  });
  retirerProduitIntervention.mockResolvedValue({ ok: true, total: "85.00" });
});

describe("retirerProduit", () => {
  it("prend le propriétaire dans la SESSION, jamais dans la charge utile", async () => {
    await retirerProduit({ interventionId: 42, productId: 2 });

    expect(retirerProduitIntervention).toHaveBeenCalledWith({
      interventionId: 42,
      productId: 2,
      clientId: CLIENT,
    });
  });

  it("rend le total ramené au forfait quand la dernière ligne part", async () => {
    const resultat = await retirerProduit({ interventionId: 42, productId: 2 });

    expect(resultat?.data).toEqual({ ok: true, total: "85.00" });
  });

  it("répond « déjà retiré » sur une ligne disparue", async () => {
    // Double-clic, ou onglet resté ouvert sur un état périmé. Ce n'est pas une
    // panne : l'état voulu par le client est déjà atteint.
    retirerProduitIntervention.mockResolvedValue({
      ok: false,
      reason: "ligne_absente",
    });

    const resultat = await retirerProduit({ interventionId: 42, productId: 2 });

    expect(resultat?.data).toMatchObject({
      message: "Produit déjà retiré ou introuvable.",
    });
  });

  it("refuse le retrait sur une intervention démarrée", async () => {
    // Symétrique de l'ajout (décision B7 Q2a) : le technicien est peut-être
    // déjà en route avec la pièce.
    retirerProduitIntervention.mockResolvedValue({
      ok: false,
      reason: "verrouillee",
    });

    const resultat = await retirerProduit({ interventionId: 42, productId: 2 });

    expect(resultat?.data).toMatchObject({
      message:
        "Retrait impossible sur une intervention déjà démarrée ou clôturée.",
    });
  });
});
