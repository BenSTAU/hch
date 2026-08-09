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
/// Second technicien, créé par ce fichier : le seed n'en pose qu'un, et sans
/// lui on ne peut pas prouver que la contrainte porte bien sur le COUPLE
/// (technicien, plage) et non sur la plage seule.
let autreTechId: string;
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

  const autreTech = await db.user.create({
    data: {
      email: `tech-concurrence-${randomBytes(6).toString("hex")}@example.test`,
      firstname: "Dominique",
      lastname: "Martin",
      roles: ["ROLE_TECH"],
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  autreTechId = autreTech.id;

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
  await db.user.delete({ where: { id: autreTechId } });
  await db.$disconnect();
});

function reserver(
  appointmentAt: Date,
  options: {
    tech?: string;
    dureeMinutes?: number;
    status?: "PLANNED" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  } = {},
) {
  return db.intervention.create({
    data: {
      status: options.status ?? "PLANNED",
      appointmentAt,
      priceSnapshot: "85.00",
      durationSnapshot: options.dureeMinutes ?? DUREE_MINUTES,
      clientId,
      techId: options.tech ?? techId,
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

/// Les formes de chevauchement que les trois tests ci-dessus ne couvrent pas.
///
/// Le premier n'éprouvait qu'un seul sens — le nouveau rendez-vous commence
/// APRÈS l'existant et mord sa fin. Une contrainte écrite avec un opérateur
/// d'ordre plutôt qu'avec `&&` passerait ce test-là et laisserait entrer les
/// trois autres.
test.describe("les quatre formes de chevauchement", () => {
  test.beforeEach(async () => {
    await db.intervention.deleteMany({ where: { addressId } });
    await reserver(DEBUT, { dureeMinutes: 60 });
  });

  test("refuse un rendez-vous qui commence AVANT et mord le début", async () => {
    // 08:30-09:30 contre 09:00-10:00.
    await expect(reserver(new Date("2027-03-15T08:30:00Z"))).rejects.toThrow(
      /no_double_booking/,
    );
  });

  test("refuse un rendez-vous strictement CONTENU dans l'existant", async () => {
    // 09:15-09:30 : ni le début ni la fin ne coïncident. C'est la forme que
    // seule une intersection de plages attrape.
    await expect(
      reserver(new Date("2027-03-15T09:15:00Z"), { dureeMinutes: 15 }),
    ).rejects.toThrow(/no_double_booking/);
  });

  test("refuse un rendez-vous qui ENGLOBE l'existant", async () => {
    // 08:00-11:00 avale entièrement 09:00-10:00. Un forfait long posé par
    // dessus un court.
    await expect(
      reserver(new Date("2027-03-15T08:00:00Z"), { dureeMinutes: 180 }),
    ).rejects.toThrow(/no_double_booking/);
  });

  test("accepte un rendez-vous qui se termine PILE au début de l'existant", async () => {
    // 08:00-09:00 contre 09:00-10:00 : bornes `[début, fin[`, ils se touchent
    // sans se chevaucher. La symétrie du cas déjà couvert, côté gauche.
    await expect(
      reserver(new Date("2027-03-15T08:00:00Z")),
    ).resolves.toBeDefined();
  });
});

test("la contrainte porte sur le COUPLE technicien/plage, pas sur la plage seule", async () => {
  // `tech_id WITH =` dans la clause d'exclusion. Sans lui, la contrainte
  // sérialiserait toute l'entreprise sur un seul planning : deux techniciens ne
  // pourraient jamais intervenir à la même heure, chez deux clients différents.
  // C'est le mode d'échec le plus coûteux de cette migration, parce qu'il ne se
  // voit qu'avec un second technicien — et le seed n'en a qu'un.
  await db.intervention.deleteMany({ where: { addressId } });

  await reserver(DEBUT);
  await expect(reserver(DEBUT, { tech: autreTechId })).resolves.toBeDefined();

  expect(await db.intervention.count({ where: { addressId } })).toBe(2);
});

test("une intervention EN COURS occupe le créneau autant qu'une planifiée", async () => {
  // `IN_PROGRESS` figure dans le filtre de la contrainte au même titre que
  // `PLANNED`, et c'est la même liste que `STATUTS_OCCUPANTS`
  // (`src/lib/db/queries/interventions.ts:18`). Si les deux divergeaient, la
  // grille proposerait un créneau que la base refuserait — ou masquerait un
  // créneau libre.
  await db.intervention.deleteMany({ where: { addressId } });

  await reserver(DEBUT, { status: "IN_PROGRESS" });

  await expect(reserver(DEBUT)).rejects.toThrow(/no_double_booking/);
});

test("une intervention TERMINÉE ne bloque plus le créneau", async () => {
  // `DONE` est hors du filtre, comme `CANCELLED`. Le motif est différent : une
  // intervention terminée est dans le passé, et un rendez-vous re-planifié sur
  // le même horaire ne double-réserve personne.
  await db.intervention.deleteMany({ where: { addressId } });

  await reserver(DEBUT, { status: "DONE" });

  await expect(reserver(DEBUT)).resolves.toBeDefined();
});

test("la contrainte s'applique aussi à un DÉPLACEMENT de rendez-vous", async () => {
  // Le chemin que personne ne teste : la contrainte est vérifiée à l'INSERT,
  // mais aussi à l'UPDATE. Un report d'intervention — T-V3-11 et la vue
  // technicien en auront besoin — ne doit pas pouvoir se poser sur un créneau
  // déjà pris, alors qu'aucun garde applicatif ne le couvre aujourd'hui.
  await db.intervention.deleteMany({ where: { addressId } });

  await reserver(DEBUT);
  const deplacable = await reserver(new Date("2027-03-15T14:00:00Z"));

  await expect(
    db.intervention.update({
      where: { id: deplacable.id },
      data: { appointmentAt: DEBUT },
    }),
  ).rejects.toThrow(/no_double_booking/);
});

test("réactiver une intervention annulée sur un créneau repris est refusé", async () => {
  // La `reservation_range` est générée et la contrainte partielle : repasser de
  // `CANCELLED` à `PLANNED` fait rentrer la ligne dans le champ de la
  // contrainte. Sans ce filet, une annulation puis une réactivation
  // produiraient deux rendez-vous simultanés pour le même technicien.
  await db.intervention.deleteMany({ where: { addressId } });

  const annulee = await reserver(DEBUT, { status: "CANCELLED" });
  await reserver(DEBUT);

  await expect(
    db.intervention.update({
      where: { id: annulee.id },
      data: { status: "PLANNED" },
    }),
  ).rejects.toThrow(/no_double_booking/);
});

test("un allongement de durée qui empiète sur le rendez-vous suivant est refusé", async () => {
  // `reservation_range` est GÉNÉRÉE depuis `duration_snapshot` : la modifier
  // recalcule la plage, donc rejoue la contrainte. C'est le pendant du test de
  // `reservation-snapshot.spec.ts` — là-bas on prouve que le CATALOGUE ne
  // déplace pas la fenêtre, ici que la colonne figée, elle, la déplace bien.
  await db.intervention.deleteMany({ where: { addressId } });

  const premiere = await reserver(DEBUT, { dureeMinutes: 60 });
  await reserver(new Date("2027-03-15T10:00:00Z"), { dureeMinutes: 60 });

  await expect(
    db.intervention.update({
      where: { id: premiere.id },
      data: { durationSnapshot: 120 },
    }),
  ).rejects.toThrow(/no_double_booking/);
});
