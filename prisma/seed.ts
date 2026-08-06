// Seed du référentiel initial — migration 013 de PLAN S2 §6.
//
// Rejouable : chaque écriture est un upsert. Le seed ÉTABLIT un état initial,
// il ne le rétablit pas — une valeur modifiée depuis l'application n'est pas
// écrasée. Seul le hash de mot de passe fait exception, pour qu'un changement
// de SEED_ADMIN_PASSWORD suffise à retrouver l'accès sans toucher à la base.
//
// Aucune donnée personnelle réelle ici, et il ne doit jamais y en avoir : le
// dépôt bascule public avant la présentation intermédiaire. Les numéros
// appartiennent à la plage de fiction réservée par l'ARCEP (+336 39 98 xx xx),
// les noms sont des fonctions, pas des personnes.
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

  for (const admin of ADMINS) {
    const user = await db.user.upsert({
      where: { email: admin.email },
      // Aucune mise à jour : le seed ne réécrit pas une identité existante.
      update: {},
      create: { ...admin, roles: ["ROLE_ADMIN"] },
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
}

main()
  .then(() => db.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await db.$disconnect();
    process.exit(1);
  });
