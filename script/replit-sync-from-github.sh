#!/usr/bin/env bash
# Replit workspace sync: brings production-branch changes into THIS workspace with a
# per-file 3-way merge, so edits that exist only in Replit are never overwritten.
#   bash script/replit-sync-from-github.sh            # dry run: report only
#   bash script/replit-sync-from-github.sh --apply    # write clean merges
# Never deletes files, never touches tests/, .env*, secrets or deployment config.
set -euo pipefail
REPO="${SYNC_REPO:-https://github.com/robertmanzanillag-jpg/blackops.git}"
BRANCH="${SYNC_BRANCH:-main}"
BASE="${SYNC_BASE:-aecaff708961f88dcf2f2a5be2774c525270ab00}"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
git fetch -q "$REPO" "$BRANCH"; THEIRS=$(git rev-parse FETCH_HEAD)
git cat-file -e "$BASE^{commit}" 2>/dev/null || git fetch -q "$REPO" "$BASE"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
clean=0; merged=0; added=0; same=0; conflicts=(); skipped=()
while IFS=$'\t' read -r status path rest; do
  case "$status" in R*) path="$rest";; esac
  case "$path" in tests/*|*.test.*|.env*|*/.env*|secrets/*|credentials/*|.replit|replit.nix|package.json|package-lock.json) continue;; esac
  if [ "${status:0:1}" = "D" ]; then skipped+=("$path (borrado en GitHub; no se borra aquí)"); continue; fi
  git show "$THEIRS:$path" > "$work/theirs"
  if [ ! -e "$path" ]; then
    [ "$APPLY" = 1 ] && { mkdir -p "$(dirname "$path")"; cp "$work/theirs" "$path"; }
    added=$((added+1)); echo "NUEVO     $path"; continue
  fi
  if cmp -s "$path" "$work/theirs"; then same=$((same+1)); continue; fi
  if git cat-file -e "$BASE:$path" 2>/dev/null; then git show "$BASE:$path" > "$work/base"; else : > "$work/base"; fi
  if cmp -s "$path" "$work/base"; then
    [ "$APPLY" = 1 ] && cp "$work/theirs" "$path"
    clean=$((clean+1)); echo "ACTUALIZA $path"; continue
  fi
  cp "$path" "$work/ours"
  if git merge-file -q -p "$work/ours" "$work/base" "$work/theirs" > "$work/out" 2>/dev/null; then
    [ "$APPLY" = 1 ] && cp "$work/out" "$path"
    merged=$((merged+1)); echo "COMBINA   $path (cambios de Replit + GitHub)"
  else
    conflicts+=("$path")
  fi
done < <(git diff --name-status "$BASE" "$THEIRS" -- server shared client script)
echo "----"
echo "nuevos=$added actualizados=$clean combinados=$merged ya_iguales=$same conflictos=${#conflicts[@]}"
for f in "${conflicts[@]}"; do echo "CONFLICTO (no se tocó): $f"; done
for f in "${skipped[@]}"; do echo "OMITIDO: $f"; done
[ "$APPLY" = 1 ] && echo "APLICADO desde $THEIRS" || echo "SIMULACIÓN: nada cambió. Repite con --apply para aplicar."
