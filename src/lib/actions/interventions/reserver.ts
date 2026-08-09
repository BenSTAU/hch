"use server";

import { getOptionalUser } from "@/lib/auth/dal";
import {
  affecterCreneaux,
  affecterPremierLibre,
  deriverCreneaux,
  HORIZON_JOURS,
} from "@/lib/creneaux/derivation";
import { db } from "@/lib/db/client";
import {
  listerTechniciensCharges,
  reserverIntervention,
} from "@/lib/db/queries/interventions";
import { lireHorairesSemaine } from "@/lib/db/queries/parametres";
import { dispatchEmail } from "@/lib/email/dispatch";
import { sendReservationEmail } from "@/lib/email/reservation";
import { geocoderAdresse } from "@/lib/geo/ban";
import { trouverZoneCouvrante } from "@/lib/geo/postgis";
import { actionClient } from "@/lib/safe-action";
import { reserverSchema } from "@/lib/validations/interventions";

/// Validation d'une réservation — **le cœur du produit**.
///
/// `actionClient` et non `authActionClient` : la réservation précède
/// l'inscription (Constitution §3.2). Un visiteur réserve avec son seul email,
/// et `interventions.client_id` reste NULL jusqu'à l'activation de son compte.
///
/// Le tunnel aboutit à une intervention planifiée **sans intervention
/// humaine** (Constitution §1.2) : pas de file de leads, pas de rappel.

const MESSAGE_INDISPONIBLE =
  "Service de géolocalisation temporairement indisponible — réessayez.";
const MESSAGE_INTROUVABLE = "Adresse introuvable — vérifiez les informations.";
const MESSAGE_HORS_ZONE = "Aucun service disponible à cette adresse.";
const MESSAGE_FORFAIT_INCONNU = "Ce forfait n'est plus proposé.";
const MESSAGE_EMAIL_REQUIS =
  "Renseignez votre email pour recevoir la confirmation.";
const MESSAGE_CRENEAU_PRIS =
  "Ce créneau vient d'être réservé. Choisissez-en un autre dans la liste rafraîchie.";

export const reserver = actionClient
  .inputSchema(reserverSchema)
  .action(async ({ parsedInput }) => {
    const utilisateur = await getOptionalUser();

    // La session prime quand elle existe : un `guestEmail` envoyé par un
    // visiteur connecté ne doit pas détourner la réservation vers une autre
    // adresse que la sienne.
    const clientId = utilisateur?.id ?? null;
    const guestEmail = utilisateur ? null : (parsedInput.guestEmail ?? null);

    if (!clientId && !guestEmail) {
      // Le CHECK `interventions_requester_present` refuserait la ligne, mais
      // une erreur de base donnerait « une erreur est survenue » à quelqu'un
      // qui a juste oublié un champ.
      return {
        ok: false as const,
        message: MESSAGE_EMAIL_REQUIS,
        creneauPerdu: false,
      };
    }

    // Le libellé est la seule donnée d'adresse qui décide. Les `lon`/`lat`
    // reçus sont écartés : les retenir permettrait de forger un point tombant
    // dans une zone servie pour une adresse qui n'y est pas.
    const geocodage = await geocoderAdresse(parsedInput.adresse.label);
    if (!geocodage.ok) {
      return {
        ok: false as const,
        message:
          geocodage.reason === "indisponible"
            ? MESSAGE_INDISPONIBLE
            : MESSAGE_INTROUVABLE,
        creneauPerdu: false,
      };
    }

    const adresse = geocodage.data;
    const point = { lon: adresse.lon, lat: adresse.lat };

    const couverture = await trouverZoneCouvrante(point);
    if (!couverture.ok) {
      return {
        ok: false as const,
        message: MESSAGE_HORS_ZONE,
        creneauPerdu: false,
      };
    }

    const forfait = await db.service.findFirst({
      where: { id: parsedInput.serviceId, isActive: true },
      select: { duration: true },
    });
    if (!forfait) {
      return {
        ok: false as const,
        message: MESSAGE_FORFAIT_INCONNU,
        creneauPerdu: false,
      };
    }

    const maintenant = new Date();
    const jusqua = new Date(
      maintenant.getTime() + HORIZON_JOURS * 24 * 3_600_000,
    );

    const [{ horaires }, techniciens] = await Promise.all([
      lireHorairesSemaine(),
      listerTechniciensCharges({
        zoneId: couverture.zoneId,
        depuis: maintenant,
        jusqua,
      }),
    ]);

    // La grille est recalculée côté serveur, et le créneau soumis doit s'y
    // trouver. Sans cette vérification, un appel direct à l'action réserverait
    // un dimanche à 3 h du matin — la Server Action est un endpoint POST
    // public, l'écran ne protège rien.
    const disponibles = affecterCreneaux(
      deriverCreneaux({
        horaires,
        dureeMinutes: forfait.duration,
        maintenant,
      }),
      techniciens,
    );

    const vise = parsedInput.debut.getTime();
    const creneau = disponibles.find((c) => c.debut.getTime() === vise);
    if (!creneau) {
      return {
        ok: false as const,
        message: MESSAGE_CRENEAU_PRIS,
        creneauPerdu: true,
      };
    }

    // Re-résolu à l'instant de l'écriture plutôt que repris du tour de grille :
    // les deux donnent le même technicien, mais celui-ci le dit explicitement
    // au lieu de dépendre de l'ordre d'un tableau construit plus haut.
    const techId = affecterPremierLibre(creneau, techniciens);
    if (!techId) {
      return {
        ok: false as const,
        message: MESSAGE_CRENEAU_PRIS,
        creneauPerdu: true,
      };
    }

    const resultat = await reserverIntervention({
      serviceId: parsedInput.serviceId,
      adresse: {
        street: adresse.street,
        postcode: adresse.postcode,
        city: adresse.city,
        point,
      },
      techId,
      appointmentAt: creneau.debut,
      clientId,
      guestEmail,
    });

    // La course perdue face à la contrainte d'exclusion : deux clients ont
    // validé le même créneau à quelques millisecondes d'écart. La base a
    // arbitré, le tunnel a une réponse à donner — et la grille rafraîchie
    // montre ce qui reste.
    if (!resultat.ok) {
      return {
        ok: false as const,
        message: MESSAGE_CRENEAU_PRIS,
        creneauPerdu: true,
      };
    }

    const destinataire = utilisateur?.email ?? guestEmail;
    if (destinataire) {
      // Hors du chemin de réponse, comme l'activation : l'aller-retour SMTP ne
      // doit pas retarder la confirmation à l'écran, et son échec ne doit pas
      // annuler une réservation que la base a acceptée.
      dispatchEmail(
        `confirmation reservation ${String(resultat.interventionId)}`,
        () =>
          sendReservationEmail({
            to: destinataire,
            interventionId: resultat.interventionId,
            debut: creneau.debut,
            dureeMinutes: resultat.durationSnapshot,
            prix: resultat.priceSnapshot,
            adresse: adresse.label,
            zone: couverture.zoneName,
            invitationCompte: clientId === null,
          }),
      );
    }

    return {
      ok: true as const,
      interventionId: resultat.interventionId,
      debut: creneau.debut.toISOString(),
      prix: resultat.priceSnapshot,
      // Le visiteur se voit proposer de créer un compte après coup
      // (Constitution §3.2) — c'est l'écran de confirmation qui le porte.
      invitationCompte: clientId === null,
    };
  });
