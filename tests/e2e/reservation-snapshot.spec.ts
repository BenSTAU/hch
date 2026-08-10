import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/// Prix et durée figés à la réservation — Constitution §4.1, T-V3-08.
///
/// Deux instantanés, une seule règle : *un changement de catalogue n'altère
/// jamais un rendez-vous déjà pris*. `price_snapshot` la portait déjà ;
/// `duration_snapshot` est né avec le dictionnaire v2.4 parce que la durée a
/// exactement la même propriété et ne l'avait pas.
///
/// Le second est le plus subtil des deux : il alimente la colonne générée
/// `reservation_range`, donc la fenêtre de non-chevauchement. Si la durée
/// n'était pas figée, retoucher le catalogue déplacerait la fenêtre d'un
/// rendez-vous **déjà confirmé** — silencieusement, et sans qu'aucun écran ne
/// le montre.
///
/// Sous Playwright et non Vitest : il faut un vrai PostgreSQL pour éprouver une
/// colonne générée.

let db: PrismaClient;

const DEBUT = new Date("2027-04-12T09:00:00Z");

let addressId: number;
let serviceId: number;
let techId: string;
let clientId: string;

/// Valeurs d'origine du forfait, restaurées en fin de test : la base de
/// développement est partagée entre les deux postes, un catalogue laissé modifié
/// fausserait la démonstration suivante.
let prixOrigine: string;
let dureeOrigine: number;

async function plageReservation(interventionId: number): Promise<string> {
  // `reservation_range` est une colonne `Unsupported` : le client Prisma ne sait
  // pas la lire, elle passe par du SQL brut.
  const lignes = await db.$queryRaw<{ plage: string }[]>`
    SELECT "reservation_range"::text AS plage
      FROM interventions
     WHERE "id" = ${interventionId}
  `;
  const ligne = lignes[0];
  if (!ligne) throw new Error("Intervention introuvable.");
  return ligne.plage;
}

test.beforeAll(async () => {
  db = new PrismaClient();

  const tech = await db.user.findFirstOrThrow({
    where: { roles: { has: "ROLE_TECH" } },
  });
  techId = tech.id;

  // Le seed ne pose aucun client — la SPEC veut qu'il naisse du parcours
  // public. Ce test attaque la base directement, il crée donc le sien.
  const client = await db.user.create({
    data: {
      email: `snapshot-${randomBytes(6).toString("hex")}@example.test`,
      firstname: "Camille",
      lastname: "Durand",
      roles: ["ROLE_CLIENT"],
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  clientId = client.id;

  const service = await db.service.findFirstOrThrow();
  serviceId = service.id;
  prixOrigine = service.price.toFixed(2);
  dureeOrigine = service.duration;

  const city = await db.city.findFirstOrThrow();
  const lignes = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses ("street", "city_id", "location", "user_id", "label", "is_active")
    VALUES (
      'Adresse de test snapshot',
      ${city.id},
      ST_SetSRID(ST_MakePoint(4.832::double precision, 45.7578::double precision), 4326)::geography,
      NULL, NULL, true
    )
    RETURNING "id"
  `;
  addressId = lignes[0]?.id ?? 0;
  expect(addressId).toBeGreaterThan(0);
});

test.afterAll(async () => {
  await db.intervention.deleteMany({ where: { addressId } });
  await db.address.delete({ where: { id: addressId } });
  await db.user.delete({ where: { id: clientId } });
  // Restauration du catalogue, sans quoi le forfait resterait au tarif de test.
  await db.service.update({
    where: { id: serviceId },
    data: { price: prixOrigine, duration: dureeOrigine },
  });
  await db.$disconnect();
});

test("une hausse de tarif après réservation ne change pas le prix facturé", async () => {
  const intervention = await db.intervention.create({
    data: {
      status: "PLANNED",
      appointmentAt: DEBUT,
      priceSnapshot: prixOrigine,
      durationSnapshot: dureeOrigine,
      clientId,
      techId,
      addressId,
      serviceId,
    },
    select: { id: true },
  });

  await db.service.update({
    where: { id: serviceId },
    data: { price: "999.00" },
  });

  const apres = await db.intervention.findUniqueOrThrow({
    where: { id: intervention.id },
    select: { priceSnapshot: true },
  });

  expect(apres.priceSnapshot.toFixed(2)).toBe(prixOrigine);
});

test("un changement de durée après réservation ne déplace pas la fenêtre de non-chevauchement", async () => {
  // Le test symétrique de celui du prix, et le vrai enjeu de
  // `duration_snapshot`. Avec un trigger recalculant depuis `services.duration`,
  // cette assertion tomberait — c'est le motif pour lequel le repli trigger de
  // PLAN S2 §5.1 a été écarté.
  await db.intervention.deleteMany({ where: { addressId } });

  const intervention = await db.intervention.create({
    data: {
      status: "PLANNED",
      appointmentAt: DEBUT,
      priceSnapshot: prixOrigine,
      durationSnapshot: dureeOrigine,
      clientId,
      techId,
      addressId,
      serviceId,
    },
    select: { id: true },
  });

  const plageAvant = await plageReservation(intervention.id);

  await db.service.update({
    where: { id: serviceId },
    data: { duration: dureeOrigine + 60 },
  });

  expect(await plageReservation(intervention.id)).toBe(plageAvant);
});

test("une écriture ultérieure sur l'intervention ne recalcule pas la fenêtre depuis le catalogue", async () => {
  // Le scénario précis qui rendait le trigger dangereux : le catalogue a changé,
  // puis QUELQU'UN TOUCHE la ligne pour une raison sans rapport — un commentaire
  // technicien, un changement de statut. Un trigger rejouerait son calcul sur la
  // nouvelle durée. Une colonne générée depuis `duration_snapshot` ne le peut
  // pas : sa source n'a pas bougé.
  const intervention = await db.intervention.findFirstOrThrow({
    where: { addressId },
    select: { id: true },
  });

  const plageAvant = await plageReservation(intervention.id);

  await db.intervention.update({
    where: { id: intervention.id },
    data: { techComment: "Prévoir un dérailleur de rechange." },
  });

  expect(await plageReservation(intervention.id)).toBe(plageAvant);
});

test("la fenêtre couvre exactement la durée figée, bornes semi-ouvertes", async () => {
  // Elle doit dire la même chose que `src/lib/creneaux/derivation.ts`, qui
  // écarte les créneaux se chevauchant sur `[début, fin[`. Une divergence ferait
  // proposer un créneau que la base refuserait au dernier écran du tunnel.
  const intervention = await db.intervention.findFirstOrThrow({
    where: { addressId },
    select: { id: true, durationSnapshot: true },
  });

  const lignes = await db.$queryRaw<
    { debut: Date; fin: Date; borne: string }[]
  >`
    SELECT lower("reservation_range") AS debut,
           upper("reservation_range") AS fin,
           "reservation_range"::text  AS borne
      FROM interventions
     WHERE "id" = ${intervention.id}
  `;

  const ligne = lignes[0];
  expect(ligne).toBeDefined();
  if (!ligne) return;

  const minutes = (ligne.fin.getTime() - ligne.debut.getTime()) / 60_000;
  expect(minutes).toBe(intervention.durationSnapshot);

  // `[` inclusif à gauche, `)` exclusif à droite.
  expect(ligne.borne.startsWith("[")).toBe(true);
  expect(ligne.borne.endsWith(")")).toBe(true);
});
