#!/bin/sh
# Harnais de morsure du garde testeur. À lancer après toute modification du
# garde : `sh .claude/hooks/testeur-write-guard.test.sh`
cd "$(dirname "$0")/../.." || exit 1
GUARD=.claude/hooks/testeur-write-guard.sh

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

w() { printf '{"tool_name":"Write","tool_input":{"file_path":"%s","content":"x"}}' "$1"; }
b() { printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$1"; }

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

printf '\n  %d ok, %d échec(s)\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
