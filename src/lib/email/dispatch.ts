import "server-only";

import { after } from "next/server";

/// Envoi d'email **hors du chemin de réponse**.
///
/// Deux raisons, et elles sont solidaires.
///
/// La première est l'anti-énumération. Un envoi attendu dans le corps d'une
/// Server Action met son aller-retour SMTP — ~150 ms vers `smtp.gmail.com` — dans
/// la durée de réponse. Les chemins qui envoient deviennent alors distinguables
/// de ceux qui n'envoient pas, alors que leur RÉPONSE est identique : c'est la
/// classe de fuite mesurée à 1 300×-16 000× sur la connexion en T-J0-04, rouverte
/// par une autre porte. Mesurée à 6,5× sur le renvoi d'activation par l'agent
/// testeur en T-V3-02 (B3).
///
/// La seconde est l'arbitrage du 2026-08-08 sur B2 : la Constitution §4.2 gagne
/// contre l'échec bruyant côté utilisateur d'ADR-017. La réponse ne dépend plus
/// du sort de l'envoi — donc rien n'oblige plus à l'attendre.
///
/// Ce qu'ADR-017 exige reste tenu, mais côté exploitant : l'échec est journalisé,
/// jamais avalé. Et le recours côté client existe, c'est le renvoi d'activation.
///
/// `after()` et non une promesse flottante : Next maintient l'invocation en vie
/// jusqu'à la fin du rappel (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`,
/// §Platform Support — Docker : Yes). Une promesse flottante n'a pas cette
/// garantie.
export function dispatchEmail(
  libelle: string,
  envoyer: () => Promise<void>,
): void {
  after(async () => {
    try {
      await envoyer();
    } catch (error) {
      console.error(`[email] ${libelle} — envoi impossible :`, error);
    }
  });
}
