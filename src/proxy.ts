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
  //
  // `pathname + search`, et non le seul `pathname` : sans la query string,
  // `/admin/parametres?onglet=societe` revenait en `/admin/parametres` et
  // l'utilisateur perdait son filtre en traversant la connexion. Relevé par
  // l'agent testeur sur T-J0-05 (B7). Le fragment, lui, n'est jamais envoyé
  // au serveur — il n'y a rien à en conserver.
  const demandee = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  url.search = `?next=${encodeURIComponent(demandee)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Seules les routes de l'espace connecté. La vitrine, la connexion et
  // `/api/health` doivent rester joignables sans cookie — le healthcheck du
  // conteneur n'en présente aucun, et une redirection le ferait échouer.
  matcher: ["/admin/:path*", "/client/:path*", "/tech/:path*"],
};
