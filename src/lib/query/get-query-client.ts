import { isServer, QueryClient } from "@tanstack/react-query";

/// Fabrique du client TanStack Query.
///
/// **Périmètre strict** : TanStack Query n'entre dans HCH que pour les trois
/// vues qu'a nommées PLAN S1 §6.1, et la grille de créneaux du tunnel est la
/// seule des trois qui existe aujourd'hui. Partout ailleurs, lecture directe en
/// Server Component et revalidation en sortie de Server Action.
///
/// Factory et non singleton de module : sur le serveur, un client partagé
/// mélangerait les caches de deux requêtes simultanées — donc les créneaux d'un
/// visiteur avec ceux d'un autre. La garde `isServer` est ce qui l'empêche.
function creerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Aligné sur l'intervalle de rafraîchissement : en deçà, un remontage
        // de composant déclencherait une requête que le polling vient de faire.
        staleTime: 30_000,
        // Le refus d'un créneau pris n'est pas une panne réseau : réessayer
        // trois fois n'y changerait rien et retarderait l'affichage.
        retry: 1,
      },
    },
  });
}

let clientNavigateur: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) return creerQueryClient();

  // Une seule instance par onglet : la recréer à chaque rendu viderait le cache
  // et relancerait le polling à zéro.
  clientNavigateur ??= creerQueryClient();
  return clientNavigateur;
}
