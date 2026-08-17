// Schéma de connexion et message de refus.
//
// `src/lib/validations/auth.ts` n'avait aucun test, alors qu'il porte deux
// choses que la SPEC contraint mot pour mot : le message unique de refus
// (US-COMPTE-CONNECTER §Cas d'erreur) et la porte d'entrée de toute donnée
// non fiable dans l'action de connexion.
import { describe, expect, it } from "vitest";

import {
  LOGIN_REFUSED_MESSAGE,
  SIGNUP_ACKNOWLEDGED_MESSAGE,
  activationSchema,
  loginSchema,
  normaliserTelephoneFr,
  resendActivationSchema,
  signupSchema,
} from "./auth";

describe("LOGIN_REFUSED_MESSAGE", () => {
  it("reprend mot pour mot la formulation imposée par la SPEC", async () => {
    // US-COMPTE-CONNECTER §Cas d'erreur, module-1-utilisateurs.md:255. Le
    // message est un élément de spécification, pas un détail de rédaction :
    // c'est lui qui rend les quatre causes de refus indiscernables.
    //
    // ⚠️ **Oracle mis à jour le 2026-08-12 - règle du test rouge, cas 3.** Le
    // cadratin devient un deux-points, par la règle typographique du
    // 2026-08-10 dont le MUST couvre explicitement « la copie produit ». Ce que
    // ce test protège est **l'indiscernabilité des quatre causes de refus**, et
    // elle est inchangée : c'est la ponctuation qui bouge, pas le message.
    //
    // La SPEC porte encore le cadratin. CLAUDE.md §Typographie tranche que
    // « le cadratin de la SPEC ne voyage pas » et que c'est le write-back qui
    // aligne l'amont, pas le code. Signalé en PR.
    expect(LOGIN_REFUSED_MESSAGE).toBe(
      "Identifiants invalides ou compte non activé : vérifiez votre email d'activation si vous venez de créer un compte",
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

// ───────────────────────────────────────────────────────────────────────────
// Inscription — T-V3-02, `US-COMPTE-CREER`.
// ───────────────────────────────────────────────────────────────────────────

const VALIDE = {
  firstname: "Camille",
  lastname: "Durand",
  email: "camille@example.test",
  password: "un-mot-de-passe-long",
  passwordConfirmation: "un-mot-de-passe-long",
};

describe("signupSchema — cas nominal", () => {
  it("accepte un formulaire bien rempli", () => {
    expect(signupSchema.safeParse(VALIDE).success).toBe(true);
  });

  it("normalise l'email en minuscules", () => {
    // Même motif qu'à la connexion : `users.email` est sous index unique
    // ordinaire, comparé octet par octet. Sans normalisation à l'inscription,
    // « Camille@Example.test » créerait un second compte pour la même personne
    // et l'unicité ne le verrait pas.
    const parsed = signupSchema.parse({
      ...VALIDE,
      email: "Camille@Example.TEST",
    });

    expect(parsed.email).toBe("camille@example.test");
  });

  it("retire les espaces autour du prénom et du nom", () => {
    const parsed = signupSchema.parse({
      ...VALIDE,
      firstname: "  Camille ",
      lastname: " Durand  ",
    });

    expect(parsed.firstname).toBe("Camille");
    expect(parsed.lastname).toBe("Durand");
  });

  it("écarte les champs surnuméraires", () => {
    const parsed = signupSchema.parse({ ...VALIDE, roles: ["ROLE_ADMIN"] });

    expect(Object.keys(parsed)).not.toContain("roles");
  });
});

describe("signupSchema — messages imposés par la SPEC", () => {
  it("refuse un email mal formé avec « Email invalide »", () => {
    // US-COMPTE-CREER §Cas d'erreur, module-1-utilisateurs.md:169. Le texte est
    // dans la SPEC, il ne se reformule pas.
    const parsed = signupSchema.safeParse({ ...VALIDE, email: "pas-un-email" });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toContain("Email invalide");
  });

  it("refuse un mot de passe de moins de 12 caractères", () => {
    const parsed = signupSchema.safeParse({
      ...VALIDE,
      password: "onzecaract1",
      passwordConfirmation: "onzecaract1",
    });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toContain(
      "Mot de passe : 12 caractères minimum",
    );
  });

  it("accepte tout juste 12 caractères", () => {
    expect(
      signupSchema.safeParse({
        ...VALIDE,
        password: "douzecaract1",
        passwordConfirmation: "douzecaract1",
      }).success,
    ).toBe(true);
  });

  it("refuse deux mots de passe différents", () => {
    const parsed = signupSchema.safeParse({
      ...VALIDE,
      passwordConfirmation: "un-autre-mot-de-passe",
    });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toContain(
      "Les mots de passe ne correspondent pas",
    );
  });

  it("rattache l'erreur de confirmation au champ de confirmation", () => {
    // WCAG 3.3.1 (AA) : le message doit être lié au champ fautif par
    // `aria-describedby`. Sans `path`, l'erreur flotte au niveau du formulaire
    // et aucun champ ne peut la porter.
    const parsed = signupSchema.safeParse({
      ...VALIDE,
      passwordConfirmation: "un-autre-mot-de-passe",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(["passwordConfirmation"]);
  });

  it("refuse un prénom vide avec « Ce champ est requis »", () => {
    const parsed = signupSchema.safeParse({ ...VALIDE, firstname: "" });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toContain("Ce champ est requis");
  });

  it("refuse un nom fait d'espaces seulement", () => {
    const parsed = signupSchema.safeParse({ ...VALIDE, lastname: "   " });

    expect(parsed.success).toBe(false);
  });
});

describe("signupSchema — bornes", () => {
  it("plafonne le mot de passe à 72 OCTETS", () => {
    // Dette pré-enregistrée par ce fichier même (cf. « n'impose aucune longueur
    // maximale » plus haut) : bcrypt tronque silencieusement à 72 octets. Sans
    // borne, deux mots de passe distincts de 80 caractères ouvriraient le même
    // compte — et l'utilisateur croirait avoir choisi le second.
    const parsed = signupSchema.safeParse({
      ...VALIDE,
      password: "a".repeat(73),
      passwordConfirmation: "a".repeat(73),
    });

    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error)).toContain("72");
  });

  it("compte en octets, pas en caractères", () => {
    // 24 emoji de 4 octets font 96 octets pour 24 « caractères » perçus. Une
    // borne posée sur `.length` laisserait passer la troncature.
    const parsed = signupSchema.safeParse({
      ...VALIDE,
      password: "🚲".repeat(24),
      passwordConfirmation: "🚲".repeat(24),
    });

    expect(parsed.success).toBe(false);
  });

  it("accepte exactement 72 octets", () => {
    expect(
      signupSchema.safeParse({
        ...VALIDE,
        password: "a".repeat(72),
        passwordConfirmation: "a".repeat(72),
      }).success,
    ).toBe(true);
  });

  it("plafonne l'email à la largeur de la colonne", () => {
    // `users.email` est une VARCHAR(180) (prisma/schema.prisma:52). Sans borne
    // ici, le refus viendrait de Postgres, donc après le bcrypt et l'insertion
    // — une erreur 500 au lieu d'un message de formulaire.
    const parsed = signupSchema.safeParse({
      ...VALIDE,
      email: `${"a".repeat(180)}@example.test`,
    });

    expect(parsed.success).toBe(false);
  });

  it("plafonne prénom et nom à la largeur de leurs colonnes", () => {
    // VARCHAR(100) tous les deux (prisma/schema.prisma:53-54).
    expect(
      signupSchema.safeParse({ ...VALIDE, firstname: "a".repeat(101) }).success,
    ).toBe(false);
    expect(
      signupSchema.safeParse({ ...VALIDE, lastname: "a".repeat(101) }).success,
    ).toBe(false);
  });
});

describe("SIGNUP_ACKNOWLEDGED_MESSAGE", () => {
  it("reprend la formulation générique imposée par la SPEC", () => {
    // US-COMPTE-CREER §Cas d'erreur, module-1-utilisateurs.md:165.
    expect(SIGNUP_ACKNOWLEDGED_MESSAGE).toBe(
      "Si un compte existe pour cet email, un email d'activation vient d'être envoyé",
    );
  });

  it("ne dit pas si le compte existait déjà", () => {
    for (const indice of [
      "déjà utilisé",
      "déjà pris",
      "existe déjà",
      "connu",
    ]) {
      expect(SIGNUP_ACKNOWLEDGED_MESSAGE.toLowerCase()).not.toContain(indice);
    }
  });
});

describe("resendActivationSchema", () => {
  it("n'exige que l'email, et le normalise", () => {
    const parsed = resendActivationSchema.parse({
      email: "Camille@Example.fr",
    });

    expect(parsed).toEqual({ email: "camille@example.fr" });
  });

  it("refuse un email vide", () => {
    expect(resendActivationSchema.safeParse({ email: "" }).success).toBe(false);
  });
});

describe("activationSchema", () => {
  it("accepte un jeton de 43 caractères URL-safe", () => {
    expect(activationSchema.safeParse({ token: "a".repeat(43) }).success).toBe(
      true,
    );
  });

  it("refuse un jeton vide", () => {
    expect(activationSchema.safeParse({ token: "" }).success).toBe(false);
  });

  it("refuse un jeton qui n'a pas la forme d'un jeton", () => {
    // Le hash d'une chaîne arbitraire ne correspondra à aucune ligne, donc le
    // refus arriverait de toute façon. Le borner ici évite une requête en base
    // par lien malformé, et coupe court à une charge de 10 Mo dans la query
    // string.
    expect(activationSchema.safeParse({ token: "pas/un+jeton=" }).success).toBe(
      false,
    );
    expect(
      activationSchema.safeParse({ token: "a".repeat(5000) }).success,
    ).toBe(false);
  });
});

describe("normaliserTelephoneFr", () => {
  it("passe un numéro national en E.164", () => {
    // La maquette C5 propose `06 12 34 56 78`. Le CHECK SQL de `users.phone`
    // n'accepte que l'E.164 : sans normalisation, la saisie de la maquette
    // ferait échouer l'insertion.
    expect(normaliserTelephoneFr("06 12 34 56 78")).toBe("+33612345678");
    expect(normaliserTelephoneFr("06.12.34.56.78")).toBe("+33612345678");
    expect(normaliserTelephoneFr("(06) 12-34-56-78")).toBe("+33612345678");
  });

  it("laisse un E.164 déjà correct intact", () => {
    expect(normaliserTelephoneFr("+33612345678")).toBe("+33612345678");
    expect(normaliserTelephoneFr("+33 6 12 34 56 78")).toBe("+33612345678");
  });

  it("traduit le préfixe international composé", () => {
    expect(normaliserTelephoneFr("0033612345678")).toBe("+33612345678");
  });

  it("rend undefined sur une saisie vide — le champ est facultatif", () => {
    // `""` en base ferait échouer le CHECK ; NULL le traverse.
    expect(normaliserTelephoneFr("")).toBeUndefined();
    expect(normaliserTelephoneFr("   ".trim())).toBeUndefined();
  });

  it("ne maquille pas ce qu'il ne reconnaît pas", () => {
    // Rendu tel quel, donc refusé par le `refine` E.164 en aval. Inventer un
    // indicatif sur une saisie douteuse produirait un numéro qui appartient à
    // quelqu'un d'autre.
    expect(normaliserTelephoneFr("12345")).toBe("12345");
    expect(normaliserTelephoneFr("0612345")).toBe("0612345");
  });
});

describe("signupSchema — téléphone", () => {
  const BASE = {
    firstname: "Camille",
    lastname: "Durand",
    email: "camille@example.test",
    password: "un-mot-de-passe-long",
    passwordConfirmation: "un-mot-de-passe-long",
  };

  it("reste facultatif — `/inscription` ne le demande pas", () => {
    expect(signupSchema.safeParse(BASE).success).toBe(true);
  });

  it("accepte et normalise la saisie de la maquette C5", () => {
    const resultat = signupSchema.safeParse({
      ...BASE,
      phone: "06 12 34 56 78",
    });

    expect(resultat.success).toBe(true);
    if (!resultat.success) return;
    expect(resultat.data.phone).toBe("+33612345678");
  });

  it("refuse un numéro que le CHECK SQL rejetterait", () => {
    for (const phone of ["12345", "abc", "+0612345678"]) {
      expect(signupSchema.safeParse({ ...BASE, phone }).success, phone).toBe(
        false,
      );
    }
  });
});
