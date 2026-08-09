import { randomBytes } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

/// Anti-double-réservation — T-V3-08, PLAN S2 §5.1.
///
/// Ce fichier ne pilote aucune page : il attaque la base directement, parce que
/// c'est la base qui arbitre. Le rafraîchissement de la grille toutes les 30 s
/// **ne règle pas** la course — deux `POST` à 200 ms d'écart passent tous deux
/// la validation applicative avant que le premier ne commite. Seule une
/// contrainte SQL tranche.
///
/// Il vit sous Playwright et non sous Vitest pour la raison déjà documentée
/// dans `sectorisation-geo.spec.ts` : le projet `barriere` est la seule surface
/// de la CI qui dispose d'un vrai PostgreSQL.
///
/// **Le rouge est tracé dans l'historique** : ce fichier a été commité en
/// `8d17160`, avant la migration 010, et les deux insertions passaient alors
/// toutes les deux. La contrainte les départage depuis `ad079a1`. La tâche
/// porte le marqueur [T], ce rouge préalable est obligatoire.

let db: PrismaClient;

/// Créneau de test, volontairement loin dans le futur pour ne croiser aucune
/// donnée de démonstration.
const DEBUT = new Date("2027-03-15T09:00:00Z");

/// Deuxième réservation décalée de 30 minutes : `appointment_at` DIFFÈRE, donc
/// un simple `UNIQUE (tech_id, appointment_at)` la laisserait passer. C'est le
/// chevauchement qu'il faut refuser, pas l'égalité.
const DEBUT_CHEVAUCHANT = new Date("2027-03-15T09:30:00Z");

const DUREE_MINUTES = 60;

let techId: string;
let clientId: string;
let addressId: number;
let serviceId: number;

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
      email: `concurrence-${randomBytes(6).toString("hex")}@example.test`,
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

  const city = await db.city.findFirstOrThrow();

  // `addresses.location` est une colonne `Unsupported("geography")` : Prisma ne
  // sait pas la créer, l'insertion passe par du SQL brut.
  const lignes = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses ("street", "city_id", "location", "user_id", "label", "is_active")
    VALUES (
      'Adresse de test concurrence',
      ${city.id},
      ST_SetSRID(ST_MakePoint(4.832::double precision, 45.7578::double precision), 4326)::geography,
      NULL,
      NULL,
      true
    )
    RETURNING "id"
  `;
  addressId = lignes[0]?.id ?? 0;
  expect(addressId).toBeGreaterThan(0);
});

test.afterAll(async () => {
  // La base de développement est partagée entre les deux postes : un test qui
  // laisse ses lignes derrière lui fausse la grille de créneaux du suivant.
  await db.intervention.deleteMany({ where: { addressId } });
  await db.address.delete({ where: { id: addressId } });
  await db.user.delete({ where: { id: clientId } });
  await db.$disconnect();
});

function reserver(appointmentAt: Date) {
  return db.intervention.create({
    data: {
      status: "PLANNED",
      appointmentAt,
      priceSnapshot: "85.00",
      durationSnapshot: DUREE_MINUTES,
      clientId,
      techId,
      addressId,
      serviceId,
    },
  });
}

test("deux réservations simultanées sur un créneau qui se chevauche : une seule passe", async () => {
  // Lancées ensemble, sans await intermédiaire : c'est la seule façon de
  // reproduire la course. Les sérialiser testerait autre chose.
  const resultats = await Promise.allSettled([
    reserver(DEBUT),
    reserver(DEBUT_CHEVAUCHANT),
  ]);

  const reussites = resultats.filter((r) => r.status === "fulfilled");
  const echecs = resultats.filter((r) => r.status === "rejected");

  expect(
    reussites,
    "Sans contrainte d'exclusion, les deux insertions passent : c'est le défaut que la migration 010 corrige.",
  ).toHaveLength(1);
  expect(echecs).toHaveLength(1);

  // Le refus vient bien de la contrainte nommée, et non d'une erreur de saisie
  // qui rendrait le test vert pour la mauvaise raison.
  const echec = echecs[0];
  if (echec?.status === "rejected") {
    expect(String(echec.reason)).toMatch(/no_double_booking/);
  }

  const enBase = await db.intervention.count({ where: { addressId } });
  expect(enBase).toBe(1);
});

test("un créneau qui touche exactement le précédent reste réservable", async () => {
  // Bornes `[début, fin[` : 10:00 démarre à la seconde où 09:00-10:00 se
  // termine. Une contrainte posée sur `[]` refuserait ce créneau et retirerait
  // silencieusement un rendez-vous par heure au planning.
  await db.intervention.deleteMany({ where: { addressId } });

  await reserver(DEBUT);
  await expect(
    reserver(new Date("2027-03-15T10:00:00Z")),
  ).resolves.toBeDefined();

  expect(await db.intervention.count({ where: { addressId } })).toBe(2);
});

test("un créneau libéré par une annulation redevient réservable", async () => {
  // Le filtre `WHERE status IN ('PLANNED','IN_PROGRESS')` de la contrainte est
  // ce qui rend l'annulation utile : sans lui, un créneau annulé resterait
  // bloqué pour toujours.
  await db.intervention.deleteMany({ where: { addressId } });

  const premiere = await reserver(DEBUT);
  await db.intervention.update({
    where: { id: premiere.id },
    data: { status: "CANCELLED" },
  });

  await expect(reserver(DEBUT)).resolves.toBeDefined();
});
