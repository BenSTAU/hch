import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { getOptionalUser } from "@/lib/auth/dal";
import { listerCyclesDuClient } from "@/lib/db/queries/cycles";
import { listForfaitsPublics } from "@/lib/db/queries/forfaits";
import { listProduitsVendables } from "@/lib/db/queries/produits";
import { QueryProvider } from "@/components/query-provider";
import { espacePrincipal } from "@/components/layouts/site-navigation";

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
/// `TunnelReservation`, synchrone et donc déroulable sous RTL : un RSC
/// asynchrone ne l'est pas (ADR-014 : async Server Components → E2E seulement).
export default async function ReserverPage() {
  // Indépendantes, donc en parallèle et jamais en cascade.
  // `listForfaitsPublics` est enveloppée dans `cache()`, le layout l'a déjà
  // appelée dans ce rendu.
  const [forfaits, produits, utilisateur, cycles] = await Promise.all([
    listForfaitsPublics(),
    // Le catalogue additionnel est lu ICI et non à l'étape panier : le
    // récapitulatif est rendu par un composant client, qui ne peut pas
    // interroger la base (Constitution §2.6 - c'est un seul acte, donc un seul
    // chargement).
    listProduitsVendables(),
    // Renseigne sans rediriger : le tunnel ne doit pas exiger de session.
    getOptionalUser(),
    // Les vélos du visiteur, pour le bloc « Vélo concerné » de C5.
    //
    // Le second appel à `getOptionalUser()` ne coûte rien : la fonction est
    // enveloppée dans `cache()` de React (`lib/auth/dal.ts:51`), donc elle rend
    // la même promesse pendant ce rendu - ni cookie relu, ni requête de plus.
    // C'est ce qui permet de garder les quatre lectures dans un seul
    // `Promise.all` au lieu d'enchaîner la session puis les vélos.
    getOptionalUser().then((u) =>
      u ? listerCyclesDuClient({ userId: u.id }) : [],
    ),
  ]);

  return (
    <NuqsAdapter>
      <QueryProvider>
        <TunnelReservation
          forfaits={forfaits}
          produits={produits}
          cycles={cycles}
          estConnecte={utilisateur !== null}
          // 🐛 **La sortie de l'écran de confirmation suit le rôle.** Elle
          // pointait `CHEMIN_ESPACE_CLIENT` en dur, et `/reserver` reste
          // ouverte à tous les rôles (Constitution §3.2) : un technicien qui
          // réserve pour lui-même atterrissait sur un appel à l'action menant
          // au 403 de `requireEspaceClient()`. La conséquence assumée de
          // T-V2-05 est qu'il perde l'accès au rendez-vous, pas qu'un bouton
          // lui mente. Trouvé par l'agent testeur.
          //
          // Calculé au rendu de la page : un visiteur anonyme n'a pas de rôle,
          // et l'inscription en fin de tunnel crée un `ROLE_CLIENT` - le repli
          // de `espacePrincipal` est donc la bonne destination pour lui.
          espace={espacePrincipal(utilisateur?.roles ?? [])}
        />
      </QueryProvider>
    </NuqsAdapter>
  );
}
