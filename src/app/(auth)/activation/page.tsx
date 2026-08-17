import type { Metadata } from "next";

import { ActivationView } from "./_components/activation-view";

export const metadata: Metadata = {
  title: "Activation — HomeCycl'Home",
};

/// Asynchrone parce qu'elle lit `searchParams`, que Next 16 type en `Promise`.
/// Elle ne fait QUE transmettre le jeton : aucune lecture en base, aucune
/// consommation. C'est le bouton de `ActivationView` qui mute, et le motif est
/// détaillé là-bas.
export default async function ActivationPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string | string[];
    renvoi?: string | string[];
    next?: string | string[];
  }>;
}) {
  const { token, renvoi, next } = await searchParams;

  // Un paramètre répété (`?token=a&token=b`) arrive en tableau. On ne devine pas
  // lequel comptait : aucun des deux.
  return (
    <ActivationView
      token={typeof token === "string" ? token : undefined}
      // `?renvoi=1` vient du lien posé sous le formulaire de connexion
      // Il ne porte aucune donnée et n'ouvre aucun droit : il
      // choisit l'écran, et le quota reste décompté côté action.
      demandeRenvoi={renvoi === "1"}
      // Destination de retour, posée par le lien d'email quand l'inscription
      // vient du tunnel de réservation. Elle traverse le formulaire jusqu'à
      // l'action, qui la fait arbitrer par `safeNextPath` avant de rediriger.
      next={typeof next === "string" ? next : undefined}
    />
  );
}
