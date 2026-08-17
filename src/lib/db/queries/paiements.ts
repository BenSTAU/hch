import "server-only";

import { Prisma } from "@prisma/client";

import { writeAuditLog, type AuditEntry } from "@/lib/audit/log";
import { db } from "@/lib/db/client";
import type { MethodePaiement } from "@/lib/paiements/encaissement";

/// Accès aux paiements terrain - helpers métier, pas Server Actions.
///
/// Aucun `revalidatePath`, aucun `redirect` : ils jettent hors contexte Next et
/// rendraient ces fonctions intestables en isolation.
///
/// ── Pourquoi la clôture vit ici et pas dans `interventions.ts`
///
/// Elle mute pourtant `interventions` : statut, `completed_at`,
/// `cancellation_reason`. Mais c'est **le paiement qui clôt l'intervention**,
/// SPEC §Amendements A4 posant le couple `MARQUER-FAITE` ↔
/// `PAIEMENT-ENREGISTRER` comme indissociable. Scinder le geste en deux modules
/// casserait la transaction unique qui fait toute la propriété, et
/// `interventions.ts` est déjà à 1 343 lignes. Un domaine, un nom, partout
/// (CLAUDE.md §Folder structure).

/// Le seul statut depuis lequel on clôture.
///
/// Constitution §2.4 : `IN_PROGRESS → DONE` sur la branche nominale,
/// `IN_PROGRESS → CANCELLED` sur le refus de paiement. Les trois autres
/// refusent - `PLANNED` parce que l'intervention n'a pas commencé, `DONE` et
/// `CANCELLED` parce qu'ils sont terminaux.
const STATUT_CLOTURABLE = "IN_PROGRESS";

/// Ce que l'action a besoin de savoir pour notifier le client. Lu dans la
/// transaction, avec le reste : relire après coup rouvrirait la course.
export type ClotureEncaissee = {
  ok: true;
  issue: "encaisse";
  client: { email: string; firstname: string };
  appointmentAt: Date;
  forfait: string;
  /// Chaîne à deux décimales, telle qu'elle a été écrite en base.
  montant: string;
  methode: MethodePaiement;
};

export type ClotureRefusee = {
  ok: true;
  issue: "refuse";
};

export type ResultatCloture =
  | ClotureEncaissee
  | ClotureRefusee
  /// Intervention inconnue **ou** appartenant à un collègue. Une seule réponse
  /// pour les deux, même régime que `demarrerInterventionDuTech`.
  | { ok: false; reason: "introuvable" }
  /// Statut autre qu'`IN_PROGRESS`. Le statut courant voyage avec le refus :
  /// c'est ce qui permet à l'écran de dire « pas encore démarrée » plutôt que
  /// « déjà clôturée », deux situations que le technicien ne corrige pas de la
  /// même façon.
  | { ok: false; reason: "transition_illegale"; statutCourant: string };

/// Ce que l'appelant demande. Union discriminée, image de celle du schéma Zod.
export type DemandeCloture =
  | { issue: "encaisse"; montant: string; methode: MethodePaiement }
  | { issue: "refuse"; motif: string };

/// Clôture une intervention en cours et enregistre l'encaissement déclaré -
/// `US-INTERVENTION-MARQUER-FAITE` et `US-PAIEMENT-ENREGISTRER`.
///
/// ── Une seule transaction, et c'est la propriété centrale de la tâche
///
/// SPEC §Amendements A4 : *« une intervention `DONE` sans ligne de paiement, ou
/// l'inverse, est un état incohérent »*. Les deux écritures et la trace d'audit
/// partagent donc la transaction. Un échec sur l'une n'en laisse aucune.
///
/// ── Le refus est typé, il n'est pas un code HTTP
///
/// Même raison que sur le démarrage : la SPEC écrit un `409` hérité d'une
/// rédaction antérieure au pivot Next full-stack (ADR-002 v2). L'exigence
/// réelle - un refus **serveur** et **typé**, hors de l'UI - est tenue.
///
/// ── Le verrou n'est pas décoratif
///
/// Deux clôtures concurrentes passeraient toutes les deux la lecture de statut
/// sous READ COMMITTED. La seconde insertion de `payments` échouerait sur
/// l'unicité d'`intervention_id`, ce qui remonterait au technicien en erreur
/// serveur opaque plutôt qu'en refus métier lisible - et sur la branche de
/// refus, où rien n'échouerait, `audit_logs` daterait deux fois une clôture
/// unique. Le verrou est pris **après** la garde de propriété, jamais avant :
/// un appelant qui incrémente des identifiants ne doit pas pouvoir verrouiller
/// le rendez-vous d'un tiers.
///
/// ⚠️ **Aucun contrôle de photo attachée**, alors que les deux US l'exigent au
/// titre de Constitution §2.5. L'étape photo du tunnel étant facultative, le
/// poser rendrait la clôture impossible sur toute intervention sans photo
/// client. Écart assumé, à refermer avec le dépôt côté technicien.
export async function cloturerInterventionDuTech(params: {
  interventionId: number;
  techId: string;
  maintenant: Date;
  demande: DemandeCloture;
}): Promise<ResultatCloture> {
  return db.$transaction(async (tx) => {
    const intervention = await tx.intervention.findFirst({
      where: { id: params.interventionId, techId: params.techId },
      select: {
        status: true,
        appointmentAt: true,
        service: { select: { label: true } },
        client: { select: { email: true, firstname: true } },
      },
    });

    if (!intervention)
      return { ok: false as const, reason: "introuvable" as const };

    if (intervention.status !== STATUT_CLOTURABLE) {
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
    // décide. Entre les deux, une transaction voisine a pu commiter sa propre
    // clôture.
    const sousVerrou = await tx.intervention.findUniqueOrThrow({
      where: { id: params.interventionId },
      select: { status: true },
    });

    if (sousVerrou.status !== STATUT_CLOTURABLE) {
      return {
        ok: false as const,
        reason: "transition_illegale" as const,
        statutCourant: sousVerrou.status,
      };
    }

    if (params.demande.issue === "refuse") {
      // Branche de refus - `US-PAIEMENT-ENREGISTRER` §Fallback client refuse de
      // payer. L'intervention passe à `CANCELLED` et **pas** à `DONE` : le
      // travail a eu lieu, mais le dossier ne peut pas se clore sur un
      // encaissement qui n'existe pas.
      await tx.payment.create({
        data: {
          interventionId: params.interventionId,
          // Les trois valeurs que le dictionnaire §payments impose ensemble :
          // `UNPAID` implique `method=NULL` + `paid_at=NULL` + montant à 0.
          amountSnapshot: new Prisma.Decimal(0),
          method: null,
          status: "UNPAID",
          paidAt: null,
          recordedBy: params.techId,
        },
      });

      await tx.intervention.update({
        where: { id: params.interventionId },
        data: {
          status: "CANCELLED",
          cancellationReason: params.demande.motif,
          // `completed_at` reste NULL : une intervention annulée n'est pas une
          // intervention complétée, et `annulerInterventionDuClient` fait déjà
          // ainsi.
        },
      });

      await writeAuditLog(
        auditCloture({
          interventionId: params.interventionId,
          techId: params.techId,
          statutApres: "CANCELLED",
          details: {
            paiement: "UNPAID",
            motif: params.demande.motif,
          },
        }),
        tx,
      );

      return { ok: true as const, issue: "refuse" as const };
    }

    // Branche nominale - `US-PAIEMENT-ENREGISTRER` §Cas nominal.
    //
    // `Prisma.Decimal` construit sur la CHAÎNE canonique et jamais sur un
    // `number` : `85.10` n'a pas de représentation binaire exacte, et c'est un
    // montant qui sera relu par le client sur son écran des passées.
    const montant = new Prisma.Decimal(params.demande.montant);

    await tx.payment.create({
      data: {
        interventionId: params.interventionId,
        amountSnapshot: montant,
        method: params.demande.methode,
        status: "PAID",
        // L'instant vient du paramètre, fixé une fois par l'action : le lire
        // ici daterait le paiement et la clôture sur deux valeurs.
        paidAt: params.maintenant,
        recordedBy: params.techId,
      },
    });

    await tx.intervention.update({
      where: { id: params.interventionId },
      data: { status: "DONE", completedAt: params.maintenant },
    });

    await writeAuditLog(
      auditCloture({
        interventionId: params.interventionId,
        techId: params.techId,
        statutApres: "DONE",
        details: {
          paiement: "PAID",
          montant: montant.toFixed(2),
          methode: params.demande.methode,
        },
      }),
      tx,
    );

    return {
      ok: true as const,
      issue: "encaisse" as const,
      client: intervention.client,
      appointmentAt: intervention.appointmentAt,
      forfait: intervention.service.label,
      montant: montant.toFixed(2),
      methode: params.demande.methode,
    };
  });
}

/// La trace des deux branches, à un champ près.
///
/// ⚠️ Le champ s'appelle **`details`**. `US-INTERVENTION-DEMARRER` écrit
/// `metadata.transition`, nom qui n'existe pas dans `AuditEntry` - troisième
/// occurrence de l'erreur dans la SPEC, déjà corrigée deux fois par la PR #39.
///
/// Écrite par `writeAuditLog` **dans** la transaction, comme toute trace qui
/// accompagne une mutation : une trace posée à côté survit à un rollback, ou
/// manque alors que l'écriture a eu lieu (`src/lib/audit/log.ts`).
function auditCloture(params: {
  interventionId: number;
  techId: string;
  statutApres: "DONE" | "CANCELLED";
  details: Prisma.InputJsonObject;
}): AuditEntry {
  return {
    entityType: "interventions",
    entityId: String(params.interventionId),
    action: "UPDATE",
    actorId: params.techId,
    details: {
      statutAvant: STATUT_CLOTURABLE,
      statutApres: params.statutApres,
      ...params.details,
    },
  };
}
