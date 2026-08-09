import "server-only";

import { ROLE_TECH } from "@/lib/auth/permissions";
import type { TechnicienCharge } from "@/lib/creneaux/derivation";
import { db } from "@/lib/db/client";
import { creerAdresse, resoudreCommune } from "@/lib/db/queries/adresses";
import type { PointWgs84 } from "@/lib/geo/postgis";

/// Accès aux interventions — helpers métier, pas Server Actions.
///
/// Aucun `revalidatePath`, aucun `redirect` : ils jettent hors contexte Next et
/// rendraient ces fonctions intestables en isolation.

/// Statuts qui occupent un créneau. Les mêmes que le filtre de la contrainte
/// `no_double_booking` (migration 010) — et ce n'est pas une coïncidence à
/// conserver par vigilance : si les deux listes divergeaient, la grille
/// proposerait des créneaux que la base refuserait, ou en masquerait de libres.
export const STATUTS_OCCUPANTS = ["PLANNED", "IN_PROGRESS"] as const;

/// Techniciens de la zone, avec leurs interventions déjà planifiées sur la
/// fenêtre demandée.
///
/// Triés par identifiant croissant : c'est l'ordre que consomme
/// `affecterPremierLibre`, et il doit être stable pour qu'un même créneau ne
/// change pas de technicien entre l'affichage de la grille et la validation.
export async function listerTechniciensCharges(params: {
  zoneId: number;
  depuis: Date;
  jusqua: Date;
}): Promise<TechnicienCharge[]> {
  const affectations = await db.technicianZone.findMany({
    where: {
      zoneId: params.zoneId,
      // Un compte désactivé garde ses affectations : filtrer ici évite de
      // proposer les créneaux d'un technicien qui a quitté l'entreprise.
      user: { isActive: true, deletedAt: null, roles: { has: ROLE_TECH } },
    },
    select: { userId: true },
    orderBy: { userId: "asc" },
  });

  if (affectations.length === 0) return [];

  const identifiants = affectations.map((affectation) => affectation.userId);

  const occupations = await db.intervention.findMany({
    where: {
      techId: { in: identifiants },
      status: { in: [...STATUTS_OCCUPANTS] },
      // Fenêtre élargie d'un jour vers l'arrière : une intervention commencée
      // la veille au soir peut mordre sur le premier créneau du lendemain.
      appointmentAt: {
        gte: new Date(params.depuis.getTime() - 24 * 3_600_000),
        lt: params.jusqua,
      },
    },
    select: { techId: true, appointmentAt: true, durationSnapshot: true },
  });

  const parTechnicien = new Map<string, { debut: Date; fin: Date }[]>(
    identifiants.map((id) => [id, []]),
  );

  for (const occupation of occupations) {
    const debut = occupation.appointmentAt;
    const fin = new Date(
      debut.getTime() + occupation.durationSnapshot * 60_000,
    );
    parTechnicien.get(occupation.techId)?.push({ debut, fin });
  }

  return identifiants.map((id) => ({
    id,
    occupes: parTechnicien.get(id) ?? [],
  }));
}

export type CreationIntervention =
  | {
      ok: true;
      interventionId: number;
      /// Renvoyés pour l'email de confirmation, qui ne doit pas relire la base
      /// ni recalculer un prix — ce sont les valeurs **figées**, seules à faire
      /// foi (Constitution §4.1).
      priceSnapshot: string;
      durationSnapshot: number;
    }
  | { ok: false; reason: "creneau_pris" };

/// Nom de la contrainte d'exclusion de la migration 010.
///
/// La détection se fait sur ce nom et non sur un code d'erreur Prisma : Prisma
/// mappe les violations d'unicité sur `P2002`, mais **pas** les violations
/// d'exclusion, qui remontent en erreur brute. Le nom, lui, est stable — il est
/// écrit dans la migration.
const CONTRAINTE_DOUBLE_RESERVATION = "no_double_booking";

/// Crée l'intervention et fige ses deux instantanés.
///
/// `price_snapshot` **et** `duration_snapshot` sont écrits ici, à partir du
/// forfait lu dans la même transaction : un changement de tarif ou de durée
/// postérieur n'altère jamais un rendez-vous déjà pris (Constitution §4.1).
export async function reserverIntervention(params: {
  serviceId: number;
  adresse: {
    street: string;
    postcode: string;
    city: string;
    point: PointWgs84;
  };
  techId: string;
  appointmentAt: Date;
  clientId: string;
}): Promise<CreationIntervention> {
  try {
    return await db.$transaction(async (tx) => {
      // L'adresse naît DANS la transaction de la réservation. Si la contrainte
      // anti-double-réservation rejette l'intervention, elle disparaît avec
      // elle — sinon chaque course perdue laisserait une adresse orpheline.
      const cityId = await resoudreCommune(
        { postcode: params.adresse.postcode, city: params.adresse.city },
        tx,
      );

      const addressId = await creerAdresse(
        {
          street: params.adresse.street,
          cityId,
          point: params.adresse.point,
          userId: params.clientId,
        },
        tx,
      );

      const forfait = await tx.service.findUniqueOrThrow({
        where: { id: params.serviceId },
        select: { price: true, duration: true },
      });

      const intervention = await tx.intervention.create({
        data: {
          status: "PLANNED",
          appointmentAt: params.appointmentAt,
          priceSnapshot: forfait.price,
          durationSnapshot: forfait.duration,
          clientId: params.clientId,
          techId: params.techId,
          addressId,
          serviceId: params.serviceId,
          // `cycle_id` reste NULL : aucune étape du tunnel ne demande le vélo,
          // et qui le renseignera n'est pas tranché (dictionnaire v2.4).
        },
        select: { id: true },
      });

      return {
        ok: true as const,
        interventionId: intervention.id,
        priceSnapshot: forfait.price.toFixed(2),
        durationSnapshot: forfait.duration,
      };
    });
  } catch (error) {
    // La course a été perdue : un autre client a pris le créneau entre
    // l'affichage de la grille et cette insertion. C'est un refus métier, pas
    // une panne — le laisser remonter afficherait « une erreur est survenue »
    // là où le tunnel a une réponse à donner.
    if (String(error).includes(CONTRAINTE_DOUBLE_RESERVATION)) {
      return { ok: false, reason: "creneau_pris" };
    }
    throw error;
  }
}
