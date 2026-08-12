import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import type { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";

/// Fabrique de techniciens pour la barriere E2E.
///
/// ── Pourquoi le technicien du seed ne suffit pas
///
/// `prisma/seed.ts` n'en pose qu'UN, `tech@homecyclhome.fr`, et il est affecte a
/// la seule zone de service. Or `gp-02` reserve en cliquant le **premier**
/// creneau propose, la derivation part du jour courant a Paris, et rien ne
/// nettoie ces reservations : elles atterrissent exactement sur les lignes que
/// la tournee du jour liste. Un scenario de tournee adosse au technicien du seed
/// afficherait donc un nombre d'interventions dependant de l'ordre d'execution
/// des fichiers et de ce que `gp-02` a laisse derriere lui.
///
/// Chaque fichier seme donc le sien. T-V2-01 devient independant de `gp-02`,
/// donc **independant d'une tache sacrifiable** — ce qu'un simple `afterAll` de
/// nettoyage n'aurait pas donne. Cadrage du plancher V2, D7.
///
/// ── Aucune affectation de zone, et c'est la propriete qui isole
///
/// `technician_zones` reste vide pour ces comptes. La derivation des creneaux
/// ne lit QUE les techniciens affectes a la zone du client
/// (`listerTechniciensCharges`) : un technicien sans zone ne peut donc jamais
/// etre choisi par le tunnel, et aucune reservation concurrente ne peut tomber
/// dans sa tournee. C'est plus fort qu'un nettoyage, qui court apres le
/// desordre au lieu de l'empecher.
///
/// Generalise la mecanique de la [PR #38](https://github.com/BenSTAU/hch/pull/38),
/// ou `compte-client.ts` faisait deja naitre ses propres comptes.

export const MOT_DE_PASSE_TECHNICIEN = "un-mot-de-passe-long-v2";

/// ⚠️ **Delai mesure, pas prudentiel.** Au premier passage la barriere echouait
/// avec le bouton encore sur « Connexion… » et la page toujours sur
/// `/connexion` : l'action n'avait pas rendu dans les 5 secondes par defaut de
/// `toHaveURL`. Trois couts s'additionnent, et aucun n'est un defaut applicatif
/// — la comparaison bcrypt, les allers-retours vers une base jointe par un
/// tunnel SSH, et la compilation A LA DEMANDE de la route de destination par le
/// serveur de developpement, qui ne se paie qu'au premier passage.
///
/// En CI le probleme ne se pose pas : `pnpm build && pnpm start` sert des routes
/// deja compilees. C'est donc du mou pour le poste, pas un masque pose sur une
/// lenteur de production.
const DELAI_CONNEXION_MS = 30_000;

/// Un email par execution : la base de la barriere est jetable en CI mais
/// survit d'un run a l'autre en local, et l'index unique sur `users.email`
/// ferait echouer la seconde passe.
export function emailTechnicien(prefixe: string): string {
  return `tech-${prefixe}-${randomBytes(6).toString("hex")}@example.test`;
}

export type TechnicienSeme = {
  id: string;
  email: string;
};

/// Cree un technicien actif, verifie, avec ses identifiants locaux.
///
/// Le compte est cree ACTIF et VERIFIE : ce que le scenario eprouve commence
/// apres la connexion, et rejouer l'activation par l'ecran n'ajouterait aucune
/// couverture — `inscription-activation.spec.ts` la couvre deja de bout en bout.
/// Meme choix que `creerClientActive` pour le client.
export async function creerTechnicien(
  db: PrismaClient,
  prefixe: string,
): Promise<TechnicienSeme> {
  return creerCompte(db, prefixe, ["ROLE_TECH"]);
}

/// Meme fabrique, pour un role quelconque.
///
/// Sert au scenario du 403, qui a besoin d'un CLIENT authentifie. Il pourrait
/// passer par `creerClientActive` du dossier voisin, mais celui-la traverse tout
/// le formulaire d'inscription pour produire une session dont ce test n'exploite
/// que le cookie - et il laisse le compte derriere lui.
export async function creerCompte(
  db: PrismaClient,
  prefixe: string,
  roles: string[],
): Promise<TechnicienSeme> {
  const email = emailTechnicien(prefixe);

  // Cout 10, comme `src/lib/auth/password.ts` : un cout different produirait un
  // hash que la connexion refuserait, pour une raison invisible au scenario.
  const passwordHash = await bcrypt.hash(MOT_DE_PASSE_TECHNICIEN, 10);

  const technicien = await db.user.create({
    data: {
      email,
      firstname: "Tourneur",
      lastname: "Dessai",
      phone: "+33600000000",
      roles,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });

  // `auth_providers` et non une table « credentials » : le modele dissocie
  // l'identite du mecanisme d'authentification, pour qu'un meme compte porte un
  // provider local et un provider Google sans duplication.
  await db.authProvider.create({
    data: { userId: technicien.id, provider: "local", passwordHash },
  });

  return { id: technicien.id, email };
}

/// Retire un compte seme, ses identifiants et sa trace d'audit.
///
/// Vaut pour un technicien comme pour un client : ce qui est retire est la
/// grappe de lignes qu'un compte de test laisse derriere lui.
///
/// A appeler APRES la suppression des interventions qui le referencent :
/// `interventions.tech_id` et `client_id` sont NOT NULL et leurs FK sont en
/// `ON DELETE RESTRICT`, la contrainte refuserait autrement.
///
/// ⚠️ **`audit_logs` en premier, et ce n'est pas facultatif** : la connexion en
/// ecrit une ligne, `audit_logs.actor_id` porte une FK vers `users`, et sans ce
/// nettoyage la suppression echoue sur `audit_logs_actor_id_fkey`. Constate au
/// premier passage de la barriere. C'est de la donnee de TEST qu'on retire ici,
/// pas une trace de production - la base de developpement est partagee entre les
/// deux postes, et des comptes laisses derriere fausseraient la demonstration
/// suivante.
export async function supprimerCompteSeme(
  db: PrismaClient,
  userId: string,
): Promise<void> {
  await db.auditLog.deleteMany({ where: { actorId: userId } });
  await db.authProvider.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
}

/// Connecte un technicien seme et attend sa tournee.
///
/// Atteindre cette URL prouve trois choses d'un coup : le hash bcrypt a ete
/// compare, la session a ete signee, et `afterLoginPath` route bien le
/// `ROLE_TECH` vers `/interventions/du-jour` — la destination que
/// [[module-1-utilisateurs]] §250 nomme, et que T-V3-03 avait laissee
/// provisoire sur l'accueil.
export async function seConnecterTechnicien(
  page: Page,
  email: string,
): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill(email);
  // `exact` : l'ecran C6 porte une bascule « Afficher le mot de passe », dont le
  // nom accessible contient le libelle du champ.
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(MOT_DE_PASSE_TECHNICIEN);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // Atteindre cette URL prouve d'un coup que le hash bcrypt a ete compare, que
  // la session a ete signee, et qu'`afterLoginPath` route bien le `ROLE_TECH`.
  await expect(page).toHaveURL(/\/interventions\/du-jour$/, {
    timeout: DELAI_CONNEXION_MS,
  });
}

/// Connecte un compte seme SANS presumer de sa destination.
///
/// Le scenario du 403 a besoin d'un client authentifie, et rien de plus : ce
/// qu'il eprouve commence a la navigation suivante. Attendre l'espace client
/// ferait dependre le test du rendu d'un ecran qui n'a rien a voir avec lui.
export async function seConnecterCompte(
  page: Page,
  email: string,
): Promise<void> {
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill(email);
  await page
    .getByLabel("Mot de passe", { exact: true })
    .fill(MOT_DE_PASSE_TECHNICIEN);
  await page.getByRole("button", { name: "Se connecter" }).click();

  // Avoir QUITTE le formulaire est la preuve de session : la destination, elle,
  // depend du role et ne regarde pas l'appelant.
  await expect(page).not.toHaveURL(/\/connexion/, {
    timeout: DELAI_CONNEXION_MS,
  });
}
