// @vitest-environment node
//
// L'annulation client - `US-INTERVENTION-ANNULER-CLIENT`, golden path GP-03.
//
// Ce que ce fichier eprouve n'est PAS la fenetre H-24 ni les gardes : elles
// vivent dans le helper metier et y sont testees. C'est l'orchestration, et
// elle porte trois proprietes qu'aucune autre surface ne couvre :
//
//   · le proprietaire vient de la SESSION, jamais de la charge utile ;
//   · les DEUX onglets sont invalides, la ligne changeant de liste ;
//   · le technicien est prevenu HORS du chemin de reponse, et un envoi
//     impossible ne transforme pas une annulation reussie en erreur.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  getCurrentUser: () => getCurrentUser(),
}));

const annulerInterventionDuClient = vi.fn();
vi.mock("@/lib/db/queries/interventions", () => ({
  annulerInterventionDuClient: (args: unknown) =>
    annulerInterventionDuClient(args),
}));

const sendAnnulationEmail = vi.fn();
vi.mock("@/lib/email/annulation", () => ({
  sendAnnulationEmail: (args: unknown) => sendAnnulationEmail(args),
}));

// `dispatchEmail` s'appuie sur `after()` de Next, indisponible hors requete. Le
// double execute le rappel immediatement : ce qui est verifie ici est QUE
// l'envoi est demande et avec quoi, pas le moment ou Next le deroule.
const dispatchEmail = vi.fn((_libelle: string, envoyer: () => Promise<void>) =>
  envoyer(),
);
vi.mock("@/lib/email/dispatch", () => ({
  dispatchEmail: (libelle: string, envoyer: () => Promise<void>) =>
    dispatchEmail(libelle, envoyer),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (chemin: string) => revalidatePath(chemin),
}));

const { annulerIntervention } = await import("./annuler-intervention");

const CLIENT = "3f1e0a5c-0b2d-4c6e-9a11-2b3c4d5e6f70";
const RDV = new Date("2026-08-20T08:00:00.000Z");

const REUSSITE = {
  ok: true,
  technicien: { email: "tech@exemple.fr", firstname: "Marc" },
  appointmentAt: RDV,
  durationSnapshot: 60,
  forfait: "Revision complete",
  adresse: "12 rue de la Republique, 69002 Lyon",
  motif: "Empechement",
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: CLIENT, email: "client@exemple.fr" });
  annulerInterventionDuClient.mockResolvedValue(REUSSITE);
  sendAnnulationEmail.mockResolvedValue(undefined);
});

describe("annulerIntervention", () => {
  it("prend le proprietaire dans la SESSION, jamais dans la charge utile", async () => {
    // Rappel d'ADR-006 v2 : cette action est un endpoint POST public. Un
    // `clientId` accepte depuis l'appel permettrait d'annuler le rendez-vous
    // d'un tiers en une requete.
    await annulerIntervention({ interventionId: 847, motif: "Empechement" });

    expect(annulerInterventionDuClient).toHaveBeenCalledWith(
      expect.objectContaining({
        interventionId: 847,
        motif: "Empechement",
        clientId: CLIENT,
      }),
    );
  });

  it("passe a la transaction un instant pris ICI, entre l'appel et le retour", async () => {
    // Les gardes en dependent : le lire deux fois les ferait decider sur deux
    // valeurs differentes, et la borne H-24 est justement l'endroit ou l'ecart
    // se voit.
    //
    // ⚠️ Le titre promettait « une seule fois » pour une assertion qui ne
    // regardait que le TYPE - releve par l'agent testeur. Encadrer l'appel est
    // ce qui distingue reellement un instant pris ici d'une valeur heritee
    // d'ailleurs, et il n'existe pas d'autre observable : la fonction ne rend
    // pas son horloge.
    const avant = Date.now();
    await annulerIntervention({ interventionId: 847, motif: "Empechement" });
    const apres = Date.now();

    const appel = annulerInterventionDuClient.mock.calls[0]?.[0] as {
      maintenant: Date;
    };
    expect(appel.maintenant.getTime()).toBeGreaterThanOrEqual(avant);
    expect(appel.maintenant.getTime()).toBeLessThanOrEqual(apres);
  });

  it("invalide LES DEUX onglets, la ligne changeant de liste", async () => {
    // Elle quitte « A venir » pour « Passees » au meme instant. Sans la seconde
    // invalidation, l'historique afficherait une liste ou elle manque.
    await annulerIntervention({ interventionId: 847, motif: "Empechement" });

    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/a-venir");
    expect(revalidatePath).toHaveBeenCalledWith("/mes-interventions/passees");
  });

  it("previent le technicien affecte avec le creneau libere et le motif", async () => {
    // Critere d'acceptation de l'US §Cas nominal. La branche « notif in-app »
    // qu'elle propose en alternative n'existe pas et ne peut pas exister en v1 :
    // aucune table de notifications au dictionnaire.
    await annulerIntervention({ interventionId: 847, motif: "Empechement" });

    expect(sendAnnulationEmail).toHaveBeenCalledWith({
      to: "tech@exemple.fr",
      prenom: "Marc",
      debut: RDV,
      dureeMinutes: 60,
      adresse: "12 rue de la Republique, 69002 Lyon",
      forfait: "Revision complete",
      motif: "Empechement",
    });
  });

  it("envoie HORS du chemin de reponse", async () => {
    // Un aller-retour SMTP dans le corps de l'action ferait attendre le client
    // pour une information qui ne le concerne pas, et un echec d'envoi
    // transformerait une annulation acquise en base en erreur a l'ecran.
    await annulerIntervention({ interventionId: 847, motif: "Empechement" });

    expect(dispatchEmail).toHaveBeenCalledTimes(1);
  });

  it("n'envoie rien quand la transaction refuse, mais rafraichit la vue perimee", async () => {
    // ⚠️ **Regle du test rouge, cas 3** - oracle corrige apres le constat de
    // l'agent testeur, qui a releve le defaut que cet oracle GARDAIT.
    //
    // Il assertait `revalidatePath` jamais appelee sur un refus. La propriete
    // qu'il voulait tenir est « rien n'a ete ecrit, personne n'a ete prevenu »,
    // et elle reste affirmee ci-dessous. Mais l'absence d'invalidation n'en
    // faisait pas partie : `non_annulable` signifie precisement que le statut a
    // change SOUS l'appelant - le technicien vient de demarrer l'intervention -
    // et sa liste affiche encore « Planifiee » avec son bouton. Le test
    // protegeait un ecran perime.
    annulerInterventionDuClient.mockResolvedValue({
      ok: false,
      reason: "non_annulable",
    });

    const resultat = await annulerIntervention({
      interventionId: 847,
      motif: "Empechement",
    });

    expect(resultat?.data).toEqual({
      ok: false,
      message: "Cette intervention n'est plus annulable.",
      fenetreDepassee: false,
    });
    expect(dispatchEmail).not.toHaveBeenCalled();
    // La vue de l'appelant est fausse : elle se rafraichit. L'onglet des
    // passees, lui, n'a pas bouge - rien n'y est entre.
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/mes-interventions/a-venir",
    );
  });

  it("signale la fenetre depassee a l'ecran, qui bascule sur le contact", async () => {
    // C'est le seul refus qui change l'ETAT de l'ecran plutot que d'y afficher
    // une alerte : l'onglet croyait la fenetre ouverte, elle s'est refermee.
    annulerInterventionDuClient.mockResolvedValue({
      ok: false,
      reason: "fenetre_depassee",
    });

    const resultat = await annulerIntervention({
      interventionId: 847,
      motif: "Empechement",
    });

    expect(resultat?.data).toMatchObject({
      ok: false,
      fenetreDepassee: true,
      message: expect.stringMatching(/24 h/) as unknown as string,
    });
  });

  it("ne distingue pas l'introuvable de l'intervention d'un tiers", async () => {
    annulerInterventionDuClient.mockResolvedValue({
      ok: false,
      reason: "introuvable",
    });

    const resultat = await annulerIntervention({
      interventionId: 999_999,
      motif: "Empechement",
    });

    expect(resultat?.data).toMatchObject({
      ok: false,
      message: "Intervention introuvable.",
    });
  });

  it("refuse l'appelant sans session AVANT toute lecture du schema", async () => {
    // ⚠️ Ajout de l'agent testeur, 2026-08-11.
    //
    // Rien n'eprouvait la garde d'authentification de cette action : le double
    // de `getCurrentUser` rendait toujours un utilisateur. Or c'est le seul
    // rempart - `src/proxy.ts` ne fait qu'un redirect optimiste sur la presence
    // d'un cookie, et une Server Action exportee reste joignable depuis
    // n'importe ou (ADR-006 v2).
    //
    // La charge utile est volontairement invalide : ce que le test affirme est
    // l'ORDRE promis par `safe-action.ts` - middleware, PUIS validation Zod,
    // PUIS corps. Un anonyme ne doit pas pouvoir cartographier le schema en
    // lisant les messages de refus.
    getCurrentUser.mockRejectedValue(new Error("NEXT_REDIRECT"));

    const resultat = await annulerIntervention({
      interventionId: -1,
      motif: "",
    });

    expect(resultat?.validationErrors).toBeUndefined();
    expect(annulerInterventionDuClient).not.toHaveBeenCalled();
    expect(dispatchEmail).not.toHaveBeenCalled();
  });

  it("refuse un motif vide AVANT d'atteindre la transaction", async () => {
    const resultat = await annulerIntervention({
      interventionId: 847,
      motif: "  ",
    });

    expect(resultat?.validationErrors).toBeDefined();
    expect(annulerInterventionDuClient).not.toHaveBeenCalled();
  });
});
