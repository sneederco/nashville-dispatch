const https = require('https');
const { Client, GatewayIntentBits } = require('discord.js');

// Nashville Police Active Dispatch API
const API_URL = 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Active_Dispatch_Table_view/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=100';

// Config
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN';
const CHANNEL_ID = process.env.CHANNEL_ID || '1464857422605713525'; // Channel to create thread in
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL) || 60000; // 1 minute

let client;
let dispatchThread = null;
let statusMessageId = null;
let lastIncidentHash = '';

function fetchDispatch() {
    return new Promise((resolve, reject) => {
        https.get(API_URL, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function formatIncident(incident) {
    const time = new Date(incident.CallReceivedTime).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
    
    const emoji = getEmojiForIncident(incident.IncidentTypeCode);
    return `${emoji} **${incident.IncidentTypeName}**\n   📍 ${incident.Location || 'Unknown'}${incident.CityName ? ` (${incident.CityName})` : ''}\n   🕐 ${time}`;
}

function getEmojiForIncident(code) {
    if (code.startsWith('57') || code.includes('ASSAULT') || code.includes('FIGHT')) return '🔴';
    if (code.startsWith('59') || code.includes('SHOOT') || code.includes('STAB')) return '🔴';
    if (code.includes('ROBBERY') || code.includes('THEFT')) return '🟠';
    if (code.startsWith('71') || code.includes('ALARM')) return '🟡';
    if (code.startsWith('52') || code.includes('ACCIDENT') || code.includes('CRASH')) return '🚗';
    if (code.includes('FIRE')) return '🔥';
    if (code.includes('MEDICAL') || code.includes('EMS')) return '🚑';
    if (code.includes('SUSPICIOUS')) return '👀';
    return '📋';
}

function buildStatusMessage(incidents) {
    if (!incidents || incidents.length === 0) {
        return '✅ **No active incidents**\n\n_Last updated: ' + new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) + '_';
    }
    
    // Sort by time (newest first)
    incidents.sort((a, b) => b.CallReceivedTime - a.CallReceivedTime);
    
    let message = `# 🚔 Nashville Active Dispatch\n**${incidents.length} active incident${incidents.length !== 1 ? 's' : ''}**\n\n`;
    
    for (const incident of incidents.slice(0, 20)) { // Limit to 20 to fit in message
        message += formatIncident(incident) + '\n\n';
    }
    
    if (incidents.length > 20) {
        message += `_...and ${incidents.length - 20} more_\n\n`;
    }
    
    message += `---\n_Last updated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}_\n_Data from: Nashville Open Data Portal_`;
    
    return message;
}

async function findOrCreateThread(channel) {
    // Look for existing thread
    const threads = await channel.threads.fetchActive();
    const existing = threads.threads.find(t => t.name === '🚨 Active Dispatch');
    
    if (existing) {
        console.log('Found existing dispatch thread');
        return existing;
    }
    
    // Create new thread
    console.log('Creating new dispatch thread...');
    const thread = await channel.threads.create({
        name: '🚨 Active Dispatch',
        autoArchiveDuration: 1440, // 24 hours
        reason: 'Nashville Police Active Dispatch Monitor'
    });
    
    return thread;
}

async function updateDispatch() {
    try {
        console.log(`[${new Date().toLocaleTimeString()}] Polling...`);
        const data = await fetchDispatch();
        
        const incidents = data.features?.map(f => f.attributes) || [];
        const currentHash = JSON.stringify(incidents.map(i => i.ObjectId).sort());
        
        // Skip if no changes
        if (currentHash === lastIncidentHash) {
            console.log('No changes');
            return;
        }
        
        lastIncidentHash = currentHash;
        const message = buildStatusMessage(incidents);
        
        if (!dispatchThread) {
            const channel = await client.channels.fetch(CHANNEL_ID);
            dispatchThread = await findOrCreateThread(channel);
        }
        
        // Update or create status message
        if (statusMessageId) {
            try {
                const msg = await dispatchThread.messages.fetch(statusMessageId);
                await msg.edit(message);
                console.log(`Updated: ${incidents.length} incidents`);
            } catch (e) {
                // Message was deleted, create new one
                statusMessageId = null;
            }
        }
        
        if (!statusMessageId) {
            const msg = await dispatchThread.send(message);
            statusMessageId = msg.id;
            console.log(`Created status message: ${incidents.length} incidents`);
        }
        
    } catch (err) {
        console.error('Update error:', err.message);
    }
}

// Main
async function main() {
    console.log('Nashville Police Dispatch Monitor v2');
    console.log(`Channel: ${CHANNEL_ID}`);
    console.log(`Poll interval: ${POLL_INTERVAL / 1000}s`);
    console.log('---');
    
    if (BOT_TOKEN === 'YOUR_BOT_TOKEN') {
        console.log('\n⚠️  Bot token not configured!');
        console.log('Run with: BOT_TOKEN="your_token" node index.js\n');
        process.exit(1);
    }
    
    client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    });
    
    client.once('ready', async () => {
        console.log(`Logged in as ${client.user.tag}`);
        
        // Initial update
        await updateDispatch();
        
        // Poll periodically
        setInterval(updateDispatch, POLL_INTERVAL);
    });
    
    client.login(BOT_TOKEN);
}

main();
