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

  // 🐛 **Une Server Action n'est pas une navigation, et la rediriger casse le
  // client.** Une action se poste sur l'URL COURANTE : sans cookie, la
  // redirection ci-dessous répondait à un POST `Next-Action` par une navigation
  // vers `/connexion`, que React ne sait pas interpréter — « An unexpected
  // response was received from the server », écran d'erreur au lieu de l'action
  // demandée.
  //
  // Le cas se produit dès qu'un cookie expire ou qu'un second onglet ferme la
  // session, et il touchait déjà `/admin/parametres` sans que rien ne le
  // signale. Trouvé par l'E2E « reste sans erreur sur une session déjà close »
  // (T-V3-10), sur la déconnexion : `US-COMPTE-DECONNECTER` §Cas d'erreur exige
  // un comportement idempotent, pas un écran d'erreur.
  //
  // **Rien n'est ouvert en laissant passer.** Ce garde n'a jamais protégé une
  // Server Action : elles sont exportées, donc joignables depuis n'importe
  // quelle route — y compris une route publique que ce matcher ne couvre pas
  // (ADR-006 v2, « chaque Server Action exportée est un endpoint POST
  // public »). Leur vrai rempart est `authActionClient`, qui passe par le DAL.
  // Ce qui est retiré ici est un obstacle qui ne gênait que les appelants
  // légitimes.
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
  // Seules les routes de l'espace connecté. La vitrine, la connexion et
  // `/api/health` doivent rester joignables sans cookie — le healthcheck du
  // conteneur n'en présente aucun, et une redirection le ferait échouer.
  //
  // `/mes-interventions` ajouté par T-V3-10. Il ne vit pas sous `/client/`
  // parce que les routes sont en français (CLAUDE.md §Folder structure) et que
  // c'est le chemin que la SPEC nomme, mais il est protégé au même titre : les
  // deux US exigent « redirection vers login avec `next=/mes-interventions/…` »
  // en l'absence de session, et c'est ce `next=` que la ligne ci-dessous
  // fabrique.
  // `/mon-compte` ajouté par T-V3-12. Même motif que `/mes-interventions` :
  // routes en français, hors `/client/`, mais protégées au même titre. La
  // suppression de compte exige une session, et un visiteur anonyme qui suit le
  // lien de la politique de confidentialité doit atterrir sur `/connexion` avec
  // son `next=`, pas sur un formulaire qui échouera au premier envoi.
  // `/interventions` ajouté par T-V2-01, et le trou qu'il referme mérite d'être
  // nommé : `/interventions/du-jour` est la destination post-connexion du
  // technicien depuis [[module-1-utilisateurs]] §250, et elle n'était couverte
  // par AUCUNE des cinq entrées ci-dessous. Un technicien sans cookie y
  // arrivait sans redirection ni `next=`, et n'obtenait le refus qu'au rendu de
  // la page.
  //
  // `/tech/:path*` et `/client/:path*` restent, bien que plus aucune route ne
  // vive sous ces préfixes depuis la suppression des deux dossiers vides : ils
  // ne coûtent rien et referment la porte si une route y réapparaissait par
  // inadvertance.
  matcher: [
    "/admin/:path*",
    "/client/:path*",
    "/interventions/:path*",
    "/mes-interventions/:path*",
    "/mon-compte/:path*",
    "/tech/:path*",
  ],
};
