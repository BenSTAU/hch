// Limites de bcrypt qui ont des conséquences produit : la troncature à
// 72 OCTETS, et le fait que cette limite se compte en octets et non en
// caractères. Ils fixent un comportement de la bibliothèque, pas un contrat de
// `password.ts` - c'est le schéma Zod d'inscription qui doit en tenir compte.
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("bcrypt — troncature à 72 octets", () => {
  it("accepte un mot de passe qui ne partage que ses 72 premiers octets", async () => {
    // Conséquence directe : si l'inscription n'impose pas de longueur
    // maximale, deux mots de passe distincts ouvrent le même compte dès lors
    // qu'ils partagent leurs 72 premiers octets. `loginSchema` n'a aujourd'hui
    // ni `.max()` ni pré-hachage (src/lib/validations/auth.ts:18).
    const base = "a".repeat(72);
    const hash = await hashPassword(base);

    await expect(verifyPassword(base, hash)).resolves.toBe(true);
    await expect(
      verifyPassword(`${base}-suffixe-totalement-different`, hash),
    ).resolves.toBe(true);
  });

  it("distingue encore deux mots de passe qui divergent avant le 72ᵉ octet", async () => {
    const hash = await hashPassword(`${"a".repeat(71)}X`);
    await expect(verifyPassword(`${"a".repeat(71)}Y`, hash)).resolves.toBe(
      false,
    );
  });

  it("compte la limite en octets, pas en caractères", async () => {
    // « é » pèse 2 octets en UTF-8. 40 caractères accentués = 80 octets : la
    // troncature frappe à 36 caractères, bien avant ce qu'un utilisateur
    // — ou une règle de complexité écrite en caractères — anticiperait.
    const accents = "é".repeat(40);
    const hash = await hashPassword(accents);
    await expect(verifyPassword("é".repeat(36), hash)).resolves.toBe(true);
  });

  it("ne s'effondre pas sur un mot de passe démesuré", async () => {
    // Pas de DoS par longueur : bcrypt ignore tout au-delà de 72 octets, le
    // coût reste celui du cost 10. Le seul risque résiduel est la taille du
    // corps de requête, qui relève du serveur, pas d'ici.
    const hash = await hashPassword("x".repeat(100_000));
    await expect(verifyPassword("x".repeat(100_000), hash)).resolves.toBe(true);
  });
});

describe("verifyPassword — entrées dégénérées", () => {
  it("refuse un mot de passe vide contre un hash réel", async () => {
    const hash = await hashPassword("un-vrai-mot-de-passe");
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("refuse sans lever quand le hash est null ou undefined", async () => {
    // `auth_providers.password_hash` est nullable en base
    // (prisma/schema.prisma:72). Le garde `if (!hash)` de password.ts:22 est
    // la dernière ligne de défense si un appelant oublie le sien.
    const asHash = (value: unknown) => value as string;
    await expect(verifyPassword("x", asHash(null))).resolves.toBe(false);
    await expect(verifyPassword("x", asHash(undefined))).resolves.toBe(false);
  });

  it("refuse sans lever un hash tronqué qui ressemble à du bcrypt", async () => {
    const hash = await hashPassword("un-vrai-mot-de-passe");
    await expect(
      verifyPassword("un-vrai-mot-de-passe", hash.slice(0, 30)),
    ).resolves.toBe(false);
  });
});
