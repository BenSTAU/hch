#!/bin/sh
# Garde PreToolUse de l'agent testeur HCH — cloisonnement par construction.
#
# ADR-013 §D3 : le testeur écrit les tests, jamais le code qu'il évalue.
# Deux surfaces à filtrer, pas une :
#   · Write / Edit — refusés hors des fichiers de test
#   · Bash         — liste blanche, sinon `sh -c 'cat > src/x.ts'` contourne tout
#
# Sortie 2 = refus (le message stderr remonte à l'agent). Sortie 0 = laisser passer.

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

    # Formes relative et absolue acceptées — le chemin du dépôt diffère entre
    # le PC maison et le PC Shadow, on ne l'ancre donc pas en dur.
    #   src/**/*.test.{ts,tsx} — unitaires co-localisés (ADR-014)
    #   tests/**               — E2E Playwright
    case "$norm" in
      src/*.test.ts|src/*.test.tsx|tests/*)          exit 0 ;;
      */src/*.test.ts|*/src/*.test.tsx|*/tests/*)    exit 0 ;;
    esac

    refuse "Écriture refusée hors périmètre de test (ADR-013 §D3). Autorisé : src/**/*.test.ts, src/**/*.test.tsx, tests/**. Reçu : $norm — tu ne corriges pas le code que tu évalues, tu le rapportes." "$path"
    ;;

  Bash)
    cmd=$(field command)

    # Chaînage, redirection, substitution : refusés d'office. Le test runner et
    # git log n'en ont jamais besoin, et c'est par là qu'on écrit sans Write.
    if printf '%s' "$cmd" | grep -qE '(;|\||`|\$\(|>|<|&)'; then
      refuse "Commande composée refusée : ni chaînage, ni redirection, ni substitution. Lance une commande à la fois." "$cmd"
    fi

    # Liste blanche stricte, ancrée en début de commande.
    if printf '%s' "$cmd" | grep -qE '^(pnpm (test|test:e2e|typecheck|lint)( |$)|pnpm exec vitest( |$)|pnpm exec playwright (test|show-report)( |$)|npx playwright (test|show-report)( |$)|git (status|diff|log|show|ls-files|branch)( |$))'; then
      exit 0
    fi

    refuse "Bash refusé pour l'agent testeur. Autorisé : pnpm test / test:e2e / typecheck / lint, vitest, playwright test, et git en lecture (status, diff, log, show, ls-files, branch)." "$cmd"
    ;;
esac

exit 0
