// @vitest-environment node
//
// Navigation de l'espace d'administration.
//
// Fichier promis par le plan validé de T-B1-01 et absent du livré, relevé par
// la session vérificatrice (constat É1, puis F4 point 3). Le module était
// couvert de biais par `coquille-espace-admin.test.tsx`, qui rend le composant
// et vérifie les deux entrées livrées.
//
// Ce qu'un oracle direct ajoute, et qui compte pour les onze écrans à venir :
// la navigation ne doit jamais désigner une route qui n'existe pas. Chaque
// tâche d'administration ajoutera une entrée ici, et la page qui va avec est
// écrite dans la même PR ou ne l'est pas - un lien mort dans une navigation
// permanente promet un écran que personne ne livrera.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CHEMIN_ADMIN_FORFAITS, CHEMIN_ADMIN_PARAMETRES } from "@/lib/routes";

import { NAV_ADMIN } from "./admin-navigation";

/// `src/app/(app)` : le groupe de routes ne figure pas dans l'URL, c'est donc
/// lui qu'il faut ajouter au chemin du disque pour retrouver la page d'un
/// `href`.
const RACINE_ROUTES = join(process.cwd(), "src", "app", "(app)");

describe("NAV_ADMIN, les entrées livrées", () => {
  it("mène aux deux segments de l'espace, et à rien d'autre", () => {
    expect(NAV_ADMIN.map((entree) => entree.href)).toEqual([
      CHEMIN_ADMIN_FORFAITS,
      CHEMIN_ADMIN_PARAMETRES,
    ]);
  });

  it("nomme chaque entrée pour l'humain, pas par son segment", () => {
    // Le libellé est ce que l'administrateur lit ; le segment est ce que la
    // coquille compare pour marquer `aria-current`. Les confondre afficherait
    // « forfaits » en minuscules dans la barre latérale.
    expect(NAV_ADMIN.map((entree) => entree.libelle)).toEqual([
      "Forfaits",
      "Paramètres",
    ]);
  });

  it("ne porte pas deux fois le même segment", () => {
    // Deux entrées de même segment rendraient `aria-current="page"` sur les
    // deux à la fois, et le lecteur d'écran annoncerait deux pages courantes.
    const segments = NAV_ADMIN.map((entree) => entree.segment);
    expect(new Set(segments).size).toBe(segments.length);
  });
});

describe("NAV_ADMIN, aucune entrée morte", () => {
  it("ne désigne que des routes qui existent sur le disque", () => {
    // L'invariant que le module revendique en commentaire : « elle ne porte
    // que ce qui existe ». Sans ce test, c'est une intention.
    const manquantes = NAV_ADMIN.filter(
      (entree) => !existsSync(join(RACINE_ROUTES, entree.href, "page.tsx")),
    );

    expect(manquantes.map((entree) => entree.href)).toEqual([]);
  });

  it("garde le chemin de recherche honnête", () => {
    // Contrôle du contrôle : si `RACINE_ROUTES` devenait faux - renommage du
    // groupe de routes, exécution depuis un autre répertoire - le test
    // précédent passerait en ne trouvant rien, et deviendrait muet.
    //
    // ⚠️ Le négatif vise un segment qui n'existera JAMAIS, pas une route du
    // backlog : écrit sur `admin/zones`, ce test rougissait le jour où cet
    // écran serait livré, pour une raison étrangère à son intention. Relevé
    // par l'agent testeur (B4).
    expect(
      existsSync(join(RACINE_ROUTES, "admin", "forfaits", "page.tsx")),
    ).toBe(true);
    expect(
      existsSync(join(RACINE_ROUTES, "admin", "__inexistant__", "page.tsx")),
    ).toBe(false);
  });

  it("reste sous le préfixe que `src/proxy.ts` protège", () => {
    // `/admin/` est l'un des six préfixes du `config.matcher`. Une entrée
    // posée ailleurs serait une surface d'administration hors du redirect
    // optimiste.
    for (const entree of NAV_ADMIN) {
      expect(entree.href.startsWith("/admin/")).toBe(true);
    }
  });
});
