import { Clock } from "lucide-react";
import Link from "next/link";

import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import { formatDuree, formatPrixEuros } from "@/lib/format";
import { CHEMIN_RESERVATION } from "@/components/layouts/site-navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/// Une carte du catalogue public — C1 §Des forfaits transparents
/// (`code.html:308-398`).
///
/// ── Géométrie portée
///
///   · dalle `surface-container-low`, **`p-6`** (`padding-card` du brief) et
///     `rounded-2xl`, colonne en `gap-6` ;
///   · titre en `headline-sm` (20 px), prix en `headline-lg` (32 px, extra-bold,
///     `tracking-[-0.03em]`), alignés sur la ligne de base comme la maquette ;
///   · appel à l'action **collé en bas** (`mt-auto`), pleine largeur, 48 px de
///     haut — les trois cartes gardent ainsi leurs boutons alignés quelle que
///     soit la longueur des descriptions.
///
/// `import type` sur `ForfaitPublic` : le module de requête porte
/// `import "server-only"`, et seul le type traverse — il est effacé à la
/// compilation, aucun code serveur n'est tiré ici.
///
/// ── Deux éléments de la maquette qui ne se portent pas
///
///  1. **Les puces de prestation.** C1 (`code.html:317-330`) liste « Diagnostic
///     30 points », « 2 Pneus renforcés inclus », « Recyclage anciens pneus » :
///     aucune source. Le catalogue réel porte déjà un texte,
///     `services.description`, alimenté par le seed de T-V3-01 — c'est lui qui
///     s'affiche. Une puce inventée sur une page de tarifs est un engagement
///     commercial que personne n'a pris.
///  2. **La mise en avant du forfait du milieu** (`scale-105`, `ring-2`, badge
///     « Populaire », `code.html:336-339`). Elle suppose une donnée qui n'existe
///     pas : `services` ne porte aucun marqueur de mise en avant, et rien dans
///     la SPEC n'en définit un. Elle suppose aussi un catalogue de **trois**
///     forfaits exactement, alors que le nombre est libre — le seed en pose
///     trois, l'admin en créera d'autres en V1. Signalée au write-back.
///
/// Naît en `_components/` : elle montera dans `components/features/forfaits/`
/// au 2ᵉ usage, quand le tunnel de T-V3-08 portera l'écran C2 (règle des 2
/// usages).
export function ForfaitCard({ forfait }: { forfait: ForfaitPublic }) {
  return (
    <Card className="flex w-full flex-col gap-6 border-0 bg-secondary [--card-spacing:--spacing(6)]">
      <CardHeader className="gap-0">
        <h3 className="font-heading text-xl font-bold tracking-[-0.01em]">
          {forfait.label}
        </h3>

        <p className="mt-4 flex items-baseline gap-2">
          <span className="font-heading text-[2rem] leading-tight font-extrabold tracking-[-0.03em]">
            {formatPrixEuros(forfait.price)}
          </span>
          {/* Constitution §5.1 : « les tarifs sont publics, complets ». Sans la
              mention TTC, « complet » n'est pas démontré — le visiteur ne sait
              pas si une taxe s'ajoute au moment de payer. */}
          <span className="text-sm text-muted-foreground">TTC</span>
        </p>

        {/* La durée est une donnée de tarif autant que le prix : c'est elle qui
            dimensionne le créneau (Constitution §2.1), donc ce que le visiteur
            bloque dans sa journée. */}
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock aria-hidden="true" className="size-4 shrink-0" />
          {formatDuree(forfait.duration)}
        </p>
      </CardHeader>

      {forfait.description ? (
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {forfait.description}
          </p>
        </CardContent>
      ) : null}

      <CardContent className="mt-auto">
        <Button asChild className="h-12 w-full text-sm font-semibold">
          {/* Lien vers l'ENTRÉE du tunnel, sans forfait pré-sélectionné : la DoD
              de T-V3-13 l'impose tant que T-V3-08 n'a pas livré l'état
              pré-rempli. Les trois cartes pointent donc la même URL, d'où le
              complément lu par les seuls lecteurs d'écran — trois liens de même
              nom accessible dans une grille de comparaison ne se distinguent
              pas à la tabulation. */}
          <Link href={CHEMIN_RESERVATION}>
            Réserver
            <span className="sr-only"> — {forfait.label}</span>
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
