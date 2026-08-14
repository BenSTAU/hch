// @vitest-environment node
//
// La cloture - `US-INTERVENTION-MARQUER-FAITE` couplee a
// `US-PAIEMENT-ENREGISTRER`, ecran T4.
//
// Ce que ce fichier eprouve n'est PAS la transaction ni le verrou : les deux
// vivent dans le helper metier et y sont testes. C'est l'orchestration, plus la
// validation croisee que le schema porte :
//
//   · le TECHNICIEN vient de la session, jamais de la charge utile - une Server
//     Action exportee est un endpoint POST public (ADR-006 v2) ;
//   · les bornes du montant, sur les deux branches ;
//   · le 9e email part sur la branche nominale SEULE (D10) ;
//   · l'invalidation couvre les quatre ecrans que la cloture deplace.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

// ⚠️ **Le `digest` n'est pas decoratif, il EST le contrat.**
// `next-safe-action` reconnait `forbidden()` par `isHTTPAccessFallbackError`,
// qui lit `error.digest` et ignore le message. Un mock qui ne pose que le
// message serait avale par `handleServerError` et rendu en « Une erreur est
// survenue » : le test passerait en prouvant l'inverse de ce qui se produit en
// execution reelle. Meme harnais que `demarrer-intervention.test.ts`.
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

const cloturerInterventionDuTech = vi.fn();
vi.mock("@/lib/db/queries/paiements", () => ({
  cloturerInterventionDuTech: (args: unknown) =>
    cloturerInterventionDuTech(args),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => revalidatePath(chemin),
}));

// `dispatchEmail` est double par un passe-plat SYNCHRONE : `after()` de Next
// n'a pas de contexte de requete ici, et ce qu'on veut observer est l'appel du
// gabarit, pas le report.
const sendClotureEmail = vi.fn();
vi.mock("@/lib/email/cloture", () => ({
  sendClotureEmail: (args: unknown) => sendClotureEmail(args),
}));

const dispatchEmail = vi.fn((_libelle: string, envoyer: () => Promise<void>) =>
  envoyer(),
);
vi.mock("@/lib/email/dispatch", () => ({
  dispatchEmail: (libelle: string, envoyer: () => Promise<void>) =>
    dispatchEmail(libelle, envoyer),
}));

const { cloturerIntervention } = await import("./cloturer-intervention");

const TECH = "22222222-2222-4222-8222-222222222222";
const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";
const DEBUT = new Date("2026-08-20T08:00:00.000Z");

const TECHNICIEN = {
  id: TECH,
  email: "tech@homecyclhome.fr",
  firstname: "Marc",
  lastname: "Lefevre",
  roles: ["ROLE_TECH"],
};

const ENCAISSE = {
  ok: true,
  issue: "encaisse",
  client: { email: "julien@exemple.fr", firstname: "Julien" },
  appointmentAt: DEBUT,
  forfait: "Révision complète",
  montant: "97.90",
  methode: "CB",
};

/// Une demande nominale valide, a surcharger champ par champ.
const DEMANDE = {
  issue: "encaisse" as const,
  interventionId: 847,
  montant: "97.90",
  methode: "CB" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue(TECHNICIEN);
  cloturerInterventionDuTech.mockResolvedValue(ENCAISSE);
});

describe("cloturerIntervention - le cloisonnement", () => {
  it("passe le technicien de la SESSION, jamais un identifiant recu", async () => {
    // 🔴 La propriete de securite de l'action. Un `techId` accepte en charge
    // utile encaisserait au nom d'autrui : le schema n'en porte pas, et le
    // contexte fournit le seul qui compte.
    await cloturerIntervention(DEMANDE);

    expect(cloturerInterventionDuTech).toHaveBeenCalledWith(
      expect.objectContaining({ interventionId: 847, techId: TECH }),
    );
  });

  it("refuse un client authentifie, et n'ecrit jamais en base", async () => {
    // 🔴 Le coeur de la garde. `src/proxy.ts` laisse deliberement passer les
    // requetes portant `Next-Action` : sans cette ligne, un client authentifie
    // qui poste ici clotureraient l'intervention de quelqu'un d'autre - et
    // ecrirait une ligne de paiement irreversible.
    getCurrentUser.mockResolvedValue({
      ...TECHNICIEN,
      id: CLIENT,
      roles: ["ROLE_CLIENT"],
    });

    await expect(cloturerIntervention(DEMANDE)).rejects.toThrow();

    expect(forbidden).toHaveBeenCalledOnce();
    // La garde est en MIDDLEWARE, donc avant la validation Zod comme avant le
    // corps : la transaction ne part pas.
    expect(cloturerInterventionDuTech).not.toHaveBeenCalled();
  });

  it("refuse un administrateur sans ROLE_TECH", async () => {
    // Constitution §3.1 : l'administration ne clot pas les interventions du
    // terrain. C'est une autre US, et elle est v2.
    getCurrentUser.mockResolvedValue({ ...TECHNICIEN, roles: ["ROLE_ADMIN"] });

    await expect(cloturerIntervention(DEMANDE)).rejects.toThrow();

    expect(cloturerInterventionDuTech).not.toHaveBeenCalled();
  });

  it("date l'encaissement cote SERVEUR", async () => {
    // 🔴 DoD : `paid_at` est affiche, pas saisissable. Le schema ne porte aucun
    // instant ; une horloge recue du client ouvrirait l'antidatage d'un
    // encaissement, qu'aucune US ne demande.
    await cloturerIntervention(DEMANDE);

    const args = cloturerInterventionDuTech.mock.calls[0]?.[0] as {
      maintenant: Date;
      demande: Record<string, unknown>;
    };

    expect(args.maintenant).toBeInstanceOf(Date);
    expect(args.demande).not.toHaveProperty("paidAt");
  });
});

describe("cloturerIntervention - les bornes du montant", () => {
  // ⚠️ Ces bornes ne sont PAS le garde-fou F1, qui reste v2 et porte sur
  // l'ecart au `price_snapshot` (la hausse abusive, tension §2.3 contre §3.1).
  // Ici c'est de l'integrite de type, et Zod en exige une de toute facon.

  it("refuse un encaissement a zero, et nomme la branche prevue", async () => {
    // 🔴 Un `PAID` a 0 serait un `UNPAID` sous une etiquette fausse : le refus
    // de paiement existe, il passe l'intervention en `CANCELLED` et le dossier
    // ne raconte pas la meme histoire.
    const resultat = await cloturerIntervention({ ...DEMANDE, montant: "0" });

    expect(resultat?.validationErrors).toBeDefined();
    expect(cloturerInterventionDuTech).not.toHaveBeenCalled();
  });

  it.each([["0.00"], ["0,00"]])("refuse aussi %s", async (montant) => {
    const resultat = await cloturerIntervention({ ...DEMANDE, montant });

    expect(resultat?.validationErrors).toBeDefined();
  });

  it("refuse un depassement de DECIMAL(10,2)", async () => {
    // Au-dela, la base rejette l'ecriture avec une erreur de depassement
    // numerique que rien ne traduirait en message lisible.
    const resultat = await cloturerIntervention({
      ...DEMANDE,
      montant: "100000000",
    });

    expect(resultat?.validationErrors).toBeDefined();
    expect(cloturerInterventionDuTech).not.toHaveBeenCalled();
  });

  it.each([["12.345"], ["abc"], ["12 €"], [""], ["-5"], ["1e3"]])(
    "refuse la saisie %s",
    async (montant) => {
      const resultat = await cloturerIntervention({ ...DEMANDE, montant });

      expect(resultat?.validationErrors).toBeDefined();
      expect(cloturerInterventionDuTech).not.toHaveBeenCalled();
    },
  );

  it("accepte la virgule et la normalise en point", async () => {
    // Un clavier mobile francais propose la virgule en premier. Refuser la
    // saisie pour un separateur est une mauvaise reponse a quelqu'un debout
    // dans une cour d'immeuble.
    await cloturerIntervention({ ...DEMANDE, montant: "97,90" });

    expect(cloturerInterventionDuTech).toHaveBeenCalledWith(
      expect.objectContaining({
        demande: { issue: "encaisse", montant: "97.90", methode: "CB" },
      }),
    );
  });

  it("refuse un mode de paiement hors des trois de la Constitution §2.3", async () => {
    const resultat = await cloturerIntervention({
      ...DEMANDE,
      // Une valeur qu'aucun CHECK SQL n'accepterait non plus.
      methode: "PAYPAL" as never,
    });

    expect(resultat?.validationErrors).toBeDefined();
    expect(cloturerInterventionDuTech).not.toHaveBeenCalled();
  });

  it("ecarte un identifiant qui n'est pas un entier positif", async () => {
    const resultat = await cloturerIntervention({
      ...DEMANDE,
      interventionId: -3,
    });

    expect(resultat?.validationErrors).toBeDefined();
    expect(cloturerInterventionDuTech).not.toHaveBeenCalled();
  });
});

describe("cloturerIntervention - la branche de refus", () => {
  const REFUS = {
    issue: "refuse" as const,
    interventionId: 847,
    motif: "Client absent au règlement",
  };

  beforeEach(() => {
    cloturerInterventionDuTech.mockResolvedValue({ ok: true, issue: "refuse" });
  });

  it("transmet le motif et RIEN d'autre", async () => {
    // 🔴 L'union discriminee interdit l'etat « refus avec un montant » a la
    // compilation ; ce test verifie qu'elle n'en laisse pas passer un a
    // l'execution non plus, par une charge utile forgee.
    await cloturerIntervention({
      ...REFUS,
      montant: "999.00",
      methode: "CB",
    } as never);

    expect(cloturerInterventionDuTech).toHaveBeenCalledWith(
      expect.objectContaining({
        demande: { issue: "refuse", motif: "Client absent au règlement" },
      }),
    );
  });

  it("exige un motif non vide", async () => {
    // `US-PAIEMENT-ENREGISTRER` §Fallback : « un motif obligatoire est saisi ».
    const resultat = await cloturerIntervention({ ...REFUS, motif: "" });

    expect(resultat?.validationErrors).toBeDefined();
    expect(cloturerInterventionDuTech).not.toHaveBeenCalled();
  });

  it("refuse une suite d'espaces, que le trim reduit a rien", async () => {
    // `trim` AVANT `min` : sans lui, trois espaces satisfont la longueur et
    // s'ecrivent en base comme un motif vide.
    const resultat = await cloturerIntervention({ ...REFUS, motif: "   " });

    expect(resultat?.validationErrors).toBeDefined();
  });

  it("distingue « requis » de « trop court »", async () => {
    // Dire « requis » a qui vient d'ecrire quelque chose est une reponse
    // fausse. Lecon de l'agent testeur sur l'annulation client.
    const vide = await cloturerIntervention({ ...REFUS, motif: "" });
    const court = await cloturerIntervention({ ...REFUS, motif: "no" });

    expect(JSON.stringify(vide?.validationErrors)).toContain("requis");
    expect(JSON.stringify(court?.validationErrors)).toContain("trop court");
  });

  it("refuse un motif au-dela du plafond partage avec l'annulation", async () => {
    // Meme colonne `cancellation_reason`, donc meme borne : deux plafonds sur
    // une colonne finiraient par diverger, et c'est le plus permissif qui
    // deciderait.
    const resultat = await cloturerIntervention({
      ...REFUS,
      motif: "x".repeat(501),
    });

    expect(resultat?.validationErrors).toBeDefined();
  });

  it("n'envoie AUCUN email", async () => {
    // 🔴 Arbitrage D10 : le motif saisi est deja affiche au client sur son
    // ecran des passees, et le corps d'un courrier de non-paiement n'est ecrit
    // nulle part. Meme regime que le refus de l'email de suppression de compte
    // en T-V3-12.
    await cloturerIntervention(REFUS);

    expect(dispatchEmail).not.toHaveBeenCalled();
    expect(sendClotureEmail).not.toHaveBeenCalled();
  });
});

describe("cloturerIntervention - le 9e email", () => {
  it("part sur la branche nominale, avec le montant encaisse", async () => {
    await cloturerIntervention(DEMANDE);

    expect(sendClotureEmail).toHaveBeenCalledWith({
      to: "julien@exemple.fr",
      prenom: "Julien",
      debut: DEBUT,
      forfait: "Révision complète",
      montant: "97.90",
      methode: "CB",
    });
  });

  it("part HORS du chemin de reponse", async () => {
    // La cloture est acquise en base : le technicien n'a pas a attendre un
    // aller-retour SMTP pour le savoir, et un echec d'envoi ne doit pas
    // transformer une cloture reussie en erreur.
    await cloturerIntervention(DEMANDE);

    expect(dispatchEmail).toHaveBeenCalledWith(
      "cloture intervention",
      expect.any(Function),
    );
  });

  it("ne part pas quand la cloture est refusee", async () => {
    cloturerInterventionDuTech.mockResolvedValue({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "DONE",
    });

    await cloturerIntervention(DEMANDE);

    expect(sendClotureEmail).not.toHaveBeenCalled();
  });
});

describe("cloturerIntervention - l'invalidation", () => {
  it("invalide les quatre ecrans que la cloture deplace", async () => {
    // La ligne quitte la tournee du jour pour l'historique technicien, et
    // l'onglet « A venir » du client pour ses « Passees ».
    await cloturerIntervention(DEMANDE);

    expect(revalidatePath).toHaveBeenCalledWith("/interventions/847");
    expect(revalidatePath).toHaveBeenCalledWith("/interventions/du-jour");
    expect(revalidatePath).toHaveBeenCalledWith("/interventions/passees");
    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/a-venir");
    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/passees");
  });

  it("invalide le detail et la tournee AUSSI quand la cloture est refusee", async () => {
    // 🐛 La lecon de la PR #33, transposee : les deux refus disent que la vue
    // de l'appelant est PERIMEE. Sans invalidation, l'ecran garde son bouton et
    // le technicien reessaie contre un etat faux.
    cloturerInterventionDuTech.mockResolvedValue({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "DONE",
    });

    await cloturerIntervention(DEMANDE);

    expect(revalidatePath).toHaveBeenCalledWith("/interventions/847");
    expect(revalidatePath).toHaveBeenCalledWith("/interventions/du-jour");
  });

  it("n'invalide PAS les ecrans du client sur un refus", async () => {
    // Rien n'a bouge chez lui : sa liste est exacte, et la revalider ferait
    // recalculer deux pages a chaque clic condamne.
    cloturerInterventionDuTech.mockResolvedValue({
      ok: false,
      reason: "introuvable",
    });

    await cloturerIntervention(DEMANDE);

    expect(revalidatePath).not.toHaveBeenCalledWith(
      "/mes-interventions/passees",
    );
  });
});

describe("cloturerIntervention - ce qu'elle rend", () => {
  it("rend l'issue au succes, sans rien de la ligne", async () => {
    const resultat = await cloturerIntervention(DEMANDE);

    expect(resultat?.data).toEqual({ ok: true, issue: "encaisse" });
  });

  it("nomme le statut courant quand l'intervention n'est pas demarree", async () => {
    // Les trois situations ne se corrigent pas de la meme facon : une
    // `PLANNED` se demarre, une `DONE` ou une `CANCELLED` ne se reprend pas.
    cloturerInterventionDuTech.mockResolvedValue({
      ok: false,
      reason: "transition_illegale",
      statutCourant: "PLANNED",
    });

    const resultat = await cloturerIntervention(DEMANDE);

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Cette intervention n'a pas encore été démarrée.",
    });
  });

  it.each([["DONE"], ["CANCELLED"]])(
    "distingue le statut terminal %s du pas-encore-demarre",
    async (statut) => {
      cloturerInterventionDuTech.mockResolvedValue({
        ok: false,
        reason: "transition_illegale",
        statutCourant: statut,
      });

      const resultat = await cloturerIntervention(DEMANDE);

      expect(resultat?.data).toEqual({
        ok: false,
        message: "Cette intervention est déjà clôturée ou annulée.",
      });
    },
  );

  it("rend le meme libelle pour l'inconnue et celle d'un collegue", async () => {
    cloturerInterventionDuTech.mockResolvedValue({
      ok: false,
      reason: "introuvable",
    });

    const resultat = await cloturerIntervention(DEMANDE);

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Intervention introuvable.",
    });
  });
});
