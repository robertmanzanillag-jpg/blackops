#!/bin/zsh
set -euo pipefail
umask 077

SCRIPT_DIR="${0:A:h}"
SCRIPT_CHECKOUT="${SCRIPT_DIR:h}"
GIT_COMMON_DIR="$(git -C "$SCRIPT_CHECKOUT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ "$GIT_COMMON_DIR" == */.git ]]; then
  DEFAULT_CONFIG_ROOT="${GIT_COMMON_DIR:h}"
else
  DEFAULT_CONFIG_ROOT="$SCRIPT_CHECKOUT"
fi

CONFIG_ROOT="${CLIPPERS_CONFIG_ROOT:-$DEFAULT_CONFIG_ROOT}"
[[ "$CONFIG_ROOT" == /* ]] || CONFIG_ROOT="$SCRIPT_CHECKOUT/$CONFIG_ROOT"
CONFIG_ROOT="$(cd "$CONFIG_ROOT" && pwd -P)"

DEFAULT_RUNTIME_ROOT="$CONFIG_ROOT/.worktrees/clippers-runtime"
if [[ ! -f "$DEFAULT_RUNTIME_ROOT/script/clippers-free-local-worker.mjs" || ! -f "$DEFAULT_RUNTIME_ROOT/script/clippers-daily-watchdog.mjs" ]]; then
  DEFAULT_RUNTIME_ROOT="$SCRIPT_CHECKOUT"
fi
RUNTIME_ROOT="${CLIPPERS_RUNTIME_ROOT:-${CLIPPERS_PROJECT_DIR:-$DEFAULT_RUNTIME_ROOT}}"
[[ "$RUNTIME_ROOT" == /* ]] || RUNTIME_ROOT="$CONFIG_ROOT/$RUNTIME_ROOT"
RUNTIME_ROOT="$(cd "$RUNTIME_ROOT" 2>/dev/null && pwd -P)" || {
  echo "CLIPPERS_RUNTIME_ROOT is not a readable directory: $RUNTIME_ROOT" >&2
  exit 1
}

WORKSPACE_ROOT="${CLIPPERS_WORKSPACE_ROOT:-$CONFIG_ROOT/clippers_workspace}"
[[ "$WORKSPACE_ROOT" == /* ]] || WORKSPACE_ROOT="$CONFIG_ROOT/$WORKSPACE_ROOT"
SERVICE_LOG_ROOT="${CLIPPERS_SERVICE_LOG_ROOT:-$HOME/Library/Logs/BlackOps/Clippers}"
[[ "$SERVICE_LOG_ROOT" == /* ]] || SERVICE_LOG_ROOT="$HOME/$SERVICE_LOG_ROOT"
TIME_ZONE="${CLIPPERS_WATCHDOG_TIME_ZONE:-America/New_York}"
LOCALTIME_TARGET="$(readlink /etc/localtime 2>/dev/null || true)"
if [[ "$LOCALTIME_TARGET" == */zoneinfo/* ]]; then
  SYSTEM_TIME_ZONE="${LOCALTIME_TARGET#*/zoneinfo/}"
else
  SYSTEM_TIME_ZONE="unknown"
fi
WORKER_HOUR="${CLIPPERS_WORKER_HOUR:-7}"
WORKER_MINUTE="${CLIPPERS_WORKER_MINUTE:-0}"
CONTENT_WORKER_HOUR="${CLIPPERS_CONTENT_WORKER_HOUR:-4}"
CONTENT_WORKER_MINUTE="${CLIPPERS_CONTENT_WORKER_MINUTE:-0}"
YOUTUBE_DELIVERY_HOUR="${CLIPPERS_YOUTUBE_DELIVERY_HOUR:-6}"
YOUTUBE_DELIVERY_MINUTE="${CLIPPERS_YOUTUBE_DELIVERY_MINUTE:-30}"
WATCHDOG_HOUR="${CLIPPERS_WATCHDOG_HOUR:-10}"
WATCHDOG_MINUTE="${CLIPPERS_WATCHDOG_MINUTE:-0}"
DRY_RUN="${CLIPPERS_LAUNCH_AGENT_DRY_RUN:-true}"
ALLOW_DEVELOPMENT_RUNTIME="${CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME:-false}"
NODE_PATH="$(command -v node)"
AGENT_DIR="$HOME/Library/LaunchAgents"
WORKER_LABEL="com.blackops.clippers-free-worker"
CONTENT_WORKER_LABEL="com.blackops.clippers-content-worker"
YOUTUBE_DELIVERY_LABEL="com.blackops.clippers-youtube-delivery-worker"
WATCHDOG_LABEL="com.blackops.clippers-daily-watchdog"
WORKER_PLIST="$AGENT_DIR/$WORKER_LABEL.plist"
CONTENT_WORKER_PLIST="$AGENT_DIR/$CONTENT_WORKER_LABEL.plist"
YOUTUBE_DELIVERY_PLIST="$AGENT_DIR/$YOUTUBE_DELIVERY_LABEL.plist"
WATCHDOG_PLIST="$AGENT_DIR/$WATCHDOG_LABEL.plist"
LOG_DIR="$SERVICE_LOG_ROOT/free-local-worker"
CONTENT_LOG_DIR="$SERVICE_LOG_ROOT/content-worker"
YOUTUBE_DELIVERY_LOG_DIR="$SERVICE_LOG_ROOT/youtube-delivery-worker"
WATCHDOG_LOG_DIR="$SERVICE_LOG_ROOT/daily-watchdog"
CONTENT_WORKER_CONFIG="${CLIPPERS_CONTENT_WORKER_CONFIG:-$WORKSPACE_ROOT/config/clippers-content-worker.json}"
[[ "$CONTENT_WORKER_CONFIG" == /* ]] || CONTENT_WORKER_CONFIG="$CONFIG_ROOT/$CONTENT_WORKER_CONFIG"
YOUTUBE_DELIVERY_CONFIG="${CLIPPERS_YOUTUBE_DELIVERY_CONFIG:-$WORKSPACE_ROOT/config/clippers-youtube-upload-packager.json}"
[[ "$YOUTUBE_DELIVERY_CONFIG" == /* ]] || YOUTUBE_DELIVERY_CONFIG="$CONFIG_ROOT/$YOUTUBE_DELIVERY_CONFIG"
YOUTUBE_SELECTED_ENV="${CLIPPERS_YOUTUBE_SELECTED_ENV:-$WORKSPACE_ROOT/config/clippers-youtube-delivery.env}"
[[ "$YOUTUBE_SELECTED_ENV" == /* ]] || YOUTUBE_SELECTED_ENV="$CONFIG_ROOT/$YOUTUBE_SELECTED_ENV"

[[ "$DRY_RUN" == "true" || "$DRY_RUN" == "false" ]] || {
  echo "CLIPPERS_LAUNCH_AGENT_DRY_RUN must be true or false." >&2
  exit 1
}
[[ "$ALLOW_DEVELOPMENT_RUNTIME" == "true" || "$ALLOW_DEVELOPMENT_RUNTIME" == "false" ]] || {
  echo "CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME must be true or false." >&2
  exit 1
}
[[ "$SYSTEM_TIME_ZONE" == "$TIME_ZONE" ]] || {
  echo "StartCalendarInterval uses the macOS system time zone ($SYSTEM_TIME_ZONE), which must match $TIME_ZONE." >&2
  exit 1
}
[[ -f "$RUNTIME_ROOT/package.json" && -f "$RUNTIME_ROOT/script/clippers-free-local-worker.mjs" && -f "$RUNTIME_ROOT/script/clippers-content-local-worker.mjs" && -f "$RUNTIME_ROOT/script/clippers-daily-watchdog.mjs" ]] || {
  echo "CLIPPERS_RUNTIME_ROOT is not a valid Clippers runtime checkout: $RUNTIME_ROOT" >&2
  exit 1
}
[[ -d "$CONFIG_ROOT" ]] || {
  echo "CLIPPERS_CONFIG_ROOT is not a readable directory: $CONFIG_ROOT" >&2
  exit 1
}

REQUIRED_RUNTIME_FILES=(
  package.json
  script/clippers-free-local-worker.mjs
  script/clippers-marketplace-refresh.mjs
  script/clippers-marketplace-intake.mjs
  script/clippers-render-campaign-drafts.mjs
  script/clippers-upload-metricool-media.ts
  script/clippers-streamer-growth-ceo.mjs
  script/clippers-metricool-autopilot.mjs
  script/clippers-reconcile-publications.mjs
  script/clippers-content-local-worker.mjs
  script/clippers-content-learning-ceo.mjs
  script/clippers-motivation-shorts.mjs
  script/clippers-sleep-video-generator.mjs
  script/clippers-youtube-upload-packager.mjs
  script/clippers-youtube-uploader.mjs
  script/clippers-youtube-publish-worker.mjs
  script/clippers-youtube-delivery-worker.mjs
  script/run-clippers-youtube-delivery-worker.sh
  script/clippers-daily-watchdog.mjs
)
for relative in "${REQUIRED_RUNTIME_FILES[@]}"; do
  [[ -f "$RUNTIME_ROOT/$relative" && -r "$RUNTIME_ROOT/$relative" ]] || {
    echo "Clippers runtime entrypoint is missing or unreadable: $relative" >&2
    exit 1
  }
  /usr/bin/head -c 1 "$RUNTIME_ROOT/$relative" >/dev/null || {
    echo "Clippers runtime entrypoint is not materialized: $relative" >&2
    exit 1
  }
done
if [[ "$ALLOW_DEVELOPMENT_RUNTIME" != "true" ]]; then
  runtime_head="$(git -C "$RUNTIME_ROOT" rev-parse HEAD 2>/dev/null || true)"
  origin_main="$(git -C "$RUNTIME_ROOT" rev-parse refs/remotes/origin/main 2>/dev/null || true)"
  [[ -n "$runtime_head" && "$runtime_head" == "$origin_main" ]] || {
    echo "Clippers runtime must be exactly at origin/main before installation." >&2
    exit 1
  }
  git -C "$RUNTIME_ROOT" diff --quiet --exit-code -- || {
    echo "Clippers runtime has unstaged changes." >&2
    exit 1
  }
  git -C "$RUNTIME_ROOT" diff --cached --quiet --exit-code -- || {
    echo "Clippers runtime has staged changes." >&2
    exit 1
  }
  [[ -z "$(git -C "$RUNTIME_ROOT" status --porcelain --untracked-files=all)" ]] || {
    echo "Clippers runtime has untracked or modified files." >&2
    exit 1
  }
  for relative in "${REQUIRED_RUNTIME_FILES[@]}"; do
    git -C "$RUNTIME_ROOT" ls-files --error-unmatch -- "$relative" >/dev/null 2>&1 || {
      echo "Clippers runtime entrypoint is not tracked at origin/main: $relative" >&2
      exit 1
    }
  done
fi

for key in CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE; do
  value="${(P)key:-}"
  [[ -z "$value" || "$value" == "true" || "$value" == "false" ]] || {
    echo "$key must be true or false when provided." >&2
    exit 1
  }
done
for specification in "CLIPPERS_WORKER_HOUR:$WORKER_HOUR:0:23" "CLIPPERS_WORKER_MINUTE:$WORKER_MINUTE:0:59" "CLIPPERS_CONTENT_WORKER_HOUR:$CONTENT_WORKER_HOUR:0:23" "CLIPPERS_CONTENT_WORKER_MINUTE:$CONTENT_WORKER_MINUTE:0:59" "CLIPPERS_YOUTUBE_DELIVERY_HOUR:$YOUTUBE_DELIVERY_HOUR:0:23" "CLIPPERS_YOUTUBE_DELIVERY_MINUTE:$YOUTUBE_DELIVERY_MINUTE:0:59" "CLIPPERS_WATCHDOG_HOUR:$WATCHDOG_HOUR:0:23" "CLIPPERS_WATCHDOG_MINUTE:$WATCHDOG_MINUTE:0:59"; do
  key="${specification%%:*}"
  rest="${specification#*:}"
  value="${rest%%:*}"
  limits="${rest#*:}"
  minimum="${limits%%:*}"
  maximum="${limits##*:}"
  [[ "$value" == <-> ]] && (( value >= minimum && value <= maximum )) || {
    echo "$key must be an integer from $minimum to $maximum." >&2
    exit 1
  }
done
if [[ -n "${CLIPPERS_TARGET_DAILY_CLIPS:-}" ]]; then
  [[ "$CLIPPERS_TARGET_DAILY_CLIPS" == <-> ]] && (( CLIPPERS_TARGET_DAILY_CLIPS >= 1 && CLIPPERS_TARGET_DAILY_CLIPS <= 5 )) || {
    echo "CLIPPERS_TARGET_DAILY_CLIPS must be an integer from 1 to 5." >&2
    exit 1
  }
fi
if [[ -n "${CLIPPERS_METRICOOL_BLOG_ID:-}" ]]; then
  [[ "$CLIPPERS_METRICOOL_BLOG_ID" == <-> ]] && (( CLIPPERS_METRICOOL_BLOG_ID > 0 )) || {
    echo "CLIPPERS_METRICOOL_BLOG_ID must be a positive integer." >&2
    exit 1
  }
fi

[[ -f "$CONTENT_WORKER_CONFIG" && -r "$CONTENT_WORKER_CONFIG" && ! -L "$CONTENT_WORKER_CONFIG" ]] || {
  echo "CLIPPERS_CONTENT_WORKER_CONFIG is not a readable file: $CONTENT_WORKER_CONFIG" >&2
  exit 1
}
CONTENT_WORKER_CONFIG_MODE="$(stat -f '%Lp' "$CONTENT_WORKER_CONFIG")"
[[ "$CONTENT_WORKER_CONFIG_MODE" == [0-7]00 ]] || {
  echo "CLIPPERS_CONTENT_WORKER_CONFIG must be owner-only (for example mode 600): $CONTENT_WORKER_CONFIG" >&2
  exit 1
}

for specification in "CLIPPERS_YOUTUBE_DELIVERY_CONFIG:$YOUTUBE_DELIVERY_CONFIG" "CLIPPERS_YOUTUBE_SELECTED_ENV:$YOUTUBE_SELECTED_ENV"; do
  key="${specification%%:*}"
  file="${specification#*:}"
  [[ -f "$file" && -r "$file" && ! -L "$file" ]] || {
    echo "$key is not a readable regular file: $file" >&2
    exit 1
  }
  mode="$(stat -f '%Lp' "$file")"
  [[ "$mode" == [0-7]00 ]] || {
    echo "$key must be owner-only (for example mode 600): $file" >&2
    exit 1
  }
done

mkdir -p "$AGENT_DIR" "$LOG_DIR" "$CONTENT_LOG_DIR" "$YOUTUBE_DELIVERY_LOG_DIR" "$WATCHDOG_LOG_DIR"

escape_xml() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

RUNTIME_ENV_XML=""
for key in CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED CLIPPERS_METRICOOL_BLOG_ID CLIPPERS_TIKTOK_ACCOUNT CLIPPERS_TARGET_DAILY_CLIPS CLIPPERS_PUBLIC_MEDIA_PROVIDER CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE CLIPPERS_MARKETPLACE_REFRESH_CONFIG CLIPPERS_MARKETPLACE_REFRESH_TIMEOUT_MS; do
  value="${(P)key:-}"
  if [[ -n "$value" ]]; then
    RUNTIME_ENV_XML+="    <key>$(escape_xml "$key")</key><string>$(escape_xml "$value")</string>"$'\n'
  fi
done

CONTENT_ENV_XML="    <key>CLIPPERS_CONTENT_WORKER_CONFIG</key><string>$(escape_xml "$CONTENT_WORKER_CONFIG")</string>"$'\n'
YOUTUBE_DELIVERY_ENV_XML="    <key>CLIPPERS_RUNTIME_ROOT</key><string>$(escape_xml "$RUNTIME_ROOT")</string>"$'\n'
YOUTUBE_DELIVERY_ENV_XML+="    <key>CLIPPERS_NODE_PATH</key><string>$(escape_xml "$NODE_PATH")</string>"$'\n'
YOUTUBE_DELIVERY_ENV_XML+="    <key>CLIPPERS_YOUTUBE_DELIVERY_CONFIG</key><string>$(escape_xml "$YOUTUBE_DELIVERY_CONFIG")</string>"$'\n'
YOUTUBE_DELIVERY_ENV_XML+="    <key>CLIPPERS_YOUTUBE_SELECTED_ENV</key><string>$(escape_xml "$YOUTUBE_SELECTED_ENV")</string>"$'\n'

write_plist() {
  local destination="$1"
  local label="$2"
  local script_path="$3"
  local hour="$4"
  local minute="$5"
  local stdout_path="$6"
  local stderr_path="$7"
  local environment_xml="${8:-$RUNTIME_ENV_XML}"
  local extra_argument_name="${9:-}"
  local extra_argument_value="${10:-}"
  local program_path="${11:-$NODE_PATH}"
  local temporary="$destination.tmp.$$"
  local extra_program_argument_xml=""
  if [[ -n "$extra_argument_name" ]]; then
    extra_program_argument_xml="<string>$(escape_xml "$extra_argument_name")</string>"
  fi
  if [[ -n "$extra_argument_value" ]]; then
    extra_program_argument_xml+="<string>$(escape_xml "$extra_argument_value")</string>"
  fi
  cat > "$temporary" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$(escape_xml "$label")</string>
  <key>ProgramArguments</key><array><string>$(escape_xml "$program_path")</string><string>$(escape_xml "$script_path")</string>${extra_program_argument_xml}</array>
  <key>WorkingDirectory</key><string>$(escape_xml "$RUNTIME_ROOT")</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(escape_xml "$PATH")</string>
    <key>TZ</key><string>$(escape_xml "$TIME_ZONE")</string>
    <key>CLIPPERS_CONFIG_ROOT</key><string>$(escape_xml "$CONFIG_ROOT")</string>
    <key>CLIPPERS_WORKSPACE_ROOT</key><string>$(escape_xml "$WORKSPACE_ROOT")</string>
    <key>CLIPPERS_WATCHDOG_TIME_ZONE</key><string>$(escape_xml "$TIME_ZONE")</string>
    <key>CLIPPERS_WATCHDOG_HOUR</key><string>$(escape_xml "$WATCHDOG_HOUR")</string>
${environment_xml}  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>$minute</integer></dict>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$(escape_xml "$stdout_path")</string>
  <key>StandardErrorPath</key><string>$(escape_xml "$stderr_path")</string>
</dict></plist>
PLIST
  chmod 600 "$temporary"
  plutil -lint "$temporary"
  mv -f "$temporary" "$destination"
}

write_plist "$WORKER_PLIST" "$WORKER_LABEL" "$RUNTIME_ROOT/script/clippers-free-local-worker.mjs" "$WORKER_HOUR" "$WORKER_MINUTE" "$LOG_DIR/worker.log" "$LOG_DIR/worker.error.log"
write_plist "$CONTENT_WORKER_PLIST" "$CONTENT_WORKER_LABEL" "$RUNTIME_ROOT/script/clippers-content-local-worker.mjs" "$CONTENT_WORKER_HOUR" "$CONTENT_WORKER_MINUTE" "$CONTENT_LOG_DIR/worker.log" "$CONTENT_LOG_DIR/worker.error.log" "$CONTENT_ENV_XML" "--config" "$CONTENT_WORKER_CONFIG"
write_plist "$YOUTUBE_DELIVERY_PLIST" "$YOUTUBE_DELIVERY_LABEL" "$RUNTIME_ROOT/script/run-clippers-youtube-delivery-worker.sh" "$YOUTUBE_DELIVERY_HOUR" "$YOUTUBE_DELIVERY_MINUTE" "$YOUTUBE_DELIVERY_LOG_DIR/worker.log" "$YOUTUBE_DELIVERY_LOG_DIR/worker.error.log" "$YOUTUBE_DELIVERY_ENV_XML" "" "" "/bin/zsh"
write_plist "$WATCHDOG_PLIST" "$WATCHDOG_LABEL" "$RUNTIME_ROOT/script/clippers-daily-watchdog.mjs" "$WATCHDOG_HOUR" "$WATCHDOG_MINUTE" "$WATCHDOG_LOG_DIR/watchdog.log" "$WATCHDOG_LOG_DIR/watchdog.error.log"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Clippers LaunchAgents validated without installation: content worker at ${CONTENT_WORKER_HOUR}:${CONTENT_WORKER_MINUTE}, YouTube delivery at ${YOUTUBE_DELIVERY_HOUR}:${YOUTUBE_DELIVERY_MINUTE}, TikTok worker at ${WORKER_HOUR}:${WORKER_MINUTE}, watchdog at ${WATCHDOG_HOUR}:${WATCHDOG_MINUTE} (${TIME_ZONE}); runtime $RUNTIME_ROOT"
  exit 0
fi

DOMAIN="gui/$(id -u)"
for specification in "$WORKER_LABEL:$WORKER_PLIST" "$CONTENT_WORKER_LABEL:$CONTENT_WORKER_PLIST" "$YOUTUBE_DELIVERY_LABEL:$YOUTUBE_DELIVERY_PLIST" "$WATCHDOG_LABEL:$WATCHDOG_PLIST"; do
  label="${specification%%:*}"
  plist="${specification#*:}"
  launchctl bootout "$DOMAIN" "$plist" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$plist"
  launchctl print "$DOMAIN/$label" >/dev/null
done
launchctl print "$DOMAIN/$WORKER_LABEL" >/dev/null
launchctl print "$DOMAIN/$CONTENT_WORKER_LABEL" >/dev/null
launchctl print "$DOMAIN/$YOUTUBE_DELIVERY_LABEL" >/dev/null
launchctl print "$DOMAIN/$WATCHDOG_LABEL" >/dev/null
echo "Clippers LaunchAgents installed and verified without kickstart: content worker daily at ${CONTENT_WORKER_HOUR}:${CONTENT_WORKER_MINUTE}, YouTube delivery daily at ${YOUTUBE_DELIVERY_HOUR}:${YOUTUBE_DELIVERY_MINUTE}, TikTok worker daily at ${WORKER_HOUR}:${WORKER_MINUTE}, watchdog daily at ${WATCHDOG_HOUR}:${WATCHDOG_MINUTE} (${TIME_ZONE}); runtime $RUNTIME_ROOT"
