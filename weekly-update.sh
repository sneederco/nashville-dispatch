#!/bin/bash
# Nashville Dispatch Weekly Report Updater
# Runs every Sunday via launchd

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHANNEL_ID="1467570188391157902"
REPORT_MESSAGE_ID="1467570977721417729"
LOG_FILE="$SCRIPT_DIR/weekly-update.log"

# Generate the report
OUTPUT=$(node "$SCRIPT_DIR/weekly-report.js" 2>/dev/null)

if [ -z "$OUTPUT" ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S'): ERROR - No output from weekly-report.js" >> "$LOG_FILE"
    exit 1
fi

# Update Discord message via openclaw CLI
RESULT=$(/opt/homebrew/bin/openclaw message edit \
    --channel discord \
    --target "$CHANNEL_ID" \
    --message-id "$REPORT_MESSAGE_ID" \
    --message "$OUTPUT" 2>&1)

if echo "$RESULT" | grep -q "edit via Discord"; then
    echo "$(date '+%Y-%m-%d %H:%M:%S'): Weekly report updated" >> "$LOG_FILE"
else
    echo "$(date '+%Y-%m-%d %H:%M:%S'): FAILED - $RESULT" >> "$LOG_FILE"
fi

# Keep log file small
tail -50 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
