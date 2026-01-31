#!/usr/bin/env node
/**
 * Nashville Dispatch Statistics
 * Usage: node stats.js [--json] [--hours N] [--daily]
 */

const db = require('./db');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const hoursArg = args.find(a => a.startsWith('--hours='));
const hours = hoursArg ? parseInt(hoursArg.split('=')[1]) : 24;
const showDaily = args.includes('--daily');

if (showDaily) {
    const daily = db.getDailyStats(30);
    
    if (jsonOutput) {
        console.log(JSON.stringify(daily, null, 2));
    } else {
        console.log('# 📊 Nashville Dispatch - Daily Stats (Last 30 Days)\n');
        console.log('| Date       | Total | Violent |');
        console.log('|------------|-------|---------|');
        for (const day of daily) {
            console.log(`| ${day.date} | ${day.total.toString().padStart(5)} | ${day.violent.toString().padStart(7)} |`);
        }
    }
} else {
    const typeStats = db.getTypeStats(hours);
    const total = db.getTotal();
    
    if (jsonOutput) {
        console.log(JSON.stringify({ total, hours, types: typeStats }, null, 2));
    } else {
        console.log(`# 📊 Nashville Dispatch Stats (Last ${hours}h)\n`);
        console.log(`**Total incidents recorded:** ${total}\n`);
        console.log('## Top Incident Types\n');
        
        for (const stat of typeStats) {
            const duration = stat.avg_duration_min ? ` (~${Math.round(stat.avg_duration_min)} min avg)` : '';
            console.log(`- **${stat.incident_type}**: ${stat.count}${duration}`);
        }
    }
}
