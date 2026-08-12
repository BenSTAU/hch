import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { lireIdentiteSociete } from "@/lib/db/queries/parametres";
import { CHEMIN_SUPPRESSION_COMPTE } from "@/lib/routes";
import { CHEMIN_POLITIQUE_CONFIDENTIALITE } from "@/components/layouts/site-navigation";
import { Button } from "@/components/ui/button";

import { PageLegale, SectionLegale } from "../_components/page-legale";

export const metadata: Metadata = {
  title: "Politique de confidentialité | HomeCycl'Home",
  description:
    "Données collectées, finalités, destinataires, durées de conservation et exercice de vos droits RGPD.",
};

/// Politique de confidentialité - `US-RGPD`, écran **C13**, onglet 2.
///
/// ── Elle remplace la page « Mes droits RGPD »
///
/// L'ancienne formulation de l'US prévoyait une quatrième page. L'alignement du
/// 2026-08-08 en fait la section « Vos droits » de celle-ci, avec le lien direct
/// vers la suppression de compte que `US-COMPTE-SUPPRIMER` §Cas nominal nomme
/// comme second point d'entrée du droit à l'oubli.
///
/// ── Ce qu'elle déclare est vérifié, pas recopié
///
/// PLAN S4 §4.2 liste encore « destinataires (Google Maps §6 pour géocodage) ».
/// Cette ligne est **antérieure à ADR-015 v2** (2026-08-08), qui a retiré la
/// cartographie du parcours client : il n'y a plus aucun appel Google Maps
/// côté client, et le back-office qui en garde l'usage n'est pas livré.
///
/// Le transfert hors UE réel et actuel est ailleurs, et aucune section RGPD du
/// vault ne le mentionne : le transport email passe par Gmail (ADR-017,
/// `src/lib/email/transport.ts`), donc Google LLC traite l'adresse et le
/// contenu de chaque message transactionnel. C'est lui qui est déclaré ici.
/// Source matérialisée dans `docs/external/google-dpf.md`. Signalé au
/// write-back.
export default async function PolitiqueConfidentialitePage() {
  const societe = await lireIdentiteSociete();
  const contact = societe.email;

  return (
    <PageLegale
      titre="Politique de confidentialité"
      chemin={CHEMIN_POLITIQUE_CONFIDENTIALITE}
      miseAJour="11 août 2026"
      sommaire={SOMMAIRE}
      societe={societe}
    >
      <SectionLegale id="responsable" titre="Responsable du traitement">
        <p>
          {societe.nom ?? "L'éditeur du site"}
          {societe.adresse ? `, ${societe.adresse}` : ""}, est responsable des
          traitements décrits sur cette page. Aucun délégué à la protection des
          données n&apos;a été désigné : la structure n&apos;entre dans aucun
          des cas où l&apos;article 37 du RGPD le rend obligatoire.
        </p>
      </SectionLegale>

      <SectionLegale id="donnees" titre="Données collectées">
        <p>Nous ne collectons que ce que le service exige pour fonctionner.</p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong className="text-foreground">Identité et contact</strong> :
            nom, prénom, adresse email, numéro de téléphone.
          </li>
          <li>
            <strong className="text-foreground">
              Adresses d&apos;intervention
            </strong>{" "}
            : libellé postal et coordonnées géographiques, obtenues auprès de la
            Base Adresse Nationale. Elles servent à savoir si vous êtes dans une
            zone desservie et à guider le technicien.
          </li>
          <li>
            <strong className="text-foreground">Vélos</strong> : marque, modèle,
            type et année, si vous les renseignez.
          </li>
          <li>
            <strong className="text-foreground">Interventions</strong> : forfait
            choisi, date et heure, produits ajoutés, montant, statut, motif
            d&apos;annulation le cas échéant.
          </li>
          <li>
            <strong className="text-foreground">Photographies</strong> que vous
            déposez pour décrire l&apos;état de votre vélo.
          </li>
          <li>
            <strong className="text-foreground">Données techniques</strong> : un
            cookie de session, et un journal des connexions et des actions
            sensibles sur votre compte.
          </li>
        </ul>
        <p>
          Aucune donnée bancaire n&apos;est collectée. Le paiement se fait sur
          place, auprès du technicien, à la fin de l&apos;intervention.
        </p>
      </SectionLegale>

      <SectionLegale id="finalites" titre="Finalités et base légale">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          <dt className="font-semibold text-foreground">
            Réserver et exécuter une intervention
          </dt>
          <dd>Exécution du contrat, article 6.1.b du RGPD.</dd>

          <dt className="font-semibold text-foreground">
            Vous informer par email
          </dt>
          <dd>
            Exécution du contrat : activation du compte, confirmation de
            réservation, annulation. Aucune prospection commerciale, aucune
            lettre d&apos;information.
          </dd>

          <dt className="font-semibold text-foreground">
            Conserver l&apos;historique des interventions et des montants
          </dt>
          <dd>Obligation légale de conservation comptable, article 6.1.c.</dd>

          <dt className="font-semibold text-foreground">
            Journaliser les actions sensibles
          </dt>
          <dd>
            Intérêt légitime, article 6.1.f : pouvoir établir qui a fait quoi en
            cas de contestation ou d&apos;incident de sécurité.
          </dd>
        </dl>
      </SectionLegale>

      <SectionLegale id="destinataires" titre="Destinataires">
        <p>
          Vos données ne sont ni vendues, ni louées, ni transmises à des fins
          publicitaires. Trois prestataires seulement interviennent.
        </p>
        <ul className="list-inside list-disc space-y-2">
          <li>
            <strong className="text-foreground">OVH SAS</strong> (France)
            héberge l&apos;application et sa base de données. Aucune donnée ne
            sort du territoire français de ce fait.
          </li>
          <li>
            <strong className="text-foreground">
              Géoplateforme de l&apos;IGN, Base Adresse Nationale
            </strong>{" "}
            (France) reçoit l&apos;adresse que vous saisissez, afin de la
            valider et d&apos;en obtenir les coordonnées. C&apos;est un service
            public français, aucun transfert hors de l&apos;Union européenne
            n&apos;a lieu.
          </li>
          <li>
            <strong className="text-foreground">Google LLC</strong> (États-Unis)
            achemine nos emails transactionnels : votre adresse email et le
            contenu du message lui sont donc confiés. Google LLC déclare adhérer
            au cadre de protection des données UE / États-Unis (Data Privacy
            Framework), qui encadre ce transfert.
          </li>
        </ul>
      </SectionLegale>

      <SectionLegale id="conservation" titre="Durées de conservation">
        <ul className="list-inside list-disc space-y-1">
          <li>
            Les données de votre compte sont conservées tant que celui-ci
            existe.
          </li>
          <li>
            Les interventions, leurs montants, les photographies qui y sont
            attachées et le journal des actions correspondantes sont conservés{" "}
            <strong className="text-foreground">dix ans</strong>, durée des
            obligations comptables.
          </li>
          {/* 🐛 Disait « en quelques heures » pour un jeton qui vaut 24 h, et
              mentionnait une réinitialisation de mot de passe qui n'existe pas
              encore (agent testeur, B7). Un document juridique daté ne
              sur-déclare pas plus qu'il ne sous-déclare. */}
          <li>
            Les liens d&apos;activation de compte expirent au bout de 24 heures
            et sont ensuite sans effet.
          </li>
          <li>
            Le cookie de session expire au bout de sept jours, ou immédiatement
            à la déconnexion.
          </li>
        </ul>
      </SectionLegale>

      <SectionLegale id="droits" titre="Vos droits">
        <p>
          Vous disposez des droits d&apos;accès, de rectification,
          d&apos;effacement, de portabilité, d&apos;opposition et de limitation
          sur vos données.
        </p>

        <p>
          <strong className="text-foreground">Effacement</strong> : vous
          l&apos;exercez vous-même, à tout moment, depuis votre espace. Votre
          compte est alors pseudonymisé, c&apos;est-à-dire que vos informations
          personnelles sont remplacées par des valeurs anonymes, à
          l&apos;exception de la commune de vos adresses, qui est conservée et
          ne désigne personne à elle seule. Vos interventions passées restent
          conservées sous ces identifiants anonymes, pour les obligations
          comptables rappelées ci-dessus. Ces enregistrements permettent encore
          de vous identifier par recoupement, et la loi nous impose de les
          conserver. L&apos;opération est irréversible.
        </p>

        <div className="my-2">
          <Button asChild variant="destructive">
            <Link href={CHEMIN_SUPPRESSION_COMPTE}>
              <Trash2 aria-hidden="true" />
              Supprimer mon compte
            </Link>
          </Button>
        </div>

        {/* Un droit déclaré sans chemin pour l'exercer est pire que le silence.
            Le produit n'outille en self-service que l'effacement : les quatre
            autres passent par l'adresse de contact, et c'est dit. */}
        <p>
          <strong className="text-foreground">
            Accès, rectification, portabilité, opposition et limitation
          </strong>{" "}
          : ces droits ne disposent pas d&apos;un outil en libre-service.
          Écrivez à{" "}
          {contact ? (
            <a className="text-primary underline" href={`mailto:${contact}`}>
              {contact}
            </a>
          ) : (
            "l'adresse de contact figurant dans les mentions légales"
          )}{" "}
          depuis l&apos;adresse email de votre compte. Nous répondons dans un
          délai d&apos;un mois, et nous vous transmettons vos données dans un
          format lisible et réutilisable si vous demandez leur portabilité.
        </p>

        <p>
          Vous pouvez également retirer une photographie de votre compte en nous
          écrivant : le service ne permet pas encore de le faire seul.
        </p>
      </SectionLegale>

      <SectionLegale id="photos" titre="Photographies d'intervention">
        <p>
          Une photographie de vélo est le plus souvent prise à votre domicile,
          et les fichiers produits par un téléphone contiennent la position
          exacte de la prise de vue. Ces métadonnées sont{" "}
          <strong className="text-foreground">
            supprimées avant tout enregistrement
          </strong>
          , sans réglage ni exception.
        </p>
        <p>
          Les photographies ne sont jamais accessibles par une adresse publique
          : chaque consultation vérifie que la personne qui la demande est bien
          concernée par l&apos;intervention.
        </p>
      </SectionLegale>

      <SectionLegale id="cookies" titre="Cookies">
        <p>
          Un seul cookie est déposé, <code>hch_session</code>, strictement
          nécessaire au maintien de votre session. Aucun traceur publicitaire ni
          outil de mesure d&apos;audience n&apos;est utilisé, et c&apos;est la
          raison pour laquelle ce site ne vous demande aucun consentement.
        </p>
      </SectionLegale>

      <SectionLegale id="reclamation" titre="Réclamation">
        <p>
          Si vous estimez, après nous avoir contactés, que vos droits ne sont
          pas respectés, vous pouvez adresser une réclamation à la Commission
          nationale de l&apos;informatique et des libertés, 3 place de Fontenoy,
          TSA 80715, 75334 Paris Cedex 07.
        </p>
      </SectionLegale>
    </PageLegale>
  );
}

const SOMMAIRE = [
  { id: "responsable", label: "Responsable du traitement" },
  { id: "donnees", label: "Données collectées" },
  { id: "finalites", label: "Finalités et base légale" },
  { id: "destinataires", label: "Destinataires" },
  { id: "conservation", label: "Durées de conservation" },
  { id: "droits", label: "Vos droits" },
  { id: "photos", label: "Photographies" },
  { id: "cookies", label: "Cookies" },
  { id: "reclamation", label: "Réclamation" },
] as const;
