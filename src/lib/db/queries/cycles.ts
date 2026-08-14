import "server-only";

import { db } from "@/lib/db/client";
import type { ChampsCycleInput } from "@/lib/validations/cycles";

/// Lectures et écritures du domaine `cycles` - `US-CYCLES-LISTER`,
/// `US-CYCLE-AJOUTER`, `US-CYCLE-MODIFIER`, plus le rattachement à une
/// intervention promu en v1 le 2026-08-12.
///
/// ── Aucun audit, et c'est une décision écrite
///
/// Constitution §4.2 ne raisonne pas par table mais par **nature de l'acte** :
/// elle vise « toute action administrative sensible » et énumère suppressions,
/// modifications tarifaires, anonymisations, configuration société. Les
/// transitions d'état d'une intervention sont tracées par un autre ancrage,
/// §2.4 et son cycle de vie gardé.
///
/// Ni le CRUD des cycles ni le rattachement ne relèvent de l'un ou de l'autre :
/// un client renseigne sa propre possession, et désigner un vélo ne franchit
/// aucune transition. C'est la règle qui explique les deux précédents du dépôt
/// sans les contredire - `annulerInterventionDuClient` audite parce qu'elle
/// transitionne, `ajouterProduitIntervention` n'audite pas bien qu'elle écrive
/// sur la même intervention. Arbitré par Benjamin le 2026-08-14 (L6).

/// Le vélo tel qu'il traverse vers l'écran. Les six colonnes moins `user_id` :
/// le propriétaire est celui de la session, le renvoyer n'apprendrait rien au
/// navigateur et ferait voyager un UUID de plus.
export type CycleClient = {
  id: number;
  brand: string;
  model: string | null;
  type: string;
  year: number | null;
};

const SELECTION_CYCLE = {
  id: true,
  brand: true,
  model: true,
  type: true,
  year: true,
} as const;

/// Liste des vélos du client - `US-CYCLES-LISTER`.
///
/// ⚠️ **Tri par `id DESC`, pas par `created_at DESC`.** L'US écrit le second, et
/// la colonne **n'existe pas** : le dictionnaire §cycles porte six colonnes et
/// aucun horodatage. `id` est un `SERIAL`, donc monotone, donc « le plus
/// récemment ajouté en tête » est exactement le même ordre pour un coût nul,
/// là où la colonne se paierait en migration neuve sur le sprint le plus
/// contraint. Arbitré par Benjamin le 2026-08-14 (B1), les deux US sont
/// amendées au même geste - le code ne diverge pas en silence.
export async function listerCyclesDuClient(params: {
  userId: string;
}): Promise<CycleClient[]> {
  return db.cycle.findMany({
    where: { userId: params.userId },
    select: SELECTION_CYCLE,
    orderBy: { id: "desc" },
  });
}

/// Ajout - `US-CYCLE-AJOUTER`.
///
/// Aucun résultat en union ici : il n'y a rien à refuser qui ne soit déjà
/// refusé par le schéma Zod ou par la session. Le propriétaire vient du
/// contexte de l'action.
export async function creerCycle(
  params: ChampsCycleInput & { userId: string },
): Promise<CycleClient> {
  return db.cycle.create({
    data: {
      brand: params.brand,
      model: params.model,
      type: params.type,
      year: params.year,
      userId: params.userId,
    },
    select: SELECTION_CYCLE,
  });
}

/// Refus des mutations qui ciblent un vélo par son identifiant.
///
/// ⚠️ **Un seul motif pour deux cas.** `US-CYCLE-MODIFIER` §Cas d'erreur écrit
/// **403** pour le vélo d'autrui et **404 « Cycle introuvable »** pour
/// l'inexistant : c'est exactement la distinction qui révèle l'existence, et le
/// 403 fuit par lui-même puisque répondre « interdit » sur le vélo d'un tiers
/// confirme qu'il y en a un. `cycles.id` est un `SERIAL`, donc énumérable, et la
/// surface est **client**. La doctrine applicable est celle des mutations
/// produits et de l'annulation : *introuvable* dans les deux cas. Arbitré par
/// Benjamin le 2026-08-14 (B2), les deux US sont amendées.
export type ResultatCycle =
  { ok: true; cycle: CycleClient } | { ok: false; reason: "introuvable" };

/// Modification - `US-CYCLE-MODIFIER`.
///
/// `updateMany` filtré sur le **couple** `(id, userId)` et non `update` sur la
/// clé primaire : la propriété fait partie de la clause `WHERE`, donc une
/// modification du vélo d'autrui ne trouve aucune ligne au lieu d'écrire puis
/// d'être rattrapée. `count === 0` couvre les deux cas d'un seul refus.
export async function modifierCycleDuClient(
  params: ChampsCycleInput & { cycleId: number; userId: string },
): Promise<ResultatCycle> {
  const donnees = {
    brand: params.brand,
    model: params.model,
    type: params.type,
    year: params.year,
  };

  const { count } = await db.cycle.updateMany({
    where: { id: params.cycleId, userId: params.userId },
    data: donnees,
  });

  if (count === 0) return { ok: false, reason: "introuvable" };

  return { ok: true, cycle: { id: params.cycleId, ...donnees } };
}

/// Le seul statut qui accepte un rattachement.
///
/// Même frontière que le verrou des mutations produits (`STATUT_MODIFIABLE` de
/// `queries/produits.ts`) et que l'annulation : une intervention en cours, faite
/// ou annulée ne change plus de vélo.
const STATUT_RATTACHABLE = "PLANNED";

export type ResultatRattachement =
  | { ok: true }
  | { ok: false; reason: "introuvable" }
  | { ok: false; reason: "verrouillee" }
  | { ok: false; reason: "cycle_introuvable" };

/// Rattachement d'un vélo à une intervention - **premier et seul écrivain de
/// `interventions.cycle_id` en v1**.
///
/// Les trois gardes vivent ici et non dans l'action : elles décident d'une
/// écriture, elles appartiennent donc à la transaction qui l'exécute.
///
/// `cycleId: null` détache. Le vélo n'est **pas figé en instantané**,
/// contrairement au prix et à la durée : la colonne est une référence vivante
/// vers `cycles`, le dictionnaire ne demande aucun `snapshot` ici, et un client
/// qui corrige la marque de son vélo corrige aussi ce que le technicien lira -
/// y compris sur un rendez-vous déjà passé. Dérogation assumée à la doctrine du
/// snapshot (Constitution §4.1), qui porte sur ce qui est facturé.
export async function rattacherCycleAIntervention(params: {
  interventionId: number;
  cycleId: number | null;
  clientId: string;
}): Promise<ResultatRattachement> {
  return db.$transaction(async (tx) => {
    // La propriété est dans le `WHERE` : l'intervention d'un tiers ne se
    // distingue pas d'une intervention inexistante.
    const intervention = await tx.intervention.findFirst({
      where: { id: params.interventionId, clientId: params.clientId },
      select: { status: true },
    });

    if (!intervention)
      return { ok: false as const, reason: "introuvable" as const };

    if (intervention.status !== STATUT_RATTACHABLE) {
      return { ok: false as const, reason: "verrouillee" as const };
    }

    // Le vélo appartient au même client. Sans cette vérification, la FK
    // accepterait le vélo d'un tiers : la base garantit qu'il existe, pas qu'il
    // est à l'appelant. Un refus distinct de celui de l'intervention, parce que
    // les deux entrées sont distinctes et que le client doit savoir laquelle
    // l'écran n'a pas retrouvée - les deux étant les siennes.
    if (params.cycleId !== null) {
      const cycle = await tx.cycle.findFirst({
        where: { id: params.cycleId, userId: params.clientId },
        select: { id: true },
      });

      if (!cycle) {
        return { ok: false as const, reason: "cycle_introuvable" as const };
      }
    }

    // ⚠️ **Le statut est REJOUÉ dans le `WHERE` de l'écriture**, et ce n'est pas
    // une redite de la garde ci-dessus. Entre la lecture et l'écriture, un
    // `demarrerInterventionDuTech` concurrent peut faire passer la ligne en
    // `IN_PROGRESS` : sous READ COMMITTED, l'`update` l'écraserait quand même.
    // `updateMany` porte la condition dans la requête, donc l'écriture est
    // atomique et `count === 0` dit qu'on a perdu la course.
    //
    // La lecture au-dessus reste nécessaire : c'est elle qui distingue
    // « introuvable » de « verrouillee », qu'un `count` seul confondrait.
    //
    // Fenêtre relevée par l'agent testeur (C5). `produits.ts` porte la même et
    // n'est PAS corrigée ici : elle écrit plusieurs lignes sous un verrou de
    // stock, la refermer demande un autre geste que celui-ci.
    const { count } = await tx.intervention.updateMany({
      where: {
        id: params.interventionId,
        clientId: params.clientId,
        status: STATUT_RATTACHABLE,
      },
      data: { cycleId: params.cycleId },
    });

    if (count === 0) {
      return { ok: false as const, reason: "verrouillee" as const };
    }

    return { ok: true as const };
  });
}
