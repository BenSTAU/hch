import "server-only";

import { sendEmail } from "./transport";

/// Notification d'annulation au technicien affecté.
///
/// ⚠️ **8e email du périmètre v1, absent de l'inventaire d'ADR-017** qui n'en
/// recense que sept. Il est pourtant un critère d'acceptation de
/// `US-INTERVENTION-ANNULER-CLIENT` §Cas nominal : *« une notification est
/// envoyée au technicien affecté (email / notif in-app) »*. La branche
/// « in-app » n'existe pas et ne peut pas exister en v1 - aucune table de
/// notifications au dictionnaire - donc l'email est la seule lecture tenable.
/// Écart signalé pour write-back.
///
/// Le destinataire est un salarié, pas un client : le gabarit dit ce qui change
/// dans sa tournée, et rien d'autre. Pas de nom de client, pas de montant -
/// c'est une information d'exploitation, et l'email transite par un tiers.

const SUJET = "Intervention annulée par le client";

/// Même formatage que l'email de confirmation, et pour le même motif : la base
/// est en UTC (PLAN S2 T5), un créneau annoncé dans le mauvais fuseau ferait se
/// déplacer un technicien deux heures trop tôt.
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

  return `${formateur.format(debut)} - ${heureFin}`;
}

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendAnnulationEmail(params: {
  to: string;
  prenom: string;
  debut: Date;
  dureeMinutes: number;
  adresse: string;
  forfait: string;
  motif: string;
}): Promise<void> {
  const creneau = formaterCreneau(params.debut, params.dureeMinutes);

  const lignesTexte = [
    `Bonjour ${params.prenom},`,
    "",
    "Le client a annulé l'intervention suivante :",
    "",
    `Prestation : ${params.forfait}`,
    `Créneau : ${creneau}`,
    `Adresse : ${params.adresse}`,
    `Motif : ${params.motif}`,
    "",
    "Le créneau est de nouveau disponible à la réservation.",
  ];

  const lignesHtml = [
    `<p>Bonjour ${echapper(params.prenom)},</p>`,
    "<p>Le client a annulé l'intervention suivante :</p>",
    "<ul>",
    `<li><strong>Prestation</strong> : ${echapper(params.forfait)}</li>`,
    `<li><strong>Créneau</strong> : ${echapper(creneau)}</li>`,
    `<li><strong>Adresse</strong> : ${echapper(params.adresse)}</li>`,
    `<li><strong>Motif</strong> : ${echapper(params.motif)}</li>`,
    "</ul>",
    "<p>Le créneau est de nouveau disponible à la réservation.</p>",
  ];

  await sendEmail({
    to: params.to,
    subject: SUJET,
    text: lignesTexte.join("\n"),
    html: lignesHtml.join("\n"),
  });
}
