const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'dispatch.db');
const db = new Database(DB_PATH);

// Helper to extract street name from location
function extractStreet(location) {
    if (!location) return null;
    // Handle intersection format: "STREET1 / STREET2"
    if (location.includes(' / ')) {
        return location.split(' / ')[0].replace(/^\d+\s*/, '').trim();
    }
    // Remove house number and return street
    return location.replace(/^\d+\s*/, '').trim();
}

// Helper to get hour (0-23) from timestamp in Central time
function getHour(timestamp) {
    const date = new Date(timestamp);
    // Convert to Central time and get hour
    return parseInt(date.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }));
}

// Initialize schema
db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id INTEGER NOT NULL,
        incident_code TEXT,
        incident_type TEXT NOT NULL,
        location TEXT,
        location_desc TEXT,
        city TEXT,
        call_received INTEGER NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        cleared INTEGER DEFAULT 0,
        cleared_at INTEGER,
        street TEXT,
        hour INTEGER,
        UNIQUE(object_id, call_received)
    );
    
    CREATE INDEX IF NOT EXISTS idx_call_received ON incidents(call_received);
    CREATE INDEX IF NOT EXISTS idx_incident_type ON incidents(incident_type);
    CREATE INDEX IF NOT EXISTS idx_city ON incidents(city);
    CREATE INDEX IF NOT EXISTS idx_cleared ON incidents(cleared);
    CREATE INDEX IF NOT EXISTS idx_street ON incidents(street);
    CREATE INDEX IF NOT EXISTS idx_hour ON incidents(hour);
`);

// Migration: add street and hour columns if they don't exist
try {
    db.exec(`ALTER TABLE incidents ADD COLUMN street TEXT`);
} catch (e) { /* column exists */ }
try {
    db.exec(`ALTER TABLE incidents ADD COLUMN hour INTEGER`);
} catch (e) { /* column exists */ }

// Backfill existing data
db.exec(`
    UPDATE incidents 
    SET street = TRIM(REPLACE(
        CASE 
            WHEN location LIKE '%/%' THEN SUBSTR(location, 1, INSTR(location, '/') - 2)
            ELSE location 
        END,
        SUBSTR(location, 1, INSTR(location || ' ', ' ')), ''
    ))
    WHERE street IS NULL AND location IS NOT NULL;
    
    UPDATE incidents 
    SET hour = CAST(strftime('%H', call_received / 1000, 'unixepoch', 'localtime') AS INTEGER)
    WHERE hour IS NULL;
`);

// Reports table for archiving weekly reports
db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        report_text TEXT NOT NULL,
        total_incidents INTEGER,
        violent_incidents INTEGER,
        top_streets TEXT,
        peak_hours TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(week_start)
    );
`);

// Prepared statements
const insertIncident = db.prepare(`
    INSERT OR IGNORE INTO incidents (object_id, incident_code, incident_type, location, location_desc, city, call_received, first_seen, last_seen, street, hour)
    VALUES (@objectId, @code, @type, @location, @locationDesc, @city, @callReceived, @now, @now, @street, @hour)
`);

const updateLastSeen = db.prepare(`
    UPDATE incidents SET last_seen = @now WHERE object_id = @objectId AND call_received = @callReceived AND cleared = 0
`);

const markCleared = db.prepare(`
    UPDATE incidents SET cleared = 1, cleared_at = @now WHERE object_id = @objectId AND call_received = @callReceived AND cleared = 0
`);

const getActiveIncidents = db.prepare(`
    SELECT * FROM incidents WHERE cleared = 0 ORDER BY call_received DESC
`);

const getRecentIncidents = db.prepare(`
    SELECT * FROM incidents WHERE call_received > @since ORDER BY call_received DESC LIMIT @limit
`);

const getStats = db.prepare(`
    SELECT 
        incident_type,
        COUNT(*) as count,
        AVG(CASE WHEN cleared = 1 THEN (cleared_at - call_received) / 60000.0 END) as avg_duration_min
    FROM incidents
    WHERE call_received > @since
    GROUP BY incident_type
    ORDER BY count DESC
    LIMIT 20
`);

const getDailyStats = db.prepare(`
    SELECT 
        date(call_received / 1000, 'unixepoch', 'localtime') as date,
        COUNT(*) as total,
        SUM(CASE WHEN incident_type LIKE '%ASSAULT%' OR incident_type LIKE '%SHOOT%' THEN 1 ELSE 0 END) as violent
    FROM incidents
    WHERE call_received > @since
    GROUP BY date
    ORDER BY date DESC
    LIMIT 30
`);

module.exports = {
    db,
    
    // Record an incident (insert or update last_seen)
    recordIncident(incident) {
        const now = Date.now();
        const params = {
            objectId: incident.ObjectId,
            code: incident.IncidentTypeCode,
            type: incident.IncidentTypeName,
            location: incident.Location,
            locationDesc: incident.LocationDescription,
            city: incident.CityName,
            callReceived: incident.CallReceivedTime,
            street: extractStreet(incident.Location),
            hour: getHour(incident.CallReceivedTime),
            now
        };
        
        insertIncident.run(params);
        updateLastSeen.run({ objectId: incident.ObjectId, callReceived: incident.CallReceivedTime, now });
    },
    
    // Mark incidents as cleared
    markCleared(objectIds) {
        const now = Date.now();
        for (const id of objectIds) {
            markCleared.run({ objectId: id, now });
        }
    },
    
    // Get all active (uncleared) incidents
    getActive() {
        return getActiveIncidents.all();
    },
    
    // Get recent incidents
    getRecent(hours = 24, limit = 100) {
        const since = Date.now() - (hours * 60 * 60 * 1000);
        return getRecentIncidents.all({ since, limit });
    },
    
    // Get incident type stats
    getTypeStats(hours = 24) {
        const since = Date.now() - (hours * 60 * 60 * 1000);
        return getStats.all({ since });
    },
    
    // Get daily totals
    getDailyStats(days = 30) {
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);
        return getDailyStats.all({ since });
    },
    
    // Total incident count
    getTotal() {
        return db.prepare('SELECT COUNT(*) as count FROM incidents').get().count;
    },
    
    // Get hotspot streets for violent crimes
    getViolentStreets(days = 30, limit = 20) {
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);
        return db.prepare(`
            SELECT street, city, COUNT(*) as count
            FROM incidents
            WHERE call_received > @since
              AND street IS NOT NULL
              AND (incident_type LIKE '%SHOOT%' 
                   OR incident_type LIKE '%ASSAULT%' 
                   OR incident_type LIKE '%FIGHT%'
                   OR incident_type LIKE '%ROBBERY%'
                   OR incident_type LIKE '%STAB%'
                   OR incident_type LIKE '%HOMICIDE%')
            GROUP BY street, city
            ORDER BY count DESC
            LIMIT @limit
        `).all({ since, limit });
    },
    
    // Get incidents by hour
    getHourlyStats(days = 30) {
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);
        return db.prepare(`
            SELECT 
                hour,
                COUNT(*) as total,
                SUM(CASE WHEN incident_type LIKE '%SHOOT%' OR incident_type LIKE '%ASSAULT%' OR incident_type LIKE '%FIGHT%' OR incident_type LIKE '%ROBBERY%' THEN 1 ELSE 0 END) as violent
            FROM incidents
            WHERE call_received > @since AND hour IS NOT NULL
            GROUP BY hour
            ORDER BY hour
        `).all({ since });
    },
    
    // Get violent crimes by hour
    getViolentByHour(days = 30) {
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);
        return db.prepare(`
            SELECT 
                hour,
                incident_type,
                COUNT(*) as count
            FROM incidents
            WHERE call_received > @since 
              AND hour IS NOT NULL
              AND (incident_type LIKE '%SHOOT%' 
                   OR incident_type LIKE '%ASSAULT%' 
                   OR incident_type LIKE '%FIGHT%'
                   OR incident_type LIKE '%ROBBERY%')
            GROUP BY hour, incident_type
            ORDER BY hour, count DESC
        `).all({ since });
    }
};
