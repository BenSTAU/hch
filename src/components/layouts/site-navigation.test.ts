// @vitest-environment node
//
// Navigation principale - T-V2-05.
//
// Ce fichier n'existait pas : le comportement était couvert de biais par
// `site-header.test.tsx`, qui rend le composant. Or ce que cette tâche change
// est une **règle d'ordre**, et une règle mérite son oracle direct : elle a
// trois branches, un cas de compte multi-rôles, et elle doit rester alignée sur
// `afterLoginPath`, qui vit dans un autre module.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHEMIN_ADMIN_PARAMETRES,
  CHEMIN_ESPACE_CLIENT,
  CHEMIN_TOURNEE_DU_JOUR,
} from "@/lib/routes";
import { afterLoginPath } from "@/lib/auth/after-login";
import { ROLE_ADMIN, ROLE_CLIENT, ROLE_TECH } from "@/lib/auth/roles";

import {
  NAV_PUBLIQUE,
  espacePrincipal,
  navigationPrincipale,
  reservationProposee,
} from "./site-navigation";

/// ⚠️ **Ajout de l'agent testeur, 2026-08-12.** Les trois gardes sont importées
/// ici pour l'invariant de fin de fichier - « la navigation ne désigne jamais un
/// espace qui refusera son porteur ». C'est le sens autorisé de la dépendance :
/// `src/components/` peut lire `src/lib/`, jamais l'inverse (CLAUDE.md §Folder
/// structure, et son `grep` de vérification).
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: () => getCurrentUser() }));

const forbidden = vi.fn(() => {
  throw new Error("NEXT_HTTP_ERROR_FALLBACK;403");
});
vi.mock("next/navigation", () => ({ forbidden: () => forbidden() }));

const { requireAdmin, requireEspaceClient, requireTech } =
  await import("@/lib/auth/permissions");

const chemins = (roles: readonly string[] | null): string[] =>
  navigationPrincipale(roles).map((entree) => entree.href);

describe("navigationPrincipale - l'entrée d'espace suit le rôle", () => {
  it("ne propose aucun espace à un visiteur anonyme", () => {
    // Proposer « Mes interventions » à un anonyme l'enverrait sur le formulaire
    // de connexion : une promesse tenue de travers.
    expect(navigationPrincipale(null)).toEqual(NAV_PUBLIQUE);
  });

  it("mène le client à son espace", () => {
    expect(chemins([ROLE_CLIENT])).toContain(CHEMIN_ESPACE_CLIENT);
  });

  it("mène le technicien à SA tournée, et pas à l'espace client", () => {
    // 🔴 Le défaut que T-V2-05 corrige : la fonction prenait un booléen, donc
    // rendait `NAV_ESPACE_CLIENT` à toute session ouverte. Un technicien voyait
    // « Mes interventions » pointant un espace qui lui répond désormais 403, et
    // aucun lien vers sa propre tournée.
    expect(chemins([ROLE_TECH])).toContain(CHEMIN_TOURNEE_DU_JOUR);
    expect(chemins([ROLE_TECH])).not.toContain(CHEMIN_ESPACE_CLIENT);
  });

  it("mène l'administrateur au back-office", () => {
    // Livré depuis T-J0-05, mais qu'aucune navigation ne proposait : il fallait
    // taper l'URL de son propre espace.
    expect(chemins([ROLE_ADMIN])).toContain(CHEMIN_ADMIN_PARAMETRES);
    expect(chemins([ROLE_ADMIN])).not.toContain(CHEMIN_ESPACE_CLIENT);
  });

  it("garde les trois ancres publiques pour tout le monde", () => {
    // Ce sont des sections de la landing, pas un espace de travail. Aucune
    // source ne demande de les retirer à un employé, et le cloisonnement de
    // Constitution §3.1 porte sur les espaces.
    for (const roles of [null, [ROLE_CLIENT], [ROLE_TECH], [ROLE_ADMIN]]) {
      expect(chemins(roles)).toEqual(
        expect.arrayContaining(NAV_PUBLIQUE.map((entree) => entree.href)),
      );
    }
  });

  it("ne pose jamais plus d'une entrée d'espace", () => {
    for (const roles of [
      [ROLE_CLIENT],
      [ROLE_TECH],
      [ROLE_ADMIN],
      [ROLE_CLIENT, ROLE_TECH, ROLE_ADMIN],
    ]) {
      expect(navigationPrincipale(roles)).toHaveLength(NAV_PUBLIQUE.length + 1);
    }
  });

  it("laisse le rôle le plus large gagner", () => {
    // `users.roles` est un `VARCHAR[]` : rien n'interdit deux rôles, et
    // l'administrateur du seed a longtemps porté aussi `ROLE_CLIENT`. Se fier
    // au premier élément ferait dépendre la navigation de l'ordre d'insertion
    // en base.
    expect(chemins([ROLE_CLIENT, ROLE_ADMIN])).toContain(
      CHEMIN_ADMIN_PARAMETRES,
    );
    expect(chemins([ROLE_ADMIN, ROLE_CLIENT])).toContain(
      CHEMIN_ADMIN_PARAMETRES,
    );
    expect(chemins([ROLE_TECH, ROLE_ADMIN])).toContain(CHEMIN_ADMIN_PARAMETRES);
    expect(chemins([ROLE_CLIENT, ROLE_TECH])).toContain(CHEMIN_TOURNEE_DU_JOUR);
  });

  it("suit EXACTEMENT l'ordre de `afterLoginPath`", () => {
    // ⚠️ La DoD l'écrit mot pour mot : « même règle d'ordre que
    // `afterLoginPath` ». Les deux vivent dans des modules différents et rien
    // ne les relie au compilateur - ce test est le seul lien. Une navigation
    // qui désignerait un autre espace que la destination post-connexion
    // enverrait la personne quelque part, puis lui proposerait ailleurs.
    for (const roles of [
      [ROLE_CLIENT],
      [ROLE_TECH],
      [ROLE_ADMIN],
      [ROLE_CLIENT, ROLE_TECH],
      [ROLE_TECH, ROLE_ADMIN],
      [ROLE_CLIENT, ROLE_TECH, ROLE_ADMIN],
      [],
    ]) {
      expect(espacePrincipal(roles).href).toBe(afterLoginPath(roles));
    }
  });

  it("traite un rôle inconnu comme un client", () => {
    // `afterLoginPath` fait de même : le repli est l'espace client, pas une
    // page vide. Un rôle ajouté en base sans code correspondant ne doit pas
    // priver son porteur de navigation.
    expect(chemins(["ROLE_STAGIAIRE"])).toContain(CHEMIN_ESPACE_CLIENT);
    expect(chemins([])).toContain(CHEMIN_ESPACE_CLIENT);
  });

  it("compare exactement, comme `hasRole`", () => {
    // `ROLE_TECHNICIEN` n'est pas `ROLE_TECH`, et `role_admin` n'est pas une
    // élévation de privilège. La navigation n'est pas une garde, mais elle ne
    // doit pas non plus désigner un espace qui refusera son porteur.
    expect(chemins(["ROLE_TECHNICIEN"])).toContain(CHEMIN_ESPACE_CLIENT);
    expect(chemins(["role_admin"])).toContain(CHEMIN_ESPACE_CLIENT);
  });
});

describe("espacePrincipal - la destination du menu utilisateur", () => {
  it("nomme l'espace, son chemin et son libellé", () => {
    expect(espacePrincipal([ROLE_TECH])).toEqual({
      espace: "tech",
      href: CHEMIN_TOURNEE_DU_JOUR,
      label: "Ma tournée",
    });
    expect(espacePrincipal([ROLE_ADMIN]).espace).toBe("admin");
    expect(espacePrincipal([ROLE_CLIENT]).espace).toBe("client");
  });

  it("rend la même entrée que la navigation principale", () => {
    // Les deux surfaces doivent désigner la même destination : le menu et la
    // barre sont côte à côte dans l'en-tête, et deux liens voisins qui mènent
    // ailleurs l'un de l'autre est un défaut qu'on ne voit qu'en production.
    for (const roles of [[ROLE_CLIENT], [ROLE_TECH], [ROLE_ADMIN]]) {
      expect(chemins(roles)).toContain(espacePrincipal(roles).href);
    }
  });
});

describe("la navigation ne désigne jamais un espace qui refuse son porteur", () => {
  // 🔴 **Invariant ajouté par l'agent testeur, et rien ne le tenait.**
  //
  // Le fichier vérifiait déjà que `espacePrincipal` suit `afterLoginPath` ; les
  // deux pouvaient donc dériver **ensemble** par rapport aux gardes, qui vivent
  // dans un troisième module. Or c'est exactement ce que T-V2-05 vient de
  // rendre possible : jusqu'à cette tâche, `/mes-interventions` n'avait aucune
  // garde de rôle, et pointer dessus ne pouvait rien casser.
  //
  // Le cas qui décide n'est pas théorique : `requireEspaceClient` est une garde
  // **négative** (refuse `ROLE_TECH` ou `ROLE_ADMIN`) et non un
  // `hasRole(ROLE_CLIENT)`. C'est ce choix - et lui seul - qui rend l'entrée
  // « Mes interventions » légitime pour un compte aux rôles vides ou porteur
  // d'un rôle inconnu, à qui `navigationPrincipale` la propose. Repasser la
  // garde en formulation positive ferait rougir ce test, et lui seul.
  //
  // La garde est appelée pour de vrai, avec sa DAL doublée : ce n'est pas une
  // reformulation de sa logique côté test, qui pourrait diverger d'elle en
  // silence.
  const GARDES = {
    client: requireEspaceClient,
    tech: requireTech,
    admin: requireAdmin,
  } as const;

  beforeEach(() => vi.clearAllMocks());

  it.each([
    { titre: "client", roles: [ROLE_CLIENT] },
    { titre: "technicien", roles: [ROLE_TECH] },
    { titre: "administrateur", roles: [ROLE_ADMIN] },
    {
      titre: "technicien qui a aussi réservé",
      roles: [ROLE_CLIENT, ROLE_TECH],
    },
    {
      titre: "administrateur également technicien",
      roles: [ROLE_ADMIN, ROLE_TECH],
    },
    { titre: "compte aux rôles vides", roles: [] },
    { titre: "porteur d'un rôle inconnu", roles: ["ROLE_STAGIAIRE"] },
  ])(
    "$titre entre dans l'espace que son menu lui propose",
    async ({ roles }) => {
      const destination = espacePrincipal(roles);
      getCurrentUser.mockResolvedValue({ id: "u-1", roles });

      await expect(GARDES[destination.espace]()).resolves.toBeDefined();
      expect(forbidden).not.toHaveBeenCalled();
    },
  );

  it.each([
    { titre: "technicien", roles: [ROLE_TECH] },
    { titre: "administrateur", roles: [ROLE_ADMIN] },
  ])(
    "la barre du site ne propose plus l'espace client à un $titre",
    ({ roles }) => {
      // Le pendant négatif : l'invariant ci-dessus serait tenu par une
      // navigation qui ne proposerait RIEN. Ici on exige que l'entrée retirée
      // soit bien celle qui refuse, et qu'elle soit remplacée, pas supprimée.
      const entrees = navigationPrincipale(roles);

      expect(entrees.map((e) => e.href)).not.toContain(CHEMIN_ESPACE_CLIENT);
      expect(entrees).toHaveLength(NAV_PUBLIQUE.length + 1);
    },
  );
});

describe("reservationProposee", () => {
  it("propose la réservation au visiteur et au client", () => {
    expect(reservationProposee(null)).toBe(true);
    expect(reservationProposee([ROLE_CLIENT])).toBe(true);
    expect(reservationProposee([])).toBe(true);
  });

  it("la retire au technicien et à l'administrateur", () => {
    expect(reservationProposee([ROLE_TECH])).toBe(false);
    expect(reservationProposee([ROLE_ADMIN])).toBe(false);
    expect(reservationProposee([ROLE_CLIENT, ROLE_TECH])).toBe(false);
  });
});
