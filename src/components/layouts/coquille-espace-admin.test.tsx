// Coquille du back-office. Ce qu'elle garantit et qui ne se voit nulle part
// ailleurs : la barre ne porte **que des routes qui existent**, et l'entrée
// courante est annoncée autrement que par une couleur.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { NAV_ADMIN } from "./admin-navigation";
import { CoquilleEspaceAdmin } from "./coquille-espace-admin";

describe("CoquilleEspaceAdmin", () => {
  it("rend le contenu de la page qu'elle enveloppe", () => {
    render(
      <CoquilleEspaceAdmin actif="forfaits">
        <p>Catalogue</p>
      </CoquilleEspaceAdmin>,
    );

    expect(screen.getByText("Catalogue")).toBeInTheDocument();
  });

  it("marque l'entrée courante pour le lecteur d'écran", () => {
    // `aria-current` et non une classe seule : la couleur ne dit rien, et deux
    // entrées ne peuvent pas être courantes.
    render(
      <CoquilleEspaceAdmin actif="parametres">
        <p>Config</p>
      </CoquilleEspaceAdmin>,
    );

    expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Forfaits" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("ne porte aucune entrée au-delà des routes qui existent", () => {
    // La maquette A3 en dessine sept, cinq n'ont pas de route. Un lien mort
    // dans une navigation permanente promet un écran que personne ne livrera.
    render(
      <CoquilleEspaceAdmin actif="forfaits">
        <p>Catalogue</p>
      </CoquilleEspaceAdmin>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Administration",
    });
    expect(screen.getAllByRole("link")).toHaveLength(NAV_ADMIN.length);
    expect(navigation).toBeInTheDocument();
  });

  it("mène aux deux segments livrés", () => {
    render(
      <CoquilleEspaceAdmin actif="forfaits">
        <p>Catalogue</p>
      </CoquilleEspaceAdmin>,
    );

    expect(screen.getByRole("link", { name: "Forfaits" })).toHaveAttribute(
      "href",
      "/admin/forfaits",
    );
    expect(screen.getByRole("link", { name: "Paramètres" })).toHaveAttribute(
      "href",
      "/admin/parametres",
    );
  });

  it("ne présente aucune violation axe", async () => {
    const { container } = render(
      <CoquilleEspaceAdmin actif="forfaits">
        <h1>Catalogue de forfaits</h1>
      </CoquilleEspaceAdmin>,
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Ajouté par l'agent testeur (verify-only) sur T-B1-01.
//
// La doc de ce module affirme : « Aucune garde ici. Le Partial Rendering ne
// rejoue pas un layout partagé en navigation client. `requireAdmin()` vit dans
// chaque page et dans chaque action. » Jusqu'ici c'était une affirmation de
// relecture : `src/lib/safe-action.test.ts` inventorie les **actions**, rien
// n'inventoriait les **pages**, et une page d'administration ajoutée sans
// garde n'aurait fait rougir aucun test. Un segment d'`/admin` est pourtant
// exactement là où l'oubli coûte le plus cher - la DoD de T-B1-01 l'écrit
// comme exigence, et onze écrans vont reprendre ce patron.
//
// ⚠️ Ce test lit le SOURCE, même parti que `safe-action.test.ts` : la
// propriété porte sur ce qui est écrit dans chaque page, et un async Server
// Component ne se déroule ni sous Vitest ni sous RTL.
// ─────────────────────────────────────────────────────────────────────────

const RACINE_ADMIN = join(process.cwd(), "src/app/(app)/admin");
const APP = join(process.cwd(), "src/app");

/// Tous les fichiers portant ce nom sous `/admin`, récursivement.
///
/// ⚠️ **Récursif pour les layouts aussi, et ce n'est pas de la symétrie
/// gratuite.** Le premier jet n'inspectait que les enfants directs de
/// `/admin` : une garde posée dans `admin/layout.tsx` - le fichier même que le
/// plan de la tâche prévoyait - ou dans un layout de sous-segment serait
/// passée inaperçue. Relevé par la session vérificatrice (É4).
function fichiersAdmin(
  nom: "page.tsx" | "layout.tsx",
  repertoire: string = RACINE_ADMIN,
): string[] {
  const trouves: string[] = [];

  for (const entree of readdirSync(repertoire, { withFileTypes: true })) {
    const chemin = join(repertoire, entree.name);

    // Les dossiers privés `_components/` ne portent pas de route.
    if (entree.isDirectory() && !entree.name.startsWith("_")) {
      trouves.push(...fichiersAdmin(nom, chemin));
      continue;
    }
    if (entree.name === nom) trouves.push(chemin);
  }

  return trouves;
}

/// Le discriminant est l'**import**, pas la mention ni la forme de l'appel.
/// Deux pièges, tombés tous les deux en écrivant ce test :
///
///   · le `layout.tsx` des forfaits parle de `requireAdmin()` en commentaire
///     pour dire qu'il ne l'appelle PAS - une recherche de sous-chaîne le
///     compterait comme gardé ;
///   · deux pages l'appellent dans un `Promise.all([requireAdmin(), params])`,
///     donc sans `await` devant - chercher `await requireAdmin(` les
///     déclarerait à tort sans garde.
///
/// Un commentaire n'importe rien, et une page qui importe la garde sans
/// l'appeler ne compilerait pas sans déclencher le lint des imports inutiles.
const APPEL_GARDE = /\brequireAdmin\s*\(/;
const IMPORT_GARDE =
  /import\s*\{[^}]*\brequireAdmin\b[^}]*\}\s*from\s*"@\/lib\/auth\/permissions"/;

describe("garde de rôle de l'espace d'administration", () => {
  it("trouve bien des pages et des layouts à inspecter", () => {
    // Sans ce contrôle, un changement d'arborescence rendrait les boucles
    // ci-dessous vides, donc vertes, donc muettes.
    expect(fichiersAdmin("page.tsx").length).toBeGreaterThanOrEqual(4);
    expect(fichiersAdmin("layout.tsx").length).toBeGreaterThanOrEqual(2);
  });

  it("appelle `requireAdmin()` dans CHAQUE page de l'espace", () => {
    const sansGarde = fichiersAdmin("page.tsx")
      .filter((chemin) => {
        const source = readFileSync(chemin, "utf8");
        return !APPEL_GARDE.test(source) || !IMPORT_GARDE.test(source);
      })
      .map((chemin) => relative(APP, chemin));

    expect(sansGarde).toEqual([]);
  });

  it("ne confie la garde à AUCUN layout de l'espace, à aucune profondeur", () => {
    // Le piège inverse : un `requireAdmin()` posé dans un `layout.tsx`
    // paraîtrait couvrir tout le segment, et deviendrait obsolète dès la
    // première navigation client (Partial Rendering).
    const layouts = fichiersAdmin("layout.tsx")
      .filter((chemin) => IMPORT_GARDE.test(readFileSync(chemin, "utf8")))
      .map((chemin) => relative(APP, chemin));

    expect(layouts).toEqual([]);
  });
});
