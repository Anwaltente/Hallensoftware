#!/usr/bin/env node
/**
 * HALLE//OS: Bestehende Datenbank (data/halle.db) nach Turso kopieren
 * ============================================================
 *   npm run turso:import                      lokale data/halle.db hochladen
 *   npm run turso:import -- pfad/zu/halle.db  andere Datei hochladen
 *   npm run turso:import -- --pruefen         nur anzeigen, was passieren würde (schreibt nichts)
 *   npm run turso:import -- --ersetzen        Turso enthält schon Daten (z. B. Beispieldaten): vorher sichern, dann ersetzen
 *
 * Zugangsdaten wie beim Server: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (in .env oder in der Shell).
 *
 * SICHERHEIT
 *   - Die lokale Datei wird NUR GELESEN (es wird eine Kopie in einem Temp-Ordner geöffnet).
 *   - Enthält Turso schon Daten, bricht das Skript ab. Mit --ersetzen wird der Turso-Inhalt zuerst
 *     als Datei nach data/backups/ gesichert und erst dann ersetzt.
 *   - Am Ende wird jede Tabelle Zeile für Zeile verglichen (Anzahl + Prüfsumme).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

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

const Database = require('better-sqlite3');
const { tursoConfig } = require('../server/lib/turso/config');
const { TursoDatabase, dumpToFile } = require('../server/lib/turso/database');

const args = process.argv.slice(2);
const DRY = args.some((a) => /^--(pruefen|prüfen|dry-run|check)$/i.test(a));
const REPLACE = args.some((a) => /^--(ersetzen|replace)$/i.test(a));
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const SOURCE = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(DATA_DIR, 'halle.db'));
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const INTERNAL = /^(sqlite_|libsql_|_litestream|_cf_)/i;
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

function fail(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }

/* ---------- Hilfen: Werte exakt übertragen (Ganzzahl bleibt Ganzzahl, Kommazahl bleibt Kommazahl) ---------- */
function enc(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') return { type: 'float', value: v };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  return { type: 'text', value: String(v) };
}
/** Vergleichswert je Zelle (gleiches Format für lokal und Turso) */
function canonLocal(v) {
  if (v === null || v === undefined) return 'n';
  if (typeof v === 'bigint') return `i${v.toString()}`;
  if (typeof v === 'number') return Number.isInteger(v) ? `f${v}.0` : `f${v}`;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return `b${Buffer.from(v).toString('base64')}`;
  return `t${v}`;
}
function canonRemote(v) {
  if (!v || v.type === 'null') return 'n';
  if (v.type === 'integer') return `i${v.value}`;
  if (v.type === 'float') { const n = Number(v.value); return Number.isInteger(n) ? `f${n}.0` : `f${n}`; }
  if (v.type === 'blob') return `b${v.base64 || ''}`;
  return `t${v.value}`;
}

function main() {
  console.log('\nHALLE//OS · Daten nach Turso übertragen\n');
  const cfg = tursoConfig();
  if (!cfg) fail('Keine Turso-Adresse gefunden. Bitte TURSO_DATABASE_URL (libsql://...) und TURSO_AUTH_TOKEN in die Datei .env eintragen.');
  if (!cfg.token) console.warn('! Kein Auth-Token gefunden (TURSO_AUTH_TOKEN). Turso wird den Zugriff vermutlich ablehnen.');
  if (!fs.existsSync(SOURCE)) fail(`Quelldatei nicht gefunden: ${SOURCE}`);
  console.log(`  Quelle:  ${SOURCE}  (wird nur gelesen)`);
  console.log(`  Ziel:    ${cfg.host}  (Adresse aus ${cfg.urlKey}${cfg.tokenKey ? `, Token aus ${cfg.tokenKey}` : ''})`);
  console.log(`  Modus:   ${DRY ? 'nur prüfen, nichts schreiben' : REPLACE ? 'ersetzen (mit Sicherung)' : 'nur in leere Turso-Datenbank'}\n`);

  // Quelle: Kopie (inkl. -wal/-shm) in einen Temp-Ordner, damit das Original garantiert unberührt bleibt
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'halle-import-'));
  for (const suf of ['', '-wal', '-shm']) if (fs.existsSync(SOURCE + suf)) fs.copyFileSync(SOURCE + suf, path.join(tmp, `halle.db${suf}`));
  const src = new Database(path.join(tmp, 'halle.db'));
  const master = src.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid").all()
    .filter((m) => !INTERNAL.test(m.name));
  const tables = master.filter((m) => m.type === 'table');
  const others = master.filter((m) => m.type !== 'table');
  const counts = Object.fromEntries(tables.map((t) => [t.name, src.prepare(`SELECT COUNT(*) AS n FROM ${q(t.name)}`).get().n]));
  const total = Object.values(counts).reduce((a, b) => a + Number(b), 0);
  console.log(`  Lokal: ${tables.length} Tabellen, ${total} Zeilen (z. B. ${['vehicles', 'parts', 'tasks', 'events'].filter((n) => n in counts).map((n) => `${n}: ${counts[n]}`).join(', ')})`);

  const tdb = new TursoDatabase({ url: cfg.url, token: cfg.token, timeoutMs: 60000, replica: false });
  let remoteTables;
  try {
    remoteTables = tdb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name).filter((n) => !INTERNAL.test(n));
  } catch (err) { fail(err.message); }
  const remoteCounts = {};
  if (remoteTables.length) {
    const res = tdb._executeMany(remoteTables.map((n) => ({ sql: `SELECT COUNT(*) AS n FROM ${q(n)}`, want_rows: true })));
    remoteTables.forEach((n, i) => { remoteCounts[n] = Number(res[i].rows[0][0].value); });
  }
  const remoteTotal = Object.values(remoteCounts).reduce((a, b) => a + b, 0);
  console.log(`  Turso: ${remoteTables.length} Tabellen, ${remoteTotal} Zeilen`);

  if (remoteTables.length && !REPLACE) {
    const list = Object.entries(remoteCounts).filter(([, n]) => n > 0).slice(0, 12).map(([k, n]) => `${k}: ${n}`).join(', ');
    fail(`Turso ist nicht leer (${remoteTotal} Zeilen${list ? `: ${list}` : ''}).\n  Es wurde NICHTS verändert.\n  Sind das nur Beispieldaten oder ein alter Testlauf, starte mit:  npm run turso:import -- --ersetzen\n  (der aktuelle Turso-Inhalt wird vorher als Datei gesichert).`);
  }
  if (DRY) {
    console.log('\n✓ Prüfung abgeschlossen. Mit "npm run turso:import" (ohne --pruefen) wird übertragen.\n');
    src.close(); tdb.close(); return;
  }

  if (remoteTables.length && REPLACE) {
    const backupDir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const file = path.join(backupDir, `turso-vor-import-${stamp()}.db`);
    dumpToFile(tdb, file);
    console.log(`  Turso-Inhalt gesichert: ${path.relative(process.cwd(), file)}`);
    const objs = tdb.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('view','trigger')").all().filter((o) => !INTERNAL.test(o.name));
    tdb.pragma('foreign_keys = OFF');
    tdb.exec([...objs.map((o) => `DROP ${o.type.toUpperCase()} IF EXISTS ${q(o.name)}`), ...remoteTables.map((n) => `DROP TABLE IF EXISTS ${q(n)}`)].join(';\n'));
    console.log(`  Alte Turso-Tabellen entfernt (${remoteTables.length}).`);
  }

  // 1) Tabellen anlegen (Originaldefinitionen), Fremdschlüssel während des Kopierens aus
  tdb.pragma('foreign_keys = OFF');
  tdb.exec(tables.map((t) => t.sql).join(';\n'));
  console.log(`  ${tables.length} Tabellen angelegt.`);

  // 2) Zeilen kopieren: je Tabelle eine Transaktion, Blöcke zu 300 Zeilen pro Anfrage
  for (const t of tables) {
    const rows = src.prepare(`SELECT * FROM ${q(t.name)} ORDER BY rowid`).safeIntegers(true).raw(true).all();
    if (!rows.length) continue;
    const cols = src.prepare(`SELECT * FROM ${q(t.name)} LIMIT 1`).columns().map((c) => q(c.name));
    const sql = `INSERT INTO ${q(t.name)} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    tdb.transaction(() => {
      for (let i = 0; i < rows.length; i += 300) {
        tdb._executeMany(rows.slice(i, i + 300).map((r) => ({ sql, args: r.map(enc), want_rows: false })));
      }
    })();
    process.stdout.write(`  ${t.name}: ${rows.length} Zeilen\n`);
  }

  // 3) Indizes, Trigger, Views; AUTOINCREMENT-Zähler
  if (others.length) {
    for (const o of others) { try { tdb.exec(o.sql); } catch (err) { console.warn(`  ! ${o.type} ${o.name} übersprungen: ${err.message}`); } }
  }
  let seq = [];
  try { seq = src.prepare('SELECT name, seq FROM sqlite_sequence').safeIntegers(true).all(); } catch { seq = []; }
  for (const s of seq) {
    try {
      const r = tdb.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(s.seq, s.name);
      if (!r.changes) tdb.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(s.name, s.seq);
    } catch { /* nicht kritisch: AUTOINCREMENT zählt dann ab der höchsten ID weiter */ }
  }
  tdb.pragma('foreign_keys = ON');

  // 4) Prüfen: Anzahl und Prüfsumme je Tabelle
  console.log('\n  Vergleich lokal ↔ Turso:');
  const remote = tdb._executeMany(tables.map((t) => ({ sql: `SELECT * FROM ${q(t.name)} ORDER BY rowid`, want_rows: true })));
  let bad = 0;
  tables.forEach((t, i) => {
    const local = src.prepare(`SELECT * FROM ${q(t.name)} ORDER BY rowid`).safeIntegers(true).raw(true).all();
    const h1 = crypto.createHash('sha256');
    local.forEach((r) => h1.update(`${r.map(canonLocal).join('\u0001')}\u0002`));
    const h2 = crypto.createHash('sha256');
    (remote[i].rows || []).forEach((r) => h2.update(`${r.map(canonRemote).join('\u0001')}\u0002`));
    const ok = local.length === (remote[i].rows || []).length && h1.digest('hex') === h2.digest('hex');
    if (!ok) bad += 1;
    if (!ok || local.length) console.log(`   ${ok ? '✓' : '✗'} ${t.name.padEnd(22)} ${String(local.length).padStart(6)} Zeilen`);
  });
  src.close();
  tdb.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad) fail(`${bad} Tabelle(n) weichen ab. Bitte die Ausgabe prüfen; die lokale Datei ist unverändert.`);
  console.log(`\n✓ Fertig: ${tables.length} Tabellen und ${total} Zeilen sind in Turso und stimmen exakt überein.`);
  console.log('  Die lokale Datei wurde nicht verändert. Jetzt den Server (z. B. auf Render) neu starten.\n');
}

try { main(); } catch (err) { fail(err.message); }
