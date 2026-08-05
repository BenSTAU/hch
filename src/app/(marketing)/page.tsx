import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AccueilPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="font-semibold text-primary text-sm">HomeCycl&apos;Home</p>
        <h1 className="text-4xl">La réparation de vélo vient à vous</h1>
        <p className="max-w-xl text-muted-foreground">
          Le technicien se déplace à votre adresse. Vous choisissez un forfait
          et un créneau, et vous réglez sur place une fois l&apos;intervention
          terminée.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Squelette déployé</CardTitle>
          <CardDescription>
            Jalon 0, tâche T-J0-01. Next.js, Tailwind v4 et shadcn/ui sont en
            place, la palette Kinetic Urbanist et les deux polices sont câblées.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button size="lg">Réserver une intervention</Button>
          <Button size="lg" variant="outline">
            Voir les forfaits
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
