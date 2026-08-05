// Configuration du CLI Prisma.
//
// Elle existe pour une raison précise : le CLI ne lit PAS `.env.local`, alors
// que c'est le fichier que prescrivent le vault et CLAUDE.md — le seul qui
// diffère entre le PC maison et le PC Shadow. Sans ce chargement explicite,
// `prisma migrate dev` échoue sur un DATABASE_URL absent pendant que
// `pnpm dev` fonctionne, et l'erreur ne pointe pas vers sa cause.
//
// L'ordre de chargement reproduit celui de Next.js : `.env.local` d'abord,
// `.env` ensuite. dotenv n'écrase jamais une variable déjà définie, donc le
// premier chargé gagne, et l'environnement réel gagne sur les deux — c'est ce
// qui fait fonctionner `migrate deploy` en CI et en production, où aucun de
// ces deux fichiers n'existe.
import { config as loadEnvFile } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnvFile({ path: ".env.local", quiet: true });
loadEnvFile({ path: ".env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Le seed est du TypeScript : tsx l'exécute sans étape de compilation.
    seed: "tsx prisma/seed.ts",
  },
  engine: "classic",
  datasource: {
    // `process.env` avec repli, et non le helper `env()` de prisma/config :
    // ce dernier lève au CHARGEMENT du fichier, donc pour TOUTES les
    // commandes — y compris `prisma generate`, qui n'a aucun besoin d'une
    // base. Le stage builder du Dockerfile n'a pas de DATABASE_URL, et
    // l'image ne se construirait plus. Le repli n'est jamais utilisé pour se
    // connecter : toute commande qui touche la base échoue explicitement sur
    // une URL vide, ce qui est le comportement voulu.
    url: process.env["DATABASE_URL"] ?? "",
  },
});
