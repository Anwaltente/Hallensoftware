#!/usr/bin/env node
/**
 * HALLE//OS: Turso-Datenbank als normale SQLite-Datei sichern
 *   npm run turso:backup                 -> data/backups/turso-<Zeitstempel>.db
 *   npm run turso:backup -- meine.db     -> eigene Zieldatei
 * Liest nur, ändert nichts in Turso. Die Datei lässt sich mit jedem SQLite-Programm öffnen
 * und notfalls per "npm run turso:import -- datei.db --ersetzen" zurückspielen.
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
(function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
})();

const { tursoConfig } = require('../server/lib/turso/config');
const { TursoDatabase, dumpToFile } = require('../server/lib/turso/database');

const cfg = tursoConfig();
if (!cfg) { console.error('Keine Turso-Adresse gefunden (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN in .env).'); process.exit(1); }
const dir = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'backups');
fs.mkdirSync(dir, { recursive: true });
const target = path.resolve(process.argv[2] || path.join(dir, `turso-${new Date().toISOString().replace(/[:.]/g, '-')}.db`));
try {
  const tdb = new TursoDatabase({ url: cfg.url, token: cfg.token, timeoutMs: 60000, replica: false });
  dumpToFile(tdb, target);
  tdb.close();
  console.log(`✓ Turso-Datenbank (${cfg.host}) gesichert: ${target}`);
} catch (err) {
  console.error(`✗ Sicherung fehlgeschlagen: ${err.message}`);
  process.exit(1);
}
