import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Redirect **optimiste**, et rien d'autre : présence du cookie, pas de lecture
// de base, pas de vérification de signature, aucune décision d'autorisation.
// La vérification réelle vit dans `src/lib/auth/dal.ts` — un rempart unique
// placé en amont du rendu est un rempart qu'on contourne (leçon structurelle
// CVE-2025-29927, conservée après correctif). Cf. ADR-005 v2 §Cloisonnement.
//
// `middleware.ts` est déprécié et renommé `proxy` en Next 16
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).

const SESSION_COOKIE = "hch_session";
const LOGIN_PATH = "/connexion";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  // ⚠️ **Une Server Action se poste sur l'URL courante : la rediriger casse le
  // client**, React ne sachant pas interpréter une navigation en réponse à un
  // POST `Next-Action`.
  //
  // Laisser passer n'ouvre rien. Ce garde n'a jamais protégé une Server
  // Action : elles sont exportées, donc joignables depuis n'importe quelle
  // route, y compris hors de ce matcher (ADR-006 v2). Leur rempart est
  // `authActionClient`, qui passe par le DAL.
  if (request.headers.has("Next-Action")) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  // Le `next=` qu'attend US-COMPTE-CONNECTER §Cas nominal. `pathname + search`
  // et non le seul `pathname`, sinon l'utilisateur perd ses filtres en
  // traversant la connexion. Le fragment n'est jamais envoyé au serveur.
  const demandee = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.search = `?next=${encodeURIComponent(demandee)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Seules les routes de l'espace connecté.
  //
  // ⚠️ **La vitrine, la connexion et `/api/health` doivent rester hors de cette
  // liste** : le healthcheck du conteneur ne présente aucun cookie, et une
  // redirection le ferait échouer, donc rollback d'un déploiement pourtant sain.
  //
  // `/tech/` et `/client/` n'hébergent plus aucune route : entrées mortes
  // assumées, elles referment la porte si l'une y réapparaissait.
  //
  // Historique des ajouts, tâche par tâche : TASKS.
  matcher: [
    "/admin/:path*",
    "/client/:path*",
    "/interventions/:path*",
    "/mes-interventions/:path*",
    "/mon-compte/:path*",
    "/tech/:path*",
  ],
};
