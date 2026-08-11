import Link from "next/link";

import type { CurrentUser } from "@/lib/auth/dal";
import { LogoutButton } from "@/components/features/auth/logout-button";
import { Button } from "@/components/ui/button";

import { SiteNavMobile } from "./site-nav-mobile";
import { CHEMIN_RESERVATION, NAV_PUBLIQUE } from "./site-navigation";
import { UserMenu } from "./user-menu";

type UtilisateurAffiche = Pick<CurrentUser, "firstname" | "lastname"> | null;

/// En-tête de la coquille publique — barre partagée de C1 et C13.
///
/// ── Géométrie portée de C1 (`code.html:204-227`)
///
///   · barre de **80 px** (`md:h-20`), marque en `headline-md` — 24 px,
///     extra-bold, `tracking-tighter`, couleur `primary` ;
///   · gouttières de page **20 px en mobile, 64 px au-delà** (`margin-page-*`
///     du brief Stitch) ;
///   · nav desktop en `gap-8`, libellés `label-md` — 14 px, semi-bold,
///     interlettrage +0.05em ;
///   · action secondaire en texte (`px-4 py-2 rounded-xl`), action primaire en
///     bouton plein **48 px** (`px-6 py-3 rounded-xl`), ombre douce.
///
/// ── Deux écarts, tous deux imposés par la règle 2 du portage (les maquettes
/// sont en 1920×1080 seulement)
///
///  1. `sticky` et non `fixed`. Le rendu est identique — la barre reste en
///     haut — mais `fixed` obligerait à compenser sa hauteur par un `pt-24` sur
///     le contenu (`code.html:228`), une valeur en dur qui devient fausse dès
///     que la barre change de hauteur, et qui masque le contenu au zoom 200 %
///     (RGAA A).
///  2. **Un burger sous `md`.** C1 masque purement sa nav (`hidden md:flex`,
///     `code.html:211`), ce qui laisse un mobile sans aucune navigation. La
///     replier en seconde ligne a été essayé et mesuré au navigateur : **185 px
///     d'en-tête sur trois lignes en 375 px**, un quart de l'écran mangé par une
///     barre collante. Le menu vit donc dans `SiteNavMobile`, seule feuille
///     cliente du layout public.
///
/// **Il s'adapte à la session, il ne la garde pas.** `user` vient du layout, qui
/// l'obtient de `getOptionalUser` — une lecture qui renseigne et n'autorise
/// rien. Les contrôles d'accès restent dans chaque page (CLAUDE.md
/// §Authentication : jamais de check d'autorisation dans un layout partagé, le
/// Partial Rendering ne le rejoue pas en navigation client).
///
/// ── En-tête **unique** depuis T-V3-10
///
/// Il cohabitait avec `AppHeader`, posé en T-V3-03 pour rendre la déconnexion
/// atteignable dans l'espace connecté. Les deux ont fusionné ici, comme la DoD
/// le prévoyait : la coquille publique et l'espace connecté portent désormais la
/// même barre, et le couple « nom + bouton » a cédé la place au `UserMenu`
/// (avatar, initiales, menu déroulant). `AppHeader` est supprimé.
///
/// Conséquence assumée et hors périmètre client : `/admin/parametres` change
/// d'en-tête au même geste, `src/app/(app)/layout.tsx` montant celui-ci.
export function SiteHeader({
  user,
  reservationDisponible,
}: {
  user: UtilisateurAffiche;
  /// Faux quand le catalogue ne contient aucun forfait actif :
  /// `US-FORFAIT-CONSULTER` §Cas limites exige qu'alors « aucun appel à
  /// l'action de réservation ne soit proposé ». La règle vaut pour l'en-tête
  /// autant que pour la grille — proposer de réserver ce qui n'existe pas est
  /// une impasse, où qu'on clique.
  reservationDisponible: boolean;
}) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-14 w-full max-w-[1920px] items-center justify-between gap-2 px-5 sm:gap-4 md:min-h-20 md:px-16">
        <Link
          href="/"
          className="font-heading text-xl font-extrabold tracking-tighter text-primary sm:text-2xl"
        >
          HomeCycl&apos;Home
        </Link>

        {/* `aria-label` : la page porte plusieurs repères `navigation` — celui-ci
            et les deux colonnes du pied de page. Sans nom, un lecteur d'écran
            les annonce à l'identique (WCAG 1.3.1, RGAA A). Le panneau mobile
            réutilise le même nom : il n'est rendu qu'à l'ouverture, et cette
            nav-ci est alors hors de l'arbre d'accessibilité. */}
        <nav aria-label="Navigation principale" className="hidden md:block">
          <ul className="flex items-center gap-8">
            {NAV_PUBLIQUE.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm font-semibold tracking-[0.05em] text-muted-foreground transition-colors hover:text-primary"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden items-center gap-4 md:flex">
            <ActionsSession user={user} />
          </div>

          {reservationDisponible ? (
            <Button
              asChild
              className="h-12 px-4 text-sm font-semibold tracking-[0.05em] shadow-sm md:px-6"
            >
              <Link href={CHEMIN_RESERVATION}>Réserver</Link>
            </Button>
          ) : null}

          {/* Pattern donut : les actions de session sont rendues **côté
              serveur** et descendues en `children`. Les passer en props
              sérialiserait le DTO utilisateur dans la charge envoyée au
              navigateur. */}
          <SiteNavMobile>
            <ActionsSession user={user} />
          </SiteNavMobile>
        </div>
      </div>
    </header>
  );
}

/// Le même bloc dans la barre desktop et dans le panneau mobile. Il n'est jamais
/// dupliqué à l'écran : le panneau n'existe dans le DOM qu'une fois ouvert, et
/// il ne s'ouvre que là où la barre masque le sien.
function ActionsSession({ user }: { user: UtilisateurAffiche }) {
  if (!user) {
    return (
      <Link
        href="/connexion"
        className="rounded-xl px-4 py-2 text-sm font-semibold tracking-[0.05em] text-primary transition-colors hover:bg-secondary"
      >
        Connexion
      </Link>
    );
  }

  return (
    <>
      <UserMenu user={user} />

      {/* ⚠️ **Le repli sans JavaScript, et il n'est pas décoratif.** Un menu
          déroulant Radix ne s'ouvre pas sans hydratation : y placer la
          déconnexion la rendrait inatteignable, alors qu'elle l'était depuis
          T-V3-03 et qu'un E2E le prouve
          (`tests/e2e/connexion-deconnexion.spec.ts`, « la déconnexion ferme la
          session sans hydratation »). L'enjeu est celui que ce test écrit : sur
          un poste partagé, une déconnexion décorative laisse la session ouverte
          à la personne suivante, qui croit que le bouton a fait son office.

          `<noscript>` est exactement l'outil : son contenu n'est rendu que
          lorsque le script est absent, et il est masqué par la feuille de style
          de l'agent utilisateur sinon. Aucun doublon à l'écran, aucun doublon
          dans l'arbre d'accessibilité.

          `US-COMPTE-DECONNECTER` place l'action dans le menu ; ce repli ne l'en
          sort pas, il la garde joignable là où le menu n'existe pas. */}
      <noscript>
        <LogoutButton />
      </noscript>
    </>
  );
}
