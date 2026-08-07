import { expect, test, type Page } from "@playwright/test";

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

async function seConnecter(page: Page) {
  // Jamais `/`, qui est prérendue statiquement (`x-nextjs-cache: HIT`,
  // `x-nextjs-prerender: 1`) : elle répond 200 même base éteinte, et ne
  // prouverait donc rien du déploiement.
  await page.goto("/connexion");
  await page.getByLabel("Adresse email").fill(ADMIN_EMAIL);
  await page.getByLabel("Mot de passe").fill(motDePasseAdmin());
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin\/parametres$/);
}

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
