import { CookieIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { lireIdentiteSociete } from "@/lib/db/queries/parametres";
import {
  CHEMIN_MENTIONS_LEGALES,
  CHEMIN_POLITIQUE_CONFIDENTIALITE,
} from "@/components/layouts/site-navigation";

import { PageLegale, SectionLegale } from "../_components/page-legale";

export const metadata: Metadata = {
  title: "Mentions légales | HomeCycl'Home",
  description:
    "Éditeur, hébergeur, propriété intellectuelle et loi applicable du site HomeCycl'Home.",
};

/// Mentions légales - `US-RGPD`, écran **C13**, onglet 1.
///
/// ── Les articles 4 et 5 sont écrits ici, pas portés
///
/// La maquette liste six articles dans son sommaire et n'en rend que quatre :
/// le contenu passe directement de l'article 3 à l'article 6
/// (`code.html:168-214`). Les deux manquants sont **Contact** et **Cookies**,
/// et le second n'est pas un détail : c'est lui qui porte la décision de
/// PLAN S4 §4.1 de ne pas afficher de bannière. Divergence signalée par la
/// table §Écrans de la phase, traitée ici.
///
/// ── L'éditeur vient de la base
///
/// Les cinq valeurs sont celles qu'un administrateur tient à jour dans le
/// back-office (T-J0-05). La page est donc **dynamique** au sens de Next :
/// aucune mise en cache, parce que la LCEN impose que ces mentions soient
/// exactes et qu'une mention légale servie depuis un cache périmé est une
/// mention légale fausse.
export default async function MentionsLegalesPage() {
  const societe = await lireIdentiteSociete();

  return (
    <PageLegale
      titre="Mentions légales"
      chemin={CHEMIN_MENTIONS_LEGALES}
      miseAJour="11 août 2026"
      sommaire={SOMMAIRE}
      societe={societe}
    >
      <SectionLegale id="editeur" titre="Article 1 : éditeur du site">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="font-semibold text-foreground">Raison sociale</dt>
          <dd>{societe.nom ?? "Non renseignée"}</dd>

          <dt className="font-semibold text-foreground">SIRET</dt>
          <dd>{societe.siret ?? "Non renseigné"}</dd>

          <dt className="font-semibold text-foreground">Siège social</dt>
          <dd>{societe.adresse ?? "Non renseigné"}</dd>

          <dt className="font-semibold text-foreground">Téléphone</dt>
          <dd>
            {societe.telephone ? (
              <a
                className="hover:text-primary"
                href={`tel:${societe.telephone}`}
              >
                {societe.telephone}
              </a>
            ) : (
              "Non renseigné"
            )}
          </dd>

          <dt className="font-semibold text-foreground">Email</dt>
          <dd>
            {societe.email ? (
              <a
                className="hover:text-primary"
                href={`mailto:${societe.email}`}
              >
                {societe.email}
              </a>
            ) : (
              "Non renseigné"
            )}
          </dd>

          <dt className="font-semibold text-foreground">
            Directeur de la publication
          </dt>
          <dd>Benjamin Saint-Augustin</dd>
        </dl>
      </SectionLegale>

      <SectionLegale id="hebergement" titre="Article 2 : hébergement">
        {/* L'identité de l'hébergeur est exacte : la pile tourne sur un VPS OVH
            (PLAN S3). Les coordonnées postales complètes exigées par la LCEN
            restent à compléter, arbitrage de Benjamin du 2026-08-11 (« on verra
            plus tard ») - déclaré en DoD ouverte dans la PR plutôt qu'inventé
            ici. */}
        <p>
          Le site est hébergé sur un serveur privé virtuel fourni par OVH SAS,
          société de droit français. Les serveurs et les données sont situés en
          France.
        </p>
      </SectionLegale>

      <SectionLegale
        id="propriete"
        titre="Article 3 : propriété intellectuelle"
      >
        <p>
          L&apos;ensemble des contenus présents sur ce site, structure, textes,
          logos et éléments graphiques, est protégé par le droit de la propriété
          intellectuelle. Toute reproduction ou représentation, totale ou
          partielle, sans autorisation écrite préalable est interdite.
        </p>
        <p>
          Les photographies déposées par les clients dans le cadre d&apos;une
          intervention restent leur propriété. Elles ne sont utilisées que pour
          l&apos;exécution et le suivi de cette intervention.
        </p>
      </SectionLegale>

      <SectionLegale id="contact" titre="Article 4 : contact">
        <p>
          Pour toute question, réclamation ou demande relative au traitement de
          vos données personnelles, écrivez à{" "}
          {societe.email ? (
            <a
              className="text-primary underline"
              href={`mailto:${societe.email}`}
            >
              {societe.email}
            </a>
          ) : (
            "l'adresse de contact indiquée à l'article 1"
          )}
          {societe.telephone ? ` ou appelez le ${societe.telephone}` : ""}.
        </p>
        {/* Constitution §1.2 : pas de formulaire de contact, pas de file de
            leads. L'adresse suffit, et elle sert aussi de voie d'exercice aux
            droits que le produit n'outille pas en self-service. */}
        <p>
          Le service est entièrement self-service : la réservation, le suivi et
          l&apos;annulation d&apos;une intervention se font depuis le site, sans
          rappel téléphonique intermédiaire.
        </p>
      </SectionLegale>

      <SectionLegale id="cookies" titre="Article 5 : cookies">
        <p>
          Ce site dépose un seul cookie, nommé <code>hch_session</code>. Il
          maintient votre session une fois connecté, il est strictement
          nécessaire au fonctionnement du service et il expire au bout de sept
          jours.
        </p>
        <p>
          Aucun traceur publicitaire, aucun outil de mesure d&apos;audience,
          aucun cookie tiers n&apos;est déposé.
        </p>

        {/* Card « Zéro bannière cookies » de C13 (`code.html:203-210`), portée
            avec son fond `primary-fixed`. Elle explique une absence, ce qui est
            plus utile qu'un bandeau à faire disparaître. */}
        <div className="mt-2 flex gap-4 rounded-2xl bg-primary-fixed p-5">
          <CookieIcon
            aria-hidden="true"
            className="size-6 shrink-0 text-accent-foreground"
          />
          <div>
            <h3 className="font-heading text-base font-bold text-accent-foreground">
              Zéro bannière cookies
            </h3>
            <p className="mt-1 text-sm text-accent-foreground">
              La délibération n° 2020-091 de la CNIL n&apos;impose le recueil du
              consentement que pour les cookies non essentiels. Nous n&apos;en
              déposons aucun : il n&apos;y a rien à vous faire accepter, donc
              rien à vous demander.
            </p>
          </div>
        </div>
      </SectionLegale>

      <SectionLegale id="loi" titre="Article 6 : loi applicable">
        <p>
          Les présentes mentions sont soumises au droit français. En cas de
          litige, et à défaut de résolution amiable, les tribunaux français sont
          seuls compétents.
        </p>
        <p>
          Le traitement de vos données personnelles est détaillé dans notre{" "}
          <Link
            className="text-primary underline"
            href={CHEMIN_POLITIQUE_CONFIDENTIALITE}
          >
            politique de confidentialité
          </Link>
          .
        </p>
      </SectionLegale>
    </PageLegale>
  );
}

const SOMMAIRE = [
  { id: "editeur", label: "Art. 1 : éditeur" },
  { id: "hebergement", label: "Art. 2 : hébergement" },
  { id: "propriete", label: "Art. 3 : propriété" },
  { id: "contact", label: "Art. 4 : contact" },
  { id: "cookies", label: "Art. 5 : cookies" },
  { id: "loi", label: "Art. 6 : loi applicable" },
] as const;
