import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Redirect **optimiste**, et rien d'autre.
//
// Ce fichier ne lit pas la base, ne vérifie pas la signature du jeton, et ne
// décide d'aucune autorisation : il regarde si un cookie est présent, pour
// éviter d'afficher un squelette de page à quelqu'un qui n'est pas connecté.
// La vérification réelle vit dans `src/lib/auth/dal.ts`, rejouée à chaque
// lecture sensible.
//
// La raison est structurelle, pas conjoncturelle : la CVE-2025-29927
// permettait de contourner entièrement le middleware Next par un simple
// en-tête. Elle est corrigée, la leçon est conservée — un rempart unique
// placé en amont du rendu est un rempart qu'on contourne.
//
// `middleware.ts` est déprécié et renommé `proxy` en Next 16
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).

const SESSION_COOKIE = "hch_session";
const LOGIN_PATH = "/connexion";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  // Conserve la page demandée pour y revenir après connexion — le `next=`
  // qu'attend US-COMPTE-CONNECTER §Cas nominal.
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Seules les routes de l'espace connecté. La vitrine, la connexion et
  // `/api/health` doivent rester joignables sans cookie — le healthcheck du
  // conteneur n'en présente aucun, et une redirection le ferait échouer.
  matcher: ["/admin/:path*", "/client/:path*", "/tech/:path*"],
};
