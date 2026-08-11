// @vitest-environment node
//
// Notification d'annulation au technicien affecte.
//
// ⚠️ **8e email du perimetre v1, absent de l'inventaire d'ADR-017** qui n'en
// recense que sept. Il est pourtant un critere d'acceptation de
// `US-INTERVENTION-ANNULER-CLIENT` §Cas nominal, et sa branche alternative
// (« notif in-app ») ne peut pas exister en v1 : aucune table de notifications
// au dictionnaire.
//
// Ce que ce fichier eprouve tient en deux points, et le premier est le plus
// couteux a rater : **le creneau est annonce dans le fuseau d'exploitation**.
// La base est en UTC (PLAN S2 T5) ; un email qui dirait « 10:00 » pour un
// rendez-vous de midi ferait se deplacer un technicien deux heures trop tot.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("./transport", () => ({ sendEmail }));

const { sendAnnulationEmail } = await import("./annulation");

const PARAMS = {
  to: "tech@exemple.fr",
  prenom: "Marc",
  // 08:00 UTC en aout = 10:00 a Paris.
  debut: new Date("2026-08-20T08:00:00.000Z"),
  dureeMinutes: 60,
  adresse: "12 rue de la Republique, 69002 Lyon",
  forfait: "Revision complete",
  motif: "Empechement",
};

function envoye(): { subject: string; text: string; html: string; to: string } {
  return sendEmail.mock.calls[0]?.[0] as {
    subject: string;
    text: string;
    html: string;
    to: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue(undefined);
});

describe("sendAnnulationEmail", () => {
  it("annonce le creneau dans le fuseau d'exploitation, pas en UTC", async () => {
    await sendAnnulationEmail(PARAMS);

    expect(envoye().text).toContain("10:00");
    expect(envoye().text).toContain("11:00");
  });

  it("porte le forfait, l'adresse et le motif", async () => {
    await sendAnnulationEmail(PARAMS);

    const { text } = envoye();
    expect(text).toContain("Revision complete");
    expect(text).toContain("12 rue de la Republique, 69002 Lyon");
    expect(text).toContain("Empechement");
  });

  it("dit au technicien que le creneau est libere", async () => {
    // C'est la seule information qui change sa tournee : le rendez-vous
    // disparait de son planning, et le creneau redevient reservable par un
    // tiers (contrainte `no_double_booking`, filtree sur le statut).
    await sendAnnulationEmail(PARAMS);

    expect(envoye().text).toMatch(/de nouveau disponible/);
  });

  it("ne divulgue aucun montant", async () => {
    // Le destinataire est un salarie, et l'email transite par un tiers. Il dit
    // ce qui change dans la tournee, rien d'autre : Constitution §4.2 pose la
    // minimisation, et le montant n'aide en rien a se reorganiser.
    //
    // ⚠️ Le titre disait aussi « ni le nom du client » - releve par l'agent
    // testeur : le nom n'est meme pas un parametre de cette fonction, donc
    // cette moitie ne mesurait rien. Ce qui la GARANTIT est la signature, et
    // c'est la ligne ci-dessous qui l'affirme.
    await sendAnnulationEmail(PARAMS);

    const { text, html } = envoye();
    expect(text).not.toMatch(/€/);
    expect(html).not.toMatch(/€/);
    // Aucun champ d'identite ne traverse : ajouter un `client` a la signature
    // ferait echouer ce test, et c'est le but.
    expect(Object.keys(PARAMS).sort()).toEqual([
      "adresse",
      "debut",
      "dureeMinutes",
      "forfait",
      "motif",
      "prenom",
      "to",
    ]);
  });

  it("echappe le motif, qui vient d'une saisie libre", async () => {
    // Le motif est le seul champ de cet email qu'un utilisateur redige, et il
    // atterrit dans du HTML.
    await sendAnnulationEmail({
      ...PARAMS,
      motif: '<script>alert("x")</script>',
    });

    expect(envoye().html).not.toContain("<script>");
    expect(envoye().html).toContain("&lt;script&gt;");
  });

  it("adresse le message au technicien affecte", async () => {
    await sendAnnulationEmail(PARAMS);

    expect(envoye().to).toBe("tech@exemple.fr");
    expect(envoye().subject).toMatch(/annul/i);
  });
});
