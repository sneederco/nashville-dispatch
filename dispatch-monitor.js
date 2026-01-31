#!/usr/bin/env node
/**
 * Nashville Police Dispatch Monitor
 * 
 * This script polls the Nashville PD Active Dispatch API and outputs
 * formatted updates. Designed to be called periodically by Clawdbot cron.
 * 
 * Usage: node dispatch-monitor.js [--json] [--diff previous.json]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Active_Dispatch_Table_view/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=100';
const STATE_FILE = path.join(__dirname, '.dispatch-state.json');

// Database for historical tracking
let db;
try {
    db = require('./db');
} catch (e) {
    // DB not available, continue without persistence
}

// Output mode: 'changes' (only when incidents change) or 'always' (every poll)
const OUTPUT_MODE = process.env.OUTPUT_MODE || 'always';

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

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (e) {}
    return { incidents: {}, lastUpdate: null };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getEmoji(code, name) {
    const c = (code + ' ' + name).toUpperCase();
    if (c.includes('SHOOT') || c.includes('STAB') || c.includes('HOMICIDE')) return '🔴';
    if (c.includes('ASSAULT') || c.includes('FIGHT') || c.includes('DOMESTIC')) return '🔴';
    if (c.includes('ROBBERY') || c.includes('CARJACK')) return '🟠';
    if (c.includes('BURGLARY') || c.includes('THEFT') || c.includes('STEALING')) return '🟡';
    if (c.includes('ALARM')) return '🔔';
    if (c.includes('ACCIDENT') || c.includes('CRASH') || c.includes('HIT AND RUN')) return '🚗';
    if (c.includes('FIRE')) return '🔥';
    if (c.includes('MEDICAL') || c.includes('OVERDOSE') || c.includes('UNCONSCIOUS')) return '🚑';
    if (c.includes('SUSPICIOUS')) return '👀';
    if (c.includes('MISSING') || c.includes('WELFARE')) return '🔍';
    return '📋';
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

function formatIncidentShort(inc) {
    const emoji = getEmoji(inc.IncidentTypeCode, inc.IncidentTypeName);
    const time = formatTime(inc.CallReceivedTime);
    return `${emoji} **${inc.IncidentTypeName}** - ${inc.Location || 'Unknown'}${inc.CityName ? ` (${inc.CityName})` : ''} @ ${time}`;
}

async function main() {
    const args = process.argv.slice(2);
    const jsonOutput = args.includes('--json');
    
    try {
        const data = await fetchDispatch();
        const incidents = data.features?.map(f => f.attributes) || [];
        const state = loadState();
        
        // Build current incident map
        const currentIds = new Set(incidents.map(i => i.ObjectId));
        const previousIds = new Set(Object.keys(state.incidents).map(Number));
        
        // Find new and cleared incidents
        const newIncidents = incidents.filter(i => !previousIds.has(i.ObjectId));
        const clearedIds = [...previousIds].filter(id => !currentIds.has(id));
        const clearedIncidents = clearedIds.map(id => state.incidents[id]).filter(Boolean);
        
        // Update state
        const newState = {
            incidents: {},
            lastUpdate: Date.now()
        };
        incidents.forEach(i => { newState.incidents[i.ObjectId] = i; });
        saveState(newState);
        
        // Store in database for historical tracking
        if (db) {
            try {
                // Record all current incidents
                for (const incident of incidents) {
                    db.recordIncident(incident);
                }
                // Mark cleared incidents
                if (clearedIds.length > 0) {
                    db.markCleared(clearedIds);
                }
            } catch (e) {
                console.error('DB error:', e.message);
            }
        }
        
        if (jsonOutput) {
            console.log(JSON.stringify({
                total: incidents.length,
                new: newIncidents,
                cleared: clearedIncidents,
                all: incidents
            }, null, 2));
            return;
        }
        
        // Human readable output
        const isFirstRun = state.lastUpdate === null;
        const noChanges = newIncidents.length === 0 && clearedIncidents.length === 0;
        const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        
        // Sort by time, newest first
        incidents.sort((a, b) => b.CallReceivedTime - a.CallReceivedTime);
        
        if (OUTPUT_MODE === 'always' || isFirstRun) {
            // Full status output (for editing a pinned message)
            // Discord has 2000 char limit - fit as many incidents as possible
            const DISCORD_LIMIT = 2000;
            const header = `# 🚔 Nashville Active Dispatch\n**${incidents.length} active incident${incidents.length !== 1 ? 's' : ''}**\n\n`;
            const footer = `\n---\n_Last polled: ${timestamp} CT_\n_Updates every 2 minutes | Data: Nashville Open Data Portal_`;
            
            let output = [];
            let charCount = header.length + footer.length;
            let shown = 0;
            
            if (incidents.length === 0) {
                output.push('_No active incidents right now_ ✅');
            } else {
                for (const inc of incidents) {
                    const line = formatIncidentShort(inc);
                    const lineWithNewline = line + '\n';
                    // Reserve space for "...and X more" line (~30 chars)
                    if (charCount + lineWithNewline.length + 30 < DISCORD_LIMIT) {
                        output.push(line);
                        charCount += lineWithNewline.length;
                        shown++;
                    } else {
                        break;
                    }
                }
                
                if (shown < incidents.length) {
                    output.push(`\n_...and ${incidents.length - shown} more_`);
                }
            }
            
            console.log(header + output.join('\n') + footer);
        } else {
            // Changes-only mode
            if (noChanges) {
                console.log('NO_CHANGES');
                return;
            }
            
            let output = [];
            
            if (newIncidents.length > 0) {
                output.push(`**🆕 ${newIncidents.length} New:**`);
                for (const inc of newIncidents) {
                    output.push(formatIncidentShort(inc));
                }
            }
            
            if (clearedIncidents.length > 0) {
                if (output.length > 0) output.push('');
                output.push(`**✅ ${clearedIncidents.length} Cleared:**`);
                for (const inc of clearedIncidents) {
                    output.push(`~~${inc.IncidentTypeName} - ${inc.Location || 'Unknown'}~~`);
                }
            }
            
            output.push(`\n_Active: ${incidents.length} | Last polled: ${timestamp} CT_`);
            console.log(output.join('\n'));
        }
        
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

main();
