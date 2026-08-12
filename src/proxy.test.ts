// @vitest-environment node
//
// `src/proxy.ts` — ajouté par l'agent testeur.
//
// Aucun test ne couvrait le proxy, alors que la DoD de T-J0-04 demande
// explicitement « accès direct à une route protégée sans session →
// redirection ». `dal.test.ts` couvre la redirection côté DAL, pas celle-ci —
// ce sont deux remparts distincts, et c'est justement le point : la leçon
// CVE-2025-29927 veut qu'on puisse contourner le proxy sans perdre la
// protection, donc les deux méritent leur test.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { config, proxy } from "./proxy";
import { SESSION_COOKIE } from "./lib/auth/session";

const ORIGIN = "https://hch.glanford.eu";

function request(path: string, cookie?: string) {
  return new NextRequest(`${ORIGIN}${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("proxy — redirection optimiste", () => {
  it("redirige vers la connexion en l'absence de cookie de session", () => {
    const response = proxy(request("/admin/parametres"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/connexion");
  });

  it("conserve la page demandée dans `next=`", () => {
    const response = proxy(request("/admin/parametres"));
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("next")).toBe("/admin/parametres");
  });

  it("ne fabrique jamais un `next=` qui sorte de l'origine", () => {
    // Personne ne consomme `next=` au HEAD courant — `login.ts:15` redirige
    // vers une constante. Le jour où il sera consommé, il deviendra un
    // vecteur d'open redirect si sa valeur peut désigner un autre hôte. Ce
    // test fixe l'invariant AVANT ce jour : chemin absolu, jamais
    // protocol-relative (`//hote`), jamais d'URL complète.
    for (const path of [
      "/admin/parametres",
      "/admin//evil.example",
      "/admin/https://evil.example",
      "/client/reserver?forfait=1",
    ]) {
      const response = proxy(request(path));
      const next = new URL(
        response.headers.get("location") ?? "",
      ).searchParams.get("next");

      expect(next).toMatch(/^\//);
      expect(next).not.toMatch(/^\/\//);
      expect(next).not.toMatch(/^\/?[a-z]+:\/\//i);
    }
  });

  it("laisse passer dès qu'un cookie de session est présent", () => {
    const response = proxy(
      request("/admin/parametres", `${SESSION_COOKIE}=peu-importe`),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("laisse passer un cookie de session syntaxiquement invalide", () => {
    // C'est le sens du mot « optimiste » : le proxy ne VÉRIFIE rien. Un jeton
    // forgé passe ici et se fait refuser par `verifySession()`. Ce test fixe
    // ce partage des rôles pour qu'une future « optimisation » qui vérifierait
    // la signature ici — et cesserait de la vérifier dans la DAL — se voie.
    const response = proxy(
      request("/admin/parametres", `${SESSION_COOKIE}=alg.none.forge`),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy — ce qu'il ne fait pas", () => {
  it("répond de façon synchrone, donc sans aucun accès à la base", () => {
    // Un `await` quelconque — Prisma, lecture de session, appel réseau —
    // rendrait la fonction asynchrone. La synchronicité est la preuve
    // observable qu'aucune I/O n'a lieu ici (CLAUDE.md §Authentication :
    // « jamais de lecture DB dedans »).
    const response = proxy(request("/admin/parametres"));

    expect(response).not.toBeInstanceOf(Promise);
    expect(typeof response.status).toBe("number");
  });

  it("ne décide d'aucune autorisation de rôle", () => {
    // Le proxy ne distingue pas un client d'un administrateur : le même
    // cookie ouvre `/admin` et `/client`. Le cloisonnement des rôles
    // (Constitution §3.1) appartient aux Server Actions et aux lectures
    // sensibles, pas ici.
    const cookie = `${SESSION_COOKIE}=jeton-de-client`;

    for (const path of ["/admin/parametres", "/client/reserver", "/tech/x"]) {
      expect(
        proxy(request(path, cookie)).headers.get("x-middleware-next"),
      ).toBe("1");
    }
  });
});

describe("proxy — Server Actions", () => {
  // 🐛 Défaut réel trouvé par l'E2E « reste sans erreur sur une session déjà
  // close » (T-V3-10). Une Server Action se poste sur l'URL COURANTE : sur une
  // route protégée dont le cookie a expiré, le proxy répondait à un POST
  // `Next-Action` par une navigation vers `/connexion`, que React ne sait pas
  // interpréter — « An unexpected response was received from the server ».
  //
  // Rien n'est ouvert en laissant passer : une Server Action exportée est
  // joignable depuis n'importe quelle route, y compris une route publique hors
  // matcher (ADR-006 v2). Son rempart est `authActionClient`, pas ce fichier.
  it("laisse passer une Server Action, même sans cookie", () => {
    const requete = request("/mes-interventions/a-venir");
    requete.headers.set("Next-Action", "7f9a1c2e");

    expect(proxy(requete).headers.get("x-middleware-next")).toBe("1");
  });

  it("redirige toujours la NAVIGATION vers la même route", () => {
    // La contrepartie : ce qui vient d'une barre d'adresse ou d'un lien n'a pas
    // cet en-tête, et continue d'être renvoyé vers la connexion.
    expect(proxy(request("/mes-interventions/a-venir")).status).toBe(307);
  });
});

describe("proxy — périmètre du matcher", () => {
  it("garde les six espaces connectés", () => {
    // `/mes-interventions` ajouté par T-V3-10. Il ne vit pas sous `/client/` —
    // les routes sont en français et c'est le chemin que la SPEC nomme — mais
    // les deux US exigent la même redirection vers la connexion avec un
    // `next=`. Sans cette entrée, l'espace client serait la seule surface
    // connectée que le proxy laisse passer.
    //
    // ⚠️ **`/mon-compte` ajouté par T-V3-12, et l'oracle est passé de quatre à
    // cinq** (règle du test rouge, cas 3 : le test disait vrai jusqu'à ce que
    // le produit gagne une surface). Le préfixe est tranché ici pour tout
    // l'espace compte : T-V3-07 y posera la fiche client, et sans arbitrage
    // elle aurait pu poser `/profil` - deux racines pour un seul espace.
    //
    // ⚠️ **`/interventions` ajouté par T-V2-01, cinq à six**, et celui-là
    // referme un TROU plutôt que d'accompagner une surface neuve :
    // `/interventions/du-jour` est la destination post-connexion du technicien
    // depuis [[module-1-utilisateurs]] §250, et elle n'était couverte par aucune
    // des cinq entrées. Le cadrage du plancher V2 (D2) l'a trouvée en lisant ce
    // fichier, pas le vault.
    expect(config.matcher).toEqual([
      "/admin/:path*",
      "/client/:path*",
      "/interventions/:path*",
      "/mes-interventions/:path*",
      "/mon-compte/:path*",
      "/tech/:path*",
    ]);
  });

  it("couvre la tournée du jour du technicien", () => {
    // L'entrée ci-dessus n'a d'intérêt que si elle matche RÉELLEMENT la route
    // que la SPEC nomme. Un `/interventions` sans `:path*` passerait le test
    // d'égalité ci-dessus après une retouche et ne couvrirait plus rien.
    expect(config.matcher).toContain("/interventions/:path*");
  });

  it("renvoie vers la connexion la suppression de compte d'un anonyme", () => {
    // `US-COMPTE-SUPPRIMER` exige une session, et le lien y menant est posé sur
    // une page PUBLIQUE - la politique de confidentialité. Sans cette entrée au
    // matcher, un visiteur anonyme atterrirait sur un formulaire de suppression
    // qui échouerait à l'envoi, au lieu d'être invité à se connecter.
    const reponse = proxy(request("/mon-compte/supprimer"));

    expect(reponse.status).toBe(307);
    expect(reponse.headers.get("location")).toContain(
      `next=${encodeURIComponent("/mon-compte/supprimer")}`,
    );
  });

  it("fabrique le `next=` que les deux US de l'espace client écrivent", () => {
    // « redirection vers login avec `next=/mes-interventions/passees` », mot
    // pour mot dans `US-INTERVENTIONS-LISTER-CLIENT-PASSEES` §Cas d'erreur.
    const reponse = proxy(request("/mes-interventions/passees"));

    expect(reponse.headers.get("location")).toContain(
      `next=${encodeURIComponent("/mes-interventions/passees")}`,
    );
  });

  it("laisse la vitrine, la connexion et le healthcheck hors de son champ", () => {
    // `/api/health` sans cookie doit répondre : le healthcheck du conteneur
    // n'en présente aucun, et une redirection le ferait échouer — donc
    // rollback automatique d'un déploiement pourtant sain.
    for (const path of ["/", "/connexion", "/api/health"]) {
      const couvert = config.matcher.some((pattern) =>
        path.startsWith(pattern.replace("/:path*", "/")),
      );
      expect(couvert).toBe(false);
    }
  });

  it("nomme le même cookie que `session.ts`", () => {
    // `src/proxy.ts:20` redéclare le littéral `hch_session` au lieu de
    // l'importer. Renommer le cookie dans `session.ts` sans toucher au proxy
    // le rendrait silencieusement passant sur toutes les routes protégées.
    // Ce test est le filet qui manque à cette duplication.
    const response = proxy(
      request("/admin/parametres", `${SESSION_COOKIE}=jeton`),
    );

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
