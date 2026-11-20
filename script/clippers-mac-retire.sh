#!/bin/zsh
# Mac retirement for the Clippers LaunchAgents (docs/clippers-cloud-lanes.md, "Mac retirement").
#
#   zsh script/clippers-mac-retire.sh seed            # 1. copy the Mac workspace to Drive + Postgres (once)
#   (dispatch "Clippers cloud lanes" dry runs in Actions for owned_content and marketplace)
#   zsh script/clippers-mac-retire.sh retire [lanes]  # 2. needs cloud QA, marks lanes retired, unloads the agents
#   zsh script/clippers-mac-retire.sh restore [lanes] --cloud-paused  # rollback (after CLIPPERS_CLOUD_LANES_ENABLED=false):
#                                                    # the Mac takes the leases and the agents are loaded again
#
# lanes: comma list of content,youtube_delivery,marketplace,watchdog (default: all four). FORCE=1 skips the cloud
# QA check (owner decision). Retirement is recorded in Postgres first, so even an agent that is still loaded
# refuses to run (Mac gate) and the cloud may take the lane at once: no double posting.
set -euo pipefail
umask 077

ACTION="${1:-}"
LANES="${2:-content,youtube_delivery,marketplace,watchdog}"
[[ "$LANES" == "--cloud-paused" ]] && { LANES="content,youtube_delivery,marketplace,watchdog"; CLOUD_PAUSED=1; }
AGENTS_DIR="$HOME/Library/LaunchAgents"
# Defaults come from the installed content-worker agent (the same values the Mac jobs run with).
plist_env() { /usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$1" "$AGENTS_DIR/com.blackops.clippers-content-worker.plist" 2>/dev/null || true; }
ROOT="${CLIPPERS_RUNTIME_ROOT:-${0:A:h:h}}"
CONFIG_ROOT="${CLIPPERS_CONFIG_ROOT:-$(plist_env CLIPPERS_CONFIG_ROOT)}"
WORKSPACE="${CLIPPERS_WORKSPACE_ROOT:-$(plist_env CLIPPERS_WORKSPACE_ROOT)}"
[[ -n "$CONFIG_ROOT" && -n "$WORKSPACE" ]] || { print -u2 "Set CLIPPERS_CONFIG_ROOT and CLIPPERS_WORKSPACE_ROOT (agent not installed here)."; exit 2; }
WORKSPACE="${WORKSPACE:A}"
case "$WORKSPACE" in
  /|"${HOME:A}"|"${HOME:A}/Library"|"${HOME:A}/Library/"*) print -u2 "Refused: workspace $WORKSPACE is not a Clippers workspace."; exit 2 ;;
esac
[[ -f "$WORKSPACE/config/clippers-content-worker.json" ]] || { print -u2 "Refused: $WORKSPACE/config/clippers-content-worker.json is missing."; exit 2; }
RETIRED_DIR="$AGENTS_DIR/retired-clippers"
NODE="${CLIPPERS_NODE_PATH:-$(command -v node)}"
typeset -A LABELS
LABELS=(content com.blackops.clippers-content-worker youtube_delivery com.blackops.clippers-youtube-delivery-worker \
  marketplace com.blackops.clippers-free-worker watchdog com.blackops.clippers-daily-watchdog)

export CLIPPERS_CONFIG_ROOT="$CONFIG_ROOT"
lanes=("${(@s:,:)LANES}")
for lane in "${lanes[@]}"; do [[ -n "${LABELS[$lane]:-}" ]] || { print -u2 "Unknown lane: $lane"; exit 2; }; done

case "$ACTION" in
  seed)
    "$NODE" "$ROOT/script/clippers-cloud-lanes.mjs" --seed-workspace "$WORKSPACE" \
      ${CLIPPERS_CONTENT_WORKER_CONFIG:+--content-config "$CLIPPERS_CONTENT_WORKER_CONFIG"} \
      ${CLIPPERS_YOUTUBE_DELIVERY_CONFIG:+--delivery-config "$CLIPPERS_YOUTUBE_DELIVERY_CONFIG"}
    ;;
  retire)
    extra=()
    [[ "${FORCE:-0}" == "1" ]] && extra=(--force)
    "$NODE" "$ROOT/script/clippers-cloud-lanes.mjs" --retire-mac "$LANES" "${extra[@]}" || {
      print -u2 "Not retired: cloud QA missing (run the Actions dry runs first, or FORCE=1)."; exit 3; }
    mkdir -p "$RETIRED_DIR"
    for lane in "${lanes[@]}"; do
      label="${LABELS[$lane]}"
      launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
      [[ -f "$AGENTS_DIR/$label.plist" ]] && mv "$AGENTS_DIR/$label.plist" "$RETIRED_DIR/$label.plist"
      print "retired $lane ($label)"
    done
    ;;
  restore)
    [[ "${3:-}" == "--cloud-paused" || "${CLOUD_PAUSED:-0}" == "1" ]] || {
      print -u2 "Refused: set the repository variable CLIPPERS_CLOUD_LANES_ENABLED=false first, then run: restore [lanes] --cloud-paused"; exit 3; }
    "$NODE" "$ROOT/script/clippers-cloud-lanes.mjs" --unretire-mac "$LANES" --cloud-paused
    for lane in "${lanes[@]}"; do
      label="${LABELS[$lane]}"
      if [[ -f "$RETIRED_DIR/$label.plist" ]]; then
        mv "$RETIRED_DIR/$label.plist" "$AGENTS_DIR/$label.plist"
        launchctl bootstrap "gui/$(id -u)" "$AGENTS_DIR/$label.plist" 2>/dev/null || true
      fi
      print "restored $lane ($label)"
    done
    ;;
  *)
    print -u2 "Usage: zsh script/clippers-mac-retire.sh seed | retire [lanes] | restore [lanes] --cloud-paused"; exit 2 ;;
esac
