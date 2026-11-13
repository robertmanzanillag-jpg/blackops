#!/bin/zsh
set -euo pipefail
umask 077

PROJECT_DIR="${BLACKROOM_PROJECT_DIR:-$(pwd)}"
PLIST_PATH="$HOME/Library/LaunchAgents/com.blackroom.content-agent.plist"
LOG_DIR="$PROJECT_DIR/clippers_workspace/blackroom/agent"
NPM_PATH="$(command -v npm)"
REMOTE_URL="${BLACKROOM_REMOTE_CONTROL_URL:-https://ROBPLANNER.replit.app}"
REMOTE_TOKEN="${BLACKROOM_REMOTE_CONTROL_TOKEN:-}"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

escape_xml() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

REMOTE_ENV_XML=""
if [[ -n "$REMOTE_TOKEN" ]]; then
  REMOTE_ENV_XML="<key>BLACKROOM_REMOTE_CONTROL_URL</key><string>$(escape_xml "$REMOTE_URL")</string><key>BLACKROOM_REMOTE_CONTROL_TOKEN</key><string>$(escape_xml "$REMOTE_TOKEN")</string>"
fi

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.blackroom.content-agent</string>
  <key>ProgramArguments</key><array><string>${NPM_PATH}</string><string>run</string><string>blackroom:control</string></array>
  <key>WorkingDirectory</key><string>${PROJECT_DIR}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(escape_xml "$PATH")</string><key>BLACKROOM_NPM_PATH</key><string>$(escape_xml "$NPM_PATH")</string>${REMOTE_ENV_XML}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_DIR}/control.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/control.error.log</string>
</dict></plist>
PLIST

chmod 600 "$PLIST_PATH"

plutil -lint "$PLIST_PATH"
launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/com.blackroom.content-agent"
echo "BlackRoom local agent: http://127.0.0.1:5020/blackroom"
if [[ -z "$REMOTE_TOKEN" ]]; then
  echo "Replit control pending: set BLACKROOM_REMOTE_CONTROL_TOKEN and run this installer again."
else
  echo "Replit control connected: ${REMOTE_URL}/blackroom"
fi
