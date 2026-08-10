import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

/// Faux service d'adressage, pour la barrière E2E **en local**.
///
/// `verifierAdresse` et `reserver` re-géocodent côté serveur : cet appel part
/// du processus Next, et `page.route()` de Playwright ne l'intercepte pas.
/// `HCH_BAN_BASE_URL` pointe donc l'application ici, et `GP-02` peut aller
/// jusqu'à la validation sans jamais toucher la vraie BAN.
///
/// En CI, ce rôle est tenu par le service `hch-ban-mock` de
/// `docker-compose.test.yml` : l'application y tourne dans l'image de
/// production, sur le réseau du projet compose, et n'a aucun moyen de joindre
/// un processus de l'hôte. Les deux servent **le même fichier**,
/// `tests/fixtures/ban-search.json`, dont un test unitaire vérifie qu'il ne
/// diverge pas des fixtures MSW.
///
/// Répond la même adresse quelle que soit la requête, et c'est suffisant : ce
/// que la barrière éprouve, c'est le tunnel, pas la BAN.

const PORT = Number(process.env["HCH_BAN_MOCK_PORT"] ?? 3100);

const corps = readFileSync(
  fileURLToPath(new URL("../fixtures/ban-search.json", import.meta.url)),
  "utf8",
);

createServer((_requete, reponse) => {
  reponse.writeHead(200, { "content-type": "application/json" });
  reponse.end(corps);
}).listen(PORT, "127.0.0.1", () => {
  // Playwright attend cette ligne pour considérer le serveur prêt.
  console.log(`[ban-mock] http://127.0.0.1:${String(PORT)}/`);
});
