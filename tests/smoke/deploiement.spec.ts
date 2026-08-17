import { expect, test, type Page } from "@playwright/test";

import { seConnecter as seConnecterAdmin } from "../support/connexion";

/// Smoke post-déploiement — tourne en STEP des jobs `deploy-staging` et
/// `deploy-prod`, contre l'environnement réellement servi : nginx, TLS,
/// `auth_basic` côté staging, vraie base, résolution du conteneur par le
/// réseau Docker. C'est la surface que la barrière (`tests/e2e/`) ne voit pas.
///
/// Steps et non jobs : un job qui déclare `environment: production`
/// redéclenche la porte d'approbation, et le même run en demanderait une
/// seconde (cadrage T-J0-09).
///
/// Aucune requête Prisma ici, contrairement à la barrière : les bases staging
/// et production vivent sur `hch_<env>_internal` sans port publié, invisibles
/// du runner comme d'internet (PLAN S3 §2). Ce smoke ne prouve que ce qui
/// passe par HTTP — et c'est exactement son objet.

const MODES = ["write", "read"] as const;
type SmokeMode = (typeof MODES)[number];

/// `write` sur staging, `read` sur production.
///
/// La production est en LECTURE SEULE par décision du cadrage du 2026-08-07 :
/// un test qui écrit en production à chaque déploiement laisse une donnée que
/// rien ne nettoie — le seed *établit* sans *rétablir*, il n'y a pas de
/// teardown fiable (concurrence sur `app_settings` sans verrou), et une clé de
/// sonde dédiée apparaîtrait dans l'écran d'administration, dont le formulaire
/// est générique.
function smokeMode(): SmokeMode {
  const brut = process.env["HCH_SMOKE_MODE"];
  if (!brut || !(MODES as readonly string[]).includes(brut)) {
    throw new Error(
      `HCH_SMOKE_MODE doit valoir ${MODES.join(" ou ")} — reçu : ${brut ?? "rien"}`,
    );
  }
  return brut as SmokeMode;
}

const ADMIN_EMAIL = "admin@homecyclhome.fr";
const LIBELLE = "Téléphone affiché aux clients";

function motDePasseAdmin(): string {
  const password = process.env["SEED_ADMIN_PASSWORD"];
  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD absente. Le seed rafraîchit le hash à CHAQUE " +
        "déploiement : la valeur doit être celle du .env.prod de la pile visée, " +
        "portée par le secret de l'Environment correspondant.",
    );
  }
  return password;
}

/// La séquence vit dans `tests/support/connexion.ts`, partagée avec la
/// barrière : c'est le même oracle des deux côtés, et le dupliquer le ferait
/// diverger.
///
/// Elle passe par `/connexion` et jamais par `/`, qui est prérendue
/// statiquement (`x-nextjs-cache: HIT`, `x-nextjs-prerender: 1`) : `/` répond
/// 200 base éteinte et ne prouverait rien du déploiement.
async function seConnecter(page: Page) {
  await seConnecterAdmin(page, ADMIN_EMAIL, motDePasseAdmin());
}

/// Empreinte des dates de dernière modification, telles que l'écran les rend
/// (`<time datetime>` de `settings-form.tsx`). C'est la seule observation d'une
/// écriture accessible en HTTP seul : les bases déployées ne sont joignables ni
/// du runner ni d'internet.
async function empreinteDesDates(page: Page): Promise<string[]> {
  return page
    .locator("time")
    .evaluateAll((noeuds) =>
      noeuds.map((n) => n.getAttribute("datetime") ?? ""),
    );
}

/// Partagée entre le premier et le dernier test du fichier. `workers: 1` et
/// `fullyParallel: false` (playwright.config.ts) garantissent l'ordre et le
/// process unique ; le test final vérifie explicitement que l'empreinte a bien
/// été prise, pour qu'un changement de configuration rende ce garde ROUGE au
/// lieu de le rendre muet.
let empreinteInitiale: string[] | null = null;

/// La lecture seule de production était
/// garantie par la seule absence d'écriture dans les tests — une propriété
/// négative, qu'aucune assertion ne tenait. Ces deux tests l'énoncent :
/// après le passage complet du smoke, aucune ligne d'`app_settings` n'a bougé.
///
/// Limite assumée : ils ne couvrent qu'`app_settings`. Une écriture ailleurs
/// (un `last_login_at` posé au login, par exemple) resterait invisible d'ici.
test("lecture seule — empreinte des paramètres avant le smoke", async ({
  page,
}) => {
  test.skip(
    smokeMode() === "write",
    "staging écrit — l'empreinte n'a pas de sens",
  );

  await seConnecter(page);
  empreinteInitiale = await empreinteDesDates(page);
  expect(empreinteInitiale.length).toBeGreaterThan(0);
});

test("l'administrateur seedé se connecte et lit un paramètre société", async ({
  page,
}) => {
  await seConnecter(page);

  // Atteindre cette valeur exige toute la chaîne : bcrypt comparé en base,
  // session signée, `requireAdmin()` franchi, puis une lecture Prisma dans un
  // Server Component. Un conteneur qui répond mais ne joint pas sa base
  // n'arrive pas jusqu'ici.
  const champ = page.getByLabel(LIBELLE);
  await expect(champ).toBeVisible();
  await expect(champ).not.toHaveValue("");
});

test("l'administrateur seedé modifie un paramètre société", async ({
  page,
}) => {
  test.skip(
    smokeMode() === "read",
    "production en lecture seule — aucune écriture, aucune entrée audit_logs",
  );

  await seConnecter(page);

  // Plage de fiction ARCEP, comme le seed. La valeur posée reste après le run :
  // assumé, staging est fait pour ça.
  const valeurAttendue = `+3363998${String(Date.now()).slice(-4)}`;

  await page.getByLabel(LIBELLE).fill(valeurAttendue);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status")).toHaveText(
    /Modifications enregistrées/,
  );

  await page.reload();
  await expect(page.getByLabel(LIBELLE)).toHaveValue(valeurAttendue);
});

test("lecture seule — aucune date de modification n'a bougé", async ({
  page,
}) => {
  test.skip(
    smokeMode() === "write",
    "staging écrit — l'empreinte n'a pas de sens",
  );

  // Si l'empreinte est absente, l'ordre d'exécution a changé et ce garde ne
  // garde plus rien. On échoue plutôt que de passer au vert par vacuité.
  expect(
    empreinteInitiale,
    "empreinte initiale non prise — l'ordre des tests du fichier a changé",
  ).not.toBeNull();

  await seConnecter(page);
  expect(await empreinteDesDates(page)).toEqual(empreinteInitiale);
});
