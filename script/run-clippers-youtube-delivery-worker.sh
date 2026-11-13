#!/bin/zsh
set -euo pipefail
umask 077

RUNTIME_ROOT="${CLIPPERS_RUNTIME_ROOT:?CLIPPERS_RUNTIME_ROOT is required}"
DELIVERY_CONFIG="${CLIPPERS_YOUTUBE_DELIVERY_CONFIG:?CLIPPERS_YOUTUBE_DELIVERY_CONFIG is required}"
SELECTED_ENV="${CLIPPERS_YOUTUBE_SELECTED_ENV:?CLIPPERS_YOUTUBE_SELECTED_ENV is required}"

[[ -f "$SELECTED_ENV" && ! -L "$SELECTED_ENV" ]] || { print -u2 "YouTube selected env must be a regular file."; exit 1; }
[[ "$(stat -f '%Lp' "$SELECTED_ENV")" == [0-7]00 ]] || { print -u2 "YouTube selected env must be owner-only."; exit 1; }

typeset -a YOUTUBE_ENV
YOUTUBE_ENV=()
while IFS= read -r raw || [[ -n "$raw" ]]; do
  line="${raw##[[:space:]]#}"
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" == export\ * ]] && line="${line#export }"
  key="${line%%=*}"
  value="${line#*=}"
  [[ "$key" == "$line" ]] && continue
  case "$key" in
    CLIPPERS_YOUTUBE_ES_CHANNEL_ID|CLIPPERS_YOUTUBE_ES_CLIENT_ID|CLIPPERS_YOUTUBE_ES_CLIENT_SECRET|CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN|\
    CLIPPERS_YOUTUBE_EN_CHANNEL_ID|CLIPPERS_YOUTUBE_EN_CLIENT_ID|CLIPPERS_YOUTUBE_EN_CLIENT_SECRET|CLIPPERS_YOUTUBE_EN_REFRESH_TOKEN|\
    CLIPPERS_YOUTUBE_SLEEP_CHANNEL_ID|CLIPPERS_YOUTUBE_SLEEP_CLIENT_ID|CLIPPERS_YOUTUBE_SLEEP_CLIENT_SECRET|CLIPPERS_YOUTUBE_SLEEP_REFRESH_TOKEN|\
    CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED)
      if [[ ( "$value" == \"*\" && "$value" == *\" ) || ( "$value" == \'*\' && "$value" == *\' ) ]]; then
        value="${value[2,-2]}"
      fi
      YOUTUBE_ENV+=("$key=$value")
      ;;
  esac
done < "$SELECTED_ENV"

exec /usr/bin/env -i \
  "PATH=${PATH:-/usr/local/bin:/usr/bin:/bin}" \
  "HOME=${HOME:-}" \
  "TMPDIR=${TMPDIR:-/tmp}" \
  "TZ=${TZ:-America/New_York}" \
  "${YOUTUBE_ENV[@]}" \
  "${CLIPPERS_NODE_PATH:-$(command -v node)}" \
  "$RUNTIME_ROOT/script/clippers-youtube-delivery-worker.mjs" \
  --config "$DELIVERY_CONFIG"
