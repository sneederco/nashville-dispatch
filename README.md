# Nashville Police Dispatch Monitor

Polls the Metro Nashville Police Department Active Dispatch API and posts new incidents to a Discord channel via webhook.

## Setup

1. **Create a Discord webhook:**
   - Go to your Discord server
   - Server Settings → Integrations → Webhooks → New Webhook
   - Choose the channel you want incidents posted to
   - Copy the webhook URL

2. **Run the monitor:**
   ```bash
   DISCORD_WEBHOOK="https://discord.com/api/webhooks/..." node index.js
   ```

## Options

- `DISCORD_WEBHOOK` - Your Discord webhook URL (required)
- `POLL_INTERVAL` - Polling interval in ms (default: 60000 = 1 minute)

## API Source

- **Endpoint:** Nashville Open Data Portal
- **URL:** https://data.nashville.gov/datasets/Nashville::metro-nashville-police-department-active-dispatch
- **Updates:** Every ~15 minutes

## How It Works

1. On first run, loads all current active incidents (doesn't post them)
2. Polls the API every 60 seconds (configurable)
3. When new incidents appear, posts them to Discord with:
   - Incident type (e.g., "FIGHT/ASSAULT")
   - Location/address
   - Area/neighborhood
   - Time received
   - Color-coded by severity (red = violent, orange = property, etc.)

## Example Output

```
🚨 FIGHT/ASSAULT
📍 Location: 2600 8TH AVE S
🏙️ Area: BERRY HILL  
🕐 Time: 11:45 PM
Code: 57P
```
