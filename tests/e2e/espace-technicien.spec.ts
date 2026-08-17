import { PrismaClient } from "@prisma/client";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  ajouterJours,
  instantUtc,
  jourLocal,
} from "../../src/lib/creneaux/horaires";
import {
  creerCompte,
  creerTechnicien,
  seConnecterCompte,
  seConnecterTechnicien,
  supprimerCompteSeme,
  type TechnicienSeme,
} from "../support/compte-technicien";

/// Espace technicien - `US-INTERVENTIONS-LISTER-TECH-A-VENIR`,
/// `US-INTERVENTIONS-LISTER-TECH-PASSEES` (promues en v1 le 2026-08-12), plus
/// le cloisonnement de [[01-constitution-hch|Constitution]] §3.1 clarifie le
/// meme jour. Ecran **T1** et ses deux declinaisons.
///
/// Ce fichier ne rejoue pas ce que les tests co-localises couvrent deja (les
/// bornes de fenetre, la projection, l'ordre des roles dans la navigation). Il
/// eprouve ce qu'un mock ne peut PAS eprouver :
///
///   · **le 403 sur l'espace client**, rendu par `forbidden()` au bout de la
///     chaine reelle - cookie, DAL, garde de page ;
///   · **les routes qui restent OUVERTES** a un technicien,
///     `/mon-compte/supprimer` et `/reserver`, que rien d'autre ne protege
///     d'une fermeture par inadvertance ;
///   · **la navigation d'un technicien**, qui ne doit proposer ni l'espace
///     client ni la reservation ;
///   · **les trois onglets** rendant chacun leur perimetre sur une vraie base,
///     avec les bornes de jour d'un `timestamptz` reel.
///
/// ⚠️ **Techniciens dedies, semes par ce fichier, sans affectation de zone** -
/// meme mecanique que `tournee-du-jour.spec.ts` (cadrage du plancher V2, D7).
/// La derivation des creneaux ne lit que les techniciens affectes a la zone du
/// client : ces comptes sont structurellement injoignables par le tunnel, donc
/// `gp-02` ne peut pas deposer une reservation dans leur tournee.

let db: PrismaClient;
let tech: TechnicienSeme;
let clientId: string;
let serviceId: number;
let addressId: number;

const interventionsCreees: number[] = [];
const adressesCreees: number[] = [];
const utilisateursCreees: string[] = [];

/// Instant UTC correspondant a une heure murale de PARIS, le jour demande.
///
/// Les memes helpers que le code de production : un `setUTCHours` en dur
/// poserait le rendez-vous deux heures a cote en ete, et le test passerait ou
/// echouerait selon la saison.
function quandLocal(heure: number, decalageJours = 0) {
  const jour = ajouterJours(jourLocal(new Date()), decalageJours);
  return instantUtc(jour, heure * 60);
}

async function semerIntervention(options: {
  heure: number;
  decalageJours: number;
  status?: string;
}): Promise<number> {
  const service = await db.service.findUniqueOrThrow({
    where: { id: serviceId },
  });

  const intervention = await db.intervention.create({
    data: {
      status: options.status ?? "PLANNED",
      appointmentAt: quandLocal(options.heure, options.decalageJours),
      priceSnapshot: service.price,
      durationSnapshot: service.duration,
      clientId,
      techId: tech.id,
      addressId,
      serviceId,
    },
    select: { id: true },
  });

  interventionsCreees.push(intervention.id);
  return intervention.id;
}

test.beforeAll(async () => {
  db = new PrismaClient();

  const service = await db.service.findFirstOrThrow({
    where: { isActive: true },
  });
  serviceId = service.id;

  const client = await db.user.create({
    data: {
      email: `client-espace-tech-${Date.now().toString(36)}@example.test`,
      firstname: "Amine",
      lastname: "Torres",
      phone: "+33655443322",
      roles: ["ROLE_CLIENT"],
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  clientId = client.id;
  utilisateursCreees.push(client.id);

  const ville = await db.city.findFirstOrThrow();
  const adresse = await db.$queryRaw<{ id: number }[]>`
    INSERT INTO addresses (street, city_id, location, is_active)
    VALUES ('4 quai Tres Distinctif', ${ville.id},
            ST_SetSRID(ST_MakePoint(4.8357, 45.7640), 4326)::geography, true)
    RETURNING id
  `;
  addressId = adresse[0]!.id;
  adressesCreees.push(addressId);

  tech = await creerTechnicien(db, "espace");
  utilisateursCreees.push(tech.id);

  // Une par vue, et une seule : c'est ce qui rend les trois oracles de
  // perimetre lisibles. AUJOURD'HUI a 09 h, DEMAIN a 10 h, HIER en `DONE`.
  await semerIntervention({ heure: 9, decalageJours: 0 });
  await semerIntervention({ heure: 10, decalageJours: 1 });
  await semerIntervention({ heure: 11, decalageJours: -1, status: "DONE" });

  // ⚠️ Hors des SEPT jours mais dans les trente : c'est ce qui distingue
  // reellement les deux fenetres du selecteur. Sans elle, `?jours=30` ne
  // prouverait rien de plus que `?jours=7`.
  await semerIntervention({ heure: 12, decalageJours: 20 });
});

test.afterAll(async () => {
  await db.intervention.deleteMany({
    where: { id: { in: interventionsCreees } },
  });
  await db.address.deleteMany({ where: { id: { in: adressesCreees } } });
  // Apres les interventions : `tech_id` et `client_id` sont NOT NULL et leurs
  // FK sont en `ON DELETE RESTRICT`.
  for (const id of utilisateursCreees) {
    await supprimerCompteSeme(db, id);
  }
  await db.$disconnect();
});

/// Les lignes d'une vue, et elles seules.
///
/// ⚠️ Un `getByRole("listitem")` nu en ramasse une dizaine : l'en-tete du site,
/// le pied de page et la barre laterale portent tous des listes. La lecon vient
/// de `tournee-du-jour.spec.ts`, ou l'oracle mesurait la coquille du site.
function lignes(page: Page, region: string) {
  return page.getByRole("region", { name: region }).getByRole("listitem");
}

test.describe("le cloisonnement des espaces", () => {
  test("un technicien recoit 403 sur l'espace client", async ({ page }) => {
    // 🔴 Le coeur de la decision. Constitution §3.1, clarification datee du
    // 2026-08-12 : « exclusifs » vaut aussi pour les espaces, pas seulement
    // pour les prerogatives. Les deux pages n'avaient jusque-la AUCUNE garde de
    // role, et un commentaire justifiait l'inverse.
    await seConnecterTechnicien(page, tech.email);

    for (const route of [
      "/mes-interventions/a-venir",
      "/mes-interventions/passees",
    ]) {
      const reponse = await page.goto(route);

      expect(reponse?.status()).toBe(403);
    }
  });

  test("un administrateur aussi", async ({ page }) => {
    const admin = await creerCompte(db, "admin-403", ["ROLE_ADMIN"]);
    utilisateursCreees.push(admin.id);
    await seConnecterCompte(page, admin.email);

    const reponse = await page.goto("/mes-interventions/a-venir");

    expect(reponse?.status()).toBe(403);
  });

  test("un client garde son espace", async ({ page }) => {
    // Le controle positif : sans lui, un 403 rendu a tout le monde - une garde
    // trop large, une regression du DAL - passerait pour un succes.
    const client = await creerCompte(db, "client-ok", ["ROLE_CLIENT"]);
    utilisateursCreees.push(client.id);
    await seConnecterCompte(page, client.email);

    const reponse = await page.goto("/mes-interventions/a-venir");

    expect(reponse?.status()).toBe(200);
  });

  test("`/mon-compte/supprimer` reste ouvert a un technicien", async ({
    page,
  }) => {
    // ⚠️ **Non negociable, et c'est la moitie de la decision.** Le droit a
    // l'oubli n'est pas un parcours client mais un droit de toute personne
    // fichee, et T-V3-12 a construit cette route pour ne dependre de rien. La
    // fermer par symetrie avec `/mes-interventions` serait une faute.
    await seConnecterTechnicien(page, tech.email);

    const reponse = await page.goto("/mon-compte/supprimer");

    expect(reponse?.status()).toBe(200);
  });

  test("`/mon-compte/supprimer` reste ouvert a un administrateur aussi", async ({
    page,
  }) => {
    // ⚠️ Le droit a l'oubli est un droit de toute personne fichee, pas d'un
    // role : cette route reste ouverte quand `/mon-compte/cycles` est fermee
    // (Constitution §3.1, amendee le 2026-08-14). Une garde ajoutee ici par
    // symetrie avec `/mes-interventions` serait une faute que rien d'autre ne
    // signalerait.
    const admin = await creerCompte(db, "admin-compte", ["ROLE_ADMIN"]);
    utilisateursCreees.push(admin.id);
    await seConnecterCompte(page, admin.email);

    const reponse = await page.goto("/mon-compte/supprimer");

    expect(reponse?.status()).toBe(200);
  });

  test("aucun lien de `/mon-compte/supprimer` ne mene a un refus", async ({
    page,
  }) => {
    // 🔴 **ROUGE a l'ecriture - constat n°1 de l'agent testeur, 2026-08-12.**
    //
    // La route est OUVERTE au technicien, et c'est la moitie de la decision -
    // le test voisin la fige. Mais la page rend inconditionnellement un bouton
    // « Retour a mes interventions » vers `CHEMIN_ESPACE_CLIENT`
    // (`src/app/(app)/mon-compte/supprimer/page.tsx:42`), qui repond desormais
    // 403 a ce meme technicien. Le seul chemin de sortie que la page propose
    // mene donc a un refus.
    //
    // Ce n'est pas une remarque de style : c'est la regle que le produit
    // s'applique deja ailleurs, mot pour mot. `user-menu.tsx` a ete rebranche
    // par cette tache exactement pour ce motif - « un lien qui mene a un refus
    // est pire qu'un lien absent » - et la barre laterale de l'espace client
    // n'a qu'une entree au nom de la lecon `T-T2-16`, aucun lien mort dans une
    // navigation permanente. La garde de role a ferme l'espace ; les liens qui
    // y menaient depuis les routes restees OUVERTES n'ont pas suivi.
    //
    // ⚠️ Le rendre vert n'est pas l'affaire de l'agent testeur : le correctif
    // vit dans du code de production.
    await seConnecterTechnicien(page, tech.email);
    await page.goto("/mon-compte/supprimer");

    const cibles = await page
      .getByRole("link")
      .evaluateAll((liens) =>
        liens.map((lien) => lien.getAttribute("href") ?? ""),
      );

    expect(
      cibles.filter((href) => href.startsWith("/mes-interventions")),
    ).toEqual([]);
  });

  test("`/reserver` reste ouvert a un technicien", async ({ page }) => {
    // Constitution §3.2 veut le tunnel explorable sans compte : y poser un 403
    // par role contredirait un second axiome. Ce qui disparait est l'appel a
    // l'action dans la navigation, pas l'acces.
    await seConnecterTechnicien(page, tech.email);

    const reponse = await page.goto("/reserver");

    expect(reponse?.status()).toBe(200);
  });
});

test.describe("la navigation d'un technicien", () => {
  test("ne propose ni l'espace client ni la reservation", async ({ page }) => {
    await seConnecterTechnicien(page, tech.email);

    const entete = page.getByRole("banner");

    await expect(
      entete.getByRole("link", { name: "Ma tournée" }),
    ).toBeVisible();
    await expect(
      entete.getByRole("link", { name: "Mes interventions" }),
    ).toHaveCount(0);
    await expect(entete.getByRole("link", { name: "Réserver" })).toHaveCount(0);
  });

  test("le menu utilisateur mene a la tournee, pas a l'espace client", async ({
    page,
  }) => {
    await seConnecterTechnicien(page, tech.email);

    await page.getByRole("button", { name: /Ouvrir le menu de/ }).click();

    await expect(
      page.getByRole("menuitem", { name: "Ma tournée" }),
    ).toHaveAttribute("href", "/interventions/du-jour");
  });

  test("la barre laterale porte les trois vues, et rien de plus", async ({
    page,
  }) => {
    await seConnecterTechnicien(page, tech.email);

    const barre = page.getByRole("navigation", { name: "Espace technicien" });

    await expect(barre.getByRole("link")).toHaveText([
      "Aujourd'hui",
      "Cette semaine",
      "Historique",
    ]);
  });
});

test.describe("les trois vues rendent chacune leur perimetre", () => {
  test("« Aujourd'hui » ne montre que la journee en cours", async ({
    page,
  }) => {
    await seConnecterTechnicien(page, tech.email);

    await expect(lignes(page, "Mes interventions du jour")).toHaveCount(1);
    await expect(page.getByText("1 intervention")).toBeVisible();
  });

  test("« Cette semaine » commence DEMAIN et exclut aujourd'hui", async ({
    page,
  }) => {
    // La propriete que la DoD nomme : aujourd'hui a son propre onglet, et une
    // fenetre partant de maintenant ferait dire deux choses aux deux vues sur
    // les memes lignes.
    await seConnecterTechnicien(page, tech.email);
    await page.goto("/interventions/a-venir");

    await expect(
      page.getByRole("heading", { level: 1, name: "Les 7 prochains jours" }),
    ).toBeVisible();

    const semaine = page.getByRole("listitem");
    await expect(semaine.filter({ hasText: "Amine Torres" })).toHaveCount(1);
  });

  test("le selecteur 30 jours elargit reellement la fenetre", async ({
    page,
  }) => {
    await seConnecterTechnicien(page, tech.email);
    await page.goto("/interventions/a-venir?jours=30");

    await expect(
      page.getByRole("heading", { level: 1, name: "Les 30 prochains jours" }),
    ).toBeVisible();
    // Celle de J+20 s'ajoute a celle de demain.
    await expect(
      page.getByRole("listitem").filter({ hasText: "Amine Torres" }),
    ).toHaveCount(2);
  });

  test("une fenetre bricolee dans l'URL retombe sur sept jours", async ({
    page,
  }) => {
    // Le parametre vient de l'URL, donc de n'importe qui. Il est ENUMERE, donc
    // il n'y a rien a borner : ce qui n'est pas 7 ou 30 est 7.
    await seConnecterTechnicien(page, tech.email);
    await page.goto("/interventions/a-venir?jours=99999");

    await expect(
      page.getByRole("heading", { level: 1, name: "Les 7 prochains jours" }),
    ).toBeVisible();
  });

  test("« Historique » ne montre que les statuts terminaux", async ({
    page,
  }) => {
    await seConnecterTechnicien(page, tech.email);
    await page.goto("/interventions/passees");

    await expect(lignes(page, "Mes interventions passées")).toHaveCount(1);
    await expect(page.getByText("Terminée")).toBeVisible();
  });

  test("un client n'atteint aucune des deux vues neuves", async ({ page }) => {
    const client = await creerCompte(db, "client-403", ["ROLE_CLIENT"]);
    utilisateursCreees.push(client.id);
    await seConnecterCompte(page, client.email);

    for (const route of ["/interventions/a-venir", "/interventions/passees"]) {
      const reponse = await page.goto(route);

      expect(reponse?.status()).toBe(403);
      // Et surtout : aucune donnee de client tiers n'a fuite dans la reponse.
      await expect(page.locator("body")).not.toContainText("+33655443322");
    }
  });

  test("un visiteur anonyme est renvoye vers la connexion avec son `next`", async ({
    page,
  }) => {
    await page.context().clearCookies();

    await page.goto("/interventions/a-venir");

    await expect(page).toHaveURL(
      /\/connexion\?next=%2Finterventions%2Fa-venir$/,
    );
  });
});

test.describe("la navigation de l'espace en dessous de 768 px", () => {
  // ⚠️ **Ajout de l'agent testeur, 2026-08-12.** Les deux surfaces de navigation
  // de cet espace sont mutuellement exclusives par media query - la barre
  // laterale est `hidden md:block`, les onglets sont `md:hidden` - et tous les
  // scenarios ci-dessus, comme les deux scans axe, tournent au viewport par
  // defaut de Playwright (1280 px). **La moitie mobile n'est donc eprouvee nulle
  // part au navigateur** : ses tests co-localises rendent le composant hors de
  // sa page, ou aucune media query ne s'applique.
  //
  // Ce que ca laisse passer : une inversion des deux classes, ou une seconde
  // regle qui masquerait les deux, produirait un espace technicien SANS aucune
  // navigation sur telephone - et c'est le trou de la maquette T1 que la DoD
  // demande precisement de combler. Le parcours technicien se vit sur le
  // terrain.
  test.use({ viewport: { width: 390, height: 844 } });

  test("les onglets remplacent la barre laterale, et pas l'inverse", async ({
    page,
  }) => {
    await seConnecterTechnicien(page, tech.email);

    await expect(
      page.getByRole("navigation", { name: "Mes interventions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Espace technicien" }),
    ).toBeHidden();
  });

  test("les trois vues restent atteignables au doigt", async ({ page }) => {
    await seConnecterTechnicien(page, tech.email);

    const onglets = page.getByRole("navigation", { name: "Mes interventions" });

    await onglets.getByRole("link", { name: "Cette semaine" }).click();
    await expect(page).toHaveURL(/\/interventions\/a-venir$/);

    await onglets.getByRole("link", { name: "Historique" }).click();
    await expect(page).toHaveURL(/\/interventions\/passees$/);
    await expect(
      onglets.getByRole("link", { name: "Historique" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("les trois vues ne presentent aucune violation de niveau A en mobile", async ({
    page,
  }) => {
    await seConnecterTechnicien(page, tech.email);

    for (const route of [
      "/interventions/du-jour",
      "/interventions/a-venir",
      "/interventions/passees",
    ]) {
      await page.goto(route);

      const resultats = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag21a"])
        .analyze();

      expect(resultats.violations, `violations sur ${route} en 390 px`).toEqual(
        [],
      );
    }
  });
});

test.describe("la carte, quand elle est reellement montee", () => {
  // ⚠️ **Ajout de l'agent testeur, 2026-08-12, et il est CONDITIONNEL.**
  //
  // `HCH_MAPS_API_KEY` est facultative et n'est posee ni dans
  // `docker-compose.test.yml` ni dans le workflow : en CI la carte n'est pas
  // montee du tout, et le repli - la liste - est ce que la barriere eprouve.
  // Une assertion inconditionnelle rougirait donc a chaque run de la barriere,
  // pour un motif qui n'est pas dans le depot.
  //
  // Ce que ce scenario apporte la ou une cle EST renseignee : le double de
  // `carte-tournee.test.tsx` **suppose** que l'API injecte des commandes
  // focusables (`injecteSesCommandes`), et c'est sur cette supposition que
  // reposent l'anti-retour de B2 et le choix de `language=fr`. Ici, c'est la
  // vraie API qui repond.
  //
  // 🔎 Ce que ce test ne peut PAS prouver, en local comme en CI : le rendu des
  // tuiles. Le journal du serveur affiche `RefererNotAllowedMapError` -
  // `http://localhost:3000` n'est pas dans les referers autorises de la cle. Le
  // script charge, le rappel part, `new google.maps.Map` construit : le chemin
  // NOMINAL du module est donc bien exerce. L'affichage, lui, ne l'est pas.
  test("se construit pour de vrai, et ne masque rien", async ({ page }) => {
    await seConnecterTechnicien(page, tech.email);

    const carte = page.getByRole("region", { name: "Carte de la tournée" });

    test.skip(
      (await carte.count()) === 0,
      "HCH_MAPS_API_KEY absente de cet environnement - la liste sert de repli, cf. DoD T-V2-01 case 11",
    );

    // Le message de chargement disparait quand `setPret(true)` passe, donc
    // APRES le rappel `callback=`, `new google.maps.Map`, la pose des marqueurs
    // et `fitBounds`. C'est tout le chemin nominal du module, celui que la DoD
    // de T-V2-01 declarait « jamais execute ». Le voir vert ici est ce qui
    // aurait attrape `google.maps.Map is not a constructor`.
    await expect(page.getByText(/Chargement de la carte/)).toBeHidden();

    // 🔴 L'anti-retour de B2, contre l'API reelle et non contre un double :
    // rien de masque dans la region. Reposer `aria-hidden` ou `inert` dessus
    // ramenerait `aria-hidden-focus` (axe, wcag2a, SC 4.1.2) des l'instant ou
    // l'API injecte ses commandes.
    await expect(carte.locator("[aria-hidden='true']")).toHaveCount(0);
    await expect(carte.locator("[inert]")).toHaveCount(0);
  });

  // 🔎 **Ce que ce fichier NE prouve PAS, mesure de l'agent testeur du
  // 2026-08-12 - a lire avant de croire la carte couverte.**
  //
  // La cle du poste refuse `http://localhost:3000` :
  // `RefererNotAllowedMapError` dans la console a chaque chargement. L'API
  // construit quand meme la carte - c'est ce que le scenario ci-dessus
  // constate - mais elle **n'injecte AUCUNE commande** : un
  // `carte.getByRole("button")` en compte **zero**, mesure faite. Restent donc
  // sans oracle, en local comme en CI :
  //
  //   1. **le rendu des tuiles** - rien ne distingue une carte qui s'affiche
  //      d'un cadre gris surmonte de l'avertissement de Google ;
  //   2. **les commandes de zoom et de plein ecran**, donc leur atteignabilite
  //      au clavier et leurs libelles. `carte-tournee.test.tsx` les SIMULE
  //      (`injecteSesCommandes`) : c'est une hypothese sur l'API, pas une
  //      observation ;
  //   3. **l'effet de `language=fr`** - le test unitaire verifie le PARAMETRE
  //      d'URL, jamais les noms accessibles que l'API en tire ;
  //   4. **les deux scans axe de `/interventions/du-jour`** n'auditent par
  //      consequent aucune commande : ils passent sur une region vide.
  //
  // Les quatre se ferment d'un coup en autorisant le referer dans la console
  // Google - travail hors depot, deja nomme par la DoD de T-V2-01 case 11. Y
  // adosser un test avant cela produirait soit un rouge permanent, soit un skip
  // dont la condition serait indistinguable d'une regression.
});

test.describe("RGAA A sur les deux vues neuves", () => {
  for (const [libelle, route] of [
    ["Cette semaine", "/interventions/a-venir"],
    ["Historique", "/interventions/passees"],
  ] as const) {
    test(`« ${libelle} » ne presente aucune violation de niveau A`, async ({
      page,
    }) => {
      await seConnecterTechnicien(page, tech.email);
      await page.goto(route);

      const resultats = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag21a"])
        .analyze();

      expect(resultats.violations).toEqual([]);
    });
  }
});
