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

const queryRaw = vi.fn();

/// Commit s'il rend, rollback s'il leve - la seule distinction qui compte, et
/// celle qu'un `$transaction: (cb) => cb(tx)` naif efface (leçon PR #32).
const commits: string[] = [];
const rollbacks: string[] = [];

/// ⚠️ **Le faux `$transaction` ne doit PAS executer son rappel immediatement**,
/// sans quoi deux appels concurrents se croisent sans que rien ne s'y oppose et
/// aucun test ne peut dire si le quota tient sous concurrence. Ce qui est
/// modele ici est le regime reel de PostgreSQL :
///
///   · **READ COMMITTED par defaut** - un `count` ne voit pas les insertions
///     non commitees des autres transactions. Deux transactions qui comptent
///     puis inserent lisent donc le meme total ;
///   · **un verrou de ligne pris par `SELECT … FOR UPDATE`** (le `tx.$queryRaw`
///     ci-dessous) fait attendre la transaction suivante jusqu'au commit de la
///     precedente. C'est le mecanisme que `queries/produits.ts` §verrouillerProduits
///     emploie deja pour le stock, et le seul filet de ce depot : `photos` ne
///     porte aucune contrainte de cardinalite en base.
///
/// Chaque transaction recoit son PROPRE client : le partager rendrait le
/// verrou impossible a rattacher a celle qui l'a pris.
let fileDesVerrous: Promise<void> = Promise.resolve();

vi.mock("@/lib/db/client", () => ({
  db: {
    $transaction: async (rappel: (client: unknown) => unknown) => {
      let liberer: () => void = () => undefined;

      const tx = {
        intervention: {
          findFirst: (args: unknown) => interventionFindFirst(args),
        },
        photo: {
          count: (args: unknown) => photoCount(args),
          create: (args: unknown) => photoCreate(args),
        },
        $queryRaw: async (...args: unknown[]) => {
          const precedent = fileDesVerrous;
          fileDesVerrous = new Promise<void>((resoudre) => {
            liberer = resoudre;
          });
          await precedent;
          return queryRaw(args);
        },
      };

      try {
        const valeur = await rappel(tx);
        commits.push("commit");
        return valeur;
      } catch (erreur) {
        rollbacks.push("rollback");
        throw erreur;
      } finally {
        // Le commit (ou le rollback) relache ce que la transaction tenait.
        liberer();
      }
    },
    photo: { findFirst: (args: unknown) => photoFindFirst(args) },
  },
}));

const { attacherPhoto, chargerPhotoAutorisee } = await import("./photos");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const TIERS = "22222222-2222-4222-8222-222222222222";
/// Le technicien affecte au rendez-vous - second titulaire depuis T-V2-02.
const TECH = "33333333-3333-4333-8333-333333333333";
const CHEMIN = "uploads/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.webp";

beforeEach(() => {
  vi.clearAllMocks();
  commits.length = 0;
  rollbacks.length = 0;
  fileDesVerrous = Promise.resolve();
  interventionFindFirst.mockResolvedValue({ status: "PLANNED" });
  photoCount.mockResolvedValue(0);
  photoCreate.mockResolvedValue({ id: 7 });
  queryRaw.mockResolvedValue([]);
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

  it("refuse le second de deux depots concurrents sur la cinquieme place", async () => {
    // C'est la propriete que le module s'attribue en toutes lettres : « le
    // quota des cinq photos par intervention se verifie **dans la
    // transaction** : compte avant, deux depots simultanes le franchiraient
    // tous les deux » (`photos.ts:40-44`). Ouvrir une transaction ne suffit
    // pas a l'obtenir. Sous READ COMMITTED - le defaut de PostgreSQL, et celui
    // de `db.$transaction` sans `isolationLevel` - le `count` de chaque
    // transaction ignore l'insertion non commitee de l'autre : les deux lisent
    // quatre, les deux ecrivent, l'intervention se retrouve avec six photos.
    //
    // Rien d'autre ne rattrape : `photos` n'a aucune contrainte de cardinalite
    // en base, la ou le stock a son `products_stock_non_negative` (migration
    // 013) DERRIERE le `SELECT … FOR UPDATE` de `verrouillerProduits`. Ce
    // dossier-ci n'a ni l'un ni l'autre.
    //
    // Le scenario n'est pas theorique : `bloc-photos.tsx` envoie les fichiers
    // en boucle depuis l'ecran, et deux onglets ouverts sur la meme
    // intervention suffisent - le commentaire du composant (`:54-56`) le dit
    // lui-meme, en s'appuyant sur une garde serveur qui n'existe pas.
    //
    // ⚠️ Ce que ce test suppose du correctif : qu'il passe par un verrou de
    // ligne pris dans la transaction (`tx.$queryRaw … FOR UPDATE`, le modele
    // du faux client ci-dessus), comme le stock. Si Benjamin tranche pour une
    // contrainte en base, c'est le faux client qu'il faudra etendre - pas
    // l'assertion, qui porte sur la propriete et non sur le mecanisme.
    const enBase: { id: number }[] = [
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ];

    photoCount.mockImplementation(async () => {
      // Le `await` est le point d'entrelacement : sans lui, les deux
      // transactions s'executeraient l'une apres l'autre par construction, et
      // le faux client rendrait vert un code sans aucun verrou.
      await Promise.resolve();
      return enBase.length;
    });
    photoCreate.mockImplementation(async () => {
      await Promise.resolve();
      const ligne = { id: enBase.length + 1 };
      enBase.push(ligne);
      return ligne;
    });

    const resultats = await Promise.all([
      attacherPhoto({ interventionId: 42, clientId: CLIENT, url: CHEMIN }),
      attacherPhoto({ interventionId: 42, clientId: CLIENT, url: CHEMIN }),
    ]);

    expect(resultats.filter((resultat) => resultat.ok)).toHaveLength(1);
    expect(resultats).toContainEqual({ ok: false, reason: "quota_atteint" });
    expect(enBase).toHaveLength(5);
  });
});

// ⚠️ **Renommee `chargerPhotoDuClient` -> `chargerPhotoAutorisee` par T-V2-02**,
// et les deux premiers tests ci-dessous sont reecrits pour cette raison. Regle
// du test rouge, cas 3 : l'oracle figeait une clause `where` que le
// remaniement invalide legitimement, l'ecran de detail technicien ayant besoin
// de lire les photos que le client a jointes
// (`US-INTERVENTION-AFFICHER` §Cas nominal). La PROPRIETE verifiee, elle, ne
// faiblit pas : elle gagne une branche et en garde la borne.
describe("chargerPhotoAutorisee", () => {
  it("lit la propriete sur l'INTERVENTION, pas sur l'auteur du depot", async () => {
    // Une photo deposee par le technicien sur mon intervention m'est destinee.
    // C'est le rendez-vous qui decide de qui la voit, pas qui a tenu
    // l'appareil.
    photoFindFirst.mockResolvedValue({ url: CHEMIN });

    await chargerPhotoAutorisee({ photoId: 7, userId: CLIENT });

    expect(photoFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: 7,
        intervention: { OR: [{ clientId: CLIENT }, { techId: CLIENT }] },
      },
    });
  });

  it("accepte les DEUX titulaires du rendez-vous, client et technicien affecte", async () => {
    // 🔴 Le coeur de l'elargissement de T-V2-02. Sans la seconde branche,
    // l'ecran T2 rendrait des images cassees : la route repondrait 404 au
    // technicien pour les photos preparatoires de SON intervention.
    photoFindFirst.mockResolvedValue({ url: CHEMIN });

    await chargerPhotoAutorisee({ photoId: 7, userId: TECH });

    const where = photoFindFirst.mock.calls[0]?.[0] as {
      where: { intervention: { OR: unknown[] } };
    };

    expect(where.where.intervention.OR).toEqual([
      { clientId: TECH },
      { techId: TECH },
    ]);
  });

  it("ne qualifie PAS le demandeur par son role", async () => {
    // La regle est « titulaire du rendez-vous », pas « porteur de ROLE_TECH ».
    // Un `roles` qui remonterait ici voudrait dire qu'un technicien peut lire
    // les photos d'une intervention qui n'est pas la sienne.
    photoFindFirst.mockResolvedValue({ url: CHEMIN });

    await chargerPhotoAutorisee({ photoId: 7, userId: TECH });

    expect(JSON.stringify(photoFindFirst.mock.calls[0]?.[0])).not.toContain(
      "ROLE_",
    );
  });

  it("ne rend que le chemin, rien d'autre", async () => {
    // Le reste de la ligne (auteur, horodatage, intervention) n'a aucune raison
    // de traverser jusqu'au Route Handler.
    photoFindFirst.mockResolvedValue({ url: CHEMIN });

    await chargerPhotoAutorisee({ photoId: 7, userId: CLIENT });

    expect(photoFindFirst.mock.calls[0]?.[0]).toMatchObject({
      select: { url: true },
    });
  });

  it("repond `null` pour la photo d'un tiers", async () => {
    photoFindFirst.mockResolvedValue(null);

    await expect(
      chargerPhotoAutorisee({ photoId: 7, userId: TIERS }),
    ).resolves.toBeNull();
  });
});
