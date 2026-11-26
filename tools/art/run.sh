#!/bin/bash
# Usage: run.sh name ...  (run from the art folder). Optional refs: anchor.jpg and refs/<name>.png
gen() { n=$1; [ -s out/$n.png ] && return 0
  refs=(); [ -s anchor.jpg ] && refs+=(-i anchor.jpg); [ -s refs/$n.png ] && refs+=(-i refs/$n.png)
  timeout 600 codex exec --skip-git-repo-check --sandbox workspace-write "${refs[@]}" -- "$(cat prompts/$n.txt)" < /dev/null > out/$n.log 2>&1
  [ -s out/$n.png ] && echo "ok $n" || echo "FAILED $n: $(tail -2 out/$n.log | cut -c1-200)"; }
export -f gen
printf '%s\n' "$@" | xargs -P 5 -I{} bash -c 'gen {}'
