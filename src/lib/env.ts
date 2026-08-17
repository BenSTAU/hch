import "server-only";

import { z } from "zod";

/// Garde d'environnement. Une variable applicative manquante ne se voit qu'à
/// l'usage ; branchée sur `/api/health`, elle rend l'absence immédiate :
/// healthcheck rouge, rollback inline, pile debout, job rouge.
///
/// ⚠️ **Rien ici ne doit être évalué au CHARGEMENT du module.** Le stage
/// builder du Dockerfile n'a aucune de ces variables, et il importe ce fichier
/// par transitivité dès qu'un composant serveur le touche. D'où une fonction,
/// et non un `export const env = schema.parse(...)`. Même piège que le helper
/// `env()` de `prisma/config`, qui levait pour `prisma generate`.

const baseSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  /// Clé Maps JS de la carte de la tournée technicien, écran T1.
  ///
  /// ⚠️ **Surtout pas `NEXT_PUBLIC_`.** Ce préfixe est un contrat dans Next :
  /// il annonce une variable inlinée au BUILD, et le stage builder du
  /// Dockerfile n'a aucune variable d'environnement - la clé serait gelée à
  /// `undefined` dans l'image de production. Elle est lue au runtime serveur et
  /// descendue en prop par le RSC.
  ///
  /// Facultative : la rendre obligatoire ferait répondre 503 à `/api/health`
  /// sur les deux piles tant que le projet Google n'est pas en production.
  /// Absente, la liste de la tournée sert de repli.
  ///
  /// ⚠️ Elle finit dans le HTML servi, donc publique par construction : sa
  /// seule protection est la restriction par referer côté console Google
  /// (ADR-015 v2 §D2).
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

/// Valide l'environnement du serveur et le renvoie typé. **Lève** en nommant
/// toutes les variables fautives d'un coup : n'en nommer qu'une transforme le
/// diagnostic en boucle corriger-redéployer, où chaque tour coûte un
/// déploiement complet sur une pile distante.
///
/// Non mémoïsé : un cache demanderait une trappe de réinitialisation pour les
/// tests, soit un état global de plus pour une économie invisible.
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
