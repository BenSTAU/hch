import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

/// Enveloppe commune aux tests du tunnel.
///
/// Deux contextes sont indispensables et n'ont rien de décoratif : `nuqs` porte
/// l'étape et le forfait dans l'URL, TanStack Query porte la grille de créneaux.
/// Sans eux les composants lèvent au premier rendu, et le test échouerait pour
/// une raison qui n'a rien à voir avec ce qu'il vérifie.
///
/// ⚠️ Il vit dans `src/test/` et non à côté des composants : `src/app/` ne
/// contient que du routing et ses `_components/` (CLAUDE.md §Folder structure),
/// et `vitest.config.mts` ne ramasse que le suffixe `*.test.tsx` - un
/// utilitaire posé là serait exécuté comme une suite vide.

/// `retry: false` : sans ça, une `queryFn` en échec est rejouée trois fois avec
/// une temporisation exponentielle, et le test d'erreur expire avant d'avoir vu
/// le message qu'il attend.
export function creerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

export function EnveloppeTunnel({
  children,
  searchParams = "",
}: {
  children: ReactNode;
  /// Query string initiale, pour poser une étape ou un forfait sans passer par
  /// l'interface.
  searchParams?: string;
}) {
  // `useState` et non un appel direct : un client neuf à chaque rendu viderait
  // le cache de requêtes en cours de test, et la grille de créneaux
  // repartirait en chargement au moindre changement d'état.
  const [client] = useState(creerQueryClient);

  return (
    /* `hasMemory` est indispensable et vaut `false` par défaut : sans lui,
       l'adaptateur GÈLE les paramètres sur leur valeur initiale. La mise à jour
       optimiste passe, puis la valeur revient - un forfait retenu se perdait
       au pas suivant, et le tunnel affichait son écran de reprise. */
    <NuqsTestingAdapter searchParams={searchParams} hasMemory>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NuqsTestingAdapter>
  );
}

/// Les trois forfaits du seed de T-V3-01, avec leurs vraies valeurs. Un jeu
/// inventé rendrait vert un test que le catalogue réel ferait échouer - le prix
/// et la durée sont affichés tels quels, et `formatPrixEuros` les met en forme.
export const FORFAITS = [
  {
    id: 2,
    label: "Diagnostic express",
    description:
      "Contrôle rapide de l'état général du vélo et devis des réparations à prévoir, sans démontage.",
    duration: 20,
    price: "25.00",
  },
  {
    id: 3,
    label: "Changement pneus",
    description:
      "Dépose et pose des pneus et chambres à air, contrôle de la pression et de l'état des jantes.",
    duration: 30,
    price: "39.00",
  },
  {
    id: 1,
    label: "Révision complète",
    description:
      "Réglage des patins et disques, indexation des dérailleurs, dévoilage des roues.",
    duration: 60,
    price: "85.00",
  },
];

/// Les trois produits du seed de T-V3-01, dans l'ordre que rend
/// `listProduitsVendables` (alphabétique). Les identifiants sont ceux de
/// l'insertion, qui n'est pas le même ordre - un jeu où les deux coïncideraient
/// masquerait une confusion entre index et identifiant.
///
/// `description` est `null` partout : le seed n'en pose aucune, et un jeu qui
/// en inventerait rendrait vert un rendu que le catalogue réel n'a pas.
export const PRODUITS = [
  {
    id: 2,
    label: "Antivol en U",
    description: null,
    price: "39.90",
    stock: 15,
  },
  {
    id: 1,
    label: "Chambre à air 700×35",
    description: null,
    price: "12.90",
    stock: 40,
  },
  {
    id: 3,
    label: "Paire de patins de frein",
    description: null,
    price: "9.90",
    stock: 60,
  },
];

/// Vélos du visiteur connecté, pour le bloc « Vélo concerné » de C5.
///
/// Deux lignes et deux types distincts : c'est le minimum qui permette de
/// vérifier qu'un choix remplace l'autre et que le badge suit la valeur d'ENUM.
/// Marques génériques, comme le seed - le dépôt bascule public.
///
/// ⚠️ Le tableau **vide** est l'autre cas nominal et non un cas limite : le seed
/// ne pose aucun vélo, donc un client qui vient de créer son compte au
/// récapitulatif n'en a aucun. Les tests le posent en passant `[]`.
export const CYCLES = [
  {
    id: 7,
    brand: "Decathlon",
    model: "Elops 900",
    type: "CLASSIC",
    year: 2023,
  },
  {
    id: 4,
    brand: "Moustache",
    model: null,
    type: "ELECTRIC",
    year: null,
  },
];

/// Adresse de démonstration, alignée sur `src/mocks/handlers.ts` : la même
/// donnée sert le mock réseau et les props des tests, pour qu'un changement de
/// fixture ne laisse pas deux vérités.
export const ADRESSE = {
  label: "12 Rue de la Bicyclette 69003 Lyon",
  street: "12 Rue de la Bicyclette",
  postcode: "69003",
  city: "Lyon",
  citycode: "69383",
  lon: 4.832,
  lat: 45.7578,
};
