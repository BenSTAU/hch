// @vitest-environment node
//
// Photos client attachees a une intervention - le versant T+n.
//
// Deux proprietes gouvernent ce module, et aucune des deux n'est visible a
// l'ecran :
//
//   · **le cloisonnement** - une photo prise au domicile de quelqu'un ne doit
//     jamais etre lisible par un autre compte, et la garde est dans la clause
//     `where`, donc impossible a contourner par un `if` oublie en amont ;
//   · **le quota** - cinq photos par intervention, compte DANS la transaction.
//     Compte avant, deux depots simultanes le franchiraient tous les deux.
import { beforeEach, describe, expect, it, vi } from "vitest";

const interventionFindFirst = vi.fn();
const photoCount = vi.fn();
const photoCreate = vi.fn();
const photoFindFirst = vi.fn();

const tx = {
  intervention: { findFirst: (args: unknown) => interventionFindFirst(args) },
  photo: {
    count: (args: unknown) => photoCount(args),
    create: (args: unknown) => photoCreate(args),
  },
};

/// Commit s'il rend, rollback s'il leve - la seule distinction qui compte, et
/// celle qu'un `$transaction: (cb) => cb(tx)` naif efface (leçon PR #32).
const commits: string[] = [];
const rollbacks: string[] = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    $transaction: async (rappel: (client: typeof tx) => unknown) => {
      try {
        const valeur = await rappel(tx);
        commits.push("commit");
        return valeur;
      } catch (erreur) {
        rollbacks.push("rollback");
        throw erreur;
      }
    },
    photo: { findFirst: (args: unknown) => photoFindFirst(args) },
  },
}));

const { attacherPhoto, chargerPhotoDuClient } = await import("./photos");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const TIERS = "22222222-2222-4222-8222-222222222222";
const CHEMIN = "uploads/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.webp";

beforeEach(() => {
  vi.clearAllMocks();
  commits.length = 0;
  rollbacks.length = 0;
  interventionFindFirst.mockResolvedValue({ status: "PLANNED" });
  photoCount.mockResolvedValue(0);
  photoCreate.mockResolvedValue({ id: 7 });
});

describe("attacherPhoto - cloisonnement", () => {
  it("charge l'intervention DU client, jamais par son seul identifiant", async () => {
    await attacherPhoto({ interventionId: 42, clientId: CLIENT, url: CHEMIN });

    expect(interventionFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 42, clientId: CLIENT },
    });
  });

  it("repond « introuvable » sur l'intervention d'un tiers, sans la distinguer d'une inconnue", async () => {
    // `interventions.id` est un SERIAL. Un refus distinct d'un « introuvable »
    // confirmerait l'existence du rendez-vous d'autrui a qui incremente.
    interventionFindFirst.mockResolvedValue(null);

    const resultat = await attacherPhoto({
      interventionId: 42,
      clientId: TIERS,
      url: CHEMIN,
    });

    expect(resultat).toEqual({ ok: false, reason: "introuvable" });
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("ecrit l'auteur depuis le CONTEXTE, jamais depuis la charge utile", async () => {
    await attacherPhoto({ interventionId: 42, clientId: CLIENT, url: CHEMIN });

    expect(photoCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { uploadedByUserId: CLIENT, interventionId: 42, url: CHEMIN },
    });
  });

  it("marque la photo `BEFORE`, jamais `AFTER`", async () => {
    // `AFTER` appartient au technicien, sur le terrain, et c'est ce type qui
    // porte l'invariant de preuve terrain (Constitution §2.5). Un client qui
    // ecrirait des lignes `AFTER` satisferait le prealable de
    // `US-INTERVENTION-MARQUER-FAITE` a la place du technicien.
    await attacherPhoto({ interventionId: 42, clientId: CLIENT, url: CHEMIN });

    expect(photoCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { type: "BEFORE" },
    });
  });
});

describe("attacherPhoto - statut", () => {
  it("refuse le depot des que l'intervention est demarree", async () => {
    // Tranche en B7 Session 4 (Q2a) pour les produits, meme regime ici : apres
    // `IN_PROGRESS`, les photos sont celles du technicien.
    interventionFindFirst.mockResolvedValue({ status: "IN_PROGRESS" });

    const resultat = await attacherPhoto({
      interventionId: 42,
      clientId: CLIENT,
      url: CHEMIN,
    });

    expect(resultat).toEqual({ ok: false, reason: "verrouillee" });
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("refuse le depot sur une intervention cloturee ou annulee", async () => {
    for (const status of ["DONE", "CANCELLED"]) {
      vi.clearAllMocks();
      interventionFindFirst.mockResolvedValue({ status });
      photoCount.mockResolvedValue(0);

      const resultat = await attacherPhoto({
        interventionId: 42,
        clientId: CLIENT,
        url: CHEMIN,
      });

      expect(resultat).toEqual({ ok: false, reason: "verrouillee" });
    }
  });
});

describe("attacherPhoto - quota", () => {
  it("accepte la cinquieme photo", async () => {
    photoCount.mockResolvedValue(4);

    const resultat = await attacherPhoto({
      interventionId: 42,
      clientId: CLIENT,
      url: CHEMIN,
    });

    expect(resultat).toEqual({ ok: true, photoId: 7, nbPhotos: 5 });
  });

  it("refuse la sixieme", async () => {
    // `US-INTERVENTION-PHOTOS-AJOUTER` §Cas d'erreur : « 5 photos maximum par
    // intervention ».
    photoCount.mockResolvedValue(5);

    const resultat = await attacherPhoto({
      interventionId: 42,
      clientId: CLIENT,
      url: CHEMIN,
    });

    expect(resultat).toEqual({ ok: false, reason: "quota_atteint" });
    expect(photoCreate).not.toHaveBeenCalled();
  });

  it("compte les photos DE CETTE intervention, pas celles du client", async () => {
    // Le quota est « par intervention ». Compte par client, il bloquerait le
    // sixieme depot d'un habitue sur un rendez-vous tout neuf.
    await attacherPhoto({ interventionId: 42, clientId: CLIENT, url: CHEMIN });

    expect(photoCount.mock.calls[0]?.[0]).toEqual({
      where: { interventionId: 42 },
    });
  });

  it("compte DANS la transaction, pas avant", async () => {
    // Deux depots simultanes franchiraient sinon le plafond tous les deux : la
    // lecture et l'ecriture doivent partager le meme instantane.
    await attacherPhoto({ interventionId: 42, clientId: CLIENT, url: CHEMIN });

    expect(commits).toHaveLength(1);
    expect(photoCount).toHaveBeenCalled();
  });
});

describe("chargerPhotoDuClient", () => {
  it("lit la propriete sur l'INTERVENTION, pas sur l'auteur du depot", async () => {
    // Une photo deposee par le technicien sur mon intervention m'est destinee.
    // C'est le rendez-vous qui decide de qui la voit, pas qui a tenu
    // l'appareil - et la vue technicien de V2 en depend.
    photoFindFirst.mockResolvedValue({ url: CHEMIN });

    await chargerPhotoDuClient({ photoId: 7, clientId: CLIENT });

    expect(photoFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 7, intervention: { clientId: CLIENT } },
    });
  });

  it("ne rend que le chemin, rien d'autre", async () => {
    // Le reste de la ligne (auteur, horodatage, intervention) n'a aucune raison
    // de traverser jusqu'au Route Handler.
    photoFindFirst.mockResolvedValue({ url: CHEMIN });

    await chargerPhotoDuClient({ photoId: 7, clientId: CLIENT });

    expect(photoFindFirst.mock.calls[0]?.[0]).toMatchObject({
      select: { url: true },
    });
  });

  it("repond `null` pour la photo d'un tiers", async () => {
    photoFindFirst.mockResolvedValue(null);

    await expect(
      chargerPhotoDuClient({ photoId: 7, clientId: TIERS }),
    ).resolves.toBeNull();
  });
});
