import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";

// Sonde interrogée par le healthcheck du conteneur et par la boucle de
// vérification post-déploiement du pipeline. Elle doit toucher la base : une
// application qui répond mais ne joint pas Postgres est une application
// cassée, et c'est précisément ce que le rollback automatique doit détecter.
//
// `force-dynamic` parce que la réponse dépend de l'état de la base à l'instant
// de l'appel. Sans lui, Next évaluerait la route à la construction — donc dans
// le stage builder du Dockerfile, où il n'y a aucune base à joindre.
export const dynamic = "force-dynamic";

export async function GET() {
  // La garde d'environnement est branchée ICI, et c'est ce qui la rend vraie
  // plutôt que déclarative : une variable applicative manquante fait tomber la
  // sonde, donc le healthcheck du conteneur, donc le rollback inline vers
  // l'image précédente — pile debout, job rouge (TASKS §1 §Variables
  // d'environnement). Sans ce point d'appel, l'absence d'une clé ne se verrait
  // qu'à l'usage : l'email à l'inscription, le géocodage au tunnel.
  //
  // Appelée dans le corps du handler et non à l'import : `force-dynamic`
  // ci-dessus empêche l'évaluation au build, mais un appel au chargement du
  // module casserait quand même le stage builder du Dockerfile.
  //
  // En premier, et à part de la base : le message de la garde nomme les
  // variables attendues, et il ne doit pas être confondu avec « Postgres
  // injoignable » dans les logs — les deux se réparent à des endroits
  // différents.
  try {
    serverEnv();
  } catch (error) {
    console.error("[health] environnement incomplet :", error);
    return NextResponse.json(
      { status: "degraded", env: false },
      { status: 503 },
    );
  }

  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: true }, { status: 200 });
  } catch (error) {
    // Le détail part dans les logs du conteneur, jamais dans la réponse : en
    // production cette route est publique, et un message d'erreur Prisma
    // porte l'hôte, le port et l'utilisateur de la base. PLAN S3 §5 renvoie
    // `error: err.message` au client — c'est ce point qui diverge.
    console.error("[health] base injoignable :", error);
    return NextResponse.json(
      { status: "degraded", db: false },
      { status: 503 },
    );
  }
}
