import type { Metadata } from "next";

import { lireIdentiteSociete } from "@/lib/db/queries/parametres";
import { CHEMIN_ACCESSIBILITE } from "@/components/layouts/site-navigation";

import { PageLegale, SectionLegale } from "../_components/page-legale";

export const metadata: Metadata = {
  title: "Déclaration d'accessibilité | HomeCycl'Home",
  description:
    "Déclaration de conformité partielle au RGAA 4.1 niveau A, non-conformités connues et voies de recours.",
};

/// Déclaration d'accessibilité - `US-RGPD`, PLAN S4 §2.3, écran **C13**,
/// onglet 3.
///
/// ── Elle remplace les CGV de la maquette
///
/// C13 nomme son troisième onglet « Conditions Générales de Vente ». Le triplet
/// de PLAN S4 §4.2 fait foi contre les trois autres qui circulaient dans les
/// artefacts (audit V3, item 6) : c'est cette page-ci, et elle est la seule des
/// trois portée par une obligation de forme.
///
/// ── Elle nomme une non-conformité que personne n'aurait trouvée en la lisant
///
/// La bordure des champs de saisie a été arbitrée le 2026-08-08 en faveur de la
/// maquette, au prix d'un écart connu à WCAG 1.4.11, pour 3:1 requis. Ni
/// `jest-axe` ni `@axe-core/playwright` ne le signalent : axe-core en jsdom ne
/// calcule aucun contraste, et aucune règle axe ne couvre 1.4.11.
///
/// 🐛 **Le ratio publié était faux** (agent testeur, B6). La DoD T-V3-12 et la
/// note (4) de la PR #17 écrivent « 1,06:1 », valeur qui ne correspond à aucune
/// des deux surfaces réelles : le fond `secondary` du champ donne **1,11:1**
/// sur une carte blanche et **1,05:1** sur le fond de page. Mesuré au
/// navigateur par le test `pages-legales.spec.ts` « le ratio publié est celui
/// que les tokens produisent », qui est resté rouge jusqu'à cette correction.
/// La non-conformité, elle, est bien réelle dans les deux cas. Write-back dû
/// sur la DoD, qui porte le même chiffre faux.
/// **Aucun vert d'aucune barrière ne refermera jamais ce point** - seule cette
/// déclaration le traite, et une déclaration de conformité partielle qui omet
/// la non-conformité qu'on connaît n'est pas une déclaration.
export default async function AccessibilitePage() {
  const societe = await lireIdentiteSociete();

  return (
    <PageLegale
      titre="Déclaration d'accessibilité"
      chemin={CHEMIN_ACCESSIBILITE}
      miseAJour={DATE_DECLARATION}
      sommaire={SOMMAIRE}
      societe={societe}
    >
      <SectionLegale id="engagement" titre="Engagement">
        <p>
          {societe.nom ?? "L'éditeur du site"} s&apos;engage à rendre son
          service accessible, conformément à l&apos;article 47 de la loi n°
          2005-102 du 11 février 2005.
        </p>
        {/* 🐛 Disait « dans son intégralité » puis excluait le back-office
            trois sections plus bas (agent testeur, B8). Le modèle
            `numerique.gouv.fr` fait du périmètre une rubrique opposable : les
            deux phrases ne pouvaient pas coexister. */}
        <p>
          Cette déclaration s&apos;applique au site public et à l&apos;espace
          client de HomeCycl&apos;Home. L&apos;espace d&apos;administration,
          réservé à l&apos;exploitant, en est exclu.
        </p>
      </SectionLegale>

      <SectionLegale id="conformite" titre="État de conformité">
        <p className="rounded-2xl bg-secondary p-5 text-foreground">
          Le site est{" "}
          <strong>
            partiellement conforme au référentiel général d&apos;amélioration de
            l&apos;accessibilité (RGAA), version 4.1, niveau A
          </strong>
          , en raison des non-conformités énumérées ci-dessous.
        </p>
        <p>
          Le niveau visé pour cette version est le niveau A sur l&apos;ensemble
          du service, et le niveau AA sur le parcours de connexion et
          d&apos;inscription. Une passe dédiée au niveau AA sur l&apos;ensemble
          du parcours client est prévue pour la version suivante.
        </p>
      </SectionLegale>

      <SectionLegale id="tests" titre="Résultats des tests">
        <p>
          L&apos;évaluation est automatisée et rejouée à chaque modification du
          code, par le moteur axe-core : sur les composants dans un
          environnement de test, et sur les pages réelles dans un navigateur.
        </p>
        <p>
          Au {DATE_DECLARATION}, ces tests ne relèvent{" "}
          <strong className="text-foreground">
            aucune violation d&apos;impact modéré, sérieux ou critique
          </strong>{" "}
          sur les écrans couverts : accueil, inscription, activation, connexion,
          tunnel de réservation, espace client et pages légales.
        </p>
        <p>
          Ce résultat ne vaut pas conformité, et la section suivante dit
          pourquoi : un test automatisé ne couvre qu&apos;une partie des
          critères.
        </p>
      </SectionLegale>

      <SectionLegale id="non-conformites" titre="Contenus non accessibles">
        <h3 className="font-heading text-base font-bold text-foreground">
          Non-conformités
        </h3>
        <ul className="list-inside list-disc space-y-2">
          <li>
            <strong className="text-foreground">
              Contraste des champs de saisie (critère 3.2 du RGAA, WCAG 1.4.11)
            </strong>{" "}
            : au repos, les champs de formulaire se distinguent de leur fond par
            un aplat dont le contraste est de 1,11:1 sur une carte et de 1,05:1
            à même la page, là où 3:1 est requis. La limite du champ n&apos;est
            donc pas identifiable par le seul contraste. Le champ reste visible
            au survol, au focus et en erreur, états qui portent une bordure
            contrastée.
          </li>
          <li>
            <strong className="text-foreground">
              Fonctionnalités dépendantes de JavaScript
            </strong>{" "}
            : la navigation sur petit écran et le menu qui contient la
            déconnexion s&apos;ouvrent par un composant interactif. Sans
            JavaScript, ces deux commandes ne s&apos;ouvrent pas. Toutes les
            pages restent atteignables et lisibles.
          </li>
        </ul>

        <h3 className="mt-4 font-heading text-base font-bold text-foreground">
          Critères non évalués par un outil automatique
        </h3>
        <p>
          Les points suivants ont été vérifiés à la main, écran par écran, mais
          aucun outil du projet ne les mesure. Ils n&apos;ont donc pas le même
          degré de preuve que le reste.
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            La visibilité du focus au clavier (WCAG 2.4.7) : un halo contrasté
            est posé sur tous les éléments interactifs.
          </li>
          <li>
            Le contraste des textes sur les fonds colorés du parcours de
            réservation.
          </li>
          <li>
            Le parcours complet avec un lecteur d&apos;écran, qui n&apos;a pas
            été conduit sur cette version.
          </li>
        </ul>

        <h3 className="mt-4 font-heading text-base font-bold text-foreground">
          Hors périmètre
        </h3>
        {/* 🐛 Affirmait qu'un outil de tracé de zones « n'est pas utilisable au
            clavier » alors qu'il n'existe pas au HEAD courant (agent testeur,
            B8) : seule la page de paramètres société est livrée côté
            administration. Une déclaration ne décrit pas un artefact non
            écrit. */}
        <p>
          L&apos;espace d&apos;administration, réservé à l&apos;exploitant,
          n&apos;est pas couvert par cette déclaration et n&apos;a fait
          l&apos;objet d&apos;aucune évaluation.
        </p>
      </SectionLegale>

      <SectionLegale id="retour" titre="Retour d'information et contact">
        <p>
          Si vous n&apos;arrivez pas à accéder à un contenu ou à un service,
          écrivez-nous : nous vous indiquerons une alternative et nous
          traiterons le point.
        </p>
        {societe.email ? (
          <p>
            Email :{" "}
            <a
              className="text-primary underline"
              href={`mailto:${societe.email}`}
            >
              {societe.email}
            </a>
          </p>
        ) : null}
        {societe.telephone ? <p>Téléphone : {societe.telephone}</p> : null}
        {societe.adresse ? <p>Adresse : {societe.adresse}</p> : null}
      </SectionLegale>

      <SectionLegale id="recours" titre="Voies de recours">
        <p>
          Si vous constatez un défaut d&apos;accessibilité vous empêchant
          d&apos;accéder à un contenu ou à une fonctionnalité du site, que vous
          nous le signalez et que vous ne parvenez pas à obtenir de réponse,
          vous êtes en droit de faire parvenir vos doléances ou une demande de
          saisine au Défenseur des droits.
        </p>
        <p>Plusieurs moyens sont à votre disposition :</p>
        <ul className="list-inside list-disc space-y-1">
          <li>écrire un message au Défenseur des droits ;</li>
          <li>
            contacter le délégué du Défenseur des droits de votre département ;
          </li>
          <li>
            envoyer un courrier par la poste, sans affranchissement, à Défenseur
            des droits, libre réponse 71120, 75342 Paris Cedex 07.
          </li>
        </ul>
      </SectionLegale>
    </PageLegale>
  );
}

/// La date de la déclaration est celle de sa rédaction, pas celle du rendu :
/// un `new Date()` la ferait glisser toute seule et affirmerait que la
/// conformité a été réévaluée un jour où personne n'a rien mesuré.
const DATE_DECLARATION = "11 août 2026";

const SOMMAIRE = [
  { id: "engagement", label: "Engagement" },
  { id: "conformite", label: "État de conformité" },
  { id: "tests", label: "Résultats des tests" },
  { id: "non-conformites", label: "Contenus non accessibles" },
  { id: "retour", label: "Retour d'information" },
  { id: "recours", label: "Voies de recours" },
] as const;
