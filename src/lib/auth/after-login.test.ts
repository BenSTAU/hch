// @vitest-environment node
//
// Destination post-connexion selon le rôle — DoD T-V3-03, reportée de T-V3-02.
//
// Avant cette tâche, `AFTER_LOGIN` valait `/admin/parametres` pour tout le
// monde : un client fraîchement activé se connectait, puis atterrissait sur le
// 403 de `requireAdmin()`. Le parcours nominal de V3 finissait sur un refus.
//
// Les deux destinations métier de la SPEC — client `/mes-interventions/a-venir`,
// technicien `/interventions/du-jour` — n'existent pas encore. Elles ne sont pas
// posées en coquilles vides : une route qui répond 200 sans rien porter est
// exactement la leçon T-T2-16 d'Argo. L'accueil est la destination provisoire,
// et T-V3-10 porte la DoD finale côté client.
import { describe, expect, it } from "vitest";

const { AFTER_LOGIN_ADMIN, AFTER_LOGIN_DEFAULT, afterLoginPath } =
  await import("./after-login");

describe("afterLoginPath", () => {
  it("envoie l'administrateur sur le back-office", () => {
    expect(afterLoginPath(["ROLE_ADMIN"])).toBe(AFTER_LOGIN_ADMIN);
  });

  it("envoie le client sur l'accueil", () => {
    expect(afterLoginPath(["ROLE_CLIENT"])).toBe(AFTER_LOGIN_DEFAULT);
  });

  it("envoie le technicien sur l'accueil", () => {
    expect(afterLoginPath(["ROLE_TECH"])).toBe(AFTER_LOGIN_DEFAULT);
  });

  it("retient le rôle le plus large quand un compte en porte plusieurs", () => {
    // `users.roles` est un tableau : rien n'interdit à un administrateur de
    // porter aussi ROLE_TECH. L'envoyer sur l'accueil parce que le tableau
    // commence par le rôle technicien serait une régression silencieuse.
    expect(afterLoginPath(["ROLE_TECH", "ROLE_ADMIN"])).toBe(AFTER_LOGIN_ADMIN);
    expect(afterLoginPath(["ROLE_CLIENT", "ROLE_ADMIN"])).toBe(
      AFTER_LOGIN_ADMIN,
    );
  });

  it("retombe sur l'accueil pour un tableau vide ou un rôle inconnu", () => {
    // La session porte ce que la base contient. Un rôle inattendu ne doit pas
    // produire une destination inattendue — surtout pas le back-office.
    expect(afterLoginPath([])).toBe(AFTER_LOGIN_DEFAULT);
    expect(afterLoginPath(["ROLE_INCONNU"])).toBe(AFTER_LOGIN_DEFAULT);
  });

  it("compare les rôles exactement", () => {
    // Même garde que `hasRole` (permissions.ts) : une comparaison par
    // sous-chaîne ferait de `ROLE_ADMINISTRATIF` un administrateur, une
    // comparaison insensible à la casse ferait de `role_admin` une élévation
    // de privilège.
    expect(afterLoginPath(["ROLE_ADMINISTRATIF"])).toBe(AFTER_LOGIN_DEFAULT);
    expect(afterLoginPath(["role_admin"])).toBe(AFTER_LOGIN_DEFAULT);
  });

  it("ne renvoie jamais une destination externe", () => {
    // Le retour part directement dans `redirect()`. Un chemin relatif commençant
    // par `/` et un seul, c'est la même propriété que `safeNextPath` garantit
    // pour la destination contrôlée par l'utilisateur.
    for (const roles of [[], ["ROLE_ADMIN"], ["ROLE_CLIENT"], ["ROLE_TECH"]]) {
      // Un seul `/` en tête : `//phishing.example` est un chemin protocol-relative
      // que le navigateur résout comme un domaine externe.
      expect(afterLoginPath(roles)).toMatch(/^\/(?![/\\])/);
    }
  });
});
