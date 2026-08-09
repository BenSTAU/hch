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
