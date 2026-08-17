import { ArrowLeft, ShieldCheck, TriangleAlert, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/dal";
import { Button } from "@/components/ui/button";
import {
  espacePrincipal,
  type EspacePrincipal,
} from "@/components/layouts/site-navigation";

import { FormulaireSuppressionCompte } from "./_components/formulaire-suppression-compte";

/// Le libellé de la sortie, par espace. Une table locale et non un champ de
/// `espacePrincipal()` : c'est de la copie propre à CETTE page, et la même
/// entrée s'annonce « Ma tournée » dans une barre de navigation. Typée par le
/// discriminant, donc exhaustive - un quatrième espace ne compilerait pas sans
/// sa phrase.
const RETOUR: Record<EspacePrincipal, string> = {
  client: "Retour à mes interventions",
  tech: "Retour à ma tournée",
  admin: "Retour au back-office",
};

export const metadata: Metadata = {
  title: "Supprimer mon compte | HomeCycl'Home",
  description:
    "Exercer son droit à l'oubli : pseudonymisation des données personnelles, conservation de l'historique de facturation.",
};

/// Droit à l'oubli - `US-COMPTE-SUPPRIMER`, second point d'entrée de l'US
/// (`US-RGPD` → « Exercer mon droit à l'oubli »).
///
/// L'écran C12 appartient à T-V3-07, qui passe **après** cette tâche et qui est
/// sacrifiable en rang 3. La règle des écrans composites (arbitrage du
/// 2026-08-10) veut que la tâche postérieure monte son propre bloc : T-V3-07
/// posera donc son entrée « Supprimer mon compte » pointant ici, comme T-V3-11 a
/// monté son bouton dans la coquille de T-V3-10.
///
/// La conséquence est la propriété qui compte : le droit à l'oubli reste
/// atteignable **même si T-V3-07 n'est jamais livrée**, par la politique de
/// confidentialité. Le critère de fin de phase V3 le nomme ; il ne peut pas
/// dépendre d'une tâche supprimable.
///
/// La garde est **ici** et pas dans le layout - `getCurrentUser` redirige vers
/// `/connexion` sans session. `src/proxy.ts` ne fait qu'un redirect optimiste
/// sur la présence du cookie, il n'autorise rien.
export default async function SupprimerComptePage() {
  const user = await getCurrentUser();

  // ⚠️ **La sortie suit le ROLE, jamais `CHEMIN_ESPACE_CLIENT` en dur.**
  // `requireEspaceClient()` repond 403 a un technicien et a un administrateur :
  // un lien fige ferait mener a un refus le seul chemin de sortie d'une route
  // volontairement ouverte a tous les roles.
  const espace = espacePrincipal(user.roles);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-12 md:px-8">
      <Button asChild variant="ghost" size="sm" className="mb-6 -ml-2">
        <Link href={espace.href}>
          <ArrowLeft aria-hidden="true" />
          {RETOUR[espace.espace]}
        </Link>
      </Button>

      <h1 className="mb-2 text-3xl">Supprimer mon compte</h1>
      <p className="mb-8 text-muted-foreground">
        Vous exercez votre droit à l&apos;effacement (article 17 du RGPD) pour
        le compte {user.email}.
      </p>

      <section
        aria-labelledby="avertissement-suppression"
        className="mb-8 flex gap-4 rounded-2xl border border-destructive/20 bg-destructive/10 p-5"
      >
        <TriangleAlert
          aria-hidden="true"
          className="size-6 shrink-0 text-destructive"
        />
        <div className="flex flex-col gap-2">
          <h2
            id="avertissement-suppression"
            className="font-heading text-base font-bold text-destructive"
          >
            Action irréversible
          </h2>
          {/* Texte de PLAN S4 §4.4, mot pour mot. Il est tranché, et il est
              tranché CONTRE la formule spontanée « votre compte disparaît » :
              annoncer une disparition là où l'opération est une
              pseudonymisation exposerait à un rappel CNIL.

              Seule modification : le cadratin du vault devient deux-points.
              CLAUDE.md §Typographie n'accorde aucune exception à un libellé
              repris mot pour mot d'une source. Signalé au write-back.

              ⚠️ **Deux ajouts au verbatim, 2026-08-12.** PLAN S2 §T6 impose
              d'informer que les enregistrements conservés restent
              ré-identifiables par croisement, et S4 §4.4 ne le disait pas : les
              deux sections se contredisaient depuis le 2026-07-29, S4 a été
              amendé en faveur de S2. Ce n'est pas une nuance de rédaction, c'est
              la qualification juridique de l'opération, celle que ce dépôt
              documente déjà en tête de `src/lib/db/queries/users.ts` pour
              expliquer pourquoi on écrit « pseudonymisation » et non
              « anonymisation ». L'interface était en retard sur son propre code.

              Le second ajout est l'exception de la commune : une énumération qui
              en omet une se lit comme exhaustive. */}
          <p className="text-sm text-destructive">
            Votre compte sera pseudonymisé : vos informations personnelles (nom,
            email, téléphone, adresses) seront remplacées par des valeurs
            anonymes, à l&apos;exception de la commune de vos adresses, qui est
            conservée et ne désigne personne à elle seule. Vos factures et
            interventions passées resteront conservées avec ces identifiants
            anonymes, pour respecter nos obligations comptables (10 ans). Ces
            enregistrements permettent encore de vous identifier par
            recoupement, et la loi nous impose de les conserver. Cette action
            est irréversible.
          </p>
        </div>
      </section>

      {/* Les deux colonnes de la modale de C12, dont le contenu est refait :
          la maquette y listait « Moyens de paiement » (Constitution §2.3 exclut
          tout paiement en ligne, il n'y en a aucun à effacer), « Commentaires
          mécaniciens » (table `intervention_comments`, v2 avril 2027, et le mot
          est « technicien ») et « Logs de sécurité (1 an) », durée qu'aucune
          source du projet ne fixe. */}
      <div className="mb-8 grid gap-6 sm:grid-cols-2">
        <section
          aria-labelledby="donnees-effacees"
          className="rounded-2xl border border-border bg-card p-5"
        >
          <h2
            id="donnees-effacees"
            className="mb-3 flex items-center gap-2 font-heading text-base font-bold text-destructive"
          >
            <XCircle aria-hidden="true" className="size-5" />
            Remplacé par des valeurs anonymes
          </h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>Votre nom et votre prénom</li>
            <li>Votre adresse email et votre téléphone</li>
            <li>
              Vos adresses d&apos;intervention, coordonnées géographiques
              comprises
            </li>
            <li>Votre mot de passe et vos connexions Google associées</li>
          </ul>
        </section>

        <section
          aria-labelledby="donnees-conservees"
          className="rounded-2xl border border-border bg-card p-5"
        >
          <h2
            id="donnees-conservees"
            className="mb-3 flex items-center gap-2 font-heading text-base font-bold text-primary"
          >
            <ShieldCheck aria-hidden="true" className="size-5" />
            Conservé sous identifiant anonyme
          </h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>Vos interventions passées et leur montant</li>
            <li>Les photos attachées à ces interventions</li>
            <li>Le journal des actions sensibles sur votre compte</li>
            {/* La colonne d'en face annonce l'effacement des adresses : sans
                cette ligne, les deux colonnes se contrediraient sur l'écran qui
                sert à décider. */}
            <li>La commune de vos adresses d&apos;intervention</li>
          </ul>
        </section>
      </div>

      <FormulaireSuppressionCompte />
    </main>
  );
}
