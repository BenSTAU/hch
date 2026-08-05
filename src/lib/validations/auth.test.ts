// Schéma de connexion et message de refus — ajoutés par l'agent testeur.
//
// `src/lib/validations/auth.ts` n'avait aucun test, alors qu'il porte deux
// choses que la SPEC contraint mot pour mot : le message unique de refus
// (US-COMPTE-CONNECTER §Cas d'erreur) et la porte d'entrée de toute donnée
// non fiable dans l'action de connexion.
import { describe, expect, it } from "vitest";

import { LOGIN_REFUSED_MESSAGE, loginSchema } from "./auth";

describe("LOGIN_REFUSED_MESSAGE", () => {
  it("reprend mot pour mot la formulation imposée par la SPEC", async () => {
    // US-COMPTE-CONNECTER §Cas d'erreur, module-1-utilisateurs.md:255. Le
    // message est un élément de spécification, pas un détail de rédaction :
    // c'est lui qui rend les quatre causes de refus indiscernables.
    expect(LOGIN_REFUSED_MESSAGE).toBe(
      "Identifiants invalides ou compte non activé — vérifiez votre email d'activation si vous venez de créer un compte",
    );
  });

  it("ne nomme aucune cause discriminante", () => {
    // Filet contre une « amélioration » d'ergonomie : préciser la cause est
    // exactement ce que la Constitution §4.2 interdit.
    for (const indice of [
      "inconnu",
      "incorrect",
      "désactivé",
      "n'existe pas",
      "introuvable",
    ]) {
      expect(LOGIN_REFUSED_MESSAGE.toLowerCase()).not.toContain(indice);
    }
  });
});

describe("loginSchema — validation", () => {
  it("accepte des identifiants bien formés", () => {
    const parsed = loginSchema.safeParse({
      email: "admin@homecyclhome.fr",
      password: "un-mot-de-passe",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuse un email vide avec un message actionnable", () => {
    const parsed = loginSchema.safeParse({ email: "", password: "x" });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toContain(
      "Renseignez votre adresse email",
    );
  });

  it("refuse un mot de passe vide avec un message actionnable", () => {
    const parsed = loginSchema.safeParse({
      email: "admin@homecyclhome.fr",
      password: "",
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toContain(
      "Renseignez votre mot de passe",
    );
  });

  it("écarte les champs surnuméraires", () => {
    const parsed = loginSchema.parse({
      email: "admin@homecyclhome.fr",
      password: "x",
      roles: ["ROLE_ADMIN"],
    });
    expect(Object.keys(parsed).sort()).toEqual(["email", "password"]);
  });

  it("n'impose aucune règle de complexité au mot de passe", () => {
    // Volontaire et correct (src/lib/validations/auth.ts:16-18) : contrôler la
    // complexité à la connexion révélerait la politique en vigueur et
    // refuserait un ancien mot de passe encore valide.
    expect(
      loginSchema.safeParse({ email: "a@b.fr", password: "1" }).success,
    ).toBe(true);
  });

  it("n'impose aucune longueur maximale au mot de passe", () => {
    // Comportement CONSTATÉ, pas approuvé. Couplé à la troncature bcrypt à 72
    // octets (cf. password.adversarial.test.ts), l'absence de `.max()` fait
    // qu'à l'inscription deux mots de passe distincts ouvriront le même
    // compte. Ici, à la connexion, l'absence de borne est sans danger direct ;
    // c'est le schéma d'inscription (T-V3) qui devra en poser une.
    expect(
      loginSchema.safeParse({ email: "a@b.fr", password: "x".repeat(5000) })
        .success,
    ).toBe(true);
  });

  it("refuse un email entouré d'espaces au lieu de les retirer", () => {
    // Comportement CONSTATÉ. Un email copié-collé depuis un client de
    // messagerie traîne souvent une espace. L'utilisateur reçoit ici « Format
    // d'adresse email invalide », qui est au moins actionnable — à la
    // différence du cas de casse ci-dessous.
    expect(
      loginSchema.safeParse({
        email: " admin@homecyclhome.fr ",
        password: "x",
      }).success,
    ).toBe(false);
  });
});

describe("loginSchema — normalisation de l'email", () => {
  it("ramène l'email en minuscules avant toute recherche en base", () => {
    // Ce test a été ROUGE, et c'est ce qui a fait remonter le défaut.
    //
    // `users.email` est une VARCHAR(180) sous index unique ordinaire
    // (prisma/migrations/20260805110417_init_auth_users/migration.sql:55) :
    // Postgres la compare octet par octet. Le seed écrit en minuscules
    // (prisma/seed.ts:30), et `findUserForLogin` interroge la valeur reçue
    // (src/lib/db/queries/auth.ts:15). Une saisie « Admin@HomeCyclHome.fr »
    // ne trouvait donc aucun compte.
    //
    // L'anti-énumération aggravait le symptôme au lieu de l'atténuer : le
    // refus empruntait le message générique, indiscernable d'un mot de passe
    // faux. Un utilisateur dont le clavier avait mis une majuscule n'avait
    // aucun moyen de comprendre pourquoi il n'entrait pas.
    //
    // Le LIEU de la correction était un arbitrage — Zod, colonne `citext`, ou
    // index unique fonctionnel `lower(email)`. **Zod a été retenu**
    // (src/lib/validations/auth.ts:25), et ce test vaut désormais pour ce
    // choix-là. Que la normalisation atteigne bien la recherche en base est
    // vérifié à part, au niveau de l'action (lib/actions/auth/login.test.ts).
    const parsed = loginSchema.parse({
      email: "Admin@HomeCyclHome.fr",
      password: "x",
    });
    expect(parsed.email).toBe("admin@homecyclhome.fr");
  });

  it("normalise aussi un email intégralement en majuscules", () => {
    // La casse ne se limite pas à l'initiale : les claviers mobiles et les
    // copier-coller depuis un client de messagerie produisent régulièrement
    // l'adresse entière en capitales.
    const parsed = loginSchema.parse({
      email: "ADMIN@HOMECYCLHOME.FR",
      password: "x",
    });
    expect(parsed.email).toBe("admin@homecyclhome.fr");
  });
});
