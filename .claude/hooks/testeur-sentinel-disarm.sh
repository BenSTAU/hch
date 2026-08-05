#!/bin/sh
# Désarme la sentinelle du testeur — hook PostToolUse sur `Task`/`Agent`.
# Pendant du hook d'armement, voir `testeur-sentinel-arm.sh` pour le motif.
#
# POURQUOI PostToolUse ET NON SubagentStop
#
# La première version écoutait `SubagentStop`, sans matcher, et supprimait la
# sentinelle inconditionnellement. Défaut relevé par l'agent testeur lui-même :
# n'importe quel AUTRE sous-agent qui se termine pendant qu'il travaille
# désarmait le garde EN PLEIN VOL — soit exactement le mode d'échec que ce
# fichier déclare inacceptable.
#
# `PostToolUse` sur l'appel d'agent est symétrique de l'armement : même outil,
# même payload, donc même test sur `subagent_type`. Ce qui a armé est ce qui
# désarme, et rien d'autre.
#
# Si ce hook ne tourne pas — plantage, coupure, interruption — la sentinelle
# RESTE et le garde continue de mordre. Fail-closed : la session
# d'implémentation se retrouve bloquée en écriture, ce qui est pénible mais
# VISIBLE. L'inverse — un garde qui cesse silencieusement de garder — est le
# seul mode d'échec qu'on ne peut pas se permettre ici.

payload=$(cat)

field() {
  printf '%s' "$payload" \
    | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

if [ "$(field subagent_type)" = "testeur" ]; then
  rm -f .claude/.testeur-actif 2>/dev/null
fi

exit 0
