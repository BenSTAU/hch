import {
  Bike,
  CalendarCheck,
  Camera,
  Lock,
  Map,
  MapPin,
  Smartphone,
  Timer,
  UserRoundCheck,
  Wallet,
  Wrench,
} from "lucide-react";
import Link from "next/link";

import type { ForfaitPublic } from "@/lib/db/queries/forfaits";
import { CHEMIN_RESERVATION } from "@/components/layouts/site-navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

import { ForfaitCard } from "./forfait-card";

/// Landing publique — écran **C1**, `US-FORFAIT-CONSULTER`.
///
/// Ce composant-ci est **synchrone**, donc déroulable sous RTL et sous
/// `jest-axe` ; la page, elle, est asynchrone parce qu'elle lit le catalogue et
/// `searchParams`, et un RSC asynchrone ne se déroule pas sous RTL (ADR-014 :
/// async Server Components → E2E uniquement). Même découpe que
/// `connexion-view.tsx`.
///
/// ── Géométrie portée de C1
///
/// Les cinq sections de la maquette, dans l'ordre, avec leurs mesures :
/// gouttières de page **20 px / 64 px**, sections à **`py-20`** (hero
/// `py-12 md:py-20`), conteneurs `max-w-[1920px]`, gouttière de bento **16 px**,
/// dalles à **`p-6`** et `rounded-2xl`, grands blocs en `rounded-3xl`.
/// Échelle typographique du brief Stitch : hero 36 → 48 px extra-bold
/// `tracking-[-0.04em]`, titres de section 32 px `tracking-[-0.03em]`, titres
/// de dalle 20 px, corps 16-18 px.
///
/// ── Six divergences de contenu corrigées, dont aucune n'était listée en
/// [[maquettage]] §Notes portage. Elles sont signalées au write-back.
///
///  1. `code.html:295-296` — étape 3 « Paiement sécurisé […] réglez **en ligne**
///     ou sur place, 100 % dématérialisé ». Contredit Constitution §2.3 :
///     l'encaissement est déclaratif et se fait sur le terrain, aucune
///     intégration de paiement en ligne n'existe.
///  2. `code.html:424` — « rapport avant/après envoyé par **SMS** ». Le SMS est
///     hors périmètre v1, même motif que la divergence déjà relevée sur C12.
///  3. `code.html:259` — « Rejoint par plus de **500 cyclistes** lyonnais ce
///     mois-ci », et trois avatars. Preuve sociale inventée, sur un produit qui
///     n'a aucun client. Le bloc entier est retiré, sa règle horizontale avec.
///  4. `code.html:242, 289, 417, 443` — « mécaniciens » → « technicien ».
///  5. `code.html:448-461` — « Lyon 1-9 · Villeurbanne · **Bron** ·
///     **Vénissieux** ». Le seed ne porte qu'UNE zone, une enveloppe qui
///     déborde sur Caluire, Villeurbanne et Sainte-Foy (`prisma/seed.ts:82`) —
///     ni Bron ni Vénissieux. La maille de 4 items en `grid-cols-2` est
///     conservée, ses cellules décrivent le fonctionnement de la zone au lieu
///     de la lister : Constitution §2.2 pose qu'une zone est une géométrie
///     dessinée, « pas par code postal, pas par nom de commune ».
///  6. `code.html:265` — photo du hero sur `lh3.googleusercontent.com`, et
///     `public/` ne contient aucun visuel de remplacement. Le cadre garde ses
///     dimensions (`h-[400px] lg:h-[600px]`, `rounded-3xl`) et devient un aplat
///     décoratif, sans `<img>`, donc sans texte alternatif à inventer.
///
/// Le placeholder de carte de la section Zone (`code.html:464-473`), lui, se
/// porte **tel quel** : c'en était déjà un dans la maquette, pas une carte. Il
/// reste donc conforme à [[adr-015-provider-carto|ADR-015 v2]], qui retire la
/// cartographie du parcours client — aucune clé Google n'entre ici.
export function LandingView({
  forfaits,
  deconnecte = false,
  compteSupprime = false,
}: {
  forfaits: ForfaitPublic[];
  deconnecte?: boolean;
  /// `US-COMPTE-SUPPRIMER` §Cas nominal : « je suis redirigé vers la page
  /// publique d'accueil avec message final ». Il atterrit ici et pas sur
  /// l'écran de suppression parce que celui-ci exige une session, et qu'il n'y
  /// en a plus - c'est tout le sujet.
  compteSupprime?: boolean;
}) {
  // `US-FORFAIT-CONSULTER` §Cas limites : catalogue vide → message explicite,
  // « et aucun appel à l'action de réservation n'est proposé ». Lecture stricte,
  // appliquée à TOUS les appels de la page — le hero comme les cartes, et
  // l'en-tête via la prop du layout.
  const catalogueOuvert = forfaits.length > 0;

  return (
    <main className="flex-1 pb-20">
      <div className="mx-auto w-full max-w-[1920px] px-5 md:px-16">
        {/* `US-COMPTE-DECONNECTER` §Cas nominal : « un message de confirmation
            “Vous êtes déconnecté” est affiché ». `role="status"` et non
            `alert` : c'est une confirmation attendue, pas une alerte.

            La suppression de compte partage ce bandeau : les deux arrivent au
            même endroit, par le même geste (fin de session puis redirection),
            et deux régions `status` concurrentes sur une page en annonceraient
            une de trop. Elles s'excluent, la plus définitive gagne. */}
        <p
          role="status"
          className="mt-6 rounded-xl bg-primary-fixed px-4 py-3 text-sm text-accent-foreground empty:hidden"
        >
          {messageStatut(compteSupprime, deconnecte)}
        </p>
      </div>

      {/* ─── Hero ─────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1920px] px-5 py-12 md:px-16 md:py-20">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-7">
            <Badge
              variant="secondary"
              className="h-auto w-max gap-2 rounded-full px-4 py-1.5 text-sm font-semibold text-primary"
            >
              {/* Pas de taille explicite : `badgeVariants` en impose une aux
                  `svg` enfants par sélecteur `!important`, qu'un utilitaire posé
                  sur l'icône ne peut pas battre — `cn()` ne les arbitre pas, ils
                  ne visent pas le même élément. */}
              <Wrench aria-hidden="true" />
              Réparation vélo à domicile
            </Badge>

            <h1 className="text-4xl font-extrabold tracking-[-0.04em] lg:text-5xl">
              Votre vélo réparé chez vous, à Lyon.
            </h1>

            <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Le technicien se déplace à votre domicile ou sur votre lieu de
              travail, avec le matériel nécessaire. Vous choisissez le forfait
              et le créneau, vous réglez sur place une fois l&apos;intervention
              terminée.
            </p>

            {catalogueOuvert ? (
              <div className="mt-4 flex flex-wrap gap-4">
                {/* `h-14` et `px-8` : la maquette pose un CTA de 56 px
                    (`px-8 py-4`), quand `size="lg"` du catalogue shadcn vaut
                    36 px. ADR-012 §D4 — la maquette fait foi. */}
                <Button
                  asChild
                  className="h-14 px-8 text-base font-semibold tracking-[0.02em] shadow-lg shadow-primary/25"
                >
                  <Link href={CHEMIN_RESERVATION}>
                    Réserver une intervention
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="secondary"
                  className="h-14 px-8 text-base font-semibold tracking-[0.02em]"
                >
                  <Link href="#forfaits">Voir les forfaits</Link>
                </Button>
              </div>
            ) : null}
          </div>

          {/* Décor, pas information : `aria-hidden` et aucun texte alternatif.
              Un lecteur d'écran n'a rien à y gagner. */}
          <div
            aria-hidden="true"
            className="flex h-[400px] items-center justify-center overflow-hidden rounded-3xl bg-primary-fixed lg:col-span-5 lg:h-[600px]"
          >
            <Bike className="size-32 text-primary lg:size-52" />
          </div>
        </div>
      </section>

      {/* ─── Comment ça marche ────────────────────────────────────────── */}
      <section id="fonctionnement" className="scroll-mt-24 bg-secondary/50">
        <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-12 px-5 py-20 md:px-16">
          <div className="text-center">
            <h2 className="text-[2rem] font-bold tracking-[-0.03em]">
              Trois étapes, zéro friction
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Un parcours en self-service, sans rappel intermédiaire ni demande
              de devis.
            </p>
          </div>

          <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {ETAPES.map((etape, index) => (
              <li key={etape.titre} className="flex">
                <Card className="w-full gap-4 bg-card ring-0 [--card-spacing:--spacing(6)]">
                  <CardHeader className="gap-4">
                    <span className="mb-2 flex size-14 items-center justify-center rounded-full bg-primary-container">
                      <etape.Icone
                        aria-hidden="true"
                        className="size-7 text-primary-foreground"
                      />
                    </span>
                    <h3 className="font-heading text-xl font-bold tracking-[-0.01em]">
                      {index + 1}. {etape.titre}
                    </h3>
                  </CardHeader>
                  <CardContent>
                    <p className="text-base leading-relaxed text-muted-foreground">
                      {etape.texte}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─── Nos forfaits ─────────────────────────────────────────────── */}
      <section id="forfaits" className="scroll-mt-24">
        <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-12 px-5 py-20 md:px-16">
          <div className="text-center">
            <h2 className="text-[2rem] font-bold tracking-[-0.03em]">
              Des forfaits transparents
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
              Les tarifs sont publics et affichés avant toute réservation. Aucun
              frais de déplacement ne s&apos;ajoute : le prix indiqué est celui
              que vous réglez au technicien.
            </p>
          </div>

          {catalogueOuvert ? (
            <ul className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 md:grid-cols-3">
              {forfaits.map((forfait) => (
                <li key={forfait.id} className="flex">
                  <ForfaitCard forfait={forfait} />
                </li>
              ))}
            </ul>
          ) : (
            /* Pas une grille vide : `US-FORFAIT-CONSULTER` §Cas limites demande
               un message qui REMPLACE la liste. Pas de `role="status"` non
               plus — un repère de région live qui ne change jamais annonce du
               bruit, et la page en porte déjà un pour la déconnexion. */
            <p className="mx-auto w-full max-w-6xl rounded-2xl border border-dashed px-6 py-14 text-center text-muted-foreground">
              Aucun forfait n&apos;est proposé à la réservation pour le moment.
              Le catalogue sera de nouveau disponible prochainement.
            </p>
          )}
        </div>
      </section>

      {/* ─── L'expertise à votre porte ────────────────────────────────── */}
      <section className="bg-secondary">
        <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-12 px-5 py-20 md:px-16">
          <h2 className="text-center text-[2rem] font-bold tracking-[-0.03em]">
            L&apos;expertise à votre porte
          </h2>

          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {ENGAGEMENTS.map((engagement) => (
              <li key={engagement.titre} className="flex">
                <Card className="w-full justify-between bg-card ring-0 transition-shadow [--card-spacing:--spacing(6)] hover:shadow-md md:h-48">
                  <CardHeader className="gap-0">
                    <engagement.Icone
                      aria-hidden="true"
                      className="size-9 text-primary"
                    />
                  </CardHeader>
                  <CardContent>
                    <h3 className="mb-1 font-heading text-xl font-bold tracking-[-0.01em]">
                      {engagement.titre}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {engagement.texte}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── Zone desservie ───────────────────────────────────────────── */}
      <section id="zone" className="scroll-mt-24">
        <div className="mx-auto grid w-full max-w-[1920px] grid-cols-1 items-center gap-12 px-5 py-20 md:px-16 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <h2 className="text-[2rem] font-bold tracking-[-0.03em]">
              Est-ce qu&apos;on vient chez vous ?
            </h2>

            <p className="text-lg leading-relaxed text-muted-foreground">
              Nous intervenons à Lyon et dans une partie des communes
              limitrophes. Le plus simple est d&apos;entrer votre adresse : vous
              savez immédiatement si un technicien peut se déplacer, et vous
              n&apos;avez pas besoin de compte pour le vérifier.
            </p>

            <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {ZONE_REPERES.map((repere) => (
                <li key={repere.texte} className="flex items-center gap-2">
                  <repere.Icone
                    aria-hidden="true"
                    className="size-4 shrink-0 text-primary"
                  />
                  <span className="text-base">{repere.texte}</span>
                </li>
              ))}
            </ul>

            {catalogueOuvert ? (
              <div className="mt-2">
                <Button
                  asChild
                  className="h-12 px-6 text-sm font-semibold tracking-[0.05em]"
                >
                  <Link href={CHEMIN_RESERVATION}>Vérifier mon adresse</Link>
                </Button>
              </div>
            ) : null}
          </div>

          {/* Le placeholder de carte de la maquette (`code.html:464-473`), porté
              tel quel : c'en était déjà un, jamais une carte réelle. ADR-015 v2
              retire la cartographie du parcours client — il n'y a donc rien à
              remplacer, seulement un décor à conserver. */}
          <div
            aria-hidden="true"
            className="flex h-[320px] items-center justify-center rounded-3xl bg-secondary"
          >
            <div className="flex flex-col items-center gap-3">
              <span className="flex size-16 items-center justify-center rounded-full bg-primary-container">
                <Map className="size-7 text-primary-foreground" />
              </span>
              <span className="text-sm font-semibold tracking-[0.05em] text-primary">
                Zone d&apos;intervention
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

/// Les trois étapes de C1 (`code.html:270-299`), dont la troisième est réécrite :
/// la maquette proposait de « régler en ligne ou sur place, 100 % dématérialisé »
/// alors que Constitution §2.3 n'admet **que** l'encaissement sur le terrain.
const ETAPES = [
  {
    Icone: CalendarCheck,
    titre: "Choisissez votre créneau",
    texte:
      "Le forfait détermine la durée de l'intervention, donc les créneaux qui vous sont proposés. Vous réservez sans créer de compte au préalable.",
  },
  {
    Icone: Bike,
    titre: "Intervention sur place",
    texte:
      "Le technicien se déplace à l'adresse indiquée, avec l'outillage nécessaire. Vous n'avez aucun vélo à transporter, et aucun atelier où passer.",
  },
  {
    Icone: Wallet,
    titre: "Vous réglez sur place",
    texte:
      "Le paiement se fait à la fin de l'intervention, auprès du technicien. Aucun règlement en ligne, aucune coordonnée bancaire à saisir.",
  },
] as const;

/// Le bento « L'expertise à votre porte » de C1 (`code.html:402-435`), dont la
/// carte « Preuve photo » perd sa mention SMS — hors périmètre v1.
const ENGAGEMENTS = [
  {
    Icone: Lock,
    titre: "Prix figé",
    texte:
      "Le tarif affiché ici est celui qui est figé au moment où vous réservez. Un changement de catalogue ultérieur ne le modifie pas.",
  },
  {
    Icone: Wrench,
    titre: "Techniciens experts",
    texte:
      "L'intervention est faite par un technicien cycle, qui se déplace avec son propre matériel.",
  },
  {
    Icone: Camera,
    titre: "Preuve photo",
    texte:
      "Les photos prises pendant l'intervention sont attachées à votre dossier, avec leur date et leur auteur.",
  },
  {
    Icone: Smartphone,
    titre: "100 % self-service",
    texte:
      "Réservation, suivi et annulation depuis votre espace client, sans appel ni file d'attente.",
  },
] as const;

/// La maille 2×2 de C1 (`code.html:445-462`) est conservée, ses quatre cellules
/// changent de nature : la maquette y nommait Villeurbanne, Bron et Vénissieux,
/// dont deux ne sont pas dans la zone réellement seedée.
///
/// ⚠️ Une première rédaction décrivait le **mécanisme** — « zone dessinée, pas
/// déduite », « vérifiée à l'adresse près ». Reprise sur retour de Benjamin : le
/// visiteur ne se demande pas comment la sectorisation est implémentée, il se
/// demande si on vient chez lui. Le fait que la zone soit une géométrie et non
/// une liste de codes postaux est un choix d'architecture (Constitution §2.2) —
/// il se voit dans la précision de la réponse, il n'a pas à être expliqué.
const ZONE_REPERES = [
  { Icone: MapPin, texte: "Lyon et communes limitrophes" },
  { Icone: Timer, texte: "Réponse immédiate à votre adresse" },
  { Icone: Wallet, texte: "Déplacement compris dans le prix" },
  { Icone: UserRoundCheck, texte: "Sans compte et sans engagement" },
] as const;

/// Le bandeau de statut n'en porte qu'un à la fois, et l'ordre n'est pas
/// arbitraire : une suppression de compte déconnecte aussi, donc les deux
/// paramètres peuvent arriver ensemble. Annoncer « vous êtes déconnecté » à qui
/// vient d'effacer son compte serait exact et hors sujet.
function messageStatut(compteSupprime: boolean, deconnecte: boolean): string {
  if (compteSupprime) return "Votre compte a été supprimé.";
  if (deconnecte) return "Vous êtes déconnecté.";
  return "";
}
