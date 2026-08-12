import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/// ⚠️ **`border border-border` remplace le `ring-1 ring-foreground/10` du
/// registry, et c'est une modification VOLONTAIRE d'un fichier régénérable.**
///
/// Audit de conformité du 2026-08-12 : dix endroits redessinaient une card à la
/// main en `rounded-2xl border border-border bg-card`, parce que le composant
/// ne rendait pas la bordure que les maquettes dessinent. Deux traitements pour
/// un même objet, et le composant perdait à chaque fois.
///
/// Le sens du correctif suit [[adr-012-maquettage-stitch-shadcn|ADR-012]] §D4 -
/// « quand une maquette validée diverge, la maquette fait foi » : T1 et C8
/// bordent leurs cards. C'est donc le registry qui s'aligne, pas l'inverse.
///
/// ── `asChild`, ajouté pour la même raison
///
/// Plusieurs des dix sites étaient des `<section aria-labelledby>` : les rendre
/// en `div` pour gagner le composant aurait échangé une duplication de style
/// contre une perte de sémantique. `Slot` est le pattern que `ui/button.tsx`
/// utilise déjà dans ce dépôt.
///
/// ⚠️ Un `pnpm dlx shadcn@latest add card` écraserait les deux modifications.
/// Le précédent est le « Close » de `ui/sheet.tsx`, et la garde est la même :
/// `card.test.tsx` échoue si la bordure ou `asChild` disparaissent.
function Card({
  className,
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm";
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-2xl border border-border bg-card py-(--card-spacing) text-sm text-card-foreground [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-2xl *:[img:last-child]:rounded-b-2xl",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-2xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-2xl border-t bg-muted/50 p-(--card-spacing)",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
