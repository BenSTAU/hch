import type { Metadata } from "next";

import { requireTech } from "@/lib/auth/permissions";
import { instantUtc, jourLocal } from "@/lib/creneaux/horaires";
import { listerTourneeDuJour } from "@/lib/db/queries/interventions";
import { serverEnv } from "@/lib/env";
import { QueryProvider } from "@/components/query-provider";

import { EnTeteTournee } from "../_components/en-tete-tournee";
import { TourneeVue } from "./_components/tournee-vue";

export const metadata: Metadata = {
  title: "Ma tournée du jour - HomeCycl'Home",
};

/// Tournée du jour — `US-INTERVENTIONS-LISTER-TECH-DU-JOUR`, écran **T1**.
///
/// Destination post-connexion du `ROLE_TECH` ([[module-1-utilisateurs]] §250) :
/// c'est la DoD finale de la destination laissée provisoire par T-V3-03, et la
/// porte d'entrée du rôle. Jusqu'à cette tâche, un technicien se connectait et
/// atterrissait sur l'accueil public.
///
/// ── La garde vit ICI, dans la page
///
/// `requireTech()` et non un contrôle dans un layout partagé : le Partial
/// Rendering ne rejoue pas un layout en navigation client, un contrôle posé
/// là-haut deviendrait obsolète sans que rien ne le signale (CLAUDE.md
/// §Authentication). C'est aussi ce qu'une régression a prouvé sur l'espace
/// client, dont le layout appelait `getCurrentUser` en croyant ne pas garder.
///
/// `src/proxy.ts` couvre `/interventions/:path*` depuis cette tâche, mais il ne
/// fait que rediriger sur l'absence de cookie : c'est la ligne ci-dessous qui
/// refuse réellement, et c'est `listerTournee` qui refuse pour le
/// rafraîchissement — le matcher laisse délibérément passer `Next-Action`.
///
/// ── Le fuseau
///
/// La journée métier se borne sur `Europe/Paris` via `jourLocal` puis
/// `instantUtc`, jamais sur des bornes UTC construites à la main (cadrage du
/// plancher V2, D1). La note de la SPEC qui renvoie à une clé
/// `app_settings.timezone` nomme une clé qui n'existe pas — PLAN S2 §T5 tranche
/// le stockage tout-UTC, et le fuseau est une constante d'exploitation.
export default async function TourneeDuJourPage() {
  const tech = await requireTech();

  // L'horloge est fixée **une fois** au rendu : la journée listée et le titre
  // affiché doivent venir du même instant, sinon un rendu à cheval sur minuit
  // titrerait un jour et listerait l'autre.
  const maintenant = new Date();
  const jour = jourLocal(maintenant);

  const interventions = await listerTourneeDuJour({
    techId: tech.id,
    jour,
  });

  // Lue au **runtime serveur** et descendue en prop. Ce n'est pas une
  // `NEXT_PUBLIC_` : ce préfixe annonce une inlining au build, or le stage
  // builder du Dockerfile n'a aucune variable et la clé serait gelée à
  // `undefined` dans l'image de production (cf. `src/lib/env.ts`).
  const { mapsApiKey } = serverEnv();

  if (!mapsApiKey) {
    // Le log nomme la VARIABLE, pas le symptôme : « la carte est
    // indisponible » n'indique pas quoi corriger. Facultative par décision
    // (une carte sur un écran ne vaut pas un healthcheck rouge sur les deux
    // piles), donc c'est la seule trace qu'une pile mal renseignée laisse.
    // Même régime que `[creneaux] horaires illisibles…` de `lister-creneaux`.
    console.error(
      "[carte] HCH_MAPS_API_KEY absente, carte non montée ; la liste des interventions sert de repli",
    );
  }

  return (
    <>
      {/* La coquille `<main>` et la barre latérale viennent du layout de
          l'espace depuis T-V2-05. `QueryProvider`, lui, reste ICI : le polling
          n'appartient qu'à cette vue (PLAN S1 §6.1), et le monter au layout
          l'étendrait aux deux autres, qui sont de purs Server Components. */}
      <EnTeteTournee actif="du-jour" />

      <QueryProvider>
        <TourneeVue
          initialData={{
            interventions,
            debutJournee: instantUtc(jour, 0).toISOString(),
          }}
          mapsApiKey={mapsApiKey ?? null}
        />
      </QueryProvider>
    </>
  );
}
