import "server-only";

import { z } from "zod";

/// Garde d'environnement — TASKS §1 §Variables d'environnement, cadrage amont
/// V3 D5. Une variable applicative manquante ne se voit qu'à l'usage : la clé
/// de géocodage au tunnel de réservation, le mot de passe d'application email à
/// l'inscription. Branchée sur `/api/health`, elle rend l'absence bruyante et
/// immédiate — healthcheck rouge, rollback inline, pile debout, job rouge.
///
/// ⚠️ Rien ici ne doit être évalué au CHARGEMENT du module. Le stage builder du
/// Dockerfile n'a aucune de ces variables, et il importe ce fichier par
/// transitivité dès qu'un composant serveur le touche. C'est le piège exact
/// payé sur `prisma.config.ts` (write-back PR #3 note 2) : le helper `env()` de
/// `prisma/config` levait au chargement, donc aussi pour `prisma generate`.
/// D'où une fonction, et non un `export const env = schema.parse(...)`.

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  /// Clé Maps JS de la carte de la tournée technicien (ADR-015 v3, écran T1).
  ///
  /// ── Pourquoi PAS `NEXT_PUBLIC_`
  ///
  /// La DoD de T-V2-01 l'écrivait ainsi ; c'est faux, et Benjamin l'a corrigé le
  /// 2026-08-12. `NEXT_PUBLIC_` est un **contrat** dans Next : il annonce une
  /// variable inlinée au build et lisible depuis un composant client. Or le
  /// stage builder du Dockerfile n'a aucune variable d'environnement — la clé y
  /// serait gelée à `undefined` dans l'image de production. Elle est donc lue au
  /// **runtime serveur** et descendue en prop par le RSC. Garder le préfixe
  /// ferait écrire un jour `process.env.NEXT_PUBLIC_…` dans un composant client,
  /// qui obtiendrait `undefined` sans le moindre avertissement.
  ///
  /// Préfixe `HCH_` comme les autres variables applicatives (`HCH_BAN_BASE_URL`,
  /// `HCH_MAIL_TRANSPORT`).
  ///
  /// ── Pourquoi facultative
  ///
  /// Même idiome que `NEXT_PUBLIC_APP_URL` sur la branche `noop` ci-dessous :
  /// « exigée selon le mode » est déjà le vocabulaire de ce fichier, pas une
  /// exception au principe d'échec bruyant. La rendre obligatoire ferait
  /// répondre 503 à `/api/health` sur les deux piles tant que le projet Google
  /// n'est pas en production — un déploiement bloqué pour une carte sur un seul
  /// écran. Absente, la liste de la tournée sert de repli, par le même chemin de
  /// code que lorsque la carte ne charge pas.
  ///
  /// ⚠️ **Risque résiduel assumé** : une pile renseignée et l'autre non perd sa
  /// carte en silence. Le contrôle est de regarder l'écran après déploiement.
  ///
  /// Elle finit dans le HTML servi, donc publique par construction sur un dépôt
  /// qui bascule public — sa seule protection réelle est la restriction par
  /// referer côté console Google (ADR-015 v2 §D2).
  HCH_MAPS_API_KEY: z.string().min(1).optional(),
});

/// Union discriminée plutôt qu'un booléen plus trois optionnels : c'est le
/// discriminant qui décide des variables exigées, et le type qui en sort
/// interdit de lire `appPassword` sur le transport no-op.
///
/// Aucune valeur par défaut sur `HCH_MAIL_TRANSPORT`, délibérément. Un défaut à
/// `noop` ferait qu'une pile de production mal configurée cesserait d'envoyer
/// sans que rien ne le signale — l'inverse de l'échec bruyant qu'exige ADR-017.
const mailSchema = z.discriminatedUnion("HCH_MAIL_TRANSPORT", [
  z.object({
    HCH_MAIL_TRANSPORT: z.literal("gmail"),
    GMAIL_APP_PASSWORD: z.string().min(1),
    GMAIL_FROM_ADDRESS: z.string().min(1),
    /// Exigée seulement ici : sans elle le lien d'activation part en relatif,
    /// donc inutilisable dans un client de messagerie. En no-op, personne ne
    /// clique le lien, et `localhost` suffit.
    NEXT_PUBLIC_APP_URL: z.string().min(1),
  }),
  z.object({
    HCH_MAIL_TRANSPORT: z.literal("noop"),
    NEXT_PUBLIC_APP_URL: z.string().min(1).optional(),
  }),
]);

export type MailEnv =
  | { transport: "gmail"; fromAddress: string; appPassword: string }
  | { transport: "noop" };

export type ServerEnv = {
  databaseUrl: string;
  sessionSecret: string;
  appUrl: string;
  mail: MailEnv;
  /// `undefined` quand la clé n'est pas renseignée — la carte ne se monte pas.
  mapsApiKey: string | undefined;
};

const APP_URL_PAR_DEFAUT = "http://localhost:3000";

/// `""` et `undefined` décrivent le même état — une variable non renseignée.
/// Un `.env` commité porte des clés vides par construction (`.env.example`), et
/// Docker transmet une valeur vide plutôt que rien pour une clé déclarée sans
/// valeur.
function lire(nom: string): string | undefined {
  const valeur = process.env[nom];
  return valeur === undefined || valeur === "" ? undefined : valeur;
}

function nommerFautives(erreur: z.ZodError): string[] {
  return erreur.issues.map((issue) => issue.path.join(".") || "(racine)");
}

/// Valide l'environnement du serveur et le renvoie typé. **Lève** si une
/// variable manque, en nommant toutes les fautives d'un coup : un message qui
/// n'en nomme qu'une transforme un diagnostic en boucle corriger-redéployer, et
/// sur une pile distante chaque tour coûte un déploiement complet.
///
/// Non mémoïsé : le coût est de l'ordre de la microseconde, et un cache
/// demanderait une trappe de réinitialisation réservée aux tests — un état
/// global de plus pour une économie invisible.
export function serverEnv(): ServerEnv {
  const brut = {
    DATABASE_URL: lire("DATABASE_URL"),
    SESSION_SECRET: lire("SESSION_SECRET"),
    HCH_MAPS_API_KEY: lire("HCH_MAPS_API_KEY"),
    HCH_MAIL_TRANSPORT: lire("HCH_MAIL_TRANSPORT"),
    GMAIL_APP_PASSWORD: lire("GMAIL_APP_PASSWORD"),
    GMAIL_FROM_ADDRESS: lire("GMAIL_FROM_ADDRESS"),
    NEXT_PUBLIC_APP_URL: lire("NEXT_PUBLIC_APP_URL"),
  };

  const base = baseSchema.safeParse(brut);
  const mail = mailSchema.safeParse(brut);

  if (!base.success || !mail.success) {
    const fautives = [
      ...(base.success ? [] : nommerFautives(base.error)),
      ...(mail.success ? [] : nommerFautives(mail.error)),
    ];
    throw new Error(
      "Environnement serveur incomplet. Variables à renseigner :\n" +
        fautives.map((nom) => `  · ${nom}`).join("\n") +
        "\nCf. .env.example (poste) ou le .env.prod de la pile (VPS).",
    );
  }

  return {
    databaseUrl: base.data.DATABASE_URL,
    sessionSecret: base.data.SESSION_SECRET,
    mapsApiKey: base.data.HCH_MAPS_API_KEY,
    appUrl: mail.data.NEXT_PUBLIC_APP_URL ?? APP_URL_PAR_DEFAUT,
    mail:
      mail.data.HCH_MAIL_TRANSPORT === "gmail"
        ? {
            transport: "gmail",
            fromAddress: mail.data.GMAIL_FROM_ADDRESS,
            appPassword: mail.data.GMAIL_APP_PASSWORD,
          }
        : { transport: "noop" },
  };
}
