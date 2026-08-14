// @vitest-environment node
//
// Inventaire des Server Actions du produit - T-V2-05.
//
// ⚠️ **Ce fichier existe pour une case de DoD qui était fausse, et l'oracle
// qu'elle demande n'est pas celui qu'elle écrivait.** La DoD de T-V2-05 posait
// « les Server Actions des trois vues passent par `techActionClient` », par
// symétrie avec la tournée du jour. Or « Cette semaine » et « Historique » sont
// de purs Server Components : leur en écrire une **fabriquerait deux endpoints
// POST publics sans appelant**, pour cocher une case dont le but est de
// protéger contre les endpoints POST publics. Amendée par Benjamin le
// 2026-08-12, tenue autrement - `requireTech()` dans chaque page, et ce fichier.
//
// Ce qu'il fige : **l'inventaire complet des Server Actions et le client de
// chacune**. Sans lui, « les deux nouvelles vues n'exposent aucune action »
// serait une affirmation de PR, vraie le jour où elle est écrite et invérifiable
// ensuite. Avec lui, en ajouter une fait rougir la suite et force la décision.
//
// ⚠️ Ce test lit le SOURCE. C'est délibéré : la propriété porte sur ce qui est
// exporté, pas sur ce qui est appelé, et rien à l'exécution ne distingue une
// Server Action jamais appelée d'une Server Action absente. Même parti que
// `src/app/globals.test.ts`, qui calcule les contrastes de la feuille de style
// plutôt que de les mesurer sous jsdom.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const RACINE = join(process.cwd(), "src/lib/actions");
const SRC = join(process.cwd(), "src");

/// Tous les modules `"use server"` du dépôt, avec le client sur lequel chaque
/// action exportée est construite.
function inventaire(): Record<string, string[]> {
  const releve: Record<string, string[]> = {};

  for (const domaine of readdirSync(RACINE, { withFileTypes: true })) {
    if (!domaine.isDirectory()) continue;

    for (const fichier of readdirSync(join(RACINE, domaine.name))) {
      if (!fichier.endsWith(".ts") || fichier.includes(".test.")) continue;

      const source = readFileSync(join(RACINE, domaine.name, fichier), "utf8");
      // Toutes les formes d'export d'action : `= xActionClient.action(`,
      // `= xActionClient` suivi d'un `.inputSchema(...)` sur la ligne suivante.
      const clients = [...source.matchAll(/=\s*(\w*[aA]ctionClient)\b/g)].map(
        (occurrence) => occurrence[1] ?? "",
      );

      releve[`${domaine.name}/${fichier}`] = clients;
    }
  }

  return releve;
}

/// ⚠️ **Ajout de l'agent testeur, 2026-08-12 - `inventaire()` ne voit qu'une
/// partie du dépôt, et son commentaire dit « tous les modules `"use server"` ».**
///
/// Trois formes lui échappent, et la troisième est la plus courante en App
/// Router :
///
///   1. un fichier posé à la racine de `src/lib/actions/` (la boucle n'itère que
///      sur les **répertoires**, `domaine.isDirectory()`) ;
///   2. un fichier dans un sous-répertoire de domaine
///      (`interventions/cloture/marquer-faite.ts`) ;
///   3. **une directive `"use server"` inline dans un composant ou une page** -
///      le patron que la documentation Next met en avant pour un `<form action>`
///      simple, et qui produit exactement le même endpoint POST public.
///
/// Le relevé ci-dessous balaie `src/` en entier. Il ne remplace pas
/// `inventaire()`, qui dit **quel client garde quoi** ; il garantit que ce que
/// l'inventaire énumère est bien **tout** ce qui existe. Sans lui, l'oracle
/// « les deux nouvelles vues n'exposent aucune action » ne couvre que les
/// fichiers rangés à un seul endroit précis.
///
/// La détection porte sur la **directive**, pas sur le nom du fichier : c'est
/// elle qui fait d'un module un point d'entrée réseau. Le `^\s*` absorbe
/// l'indentation d'une directive inline et le BOM de
/// `users/supprimer-compte.ts`. Les commentaires qui la citent ne matchent pas,
/// leur ligne commençant par `/`.
const DIRECTIVE_SERVEUR = /^\s*["']use server["']/m;

function modulesUseServer(): string[] {
  const trouves: string[] = [];

  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      const chemin = join(dossier, entree.name);

      if (entree.isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entree.name)) continue;
      // Les fichiers de test ne sont jamais servis : une directive y serait
      // inerte, et plusieurs la citent en commentaire.
      if (entree.name.includes(".test.")) continue;

      if (DIRECTIVE_SERVEUR.test(readFileSync(chemin, "utf8"))) {
        trouves.push(relative(SRC, chemin).split(sep).join("/"));
      }
    }
  };

  parcourir(SRC);
  return trouves.sort();
}

describe("inventaire des Server Actions", () => {
  it("fige la liste complète et le client de chacune", () => {
    // Chaque entrée est une décision de surface. `actionClient` nu n'apparaît
    // qu'UNE fois, et c'est un choix d'axiome : la grille de créneaux est
    // publique, Constitution §3.2 voulant le tunnel explorable sans compte.
    // Toute autre action passe par une garde.
    expect(inventaire()).toEqual({
      "adresses/ajouter-adresse.ts": ["authActionClient"],
      "adresses/supprimer-adresse.ts": ["authActionClient"],
      "adresses/verifier-adresse.ts": ["actionClient"],
      // Deux actions dans le même module : activer, et redemander un lien.
      "auth/activate.ts": ["actionClient", "actionClient"],
      "auth/login.ts": ["actionClient"],
      // `"use server"` sans next-safe-action : la déconnexion n'a aucune
      // entrée à valider, elle efface le cookie et redirige.
      "auth/logout.ts": [],
      "auth/signup.ts": ["actionClient"],
      "interventions/ajouter-photo.ts": ["authActionClient"],
      "interventions/annuler-intervention.ts": ["authActionClient"],
      "interventions/demarrer-intervention.ts": ["techActionClient"],
      "interventions/lister-creneaux.ts": ["actionClient"],
      "interventions/lister-tournee.ts": ["techActionClient"],
      "interventions/reserver.ts": ["authActionClient"],
      "parametres/update-settings.ts": ["adminActionClient"],
      "produits/ajouter-produit.ts": ["authActionClient"],
      // Catalogue de libellés, pas une action.
      "produits/messages.ts": [],
      "produits/retirer-produit.ts": ["authActionClient"],
      "users/supprimer-compte.ts": ["authActionClient"],
    });
  });

  it("n'expose que DEUX actions pour l'espace technicien, une lecture et une transition", () => {
    // 🔴 La propriété que T-V2-05 affirme, **elargie a deux entrees par
    // T-V2-02** et pas relachee. Chacune se justifie une par une :
    //
    //   · `listerTournee` est la `queryFn` du polling de 30 s de la tournée du
    //     jour, la seule des trois vues à en avoir besoin (PLAN S1 §6.1
    //     n'autorise TanStack Query que sur trois vues du produit, dont une
    //     seule est technicien). « Cette semaine » et « Historique » lisent en
    //     RSC, et leurs paramètres vivent dans l'URL ;
    //   · `demarrerIntervention` est une MUTATION, donc une Server Action par
    //     obligation (CLAUDE.md §Server Actions : toutes les mutations y
    //     passent).
    //
    // Aucune action de LECTURE ne doit s'ajouter à cette liste : le détail de
    // T-V2-02 est un Server Component, et une action de lecture y serait un
    // second endpoint POST public sur le carnet d'adresses d'un technicien.
    //
    // Si une action apparaît ici pour les deux vues RSC, ce test rougit : soit
    // elle est gardée et l'inventaire ci-dessus le dira, soit elle ne l'est pas.
    const technicien = Object.entries(inventaire()).filter(([, clients]) =>
      clients.includes("techActionClient"),
    );

    expect(technicien).toEqual([
      ["interventions/demarrer-intervention.ts", ["techActionClient"]],
      ["interventions/lister-tournee.ts", ["techActionClient"]],
    ]);
  });

  it("ne laisse aucune action sur le client nu hors des surfaces anonymes", () => {
    // `actionClient` sans middleware n'authentifie rien, et chacun de ces cinq
    // modules doit être postable par un anonyme - c'est leur objet même :
    //
    //   · `login` et `signup`, évidemment ;
    //   · `activate`, atteint depuis un lien d'email, donc sans session ;
    //   · `verifier-adresse` et `lister-creneaux`, les deux étapes du tunnel
    //     que Constitution §3.2 veut explorables sans compte.
    //
    // Une sixième occurrence serait presque sûrement un oubli de garde, et
    // c'est exactement ce que ce test attrape.
    const nues = Object.entries(inventaire())
      .filter(([, clients]) => clients.includes("actionClient"))
      .map(([chemin]) => chemin);

    expect(nues.sort()).toEqual([
      "adresses/verifier-adresse.ts",
      "auth/activate.ts",
      "auth/login.ts",
      "auth/signup.ts",
      "interventions/lister-creneaux.ts",
    ]);
  });

  it("ne laisse AUCUNE directive `use server` hors de `src/lib/actions/<domaine>/`", () => {
    // 🔴 Sans cette propriété, l'inventaire ci-dessus se contourne sans le
    // vouloir : un `"use server"` inline dans une page ou un composant crée un
    // endpoint POST public que `inventaire()` ne balaie pas, et l'oracle
    // « les deux nouvelles vues n'exposent aucune action » resterait vert.
    //
    // C'est un patron courant en App Router - la documentation Next le
    // recommande pour un `<form action>` simple - et il court-circuiterait
    // `next-safe-action`, donc `techActionClient`, donc `requireTech()`.
    // CLAUDE.md §Server Actions impose le contraire : « wrapper chaque action
    // avec input dans `next-safe-action` », schémas dans `lib/validations/`.
    for (const chemin of modulesUseServer()) {
      expect(chemin).toMatch(/^lib\/actions\/[a-z-]+\/[a-z-]+\.ts$/);
    }
  });

  it("énumère TOUT ce qui porte la directive, sans angle mort de rangement", () => {
    // La contrepartie du test précédent, et la garantie que l'inventaire est
    // exhaustif plutôt que simplement exact : `inventaire()` n'itère que sur
    // les **répertoires** de `src/lib/actions/` et ne descend que d'un cran.
    // Un fichier posé à la racine du dossier, ou dans un sous-dossier de
    // domaine, échapperait à ses trois oracles sans en faire rougir aucun.
    const inventories = new Set(Object.keys(inventaire()));

    for (const chemin of modulesUseServer()) {
      expect(inventories).toContain(chemin.replace(/^lib\/actions\//, ""));
    }
  });
});
