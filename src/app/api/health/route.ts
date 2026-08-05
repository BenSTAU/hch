import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";

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
