import type { RequestHandler } from "msw";

/// Handlers MSW partagés par la suite Vitest.
///
/// **Vide au jalon 0, et c'est un état attendu.** HCH n'émet aujourd'hui aucun
/// appel réseau sortant : `src/lib/auth/oauth-google.ts` n'est pas écrit, et
/// l'API Geocoding arrive avec les zones. Le premier handler sera l'échange de
/// code du flux Google (`POST oauth2.googleapis.com/token`), qu'ADR-014 §2
/// nomme comme le cas que `vi.mock` ne sait pas couvrir.
///
/// La liste vide n'est donc pas un oubli : combinée à
/// `onUnhandledRequest: "error"` dans `vitest.setup.ts`, elle fait échouer tout
/// appel sortant qui apparaîtrait sans avoir été décidé. C'est un garde-fou
/// actif, pas un fichier en attente.
///
/// Playwright ne s'en sert pas : les deux jeux d'E2E tapent des URL réelles,
/// il n'y a rien à intercepter entre un navigateur et un serveur déployé.
export const handlers: RequestHandler[] = [];
