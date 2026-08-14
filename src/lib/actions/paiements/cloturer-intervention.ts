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

/// Clôture d'une intervention avec son encaissement -
/// `US-INTERVENTION-MARQUER-FAITE` couplée à `US-PAIEMENT-ENREGISTRER`, écran
/// **T4**.
///
/// Les deux gardes de décision vivent dans le helper métier, pas ici :
/// propriété et statut décident d'une écriture, elles appartiennent donc à la
/// transaction qui l'exécute. Cette action-ci orchestre - rôle, validation,
/// contexte, invalidation, notification.
///
/// ── Une action pour les deux branches
///
/// L'entrée est une union discriminée. Deux actions distinctes auraient dupliqué
/// la garde de rôle, la garde de propriété, le verrou et la relecture sous
/// verrou, pour deux branches que SPEC §Amendements A4 déclare indissociables -
/// et auraient doublé la surface d'endpoint POST public à garder.
///
/// ── Elle porte sa propre garde de rôle, et ce n'est pas une redondance
///
/// `techActionClient` applique `requireTech()` en **middleware**, donc avant la
/// validation Zod. La garde de la page ne couvre pas cet appel, `src/proxy.ts`
/// laissant délibérément passer `Next-Action`. Une Server Action exportée est
/// un endpoint POST public (ADR-006 v2).
///
/// ⚠️ **Le rôle ne suffit pas** : `requireTech()` prouve que l'appelant est
/// technicien, pas que l'intervention est la sienne. La propriété se joue dans
/// la clause `where` de `cloturerInterventionDuTech`, qui reçoit `ctx.tech.id`
/// et jamais un identifiant venu de la charge utile.
///
/// ── Aucune action de modification après coup, et c'est la DoD
///
/// Le paiement est **irréversible en v1** (SPEC §Cas nominal) : ce fichier est
/// le seul écrivain de `payments`, il n'expose ni mise à jour ni suppression, et
/// `src/lib/safe-action.test.ts` fige l'inventaire complet des Server Actions -
/// en ajouter une sans garde rougit.

/// Le libellé rendu à l'écran pour chacun des deux refus.
///
/// `switch` exhaustif sur le discriminant : ajouter une branche à
/// `ResultatCloture` sans la traiter ici ne compile pas.
function messageRefus(echec: Extract<ResultatCloture, { ok: false }>): string {
  switch (echec.reason) {
    case "introuvable":
      // Même libellé que le démarrage et que les mutations produits :
      // l'intervention inconnue et celle d'un collègue ne se distinguent pas.
      return "Intervention introuvable.";
    case "transition_illegale":
      // Le statut courant est nommé plutôt que sous-entendu. Les trois
      // situations ne se corrigent pas de la même façon : une `PLANNED` se
      // démarre, une `DONE` ou une `CANCELLED` ne se reprend pas.
      return echec.statutCourant === "PLANNED"
        ? "Cette intervention n'a pas encore été démarrée."
        : "Cette intervention est déjà clôturée ou annulée.";
  }
}

export const cloturerIntervention = techActionClient
  .inputSchema(cloturerInterventionSchema)
  .action(async ({ parsedInput, ctx: { tech } }) => {
    // La demande se reconstruit à partir du discriminant plutôt que d'être
    // passée telle quelle : `parsedInput` porte aussi `interventionId`, que le
    // helper reçoit par ailleurs, et le type `DemandeCloture` doit rester le
    // contrat exact de la couche d'accès.
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
      // L'instant est fixé **ici**, une fois, et traverse la transaction :
      // `paid_at` et `completed_at` doivent porter la même valeur, et une
      // horloge reçue du client permettrait d'antidater un encaissement.
      maintenant: new Date(),
      demande,
    });

    // Les refus revalident aussi, pour la raison démontrée sur l'annulation
    // (PR #33) puis sur le démarrage : ils disent que la vue de l'appelant est
    // PÉRIMÉE. Sans invalidation, l'écran garde son bouton et le technicien
    // réessaie contre un état faux.
    revalidatePath(cheminIntervention(parsedInput.interventionId));
    revalidatePath(CHEMIN_TOURNEE_DU_JOUR);

    if (!resultat.ok) {
      return { ok: false as const, message: messageRefus(resultat) };
    }

    // La ligne quitte la tournée du jour pour l'historique technicien, et
    // l'onglet « À venir » du client pour ses « Passées ». Quatre écrans
    // changent, et les deux derniers afficheraient une liste périmée.
    revalidatePath(CHEMIN_TOURNEE_PASSEES);
    revalidatePath(CHEMIN_ESPACE_CLIENT);
    revalidatePath(CHEMIN_ESPACE_CLIENT_PASSEES);

    if (resultat.issue === "encaisse") {
      // 9e email du périmètre v1 (ADR-017 amendé, D10). **Branche nominale
      // seule** : le refus de paiement n'envoie rien, le motif saisi par le
      // technicien étant déjà affiché au client sur son écran des passées, et
      // le corps d'un courrier de non-paiement n'étant écrit nulle part.
      //
      // Hors du chemin de réponse (`dispatchEmail`) : la clôture est acquise en
      // base, le technicien n'a pas à attendre un aller-retour SMTP, et un
      // échec d'envoi ne doit pas transformer une clôture réussie en erreur.
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
