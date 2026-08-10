import "server-only";

import { sendEmail } from "./transport";

/// Email de confirmation de réservation.
///
/// Il n'est pas décoratif : la Constitution §1.2 fait de lui la **fin du
/// parcours** — « le parcours client se termine par une confirmation
/// email/notification automatique ». C'est ce qui remplace le rappel humain
/// qu'une marketplace transactionnelle s'interdit.
///
/// **7e email du périmètre v1** — ADR-017 n'en comptait que six, corrigé au
/// vault le 2026-08-09.
///
/// Le gabarit est celui qu'a fixé le vault : forfait, date et heure, adresse,
/// total figé. **Aucun lien de consultation sans compte** : la réservation
/// exige désormais un compte, le destinataire a le sien.

const SUJET = "Votre intervention HomeCycl'Home est confirmée";

/// Format lisible par un humain, dans le fuseau d'exploitation. La base est en
/// UTC (PLAN S2 T5) ; un email qui annoncerait « 06:00 » pour un rendez-vous de
/// 08 h serait la faute la plus coûteuse de tout le parcours.
function formaterCreneau(debut: Date, dureeMinutes: number): string {
  const formateur = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "full",
    timeStyle: "short",
  });

  const fin = new Date(debut.getTime() + dureeMinutes * 60_000);
  const heureFin = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    timeStyle: "short",
  }).format(fin);

  return `${formateur.format(debut)} — ${heureFin}`;
}

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendReservationEmail(params: {
  to: string;
  interventionId: number;
  debut: Date;
  dureeMinutes: number;
  prix: string;
  adresse: string;
  forfait: string;
}): Promise<void> {
  const creneau = formaterCreneau(params.debut, params.dureeMinutes);

  const lignesTexte = [
    "Bonjour,",
    "",
    "Votre intervention est planifiée.",
    "",
    `Prestation : ${params.forfait}`,
    `Créneau : ${creneau}`,
    `Adresse : ${params.adresse}`,
    `Montant : ${params.prix} € TTC`,
    "",
    // Constitution §2.3 : aucun paiement en ligne, jamais. L'écrire ici évite
    // qu'un client attende un lien de règlement qui n'existera pas.
    "Le règlement se fait auprès du technicien, sur place, à la fin de",
    "l'intervention.",
  ];

  const lignesHtml = [
    "<p>Bonjour,</p>",
    "<p>Votre intervention est planifiée.</p>",
    "<ul>",
    `<li><strong>Prestation</strong> : ${echapper(params.forfait)}</li>`,
    `<li><strong>Créneau</strong> : ${echapper(creneau)}</li>`,
    `<li><strong>Adresse</strong> : ${echapper(params.adresse)}</li>`,
    `<li><strong>Montant</strong> : ${echapper(params.prix)} € TTC</li>`,
    "</ul>",
    "<p>Le règlement se fait auprès du technicien, sur place, à la fin de l'intervention.</p>",
  ];

  await sendEmail({
    to: params.to,
    subject: SUJET,
    text: lignesTexte.join("\n"),
    html: lignesHtml.join("\n"),
  });
}
