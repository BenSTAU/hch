#!/bin/sh
# Arme la sentinelle du testeur — hook PreToolUse sur `Task`.
#
# POURQUOI CE FICHIER EXISTE, ET POURQUOI IL DIVERGE DU VAULT
#
# ADR-013 §D3 suppose DEUX SESSIONS distinctes. Le testeur est implémenté en
# sous-agent, et un sous-agent n'est pas une session : il partage `session_id`,
# `transcript_path` et `prompt_id` avec la session d'implémentation. Mesuré en
# T-J0-04 sur deux payloads réels — ils sont strictement identiques.
#
# Conséquence : un hook `PreToolUse` déclaré dans `settings.json` est bien
# appelé, mais ne peut pas savoir QUI écrit. Posé nu, il refuserait aussi les
# écritures de l'implémentation, qui ne pourrait plus travailler. Et le hook
# déclaré dans le frontmatter de `.claude/agents/testeur.md`, lui, n'est jamais
# appelé du tout.
#
# D'où ce détour : le garde ne cherche pas QUI écrit, il regarde SI le testeur
# tourne. Ces deux hooks arment et désarment la sentinelle ; personne ne
# l'arme à la main, et le testeur ne peut pas la désarmer — `rm` n'est pas sur
# sa liste blanche Bash et le garde lui refuse toute écriture dans `.claude/`.
#
# La fenêtre où la sentinelle est levée est exactement celle où le workflow
# interdit déjà à l'implémentation d'écrire (CLAUDE.md §Workflow, étape 6 :
# « tu n'écris rien pendant qu'il travaille »). Le dégât collatéral est donc
# nul par construction.
#
# Limite assumée : la sentinelle est un booléen. Si un jour deux sous-agents
# tournent en parallèle, elle est trop grossière.

payload=$(cat)

field() {
  printf '%s' "$payload" \
    | sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
}

# On n'arme que pour CE sous-agent. Un `Task` vers un autre type d'agent ne
# doit pas fermer l'écriture de l'implémentation.
# `Task` ET `Agent` : le nom de l'outil d'invocation de sous-agent diffère
# selon le harnais. Sur ce poste c'est `Agent` ; `Task` est le nom historique.
# Constaté en T-J0-04 — la première version n'écoutait que `Task` et la
# sentinelle n'a jamais été armée, ce que la sonde du testeur a révélé.
tool=$(field tool_name)
if { [ "$tool" = "Task" ] || [ "$tool" = "Agent" ]; } &&
  [ "$(field subagent_type)" = "testeur" ]; then
  mkdir -p .claude 2>/dev/null
  date '+%F %T' > .claude/.testeur-actif 2>/dev/null
fi

exit 0
