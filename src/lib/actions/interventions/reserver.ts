"use server";

import { messageEchecStock } from "@/lib/actions/produits/messages";
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
import { authActionClient } from "@/lib/safe-action";
import { reserverSchema } from "@/lib/validations/interventions";

/// Validation d'une réservation, **le cœur du produit**.
///
/// **La garde d'authentification vit ICI**, pas dans le matcher de
/// `src/proxy.ts` : `/reserver` reste publique, le tunnel s'explore sans
/// compte, et la validation seule exige un compte activé (Constitution §3.2).
/// Dans le proxy elle fermerait tout le tunnel ; dans l'écran elle ne
/// protégerait rien, une Server Action exportée étant un endpoint POST public.

const MESSAGE_INDISPONIBLE =
  "Service de géolocalisation temporairement indisponible, réessayez.";
/// Virgule là où la SPEC écrit un cadratin, que CLAUDE.md §Typographie
/// interdit. Écart de forme signalé en PR pour write-back.
const MESSAGE_INTROUVABLE = "Adresse introuvable, vérifiez les informations.";
const MESSAGE_HORS_ZONE = "Aucun service disponible à cette adresse.";
const MESSAGE_FORFAIT_INCONNU = "Ce forfait n'est plus proposé.";
const MESSAGE_CRENEAU_PRIS =
  "Ce créneau vient d'être réservé. Choisissez-en un autre dans la liste rafraîchie.";
/// Un seul libellé pour le vélo inconnu et le vélo d'autrui : les distinguer
/// révélerait l'existence d'une ligne que l'appelant ne possède pas, `cycles.id`
/// étant un `SERIAL` énumérable. Même régime que les mutations produits.
const MESSAGE_CYCLE_INCONNU =
  "Ce vélo n'est plus dans votre liste. Choisissez-en un autre, ou « Aucun vélo ».";

export const reserver = authActionClient
  .inputSchema(reserverSchema)
  .action(async ({ parsedInput, ctx: { user } }) => {
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

    // La grille est recalculée côté serveur et le créneau soumis doit s'y
    // trouver : sans ça, un appel direct à l'action réserverait un dimanche à
    // 3 h du matin.
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

    // Re-résolu à l'instant de l'écriture plutôt que repris du tour de grille,
    // pour ne pas dépendre de l'ordre d'un tableau construit plus haut.
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
      clientId: user.id,
      photos: parsedInput.photos,
      panier: parsedInput.panier,
      cycleId: parsedInput.cycleId,
    });

    // Traité AVANT le refus de vente : `messageEchecStock` ne connaît que les
    // motifs de stock. La réservation entière est refusée plutôt que validée
    // sans le vélo, l'ignorer en silence ferait croire à un rendez-vous que le
    // client n'a pas demandé.
    if (!resultat.ok && resultat.reason === "cycle_introuvable") {
      return {
        ok: false as const,
        message: MESSAGE_CYCLE_INCONNU,
        creneauPerdu: false,
      };
    }

    // Composer un panier ne RETIENT rien : un stock tenu pendant une visite
    // abandonnée est un stock invendable. Le panier n'est pas corrigé dans le
    // dos du client, il lit ce qui manque et décide.
    if (!resultat.ok && resultat.reason !== "creneau_pris") {
      return {
        ok: false as const,
        message: messageEchecStock(resultat),
        creneauPerdu: false,
      };
    }

    // Course perdue face à la contrainte d'exclusion : deux clients ont validé
    // le même créneau à quelques millisecondes d'écart, la base a arbitré.
    if (!resultat.ok) {
      return {
        ok: false as const,
        message: MESSAGE_CRENEAU_PRIS,
        creneauPerdu: true,
      };
    }

    // Hors du chemin de réponse : l'aller-retour SMTP ne doit pas retarder la
    // confirmation, et son échec ne doit pas annuler une réservation que la
    // base a acceptée. Le destinataire est celui de la SESSION.
    dispatchEmail(
      `confirmation reservation ${String(resultat.interventionId)}`,
      () =>
        sendReservationEmail({
          to: user.email,
          interventionId: resultat.interventionId,
          debut: creneau.debut,
          dureeMinutes: resultat.durationSnapshot,
          // Le TOTAL, forfait plus produits : la DoD de l'email de confirmation
          // veut le total figé, et il vaut le forfait seul tant que le panier
          // est vide.
          prix: resultat.total,
          adresse: adresse.label,
          forfait: resultat.forfaitLabel,
        }),
    );

    return {
      ok: true as const,
      interventionId: resultat.interventionId,
      debut: creneau.debut.toISOString(),
      prix: resultat.total,
    };
  });
