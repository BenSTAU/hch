import { setupServer } from "msw/node";

import { handlers } from "./handlers";

/// Serveur MSW côté Node, branché par `vitest.setup.ts`.
///
/// `msw/node` et non `msw/browser` : la suite Vitest tourne en jsdom, mais les
/// requêtes partent du process Node — c'est l'interception réseau de Node
/// qu'il faut poser, pas un Service Worker. Corollaire assumé dans
/// `pnpm-workspace.yaml` : le postinstall de msw, qui n'existe que pour le
/// mode navigateur, est déclaré en `ignoredBuiltDependencies`.
export const server = setupServer(...handlers);
