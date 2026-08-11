import "server-only";

import { Prisma } from "@prisma/client";

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

// ─────────────────────────────────────────────────────────────────────────
// Espace client - `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR` et
// `US-INTERVENTIONS-LISTER-CLIENT-PASSEES` (T-V3-10).
// ─────────────────────────────────────────────────────────────────────────

/// Statuts terminaux, ceux de l'onglet « Passées ».
///
/// `IN_PROGRESS` n'y figure pas et n'est pas non plus « à venir » : une
/// intervention commencée n'est ni finie ni future. Elle reste dans l'onglet
/// « À venir » par le filtre ci-dessous, qui ne retient que `PLANNED` - un
/// rendez-vous en cours d'exécution n'a rien à faire dans un historique.
export const STATUTS_TERMINAUX = ["DONE", "CANCELLED"] as const;

export type ProduitAttache = {
  productId: number;
  label: string;
  quantity: number;
  /// Prix figé à la vente (Constitution §4.1), en chaîne à deux décimales.
  unitPriceSnapshot: string;
};

export type InterventionClient = {
  id: number;
  status: string;
  appointmentAt: Date;
  durationSnapshot: number;
  /// Le forfait SEUL. `total` porte forfait + produits.
  priceSnapshot: string;
  cancellationReason: string | null;
  forfait: string;
  adresse: {
    label: string | null;
    street: string;
    zipCode: string;
    city: string;
  };
  /// « Marc L. » - prénom et initiale, jamais le patronyme entier.
  technicien: string;
  produits: ProduitAttache[];
  total: string;
  photos: { id: number }[];
};

/// Prénom plus initiale du nom, exigé par les deux US au titre du RGPD
/// (« tech (prénom + initiale nom, protection RGPD) »).
///
/// L'abréviation se fait **ici**, à la frontière de la couche d'accès, et pas
/// dans la vue : c'est une décision de minimisation, pas de mise en forme. Le
/// patronyme entier ne doit pas traverser jusqu'au navigateur, où il suffirait
/// d'ouvrir les outils de développement pour le lire.
export function abregerNom(firstname: string, lastname: string): string {
  const initiale = lastname.trim().charAt(0).toUpperCase();
  return initiale ? `${firstname} ${initiale}.` : firstname;
}

/// Le `select` partagé par les deux listes et par le panneau de détail. Une
/// seule forme lue, donc une seule forme à faire évoluer.
const SELECTION_CLIENT = {
  id: true,
  status: true,
  appointmentAt: true,
  durationSnapshot: true,
  priceSnapshot: true,
  cancellationReason: true,
  service: { select: { label: true } },
  tech: { select: { firstname: true, lastname: true } },
  address: {
    select: {
      label: true,
      street: true,
      city: { select: { zipCode: true, city: true } },
    },
  },
  products: {
    select: {
      productId: true,
      quantity: true,
      unitPriceSnapshot: true,
      product: { select: { label: true } },
    },
    orderBy: { productId: "asc" },
  },
  // Les identifiants seuls : le contenu passe par
  // `GET /api/intervention-photos/[id]`, jamais par un chemin de fichier rendu
  // au navigateur.
  photos: { select: { id: true }, orderBy: { id: "asc" } },
} satisfies Prisma.InterventionSelect;

type LigneLue = Prisma.InterventionGetPayload<{
  select: typeof SELECTION_CLIENT;
}>;

/// Total affiché : `price_snapshot` du forfait + Σ `unit_price_snapshot` × qté.
///
/// Les deux US produits écrivent cette formule mot pour mot, et
/// `src/lib/db/queries/produits.ts` la calcule à l'identique après chaque
/// mutation T+n. Le total n'est **pas** stocké : le dictionnaire §interventions
/// champ 7 dit « prix TOTAL figé » et se trompe.
///
/// `Prisma.Decimal` et non un flottant : `85.00 + 12.90 × 3` perd ses centimes
/// en binaire, et c'est un montant que le client lit.
function projeter(ligne: LigneLue): InterventionClient {
  const total = ligne.products.reduce(
    (somme, produit) =>
      somme.plus(produit.unitPriceSnapshot.times(produit.quantity)),
    ligne.priceSnapshot,
  );

  return {
    id: ligne.id,
    status: ligne.status,
    appointmentAt: ligne.appointmentAt,
    durationSnapshot: ligne.durationSnapshot,
    priceSnapshot: ligne.priceSnapshot.toFixed(2),
    cancellationReason: ligne.cancellationReason,
    forfait: ligne.service.label,
    adresse: {
      label: ligne.address.label,
      street: ligne.address.street,
      zipCode: ligne.address.city.zipCode,
      city: ligne.address.city.city,
    },
    technicien: abregerNom(ligne.tech.firstname, ligne.tech.lastname),
    produits: ligne.products.map((produit) => ({
      productId: produit.productId,
      label: produit.product.label,
      quantity: produit.quantity,
      unitPriceSnapshot: produit.unitPriceSnapshot.toFixed(2),
    })),
    total: total.toFixed(2),
    photos: ligne.photos,
  };
}

/// Onglet « À venir » - `US-INTERVENTIONS-LISTER-CLIENT-A-VENIR`.
///
/// ⚠️ **Le statut seul, sans borne de date.** L'US écrit « le **filtre par
/// défaut** = `appointment_at >= now()` ET `status IN (PLANNED)` », et un défaut
/// n'est pas un invariant : appliqué comme tel, un rendez-vous d'hier que le
/// technicien n'a pas clôturé sortirait de « à venir » sans entrer dans
/// « passées », qui ne retient que les statuts terminaux. Le client perdrait de
/// vue une intervention qui existe encore. La date est affichée, il voit
/// qu'elle est passée. Arbitré le 2026-08-11.
export async function listerInterventionsAVenir(params: {
  clientId: string;
}): Promise<InterventionClient[]> {
  const lignes = await db.intervention.findMany({
    where: { clientId: params.clientId, status: "PLANNED" },
    select: SELECTION_CLIENT,
    orderBy: { appointmentAt: "asc" },
  });

  return lignes.map(projeter);
}

export type PagePassees = {
  interventions: InterventionClient[];
  /// Nombre total de lignes du filtre courant, pas de la page.
  total: number;
  page: number;
  pages: number;
};

/// Dix lignes par page. La pagination est exigée par l'US (« la liste paginée
/// triée par `appointment_at DESC` ») ; la valeur, elle, n'est écrite nulle
/// part.
export const TAILLE_PAGE_PASSEES = 10;

/// Onglet « Passées » - `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`.
///
/// Le filtre par période est celui que l'US demande (« un filtre par période
/// (année, ou date début / fin) ») ; les filtres par statut et par technicien
/// de la maquette C10 n'y figurent pas et ne sont pas portés.
///
/// `au` est reçue comme une date de jour et bornée en **exclusif au lendemain**
/// plutôt qu'en inclusif : `<= 2026-08-11T00:00Z` écarterait tout ce qui a eu
/// lieu dans la journée du 11, ce qui est faux pour un utilisateur qui vient de
/// saisir cette date comme fin de période.
export async function listerInterventionsPassees(params: {
  clientId: string;
  du?: Date;
  au?: Date;
  page?: number;
}): Promise<PagePassees> {
  // 🐛 `Math.trunc` en plus du plancher, relevé par l'agent testeur. Le numéro
  // vient de l'URL, donc de n'importe qui : `?page=2.3` traversait `Math.max`
  // intact, et `skip` valait `12.999999999999998`. Prisma type `skip` en `Int`
  // et refuse un flottant, donc 500 sur un paramètre bricolé ; et le numéro
  // fractionnaire ressortait dans `PagePassees`, où `cible === page` ne pouvait
  // plus être vrai - plus aucune page marquée `aria-current` (RGAA A).
  //
  // Même motif que le plancher à 1, qui ne couvrait que la moitié négative du
  // cas. `Number.isFinite` ferme les deux dernières formes, `NaN` et `Infinity`,
  // que `Math.max` propagerait telles quelles.
  const demandee = params.page ?? 1;
  const page = Number.isFinite(demandee)
    ? Math.max(1, Math.trunc(demandee))
    : 1;

  const fenetre =
    params.du || params.au
      ? {
          appointmentAt: {
            ...(params.du ? { gte: params.du } : {}),
            ...(params.au
              ? { lt: new Date(params.au.getTime() + 24 * 3_600_000) }
              : {}),
          },
        }
      : {};

  const filtre = {
    clientId: params.clientId,
    status: { in: [...STATUTS_TERMINAUX] },
    ...fenetre,
  };

  // Comptage et page en parallèle : ils ne dépendent pas l'un de l'autre, et
  // la base est jointe par un tunnel SSH où chaque aller-retour se paie.
  const [total, lignes] = await Promise.all([
    db.intervention.count({ where: filtre }),
    db.intervention.findMany({
      where: filtre,
      select: SELECTION_CLIENT,
      orderBy: { appointmentAt: "desc" },
      skip: (page - 1) * TAILLE_PAGE_PASSEES,
      take: TAILLE_PAGE_PASSEES,
    }),
  ]);

  return {
    interventions: lignes.map(projeter),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / TAILLE_PAGE_PASSEES)),
  };
}

/// Les deux compteurs des onglets (« À venir (2) · Passées (5) », écran C8).
///
/// Comptés plutôt que déduits de la longueur des listes : celle des passées est
/// paginée, et son `length` vaudrait dix quoi qu'il arrive.
export async function compterInterventionsClient(params: {
  clientId: string;
}): Promise<{ aVenir: number; passees: number }> {
  const [aVenir, passees] = await Promise.all([
    db.intervention.count({
      where: { clientId: params.clientId, status: "PLANNED" },
    }),
    db.intervention.count({
      where: {
        clientId: params.clientId,
        status: { in: [...STATUTS_TERMINAUX] },
      },
    }),
  ]);

  return { aVenir, passees };
}

// ⚠️ `chargerInterventionDuClient` a été écrite ici puis **retirée** au
// 2026-08-11, sur constat de l'agent testeur : aucun appelant. Le panneau de
// détail sélectionne côté client dans la liste déjà chargée, il ne recharge
// rien. Elle aurait servi T-V3-11, qui devra lire l'intervention à annuler dans
// sa Server Action - et c'est exactement le motif de la retirer : le panneau du
// même écran écrit qu'« une place gardée pour une tâche future est un
// mort-vivant si la tâche glisse ». Trois lignes à réécrire le jour où un
// appelant existe, sur le modèle de `SELECTION_CLIENT` et `projeter`.
