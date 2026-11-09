// @vitest-environment node
//
// Lecture publique du catalogue. Ce module porte **trois** règles que rien
// d'autre ne porte, et chacune est une divergence assumée avec une autre vue de
// la même table :
//
//   · `is_active = false` est MASQUÉ ici, alors que la vue admin le grise ;
//   · le prix sort en chaîne à deux décimales, jamais en `Decimal` ni en
//     `number` — l'un ne se sérialise pas, l'autre perd les centimes ;
//   · l'ordre est le prix croissant, pas l'ordre d'insertion.
//
// Les trois sont invisibles à la relecture de la vue, qui reçoit un tableau déjà
// filtré, déjà trié et déjà converti.
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const count = vi.fn();
const aggregate = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const updateMany = vi.fn();
const historiqueCreate = vi.fn();

/// Le client transactionnel, décrit structurellement : c'est lui que reçoivent
/// les mutations, et c'est sur lui que `writeAuditLog` doit être appelé.
const tx = {
  service: { findUnique, create, updateMany },
  servicePriceHistory: { create: historiqueCreate },
};

vi.mock("@/lib/db/client", () => ({
  db: {
    // `findUnique` est partagé avec `tx` : c'est la même lecture, appelée hors
    // transaction par `lireForfaitAdmin` et dedans par `modifierForfait`.
    service: { findMany, count, aggregate, findUnique },
    $transaction: (rappel: (client: typeof tx) => unknown) => rappel(tx),
  },
}));

const writeAuditLog = vi.fn();
vi.mock("@/lib/audit/log", () => ({
  writeAuditLog: (entry: unknown, client: unknown) =>
    writeAuditLog(entry, client),
}));

const {
  creerForfait,
  listForfaitsAdmin,
  listForfaitsPublics,
  lireForfaitAdmin,
  lireSyntheseForfaits,
  modifierForfait,
} = await import("./forfaits");

const REVISION = {
  id: 1,
  label: "Révision complète",
  description: "Réglage des patins et disques, indexation des dérailleurs.",
  duration: 60,
  price: new Prisma.Decimal("85.00"),
};

const DIAGNOSTIC = {
  id: 2,
  label: "Diagnostic express",
  description: "Contrôle rapide de l'état général du vélo.",
  duration: 20,
  price: new Prisma.Decimal("25.00"),
};

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  count.mockResolvedValue(0);
  aggregate.mockResolvedValue({ _avg: { price: null } });
  create.mockResolvedValue({ id: 7, label: "Nouveau forfait" });
  // L'écriture conditionnelle apparie par défaut. Les tests de concurrence
  // forcent `{ count: 0 }` pour simuler le commit d'un concurrent.
  updateMany.mockResolvedValue({ count: 1 });
});

describe("listForfaitsPublics", () => {
  it("ne demande que les forfaits actifs", async () => {
    // Constitution §5.1 côté public, `US-FORFAIT-CONSULTER` §Cas nominal :
    // « les forfaits `is_active = false` n'apparaissent pas ». Le filtre est
    // vérifié sur la REQUÊTE et non sur le résultat : un filtre posé dans la vue
    // laisserait la prochaine surface qui lit ce catalogue hériter du mauvais
    // défaut.
    await listForfaitsPublics();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it("trie par prix croissant, puis par identifiant", async () => {
    await listForfaitsPublics();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ price: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("ne sélectionne aucune colonne au-delà du DTO public", async () => {
    await listForfaitsPublics();

    const [argument] = findMany.mock.calls[0] as [{ select: object }];
    expect(Object.keys(argument.select).toSorted()).toEqual([
      "description",
      "duration",
      "id",
      "label",
      "price",
    ]);
  });

  it("rend le prix en chaîne à deux décimales", async () => {
    // Prisma normalise `85.00` en `85` sur `toString()`. Le laisser passer
    // ferait afficher « 85 € » à un catalogue dont la colonne est un
    // DECIMAL(10,2), et rendrait le formatage dépendant de la valeur.
    findMany.mockResolvedValue([REVISION]);

    const [forfait] = await listForfaitsPublics();

    expect(forfait?.price).toBe("85.00");
    expect(typeof forfait?.price).toBe("string");
  });

  it("ne laisse fuir aucun Decimal vers l'appelant", async () => {
    // Un `Decimal` de decimal.js rendu tel quel dans un composant traverse la
    // frontière serveur/client comme un objet non sérialisable.
    findMany.mockResolvedValue([REVISION, DIAGNOSTIC]);

    const forfaits = await listForfaitsPublics();

    for (const forfait of forfaits) {
      expect(forfait.price).not.toBeInstanceOf(Prisma.Decimal);
    }
  });

  it("préserve libellé, description et durée en minutes", async () => {
    findMany.mockResolvedValue([DIAGNOSTIC]);

    await expect(listForfaitsPublics()).resolves.toEqual([
      {
        id: 2,
        label: "Diagnostic express",
        description: "Contrôle rapide de l'état général du vélo.",
        duration: 20,
        price: "25.00",
      },
    ]);
  });

  it("accepte un forfait sans description", async () => {
    // `services.description` est NULLable (dictionnaire §services champ 3). La
    // vue doit pouvoir s'en passer : c'est le PRIX qui conditionne l'affichage
    // d'un forfait, pas son texte.
    findMany.mockResolvedValue([{ ...DIAGNOSTIC, description: null }]);

    const [forfait] = await listForfaitsPublics();

    expect(forfait?.description).toBeNull();
  });

  it("rend un tableau vide quand aucun forfait n'est actif", async () => {
    // Le cas limite de `US-FORFAIT-CONSULTER` : c'est la VUE qui doit alors
    // afficher un message explicite. La requête, elle, ne doit ni lever ni
    // inventer un catalogue de repli.
    await expect(listForfaitsPublics()).resolves.toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Vue d'administration
//
// ⚠️ Ce que ces tests ne prouvent PAS : qu'une écriture conditionnelle refuse
// réellement un second écrivain concurrent. Un `tx` simulé exécute les rappels
// l'un après l'autre, il rendrait vert un code sans aucun prédicat. Ce qui se
// vérifie ici est le CONTENU du `where`, et le fait qu'un `count` à zéro soit
// traité comme un refus et non comme un succès vide.
//
// La réévaluation du `WHERE` par PostgreSQL en `READ COMMITTED` se prouve sur
// une vraie base : c'est l'E2E admin de T-B1-07.
// ─────────────────────────────────────────────────────────────────────────

const LIGNE_REVISION = { ...REVISION, isActive: true };

/// La fiche telle que l'écran l'a rendue, jeton compris.
async function ouvrirFiche() {
  findUnique.mockResolvedValue(LIGNE_REVISION);
  const fiche = await lireForfaitAdmin(1);
  if (!fiche) throw new Error("fixture : la fiche doit exister");
  return fiche;
}

const SAISIE = {
  label: "Révision complète",
  description: "Réglage des patins et disques, indexation des dérailleurs.",
  duration: 60,
  price: "85.00",
  isActive: true,
};

describe("listForfaitsAdmin", () => {
  it("n'exclut pas les forfaits inactifs", async () => {
    // L'inverse exact de la vue publique, sur la même table : un `where` ici
    // masquerait les forfaits retirés de la vente, que l'admin doit voir pour
    // les réactiver.
    await listForfaitsAdmin({ page: 1, tri: "label", sens: "asc" });

    const [argument] = findMany.mock.calls[0] as [{ where?: unknown }];
    expect(argument.where).toBeUndefined();
  });

  it("trie sur la colonne demandée, `id` départageant", async () => {
    await listForfaitsAdmin({ page: 1, tri: "price", sens: "desc" });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ price: "desc" }, { id: "asc" }],
      }),
    );
  });

  it("ramène une page hors bornes dans les bornes", async () => {
    // Une page 99 sur un catalogue d'une page afficherait une liste vide, donc
    // un catalogue vide, ce qu'il n'est pas.
    count.mockResolvedValue(3);

    const page = await listForfaitsAdmin({
      page: 99,
      tri: "label",
      sens: "asc",
    });

    expect(page.page).toBe(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it("expose un jeton de version par ligne", async () => {
    findMany.mockResolvedValue([LIGNE_REVISION]);
    count.mockResolvedValue(1);

    const page = await listForfaitsAdmin({
      page: 1,
      tri: "label",
      sens: "asc",
    });

    expect(page.forfaits[0]?.version).toEqual(expect.any(String));
    expect(page.forfaits[0]?.price).toBe("85.00");
  });
});

describe("lireSyntheseForfaits", () => {
  it("rend `null` plutôt qu'un prix moyen sur zéro forfait actif", async () => {
    await expect(lireSyntheseForfaits()).resolves.toMatchObject({
      prixMoyen: null,
    });
  });

  it("ne moyenne que les forfaits actifs", async () => {
    aggregate.mockResolvedValue({
      _avg: { price: new Prisma.Decimal("76.666") },
    });

    const synthese = await lireSyntheseForfaits();

    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    expect(synthese.prixMoyen).toBe("76.67");
  });

  it("ne confond pas le compteur des actifs avec celui des désactivés", async () => {
    // Les deux compteurs partent du MÊME `count`, distingués par leur seul
    // `where`. Sans cette vérification, les intervertir rendrait vert : les
    // trois cartes de l'en-tête afficheraient « 1 actif / 3 désactivés » sur
    // un catalogue de 3 actifs, et aucun autre test ne le verrait.
    count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);

    const synthese = await lireSyntheseForfaits();

    expect(count).toHaveBeenNthCalledWith(1, { where: { isActive: true } });
    expect(count).toHaveBeenNthCalledWith(2, { where: { isActive: false } });
    expect(synthese.actifs).toBe(3);
    expect(synthese.inactifs).toBe(1);
  });
});

describe("creerForfait", () => {
  it("n'écrit AUCUNE ligne d'historique des prix", async () => {
    // Amendement SPEC du 2026-10-16 : `old_price` est NOT NULL, et
    // l'historique n'enregistre que des changements. La naissance du forfait
    // est tracée par l'audit `CREATE`.
    await creerForfait(SAISIE, "admin-1");

    expect(historiqueCreate).not.toHaveBeenCalled();
  });

  it("trace un audit `CREATE` dans la transaction", async () => {
    await creerForfait(SAISIE, "admin-1");

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "services",
        entityId: "7",
        action: "CREATE",
        actorId: "admin-1",
      }),
      // Le client TRANSACTIONNEL : une trace écrite à côté de sa transaction
      // survivrait à un rollback.
      tx,
    );
  });

  it("traduit la violation d'unicité en refus métier", async () => {
    // Le filet est l'index partiel `services_label_active_key` : il n'y a pas
    // de contrôle applicatif à doubler, on ne verrouille pas une ligne qui
    // n'existe pas encore.
    create.mockRejectedValue({ code: "P2002" });

    await expect(creerForfait(SAISIE, "admin-1")).resolves.toEqual({
      ok: false,
      reason: "nom_pris",
    });
  });

  it("laisse remonter une panne qui n'est pas un conflit de nom", async () => {
    create.mockRejectedValue(new Error("connexion perdue"));

    await expect(creerForfait(SAISIE, "admin-1")).rejects.toThrow(
      "connexion perdue",
    );
  });
});

describe("modifierForfait, refus d'une fiche périmée", () => {
  it("refuse un jeton qui ne décrit plus l'état courant, sans rien écrire", async () => {
    // Deux administrateurs : le premier a enregistré, le second soumet la
    // fiche qu'il avait ouverte avant. Son jeton ne correspond plus.
    const fiche = await ouvrirFiche();
    findUnique.mockResolvedValue({
      ...LIGNE_REVISION,
      price: new Prisma.Decimal("90.00"),
    });

    const resultat = await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, price: "95.00" },
      "admin-2",
    );

    expect(resultat).toEqual({ ok: false, reason: "perime" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(historiqueCreate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuse quand l'écriture conditionnelle n'apparie aucune ligne", async () => {
    // Le test du mécanisme lui-même. Le jeton était bon à la lecture, mais un
    // concurrent a commité entre-temps : PostgreSQL réévalue le `WHERE` et le
    // second n'apparie plus rien. Traiter ce `count: 0` comme un succès
    // rendrait tout le dispositif décoratif.
    const fiche = await ouvrirFiche();
    updateMany.mockResolvedValue({ count: 0 });

    const resultat = await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, price: "95.00" },
      "admin-2",
    );

    expect(resultat).toEqual({ ok: false, reason: "perime" });
    expect(historiqueCreate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("fait porter le prédicat de l'écriture sur les valeurs lues", async () => {
    // C'est ce `where` qui ferme la fenêtre des millisecondes. Réduit au seul
    // `id`, il écraserait le concurrent au lieu de le refuser.
    const fiche = await ouvrirFiche();

    await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, price: "95.00" },
      "admin-2",
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 1,
          label: LIGNE_REVISION.label,
          description: LIGNE_REVISION.description,
          duration: LIGNE_REVISION.duration,
          price: LIGNE_REVISION.price,
          isActive: true,
        },
      }),
    );
  });

  it("refuse un forfait introuvable", async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      modifierForfait(
        { ...SAISIE, id: 404, version: "peu-importe" },
        "admin-1",
      ),
    ).resolves.toEqual({ ok: false, reason: "introuvable" });
  });
});

describe("modifierForfait, écritures", () => {
  it("n'écrit que les champs modifiés", async () => {
    const fiche = await ouvrirFiche();

    await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, price: "95.00" },
      "admin-1",
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { price: "95.00" } }),
    );
  });

  it("historise le prix UNIQUEMENT quand il change", async () => {
    const fiche = await ouvrirFiche();

    await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, label: "Révision" },
      "admin-1",
    );

    expect(historiqueCreate).not.toHaveBeenCalled();
  });

  it("écrit l'historique du prix dans la même transaction", async () => {
    const fiche = await ouvrirFiche();

    await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, price: "95.00" },
      "admin-1",
    );

    expect(historiqueCreate).toHaveBeenCalledWith({
      data: {
        serviceId: 1,
        oldPrice: "85.00",
        newPrice: "95.00",
        changedBy: "admin-1",
      },
    });
  });

  it("trace un audit `UPDATE` portant l'avant et l'après de chaque champ modifié", async () => {
    const fiche = await ouvrirFiche();

    await modifierForfait(
      {
        ...SAISIE,
        id: 1,
        version: fiche.version,
        price: "95.00",
        isActive: false,
      },
      "admin-1",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "services",
        entityId: "1",
        action: "UPDATE",
        actorId: "admin-1",
        details: {
          price: { before: "85.00", after: "95.00" },
          isActive: { before: true, after: false },
        },
      }),
      tx,
    );
  });

  it("n'écrit rien quand rien n'a changé", async () => {
    // `US-FORFAIT-MODIFIER` : « rien n'est écrit, ni historique ni audit, et le
    // message Aucune modification ». Une entrée d'audit sans changement
    // décrirait un acte de gestion qui n'a pas eu lieu.
    const fiche = await ouvrirFiche();

    const resultat = await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version },
      "admin-1",
    );

    expect(resultat).toEqual({
      ok: true,
      label: "Révision complète",
      changements: [],
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(historiqueCreate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("désactive un forfait sans toucher à ses autres colonnes", async () => {
    const fiche = await ouvrirFiche();

    await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, isActive: false },
      "admin-1",
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it("traduit la violation d'unicité en refus métier", async () => {
    const fiche = await ouvrirFiche();
    updateMany.mockRejectedValue({ code: "P2002" });

    await expect(
      modifierForfait(
        {
          ...SAISIE,
          id: 1,
          version: fiche.version,
          label: "Diagnostic express",
        },
        "admin-1",
      ),
    ).resolves.toEqual({ ok: false, reason: "nom_pris" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tests ajoutés par l'agent testeur (verify-only) sur T-B1-01.
//
// Ce qui manquait : les deux tests de concurrence existants font porter la
// modification du second administrateur sur le MÊME champ que le premier. Or
// le cas qui coûte cher en production est l'inverse : deux administrateurs qui
// se croient sans conflit parce qu'ils éditent des champs différents.
// ─────────────────────────────────────────────────────────────────────────

describe("modifierForfait, deux administrateurs sur des champs disjoints", () => {
  it("refuse une modification du nom quand un autre a changé le prix", async () => {
    // A ouvre la fiche, B change le PRIX et enregistre, A soumet un nouveau
    // NOM. Rien ne se chevauche, et c'est pourtant un refus : le jeton porte
    // la fiche ENTIÈRE, pas le champ édité. Un jeton par colonne laisserait
    // A enregistrer sur un état qu'il n'a jamais vu, et son audit affirmerait
    // un `before` déjà faux.
    const fiche = await ouvrirFiche();
    findUnique.mockResolvedValue({
      ...LIGNE_REVISION,
      price: new Prisma.Decimal("90.00"),
    });

    const resultat = await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, label: "Révision express" },
      "admin-A",
    );

    expect(resultat).toEqual({ ok: false, reason: "perime" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(historiqueCreate).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("refuse une désactivation quand un autre a changé la description", async () => {
    // La description est le champ le moins « conflictuel » qu'on puisse
    // imaginer, et c'est le piège : si l'empreinte ne la couvrait pas, la
    // désactivation passerait en écrasant le texte de l'autre.
    const fiche = await ouvrirFiche();
    findUnique.mockResolvedValue({
      ...LIGNE_REVISION,
      description: "Texte réécrit par un autre administrateur.",
    });

    const resultat = await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, isActive: false },
      "admin-A",
    );

    expect(resultat).toEqual({ ok: false, reason: "perime" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("refuse quand un autre a vidé la description", async () => {
    // `NULL` et la chaîne vide décrivent le même état côté formulaire, mais
    // pas côté empreinte : confondre les deux ferait passer pour inchangée
    // une colonne que quelqu'un vient de vider.
    const fiche = await ouvrirFiche();
    findUnique.mockResolvedValue({ ...LIGNE_REVISION, description: null });

    const resultat = await modifierForfait(
      { ...SAISIE, id: 1, version: fiche.version, price: "95.00" },
      "admin-A",
    );

    expect(resultat).toEqual({ ok: false, reason: "perime" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("fait porter l'audit sur l'état RELU, jamais sur celui que l'appelant croit", async () => {
    // Le `before` du journal doit venir de la ligne lue dans la transaction,
    // qui est aussi celle qui sert de prédicat à l'écriture. Les désolidariser
    // produirait un journal qui ment - pire qu'un journal absent, c'est la
    // pièce qu'on produit en cas de contestation (Constitution §4.2).
    findUnique.mockResolvedValue({
      ...LIGNE_REVISION,
      price: new Prisma.Decimal("70.00"),
    });
    const fiche = await lireForfaitAdmin(1);

    await modifierForfait(
      { ...SAISIE, id: 1, version: fiche?.version ?? "", price: "95.00" },
      "admin-A",
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { price: { before: "70.00", after: "95.00" } },
      }),
      tx,
    );
    expect(historiqueCreate).toHaveBeenCalledWith({
      data: {
        serviceId: 1,
        oldPrice: "70.00",
        newPrice: "95.00",
        changedBy: "admin-A",
      },
    });
  });
});

describe("creerForfait, forfait créé hors vente", () => {
  it("trace l'état demandé et non le défaut du modèle", async () => {
    // Le formulaire laisse décocher « Proposé à la réservation ». La SPEC
    // écrit `is_active = true` par DÉFAUT, pas « toujours » : ce qui ne doit
    // pas arriver, c'est qu'un forfait créé décoché soit journalisé actif.
    await creerForfait({ ...SAISIE, isActive: false }, "admin-1");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          isActive: { before: null, after: false },
        }),
      }),
      tx,
    );
  });
});
