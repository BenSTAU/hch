// @vitest-environment node
//
// Jetons de vérification. Le dictionnaire §verification_tokens fixe le pattern
// mot pour mot : 32 octets aléatoires URL-safe envoyés dans l'email, SHA-256
// stocké en base, comparaison sur le hash. Ce fichier vérifie les trois
// propriétés dont dépend l'anti-rejeu.
import { describe, expect, it } from "vitest";

import {
  EMAIL_VERIFICATION_TTL_MS,
  generateVerificationToken,
  hashVerificationToken,
  verificationTokenExpiry,
} from "./verification-token";

describe("EMAIL_VERIFICATION_TTL_MS", () => {
  it("vaut 24 heures", () => {
    // US-COMPTE-ACTIVER §Cas d'erreur : « token expiré (> 24 h) ». Le reset de
    // mot de passe, lui, est à 1 h — c'est T-V3-05 qui le portera, et le
    // contraste est délibéré (module-1-utilisateurs.md:341).
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("generateVerificationToken", () => {
  it("produit un jeton URL-safe", () => {
    // Le jeton voyage dans une query string. Un `+`, un `/` ou un `=` de base64
    // classique y serait ré-encodé par le client de messagerie ou le
    // navigateur, et le hash ne correspondrait plus.
    const { token } = generateVerificationToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("porte 32 octets d'entropie", () => {
    // 32 octets en base64url font 43 caractères sans remplissage.
    const { token } = generateVerificationToken();

    expect(token).toHaveLength(43);
  });

  it("ne produit jamais deux fois le même jeton", () => {
    const jetons = new Set(
      Array.from({ length: 200 }, () => generateVerificationToken().token),
    );

    expect(jetons.size).toBe(200);
  });

  it("renvoie le hash du jeton, jamais le jeton pour la base", () => {
    const { token, tokenHash } = generateVerificationToken();

    expect(tokenHash).toBe(hashVerificationToken(token));
    expect(tokenHash).not.toBe(token);
  });
});

describe("hashVerificationToken", () => {
  it("produit un SHA-256 hexadécimal de 64 caractères", () => {
    expect(hashVerificationToken("un-jeton")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("est déterministe — c'est ce qui rend la comparaison possible", () => {
    expect(hashVerificationToken("un-jeton")).toBe(
      hashVerificationToken("un-jeton"),
    );
  });

  it("distingue deux jetons proches", () => {
    expect(hashVerificationToken("un-jeton")).not.toBe(
      hashVerificationToken("un-jetoN"),
    );
  });

  it("reprend le vecteur de test SHA-256 de référence", () => {
    // Filet contre un changement d'algorithme silencieux : un jour où
    // `createHash("sha256")` deviendrait autre chose, la colonne
    // `token_hash` cesserait de correspondre aux lignes déjà en base et
    // TOUS les liens d'activation en circulation tomberaient d'un coup.
    expect(hashVerificationToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("verificationTokenExpiry", () => {
  it("ajoute le TTL à l'instant fourni", () => {
    const maintenant = new Date("2026-08-08T10:00:00.000Z");

    expect(verificationTokenExpiry(maintenant).toISOString()).toBe(
      "2026-08-09T10:00:00.000Z",
    );
  });

  it("ne mute pas la date reçue", () => {
    const maintenant = new Date("2026-08-08T10:00:00.000Z");
    verificationTokenExpiry(maintenant);

    expect(maintenant.toISOString()).toBe("2026-08-08T10:00:00.000Z");
  });
});
