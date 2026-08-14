// @vitest-environment node
//
// Les gardes de propriété du domaine `cycles`, et la frontière `PLANNED` du
// rattachement.
//
// ⚠️ Ce que ces tests prouvent est la **forme des requêtes** et l'ordre des
// écritures : un `tx` simulé exécute les callbacks l'un après l'autre par
// construction. Ce qu'ils prouvent quand même, et qui est l'essentiel ici, est
// que la propriété vit dans la clause `WHERE` - une garde applicative séparée
// laisserait une fenêtre entre la lecture et l'écriture, et ne se verrait pas
// sur une assertion de résultat.
import { beforeEach, describe, expect, it, vi } from "vitest";

const cycleFindMany = vi.fn();
const cycleCreate = vi.fn();
const cycleUpdateMany = vi.fn();
const cycleFindFirst = vi.fn();
const interventionFindFirst = vi.fn();
const interventionUpdate = vi.fn();

const tx = {
  cycle: { findFirst: cycleFindFirst },
  intervention: {
    findFirst: interventionFindFirst,
    update: interventionUpdate,
  },
};

vi.mock("@/lib/db/client", () => ({
  db: {
    cycle: {
      findMany: (args: unknown) => cycleFindMany(args),
      create: (args: unknown) => cycleCreate(args),
      updateMany: (args: unknown) => cycleUpdateMany(args),
    },
    $transaction: (rappel: (client: typeof tx) => unknown) => rappel(tx),
  },
}));

const {
  creerCycle,
  listerCyclesDuClient,
  modifierCycleDuClient,
  rattacherCycleAIntervention,
} = await import("./cycles");

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";
const TIERS = "8a2b1c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";

const CHAMPS = {
  brand: "Decathlon",
  model: "Elops 900",
  type: "CLASSIC",
  year: 2023,
};

beforeEach(() => {
  vi.clearAllMocks();
  cycleFindMany.mockResolvedValue([]);
  cycleCreate.mockResolvedValue({ id: 12, ...CHAMPS });
  cycleUpdateMany.mockResolvedValue({ count: 1 });
  cycleFindFirst.mockResolvedValue({ id: 12 });
  interventionFindFirst.mockResolvedValue({ status: "PLANNED" });
  interventionUpdate.mockResolvedValue({});
});

describe("listerCyclesDuClient", () => {
  it("filtre sur le propriétaire", async () => {
    await listerCyclesDuClient({ userId: CLIENT });

    expect(cycleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: CLIENT } }),
    );
  });

  it("trie par id DESC, faute de colonne d'horodatage", async () => {
    // `US-CYCLES-LISTER` écrit `created_at DESC` et la colonne n'existe pas au
    // dictionnaire. `id` est un SERIAL, donc monotone : même ordre, coût nul.
    // Arbitrage B1 du 2026-08-14, les deux US amendées au même geste.
    await listerCyclesDuClient({ userId: CLIENT });

    expect(cycleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: "desc" } }),
    );
  });

  it("ne remonte pas le propriétaire au navigateur", async () => {
    await listerCyclesDuClient({ userId: CLIENT });

    const appel = cycleFindMany.mock.calls[0]?.[0] as {
      select: Record<string, boolean>;
    };

    expect(appel.select).not.toHaveProperty("userId");
  });
});

describe("creerCycle", () => {
  it("écrit le propriétaire reçu, et les quatre champs", async () => {
    await creerCycle({ ...CHAMPS, type: "CLASSIC", userId: CLIENT });

    expect(cycleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { ...CHAMPS, userId: CLIENT },
      }),
    );
  });
});

describe("modifierCycleDuClient", () => {
  it("met la propriété dans le WHERE, pas dans une garde séparée", async () => {
    await modifierCycleDuClient({
      ...CHAMPS,
      type: "CLASSIC",
      cycleId: 12,
      userId: CLIENT,
    });

    expect(cycleUpdateMany).toHaveBeenCalledWith({
      where: { id: 12, userId: CLIENT },
      data: CHAMPS,
    });
  });

  it("rend « introuvable » quand aucune ligne ne correspond", async () => {
    // Le vélo d'autrui et le vélo inexistant produisent tous deux `count: 0`,
    // donc le MÊME refus. `cycles.id` est un SERIAL : deux refus distincts
    // confirmeraient l'existence du premier (B2).
    cycleUpdateMany.mockResolvedValue({ count: 0 });

    const resultat = await modifierCycleDuClient({
      ...CHAMPS,
      type: "CLASSIC",
      cycleId: 12,
      userId: TIERS,
    });

    expect(resultat).toEqual({ ok: false, reason: "introuvable" });
  });
});

describe("rattacherCycleAIntervention", () => {
  it("écrit cycle_id quand tout concorde", async () => {
    const resultat = await rattacherCycleAIntervention({
      interventionId: 3,
      cycleId: 12,
      clientId: CLIENT,
    });

    expect(resultat).toEqual({ ok: true });
    expect(interventionUpdate).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { cycleId: 12 },
    });
  });

  it("lit l'intervention sur le COUPLE (id, client)", async () => {
    await rattacherCycleAIntervention({
      interventionId: 3,
      cycleId: 12,
      clientId: CLIENT,
    });

    expect(interventionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3, clientId: CLIENT } }),
    );
  });

  it("rend « introuvable » sur une intervention absente ou d'autrui", async () => {
    interventionFindFirst.mockResolvedValue(null);

    const resultat = await rattacherCycleAIntervention({
      interventionId: 3,
      cycleId: 12,
      clientId: TIERS,
    });

    expect(resultat).toEqual({ ok: false, reason: "introuvable" });
    expect(interventionUpdate).not.toHaveBeenCalled();
  });

  it("refuse hors PLANNED, sur les trois autres statuts", async () => {
    // Même frontière que le verrou produits : une intervention en cours, faite
    // ou annulée ne change plus de vélo.
    for (const status of ["IN_PROGRESS", "DONE", "CANCELLED"]) {
      vi.clearAllMocks();
      interventionFindFirst.mockResolvedValue({ status });

      const resultat = await rattacherCycleAIntervention({
        interventionId: 3,
        cycleId: 12,
        clientId: CLIENT,
      });

      expect(resultat).toEqual({ ok: false, reason: "verrouillee" });
      expect(interventionUpdate).not.toHaveBeenCalled();
    }
  });

  it("refuse le vélo d'un tiers, que la FK accepterait pourtant", async () => {
    // La base garantit que le vélo EXISTE, pas qu'il est à l'appelant. Sans
    // cette lecture, `cycle_id` accepterait le vélo du voisin.
    cycleFindFirst.mockResolvedValue(null);

    const resultat = await rattacherCycleAIntervention({
      interventionId: 3,
      cycleId: 999,
      clientId: CLIENT,
    });

    expect(resultat).toEqual({ ok: false, reason: "cycle_introuvable" });
    expect(interventionUpdate).not.toHaveBeenCalled();
  });

  it("vérifie le vélo sur le COUPLE (id, propriétaire)", async () => {
    await rattacherCycleAIntervention({
      interventionId: 3,
      cycleId: 12,
      clientId: CLIENT,
    });

    expect(cycleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 12, userId: CLIENT } }),
    );
  });

  it("détache sans interroger cycles", async () => {
    // `null` n'a pas de propriétaire à vérifier : une lecture de plus serait un
    // aller-retour pour rien.
    const resultat = await rattacherCycleAIntervention({
      interventionId: 3,
      cycleId: null,
      clientId: CLIENT,
    });

    expect(resultat).toEqual({ ok: true });
    expect(cycleFindFirst).not.toHaveBeenCalled();
    expect(interventionUpdate).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { cycleId: null },
    });
  });

  it("refuse le détachement hors PLANNED, comme le rattachement", async () => {
    interventionFindFirst.mockResolvedValue({ status: "DONE" });

    const resultat = await rattacherCycleAIntervention({
      interventionId: 3,
      cycleId: null,
      clientId: CLIENT,
    });

    expect(resultat).toEqual({ ok: false, reason: "verrouillee" });
  });
});
