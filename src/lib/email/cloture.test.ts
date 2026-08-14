// @vitest-environment node
//
// Notification de cloture au client.
//
// ⚠️ **9e email du perimetre v1, absent de l'inventaire d'ADR-017** qui n'en
// recensait que huit - troisieme fois qu'il en manque un exige par une US,
// apres la reservation le 09/08 et l'annulation le 11/08. Il est un critere
// d'acceptation de `US-INTERVENTION-MARQUER-FAITE` §Cas nominal et de
// `US-PAIEMENT-ENREGISTRER` §Cas nominal.
//
// Ce que ce fichier eprouve tient en trois points :
//
//   · **la date est annoncee dans le fuseau d'exploitation.** La base est en
//     UTC (PLAN S2 §T5) ; « 10:00 » pour un rendez-vous de midi ferait douter
//     le client de ce qu'il a recu ;
//   · **le montant est celui qui a ete encaisse**, a la chaine pres, parce que
//     c'est la piece que le client rapprochera de son relève bancaire ;
//   · **le HTML echappe**, y compris le libelle de forfait, qui vient du
//     catalogue admin et n'est pas une constante du code.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
vi.mock("./transport", () => ({ sendEmail }));

const { sendClotureEmail } = await import("./cloture");

const PARAMS = {
  to: "julien@exemple.fr",
  prenom: "Julien",
  // 08:00 UTC en aout = 10:00 a Paris.
  debut: new Date("2026-08-20T08:00:00.000Z"),
  forfait: "Revision complete",
  montant: "97.90",
  methode: "CB" as const,
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

describe("sendClotureEmail", () => {
  it("part au client, avec un sujet qui dit ce qui s'est passe", async () => {
    await sendClotureEmail(PARAMS);

    expect(envoye().to).toBe("julien@exemple.fr");
    expect(envoye().subject).toBe("Votre intervention est terminée");
  });

  it("annonce la date dans le fuseau de PARIS, pas en UTC", async () => {
    // 🔴 La propriete la plus couteuse a rater du gabarit.
    await sendClotureEmail(PARAMS);

    expect(envoye().text).toContain("10:00");
    expect(envoye().text).not.toContain("08:00");
  });

  it("porte le montant ENCAISSE et son mode", async () => {
    // DoD : « 9e email, avec le montant encaisse ». C'est le seul chiffre que
    // le geste vient de figer, et il peut differer du total de l'intervention -
    // Constitution §2.3 autorise le technicien a l'ajuster.
    await sendClotureEmail(PARAMS);

    expect(envoye().text).toContain("97.90 €");
    expect(envoye().text).toContain("Carte bancaire");
  });

  it.each([
    ["CB", "Carte bancaire"],
    ["CASH", "Espèces"],
    ["CHECK", "Chèque"],
  ] as const)("nomme le mode %s en clair", async (methode, libelle) => {
    // La valeur en base est un code (`CB | CASH | CHECK`), pas un libelle : un
    // client qui lirait « CHECK » ne saurait pas s'il s'agit d'un cheque ou
    // d'une verification.
    await sendClotureEmail({ ...PARAMS, methode });

    expect(envoye().text).toContain(libelle);
  });

  it("renvoie le client vers son espace plutot que de le laisser sans suite", async () => {
    await sendClotureEmail(PARAMS);

    expect(envoye().text).toContain("Passées");
  });

  it("echappe le HTML du libelle de forfait", async () => {
    // Il vient du catalogue, que l'administration edite : ce n'est pas une
    // constante du code, donc c'est une entree.
    await sendClotureEmail({
      ...PARAMS,
      forfait: '<script>alert("x")</script>',
    });

    expect(envoye().html).not.toContain("<script>");
    expect(envoye().html).toContain("&lt;script&gt;");
  });

  it("echappe aussi le prenom", async () => {
    // Il vient de l'inscription, donc du client lui-meme.
    await sendClotureEmail({ ...PARAMS, prenom: "<b>Julien</b>" });

    expect(envoye().html).not.toContain("<b>Julien</b>");
  });
});
