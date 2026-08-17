"use server";

import { revalidatePath } from "next/cache";

import {
  cloturerInterventionDuTech,
  type DemandeCloture,
  type ResultatCloture,
} from "@/lib/db/queries/paiements";
import { dispatchEmail } from "@/lib/email/dispatch";
import { sendClotureEmail } from "@/lib/email/cloture";
import {
  cheminIntervention,
  CHEMIN_ESPACE_CLIENT,
  CHEMIN_ESPACE_CLIENT_PASSEES,
  CHEMIN_TOURNEE_DU_JOUR,
  CHEMIN_TOURNEE_PASSEES,
} from "@/lib/routes";
import { techActionClient } from "@/lib/safe-action";
import { cloturerInterventionSchema } from "@/lib/validations/paiements";

/// Clôture d'une intervention avec son encaissement,
/// `US-INTERVENTION-MARQUER-FAITE` couplée à `US-PAIEMENT-ENREGISTRER`, écran
/// **T4**. Les gardes de propriété et de statut vivent dans le helper métier :
/// elles décident d'une écriture, donc appartiennent à sa transaction.
///
/// `techActionClient` applique `requireTech()` en middleware. La garde de la
/// page ne couvre pas cet appel, `src/proxy.ts` laissant passer `Next-Action` :
/// une Server Action exportée est un endpoint POST public (ADR-006 v2).
///
/// ⚠️ **Le rôle ne suffit pas** : il prouve que l'appelant est technicien, pas
/// que l'intervention est la sienne. La propriété se joue dans la clause
/// `where` de `cloturerInterventionDuTech`, qui reçoit `ctx.tech.id`.
///
/// Le paiement est **irréversible en v1** (SPEC §Cas nominal) : ce fichier est
/// le seul écrivain de `payments`, sans mise à jour ni suppression.

/// Le libellé rendu à l'écran pour chacun des deux refus. `switch` exhaustif :
/// ajouter une branche à `ResultatCloture` sans la traiter ne compile pas.
function messageRefus(echec: Extract<ResultatCloture, { ok: false }>): string {
  switch (echec.reason) {
    case "introuvable":
      // Même libellé que le démarrage et que les mutations produits :
      // l'intervention inconnue et celle d'un collègue ne se distinguent pas.
      return "Intervention introuvable.";
    case "transition_illegale":
      // Les situations ne se corrigent pas de la même façon : une `PLANNED`
      // se démarre, une `DONE` ou une `CANCELLED` ne se reprend pas.
      return echec.statutCourant === "PLANNED"
        ? "Cette intervention n'a pas encore été démarrée."
        : "Cette intervention est déjà clôturée ou annulée.";
  }
}

export const cloturerIntervention = techActionClient
  .inputSchema(cloturerInterventionSchema)
  .action(async ({ parsedInput, ctx: { tech } }) => {
    // Reconstruite plutôt que passée telle quelle : `parsedInput` porte aussi
    // `interventionId`, et `DemandeCloture` doit rester le contrat exact de la
    // couche d'accès.
    const demande: DemandeCloture =
      parsedInput.issue === "encaisse"
        ? {
            issue: "encaisse",
            montant: parsedInput.montant,
            methode: parsedInput.methode,
          }
        : { issue: "refuse", motif: parsedInput.motif };

    const resultat = await cloturerInterventionDuTech({
      interventionId: parsedInput.interventionId,
      // Le technicien vient du CONTEXTE, jamais de la charge utile.
      techId: tech.id,
      // Fixé **ici**, une fois, et traverse la transaction : `paid_at` et
      // `completed_at` doivent porter la même valeur, et une horloge reçue du
      // client permettrait d'antidater un encaissement.
      maintenant: new Date(),
      demande,
    });

    // Les refus revalident AUSSI : ils disent que la vue de l'appelant est
    // périmée. Sans invalidation, l'écran garde son bouton et le technicien
    // réessaie contre un état faux.
    revalidatePath(cheminIntervention(parsedInput.interventionId));
    revalidatePath(CHEMIN_TOURNEE_DU_JOUR);

    if (!resultat.ok) {
      return { ok: false as const, message: messageRefus(resultat) };
    }

    // La ligne quitte la tournée du jour pour l'historique technicien, et
    // l'onglet « À venir » du client pour ses « Passées » : quatre écrans.
    revalidatePath(CHEMIN_TOURNEE_PASSEES);
    revalidatePath(CHEMIN_ESPACE_CLIENT);
    revalidatePath(CHEMIN_ESPACE_CLIENT_PASSEES);

    if (resultat.issue === "encaisse") {
      // **Branche nominale seule** (cf. ADR-017 amendé) : le refus de paiement
      // n'envoie rien, son motif étant déjà affiché au client sur son écran
      // des passées. Hors du chemin de réponse, un échec d'envoi ne doit pas
      // transformer une clôture acquise en base en erreur.
      dispatchEmail("cloture intervention", () =>
        sendClotureEmail({
          to: resultat.client.email,
          prenom: resultat.client.firstname,
          debut: resultat.appointmentAt,
          forfait: resultat.forfait,
          montant: resultat.montant,
          methode: resultat.methode,
        }),
      );
    }

    return { ok: true as const, issue: resultat.issue };
  });
