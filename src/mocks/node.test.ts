import { describe, expect, it } from "vitest";

/// `src/mocks/handlers.ts` annonce que la liste vide, combinée à
/// `onUnhandledRequest: "error"`, forme « un garde-fou actif, pas un fichier en
/// attente ». C'était une affirmation sans test : aucun module du projet
/// n'émet aujourd'hui de requête sortante, donc retirer `server.listen()` de
/// `vitest.setup.ts` n'aurait fait échouer strictement personne — le garde
/// serait tombé en silence, et le premier appel réseau du projet serait parti
/// sur internet depuis la CI sans que rien ne le signale.
describe("MSW — interception réseau de la suite Vitest", () => {
  it("refuse tout appel sortant non déclaré", async () => {
    // L'endpoint token de Google : celui-là même qu'ADR-014 §2 nomme comme le
    // premier handler à écrire, quand `oauth-google.ts` arrivera.
    // L'oracle porte sur le préfixe `[MSW]`, pas sur « ça rejette ». Un
    // simple `rejects.toThrow()` passerait au vert sur un runner sans sortie
    // réseau, où l'appel échoue tout seul — le test aurait alors l'air de
    // prouver le garde alors qu'il constate une panne. Message constaté :
    // « [MSW] Cannot bypass a request when using the "error" strategy for the
    // "onUnhandledRequest" option. »
    await expect(
      fetch("https://oauth2.googleapis.com/token", { method: "POST" }),
    ).rejects.toThrow(/\[MSW\]/);
  });
});
