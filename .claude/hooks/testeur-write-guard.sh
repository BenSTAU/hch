#!/bin/sh
# Garde PreToolUse de l'agent testeur HCH — cloisonnement par construction.
#
# ADR-013 §D3 : le testeur écrit les tests, jamais le code qu'il évalue.
# Deux surfaces à filtrer, pas une :
#   · Write / Edit — refusés hors des fichiers de test
#   · Bash         — liste blanche, sinon `sh -c 'cat > src/x.ts'` contourne tout
#
# Sortie 2 = refus (le message stderr remonte à l'agent). Sortie 0 = laisser passer.

# ─────────────────────────────────────────────────────────────────────────
# ÉCART AU CONTENU LITTÉRAL DU VAULT — posé en T-J0-04, à remonter en
# writeback vers agent-testeur-hch.
#
# Ce garde est déclaré dans `.claude/settings.json`, et non plus seulement
# dans le frontmatter de l'agent : celui du frontmatter n'est JAMAIS appelé
# (constaté par trois preuves indépendantes de l'agent testeur, plus une sonde
# qui a écrit hors périmètre sans être bloquée). Mais un hook de settings.json
# s'applique à TOUTE la session, et son payload ne distingue pas le sous-agent
# de l'implémentation — `session_id`, `transcript_path` et `prompt_id` sont
# identiques, mesuré sur deux payloads réels.
#
# D'où la sentinelle : hors fenêtre du testeur, ce garde se retire. Motif
# complet dans `testeur-sentinel-arm.sh`.
# ─────────────────────────────────────────────────────────────────────────
[ -f .claude/.testeur-actif ] || exit 0

payload=$(cat)

field() {
  printf '%s' "$payload" \
    | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

# Trace des refus : un testeur qui tente d'écrire hors périmètre est un signal
# sur le dispositif, pas un incident à avaler. C'est aussi la preuve, pour le
# jury, que le cloisonnement s'applique au lieu d'être seulement déclaré.
refuse() {
  mkdir -p .claude/logs 2>/dev/null
  printf '%s\t%s\t%s\n' "$(date '+%F %T')" "$tool" "$(printf '%s' "$2" | head -c 200)" \
    >> .claude/logs/testeur-refus.log 2>/dev/null
  echo "$1" >&2
  exit 2
}

tool=$(field tool_name)

case "$tool" in
  Write|Edit)
    path=$(field file_path)
    # Normalise : antislashs Windows (échappés en JSON, donc doublés après
    # extraction brute), slashs répétés, ./ de tête.
    norm=$(printf '%s' "$path" | tr '\\' '/' | sed 's#//*#/#g; s#^\./##')

    # Traversée refusée AVANT toute autorisation : `tests/../src/x.ts` matche
    # sinon le motif `tests/*` et ouvre tout le dépôt. Vérifié en test.
    case "$norm" in
      *..*) refuse "Chemin refusé : aucune traversée (..) dans un chemin d'écriture." "$path" ;;
    esac

    # Ramène le chemin en relatif au dépôt, à partir du `cwd` que le harnais
    # fournit dans le payload — le chemin du dépôt diffère entre le PC maison
    # et le PC Shadow, on ne l'ancre pas en dur.
    #
    # Cette normalisation remplace les motifs `*/src/…` et `*/tests/…` de la
    # première version, qui acceptaient trop : dans un `case` shell, `*`
    # traverse les `/`, donc `*/tests/*` matchait `src/lib/tests/n-importe.ts`
    # — un répertoire nommé `tests` n'importe où sous `src/` était en écriture
    # libre. Trou trouvé par l'agent testeur en T-J0-04.
    #
    # Si le `cwd` est absent ou ne préfixe pas le chemin, `norm` reste absolu,
    # aucun motif relatif ne matche, et l'écriture est refusée. Fail-closed.
    root=$(field cwd | tr '\\' '/' | sed 's#//*#/#g; s#/$##')
    [ -n "$root" ] && norm=${norm#"$root"/}

    #   src/**/*.test.{ts,tsx} — unitaires co-localisés (ADR-014)
    #   tests/**               — E2E Playwright
    case "$norm" in
      src/*.test.ts|src/*.test.tsx|tests/*) exit 0 ;;
    esac

    refuse "Écriture refusée hors périmètre de test (ADR-013 §D3). Autorisé : src/**/*.test.ts, src/**/*.test.tsx, tests/**. Reçu : $norm — tu ne corriges pas le code que tu évalues, tu le rapportes." "$path"
    ;;

  Bash)
    cmd=$(field command)

    # Chaînage, redirection, substitution : refusés d'office. Le test runner et
    # git log n'en ont jamais besoin, et c'est par là qu'on écrit sans Write.
    #
    # L'antislash est dans la liste, et ce n'est pas cosmétique : le SAUT DE
    # LIGNE est un séparateur de commandes, et il arrive ici encodé `\n` par le
    # JSON. La première version ne le voyait pas — `grep` recevait une seule
    # ligne, la liste blanche était satisfaite par le préfixe, et le shell
    # exécutait les deux commandes. `git status --short\nwhoami` ouvrait donc
    # un shell arbitraire, donc l'écriture arbitraire : le garde d'écriture se
    # contournait par le garde Bash, ce que ce filtre existe précisément pour
    # empêcher. Trou trouvé par l'agent testeur en T-J0-04, jamais exploité par
    # lui pour écrire. Aucune commande de la liste blanche n'a besoin d'un
    # antislash.
    if printf '%s' "$cmd" | grep -qE '(;|\||`|\$\(|>|<|&|\\)'; then
      refuse "Commande composée refusée : ni chaînage, ni redirection, ni substitution. Lance une commande à la fois." "$cmd"
    fi

    # Liste noire d'arguments, AVANT la liste blanche de verbes.
    #
    # La liste blanche ne regarde que le verbe, jamais ses arguments — et trois
    # verbes autorisés transportent une primitive d'écriture, de lecture ou
    # d'exécution arbitraire. Trouvé en sonde par l'agent testeur, T-J0-04 :
    #   git diff --output=<chemin>   écrit, donc écrase, n'importe quel fichier
    #   git diff --no-index <chemin> lit tout le disque, y compris .env.local,
    #                                que le `deny: Read(...)` ne protège pas ici
    #   pnpm lint --fix              réécrit les sources
    #   --config / --exec            détournent le runner vers autre chose
    #
    # C'est un colmatage, pas une garantie : filtrer des arguments connus est
    # une course. La vraie limite est ailleurs — voir l'avertissement en fin de
    # fichier.
    if printf '%s' "$cmd" | grep -qE '(--output|--no-index|--fix|--config|--exec|-o[= ])'; then
      refuse "Argument refusé : --output, --no-index, --fix, --config et --exec transportent une écriture, une lecture ou une exécution arbitraire, même derrière une commande autorisée." "$cmd"
    fi

    # Liste blanche stricte, ancrée en début de commande.
    if printf '%s' "$cmd" | grep -qE '^(pnpm (test|test:e2e|typecheck|lint)( |$)|pnpm exec vitest( |$)|pnpm exec playwright (test|show-report)( |$)|npx playwright (test|show-report)( |$)|git (status|diff|log|show|ls-files|branch)( |$))'; then
      exit 0
    fi

    refuse "Bash refusé pour l'agent testeur. Autorisé : pnpm test / test:e2e / typecheck / lint, vitest, playwright test, et git en lecture (status, diff, log, show, ls-files, branch)." "$cmd"
    ;;
esac

exit 0

# ─────────────────────────────────────────────────────────────────────────
# CE QUE CE GARDE NE PEUT PAS FERMER — constat de l'agent testeur, T-J0-04.
#
# Le périmètre autorisé (`src/**/*.test.ts`) est du code Node, et le runner
# qui l'exécute (`pnpm test`) est sur la liste blanche. Une écriture autorisée
# plus une commande autorisée valent les privilèges Node complets : écriture
# hors dépôt, lecture de `.env.local`, `execSync` de n'importe quoi, et même
# `unlink` de la sentinelle — après quoi ce garde se retire pour le reste de
# la session.
#
# Vérifié en sonde, jamais exercé au-delà du constat. Aucun resserrement de
# regex ne ferme ça : le périmètre lui-même est exécutable.
#
# Les deux issues honnêtes, à trancher en amendement d'ADR-013 §D3 :
#   · exécuter la suite dans un conteneur sans droit d'écriture hors d'un temp
#   · ou assumer que le contrôle réel sur ce point est la revue humaine du
#     diff de PR — et l'ÉCRIRE, plutôt que de laisser croire que le hook le
#     couvre
#
# En l'état, ce garde reste très supérieur au déclaratif : 10 tentatives
# d'écriture hors périmètre sur 10 refusées, chacune journalisée. Il borne
# l'accident et rend l'intention visible. Il n'arrête pas un agent décidé.
# ─────────────────────────────────────────────────────────────────────────
