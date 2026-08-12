// @vitest-environment node
//
// Destination post-connexion selon le rôle — DoD T-V3-03, reportée de T-V3-02.
//
// Avant cette tâche, `AFTER_LOGIN` valait `/admin/parametres` pour tout le
// monde : un client fraîchement activé se connectait, puis atterrissait sur le
// 403 de `requireAdmin()`. Le parcours nominal de V3 finissait sur un refus.
//
// ⚠️ **Trois oracles déplacés par T-V3-10**, qui porte la DoD finale côté
// client : `/mes-interventions/a-venir` existe désormais, et le client y va.
//
// ⚠️ **Et l'oracle du TECHNICIEN bascule à son tour avec T-V2-01.** Il
// affirmait `AFTER_LOGIN_DEFAULT`, l'accueil public, faute d'écran à atteindre —
// T-V3-03 refusait de poser une coquille vide (leçon T-T2-16 d'Argo).
// `/interventions/du-jour` existe désormais, et c'est ce que
// [[module-1-utilisateurs]] §250 nomme depuis le début.
import { describe, expect, it } from "vitest";

const {
  AFTER_LOGIN_ADMIN,
  AFTER_LOGIN_CLIENT,
  AFTER_LOGIN_DEFAULT,
  AFTER_LOGIN_TECH,
  afterLoginPath,
} = await import("./after-login");

describe("afterLoginPath", () => {
  it("envoie l'administrateur sur le back-office", () => {
    expect(afterLoginPath(["ROLE_ADMIN"])).toBe(AFTER_LOGIN_ADMIN);
  });

  it("envoie le client sur son espace", () => {
    // [[module-1-utilisateurs]] §287 : « client → `/mes-interventions/a-venir` ».
    expect(afterLoginPath(["ROLE_CLIENT"])).toBe(AFTER_LOGIN_CLIENT);
    expect(AFTER_LOGIN_CLIENT).toBe("/mes-interventions/a-venir");
  });

  it("envoie le technicien sur sa tournée, et surtout pas dans l'espace client", () => {
    // [[module-1-utilisateurs]] §250 : « technicien → `/interventions/du-jour` ».
    // Ce que le test protège n'est pas la valeur mais la CONFUSION : l'envoyer
    // sur `/mes-interventions/a-venir` lui montrerait ses propres rendez-vous
    // EN TANT QUE CLIENT, un écran qui ressemble à son métier sans l'être.
    expect(afterLoginPath(["ROLE_TECH"])).toBe(AFTER_LOGIN_TECH);
    expect(AFTER_LOGIN_TECH).toBe("/interventions/du-jour");
    expect(afterLoginPath(["ROLE_TECH"])).not.toBe(AFTER_LOGIN_CLIENT);
    // Et plus jamais l'accueil public : c'était le provisoire de T-V3-03.
    expect(afterLoginPath(["ROLE_TECH"])).not.toBe(AFTER_LOGIN_DEFAULT);
  });

  it("envoie sur sa tournée un technicien qui porte aussi ROLE_CLIENT", () => {
    // L'ordre des branches est ce qui le décide. Sans la priorité du rôle
    // technicien, ce compte tomberait dans le repli client — régression
    // silencieuse, puisque la destination resterait une page valide.
    expect(afterLoginPath(["ROLE_CLIENT", "ROLE_TECH"])).toBe(AFTER_LOGIN_TECH);
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

  it("retombe sur l'espace client pour un tableau vide ou un rôle inconnu", () => {
    // La session porte ce que la base contient. Un rôle inattendu ne doit pas
    // produire une destination inattendue — surtout pas le back-office. Le
    // repli est l'espace client, et il est sans danger : la page filtre sur
    // `clientId = user.id` et n'affiche donc que ce que ce compte possède,
    // fût-ce rien.
    expect(afterLoginPath([])).toBe(AFTER_LOGIN_CLIENT);
    expect(afterLoginPath(["ROLE_INCONNU"])).toBe(AFTER_LOGIN_CLIENT);
    expect(afterLoginPath([])).not.toBe(AFTER_LOGIN_ADMIN);
  });

  it("compare les rôles exactement", () => {
    // Même garde que `hasRole` (permissions.ts) : une comparaison par
    // sous-chaîne ferait de `ROLE_ADMINISTRATIF` un administrateur, une
    // comparaison insensible à la casse ferait de `role_admin` une élévation
    // de privilège. Ce qui compte est qu'aucun des deux n'atteigne le
    // back-office ; la destination de repli, elle, est celle du client.
    expect(afterLoginPath(["ROLE_ADMINISTRATIF"])).toBe(AFTER_LOGIN_CLIENT);
    expect(afterLoginPath(["role_admin"])).toBe(AFTER_LOGIN_CLIENT);
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
