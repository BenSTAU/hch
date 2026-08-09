// Seed du référentiel initial — migration 013 de PLAN S2 §6.
//
// Rejouable : chaque écriture est un upsert, ou un test d'existence quand la
// table n'a pas de clé naturelle unique. Le seed ÉTABLIT un état initial, il
// ne le rétablit pas — une valeur modifiée depuis l'application n'est pas
// écrasée. Seul le hash de mot de passe fait exception, pour qu'un changement
// de SEED_ADMIN_PASSWORD suffise à retrouver l'accès sans toucher à la base.
//
// Depuis T-V3-01, il porte aussi le RÉFÉRENTIEL dont dépend le parcours
// client : villes, zone de service, technicien affecté, forfaits, produits.
// SPEC §2.2 l'autorise explicitement — l'axiome « la géographie sectorise »
// est satisfait par une zone seedée et un technicien affecté, la dépendance du
// client portant sur les données et non sur l'interface d'administration qui
// les produira en V1.
//
// Aucune donnée personnelle réelle ici, et il ne doit jamais y en avoir : le
// dépôt bascule public avant la présentation intermédiaire. Les numéros
// appartiennent à la plage de fiction réservée par l'ARCEP (+336 39 98 xx xx),
// les prénoms sont ceux de la réserve fictive du vault (maquettage §Contenu :
// Sophie, Marc, Julie, Thomas), et les libellés de produits ne portent aucune
// marque déposée.
import { config as loadEnvFile } from "dotenv";
loadEnvFile({ path: ".env.local", quiet: true });
loadEnvFile({ path: ".env", quiet: true });

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const db = new PrismaClient();

/// Cost 10 — plancher OWASP retenu par ADR-005 v2.
const BCRYPT_COST = 10;

/// Deux administrateurs, et non un. Avec un seul compte, le trigger « dernier
/// administrateur protégé » (PLAN S2 §5.2) n'est pas démontrable : toute
/// tentative de suppression tomberait sur le garde, sans jamais prouver que le
/// cas nominal fonctionne. Décidé par l'audit du 2026-07-06 (F2).
const ADMINS = [
  {
    email: "admin@homecyclhome.fr",
    firstname: "Admin",
    lastname: "Principal",
    phone: "+33639980001",
  },
  {
    email: "admin2@homecyclhome.fr",
    firstname: "Admin",
    lastname: "Secours",
    phone: "+33639980002",
  },
] as const;

/// Technicien de démonstration. Le parcours client en dépend directement :
/// le pool de créneaux se dérive du planning des techniciens affectés à la
/// zone du client (Constitution §2.1), donc sans technicien affecté le tunnel
/// de réservation n'a rien à proposer.
///
/// Il reçoit le même mot de passe que les administrateurs. SEED_ADMIN_PASSWORD
/// est de fait le mot de passe des COMPTES SEEDÉS, pas seulement des admins :
/// une variable dédiée aurait entraîné toute la procédure des variables
/// d'environnement (deux piles, `.env.prod.example`, schéma de validation)
/// pour un compte de démonstration.
const TECHNICIEN = {
  email: "tech@homecyclhome.fr",
  firstname: "Marc",
  lastname: "Lefèvre",
  phone: "+33639980010",
} as const;

/// Les neuf arrondissements de Lyon. `addresses.city_id` est NOT NULL : sans
/// ces lignes, aucune adresse lyonnaise n'est enregistrable, et le tunnel de
/// T-V3-06 bute dès la première saisie. Le dictionnaire prévoit à terme un
/// import CSV La Poste (~35 000 lignes) — hors sujet ici, la zone de service
/// ne couvre que Lyon.
const VILLES = Array.from({ length: 9 }, (_, index) => ({
  zipCode: `6900${index + 1}`,
  city: "Lyon",
  department: "Rhône",
  region: "Auvergne-Rhône-Alpes",
}));

/// Zone de service unique — enveloppe simplifiée autour de Lyon, douze sommets
/// en coordonnées réelles WGS84 (lon, lat).
///
/// ⚠️ Ce n'est PAS le contour de la commune, et l'écart est mesuré : **71,9 km²
/// contre 47,9 km²** pour la commune réelle. L'enveloppe déborde donc sur les
/// communes limitrophes — Caluire au nord, Villeurbanne à l'est, Sainte-Foy à
/// l'ouest. La DoD de T-V3-01 écrit « polygone d'une commune » : divergence
/// signalée, pas absorbée.
///
/// Elle est retenue telle quelle parce qu'une zone de SERVICE n'est pas une
/// limite administrative — c'est un secteur commercial dessiné à la main par
/// l'administrateur sur une carte (Constitution §2.2 : les zones ne se
/// déduisent ni d'un code postal ni d'un nom de commune), et c'est exactement
/// ce que produira US-ZONE-AJOUTER en V1. Un contour communal officiel
/// compterait plusieurs centaines de sommets et exigerait une source de
/// données qu'aucun artefact du projet ne matérialise.
///
/// Sens anti-horaire, convention OGC pour un anneau extérieur. PostGIS
/// n'impose aucune orientation en `geography` — il retient toujours la plus
/// petite des deux régions — mais un anneau conforme se relit sans avoir à se
/// poser la question.
const ZONE = {
  name: "Lyon",
  color: "#005344",
  /// Dernier sommet identique au premier : un anneau WKT doit être fermé.
  contour: [
    [4.779, 45.786], // Vaise, angle nord-ouest
    [4.774, 45.77],
    [4.772, 45.748], // point le plus à l'ouest — 5e
    [4.796, 45.728],
    [4.818, 45.718],
    [4.842, 45.708], // point le plus au sud — limite Saint-Fons
    [4.888, 45.722],
    [4.898, 45.748], // point le plus à l'est — limite Bron
    [4.876, 45.762],
    [4.872, 45.782],
    [4.856, 45.796],
    [4.818, 45.808], // point le plus au nord — limite Caluire
    [4.779, 45.786],
  ],
} as const;

/// Les trois forfaits de démonstration. Libellés et durées repris de
/// [[maquettage]] §Contenu, qui les fixe comme « forfaits réels ».
///
/// ⚠️ Un prix diverge de cette source : « Changement pneus » y est à 120 € pour
/// 30 min, quand « Révision complète » est à 85 € pour 60 min — le forfait le
/// plus court serait le plus cher, incohérence visible en démonstration.
/// Ramené à 39 €, soit 1,30 €/min, entre les 1,42 de la révision et les 1,25
/// du diagnostic. Écart tranché par Benjamin le 2026-08-08, à répercuter au
/// vault.
const FORFAITS = [
  {
    label: "Révision complète",
    description:
      "Réglage des patins et disques, indexation des dérailleurs, dévoilage " +
      "des roues, serrage au couple et graissage de la transmission.",
    duration: 60,
    price: "85.00",
  },
  {
    label: "Diagnostic express",
    description:
      "Contrôle rapide de l'état général du vélo et devis des réparations à " +
      "prévoir, sans démontage.",
    duration: 20,
    price: "25.00",
  },
  {
    label: "Changement pneus",
    description:
      "Dépose et pose des pneus et chambres à air, contrôle de la pression " +
      "et de l'état des jantes. Pneus et chambres facturés en supplément.",
    duration: 30,
    price: "39.00",
  },
] as const;

/// Trois produits additionnels, vendus dans le même panier que le forfait —
/// service et vente forment un acte commercial unique (Constitution §2.6).
///
/// Libellés génériques, sans aucune marque : la maquette A4 montrait des
/// produits de marques réelles, ce qui n'a pas sa place dans un dépôt qui
/// bascule public. Le catalogue reste plat, `category_id` NULL : aucune US de
/// la vague V3 ne consomme les catégories, elles se peuplent en V1 admin.
const PRODUITS = [
  { label: "Chambre à air 700×35", price: "12.90", stock: 40 },
  { label: "Antivol en U", price: "39.90", stock: 15 },
  { label: "Paire de patins de frein", price: "9.90", stock: 60 },
] as const;

/// Configuration société. Les clés doivent PRÉEXISTER : `app_settings` est une
/// table clé-valeur, et le critère de fin du jalon 0 demande qu'un
/// administrateur « modifie un paramètre société ». On ne modifie pas une clé
/// absente.
const APP_SETTINGS = [
  {
    key: "company.name",
    value: "LeCycleLyonnais",
    valueType: "string",
    description: "Raison sociale affichée sur le site et les factures",
  },
  {
    key: "company.email",
    value: "contact@homecyclhome.fr",
    valueType: "string",
    description: "Adresse email affichée aux clients",
  },
  {
    key: "company.phone",
    value: "+33639980000",
    valueType: "string",
    // Les `description` sont les LIBELLÉS du formulaire d'administration
    // (dictionnaire §app_settings, champ 4). Elles s'adressent à un
    // gestionnaire, pas à un développeur : aucune contrainte de schéma, aucun
    // nom de norme. « au format E.164 » y figurait par recopie de `users.phone`
    // — qui, lui, porte bien un CHECK. Cette colonne-ci n'en a aucun.
    description: "Téléphone affiché aux clients",
  },
  {
    key: "company.address",
    // Voie inexistante, dans un arrondissement qui existe : l'écran et les
    // mentions légales ont une adresse plausible, et elle ne désigne le
    // domicile de personne.
    value: "12 rue de la Bicyclette, 69003 Lyon",
    valueType: "string",
    description: "Adresse postale du siège",
  },
  {
    key: "company.siret",
    // SIRET **volontairement invalide**, et c'est la seule façon sûre de le
    // remplir : un SIRET est une donnée publique qui désigne une entreprise
    // réelle, et il n'existe aucune plage de fiction réservée comme l'ARCEP en
    // offre une pour les numéros de téléphone (celle qu'utilisent les deux
    // administrateurs plus haut).
    //
    // Deux garde-fous cumulés : le SIREN `999999999` n'est pas alloué par
    // l'INSEE, et la clé de Luhn — que tout SIRET réel satisfait — est fausse
    // ici. Ce numéro ne peut donc appartenir à personne, tout en ayant la
    // forme d'un SIRET à l'écran. Le dépôt bascule public avant le 18 août.
    value: "99999999900001",
    valueType: "string",
    description: "Numéro SIRET, mentionné sur les factures",
  },
] as const;

async function main() {
  const password = process.env["SEED_ADMIN_PASSWORD"];
  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD absente. Le seed ne pose pas de mot de passe par " +
        "défaut : une valeur en dur dans le dépôt deviendrait un identifiant " +
        "public le jour de la bascule. La renseigner dans .env.local (poste) " +
        "ou dans le .env.prod de la pile (VPS).",
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // Les comptes seedés sont **pré-vérifiés** : personne ne cliquera de lien
  // d'activation pour eux. Sans cette date, ils sont « jamais activés » aux yeux
  // de `findAccountForSignup`, donc éligibles à un renvoi d'activation depuis le
  // formulaire public — qui rouvrirait un compte que l'admin aurait fermé.
  // Constaté par l'agent testeur en T-V3-02 (B1).
  const emailVerifiedAt = new Date();

  for (const admin of ADMINS) {
    const user = await db.user.upsert({
      where: { email: admin.email },
      // Aucune mise à jour : le seed ne réécrit pas une identité existante. Les
      // lignes antérieures à la migration `add_users_email_verified_at` sont
      // reprises par le `UPDATE` de cette migration, pas ici.
      update: {},
      create: { ...admin, roles: ["ROLE_ADMIN"], emailVerifiedAt },
    });

    await db.authProvider.upsert({
      where: { userId_provider: { userId: user.id, provider: "local" } },
      // Le hash, lui, est rafraîchi — c'est le seul moyen de reprendre la main
      // sur un compte seedé sans intervention manuelle en base.
      update: { passwordHash },
      // providerUid reste NULL : un provider `local` n'a pas d'identifiant
      // côté fournisseur, il n'y a pas de fournisseur.
      create: { userId: user.id, provider: "local", passwordHash },
    });

    console.log(`administrateur  ${admin.email}`);
  }

  for (const setting of APP_SETTINGS) {
    await db.appSetting.upsert({
      where: { key: setting.key },
      // Une clé déjà modifiée par un administrateur n'est pas ramenée à sa
      // valeur de seed.
      update: {},
      // updatedBy reste NULL : personne n'a encore touché à cette clé, et
      // c'est cette nullabilité qui rend l'entité autoportante au seed.
      create: setting,
    });

    // Le LIBELLÉ et le TYPE, eux, sont rafraîchis : ce sont des métadonnées de
    // présentation dont le dépôt est la source, pas des valeurs saisies. Sans
    // ça, corriger un libellé maladroit n'atteindrait jamais une base déjà
    // seedée.
    //
    // En SQL brut et non par Prisma, parce que `updatedAt` porte `@updatedAt` :
    // un `update` Prisma le repousserait à maintenant, et l'écran afficherait
    // « Modifié le <aujourd'hui> » sur une valeur que personne n'a touchée. La
    // date doit dater la VALEUR, sinon elle ne sert à rien.
    await db.$executeRaw`
      UPDATE app_settings
      SET description = ${setting.description}, value_type = ${setting.valueType}
      WHERE key = ${setting.key}
    `;

    // Une clé jamais renseignée reçoit la valeur du seed, même si sa ligne
    // existe déjà. Ce n'est pas un retour en arrière : `updated_by IS NULL`
    // signifie qu'aucun administrateur ne l'a jamais touchée, et une valeur
    // vide n'est pas un choix qu'on écraserait — c'est le trou que le seed est
    // là pour combler. Sans cette passe, `company.address` et `company.siret`
    // resteraient vides sur toute base seedée avant qu'ils ne portent une
    // valeur, et l'écran d'administration afficherait deux champs vides à la
    // démonstration.
    //
    // Ici en Prisma et non en SQL brut, à l'inverse du bloc précédent : la
    // valeur change vraiment, donc `updatedAt` DOIT bouger.
    await db.appSetting.updateMany({
      where: {
        key: setting.key,
        updatedBy: null,
        OR: [{ value: null }, { value: "" }],
      },
      data: { value: setting.value },
    });
  }
  console.log(`paramètres      ${APP_SETTINGS.length} clés société`);

  // ───────────────────────────────────────────────────────────────────────
  // Référentiel du parcours client (T-V3-01)
  // ───────────────────────────────────────────────────────────────────────

  for (const ville of VILLES) {
    await db.city.upsert({
      where: { zipCode_city: { zipCode: ville.zipCode, city: ville.city } },
      update: {},
      create: ville,
    });
  }
  console.log(`villes          ${VILLES.length} arrondissements de Lyon`);

  // En SQL brut, et sans alternative : `zones.area` est une colonne
  // `Unsupported` que le client Prisma ne sait ni lire ni écrire, ce qui rend
  // `zone.create()` indisponible (ADR-008). Idempotence par le UNIQUE sur le
  // nom, pas par un upsert.
  const contour = ZONE.contour.map(([lon, lat]) => `${lon} ${lat}`).join(", ");
  await db.$executeRaw`
    INSERT INTO zones ("name", "color", "area")
    VALUES (
      ${ZONE.name},
      ${ZONE.color},
      ST_GeogFromText(${`SRID=4326;POLYGON((${contour}))`})
    )
    ON CONFLICT ("name") DO NOTHING
  `;

  const [zone] = await db.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM zones WHERE "name" = ${ZONE.name}
  `;
  if (!zone) {
    throw new Error(
      `Zone « ${ZONE.name} » introuvable juste après son insertion. ` +
        "Le polygone est probablement invalide — PostGIS rejette un anneau " +
        "non fermé ou auto-sécant.",
    );
  }
  console.log(
    `zone            ${ZONE.name} (${ZONE.contour.length - 1} sommets)`,
  );

  const technicien = await db.user.upsert({
    where: { email: TECHNICIEN.email },
    update: {},
    create: { ...TECHNICIEN, roles: ["ROLE_TECH"], emailVerifiedAt },
  });

  await db.authProvider.upsert({
    where: { userId_provider: { userId: technicien.id, provider: "local" } },
    update: { passwordHash },
    create: { userId: technicien.id, provider: "local", passwordHash },
  });

  // Le trigger `check_technician_role()` de la migration 005 refuse cette
  // ligne si le porteur n'a pas ROLE_TECH, n'est pas actif, ou est
  // pseudonymisé. C'est le second filet de PLAN S2 §5.3 — le premier étant le
  // garde de la Server Action d'affectation, qui naîtra en V1.
  await db.technicianZone.upsert({
    where: { userId_zoneId: { userId: technicien.id, zoneId: zone.id } },
    update: {},
    create: { userId: technicien.id, zoneId: zone.id },
  });
  console.log(`technicien      ${TECHNICIEN.email} → zone ${ZONE.name}`);

  // `services` et `products` n'ont aucune clé naturelle unique au
  // dictionnaire : leur libellé n'est pas déclaré UNIQUE, et en inventer une
  // serait un changement de modèle. L'idempotence passe donc par un test
  // d'existence. Sans risque de course — le seed est séquentiel et Benjamin
  // est seul sur la base.
  for (const forfait of FORFAITS) {
    const existant = await db.service.findFirst({
      where: { label: forfait.label },
    });
    if (!existant) {
      await db.service.create({ data: forfait });
    }
  }
  console.log(`forfaits        ${FORFAITS.length} au catalogue`);

  for (const produit of PRODUITS) {
    const existant = await db.product.findFirst({
      where: { label: produit.label },
    });
    if (!existant) {
      await db.product.create({ data: produit });
    }
  }
  console.log(`produits        ${PRODUITS.length} au catalogue`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await db.$disconnect();
    process.exit(1);
  });
