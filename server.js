/**
 * HALLE//OS: Werkstatt- und Hallen-Management
 * ============================================================
 * Start:   npm install && npm start   ->  http://localhost:3000
 * VPS:     PORT=8080 HOST=0.0.0.0 npm start  (z. B. hinter nginx / pm2)
 *
 * Umgebungsvariablen:
 *   PORT        (Standard 3000)
 *   HOST        (Standard 0.0.0.0)
 *   DATA_DIR    (Standard ./data: Datenbank, Uploads, Backups)
 *   HALLE_TZ    (Standard Europe/Berlin: für "heute" im Deadline-Algorithmus)
 *   TRUST_PROXY (z. B. "loopback", wenn hinter nginx; für korrekte IP + Secure-Cookies)
 *   GEMINI_API_KEY (v4.1, optional: KI-Serienmaße; am einfachsten in der Datei .env)
 *
 * Aufbau:
 *   server/db.js            Schema, Migrationen, Initialdaten
 *   server/auth.js          Sessions, Rollen (gast < schrauber < admin)
 *   server/lib/*            Packliste, Whiteboard-Algorithmus, CSV-Parser, Helfer
 *   server/routes/*         REST-API je Modul
 *   server/devices/*        Treiber für smarte Steckdosen/Heizungen/Webcams
 *   v2: routes/tyres.js (Reifenlager), routes/chill.js (Kühlschrank-Radar, Setups, LED-Ticker)
 *   v3: routes/fleet.js (Modelle, Anhänger, Gespann-Rechner), routes/tv.js (Hallen-TV unter /tv und /dashboard)
 *   v4: routes/hub.js (Schnell-Verbrauch, kritische Ressourcen, Einkaufsliste, Schwebe-Status)
 *   v4.1: routes/dimensions.js (Serienmaße via Gemini, Schlüssel GEMINI_API_KEY aus .env)
 *   public/                 Frontend (Tailwind CDN + Vanilla JS Module + Canvas)
 */
const path = require('path');
const fs = require('fs');

/* v4.1: Datei .env im Projektordner einlesen (z. B. GEMINI_API_KEY), ohne Zusatzpaket.
   Bereits gesetzte Umgebungsvariablen haben Vorrang. */
(function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
})();

const express = require('express');
const { UPLOAD_DIR } = require('./server/db');
const { authenticate, guard, requireRole } = require('./server/auth');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

app.use(express.json({ limit: '5mb' }));
// v3: Hallen-TV (Kiosk) unter /tv und /dashboard
app.get(['/tv', '/dashboard'], (_req, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ---------------- REST-API ---------------- */
app.use('/api', authenticate, guard);
app.use('/api/auth', require('./server/routes/auth'));
app.use('/api', require('./server/routes/core'));            // meta, bootstrap, layout, search
app.use('/api/vehicles', require('./server/routes/vehicles'));
app.use('/api', require('./server/routes/workshop'));        // tasks, log, purchases, work, whiteboard
app.use('/api/events', require('./server/routes/events'));
app.use('/api', require('./server/routes/inventory'));       // parts, tools, boxes, shelves
app.use('/api', require('./server/routes/admin'));           // admin/*, quickchecks
app.use('/api/blueprint', require('./server/routes/blueprint'));
app.use('/api/devices', require('./server/routes/devices'));
app.use('/api', require('./server/routes/tyres'));           // v2: Drift-Tyre Hub
app.use('/api', require('./server/routes/chill'));           // v2: Vorräte, Setups, LED-Ticker
app.use('/api', require('./server/routes/fleet'));           // v3: Fahrzeugmodelle, Anhänger, Beladung
app.use('/api', require('./server/routes/tv'));              // v3: Hallen-TV / Dashboard
app.use('/api', require('./server/routes/hub'));             // v4: Schnell-Verbrauch, kritische Ressourcen, Schwebe-Status
app.use('/api', require('./server/routes/dimensions'));      // v4.1: KI-Serienmaße via Gemini
// Platz für künftige Module, z. B.:
// app.use('/api/cams', require('./server/routes/cams'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unbekannter API-Endpunkt.' }));

/* ---------------- Geschützte Uploads ---------------- */
app.get('/files/:name', authenticate, requireRole('gast'), (req, res) => {
  const name = path.basename(req.params.name);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(UPLOAD_DIR, name), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Datei nicht gefunden.' });
  });
});

/* ---------------- Fehlerbehandlung ---------------- */
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Serverfehler';
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = 'Datei ist zu groß.'; }
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') { status = 400; message = 'Verknüpfter Eintrag existiert nicht.'; }
  if (err.type === 'entity.parse.failed') { status = 400; message = 'Ungültiges JSON.'; }
  if (status >= 500) console.error('[fehler]', err);
  res.status(status).json({ error: message });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  HALLE//OS läuft:  http://localhost:${PORT}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = app;
