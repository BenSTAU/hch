import { Bike, Truck, Zap } from "lucide-react";
import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import type { TypeCycle } from "@/lib/validations/cycles";

/// Libellés français des trois valeurs de l'ENUM.
///
/// La SPEC écrit les valeurs brutes (`CLASSIC`, `ELECTRIC`, `CARGO`) parce
/// qu'elle décrit la colonne ; la maquette C11 affiche déjà « ÉLECTRIQUE ». Le
/// reste du produit est en français, l'écran l'est aussi. Ce qui part en base
/// reste l'ENUM.
export const LIBELLES_TYPE_CYCLE: Record<TypeCycle, string> = {
  CLASSIC: "Classique",
  ELECTRIC: "Électrique",
  CARGO: "Cargo",
};

/// Une variante shadcn par valeur, choisies et écrites (DoD L4).
///
/// `destructive` est **écarté** : dans ce catalogue elle signifie erreur, et un
/// type de vélo n'en est pas une. `secondary` pour le cas le plus courant,
/// `default` pour l'électrique que la maquette peint en `primary-fixed`,
/// `outline` pour le cargo. Aucune couleur inventée hors du catalogue.
const VARIANTES: Record<TypeCycle, ComponentProps<typeof Badge>["variant"]> = {
  CLASSIC: "secondary",
  ELECTRIC: "default",
  CARGO: "outline",
};

export const ICONES_TYPE_CYCLE: Record<TypeCycle, typeof Bike> = {
  CLASSIC: Bike,
  ELECTRIC: Zap,
  CARGO: Truck,
};

/// `type` arrive en `string` et non en `TypeCycle` : la colonne est un
/// `VARCHAR(50)` tenu par un CHECK SQL, et le client Prisma la rend telle
/// quelle. Le narrow se fait ici, une fois.
export function estTypeCycle(valeur: string): valeur is TypeCycle {
  return valeur in LIBELLES_TYPE_CYCLE;
}

/// Étiquette de type, partagée par C11 et par le bloc de rattachement du
/// panneau de détail. Deux usages dès cette PR, donc promue directement dans
/// `features/` plutôt que co-localisée (règle des 2 usages).
export function BadgeTypeCycle({ type }: { type: string }) {
  // Une valeur inconnue s'affiche telle quelle plutôt que de disparaître :
  // c'est le symptôme d'une divergence entre le CHECK SQL et cette table, et la
  // masquer la rendrait invisible jusqu'au support. Même règle que
  // `EtiquetteStatut` sur les quatre statuts d'intervention.
  if (!estTypeCycle(type)) {
    return <Badge variant="outline">{type}</Badge>;
  }

  const Icone = ICONES_TYPE_CYCLE[type];

  return (
    <Badge variant={VARIANTES[type]}>
      <Icone aria-hidden="true" />
      {LIBELLES_TYPE_CYCLE[type]}
    </Badge>
  );
}
