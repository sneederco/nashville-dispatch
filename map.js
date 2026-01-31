#!/usr/bin/env node
/**
 * Nashville Dispatch Map Generator
 * Creates an HTML map of current incidents using Leaflet
 * Usage: node map.js [--output map.html]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services/Metro_Nashville_Police_Department_Active_Dispatch_Table_view/FeatureServer/0/query?where=1%3D1&outFields=*&f=json&resultRecordCount=100';

// Nashville center coords
const NASHVILLE_LAT = 36.1627;
const NASHVILLE_LNG = -86.7816;

// Simple geocoding via Nominatim (rate limited, so we cache)
const GEOCODE_CACHE_FILE = path.join(__dirname, '.geocode-cache.json');
let geocodeCache = {};

try {
    if (fs.existsSync(GEOCODE_CACHE_FILE)) {
        geocodeCache = JSON.parse(fs.readFileSync(GEOCODE_CACHE_FILE, 'utf8'));
    }
} catch (e) {}

function saveCache() {
    fs.writeFileSync(GEOCODE_CACHE_FILE, JSON.stringify(geocodeCache, null, 2));
}

function geocode(address) {
    return new Promise((resolve) => {
        if (!address) return resolve(null);
        
        const cacheKey = address.toLowerCase().trim();
        if (geocodeCache[cacheKey]) {
            return resolve(geocodeCache[cacheKey]);
        }
        
        const query = encodeURIComponent(`${address}, Nashville, TN`);
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${query}&limit=1`;
        
        https.get(url, { headers: { 'User-Agent': 'NashvilleDispatchMonitor/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const results = JSON.parse(data);
                    if (results.length > 0) {
                        const coords = { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
                        geocodeCache[cacheKey] = coords;
                        saveCache();
                        resolve(coords);
                    } else {
                        resolve(null);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        }).on('error', () => resolve(null));
    });
}

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

function getMarkerColor(code, name) {
    const c = (code + ' ' + name).toUpperCase();
    if (c.includes('SHOOT') || c.includes('STAB') || c.includes('HOMICIDE')) return 'red';
    if (c.includes('ASSAULT') || c.includes('FIGHT') || c.includes('DOMESTIC')) return 'red';
    if (c.includes('ROBBERY') || c.includes('CARJACK')) return 'orange';
    if (c.includes('BURGLARY') || c.includes('THEFT')) return 'yellow';
    if (c.includes('ACCIDENT') || c.includes('CRASH')) return 'blue';
    if (c.includes('FIRE')) return 'red';
    if (c.includes('MEDICAL') || c.includes('OVERDOSE')) return 'green';
    return 'gray';
}

function generateHTML(incidents) {
    const markers = incidents
        .filter(i => i.coords)
        .map(i => {
            const time = new Date(i.CallReceivedTime).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' });
            const color = getMarkerColor(i.IncidentTypeCode, i.IncidentTypeName);
            return `
        L.circleMarker([${i.coords.lat}, ${i.coords.lng}], {
            radius: 10,
            fillColor: '${color}',
            color: '#000',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map).bindPopup('<b>${i.IncidentTypeName}</b><br>${i.Location || 'Unknown'}<br><small>${time}</small>');`;
        }).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
    <title>Nashville Active Dispatch Map</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        body { margin: 0; padding: 0; }
        #map { position: absolute; top: 0; bottom: 0; width: 100%; }
        .legend { padding: 10px; background: white; border-radius: 5px; }
        .legend h4 { margin: 0 0 10px 0; }
        .legend-item { display: flex; align-items: center; margin: 5px 0; }
        .legend-color { width: 20px; height: 20px; border-radius: 50%; margin-right: 8px; border: 1px solid #000; }
    </style>
</head>
<body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        var map = L.map('map').setView([${NASHVILLE_LAT}, ${NASHVILLE_LNG}], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        
        ${markers}
        
        // Legend
        var legend = L.control({position: 'bottomright'});
        legend.onAdd = function(map) {
            var div = L.DomUtil.create('div', 'legend');
            div.innerHTML = '<h4>🚔 Active Dispatch</h4>' +
                '<div class="legend-item"><div class="legend-color" style="background:red"></div>Violent</div>' +
                '<div class="legend-item"><div class="legend-color" style="background:orange"></div>Robbery</div>' +
                '<div class="legend-item"><div class="legend-color" style="background:yellow"></div>Property</div>' +
                '<div class="legend-item"><div class="legend-color" style="background:blue"></div>Traffic</div>' +
                '<div class="legend-item"><div class="legend-color" style="background:green"></div>Medical</div>' +
                '<div class="legend-item"><div class="legend-color" style="background:gray"></div>Other</div>' +
                '<br><small>Updated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}</small>';
            return div;
        };
        legend.addTo(map);
    </script>
</body>
</html>`;
}

async function main() {
    const args = process.argv.slice(2);
    const outputArg = args.find(a => a.startsWith('--output='));
    const outputFile = outputArg ? outputArg.split('=')[1] : path.join(__dirname, 'map.html');
    
    console.log('Fetching active dispatch...');
    const data = await fetchDispatch();
    const incidents = data.features?.map(f => f.attributes) || [];
    
    console.log(`Found ${incidents.length} active incidents`);
    console.log('Geocoding addresses (this may take a moment)...');
    
    // Geocode each incident (with rate limiting)
    for (let i = 0; i < incidents.length; i++) {
        const incident = incidents[i];
        incident.coords = await geocode(incident.Location);
        
        // Rate limit to 1 request per second for Nominatim
        if (!geocodeCache[incident.Location?.toLowerCase().trim()]) {
            await new Promise(r => setTimeout(r, 1100));
        }
        
        process.stdout.write(`\rGeocoded ${i + 1}/${incidents.length}`);
    }
    console.log('\n');
    
    const geocoded = incidents.filter(i => i.coords).length;
    console.log(`Successfully geocoded ${geocoded}/${incidents.length} addresses`);
    
    const html = generateHTML(incidents);
    fs.writeFileSync(outputFile, html);
    console.log(`Map saved to: ${outputFile}`);
    console.log(`Open in browser: file://${path.resolve(outputFile)}`);
}

main().catch(console.error);
