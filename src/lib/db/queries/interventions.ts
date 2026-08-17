import "server-only";

import { Prisma } from "@prisma/client";

import { writeAuditLog } from "@/lib/audit/log";
import { ROLE_TECH } from "@/lib/auth/roles";
import type { TechnicienCharge } from "@/lib/creneaux/derivation";
import {
  ajouterJours,
  instantUtc,
  type JourCivil,
} from "@/lib/creneaux/horaires";
import type { FenetreJours } from "@/lib/interventions/fenetre";
import { db } from "@/lib/db/client";
import { creerAdresse, resoudreCommune } from "@/lib/db/queries/adresses";
import { annulationOuverte } from "@/lib/interventions/annulation";
import {
  vendreProduits,
  type EchecStock,
  type LignePanier,
} from "@/lib/db/queries/produits";
import { lirePointsAdresses, type PointWgs84 } from "@/lib/geo/postgis";

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
  /// Le vélo désigné à C5 n'est pas celui de l'appelant, ou n'existe pas. Un
  /// seul motif pour les deux cas, même régime anti-énumération que
  /// `rattacherCycleAIntervention` : `cycles.id` est un `SERIAL`.
  | { ok: false; reason: "cycle_introuvable" }
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
  /// Vélo désigné à C5, `null` pour « Aucun vélo ».
  cycleId: number | null;
}): Promise<CreationIntervention> {
  try {
    return await db.$transaction(async (tx) => {
      // ⚠️ **En TÊTE de transaction, et la position est le point.** Rendre une
      // valeur depuis le callback de `$transaction` **commite** - c'est ce que
      // la sentinelle `VenteRefusee` plus bas existe pour contourner. Ici il n'y
      // a rien à annuler : aucune écriture n'a encore eu lieu, donc un retour
      // sec suffit.
      //
      // ⚠️ La borne haute n'est PAS la création de l'adresse mais l'appel à
      // `resoudreCommune` juste dessous, qui fait un `upsert` sur `cities` :
      // descendre la garde d'un seul cran commiterait une commune neuve à
      // chaque identifiant sondé.
      //
      // La FK garantit que le vélo existe, pas qu'il est à l'appelant : sans
      // cette lecture, un identifiant forgé rattacherait le vélo d'un tiers au
      // rendez-vous. Même garde et même refus unique que
      // `rattacherCycleAIntervention`.
      if (params.cycleId !== null) {
        const cycle = await tx.cycle.findFirst({
          where: { id: params.cycleId, userId: params.clientId },
          select: { id: true },
        });

        if (!cycle) {
          return { ok: false as const, reason: "cycle_introuvable" as const };
        }
      }

      // L'adresse naît DANS la transaction de la réservation. Si la contrainte
      // anti-double-réservation rejette l'intervention, elle disparaît avec
      // elle - sinon chaque course perdue laisserait une adresse orpheline.
      const cityId = await resoudreCommune(
        { postcode: params.adresse.postcode, city: params.adresse.city },
        tx,
      );

      // Réutiliser l'adresse déjà connue plutôt qu'en créer une par
      // réservation : le libellé vient de la BAN, donc il est canonique. Sans
      // ce filtre, un client fidèle accumule des lignes indiscernables dans son
      // sélecteur.
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
          // ⚠️ **Le tunnel écrit `cycle_id`**, contre [[mcd-dictionnaire]] v2.4
          // qui le disait réservé au panneau de `/mes-interventions`. Écart à
          // verser au write-back. La colonne reste NULLable et le choix
          // facultatif : `null` est l'état nominal, pas une donnée manquante.
          //
          // Le vélo n'est **pas figé en instantané**, contrairement à
          // `price_snapshot` et `duration_snapshot` : c'est une référence
          // vivante vers `cycles`, comme au rattachement T+n.
          cycleId: params.cycleId,
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
  /// `payments.amount_snapshot` de la ligne de paiement, **seulement** quand
  /// elle est en `PAID` - `US-INTERVENTIONS-LISTER-CLIENT-PASSEES` §Cas nominal,
  /// « montant payé si `DONE` ». `null` partout ailleurs, et l'écran retombe
  /// alors sur `total`, qui est le montant de l'intervention et non un
  /// encaissement constaté.
  ///
  /// Trois cas rendent ce champ `null` sur une intervention réelle : les
  /// `PLANNED` et `IN_PROGRESS`, qui n'ont pas encore de paiement ; les
  /// `CANCELLED`, dont l'écran n'affiche de toute façon aucun chiffre ; et la
  /// ligne `UNPAID` du refus de paiement, qui porte 0 - l'afficher comme un
  /// « montant payé » dirait au client qu'il a réglé zéro euro, quand le fait
  /// est qu'il n'a pas réglé.
  montantPaye: string | null;
  /// Le vélo désigné par le client, `null` tant qu'aucun ne l'est - et c'est un
  /// état nominal, pas une donnée manquante : `cycle_id` est NULLable et le
  /// rattachement reste facultatif sur les deux surfaces qui l'écrivent, le
  /// tunnel (C5) et le panneau de l'espace client. Même forme que ce que lit
  /// l'écran T2 du technicien.
  ///
  /// ⚠️ **Référence vivante, pas instantané.** Contrairement à `price_snapshot`
  /// et `duration_snapshot`, ces trois valeurs sont relues dans `cycles` à
  /// chaque affichage : un client qui corrige la marque de son vélo change ce
  /// qu'affiche un rendez-vous **déjà passé**. Dérogation assumée à la doctrine
  /// du snapshot, qui porte sur ce qui est facturé (Constitution §4.1).
  ///
  /// `id` compris, contrairement à ce que lit l'écran T2 : le client **choisit**
  /// le vélo, et un sélecteur doit savoir lequel est retenu. Le technicien, lui,
  /// ne fait que le lire.
  cycle: {
    id: number;
    brand: string;
    model: string | null;
    type: string;
  } | null;
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
  // Sans `year` : le panneau nomme le vélo, il ne le décrit pas. La fiche
  // complète est en C11.
  cycle: { select: { id: true, brand: true, model: true, type: true } },
  // Les identifiants seuls : le contenu passe par
  // `GET /api/intervention-photos/[id]`, jamais par un chemin de fichier rendu
  // au navigateur.
  photos: { select: { id: true }, orderBy: { id: "asc" } },
  // `status` accompagne le montant et n'est pas décoratif : la ligne `UNPAID`
  // du refus de paiement porte 0, et sans le discriminant elle se lirait
  // « payé 0,00 € ».
  //
  // ⚠️ Ni `recorded_by`, ni `paid_at`, ni `method` : rien de tout ça n'a de
  // lecteur sur l'écran du client, et l'identité du technicien qui a saisi est
  // une donnée d'exploitation.
  payment: { select: { amountSnapshot: true, status: true } },
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
    // `PAID` seul : voir le commentaire du champ. La comparaison est sur le
    // statut du PAIEMENT et non sur celui de l'intervention, les deux ne disant
    // pas la même chose - une `CANCELLED` peut porter une ligne `UNPAID`.
    montantPaye:
      ligne.payment?.status === "PAID"
        ? ligne.payment.amountSnapshot.toFixed(2)
        : null,
    cycle: ligne.cycle,
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

/// Fenêtre `appointment_at` d'un couple de jours civils, ancrée sur
/// `Europe/Paris`.
///
/// ⚠️ Les deux bornes sont des **jours civils** et non des `Date` : minuit UTC
/// n'est pas minuit à Paris, et un filtre « du 11 août » construit sur
/// `T00:00:00Z` écarte les rendez-vous du 11 entre 00 h et 02 h en été. Une
/// borne haute en « +24 h » perd ou duplique une heure les nuits de bascule.
/// `instantUtc` et `ajouterJours` sont le mécanisme unique de bornage du
/// module, partagé avec `listerTourneeDuJour`.
///
/// La borne haute reste **exclusive au lendemain** et non inclusive au jour
/// saisi : `<= le 11` écarterait toute la journée du 11, ce qui est faux pour
/// qui vient de saisir cette date comme fin de période.
function fenetreCivile(
  du: JourCivil | undefined,
  au: JourCivil | undefined,
): { appointmentAt?: { gte?: Date; lt?: Date } } {
  if (!du && !au) return {};

  return {
    appointmentAt: {
      ...(du ? { gte: instantUtc(du, 0) } : {}),
      ...(au ? { lt: instantUtc(ajouterJours(au, 1), 0) } : {}),
    },
  };
}

/// Onglet « Passées » - `US-INTERVENTIONS-LISTER-CLIENT-PASSEES`.
///
/// Le filtre par période est celui que l'US demande (« un filtre par période
/// (année, ou date début / fin) ») ; les filtres par statut et par technicien
/// de la maquette C10 n'y figurent pas et ne sont pas portés.
export async function listerInterventionsPassees(params: {
  clientId: string;
  du?: JourCivil;
  au?: JourCivil;
  page?: number;
}): Promise<PagePassees> {
  // ⚠️ Le numéro vient de l'URL, donc de n'importe qui, et les trois gardes
  // couvrent trois formes distinctes. Sans `Math.trunc`, `?page=2.3` donne un
  // `skip` flottant que Prisma refuse (500) et un `cible === page` jamais vrai,
  // donc plus aucun `aria-current` (RGAA A) ; sans le plancher, le négatif
  // passe ; sans `Number.isFinite`, `NaN` et `Infinity` traversent `Math.max`.
  const demandee = params.page ?? 1;
  const page = Number.isFinite(demandee)
    ? Math.max(1, Math.trunc(demandee))
    : 1;

  const filtre = {
    clientId: params.clientId,
    status: { in: [...STATUTS_TERMINAUX] },
    ...fenetreCivile(params.du, params.au),
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

// ─────────────────────────────────────────────────────────────────────────
// Tournée du technicien - `US-INTERVENTIONS-LISTER-TECH-DU-JOUR` (T-V2-01).
// ─────────────────────────────────────────────────────────────────────────

/// Produit attaché, vu par le TECHNICIEN. Pas de prix, délibérément.
///
/// `ProduitAttache` (côté client) porte `unitPriceSnapshot` parce que le client
/// paie. La SPEC §Cas nominal n'énumère que « produits additionnels attachés »
/// sur les lignes de la tournée, et la maquette T1 n'affiche qu'un libellé et
/// un compte (« 1 produit : Pack usure standard »). Envoyer les montants au
/// navigateur du technicien serait une donnée de plus sans usage - le total lui
/// arrivera avec l'encaissement, en T-V2-03.
export type ProduitTournee = {
  productId: number;
  label: string;
  quantity: number;
};

/// Une ligne de la tournée.
///
/// ⚠️ **`appointmentAt` est une chaîne ISO, pas une `Date`.** Ce DTO traverse la
/// frontière serveur → client par DEUX chemins : `initialData` au rendu, puis le
/// retour de la Server Action à chaque rafraîchissement de 30 s. Les deux
/// doivent porter exactement la même forme, sinon le premier `refetch`
/// remplacerait des `Date` par autre chose et le formatage casserait après 30
/// secondes d'affichage correct - un défaut qui ne se voit pas en revue. Même
/// choix que `lister-creneaux.ts`, qui ne sort que des ISO.
export type InterventionTournee = {
  id: number;
  /// PLANNED | IN_PROGRESS | DONE | CANCELLED. Les quatre sont affichés.
  status: string;
  appointmentAt: string;
  durationSnapshot: number;
  forfait: string;
  /// ⚠️ **Nom COMPLET et téléphone, sans abréviation.** `abregerNom()` existe
  /// dans ce module et ne s'applique **pas** ici : il abrège le TECHNICIEN pour
  /// le client, au titre de la minimisation. Le symétrique masquerait le nom du
  /// client à la personne qui va sonner chez lui, alors que Constitution §1.1
  /// fait du technicien celui qui se déplace. La SPEC §Cas nominal écrit
  /// « client (nom **et** téléphone) ». Cadrage du plancher V2, D6 - la table
  /// §Écrans de TASKS écrivait la divergence à l'envers, et elle a été retirée.
  client: {
    nom: string;
    /// NULL sur un compte pseudonymisé (`users.phone` remis à NULL par le droit
    /// à l'oubli, `queries/users.ts:143`). La vue affiche une mention neutre :
    /// l'intervention survit à l'effacement de son client (Constitution §4.1,
    /// pas de FK cassée), donc la ligne existe et doit se rendre.
    telephone: string | null;
  };
  /// ⚠️ **Sans `label`**, contrairement à `InterventionClient` : c'est un
  /// libellé que le client rédige pour lui-même, qu'aucun composant de cet
  /// écran ne lit, et qui traverserait sans consommateur jusqu'au navigateur du
  /// technicien.
  adresse: {
    street: string;
    zipCode: string;
    city: string;
  };
  /// `null` quand l'adresse n'a pas de point, cas de la pseudonymisation :
  /// c'est ce qui garde la carte de poser un marqueur sans coordonnées.
  point: PointWgs84 | null;
  produits: ProduitTournee[];
};

/// Le `select` de la tournée. Distinct de `SELECTION_CLIENT` et pas une
/// variante : les deux écrans ne montrent ni les mêmes personnes ni les mêmes
/// champs. Celui-ci lit le CLIENT (l'autre lit le technicien), n'a besoin
/// d'aucun prix, et remonte `address.id` pour aller chercher le point GPS.
const SELECTION_TECH = {
  id: true,
  status: true,
  appointmentAt: true,
  durationSnapshot: true,
  service: { select: { label: true } },
  client: { select: { firstname: true, lastname: true, phone: true } },
  address: {
    // Pas de `label` : il n'a aucun lecteur sur cet écran, et ne pas le
    // SÉLECTIONNER est plus sûr que ne pas l'afficher.
    select: {
      id: true,
      street: true,
      city: { select: { zipCode: true, city: true } },
    },
  },
  products: {
    select: {
      productId: true,
      quantity: true,
      product: { select: { label: true } },
    },
    orderBy: { productId: "asc" },
  },
} satisfies Prisma.InterventionSelect;

type LigneTournee = Prisma.InterventionGetPayload<{
  select: typeof SELECTION_TECH;
}>;

function projeterTournee(
  ligne: LigneTournee,
  points: Map<number, PointWgs84>,
): InterventionTournee {
  return {
    id: ligne.id,
    status: ligne.status,
    appointmentAt: ligne.appointmentAt.toISOString(),
    durationSnapshot: ligne.durationSnapshot,
    forfait: ligne.service.label,
    client: {
      // Pas d'`abregerNom` - cf. le commentaire du type.
      nom: `${ligne.client.firstname} ${ligne.client.lastname}`,
      telephone: ligne.client.phone,
    },
    adresse: {
      street: ligne.address.street,
      zipCode: ligne.address.city.zipCode,
      city: ligne.address.city.city,
    },
    point: points.get(ligne.address.id) ?? null,
    produits: ligne.products.map((produit) => ({
      productId: produit.productId,
      label: produit.product.label,
      quantity: produit.quantity,
    })),
  };
}

/// Tournée d'un technicien pour une journée civile - l'écran **T1**.
///
/// ── La journée se borne en heure locale, jamais en UTC construit à la main
///
/// `jour` est une date CIVILE (`jourLocal(maintenant)`), pas un instant. Les
/// bornes s'obtiennent par `instantUtc`, qui ancre minuit dans
/// `Europe/Paris` et gère les deux nuits de bascule par une double passe. La
/// borne haute passe par `ajouterJours(jour, 1)` et non par « +24 h » : les
/// deux nuits de changement d'heure durent 23 ou 25 heures, et une tournée
/// bornée en heures perdrait ou dupliquerait un rendez-vous ces jours-là.
///
/// ⚠️ La note de la SPEC qui renvoie à une clé `app_settings.timezone` est
/// fausse : cette clé n'existe pas, et PLAN S2 §T5 tranche le stockage
/// tout-UTC. Écart à verser au write-back.
///
/// ── Bornée par le JOUR, pas par le statut
///
/// ⚠️ **Aucun filtre de statut, et c'est la règle inverse de l'onglet « À
/// venir » du client** (`listerInterventionsAVenir`, qui retient `PLANNED` sans
/// borne de date). La SPEC §Cas nominal exige que « les statuts terminaux
/// (`DONE`, `CANCELLED`) restent affichés en fin de journée » pour la
/// traçabilité de la tournée. La symétrie apparente entre les deux écrans est
/// un piège : ne pas recopier le filtre du voisin.
///
/// L'index `@@index([techId, appointmentAt])` de la migration
/// `init_interventions` couvre ce filtre - il avait été posé pour la dérivation
/// des créneaux, et c'est exactement celui dont la tournée a besoin. Aucune
/// migration n'accompagne donc cette tâche.
export async function listerTourneeDuJour(params: {
  techId: string;
  jour: JourCivil;
}): Promise<InterventionTournee[]> {
  return lireTournee({
    techId: params.techId,
    debut: instantUtc(params.jour, 0),
    fin: instantUtc(ajouterJours(params.jour, 1), 0),
    ordre: "asc",
  });
}

/// Le corps partagé par la tournée du jour et par « À venir » : même `select`,
/// même projection, même cascade de points GPS. Seules les bornes, le tri et le
/// filtre de statut changent.
async function lireTournee(params: {
  techId: string;
  debut: Date;
  fin: Date;
  ordre: "asc" | "desc";
  statuts?: readonly string[];
}): Promise<InterventionTournee[]> {
  const lignes = await db.intervention.findMany({
    where: {
      techId: params.techId,
      appointmentAt: { gte: params.debut, lt: params.fin },
      ...(params.statuts ? { status: { in: [...params.statuts] } } : {}),
    },
    select: SELECTION_TECH,
    orderBy: { appointmentAt: params.ordre },
  });

  // Cascade assumée : les identifiants d'adresses n'existent qu'après la
  // lecture ci-dessus. Un seul aller-retour supplémentaire pour tout le lot,
  // pas un par ligne - la base est jointe par un tunnel SSH.
  const points = await lirePointsAdresses(
    lignes.map((ligne) => ligne.address.id),
  );

  return lignes.map((ligne) => projeterTournee(ligne, points));
}

/// Onglet « Cette semaine » - `US-INTERVENTIONS-LISTER-TECH-A-VENIR`.
///
/// ⚠️ Elle commence DEMAIN, pas maintenant.
///
/// L'US écrit « mes interventions des **jours suivants** (7 j / 30 j) », et
/// aujourd'hui a son propre onglet. Faire commencer la fenêtre à `NOW()` ferait
/// dire deux choses aux deux onglets sur les mêmes lignes, et un rendez-vous
/// changerait d'onglet en cours de journée sans que rien ne se soit passé.
///
/// ── `PLANNED` seul, et c'est la règle INVERSE de la tournée du jour
///
/// L'ancre de l'US le pose (`status = PLANNED`), et c'est le même filtre que
/// l'onglet « À venir » du client. La tournée du jour, elle, n'a **aucun**
/// filtre de statut parce que la SPEC exige que les terminaux restent visibles
/// en fin de journée pour la traçabilité. Les deux règles cohabitent dans ce
/// module, ne pas recopier celle du voisin.
///
/// ⚠️ Conséquence assumée : une intervention future **annulée** ne figure dans
/// aucune de ces deux vues et apparaît dans « Historique », qui retient les
/// statuts terminaux sans borne de date. Même régime que côté client.
export async function listerTourneeAVenir(params: {
  techId: string;
  /// Le jour courant. La fenêtre part du lendemain.
  aujourdhui: JourCivil;
  jours: FenetreJours;
}): Promise<InterventionTournee[]> {
  const demain = ajouterJours(params.aujourdhui, 1);

  return lireTournee({
    techId: params.techId,
    debut: instantUtc(demain, 0),
    // Jours **civils** et non « +N × 24 h » : les deux nuits de bascule durent
    // 23 ou 25 heures, et une fenêtre comptée en heures perdrait ou
    // dupliquerait un rendez-vous ces jours-là.
    fin: instantUtc(ajouterJours(demain, params.jours), 0),
    ordre: "asc",
    statuts: ["PLANNED"],
  });
}

export type PageHistoriqueTech = {
  interventions: InterventionTournee[];
  /// Nombre total de lignes du filtre courant, pas de la page.
  total: number;
  page: number;
  pages: number;
};

/// Onglet « Historique » - `US-INTERVENTIONS-LISTER-TECH-PASSEES`, promue en v1
/// le 2026-08-12.
///
/// Même modèle que `listerInterventionsPassees` côté client : statuts
/// terminaux, tri `appointment_at DESC`, pagination, filtre par période. Le
/// **filtre par statut** de l'US reste hors périmètre v1, comme côté client :
/// les deux seules valeurs possibles sont `DONE` et `CANCELLED`, que l'étiquette
/// de chaque ligne porte déjà.
///
/// La taille de page est celle du client (`TAILLE_PAGE_PASSEES`). Elle n'est
/// écrite dans aucun artefact, et deux valeurs différentes pour deux historiques
/// du même produit seraient une divergence sans motif.
export async function listerHistoriqueTech(params: {
  techId: string;
  du?: JourCivil;
  au?: JourCivil;
  page?: number;
}): Promise<PageHistoriqueTech> {
  // Même durcissement que côté client, et pour la même raison : le numéro vient
  // de l'URL. `?page=2.3` produit un `skip` fractionnaire que Prisma refuse.
  const demandee = params.page ?? 1;
  const page = Number.isFinite(demandee)
    ? Math.max(1, Math.trunc(demandee))
    : 1;

  const filtre = {
    techId: params.techId,
    status: { in: [...STATUTS_TERMINAUX] },
    ...fenetreCivile(params.du, params.au),
  };

  const [total, lignes] = await Promise.all([
    db.intervention.count({ where: filtre }),
    db.intervention.findMany({
      where: filtre,
      select: SELECTION_TECH,
      orderBy: { appointmentAt: "desc" },
      skip: (page - 1) * TAILLE_PAGE_PASSEES,
      take: TAILLE_PAGE_PASSEES,
    }),
  ]);

  const points = await lirePointsAdresses(
    lignes.map((ligne) => ligne.address.id),
  );

  return {
    interventions: lignes.map((ligne) => projeterTournee(ligne, points)),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / TAILLE_PAGE_PASSEES)),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Détail et démarrage - `US-INTERVENTION-AFFICHER` et
// `US-INTERVENTION-DEMARRER` (T-V2-02).
// ─────────────────────────────────────────────────────────────────────────

/// Produit attaché, vu sur le DÉTAIL. Il porte son prix, contrairement à
/// `ProduitTournee`.
///
/// ⚠️ Le technicien LIT les prix, et Constitution §3.1 n'y fait pas obstacle :
/// elle lui interdit de les **modifier**, jamais de les lire. C'est lui qui
/// encaisse ce total.
export type ProduitDetail = ProduitTournee & {
  /// Prix unitaire figé à la vente (Constitution §4.1), à deux décimales.
  unitPriceSnapshot: string;
};

/// Le détail d'une intervention, vu par son technicien - écran **T2**.
///
/// Sur-ensemble d'`InterventionTournee` : mêmes six éléments, plus l'email du
/// client, les prix, la description du forfait, le vélo, les photos, le
/// compte-rendu et l'instant de démarrage.
///
/// ⚠️ **`appointmentAt` et `startedAt` sont des `Date`, pas des chaînes ISO**,
/// à l'inverse d'`InterventionTournee`. Ce DTO ne traverse **aucune** frontière
/// de sérialisation : la page est un Server Component, il n'y a pas de Server
/// Action de lecture ni de `initialData` à réhydrater ici. La contrainte qui
/// impose l'ISO à la tournée (deux chemins, donc deux formes à tenir
/// identiques) n'existe pas sur cet écran.
export type InterventionDetail = {
  id: number;
  /// PLANNED | IN_PROGRESS | DONE | CANCELLED.
  status: string;
  appointmentAt: Date;
  /// Renseigné dès `IN_PROGRESS` (migration 008). C'est le jalon que le hub
  /// affiche quand il n'a plus d'action à proposer.
  startedAt: Date | null;
  durationSnapshot: number;
  /// Le forfait SEUL. `total` porte forfait plus produits.
  priceSnapshot: string;
  total: string;
  /// Motif de l'annulation, seul contenu utile d'une ligne `CANCELLED`.
  cancellationReason: string | null;
  forfait: { label: string; description: string | null };
  /// ⚠️ **Nom complet, téléphone ET email**, sans abréviation ni masquage.
  /// `US-INTERVENTION-AFFICHER` §Notes le justifie explicitement : « détail
  /// client sensible … accessibles au tech propriétaire de l'intervention
  /// uniquement. Justification métier terrain. » `abregerNom()` joue dans
  /// l'autre sens, il abrège le technicien POUR le client.
  client: {
    nom: string;
    /// NULL sur un compte pseudonymisé (droit à l'oubli, `queries/users.ts`).
    telephone: string | null;
    /// Jamais NULL : la pseudonymisation le remplace par une adresse
    /// synthétique plutôt que de le vider, la colonne étant NOT NULL et unique.
    email: string;
  };
  adresse: {
    street: string;
    zipCode: string;
    city: string;
  };
  /// `null` quand l'adresse n'a pas de point (pseudonymisation).
  point: PointWgs84 | null;
  /// `null` tant que rien ne renseigne `cycle_id`. Les deux états s'affichent
  /// (cadrage du plancher V2, D11) : deux surfaces l'écrivent depuis le
  /// 2026-08-16, le tunnel (C5) et le panneau de l'espace client, et le
  /// rattachement reste facultatif sur les deux.
  cycle: { brand: string; model: string | null; type: string } | null;
  produits: ProduitDetail[];
  /// Identifiants seuls : le contenu passe par
  /// `GET /api/intervention-photos/[id]`, dont la garde accepte désormais le
  /// technicien affecté.
  photos: { id: number; type: string }[];
  /// `interventions.tech_comment`. ⚠️ La SPEC écrit « commentaires horodatés »
  /// au pluriel : le modèle porte **une** colonne TEXT sans horodatage propre,
  /// et `intervention_comments` est une table prévue v2. Rien ne l'écrit en v1
  /// (`US-INTERVENTION-COMMENTAIRE-AJOUTER` est v2), le champ est donc lu et
  /// jamais muté ici. Divergence signalée pour write-back.
  ///
  /// `is_comment_public` n'est pas remonté : il gouverne la visibilité côté
  /// CLIENT, pas celle du technicien, qui voit son propre compte-rendu.
  techComment: string | null;
};

/// Le `select` du détail. Distinct des deux autres, et pas une variante : c'est
/// le seul qui lit l'email, les prix, le vélo et le compte-rendu.
const SELECTION_DETAIL = {
  id: true,
  status: true,
  appointmentAt: true,
  startedAt: true,
  durationSnapshot: true,
  priceSnapshot: true,
  cancellationReason: true,
  techComment: true,
  service: { select: { label: true, description: true } },
  client: {
    select: { firstname: true, lastname: true, phone: true, email: true },
  },
  address: {
    // Pas de `label` : c'est un mémo que le client rédige pour lui-même
    // (« Domicile », « Chez ma mère »), sans lecteur sur cet écran. Même
    // minimisation que `SELECTION_TECH`.
    select: {
      id: true,
      street: true,
      city: { select: { zipCode: true, city: true } },
    },
  },
  cycle: { select: { brand: true, model: true, type: true } },
  products: {
    select: {
      productId: true,
      quantity: true,
      unitPriceSnapshot: true,
      product: { select: { label: true } },
    },
    orderBy: { productId: "asc" },
  },
  photos: { select: { id: true, type: true }, orderBy: { id: "asc" } },
} satisfies Prisma.InterventionSelect;

type LigneDetail = Prisma.InterventionGetPayload<{
  select: typeof SELECTION_DETAIL;
}>;

function projeterDetail(
  ligne: LigneDetail,
  point: PointWgs84 | null,
): InterventionDetail {
  // Même formule que `projeter()` : `price_snapshot` du forfait plus la somme
  // des `unit_price_snapshot × quantité`. `Prisma.Decimal` et non un flottant,
  // c'est un montant qui sera encaissé.
  const total = ligne.products.reduce(
    (somme, produit) =>
      somme.plus(produit.unitPriceSnapshot.times(produit.quantity)),
    ligne.priceSnapshot,
  );

  return {
    id: ligne.id,
    status: ligne.status,
    appointmentAt: ligne.appointmentAt,
    startedAt: ligne.startedAt,
    durationSnapshot: ligne.durationSnapshot,
    priceSnapshot: ligne.priceSnapshot.toFixed(2),
    total: total.toFixed(2),
    cancellationReason: ligne.cancellationReason,
    forfait: {
      label: ligne.service.label,
      description: ligne.service.description,
    },
    client: {
      // Pas d'`abregerNom` - cf. le commentaire du type.
      nom: `${ligne.client.firstname} ${ligne.client.lastname}`,
      telephone: ligne.client.phone,
      email: ligne.client.email,
    },
    adresse: {
      street: ligne.address.street,
      zipCode: ligne.address.city.zipCode,
      city: ligne.address.city.city,
    },
    point,
    cycle: ligne.cycle,
    produits: ligne.products.map((produit) => ({
      productId: produit.productId,
      label: produit.product.label,
      quantity: produit.quantity,
      unitPriceSnapshot: produit.unitPriceSnapshot.toFixed(2),
    })),
    photos: ligne.photos,
    techComment: ligne.techComment,
  };
}

/// Le détail d'une intervention, **si elle appartient à ce technicien** -
/// `US-INTERVENTION-AFFICHER`, écran **T2**.
///
/// `techId` est dans la clause `where`, pas dans un `if` qui suivrait la
/// lecture : la garde de propriété est en base, elle ne peut donc pas être
/// contournée par une branche oubliée. Même geste que `chargerPhotoAutorisee`
/// et que les deux mutations produits.
///
/// ⚠️ **`null` couvre DEUX cas** que l'appelant ne doit pas distinguer :
/// l'intervention n'existe pas, ou elle est à un collègue. Cf. le commentaire
/// de la page sur le choix du 403 pour les deux.
export async function chargerInterventionDuTech(params: {
  interventionId: number;
  techId: string;
}): Promise<InterventionDetail | null> {
  const ligne = await db.intervention.findFirst({
    where: { id: params.interventionId, techId: params.techId },
    select: SELECTION_DETAIL,
  });

  if (!ligne) return null;

  // Cascade assumée, comme dans `lireTournee` : l'identifiant d'adresse n'existe
  // qu'après la lecture ci-dessus. Une seule ligne, donc un seul aller-retour.
  const points = await lirePointsAdresses([ligne.address.id]);

  return projeterDetail(ligne, points.get(ligne.address.id) ?? null);
}

/// Le statut depuis lequel on démarre, et le seul.
///
/// Constitution §2.4 : `PLANNED → IN_PROGRESS`, sans `CONFIRMED` en v1 (audit
/// F-06 du 2026-07-06, transition rendue directe). Les trois autres statuts
/// refusent - `IN_PROGRESS` parce que la transition est déjà consommée, `DONE`
/// et `CANCELLED` parce qu'ils sont terminaux.
const STATUT_DEMARRABLE = "PLANNED";

export type ResultatDemarrage =
  | { ok: true; startedAt: Date }
  /// Intervention inconnue **ou** appartenant à un collègue. Une seule réponse
  /// pour les deux, même régime que partout ailleurs dans ce module.
  | { ok: false; reason: "introuvable" }
  /// Statut autre que `PLANNED`. Le statut courant voyage avec le refus : c'est
  /// ce qui permet à l'appelant de dire « déjà démarrée » plutôt qu'un message
  /// générique, et c'est exactement l'information dont l'écran a besoin pour se
  /// remettre à jour.
  | { ok: false; reason: "transition_illegale"; statutCourant: string };

/// Passe une intervention planifiée en `IN_PROGRESS` -
/// `US-INTERVENTION-DEMARRER`. Le refus est **serveur et typé** ; le `409` que
/// la SPEC écrit n'a plus de référent depuis le pivot Next full-stack
/// (ADR-002 v2), les mutations rendant des unions discriminées.
///
/// ⚠️ **Le verrou n'est pas décoratif.** Deux démarrages concurrents
/// passeraient tous deux la lecture de statut sous READ COMMITTED et
/// écriraient DEUX entrées d'audit sur la même transition : le second `UPDATE`
/// est inoffensif, la trace ne l'est pas. Il est pris **après** la garde de
/// propriété, sans quoi un appelant qui incrémente des identifiants
/// verrouillerait le rendez-vous d'un tiers.
///
/// Effet de bord voulu : `IN_PROGRESS` ferme le panier du client,
/// `queries/produits.ts` et `queries/photos.ts` n'acceptant que `PLANNED`.
export async function demarrerInterventionDuTech(params: {
  interventionId: number;
  techId: string;
  maintenant: Date;
}): Promise<ResultatDemarrage> {
  return db.$transaction(async (tx) => {
    const intervention = await tx.intervention.findFirst({
      where: { id: params.interventionId, techId: params.techId },
      select: { status: true },
    });

    if (!intervention)
      return { ok: false as const, reason: "introuvable" as const };

    if (intervention.status !== STATUT_DEMARRABLE) {
      return {
        ok: false as const,
        reason: "transition_illegale" as const,
        statutCourant: intervention.status,
      };
    }

    await tx.$queryRaw`
      SELECT "id" FROM "interventions"
      WHERE "id" = ${params.interventionId}
      FOR UPDATE
    `;

    // Relu SOUS le verrou : la première lecture a servi aux gardes, celle-ci
    // décide. Entre les deux, une transaction voisine a pu commiter son propre
    // passage en `IN_PROGRESS`, ou une annulation par le client.
    const sousVerrou = await tx.intervention.findUniqueOrThrow({
      where: { id: params.interventionId },
      select: { status: true },
    });

    if (sousVerrou.status !== STATUT_DEMARRABLE) {
      return {
        ok: false as const,
        reason: "transition_illegale" as const,
        statutCourant: sousVerrou.status,
      };
    }

    await tx.intervention.update({
      where: { id: params.interventionId },
      data: { status: "IN_PROGRESS", startedAt: params.maintenant },
    });

    // Dans la transaction, comme toute trace qui accompagne une mutation : une
    // trace écrite à côté survit à un rollback, ou manque alors que l'écriture
    // a eu lieu (`src/lib/audit/log.ts`).
    //
    // ⚠️ Le champ s'appelle **`details`**, quand la SPEC écrit
    // `metadata.transition` : ce nom n'existe pas dans `AuditEntry`. Écart à
    // verser au write-back.
    await writeAuditLog(
      {
        entityType: "interventions",
        entityId: String(params.interventionId),
        action: "UPDATE",
        actorId: params.techId,
        details: {
          statutAvant: STATUT_DEMARRABLE,
          statutApres: "IN_PROGRESS",
        },
      },
      tx,
    );

    return { ok: true as const, startedAt: params.maintenant };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Annulation par le client - `US-INTERVENTION-ANNULER-CLIENT` (T-V3-11).
// ─────────────────────────────────────────────────────────────────────────

/// Ce que l'action a besoin de savoir pour notifier le technicien. Lu dans la
/// transaction, avec le reste : relire après coup rouvrirait la course.
export type AnnulationReussie = {
  ok: true;
  technicien: { email: string; firstname: string };
  appointmentAt: Date;
  durationSnapshot: number;
  forfait: string;
  adresse: string;
  motif: string;
};

export type ResultatAnnulation =
  | AnnulationReussie
  /// Intervention inconnue **ou** appartenant à quelqu'un d'autre : une seule
  /// réponse pour les deux. L'US §Cas d'erreur écrit 403 pour le
  /// non-propriétaire, mais `interventions.id` est un `SERIAL` : un refus
  /// distinct du « introuvable » confirmerait l'existence du rendez-vous d'un
  /// tiers à qui incrémente. Même régime que les deux mutations produits et que
  /// la route de lecture des photos.
  | { ok: false; reason: "introuvable" }
  /// Statut autre que `PLANNED` - déjà commencée, terminée, ou déjà annulée.
  | { ok: false; reason: "non_annulable" }
  /// Moins de 24 heures avant le rendez-vous. Passé ce délai, il n'existe
  /// **aucune** US v1 côté administration pour annuler à la place du client :
  /// SPEC §7.2 assume un traitement hors système, et interdit donc d'ouvrir ici
  /// une porte dérobée.
  | { ok: false; reason: "fenetre_depassee" };

/// Passe une intervention planifiée en `CANCELLED` -
/// `US-INTERVENTION-ANNULER-CLIENT`.
///
/// ── Le créneau se libère tout seul
///
/// Il n'y a **rien à réécrire** : le pool des disponibilités se dérive à la
/// volée (Constitution §2.1) et la contrainte `no_double_booking` de la
/// migration 010 filtre sur `status IN ('PLANNED','IN_PROGRESS')`. Une
/// intervention annulée sort des deux au même instant. Une table de créneaux
/// aurait ici une ligne à supprimer, et c'est précisément ce que le modèle
/// s'interdit.
///
/// ── Le verrou n'est pas décoratif
///
/// Deux annulations concurrentes de la même intervention passeraient toutes
/// les deux la lecture de statut sous READ COMMITTED, écriraient **deux**
/// entrées d'audit et enverraient **deux** emails au technicien. Le second
/// `UPDATE` est inoffensif, la trace ne l'est pas : `audit_logs` est la pièce
/// qu'on produit en cas de contestation. Même mécanisme que le quota de photos
/// et que le stock, et pris **après** la garde de propriété pour qu'un appelant
/// qui incrémente des identifiants ne verrouille pas le rendez-vous d'un tiers.
export async function annulerInterventionDuClient(params: {
  interventionId: number;
  clientId: string;
  motif: string;
  maintenant: Date;
}): Promise<ResultatAnnulation> {
  return db.$transaction(async (tx) => {
    const intervention = await tx.intervention.findFirst({
      where: { id: params.interventionId, clientId: params.clientId },
      select: {
        status: true,
        appointmentAt: true,
        durationSnapshot: true,
        service: { select: { label: true } },
        tech: { select: { email: true, firstname: true } },
        address: {
          select: {
            street: true,
            city: { select: { zipCode: true, city: true } },
          },
        },
      },
    });

    if (!intervention)
      return { ok: false as const, reason: "introuvable" as const };

    // `PLANNED` seul. `IN_PROGRESS → CANCELLED` existe au cycle de vie
    // (Constitution §2.4) mais appartient au technicien, en repli de refus de
    // paiement (`US-PAIEMENT-ENREGISTRER`) : l'ouvrir au client lui permettrait
    // d'annuler un rendez-vous pendant que le technicien est chez lui.
    if (intervention.status !== "PLANNED") {
      return { ok: false as const, reason: "non_annulable" as const };
    }

    if (!annulationOuverte(intervention.appointmentAt, params.maintenant)) {
      return { ok: false as const, reason: "fenetre_depassee" as const };
    }

    await tx.$queryRaw`
      SELECT "id" FROM "interventions"
      WHERE "id" = ${params.interventionId}
      FOR UPDATE
    `;

    // Relu SOUS le verrou : la première lecture a servi aux gardes, celle-ci
    // décide. Entre les deux, une transaction voisine a pu commiter son propre
    // passage en `CANCELLED`.
    const sousVerrou = await tx.intervention.findUniqueOrThrow({
      where: { id: params.interventionId },
      select: { status: true },
    });

    if (sousVerrou.status !== "PLANNED") {
      return { ok: false as const, reason: "non_annulable" as const };
    }

    await tx.intervention.update({
      where: { id: params.interventionId },
      data: { status: "CANCELLED", cancellationReason: params.motif },
    });

    // Dans la transaction, comme toute trace qui accompagne une mutation : une
    // trace écrite à côté survit à un rollback, ou manque alors que l'écriture
    // a eu lieu (`src/lib/audit/log.ts`).
    await writeAuditLog(
      {
        entityType: "interventions",
        entityId: String(params.interventionId),
        action: "UPDATE",
        actorId: params.clientId,
        details: {
          statutAvant: "PLANNED",
          statutApres: "CANCELLED",
          motif: params.motif,
        },
      },
      tx,
    );

    return {
      ok: true as const,
      technicien: intervention.tech,
      appointmentAt: intervention.appointmentAt,
      durationSnapshot: intervention.durationSnapshot,
      forfait: intervention.service.label,
      adresse: `${intervention.address.street}, ${intervention.address.city.zipCode} ${intervention.address.city.city}`,
      motif: params.motif,
    };
  });
}
