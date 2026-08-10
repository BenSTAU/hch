import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { getOptionalUser } from "@/lib/auth/dal";
import { listForfaitsPublics } from "@/lib/db/queries/forfaits";

import { QueryProvider } from "./_components/query-provider";
import { TunnelReservation } from "./_components/tunnel-reservation";

export const metadata: Metadata = {
  title: "Réserver une intervention",
  description:
    "Choisissez votre forfait, votre adresse et votre créneau. Le technicien se déplace, vous réglez sur place.",
};

/// Tunnel de réservation - `US-INTERVENTION-RESERVER`, écrans C2 à C5.
///
/// Vit sous le groupe `(tunnel)` et non `(marketing)` : les quatre maquettes
/// remplacent l'en-tête du site par la barre d'étapes, cf. `(tunnel)/layout.tsx`.
///
/// **Route publique**, et c'est structurel : elle vit à la racine et non sous
/// `/client/`, dont `src/proxy.ts` redirigerait un visiteur anonyme vers
/// `/connexion`. La réservation précède l'inscription (Constitution §3.2).
///
/// La page ne porte que la récupération. Tout le rendu vit dans
/// `TunnelReservation`, synchrone et donc déroulable sous RTL — un RSC
/// asynchrone ne l'est pas (ADR-014 : async Server Components → E2E seulement).
export default async function ReserverPage() {
  // Indépendantes, donc en parallèle et jamais en cascade.
  // `listForfaitsPublics` est enveloppée dans `cache()`, le layout l'a déjà
  // appelée dans ce rendu.
  const [forfaits, utilisateur] = await Promise.all([
    listForfaitsPublics(),
    // Renseigne sans rediriger : le tunnel ne doit pas exiger de session.
    getOptionalUser(),
  ]);

  return (
    <NuqsAdapter>
      <QueryProvider>
        <TunnelReservation
          forfaits={forfaits}
          estConnecte={utilisateur !== null}
        />
      </QueryProvider>
    </NuqsAdapter>
  );
}
