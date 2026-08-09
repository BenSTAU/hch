import "server-only";

import { db } from "@/lib/db/client";
import { pointGeography, type PointWgs84 } from "@/lib/geo/postgis";

/// Accès aux adresses — helpers métier, pas Server Actions.
///
/// Aucun `revalidatePath`, aucun `redirect`, aucun contexte Next : ces deux-là
/// jettent hors contexte et rendraient ce module intestable en isolation.
/// L'orchestration vit dans `src/lib/actions/adresses/`.

export type AdresseClient = {
  id: number;
  /// Numéro et voie.
  street: string;
  postcode: string;
  city: string;
  /// Mémo choisi par le client — « Domicile », « Bureau ». `addresses.label` en
  /// base ; renommé ici pour ne pas entrer en collision avec le libellé BAN.
  memo: string | null;
};

/// Résout la commune d'une adresse BAN, en la créant si elle est inconnue.
///
/// La clé est le couple **(code postal, nom)**, qui porte l'unicité en base
/// (`prisma/schema.prisma:231`). Le `citycode` INSEE de la réponse BAN serait
/// une clé plus juste — une commune peut porter plusieurs codes postaux — mais
/// `cities` n'a pas de colonne pour l'accueillir et en ajouter une est une
/// modification du dictionnaire. Arbitré le 2026-08-09.
export async function resoudreCommune(commune: {
  postcode: string;
  city: string;
}): Promise<number> {
  const ligne = await db.city.upsert({
    where: {
      zipCode_city: { zipCode: commune.postcode, city: commune.city },
    },
    // Rien à mettre à jour : l'existence de la ligne est tout ce qu'on cherche.
    // `upsert` plutôt que `findFirst` + `create` parce que deux réservations
    // simultanées sur une commune neuve créeraient deux lignes, que la
    // contrainte d'unicité refuserait — l'une des deux partirait en erreur.
    update: {},
    create: { zipCode: commune.postcode, city: commune.city },
    select: { id: true },
  });

  return ligne.id;
}

/// Crée une adresse. `userId` à `null` est l'adresse d'un visiteur qui réserve
/// sans compte (Constitution §3.2) — elle sera rattachée à l'inscription.
///
/// SQL brut, et pas par choix de style : `addresses.location` est une colonne
/// `Unsupported("geography(Point, 4326)")`, ce qui rend `create` indisponible
/// sur ce modèle Prisma (`prisma/schema.prisma:266`).
export async function creerAdresse(adresse: {
  street: string;
  cityId: number;
  point: PointWgs84;
  userId: string | null;
  memo?: string | undefined;
}): Promise<number> {
  const lignes = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses ("street", "city_id", "location", "user_id", "label", "is_active")
    VALUES (
      ${adresse.street},
      ${adresse.cityId},
      ${pointGeography(adresse.point)},
      ${adresse.userId}::uuid,
      ${adresse.memo ?? null},
      true
    )
    RETURNING "id"
  `;

  const ligne = lignes[0];
  if (!ligne) {
    // `INSERT ... RETURNING` sans ligne ne peut pas arriver sans erreur
    // préalable. On lève plutôt que de renvoyer un identifiant inventé.
    throw new Error("Insertion d'adresse sans identifiant retourné.");
  }
  return ligne.id;
}

/// Adresses actives d'un client, pour le sélecteur du tunnel et la fiche.
///
/// `location` n'est pas projetée : l'écran affiche du texte, et la colonne est
/// de toute façon masquée par le client Prisma.
export async function listerAdressesClient(
  userId: string,
): Promise<AdresseClient[]> {
  const lignes = await db.address.findMany({
    where: { userId, isActive: true },
    select: {
      id: true,
      street: true,
      label: true,
      city: { select: { zipCode: true, city: true } },
    },
    // La plus récemment ajoutée d'abord : c'est celle qu'on vient de saisir, et
    // l'ordre d'insertion est le seul proxy d'usage dont on dispose tant que
    // `interventions` n'existe pas pour dire laquelle a servi en dernier.
    orderBy: { id: "desc" },
  });

  return lignes.map((ligne) => ({
    id: ligne.id,
    street: ligne.street,
    postcode: ligne.city.zipCode,
    city: ligne.city.city,
    memo: ligne.label,
  }));
}

export type SuppressionAdresse =
  { ok: true } | { ok: false; reason: "introuvable" };

/// Retire une adresse du sélecteur, sans la supprimer physiquement.
///
/// `isActive = false` et non un `DELETE` : les interventions passées la
/// référencent, et casser une FK pour une adresse retirée est exactement ce que
/// la Constitution §4.1 interdit. Le modèle ne porte pas de `deletedAt`, aucune
/// temporalité RGPD n'étant attachée à une adresse (PLAN S2 §4).
///
/// La garde « refus si une intervention **active** la référence » est reportée
/// à T-V3-08, qui crée la table `interventions`.
export async function desactiverAdresse(params: {
  adresseId: number;
  userId: string;
}): Promise<SuppressionAdresse> {
  // Le `userId` est dans le WHERE, pas dans une vérification préalable : une
  // lecture puis une écriture laisseraient une fenêtre entre les deux, et
  // surtout renverraient « introuvable » différemment selon que l'adresse
  // n'existe pas ou appartient à quelqu'un d'autre. Ici les deux cas sont
  // indiscernables de l'extérieur.
  const { count } = await db.address.updateMany({
    where: { id: params.adresseId, userId: params.userId, isActive: true },
    data: { isActive: false },
  });

  if (count === 0) return { ok: false, reason: "introuvable" };
  return { ok: true };
}
