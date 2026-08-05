#!/bin/sh
# Harnais de morsure du garde testeur. À lancer après toute modification du
# garde : `sh .claude/hooks/testeur-write-guard.test.sh`
cd "$(dirname "$0")/../.." || exit 1
GUARD=.claude/hooks/testeur-write-guard.sh

# Le garde se retire hors fenêtre du testeur (cf. testeur-sentinel-arm.sh) : il
# faut donc armer la sentinelle pour l'éprouver, sinon les 13 cas de refus
# passeraient tous en OK et le harnais rendrait un vert menteur.
#
# Si elle est déjà levée, c'est qu'un testeur tourne — on n'y touche pas, et on
# ne la retire pas en sortant.
SENTINEL=.claude/.testeur-actif
ARMED_BY_US=0
if [ ! -f "$SENTINEL" ]; then
  mkdir -p .claude 2>/dev/null
  printf 'harnais\n' > "$SENTINEL"
  ARMED_BY_US=1
fi
cleanup() { [ "$ARMED_BY_US" -eq 1 ] && rm -f "$SENTINEL"; }
trap cleanup EXIT INT TERM

pass=0; fail=0

check() { # $1 = attendu (OK|REFUSE), $2 = libellé, $3 = payload JSON
  printf '%s' "$3" | sh "$GUARD" >/dev/null 2>&1
  if [ $? -eq 0 ]; then got=OK; else got=REFUSE; fi
  if [ "$got" = "$1" ]; then
    pass=$((pass+1)); printf '  ok      %-52s %s\n' "$2" "$got"
  else
    fail=$((fail+1)); printf '  ÉCHEC   %-52s attendu=%s obtenu=%s\n' "$2" "$1" "$got"
  fi
}

# `cwd` fait partie du payload réel et sert désormais à ramener les chemins
# absolus en relatif — les fixtures doivent donc le porter.
CWD=C:\\\\Users\\\\User\\\\dev\\\\hch
w() { printf '{"tool_name":"Write","cwd":"%s","tool_input":{"file_path":"%s","content":"x"}}' "$CWD" "$1"; }
b() { printf '{"tool_name":"Bash","cwd":"%s","tool_input":{"command":"%s"}}' "$CWD" "$1"; }

echo "--- Write / Edit ---"
check REFUSE "code applicatif"                 "$(w 'src/lib/db/client.ts')"
check OK     "unitaire co-localisé .test.ts"   "$(w 'src/lib/utils.test.ts')"
check OK     "composant .test.tsx"             "$(w 'src/components/ui/button.test.tsx')"
check OK     "E2E playwright"                  "$(w 'tests/e2e/signup-login.spec.ts')"
check REFUSE "migration prisma"                "$(w 'prisma/migrations/x/migration.sql')"
check REFUSE "config racine"                   "$(w 'next.config.ts')"
check REFUSE "workflow CI"                     "$(w '.github/workflows/deploy.yml')"
check OK     "chemin absolu Windows vers test" "$(w 'C:\\\\Users\\\\User\\\\dev\\\\hch\\\\src\\\\lib\\\\utils.test.ts')"
check REFUSE "chemin absolu Windows vers code" "$(w 'C:\\\\Users\\\\User\\\\dev\\\\hch\\\\src\\\\lib\\\\db\\\\client.ts')"
check REFUSE "traversée via tests/"            "$(w 'tests/../src/lib/db/client.ts')"
check REFUSE "traversée via .test.ts"          "$(w 'src/a.test.ts/../../next.config.ts')"

echo "--- Bash ---"
check OK     "pnpm test"                       "$(b 'pnpm test')"
check OK     "pnpm test:e2e"                   "$(b 'pnpm test:e2e')"
check OK     "git diff"                        "$(b 'git diff --stat')"
check REFUSE "redirection vers src"            "$(b 'echo x > src/foo.ts')"
check REFUSE "chaînage"                        "$(b 'pnpm test; rm -rf src')"
check REFUSE "substitution"                    "$(b 'pnpm test $(whoami)')"
check REFUSE "commande hors liste"             "$(b 'pnpm install')"
check REFUSE "git écriture"                    "$(b 'git commit -m x')"
check REFUSE "sed -i sur du code"              "$(b 'sed -i s/a/b/ src/lib/db/client.ts')"

# Les deux trous trouvés par l'agent testeur en T-J0-04, sur un garde qui
# rendait pourtant 22/22. Le harnais qui ne les couvrait pas est ce qui les a
# laissés vivre — ils entrent ici avant d'être corrigés ailleurs.
echo "--- Contournements trouvés en sonde ---"
check REFUSE "saut de ligne comme séparateur"  "$(b 'git status --short\nwhoami')"
check REFUSE "saut de ligne après pnpm test"   "$(b 'pnpm test\nrm -rf src')"
check REFUSE "répertoire tests/ imbriqué"      "$(w 'src/lib/tests/contournement.ts')"
check REFUSE "tests/ imbriqué en absolu"       "$(w 'C:\\\\Users\\\\User\\\\dev\\\\hch\\\\src\\\\lib\\\\tests\\\\x.ts')"
check OK     "tests/ racine en absolu"         "$(w 'C:\\\\Users\\\\User\\\\dev\\\\hch\\\\tests\\\\e2e\\\\gp-01.spec.ts')"

# Verbes autorisés portant une primitive arbitraire dans leurs arguments.
echo "--- Arguments détournés ---"
check REFUSE "git diff --output= écrit un fichier" "$(b 'git diff --output=src/lib/db/client.ts HEAD~1 HEAD')"
check REFUSE "git diff --no-index lit le disque"   "$(b 'git diff --no-index .gitignore C:/Windows/win.ini')"
check REFUSE "pnpm lint --fix réécrit les sources" "$(b 'pnpm lint --fix')"
check OK     "pnpm lint nu reste autorisé"         "$(b 'pnpm lint')"
check OK     "git diff --stat reste autorisé"      "$(b 'git diff --stat')"

# La sentinelle elle-même est un cas de test : sans elle, le garde doit se
# retirer intégralement — c'est ce qui permet à l'implémentation d'écrire hors
# fenêtre du testeur. Un garde qui mordrait tout le temps bloquerait le dépôt.
echo "--- Sentinelle ---"
if [ "$ARMED_BY_US" -eq 1 ]; then
  rm -f "$SENTINEL"
  check OK "sentinelle baissée : le garde se retire" "$(w 'src/lib/db/client.ts')"
  printf 'harnais\n' > "$SENTINEL"
  check REFUSE "sentinelle levée : le garde remord"  "$(w 'src/lib/db/client.ts')"
else
  echo "  (ignoré — un testeur tourne, sentinelle non manipulée)"
fi

printf '\n  %d ok, %d échec(s)\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
