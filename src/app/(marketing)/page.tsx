import { getOptionalUser } from "@/lib/auth/dal";
import { AppHeader } from "@/components/layouts/app-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/// Accueil public — et, depuis T-V3-03, **destination post-connexion provisoire
/// du client et du technicien** ainsi que destination de la déconnexion.
///
/// Deux conséquences, toutes deux assumées :
///
///   · la page lit la session, donc elle devient dynamique. Elle reste ouverte
///     à tous (Constitution §5.1) : `getOptionalUser` renseigne, il n'autorise
///     rien et ne redirige personne ;
///   · elle porte l'en-tête de l'espace connecté quand une session existe.
///     Sans lui, un client connecté n'aurait aucun moyen de se déconnecter :
///     c'est ici qu'il atterrit, et l'en-tête du groupe `(app)` ne couvre pas
///     cette route.
///
/// Le vrai tableau de bord client — écran C7, avec son menu utilisateur —
/// arrive avec T-V3-10, qui reprendra les deux destinations.
export default async function AccueilPage({
  searchParams,
}: {
  searchParams: Promise<{ deconnecte?: string | string[] }>;
}) {
  // Les deux lectures sont indépendantes : en parallèle, jamais en cascade
  // (CLAUDE.md §Data fetching).
  const [{ deconnecte }, user] = await Promise.all([
    searchParams,
    getOptionalUser(),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      {user ? <AppHeader user={user} /> : null}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-16">
        {/* `US-COMPTE-DECONNECTER` §Cas nominal : « un message de confirmation
            “Vous êtes déconnecté” est affiché ». `role="status"` et non
            `alert` : c'est une confirmation attendue, pas une alerte, et le
            lecteur d'écran l'annonce sans interrompre. */}
        <p
          role="status"
          className="rounded-xl bg-primary-fixed px-3 py-2 text-sm text-accent-foreground empty:hidden"
        >
          {deconnecte === "1" ? "Vous êtes déconnecté." : ""}
        </p>

        <header className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-primary">
            HomeCycl&apos;Home
          </p>
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
              place, la palette Kinetic Urbanist et les deux polices sont
              câblées.
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
    </div>
  );
}
