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
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;

  // Un paramètre répété (`?token=a&token=b`) arrive en tableau. On ne devine pas
  // lequel comptait : aucun des deux.
  return (
    <ActivationView token={typeof token === "string" ? token : undefined} />
  );
}
