import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("hashPassword", () => {
  it("produit un hash bcrypt de cost 10", async () => {
    const hash = await hashPassword("correct horse battery staple");
    // Préfixe bcrypt : $2b$ = variante, 10 = cost. ADR-005 v2 impose ≥ 10.
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
  });

  it("ne produit jamais deux fois le même hash pour le même mot de passe", async () => {
    const [a, b] = await Promise.all([
      hashPassword("même mot de passe"),
      hashPassword("même mot de passe"),
    ]);
    // Le sel est aléatoire : deux hashs identiques trahiraient son absence.
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("accepte le bon mot de passe", async () => {
    const hash = await hashPassword("s3cr3t-v4lide");
    await expect(verifyPassword("s3cr3t-v4lide", hash)).resolves.toBe(true);
  });

  it("rejette un mauvais mot de passe", async () => {
    const hash = await hashPassword("s3cr3t-v4lide");
    await expect(verifyPassword("s3cr3t-invalide", hash)).resolves.toBe(false);
  });

  it("rejette sans lever quand le hash est vide ou mal formé", async () => {
    // Un compte OAuth pur porte password_hash = NULL. L'appelant ne doit pas
    // avoir à s'en prémunir par un try/catch.
    await expect(verifyPassword("peu importe", "")).resolves.toBe(false);
    await expect(verifyPassword("peu importe", "pas-un-hash")).resolves.toBe(
      false,
    );
  });
});
