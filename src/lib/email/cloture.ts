import "server-only";

import {
  LIBELLE_METHODE,
  type MethodePaiement,
} from "@/lib/paiements/encaissement";

import { sendEmail } from "./transport";

/// Notification de clôture au client - `US-INTERVENTION-MARQUER-FAITE` §Cas
/// nominal (*« une notification est envoyée au client »*) et
/// `US-PAIEMENT-ENREGISTRER` §Cas nominal, qui le redit.
///
/// ⚠️ **9e email du périmètre v1**, absent de l'inventaire d'ADR-017 qui n'en
/// recensait que huit - **troisième fois** qu'il en manque un exigé par une US,
/// après la réservation le 09/08 et l'annulation le 11/08. Le motif est nommé au
/// cadrage du plancher V2 : l'inventaire a été bâti en balayant les US **déjà
/// rédigées en tâches**, donc il rate par construction celles des vagues non
/// ouvertes. V1 admin n'est toujours pas rédigée. ADR-017 amendé (D10).
///
/// La branche « in-app » que les deux US proposent en alternative n'existe pas
/// et ne peut pas exister en v1 : aucune table de notifications au dictionnaire.
/// L'email est la seule lecture tenable, comme pour les huit autres.
///
/// ── Rien sur la branche de refus, et c'est un arbitrage
///
/// Un refus de paiement passe l'intervention en `CANCELLED` avec son motif, que
/// l'écran des passées **affiche déjà** au client. Le corps d'un courrier de
/// non-paiement n'est écrit nulle part, et l'inventer serait rédiger de la mise
/// en demeure. Même régime que le refus argumenté de l'email de suppression de
/// compte en T-V3-12. Arbitré le 2026-08-12 (D10).
///
/// Le destinataire est un client, pas un salarié : le gabarit dit ce qu'il a
/// reçu et ce qu'il a payé, et rien de l'exploitation.

const SUJET = "Votre intervention est terminée";

/// Même formatage que les emails de réservation et d'annulation, et pour le
/// même motif : la base est en UTC (PLAN S2 §T5), une date annoncée dans le
/// mauvais fuseau se lit à deux heures près.
function formaterDate(instant: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "full",
    timeStyle: "short",
  }).format(instant);
}

function echapper(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendClotureEmail(params: {
  to: string;
  prenom: string;
  debut: Date;
  forfait: string;
  /// Chaîne à deux décimales, telle qu'écrite dans `payments.amount_snapshot`.
  /// Jamais un `number` : le montant traverse en chaîne de bout en bout.
  montant: string;
  methode: MethodePaiement;
}): Promise<void> {
  const date = formaterDate(params.debut);
  // Le montant est écrit tel qu'il a été encaissé, sans reformatage en locale
  // française : `payments.amount_snapshot` fait foi, et un « 25,00 » affiché
  // face à un « 25.00 » en base ferait douter au moment où l'on compare.
  const montant = `${params.montant} €`;
  const methode = LIBELLE_METHODE[params.methode];

  const lignesTexte = [
    `Bonjour ${params.prenom},`,
    "",
    "Votre intervention est terminée. Merci de votre confiance.",
    "",
    `Prestation : ${params.forfait}`,
    `Date : ${date}`,
    `Montant encaissé : ${montant}`,
    `Mode de paiement : ${methode}`,
    "",
    "Vous retrouvez cette intervention dans votre espace, onglet « Passées ».",
  ];

  const lignesHtml = [
    `<p>Bonjour ${echapper(params.prenom)},</p>`,
    "<p>Votre intervention est terminée. Merci de votre confiance.</p>",
    "<ul>",
    `<li><strong>Prestation</strong> : ${echapper(params.forfait)}</li>`,
    `<li><strong>Date</strong> : ${echapper(date)}</li>`,
    `<li><strong>Montant encaissé</strong> : ${echapper(montant)}</li>`,
    `<li><strong>Mode de paiement</strong> : ${echapper(methode)}</li>`,
    "</ul>",
    "<p>Vous retrouvez cette intervention dans votre espace, onglet « Passées ».</p>",
  ];

  await sendEmail({
    to: params.to,
    subject: SUJET,
    text: lignesTexte.join("\n"),
    html: lignesHtml.join("\n"),
  });
}
