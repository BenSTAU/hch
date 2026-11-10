import "server-only";

import type { Prisma } from "@prisma/client";
import { cache } from "react";

import { champsModifies, detailsAudit, diffChamps } from "@/lib/audit/diff";
import { writeAuditLog } from "@/lib/audit/log";
import { db } from "@/lib/db/client";
import { empreinteFiche } from "@/lib/db/empreinte";
import { PRISMA_UNIQUE_VIOLATION, isPrismaError } from "@/lib/db/prisma-error";
import type { SensTriForfaits, TriForfaits } from "@/lib/validations/forfaits";

/// Lecture publique du catalogue des forfaits - `US-FORFAIT-CONSULTER`.
///
/// ⚠️ Domaine `forfaits` mais modèle Prisma `Service` : c'est la seule couture
/// entre les deux vocabulaires, ici et nulle part ailleurs.

/// DTO et non l'entité Prisma : `price` est un `Decimal` de decimal.js, non
/// sérialisable vers un composant client, et un `select` élargi ferait fuir
/// `isActive` vers la vue publique.
export type ForfaitPublic = {
  id: number;
  label: string;
  description: string | null;
  /// En minutes ([[mcd-dictionnaire]] §services).
  duration: number;
  /// Chaîne à deux décimales, jamais un `number` : un DECIMAL(10,2) qui passe
  /// par un flottant binaire perd ses centimes. C'est elle qui sera figée en
  /// `price_snapshot` à la réservation (Constitution §4.1).
  price: string;
};

/// `cache()` de React : le layout public et la page appellent tous deux cette
/// lecture dans le même rendu. Sans lui, deux requêtes identiques par visite,
/// sur une base jointe par tunnel SSH.
export const listForfaitsPublics = cache(async (): Promise<ForfaitPublic[]> => {
  const forfaits = await db.service.findMany({
    // La vue publique MASQUE les forfaits inactifs, là où la vue admin les
    // grise. Deux règles opposées sur la même table : le filtre appartient à
    // la requête, sinon la prochaine surface héritera du mauvais défaut.
    where: { isActive: true },
    select: {
      id: true,
      label: true,
      description: true,
      duration: true,
      price: true,
    },
    // Prix croissant, `id` départageant : un ordre dépendant de l'insertion
    // rendrait le test E2E instable au premier seed rejoué.
    orderBy: [{ price: "asc" }, { id: "asc" }],
  });

  return forfaits.map((forfait) => ({
    ...forfait,
    // `toFixed(2)` et non `toString()` : Prisma normalise `85.00` en `85`.
    price: forfait.price.toFixed(2),
  }));
});

// ─────────────────────────────────────────────────────────────────────────
// Vue d'administration - `US-FORFAIT-LISTER`, `-AJOUTER`, `-MODIFIER`
// ─────────────────────────────────────────────────────────────────────────

/// DTO d'administration. Deux champs que la vue publique n'a pas : `isActive`,
/// qu'elle n'a pas le droit de connaître, et `version`, le jeton qui permet de
/// refuser un enregistrement portant sur une fiche périmée.
export type ForfaitAdmin = {
  id: number;
  label: string;
  description: string | null;
  duration: number;
  /// Chaîne à deux décimales, même motif que `ForfaitPublic`.
  price: string;
  isActive: boolean;
  /// Opaque. Voir `src/lib/db/empreinte.ts`.
  version: string;
};

/// Les champs qu'un administrateur saisit.
export type ChampsForfait = {
  label: string;
  description: string | null;
  duration: number;
  price: string;
  isActive: boolean;
};

/// À la création, la disponibilité n'est pas saisie : `US-FORFAIT-AJOUTER` ne
/// l'énumère pas et la pose en défaut. Le type le dit, plutôt que de laisser
/// l'appelant fournir une valeur que la SPEC ne lui demande pas.
export type ChampsCreationForfait = Omit<ChampsForfait, "isActive">;

const SELECTION_ADMIN = {
  id: true,
  label: true,
  description: true,
  duration: true,
  price: true,
  isActive: true,
} satisfies Prisma.ServiceSelect;

type LigneForfait = {
  id: number;
  label: string;
  description: string | null;
  duration: number;
  price: Prisma.Decimal;
  isActive: boolean;
};

/// La **seule** fabrique du DTO admin, et c'est une propriété : l'empreinte
/// envoyée au formulaire et celle recalculée à l'enregistrement doivent porter
/// sur des valeurs normalisées de la même façon. Deux conversions écrites
/// séparément divergeraient au premier prix à une décimale, et tout
/// enregistrement serait refusé sans cause visible.
function versAdmin(ligne: LigneForfait): ForfaitAdmin {
  const price = ligne.price.toFixed(2);

  return {
    id: ligne.id,
    label: ligne.label,
    description: ligne.description,
    duration: ligne.duration,
    price,
    isActive: ligne.isActive,
    version: empreinteFiche([
      ligne.label,
      ligne.description,
      ligne.duration,
      price,
      ligne.isActive,
    ]),
  };
}

export const TAILLE_PAGE_FORFAITS = 10;

export type PageForfaits = {
  forfaits: ForfaitAdmin[];
  page: number;
  pages: number;
  total: number;
};

/// Liste paginée du back-office, **inactifs inclus**.
export async function listForfaitsAdmin(params: {
  page: number;
  tri: TriForfaits;
  sens: SensTriForfaits;
}): Promise<PageForfaits> {
  const total = await db.service.count();
  const pages = Math.max(1, Math.ceil(total / TAILLE_PAGE_FORFAITS));
  // L'URL s'édite à la main : une page 99 est ramenée dans les bornes plutôt
  // que rendue vide, ce qui ferait croire à un catalogue vide.
  const page = Math.min(Math.max(1, params.page), pages);

  const lignes = await db.service.findMany({
    select: SELECTION_ADMIN,
    // `id` départage : sans lui, deux forfaits de même prix changeraient de
    // place d'une page à l'autre, et la pagination perdrait des lignes.
    orderBy: [{ [params.tri]: params.sens }, { id: "asc" }],
    skip: (page - 1) * TAILLE_PAGE_FORFAITS,
    take: TAILLE_PAGE_FORFAITS,
  });

  return { forfaits: lignes.map(versAdmin), page, pages, total };
}

export async function lireForfaitAdmin(
  id: number,
): Promise<ForfaitAdmin | null> {
  const ligne = await db.service.findUnique({
    where: { id },
    select: SELECTION_ADMIN,
  });

  return ligne ? versAdmin(ligne) : null;
}

/// Compteurs de l'en-tête de l'écran, maquette A3.
export type SyntheseForfaits = {
  actifs: number;
  inactifs: number;
  /// `null` quand aucun forfait n'est actif : une moyenne sur zéro ligne n'est
  /// pas « 0,00 € », elle n'existe pas.
  prixMoyen: string | null;
};

export async function lireSyntheseForfaits(): Promise<SyntheseForfaits> {
  const [actifs, inactifs, agregat] = await Promise.all([
    db.service.count({ where: { isActive: true } }),
    db.service.count({ where: { isActive: false } }),
    // Moyenne sur les ACTIFS seuls : y inclure des forfaits retirés de la
    // vente décrirait un catalogue qu'on ne propose plus.
    db.service.aggregate({ where: { isActive: true }, _avg: { price: true } }),
  ]);

  return {
    actifs,
    inactifs,
    prixMoyen: agregat._avg.price?.toFixed(2) ?? null,
  };
}

export type ResultatCreationForfait =
  { ok: true; id: number; label: string } | { ok: false; reason: "nom_pris" };

export type ResultatModificationForfait =
  | { ok: true; label: string; changements: string[] }
  | { ok: false; reason: "introuvable" | "perime" | "nom_pris" };

/// ⚠️ **Aucun contrôle applicatif du nom avant d'écrire**, délibérément : deux
/// créations concurrentes du même nom liraient toutes deux « aucun homonyme »,
/// et on ne peut pas verrouiller une ligne qui n'existe pas encore. Le filet
/// est l'index partiel `services_label_active_key` (migration 017).
class NomDejaPris extends Error {
  constructor() {
    super("Un forfait actif porte déjà ce nom");
    this.name = "NomDejaPris";
  }
}

/// Enveloppe **la seule écriture sur `services`**, et pas la transaction
/// entière. Un `catch` posé autour du `$transaction` prendrait aussi un P2002
/// levé par `service_price_history` ou `audit_logs`, et rendrait « ce nom
/// existe déjà » pour un conflit sans rapport. Ces deux tables n'en portent
/// aucun aujourd'hui, mais ce patron part vers `products`, `zones` et `users`,
/// qui en porteront. Relevé par l'agent testeur (B1).
async function ecritureNommee<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (erreur) {
    if (isPrismaError(erreur, PRISMA_UNIQUE_VIOLATION)) throw new NomDejaPris();
    throw erreur;
  }
}

function traduireNomPris<T>(erreur: unknown, refus: T): T {
  if (erreur instanceof NomDejaPris) return refus;
  throw erreur;
}

/// Ajout - `US-FORFAIT-AJOUTER`.
///
/// ⚠️ **Aucune ligne `service_price_history` à la création**, amendement SPEC
/// du 2026-10-16 : `old_price` est NOT NULL, et l'historique n'enregistre que
/// des changements. La naissance du forfait est tracée par l'audit `CREATE`.
export async function creerForfait(
  champs: ChampsCreationForfait,
  actorId: string,
): Promise<ResultatCreationForfait> {
  // `isActive` écrit explicitement et non laissé au défaut de colonne : c'est
  // la SPEC qui fixe cette valeur, et l'audit `CREATE` doit la porter plutôt
  // que de laisser relire le DDL pour savoir avec quoi la fiche est née.
  const donnees = { ...champs, isActive: true };

  try {
    return await db.$transaction(async (tx) => {
      const forfait = await ecritureNommee(
        tx.service.create({ data: donnees, select: { id: true, label: true } }),
      );

      await writeAuditLog(
        {
          entityType: "services",
          entityId: String(forfait.id),
          action: "CREATE",
          actorId,
          // `before: null` partout, même forme que l'`UPDATE` : une relecture
          // du journal n'a ainsi qu'un seul gabarit à connaître.
          details: detailsAudit({
            label: { before: null, after: champs.label },
            description: { before: null, after: champs.description },
            duration: { before: null, after: champs.duration },
            price: { before: null, after: champs.price },
            isActive: { before: null, after: donnees.isActive },
          }),
        },
        tx,
      );

      return { ok: true as const, id: forfait.id, label: forfait.label };
    });
  } catch (erreur) {
    return traduireNomPris(erreur, {
      ok: false as const,
      reason: "nom_pris" as const,
    });
  }
}

/// Modification - `US-FORFAIT-MODIFIER`, désactivation et réactivation
/// comprises.
///
/// **Patron de concurrence des écrans d'administration.** Deux fenêtres, un
/// seul instrument :
///
///   · **des minutes** séparent l'ouverture de la fiche de sa soumission.
///     Aucun verrou ne couvre ce temps-là. C'est la comparaison du jeton qui
///     tranche, et c'est elle qui produit le message ;
///   · **des millisecondes** séparent deux soumissions concurrentes. C'est le
///     `WHERE` de l'écriture : il porte les valeurs **lues**, et en
///     `READ COMMITTED` PostgreSQL le réévalue après le commit du concurrent.
///     Le second n'apparie plus rien, `count` vaut 0, et il est refusé.
///
/// ⚠️ **`count === 0` est un refus, pas un succès vide** : le traiter autrement
/// rendrait l'écriture conditionnelle décorative.
///
/// Un `SELECT … FOR UPDATE` sérialiserait sans rien refuser - le second
/// écrivain attendrait son tour puis écraserait, défaut relevé sur
/// `app_settings` en T-J0-05. Son emploi légitime reste le stock, où l'on lit
/// une valeur pour en **calculer** une nouvelle.
export async function modifierForfait(
  entree: ChampsForfait & { id: number; version: string },
  actorId: string,
): Promise<ResultatModificationForfait> {
  try {
    return await db.$transaction(async (tx) => {
      const ligne = await tx.service.findUnique({
        where: { id: entree.id },
        select: SELECTION_ADMIN,
      });
      if (!ligne) return { ok: false as const, reason: "introuvable" as const };

      const avant = versAdmin(ligne);
      if (avant.version !== entree.version) {
        return { ok: false as const, reason: "perime" as const };
      }

      const diff = diffChamps(
        {
          label: avant.label,
          description: avant.description,
          duration: avant.duration,
          price: avant.price,
          isActive: avant.isActive,
        },
        {
          label: entree.label,
          description: entree.description,
          duration: entree.duration,
          price: entree.price,
          isActive: entree.isActive,
        },
      );
      const changements = champsModifies(diff);

      // « Je valide sans avoir rien changé » : rien n'est écrit, ni historique
      // ni audit. Une entrée d'audit sans changement décrirait un acte de
      // gestion qui n'a pas eu lieu.
      if (changements.length === 0) {
        return { ok: true as const, label: avant.label, changements: [] };
      }

      // Les SEULS champs modifiés, comme la SPEC l'écrit.
      const data: Prisma.ServiceUpdateManyMutationInput = {};
      if ("label" in diff) data.label = entree.label;
      if ("description" in diff) data.description = entree.description;
      if ("duration" in diff) data.duration = entree.duration;
      if ("price" in diff) data.price = entree.price;
      if ("isActive" in diff) data.isActive = entree.isActive;

      const ecriture = await ecritureNommee(
        tx.service.updateMany({
          // Le prédicat porte les valeurs LUES, pas seulement l'identifiant :
          // c'est lui qui ferme la fenêtre des millisecondes.
          where: {
            id: ligne.id,
            label: ligne.label,
            description: ligne.description,
            duration: ligne.duration,
            price: ligne.price,
            isActive: ligne.isActive,
          },
          data,
        }),
      );
      if (ecriture.count === 0) {
        return { ok: false as const, reason: "perime" as const };
      }

      // Historisée seulement si le prix change, dans la même transaction
      // (Constitution §4.1).
      if ("price" in diff) {
        await tx.servicePriceHistory.create({
          data: {
            serviceId: ligne.id,
            oldPrice: avant.price,
            newPrice: entree.price,
            changedBy: actorId,
          },
        });
      }

      await writeAuditLog(
        {
          entityType: "services",
          entityId: String(ligne.id),
          action: "UPDATE",
          actorId,
          details: detailsAudit(diff),
        },
        tx,
      );

      return { ok: true as const, label: entree.label, changements };
    });
  } catch (erreur) {
    return traduireNomPris(erreur, {
      ok: false as const,
      reason: "nom_pris" as const,
    });
  }
}
