import { listForfaitsPublics } from "@/lib/db/queries/forfaits";

import { LandingView } from "./_components/landing-view";

/// Accueil public — écran **C1**, `US-FORFAIT-CONSULTER`.
///
/// C'est la porte d'entrée du parcours : le visiteur y voit ce que ça coûte,
/// sans compte et sans devis intermédiaire (Constitution §5.1). C'est aussi,
/// depuis T-V3-03, la destination post-connexion provisoire du client et du
/// technicien, ainsi que celle de la déconnexion — le vrai tableau de bord,
/// écran C7, arrive avec T-V3-10.
///
/// La page est **dynamique** : elle lit le catalogue et `searchParams`. Elle
/// n'exige aucune session pour autant — l'en-tête du layout lit la sienne par
/// `getOptionalUser`, qui renseigne sans rediriger.
///
/// Elle ne porte que la récupération. Tout le rendu vit dans `LandingView`, qui
/// est synchrone et donc déroulable sous RTL et `jest-axe` — un RSC asynchrone
/// ne l'est pas (ADR-014 : async Server Components → E2E uniquement).
export default async function AccueilPage({
  searchParams,
}: {
  searchParams: Promise<{ deconnecte?: string | string[] }>;
}) {
  // Les deux lectures sont indépendantes : en parallèle, jamais en cascade
  // (CLAUDE.md §Data fetching). `listForfaitsPublics` est enveloppée dans
  // `cache()` — le layout l'a déjà appelée dans ce rendu, il n'y a qu'une
  // requête.
  const [{ deconnecte }, forfaits] = await Promise.all([
    searchParams,
    listForfaitsPublics(),
  ]);

  return <LandingView forfaits={forfaits} deconnecte={deconnecte === "1"} />;
}
