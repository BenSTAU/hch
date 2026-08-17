// @vitest-environment node
//
// `cloturerInterventionDuTech` - la transaction qui termine l'intervention ET
// enregistre l'encaissement. C'est la tache qui ferme le critere n°2, et la
// revue humaine de T-V2-03 porte nommement sur l'atomicite du couple.
//
// Ce que ce fichier eprouve tient en quatre propositions :
//
//   · **rien ne se commite a moitie.** SPEC §Amendements A4 : une intervention
//     `DONE` sans ligne de paiement, ou l'inverse, est un etat incoherent ;
//   · **les deux branches ecrivent des lignes coherentes.** `PAID` porte son
//     mode et son instant, `UNPAID` porte trois valeurs nulles et un zero ;
//   · **le verrou tient.** Deux clotures concurrentes ne produisent qu'une
//     ligne `payments` et qu'une entree d'audit ;
//   · **la propriete est en base**, dans la clause `where`, pas dans un `if`.
//
// Le faux `$transaction` ne simule pas Postgres, il OBSERVE ce que Postgres
// observerait : le rappel a-t-il rendu une valeur (commit) ou leve (rollback) ?
// Modele de verrouillage repris de `interventions.test.ts` : READ COMMITTED
// plus un verrou de ligne qui fait attendre la transaction suivante jusqu'au
// commit de la precedente.
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const txInterventionFindFirst = vi.fn();
const txInterventionFindUniqueOrThrow = vi.fn();
const txInterventionUpdate = vi.fn();
const txPaymentCreate = vi.fn();
const auditCreate = vi.fn();
const queryRaw = vi.fn();

/// L'ordre reel des ecritures dans la transaction, tel que le rappel les emet.
/// Il compte : le verrou doit etre pris APRES la garde de propriete, jamais
/// avant, sinon un appelant qui incremente des identifiants verrouille le
/// rendez-vous d'un tiers.
let journal: string[] = [];

let fileDesVerrous: Promise<void> = Promise.resolve();

function creerTx() {
  let liberer: () => void = () => undefined;
  let detientLeVerrou = false;

  const client = {
    $queryRaw: async (
      _strings: TemplateStringsArray,
      ...valeurs: unknown[]
    ) => {
      journal.push("verrou");
      if (!detientLeVerrou) {
        detientLeVerrou = true;
        const precedent = fileDesVerrous;
        fileDesVerrous = new Promise<void>((resoudre) => {
          liberer = resoudre;
        });
        await precedent;
      }
      return queryRaw(valeurs);
    },
    intervention: {
      findFirst: (args: unknown) => {
        journal.push("lecture");
        return txInterventionFindFirst(args);
      },
      findUniqueOrThrow: (args: unknown) => {
        journal.push("relecture");
        return txInterventionFindUniqueOrThrow(args);
      },
      update: (args: unknown) => {
        journal.push("intervention.update");
        return txInterventionUpdate(args);
      },
    },
    payment: {
      create: (args: unknown) => {
        journal.push("payment.create");
        return txPaymentCreate(args);
      },
    },
    auditLog: {
      create: (args: unknown) => {
        journal.push("audit.create");
        return auditCreate(args);
      },
    },
  };

  return {
    client,
    relacher: () => {
      liberer();
    },
  };
}

type FauxTx = ReturnType<typeof creerTx>["client"];

/// Ce que la base fait du rappel : commit s'il rend, rollback s'il leve.
const commits: string[] = [];
const rollbacks: string[] = [];

const transaction = vi.fn(async (rappel: (client: FauxTx) => unknown) => {
  const { client, relacher } = creerTx();
  try {
    const valeur = await rappel(client);
    commits.push("commit");
    return valeur;
  } catch (erreur) {
    rollbacks.push("rollback");
    throw erreur;
  } finally {
    // Le verrou tombe au commit comme au rollback, jamais avant : c'est
    // exactement la portee d'un verrou de ligne PostgreSQL.
    relacher();
  }
});

vi.mock("@/lib/db/client", () => ({
  db: {
    $transaction: (rappel: (client: FauxTx) => unknown) => transaction(rappel),
  },
}));

const { cloturerInterventionDuTech } = await import("./paiements");

const TECH = "22222222-2222-4222-8222-222222222222";
const MAINTENANT = new Date("2026-08-20T12:34:56.000Z");

const EN_COURS = {
  status: "IN_PROGRESS",
  appointmentAt: new Date("2026-08-20T08:00:00.000Z"),
  service: { label: "Révision complète" },
  client: { email: "julien@exemple.fr", firstname: "Julien" },
};

function cloturer(surcharge: Record<string, unknown> = {}) {
  return cloturerInterventionDuTech({
    interventionId: 847,
    techId: TECH,
    maintenant: MAINTENANT,
    demande: { issue: "encaisse", montant: "97.90", methode: "CB" },
    ...surcharge,
  } as Parameters<typeof cloturerInterventionDuTech>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  commits.length = 0;
  rollbacks.length = 0;
  journal = [];
  fileDesVerrous = Promise.resolve();

  txInterventionFindFirst.mockResolvedValue(EN_COURS);
  txInterventionFindUniqueOrThrow.mockResolvedValue({ status: "IN_PROGRESS" });
  txInterventionUpdate.mockResolvedValue({});
  txPaymentCreate.mockResolvedValue({});
  auditCreate.mockResolvedValue({});
  queryRaw.mockResolvedValue([{ id: 847 }]);
});

describe("cloturerInterventionDuTech - branche nominale", () => {
  it("ecrit une ligne PAID portant son mode et son instant", async () => {
    // 🔴 La validation croisee du dictionnaire §payments, versant `PAID` :
    // « status=PAID implique method NN + paid_at NN ». Elle vit en Zod ET dans
    // ce qu'ecrit le helper - le schema empeche une saisie incoherente
    // d'arriver, celui-ci empeche une ecriture incoherente de partir.
    await cloturer();

    expect(txPaymentCreate).toHaveBeenCalledWith({
      data: {
        interventionId: 847,
        amountSnapshot: new Prisma.Decimal("97.90"),
        method: "CB",
        status: "PAID",
        paidAt: MAINTENANT,
        recordedBy: TECH,
      },
    });
  });

  it("passe l'intervention a DONE et date sa fin", async () => {
    await cloturer();

    expect(txInterventionUpdate).toHaveBeenCalledWith({
      where: { id: 847 },
      data: { status: "DONE", completedAt: MAINTENANT },
    });
  });

  it("date le paiement et la cloture sur le MEME instant", async () => {
    // Deux lectures d'horloge dateraient le meme geste sur deux valeurs, et
    // c'est `paid_at` que le client relira sur son ecran des passees.
    await cloturer();

    const paiement = txPaymentCreate.mock.calls[0]?.[0] as {
      data: { paidAt: Date };
    };
    const cloture = txInterventionUpdate.mock.calls[0]?.[0] as {
      data: { completedAt: Date };
    };

    expect(paiement.data.paidAt).toBe(cloture.data.completedAt);
  });

  it("construit le montant sur la CHAINE, jamais sur un flottant", async () => {
    // `85.10` n'a pas de representation binaire exacte : passe par un `number`,
    // il arrive parfois a `85.099999…`. C'est un montant qui sera encaisse.
    await cloturer({
      demande: { issue: "encaisse", montant: "85.10", methode: "CASH" },
    });

    const paiement = txPaymentCreate.mock.calls[0]?.[0] as {
      data: { amountSnapshot: Prisma.Decimal };
    };

    expect(paiement.data.amountSnapshot.toFixed(2)).toBe("85.10");
  });

  it("rend au client ce qu'il faut pour le 9e email, lu DANS la transaction", async () => {
    // Relire apres coup rouvrirait la course : entre le commit et la relecture,
    // le compte peut avoir ete pseudonymise par le droit a l'oubli.
    const resultat = await cloturer();

    expect(resultat).toEqual({
      ok: true,
      issue: "encaisse",
      client: { email: "julien@exemple.fr", firstname: "Julien" },
      appointmentAt: EN_COURS.appointmentAt,
      forfait: "Révision complète",
      montant: "97.90",
      methode: "CB",
    });
  });

  it("trace la transition et le paiement dans audit_logs", async () => {
    // ⚠️ Le champ s'appelle `details`, pas `metadata` : troisieme occurrence de
    // l'erreur dans la SPEC.
    await cloturer();

    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        entityType: "interventions",
        entityId: "847",
        action: "UPDATE",
        actorId: TECH,
        details: {
          statutAvant: "IN_PROGRESS",
          statutApres: "DONE",
          paiement: "PAID",
          montant: "97.90",
          methode: "CB",
        },
      },
    });
  });
});

describe("cloturerInterventionDuTech - branche de refus", () => {
  const REFUS = {
    demande: { issue: "refuse", motif: "Client absent au règlement" },
  };

  it("ecrit une ligne UNPAID a zero, sans mode ni instant", async () => {
    // 🔴 La validation croisee versant `UNPAID`, que le dictionnaire §payments
    // ecrit en toutes lettres : « UNPAID implique method=NULL + paid_at=NULL +
    // amount_snapshot=0 ». Les trois ensemble, jamais deux sur trois.
    await cloturer(REFUS);

    expect(txPaymentCreate).toHaveBeenCalledWith({
      data: {
        interventionId: 847,
        amountSnapshot: new Prisma.Decimal(0),
        method: null,
        status: "UNPAID",
        paidAt: null,
        recordedBy: TECH,
      },
    });
  });

  it("passe l'intervention a CANCELLED et PAS a DONE", async () => {
    // `US-PAIEMENT-ENREGISTRER` §Fallback. Le travail a eu lieu, mais le
    // dossier ne peut pas se clore sur un encaissement qui n'existe pas.
    await cloturer(REFUS);

    const args = txInterventionUpdate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };

    expect(args.data["status"]).toBe("CANCELLED");
  });

  it("laisse completed_at intact", async () => {
    // Une intervention annulee n'est pas une intervention completee. Le
    // dictionnaire donne la colonne « remplie par le tech a la cloture », la
    // branche `CANCELLED` ne la nomme jamais, et `annulerInterventionDuClient`
    // fait deja ainsi.
    await cloturer(REFUS);

    const args = txInterventionUpdate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };

    expect(args.data).not.toHaveProperty("completedAt");
  });

  it("ecrit le motif dans cancellation_reason", async () => {
    // Meme colonne que l'annulation client, et meme lecteur : l'ecran des
    // passees l'affiche deja. C'est ce qui dispense la branche d'un email
    // (arbitrage D10).
    await cloturer(REFUS);

    const args = txInterventionUpdate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };

    expect(args.data["cancellationReason"]).toBe("Client absent au règlement");
  });

  it("trace le refus avec son motif", async () => {
    await cloturer(REFUS);

    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: {
          statutAvant: "IN_PROGRESS",
          statutApres: "CANCELLED",
          paiement: "UNPAID",
          motif: "Client absent au règlement",
        },
      }),
    });
  });

  it("ne rend AUCUNE donnee de notification", async () => {
    // 🔴 La branche de refus n'envoie pas d'email (D10), et le contrat de
    // retour le rend impossible plutot que de compter sur la discipline de
    // l'appelant : il n'y a pas de destinataire a lui donner.
    const resultat = await cloturer(REFUS);

    expect(resultat).toEqual({ ok: true, issue: "refuse" });
  });
});

describe("cloturerInterventionDuTech - l'atomicite", () => {
  it("ne laisse aucune des deux ecritures si la seconde echoue", async () => {
    // 🔴 **La propriete que la revue humaine de la tache demande de regarder.**
    // SPEC §Amendements A4 pose le couple comme indissociable : la ligne de
    // paiement est ecrite AVANT la transition, donc c'est l'echec de la
    // transition qui doit emporter le paiement. Sans transaction commune, la
    // base garderait un encaissement sur une intervention encore en cours.
    txInterventionUpdate.mockRejectedValue(new Error("deconnexion"));

    await expect(cloturer()).rejects.toThrow("deconnexion");

    expect(rollbacks).toHaveLength(1);
    expect(commits).toHaveLength(0);
  });

  it("ne laisse aucune trace d'audit si la transition echoue", async () => {
    // Une trace ecrite hors transaction survivrait au rollback : `audit_logs`
    // est la piece qu'on produit en cas de contestation, elle daterait une
    // cloture qui n'a pas eu lieu.
    txInterventionUpdate.mockRejectedValue(new Error("deconnexion"));

    await expect(cloturer()).rejects.toThrow();

    expect(rollbacks).toHaveLength(1);
    expect(journal).not.toContain("audit.create");
  });

  it("emporte la transition si l'ecriture du paiement echoue", async () => {
    // L'autre sens du couple, et il se produit pour de vrai : l'unicite
    // d'`intervention_id` fait echouer une seconde insertion.
    txPaymentCreate.mockRejectedValue(
      new Error("duplicate key value violates unique constraint"),
    );

    await expect(cloturer()).rejects.toThrow();

    expect(rollbacks).toHaveLength(1);
    expect(journal).not.toContain("intervention.update");
  });

  it("commite les trois ecritures ensemble au succes", async () => {
    await cloturer();

    expect(commits).toHaveLength(1);
    expect(rollbacks).toHaveLength(0);
    expect(transaction).toHaveBeenCalledOnce();
    expect(journal).toEqual([
      "lecture",
      "verrou",
      "relecture",
      "payment.create",
      "intervention.update",
      "audit.create",
    ]);
  });
});

describe("cloturerInterventionDuTech - les gardes", () => {
  it("filtre sur le TECHNICIEN dans la clause where, pas apres coup", async () => {
    // 🔴 La garde de propriete est en base : elle ne peut donc pas etre
    // contournee par une branche oubliee.
    await cloturer();

    expect(txInterventionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 847, techId: TECH } }),
    );
  });

  it("rend « introuvable » sur l'intervention d'un collegue", async () => {
    // Inconnue et appartenant a un collegue ne se distinguent pas : une reponse
    // distincte confirmerait l'existence du rendez-vous d'un tiers a qui
    // incremente.
    txInterventionFindFirst.mockResolvedValue(null);

    await expect(cloturer()).resolves.toEqual({
      ok: false,
      reason: "introuvable",
    });
  });

  it("ne prend PAS le verrou avant d'avoir verifie la propriete", async () => {
    // 🔴 Un appelant qui incremente des identifiants ne doit pas pouvoir
    // verrouiller le rendez-vous d'un tiers, ne serait-ce que le temps d'une
    // transaction.
    txInterventionFindFirst.mockResolvedValue(null);

    await cloturer();

    expect(journal).toEqual(["lecture"]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it.each([["PLANNED"], ["DONE"], ["CANCELLED"]])(
    "refuse la cloture depuis %s, et n'ecrit rien",
    async (statut) => {
      // Constitution §2.4 : la cloture part d'`IN_PROGRESS` et de lui seul.
      // `PLANNED` n'a pas commence, `DONE` et `CANCELLED` sont terminaux.
      txInterventionFindFirst.mockResolvedValue({
        ...EN_COURS,
        status: statut,
      });

      await expect(cloturer()).resolves.toEqual({
        ok: false,
        reason: "transition_illegale",
        statutCourant: statut,
      });

      expect(txPaymentCreate).not.toHaveBeenCalled();
      expect(txInterventionUpdate).not.toHaveBeenCalled();
    },
  );

  it("ne cloture pas deux fois une intervention DONE", async () => {
    // DoD : « une intervention deja DONE ne se cloture pas deux fois ». C'est
    // la moitie applicative de l'irreversibilite ; l'autre est l'unicite
    // d'`intervention_id`, qui tient meme si celle-ci etait contournee.
    txInterventionFindFirst.mockResolvedValue({ ...EN_COURS, status: "DONE" });

    const resultat = await cloturer();

    expect(resultat).toEqual({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "DONE",
    });
  });

  it("refuse aussi quand le statut a change ENTRE la lecture et le verrou", async () => {
    // La relecture sous verrou est ce qui decide. La premiere lecture a servi
    // aux gardes ; entre les deux, une transaction voisine a pu commiter.
    txInterventionFindUniqueOrThrow.mockResolvedValue({ status: "DONE" });

    await expect(cloturer()).resolves.toEqual({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "DONE",
    });

    expect(txPaymentCreate).not.toHaveBeenCalled();
  });
});

describe("cloturerInterventionDuTech - la concurrence", () => {
  it("ne cloture qu'une fois quand deux appels courent ensemble", async () => {
    // 🔴 Deux clotures concurrentes passeraient toutes les deux la lecture de
    // statut sous READ COMMITTED. La seconde insertion echouerait sur l'unicite
    // d'`intervention_id` - remontee au technicien en erreur serveur opaque
    // plutot qu'en refus metier lisible - et sur la branche de refus, ou rien
    // n'echouerait, `audit_logs` daterait deux fois une cloture unique.
    //
    // Le verrou seul ne suffit pas : c'est la RELECTURE sous verrou qui refuse.
    // Elle rend `IN_PROGRESS` a la premiere transaction, `DONE` a la seconde,
    // qui n'entre donc dans aucune branche d'ecriture.
    let clotures = 0;
    txInterventionFindUniqueOrThrow.mockImplementation(() => {
      clotures += 1;
      return Promise.resolve({
        status: clotures === 1 ? "IN_PROGRESS" : "DONE",
      });
    });

    const [premier, second] = await Promise.all([cloturer(), cloturer()]);

    expect(premier).toMatchObject({ ok: true });
    expect(second).toEqual({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "DONE",
    });

    expect(txPaymentCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it("serialise pour de vrai : la seconde relit ce que la premiere a ecrit", async () => {
    // 🔴 Le test ci-dessus affirme
    // « c'est la RELECTURE sous verrou qui refuse », mais son double ne
    // l'observe pas : la relecture rend `DONE` au SECOND APPEL, quel que soit
    // l'ordre reel des transactions. Le verrou pouvait disparaitre du code sans
    // qu'il rougisse - c'est la prémisse fausse de [[double-de-test-premisse-fausse]],
    // transposee au verrouillage.
    //
    // Ici la relecture rend un ETAT PARTAGE, comme une ligne de la base : elle
    // ne bascule a `DONE` que parce qu'une transaction voisine a ecrit et
    // relache. Sans le `FOR UPDATE`, les deux relectures tombent avant la
    // premiere ecriture - c'est exactement le scenario READ COMMITTED que le
    // verrou existe pour fermer - et deux lignes `payments` partent.
    let statutEnBase = "IN_PROGRESS";

    txInterventionFindFirst.mockImplementation(() =>
      Promise.resolve({ ...EN_COURS, status: statutEnBase }),
    );
    txInterventionFindUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ status: statutEnBase }),
    );
    txInterventionUpdate.mockImplementation((args: unknown) => {
      statutEnBase = (args as { data: { status: string } }).data.status;
      return Promise.resolve({});
    });

    const [premier, second] = await Promise.all([cloturer(), cloturer()]);

    expect(premier).toMatchObject({ ok: true, issue: "encaisse" });
    expect(second).toEqual({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "DONE",
    });

    expect(txPaymentCreate).toHaveBeenCalledOnce();
    expect(txInterventionUpdate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it("serialise aussi deux REFUS concurrents", async () => {
    // La branche de refus est celle ou rien n'echouerait tout seul : aucune
    // contrainte d'unicite n'est violee par une seconde ligne `UNPAID` sur une
    // intervention deja `CANCELLED` - si, elle l'est, `intervention_id` etant
    // UNIQUE, mais l'erreur remonterait en panne serveur opaque plutot qu'en
    // refus metier. Et `audit_logs` daterait deux fois une cloture unique.
    let statutEnBase = "IN_PROGRESS";

    txInterventionFindFirst.mockImplementation(() =>
      Promise.resolve({ ...EN_COURS, status: statutEnBase }),
    );
    txInterventionFindUniqueOrThrow.mockImplementation(() =>
      Promise.resolve({ status: statutEnBase }),
    );
    txInterventionUpdate.mockImplementation((args: unknown) => {
      statutEnBase = (args as { data: { status: string } }).data.status;
      return Promise.resolve({});
    });

    const refus = { demande: { issue: "refuse", motif: "Client absent" } };
    const [premier, second] = await Promise.all([
      cloturer(refus),
      cloturer(refus),
    ]);

    expect(premier).toEqual({ ok: true, issue: "refuse" });
    expect(second).toEqual({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "CANCELLED",
    });

    expect(txPaymentCreate).toHaveBeenCalledOnce();
    expect(auditCreate).toHaveBeenCalledOnce();
  });
});
