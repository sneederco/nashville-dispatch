#!/usr/bin/env node
/**
 * Nashville Dispatch Weekly Report Generator
 * Generates analysis report and optionally updates Discord
 */

const db = require('./db');

// Config
const THREAD_ID = '1464889997361545271';
const REPORT_MESSAGE_ID = process.env.REPORT_MESSAGE_ID; // Set after first send

function generateReport(days = 7) {
    const since = Date.now() - (days * 24 * 60 * 60 * 1000);
    const now = new Date();
    const weekStart = new Date(since).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
    const weekEnd = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
    
    // Get total stats
    const totalStats = db.db.prepare(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN incident_type IN ('SHOTS FIRED', 'FIGHT/ASSAULT') 
                OR incident_type LIKE '%ROBBERY%' 
                OR incident_type LIKE '%STAB%' 
                OR incident_type LIKE '%HOMICIDE%' THEN 1 ELSE 0 END) as violent
        FROM incidents 
        WHERE call_received > ?
    `).get(since);
    
    // Top incident types
    const topTypes = db.db.prepare(`
        SELECT incident_type, COUNT(*) as count
        FROM incidents 
        WHERE call_received > ?
        GROUP BY incident_type
        ORDER BY count DESC
        LIMIT 10
    `).all(since);
    
    // Violent crime hotspots
    const hotspots = db.getViolentStreets(days, 10);
    
    // Hourly distribution for violent crimes
    const hourlyViolent = db.db.prepare(`
        SELECT hour, COUNT(*) as count
        FROM incidents 
        WHERE call_received > ? 
          AND hour IS NOT NULL
          AND (incident_type IN ('SHOTS FIRED', 'FIGHT/ASSAULT') 
               OR incident_type LIKE '%ROBBERY%')
        GROUP BY hour
        ORDER BY count DESC
        LIMIT 5
    `).all(since);
    
    // Areas with most activity
    const topAreas = db.db.prepare(`
        SELECT city, COUNT(*) as count,
            SUM(CASE WHEN incident_type IN ('SHOTS FIRED', 'FIGHT/ASSAULT') 
                OR incident_type LIKE '%ROBBERY%' THEN 1 ELSE 0 END) as violent
        FROM incidents 
        WHERE call_received > ? AND city IS NOT NULL AND city != ''
        GROUP BY city
        ORDER BY violent DESC, count DESC
        LIMIT 10
    `).all(since);
    
    // Format report
    let report = [];
    report.push(`# 📊 Nashville Dispatch Weekly Report`);
    report.push(`**${weekStart} — ${weekEnd}**\n`);
    
    report.push(`## Overview`);
    report.push(`- **Total Incidents:** ${totalStats.total.toLocaleString()}`);
    report.push(`- **Violent Crimes:** ${totalStats.violent} (${(totalStats.violent / totalStats.total * 100).toFixed(1)}%)\n`);
    
    // Top incident types (exclude storm damage if it dominates)
    report.push(`## Top Incident Types`);
    const stormTypes = ['WIRES DOWN', 'TREE DOWN', 'SAFETY HAZARD-BOTH TREES AND WIRES'];
    const nonStormTypes = topTypes.filter(t => !stormTypes.includes(t.incident_type)).slice(0, 5);
    const stormCount = topTypes.filter(t => stormTypes.includes(t.incident_type)).reduce((sum, t) => sum + t.count, 0);
    
    if (stormCount > 0) {
        report.push(`- Storm/Weather: ${stormCount}`);
    }
    for (const t of nonStormTypes) {
        report.push(`- ${t.incident_type}: ${t.count}`);
    }
    report.push('');
    
    // Violent crime hotspots
    if (hotspots.length > 0) {
        report.push(`## 🔥 Violent Crime Hotspots`);
        for (const h of hotspots.slice(0, 5)) {
            report.push(`- **${h.street}** (${h.city || 'Unknown'}): ${h.count}`);
        }
        report.push('');
    }
    
    // Peak hours
    if (hourlyViolent.length > 0) {
        report.push(`## ⏰ Peak Hours (Violent Crime)`);
        for (const h of hourlyViolent) {
            const hour12 = h.hour === 0 ? '12 AM' : h.hour < 12 ? `${h.hour} AM` : h.hour === 12 ? '12 PM' : `${h.hour - 12} PM`;
            report.push(`- ${hour12}: ${h.count} incidents`);
        }
        report.push('');
    }
    
    // Areas breakdown
    report.push(`## 📍 Areas by Violent Crime`);
    for (const a of topAreas.filter(a => a.violent > 0).slice(0, 5)) {
        report.push(`- **${a.city}**: ${a.violent} violent / ${a.count} total`);
    }
    report.push('');
    
    // Footer
    const generated = now.toLocaleString('en-US', { 
        month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
        timeZone: 'America/Chicago'
    });
    report.push(`---`);
    report.push(`_Generated: ${generated} CT | Data: Nashville Open Data Portal_`);
    
    const reportText = report.join('\n');
    
    // Archive to database
    const insertReport = db.db.prepare(`
        INSERT OR REPLACE INTO reports (week_start, week_end, report_text, total_incidents, violent_incidents, top_streets, peak_hours, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertReport.run(
        weekStart,
        weekEnd,
        reportText,
        totalStats.total,
        totalStats.violent,
        JSON.stringify(hotspots.slice(0, 5)),
        JSON.stringify(hourlyViolent),
        Date.now()
    );
    
    return reportText;
}

// Run if called directly
if (require.main === module) {
    const report = generateReport(7);
    console.log(report);
}

module.exports = { generateReport };
