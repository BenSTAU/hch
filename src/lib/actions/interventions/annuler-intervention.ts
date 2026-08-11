"use server";

import { revalidatePath } from "next/cache";

import {
  annulerInterventionDuClient,
  type ResultatAnnulation,
} from "@/lib/db/queries/interventions";
import { sendAnnulationEmail } from "@/lib/email/annulation";
import { dispatchEmail } from "@/lib/email/dispatch";
import {
  CHEMIN_ESPACE_CLIENT,
  CHEMIN_ESPACE_CLIENT_PASSEES,
} from "@/lib/routes";
import { authActionClient } from "@/lib/safe-action";
import { annulerInterventionSchema } from "@/lib/validations/interventions";

/// Annulation d'une intervention par son client -
/// `US-INTERVENTION-ANNULER-CLIENT`, golden path **GP-03**.
///
/// Les trois gardes vivent dans le helper métier, pas ici : propriété, statut
/// et fenêtre H-24 décident d'une écriture, elles appartiennent donc à la
/// transaction qui l'exécute. Cette action-ci orchestre - validation, contexte,
/// invalidation, notification.

function messageRefus(echec: Extract<ResultatAnnulation, { ok: false }>): {
  message: string;
  /// Un refus de fenêtre n'est pas une erreur de l'utilisateur : c'est l'état
  /// nominal passé H-24, et l'écran doit basculer sur le bandeau de contact
  /// plutôt que d'afficher une alerte rouge de plus.
  fenetreDepassee: boolean;
} {
  switch (echec.reason) {
    case "introuvable":
      return { message: "Intervention introuvable.", fenetreDepassee: false };
    case "non_annulable":
      // Libellé de l'US §Cas d'erreur, au mot près.
      return {
        message: "Cette intervention n'est plus annulable.",
        fenetreDepassee: false,
      };
    case "fenetre_depassee":
      return {
        message:
          "Annulation impossible à moins de 24 h du rendez-vous. Contactez-nous pour un cas de force majeure.",
        fenetreDepassee: true,
      };
  }
}

export const annulerIntervention = authActionClient
  .inputSchema(annulerInterventionSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
    const resultat = await annulerInterventionDuClient({
      ...parsedInput,
      // Le propriétaire vient du CONTEXTE, jamais de la charge utile. Rappel
      // d'ADR-006 v2 : cette action est un endpoint POST public.
      clientId: user.id,
      // L'instant est fixé **ici**, une fois, et traverse la transaction : le
      // lire deux fois ferait décider les gardes sur deux valeurs différentes.
      maintenant: new Date(),
    });

    if (!resultat.ok) {
      return { ok: false as const, ...messageRefus(resultat) };
    }

    // La ligne quitte « À venir » pour « Passées » : les deux écrans changent,
    // et le second afficherait une liste périmée sans cette seconde
    // invalidation.
    revalidatePath(CHEMIN_ESPACE_CLIENT);
    revalidatePath(CHEMIN_ESPACE_CLIENT_PASSEES);

    // Hors du chemin de réponse (`dispatchEmail`) : l'annulation est acquise en
    // base, le client n'a pas à attendre un aller-retour SMTP pour le savoir, et
    // un échec d'envoi ne doit pas transformer une annulation réussie en erreur.
    dispatchEmail("annulation technicien", () =>
      sendAnnulationEmail({
        to: resultat.technicien.email,
        prenom: resultat.technicien.firstname,
        debut: resultat.appointmentAt,
        dureeMinutes: resultat.durationSnapshot,
        adresse: resultat.adresse,
        forfait: resultat.forfait,
        motif: resultat.motif,
      }),
    );

    return { ok: true as const };
  });
