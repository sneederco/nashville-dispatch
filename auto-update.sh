#!/bin/bash
# Nashville Dispatch Auto-Updater
# Runs via system crontab, updates Discord directly via clawdbot CLI

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHANNEL_ID="1467570188391157902"
MESSAGE_ID="1467570243282014209"
LOG_FILE="$SCRIPT_DIR/auto-update.log"

# Get the formatted dispatch output
OUTPUT=$(node "$SCRIPT_DIR/dispatch-monitor.js" 2>/dev/null)

if [ -z "$OUTPUT" ]; then
    echo "$(date): ERROR - No output from dispatch-monitor.js" >> "$LOG_FILE"
    exit 1
fi

# Update Discord message via openclaw CLI
RESULT=$(/opt/homebrew/bin/openclaw message edit \
    --channel discord \
    --target "$CHANNEL_ID" \
    --message-id "$MESSAGE_ID" \
    --message "$OUTPUT" 2>&1)

if echo "$RESULT" | grep -q "edit via Discord"; then
    echo "$(date '+%Y-%m-%d %H:%M:%S'): OK" >> "$LOG_FILE"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S'): FAILED - $RESULT" >> "$LOG_FILE"
fi

# Keep log file small (last 100 lines)
tail -100 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
