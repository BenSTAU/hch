import "server-only";

import { ROLE_TECH } from "@/lib/auth/permissions";
import type { TechnicienCharge } from "@/lib/creneaux/derivation";
import { db } from "@/lib/db/client";
import { creerAdresse, resoudreCommune } from "@/lib/db/queries/adresses";
import {
  vendreProduits,
  type EchecStock,
  type LignePanier,
} from "@/lib/db/queries/produits";
import type { PointWgs84 } from "@/lib/geo/postgis";

/// Accès aux interventions - helpers métier, pas Server Actions.
///
/// Aucun `revalidatePath`, aucun `redirect` : ils jettent hors contexte Next et
/// rendraient ces fonctions intestables en isolation.

/// Statuts qui occupent un créneau. Les mêmes que le filtre de la contrainte
/// `no_double_booking` (migration 010) - et ce n'est pas une coïncidence à
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
      /// ni recalculer un prix - ce sont les valeurs **figées**, seules à faire
      /// foi (Constitution §4.1).
      priceSnapshot: string;
      durationSnapshot: number;
      /// Forfait **plus** les produits vendus. `price_snapshot` porte le forfait
      /// seul, le total se calcule (`US-INTERVENTION-PRODUIT-AJOUTER-TUNNEL` :
      /// « total = `price_snapshot` forfait + Σ `unit_price_snapshot` × qté »).
      total: string;
      /// Libellé du forfait, que la DoD veut dans l'email de confirmation.
      forfaitLabel: string;
    }
  | { ok: false; reason: "creneau_pris" }
  /// Refus de vente. `EchecStock` porte déjà son propre discriminant, on ne lui
  /// en surajoute pas un second : `reason` reste la seule question à poser.
  | ({ ok: false } & EchecStock);

/// Sentinelle d'annulation de la transaction de réservation.
///
/// Un refus de vente ne peut pas remonter par une valeur de retour : le
/// callback de `$transaction` qui rend une valeur **commite**. L'intervention
/// serait créée et le panier perdu, ce qui est exactement l'état que le double
/// filet cherche à rendre impossible.
class VenteRefusee extends Error {
  constructor(readonly echec: EchecStock) {
    super(echec.reason);
    this.name = "VenteRefusee";
  }
}

/// Nom de la contrainte d'exclusion de la migration 010.
///
/// La détection se fait sur ce nom et non sur un code d'erreur Prisma : Prisma
/// mappe les violations d'unicité sur `P2002`, mais **pas** les violations
/// d'exclusion, qui remontent en erreur brute. Le nom, lui, est stable - il est
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
  /// Chemins rendus par `POST /api/upload-intervention-photo`. Les fichiers
  /// sont déjà sur le disque, dépouillés de leur EXIF ; ce sont les LIGNES qui
  /// naissent ici.
  photos: readonly string[];
  /// Panier composé pendant le tunnel. Vendu **dans cette transaction** : le
  /// stock décrémenté et l'intervention créée partagent le même sort, sinon une
  /// course perdue sur le créneau laisserait du stock consommé pour un
  /// rendez-vous qui n'existe pas.
  panier: readonly LignePanier[];
}): Promise<CreationIntervention> {
  try {
    return await db.$transaction(async (tx) => {
      // L'adresse naît DANS la transaction de la réservation. Si la contrainte
      // anti-double-réservation rejette l'intervention, elle disparaît avec
      // elle - sinon chaque course perdue laisserait une adresse orpheline.
      const cityId = await resoudreCommune(
        { postcode: params.adresse.postcode, city: params.adresse.city },
        tx,
      );

      // Réutiliser l'adresse déjà connue plutôt qu'en créer une par
      // réservation : le libellé vient de la BAN, il est canonique, donc deux
      // réservations au même endroit donnent exactement la même rue et la même
      // commune. Sans ce filtre, un client fidèle accumule des lignes
      // indiscernables dans son sélecteur. Relevé par l'agent testeur.
      const existante = await tx.address.findFirst({
        where: {
          userId: params.clientId,
          street: params.adresse.street,
          cityId,
          isActive: true,
        },
        select: { id: true },
      });

      const addressId =
        existante?.id ??
        (await creerAdresse(
          {
            street: params.adresse.street,
            cityId,
            point: params.adresse.point,
            userId: params.clientId,
          },
          tx,
        ));

      const forfait = await tx.service.findUniqueOrThrow({
        where: { id: params.serviceId },
        select: { price: true, duration: true, label: true },
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

      // Après l'intervention, et dans la même transaction : `intervention_id`
      // est NOT NULL, l'ordre inverse est impossible. Une validation qui échoue
      // ne laisse donc aucune ligne `photos` orpheline - seuls les fichiers
      // restent sur le disque, ce qui est sans conséquence et sans référence.
      if (params.photos.length > 0) {
        await tx.photo.createMany({
          data: params.photos.map((url) => ({
            url,
            // `BEFORE` : la photo est déposée par le client AVANT
            // l'intervention. `AFTER` appartient au technicien, sur le terrain.
            type: "BEFORE",
            uploadedByUserId: params.clientId,
            interventionId: intervention.id,
          })),
        });
      }

      // Après l'intervention pour la même raison que les photos :
      // `intervention_products.intervention_id` est la moitié de la clé
      // primaire. Le refus de vente sort par un throw, seul moyen d'annuler la
      // transaction plutôt que de la commiter amputée de son panier.
      const vente = await vendreProduits(tx, {
        interventionId: intervention.id,
        panier: params.panier,
      });
      if (!vente.ok) throw new VenteRefusee(vente);

      return {
        ok: true as const,
        interventionId: intervention.id,
        priceSnapshot: forfait.price.toFixed(2),
        durationSnapshot: forfait.duration,
        total: vente.total.plus(forfait.price).toFixed(2),
        forfaitLabel: forfait.label,
      };
    });
  } catch (error) {
    // Refus métier levé par la vente. Le client peut le corriger seul, en
    // retirant la ligne ou en baissant sa quantité.
    if (error instanceof VenteRefusee) {
      return { ok: false, ...error.echec };
    }

    // La course a été perdue : un autre client a pris le créneau entre
    // l'affichage de la grille et cette insertion. C'est un refus métier, pas
    // une panne - le laisser remonter afficherait « une erreur est survenue »
    // là où le tunnel a une réponse à donner.
    if (String(error).includes(CONTRAINTE_DOUBLE_RESERVATION)) {
      return { ok: false, reason: "creneau_pris" };
    }
    throw error;
  }
}
