import Link from "next/link";
import { CalendarCheck, History, ShieldCheck } from "lucide-react";

/// Panneau latéral vert de l'écran **C6**, partagé par les trois vues de
/// l'écran — inscription, connexion, mot de passe oublié.
///
/// Icônes **Lucide**, jamais Material Symbols — la maquette Stitch en emploie,
/// c'est une divergence de portage recensée dans [[maquettage]] §Notes portage
/// §Global.
const ARGUMENTS = [
  {
    icone: CalendarCheck,
    titre: "Réservation en 2 min",
    texte:
      "Prenez rendez-vous rapidement pour l'entretien ou la réparation de votre vélo.",
  },
  {
    icone: History,
    titre: "Historique de vos vélos",
    texte: "Retrouvez toutes vos factures et l'historique des interventions.",
  },
  {
    icone: ShieldCheck,
    titre: "Données sécurisées",
    texte: "Vos informations personnelles sont protégées et conformes au RGPD.",
  },
] as const;

export function AuthSidePanel() {
  return (
    // `order` et non un ordre du DOM inversé : le formulaire vient EN PREMIER
    // dans le document — c'est ce que la personne est venue faire, et c'est ce
    // qui donne l'ordre de tabulation et la hiérarchie de titres attendue
    // (H1 du formulaire avant H2 du panneau). Le vert passe à gauche à partir de
    // `lg`, et disparaît sous cette borne : sur mobile il n'apporterait qu'un
    // écran de défilement avant le champ Prénom.
    <aside className="hidden bg-primary p-10 text-primary-foreground lg:order-first lg:flex lg:w-2/5 lg:flex-col lg:justify-between xl:p-16">
      <div>
        <p className="font-heading text-3xl font-bold tracking-tight">
          HomeCycl&apos;Home
        </p>
        <p className="mt-1 text-sm text-primary-foreground/80">
          Réparation vélo à domicile
        </p>
      </div>

      <div className="max-w-md">
        <h2 className="text-3xl leading-tight">
          Bienvenue dans votre espace HomeCycl&apos;Home
        </h2>

        <ul className="mt-8 flex flex-col gap-6">
          {ARGUMENTS.map(({ icone: Icone, titre, texte }) => (
            <li key={titre} className="flex gap-3">
              {/* Décoratif : le titre qui suit porte déjà l'information, et un
                  lecteur d'écran annoncerait deux fois la même chose. */}
              <Icone
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-primary-fixed"
              />
              <div>
                <p className="font-heading font-bold">{titre}</p>
                <p className="mt-1 text-sm text-primary-foreground/80">
                  {texte}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* La maquette pose « Retour à l'accueil » en pied de panneau. */}
      <Link
        href="/"
        className="text-sm underline underline-offset-4 hover:text-primary-fixed"
      >
        Retour à l&apos;accueil
      </Link>
    </aside>
  );
}
