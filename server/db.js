/**
 * Datenbank-Schicht (better-sqlite3)
 * ------------------------------------------------------------
 * - Legt beim Start alle Tabellen automatisch an (CREATE TABLE IF NOT EXISTS)
 * - Führt leichte Migrationen aus (fehlende Spalten werden ergänzt)
 * - Befüllt eine leere Datenbank mit Demo-/Initialdaten
 *
 * DATENSCHUTZ-REGELN für Migrationen (bitte beibehalten):
 *   - nur CREATE TABLE IF NOT EXISTS und ALTER TABLE ... ADD COLUMN (mit Fehlerabfangung)
 *   - Standarddaten nur per INSERT OR IGNORE bzw. wenn die Tabelle leer ist
 *   - vor jedem Start wird automatisch eine Sicherungskopie angelegt (data/backups/auto)
 *
 * v4: neue Tabellen consumables, consumable_moves, float_items (bestehende Tabellen bleiben unverändert)
 * v4.1: neue Spalten in vehicles für Radstand, Spurweiten, Reifenbreiten (nur ADD COLUMN)
 * v4.2: neue Spalten in parts (Gebinde), neue Tabelle shopping_list
 *
 * Speicherort: ./data/halle.db (überschreibbar via DATA_DIR)
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
for (const dir of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) fs.mkdirSync(dir, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'halle.db');
const DB_FILES = [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`];
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/**
 * SICHERHEIT: Bevor die Datenbank geöffnet wird (und Migrationen laufen), wird eine
 * Sicherungskopie nach data/backups/auto/<Zeitstempel>/ gelegt. Die letzten 20 bleiben erhalten.
 * Es werden ausschließlich alte AUTO-Sicherungen aufgeräumt, niemals die Datenbank selbst.
 */
function startupBackup() {
  if (!fs.existsSync(DB_FILE) || process.env.HALLE_NO_AUTOBACKUP) return;
  try {
    const autoDir = path.join(BACKUP_DIR, 'auto');
    const target = path.join(autoDir, stamp());
    fs.mkdirSync(target, { recursive: true });
    for (const f of DB_FILES) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(target, path.basename(f)));
    const keep = 20;
    const dirs = fs.readdirSync(autoDir).filter((d) => fs.statSync(path.join(autoDir, d)).isDirectory()).sort();
    for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) fs.rmSync(path.join(autoDir, d), { recursive: true, force: true });
    console.log(`[db] Sicherungskopie angelegt: ${path.relative(process.cwd(), target)}`);
  } catch (err) {
    console.warn('[db] Sicherungskopie fehlgeschlagen (Start läuft weiter):', err.message);
  }
}

// "npm run reset-db" löscht NICHTS mehr: die alte Datenbank wird nach data/backups/reset-<Zeit>/ verschoben.
if (process.argv.includes('--reset') && fs.existsSync(DB_FILE)) {
  const target = path.join(BACKUP_DIR, `reset-${stamp()}`);
  fs.mkdirSync(target, { recursive: true });
  for (const f of DB_FILES) if (fs.existsSync(f)) fs.renameSync(f, path.join(target, path.basename(f)));
  console.log(`[db] Alte Datenbank verschoben nach ${target}. Es wird eine neue angelegt.`);
}

const IS_NEW_DB = !fs.existsSync(DB_FILE);
startupBackup();

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'schrauber' CHECK (role IN ('admin','schrauber','gast')),
  pin_hash   TEXT,
  color      TEXT DEFAULT '#22d3ee',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  label      TEXT,
  created_at TEXT DEFAULT ${NOW},
  last_seen  TEXT DEFAULT ${NOW}
);

-- Alles, was auf der Hallen-Map steht: Stellplätze, Regale, Werkbänke, Zonen, Reifenstapel, Kühlschrank ...
-- (Typ wird im Code geprüft, damit neue Objekttypen ohne Schema-Änderung möglich sind)
CREATE TABLE IF NOT EXISTS layout_objects (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  type   TEXT NOT NULL,
  code   TEXT,
  label  TEXT,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 1, h REAL NOT NULL DEFAULT 1,
  color  TEXT,
  props  TEXT NOT NULL DEFAULT '{}',
  sort   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vehicles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  model           TEXT NOT NULL DEFAULT 'dummy',
  color           TEXT NOT NULL DEFAULT '#9ca3af',
  plate           TEXT,
  vin             TEXT,
  status          TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','work','parts')),
  slot_id         INTEGER REFERENCES layout_objects(id) ON DELETE SET NULL,
  slot_pos        INTEGER NOT NULL DEFAULT 0,
  extern_location TEXT DEFAULT 'Paddock',
  mileage         INTEGER,
  tuev_until      TEXT,
  wheel_specs     TEXT NOT NULL DEFAULT '[]',
  spec_notes      TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS boxes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  shelf_id INTEGER NOT NULL REFERENCES layout_objects(id) ON DELETE CASCADE,
  level    INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 1,
  label    TEXT NOT NULL,
  color    TEXT DEFAULT '#3b82f6',
  notes    TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  category       TEXT,
  qty            INTEGER NOT NULL DEFAULT 1,
  condition      TEXT DEFAULT 'neu',
  event_relevant INTEGER NOT NULL DEFAULT 0,
  vehicle_id     INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  universal      INTEGER NOT NULL DEFAULT 0,
  foreign_model  TEXT,
  shelf_id       INTEGER REFERENCES layout_objects(id) ON DELETE SET NULL,
  level          INTEGER,
  box_id         INTEGER REFERENCES boxes(id) ON DELETE SET NULL,
  part_number    TEXT,
  notes          TEXT,
  created_at     TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS tools (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  category            TEXT,
  qty                 INTEGER NOT NULL DEFAULT 1,
  location_text       TEXT,
  shelf_id            INTEGER REFERENCES layout_objects(id) ON DELETE SET NULL,
  level               INTEGER,
  box_id              INTEGER REFERENCES boxes(id) ON DELETE SET NULL,
  event_relevant      INTEGER NOT NULL DEFAULT 0,
  wishlist            INTEGER NOT NULL DEFAULT 0,
  price               REAL,
  url                 TEXT,
  borrowed_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  borrowed_vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  borrowed_at         TEXT,
  notes               TEXT,
  created_at          TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  date_start TEXT NOT NULL,
  date_end   TEXT,
  location   TEXT,
  notes      TEXT,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS event_vehicles (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, vehicle_id)
);

CREATE TABLE IF NOT EXISTS packlist_checks (
  event_id  INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  item_key  TEXT NOT NULL,
  packed    INTEGER NOT NULL DEFAULT 0,
  packed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  packed_at TEXT,
  PRIMARY KEY (event_id, item_key)
);

CREATE TABLE IF NOT EXISTS packlist_custom (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name     TEXT NOT NULL,
  qty      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  priority    INTEGER NOT NULL DEFAULT 2,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at     TEXT,
  created_at  TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS maintenance_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  mileage     INTEGER,
  cost        REAL,
  done_at     TEXT DEFAULT ${NOW},
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  price      REAL NOT NULL DEFAULT 0,
  qty        INTEGER NOT NULL DEFAULT 1,
  url        TEXT,
  status     TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','bought')),
  bought_at  TEXT,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  kind          TEXT DEFAULT 'sonstiges',
  title         TEXT,
  filename      TEXT NOT NULL,
  original_name TEXT,
  mime          TEXT,
  size          INTEGER,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS work_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  text       TEXT,
  started_at TEXT DEFAULT ${NOW},
  ended_at   TEXT
);

CREATE TABLE IF NOT EXISTS quickchecks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  event_id   INTEGER REFERENCES events(id) ON DELETE SET NULL,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  questions  TEXT NOT NULL DEFAULT '[]',
  active     INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS quickcheck_answers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quickcheck_id INTEGER NOT NULL REFERENCES quickchecks(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers       TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT DEFAULT ${NOW},
  UNIQUE (quickcheck_id, user_id)
);

CREATE TABLE IF NOT EXISTS blueprint_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL CHECK (type IN ('line','node')),
  kind       TEXT NOT NULL,
  label      TEXT,
  points     TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT ${NOW}
);

-- Vorbereitet für smarte Steckdosen, Heizungen, Sensoren und Webcams
CREATE TABLE IF NOT EXISTS devices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL DEFAULT 'plug',
  driver     TEXT NOT NULL DEFAULT 'mock',
  name       TEXT NOT NULL,
  endpoint   TEXT,
  config     TEXT NOT NULL DEFAULT '{}',
  state      TEXT NOT NULL DEFAULT '{}',
  x REAL, y REAL,
  created_at TEXT DEFAULT ${NOW}
);

/* ---------- v2: Reifenlager (Drift-Tyre Hub) ---------- */
CREATE TABLE IF NOT EXISTS rims (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  model      TEXT NOT NULL,
  size       TEXT,                -- z. B. 8x17 ET20
  pcd        TEXT,                -- Lochkreis, z. B. 5x120
  color      TEXT,
  condition  TEXT DEFAULT 'gut',
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  notes      TEXT,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS tyres (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dimension  TEXT NOT NULL,       -- z. B. 225/45 R17
  brand      TEXT,
  model      TEXT,
  condition  TEXT NOT NULL DEFAULT 'neu',      -- neu | training | burner
  class      TEXT NOT NULL DEFAULT 'drift',    -- drift | strasse
  status     TEXT NOT NULL DEFAULT 'aktiv',    -- aktiv | abgefahren
  rim_id     INTEGER REFERENCES rims(id) ON DELETE SET NULL,   -- gesetzt = Komplettrad
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  dot        TEXT,
  notes      TEXT,
  burned_at  TEXT,
  created_at TEXT DEFAULT ${NOW}
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tyres_rim ON tyres(rim_id) WHERE rim_id IS NOT NULL;

/* ---------- v2: Chill-Ecke & Kühlschrank-Radar ---------- */
CREATE TABLE IF NOT EXISTS supplies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'kuehlschrank',  -- kuehlschrank | werkstatt
  unit       TEXT NOT NULL DEFAULT 'Stk',
  qty        INTEGER NOT NULL DEFAULT 0,
  min_qty    INTEGER NOT NULL DEFAULT 0,
  pack_size  INTEGER NOT NULL DEFAULT 6,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS supply_moves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  supply_id  INTEGER NOT NULL REFERENCES supplies(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW}
);

/* ---------- v2: Drift-Setup Sheets ---------- */
CREATE TABLE IF NOT EXISTS setups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  event_id   INTEGER REFERENCES events(id) ON DELETE SET NULL,
  track      TEXT,
  setup_date TEXT,
  data       TEXT NOT NULL DEFAULT '{}',
  rating     INTEGER,
  is_current INTEGER NOT NULL DEFAULT 0,
  notes      TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW}
);

CREATE INDEX IF NOT EXISTS idx_parts_vehicle ON parts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_parts_shelf   ON parts(shelf_id, level);
CREATE INDEX IF NOT EXISTS idx_tasks_vehicle ON tasks(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_log_vehicle   ON maintenance_log(vehicle_id);
`);

/* ------------------------------------------------------------------ */
/* Mini-Migrationen: neue Spalten in späteren Versionen hier ergänzen  */
/* ------------------------------------------------------------------ */
function ensureColumn(table, column, ddl) {
  // Nur ADD COLUMN, niemals DROP/RENAME. Fehler werden abgefangen, damit der Start nie an einer Migration scheitert.
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      console.log(`[db] Migration: Spalte ${table}.${column} ergänzt.`);
    }
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) console.warn(`[db] Spalte ${table}.${column} konnte nicht ergänzt werden:`, err.message);
  }
}
ensureColumn('vehicles', 'notes', 'TEXT');
ensureColumn('events', 'start_time', 'TEXT');   // v2: Uhrzeit für den Live-Countdown
// v3: Gewicht und optionale Maße je Auto (für den Gespann-Rechner)
ensureColumn('vehicles', 'weight_kg', 'INTEGER');
ensureColumn('vehicles', 'length_cm', 'INTEGER');
ensureColumn('vehicles', 'width_cm', 'INTEGER');
// v4.1: Radmaße für den Beladungs-Check (Reifenaufstandsfläche statt Karosserie)
ensureColumn('vehicles', 'wheelbase_mm', 'INTEGER');          // Radstand
ensureColumn('vehicles', 'track_front_mm', 'INTEGER');        // Spurweite vorn
ensureColumn('vehicles', 'track_rear_mm', 'INTEGER');         // Spurweite hinten
ensureColumn('vehicles', 'tire_width_front_mm', 'INTEGER');   // Reifenbreite vorn, z. B. 225
ensureColumn('vehicles', 'tire_width_rear_mm', 'INTEGER');    // Reifenbreite hinten, z. B. 245
ensureColumn('vehicles', 'outer_width_calc_mm', 'INTEGER');   // MAX(Spur + Reifenbreite) vorn/hinten, wird beim Speichern berechnet
// v4.2: Inventar-Teile als Gebinde (z. B. 1 L Dose, 5 L Kanister) mit Verknüpfung zur Kritischen Liste
ensureColumn('parts', 'pack_size', 'REAL');            // Gebindemenge, z. B. 5
ensureColumn('parts', 'pack_unit', 'TEXT');            // Einheit, z. B. L, Stk, Dosen
ensureColumn('parts', 'consumable_id', 'INTEGER');     // Kategorie der Kritischen Liste (consumables.id)
ensureColumn('parts', 'open_rest', 'REAL');            // Restmenge im angebrochenen Gebinde (leer = keins offen)

/* ---------- v3: neue Tabellen (nur CREATE TABLE IF NOT EXISTS) ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS vehicle_models (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  chassis    TEXT,
  shape      TEXT NOT NULL DEFAULT 'coupe',
  length     REAL NOT NULL DEFAULT 4.4,
  width      REAL NOT NULL DEFAULT 1.8,
  weight_kg  INTEGER,
  builtin    INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 100,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS trailers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  plate            TEXT,
  empty_kg         INTEGER NOT NULL DEFAULT 0,
  gvw_kg           INTEGER NOT NULL DEFAULT 0,
  deck_length_cm   INTEGER,
  deck_width_cm    INTEGER,
  tow_vehicle_id   INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  tow_name         TEXT,
  tow_capacity_kg  INTEGER,
  notes            TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS event_loading (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  trailer_id INTEGER REFERENCES trailers(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, vehicle_id)
);
`);

/* ---------- v4: Schnell-Verbrauch, kritische Ressourcen, Schwebe-Status (nur neue Tabellen) ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS consumables (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'piece',   -- fluid | piece
  unit               TEXT NOT NULL DEFAULT 'Stk',
  qty                REAL,                            -- NULL = Bestand noch nicht erfasst
  min_qty            REAL NOT NULL DEFAULT 0,
  critical           INTEGER NOT NULL DEFAULT 0,      -- darf NIE ausgehen
  steps              TEXT NOT NULL DEFAULT '[1,2]',   -- Schnell-Tasten, z. B. [0.5,1,2]
  container_label    TEXT NOT NULL DEFAULT 'Packung', -- Kanister, Dose, Packung, Rolle ...
  container_size     REAL,                            -- Inhalt eines Gebindes in "unit"
  price_per_unit     REAL,
  location_object_id INTEGER REFERENCES layout_objects(id) ON DELETE SET NULL,
  sort               INTEGER NOT NULL DEFAULT 100,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT DEFAULT ${NOW},
  updated_at         TEXT
);

CREATE TABLE IF NOT EXISTS consumable_moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'use',          -- use | empty | refill | count
  delta         REAL NOT NULL DEFAULT 0,
  qty_before    REAL,
  qty_after     REAL,
  vehicle_id    INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  log_id        INTEGER,                              -- Eintrag im Wartungsheft (falls Auto gewählt)
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  undone        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_cmoves_item ON consumable_moves(consumable_id, id);

CREATE TABLE IF NOT EXISTS float_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'other',          -- tool | box | part | other
  ref_id      INTEGER,
  label       TEXT NOT NULL,
  spot        TEXT,
  object_id   INTEGER REFERENCES layout_objects(id) ON DELETE SET NULL,
  vehicle_id  INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT ${NOW},
  returned_at TEXT,
  returned_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_float_open ON float_items(returned_at);
`);

/* ---------- v4.2: Hallen-Einkaufsliste (neue Tabelle) ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS shopping_list (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL DEFAULT 'manual',   -- consumable | supply | manual
  ref_id     INTEGER,
  name       TEXT NOT NULL,
  qty_text   TEXT,
  note       TEXT,
  status     TEXT NOT NULL DEFAULT 'open',     -- open | bought | removed
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW},
  done_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_shopping_open ON shopping_list(status);
`);
ensureColumn('consumable_moves', 'detail', 'TEXT');   // v4.2: welche Gebinde wie viel abgegeben haben (für Rückgängig)

// Standard-Modelle nur ergänzen, wenn sie fehlen (INSERT OR IGNORE überschreibt nie eigene Änderungen)
(function seedVehicleModels() {
  const { MODELS } = require('./lib/models');
  const ins = db.prepare(`INSERT OR IGNORE INTO vehicle_models (key, label, chassis, shape, length, width, weight_kg, builtin, sort)
    VALUES (?,?,?,?,?,?,?,1,?)`);
  let sort = 0;
  for (const [key, m] of Object.entries(MODELS)) { ins.run(key, m.label, m.chassis || null, m.shape, m.length, m.width, m.weight || null, sort); sort += 1; }
})();

/**
 * v2: Alte Datenbanken hatten einen CHECK auf layout_objects.type.
 * Neue Objekttypen (Reifenstapel, Kühlschrank) brauchen ihn nicht mehr: Tabelle sicher neu aufbauen.
 */
function migrateLayoutTypeCheck() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'layout_objects'").get();
  if (!row || !/CHECK\s*\(\s*type\s+IN/i.test(row.sql)) return;
  console.log('[db] Migration: layout_objects ohne Typ-CHECK neu aufbauen ...');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE layout_objects_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, code TEXT, label TEXT,
        x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0, w REAL NOT NULL DEFAULT 1, h REAL NOT NULL DEFAULT 1,
        color TEXT, props TEXT NOT NULL DEFAULT '{}', sort INTEGER NOT NULL DEFAULT 0)`);
      db.exec('INSERT INTO layout_objects_v2 (id, type, code, label, x, y, w, h, color, props, sort) SELECT id, type, code, label, x, y, w, h, color, props, sort FROM layout_objects');
      db.exec('DROP TABLE layout_objects');
      db.exec('ALTER TABLE layout_objects_v2 RENAME TO layout_objects');
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
migrateLayoutTypeCheck();

/* ------------------------------------------------------------------ */
/* Helfer                                                              */
/* ------------------------------------------------------------------ */
function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

/* ------------------------------------------------------------------ */
/* Initialdaten                                                        */
/* ------------------------------------------------------------------ */
function isoDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function isoTs(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString();
}

function seed() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return;
  console.log('[db] Leere Datenbank erkannt, lege Initialdaten an ...');

  const tx = db.transaction(() => {
    setSetting('hall', { name: 'Schrauberhalle', width: 8, depth: 19 });
    setSetting('hallpass', { enabled: true, token: crypto.randomBytes(12).toString('hex') });

    /* Nutzer (PINs: Oliver 1234, Kumpels 0000) */
    const insUser = db.prepare('INSERT INTO users (name, role, pin_hash, color) VALUES (?, ?, ?, ?)');
    const oliver = insUser.run('Oliver', 'admin', hashPin('1234'), '#22d3ee').lastInsertRowid;
    const k1 = insUser.run('Kumpel 1', 'schrauber', hashPin('0000'), '#f472b6').lastInsertRowid;
    insUser.run('Kumpel 2', 'schrauber', hashPin('0000'), '#a3e635');

    /* Hallen-Layout (Meter, Ursprung = hinten links, Einfahrt bei y = 19) */
    const insObj = db.prepare('INSERT INTO layout_objects (type, code, label, x, y, w, h, color, props, sort) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const obj = (type, code, label, x, y, w, h, color, props = {}, sort = 0) =>
      insObj.run(type, code, label, x, y, w, h, color, JSON.stringify(props), sort).lastInsertRowid;

    obj('zone', 'CHILL', 'Chill-Ecke (Empore)', 4.1, 0.1, 3.85, 6.0, '#a855f7', { hatch: true }, -1);
    obj('workbench', 'WB', 'Werkbank', 0.1, 0.4, 0.7, 3.4, '#b45309');
    obj('toolwall', 'TW', 'Werkzeugwand', 0.9, 0.05, 2.9, 0.25, '#64748b');
    const L3 = obj('slot', 'L3', 'Hebebühne 1', 0.9, 0.45, 2.9, 5.7, '#22d3ee', { kind: 'lift', capacity: 2 });
    const L2 = obj('slot', 'L2', 'Puffer L2', 0.6, 6.6, 3.0, 5.0, '#facc15', { kind: 'buffer', capacity: 1, blocksLane: true });
    const L1 = obj('slot', 'L1', 'Puffer L1', 0.6, 12.0, 3.0, 5.0, '#facc15', { kind: 'buffer', capacity: 1, blocksLane: true });
    const R3 = obj('slot', 'R3', 'Unter Chill-Ecke', 4.3, 0.45, 2.9, 5.4, '#a855f7', { kind: 'chill', capacity: 1 });
    const R2 = obj('slot', 'R2', 'Stellplatz R2', 4.3, 6.4, 2.9, 5.0, '#94a3b8', { kind: 'standard', capacity: 1 });
    const R1 = obj('slot', 'R1', 'Hebebühne 2', 4.3, 11.8, 2.9, 5.4, '#22d3ee', { kind: 'lift', capacity: 2 }); // Parkbühne: oben + unten
    const A = obj('shelf', 'A', 'Regal A', 7.35, 6.2, 0.6, 4.4, '#0ea5e9', { levels: 4 });
    const B = obj('shelf', 'B', 'Regal B', 7.35, 10.8, 0.6, 4.4, '#0ea5e9', { levels: 4 });
    obj('zone', 'KOMP', 'Kompressor', 7.1, 17.6, 0.85, 1.0, '#22d3ee', {});
    obj('door', 'TOR', 'Rolltor / Einfahrt', 0.4, 18.85, 7.2, 0.15, '#f59e0b', {});

    /* Fahrzeuge */
    const insVeh = db.prepare(`INSERT INTO vehicles (name, model, color, plate, status, slot_id, slot_pos, extern_location, mileage, tuev_until, wheel_specs, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const v1 = insVeh.run('E46 Drift Coupé', 'e46_coupe', '#f5c518', '', 'work', L3, 0, null, 214500, isoDate(200),
      JSON.stringify([{ rim: '8,5x18 ET35', tire: '235/40 R18', axle: 'VA' }, { rim: '9,5x18 ET40', tire: '255/35 R18', axle: 'HA' }]), 'Drift-Aufbau, Diff gesperrt').lastInsertRowid;
    const v2 = insVeh.run('E36 Limo Trackday', 'e36_limo', '#1e40af', '', 'ready', R2, 0, null, 268000, isoDate(90), '[]', '').lastInsertRowid;
    const v3 = insVeh.run('E46 Touring Daily', 'e46_touring', '#9ca3af', '', 'ready', L1, 0, null, 241000, isoDate(320), '[]', '').lastInsertRowid;
    const v4 = insVeh.run('E36 Coupé Projekt', 'e36_coupe', '#b91c1c', '', 'parts', null, 0, 'beim Lackierer', 189000, null, '[]', 'Neulack Hellrot').lastInsertRowid;
    const v5 = insVeh.run('E46 320Ci Cabrio', 'e46_cabrio', '#0f766e', '', 'ready', R1, 0, null, 176000, isoDate(410), '[]', '').lastInsertRowid;
    const v6 = insVeh.run('M240i xDrive', 'g42_coupe', '#e5e7eb', '', 'ready', null, 0, 'Unterwegs', 38000, isoDate(700), '[]', '').lastInsertRowid;

    /* Regale: Euroboxen */
    const insBox = db.prepare('INSERT INTO boxes (shelf_id, level, position, label, color) VALUES (?,?,?,?,?)');
    const bBremse = insBox.run(A, 1, 1, 'Bremse', '#ef4444').lastInsertRowid;
    const bFahrwerk = insBox.run(A, 1, 2, 'Fahrwerk', '#facc15').lastInsertRowid;
    const bElektrik = insBox.run(A, 2, 1, 'Elektrik', '#3b82f6').lastInsertRowid;
    insBox.run(A, 3, 1, 'Schrauben M6 bis M12', '#9ca3af');
    const bFluids = insBox.run(B, 1, 1, 'Öle & Fluids', '#22c55e').lastInsertRowid;
    const bEvent = insBox.run(B, 2, 1, 'Event-Kiste', '#f97316').lastInsertRowid;
    insBox.run(B, 2, 2, 'Verbrauchsmaterial', '#a855f7');

    /* Ersatzteile */
    const insPart = db.prepare(`INSERT INTO parts (name, category, qty, condition, event_relevant, vehicle_id, universal, foreign_model, shelf_id, level, box_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insPart.run('Querlenker vorne links', 'Fahrwerk', 1, 'neu', 1, v1, 0, null, A, 1, bFahrwerk);
    insPart.run('Bremsbeläge VA', 'Bremse', 1, 'neu', 1, v1, 0, null, A, 1, bBremse);
    insPart.run('Reifen 255/35 R18 (gebraucht)', 'Räder', 4, 'gebraucht', 1, v1, 0, null, B, 4, null);
    insPart.run('Lenkwinkelsatz', 'Fahrwerk', 1, 'neu', 0, v1, 0, null, A, 1, bFahrwerk);
    insPart.run('Spurstangenkopf', 'Fahrwerk', 2, 'neu', 1, v2, 0, null, A, 1, bFahrwerk);
    insPart.run('Zündkerzen M50 (Satz)', 'Motor', 1, 'neu', 1, v2, 0, null, A, 2, bElektrik);
    insPart.run('Ersatzrad 15 Zoll', 'Räder', 1, 'gebraucht', 1, v4, 0, null, B, 4, null);
    insPart.run('Motoröl 5W40 (5 L)', 'Öle', 3, 'neu', 1, null, 1, null, B, 1, bFluids);
    insPart.run('Diff-Öl 75W90', 'Öle', 2, 'neu', 1, null, 1, null, B, 1, bFluids);
    insPart.run('Bremsflüssigkeit DOT4', 'Öle', 2, 'neu', 1, null, 1, null, B, 1, bFluids);
    insPart.run('Kühlmittel G48', 'Öle', 1, 'neu', 1, null, 1, null, B, 1, bFluids);
    insPart.run('Panzertape', 'Verbrauch', 3, 'neu', 1, null, 1, null, B, 2, bEvent);
    insPart.run('Kabelbinder (Set)', 'Verbrauch', 2, 'neu', 1, null, 1, null, B, 2, bEvent);
    insPart.run('Sicherungen (Sortiment)', 'Elektrik', 1, 'neu', 1, null, 1, null, A, 2, bElektrik);
    insPart.run('Lichtmaschine', 'Elektrik', 1, 'gebraucht', 0, null, 0, 'E30 M20', A, 3, null);
    insPart.run('Kupplungsnehmerzylinder', 'Antrieb', 1, 'neu', 1, null, 0, 'E36 / E46 Sechszylinder', A, 2, null);

    /* Werkzeug */
    const insTool = db.prepare(`INSERT INTO tools (name, category, qty, location_text, shelf_id, level, box_id, event_relevant, wishlist, price, borrowed_by, borrowed_vehicle_id, borrowed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insTool.run('Schlagschrauber (Akku)', 'Elektrowerkzeug', 1, 'Werkzeugwand', null, null, null, 1, 0, null, null, null, null);
    insTool.run('Wagenheber Alu (Rangier)', 'Heben', 1, 'unter Werkbank', null, null, null, 1, 0, null, null, null, null);
    insTool.run('17er Nuss (Schlag)', 'Nüsse', 1, 'Werkzeugwagen Schublade 2', null, null, null, 1, 0, null, null, null, null);
    insTool.run('17er Nuss (Schlag)', 'Nüsse', 1, 'Event-Kiste', B, 2, bEvent, 1, 0, null, null, null, null);
    insTool.run('Drehmomentschlüssel 40 bis 200 Nm', 'Schlüssel', 1, 'Werkzeugwand', null, null, null, 1, 0, null, k1, v1, isoTs(-0.1));
    insTool.run('Ratschenkasten 1/2 Zoll', 'Schlüssel', 1, 'Werkzeugwagen', null, null, null, 1, 0, null, null, null, null);
    insTool.run('Reifenfüller mit Manometer', 'Druckluft', 1, 'Kompressor', null, null, null, 1, 0, null, null, null, null);
    insTool.run('Unterstellböcke (Paar)', 'Heben', 2, 'neben Hebebühne 1', null, null, null, 1, 0, null, null, null, null);
    insTool.run('Kugelgelenk-Abzieher', 'Spezialwerkzeug', 1, 'Regal A, Etage 3', A, 3, null, 0, 0, null, null, null, null);
    insTool.run('Getriebeheber', 'Heben', 1, null, null, null, null, 0, 1, 189, null, null, null);
    insTool.run('Bremsenentlüftungsgerät', 'Bremse', 1, null, null, null, null, 0, 1, 79.9, null, null, null);

    /* Events */
    const insEvent = db.prepare('INSERT INTO events (name, date_start, date_end, location, notes) VALUES (?,?,?,?,?)');
    const e1 = insEvent.run('Drift-Weekend', isoDate(16), isoDate(17), 'Driftpark', 'Anreise Freitag Abend, Hänger checken').lastInsertRowid;
    const e2 = insEvent.run('Altstadt-Event', isoDate(40), isoDate(40), 'Altstadt', 'Treffen 10 Uhr').lastInsertRowid;
    const insEv = db.prepare('INSERT INTO event_vehicles (event_id, vehicle_id) VALUES (?, ?)');
    insEv.run(e1, v1); insEv.run(e1, v2); insEv.run(e2, v5); insEv.run(e2, v6);

    /* Aufgaben */
    const insTask = db.prepare('INSERT INTO tasks (vehicle_id, title, description, priority, created_by) VALUES (?,?,?,?,?)');
    const t1 = insTask.run(v1, 'Querlenker vorne tauschen', 'Links ausgeschlagen, neues Teil liegt in Regal A', 1, oliver).lastInsertRowid;
    insTask.run(v1, 'Diff-Öl wechseln', '75W90, ca. 1,1 L', 2, oliver);
    insTask.run(v1, 'Achsvermessung nach Querlenkertausch', '', 2, oliver);
    insTask.run(v2, 'Spurstangenkopf links tauschen', '', 1, oliver);
    insTask.run(v4, 'Vom Lackierer abholen', 'Hänger reservieren', 2, oliver);
    insTask.run(v5, 'Verdeck-Hydraulik prüfen', '', 3, oliver);
    insTask.run(null, 'Kompressor entwässern', 'Kondenswasser ablassen', 2, oliver);
    insTask.run(null, 'Elektrik Unterverteilung beschriften', '', 3, oliver);
    insTask.run(null, 'Hallenboden fegen und Ölbindemittel nachfüllen', '', 3, oliver);

    /* Wartungsheft */
    const insLog = db.prepare('INSERT INTO maintenance_log (vehicle_id, title, description, mileage, cost, done_at, user_id) VALUES (?,?,?,?,?,?,?)');
    insLog.run(v1, 'Ölwechsel 5W40 + Ölfilter', 'Mann Filter HU 925/4x', 213900, 64.5, isoTs(-30), oliver);
    insLog.run(v1, 'Bremsflüssigkeit gewechselt', 'DOT4', 213900, 14, isoTs(-30), oliver);
    insLog.run(v2, 'Benzinfilter getauscht', 'Mahle KL 103', 267200, 18.9, isoTs(-60), k1);
    insLog.run(v5, 'Inspektion: Luftfilter, Innenraumfilter', '', 175500, 42, isoTs(-120), oliver);

    /* Budget / Einkauf */
    const insBuy = db.prepare('INSERT INTO purchases (vehicle_id, name, price, qty, status, bought_at) VALUES (?,?,?,?,?,?)');
    insBuy.run(v1, 'Querlenker Lemförder (Paar)', 89.9, 1, 'bought', isoTs(-5));
    insBuy.run(v1, 'Bremsbeläge Ferodo DS2500 VA', 159, 1, 'todo', null);
    insBuy.run(v1, 'Radlagerkit HA', 74.5, 1, 'todo', null);
    insBuy.run(v2, 'Spurstangenkopf Febi', 24.9, 2, 'bought', isoTs(-3));
    insBuy.run(v4, 'Lackierung Komplett', 1850, 1, 'todo', null);

    /* Woran wird gerade gearbeitet? */
    db.prepare('INSERT INTO work_sessions (user_id, vehicle_id, task_id, text) VALUES (?,?,?,?)').run(oliver, v1, t1, 'Querlenker');

    /* Blueprint (Elektrik + Druckluft) */
    const insBp = db.prepare('INSERT INTO blueprint_items (type, kind, label, points) VALUES (?,?,?,?)');
    insBp.run('node', 'verteiler', 'Hauptverteiler', JSON.stringify([[0.3, 18.3]]));
    insBp.run('node', 'steckdose400', 'CEE 16A Hebebühne 1', JSON.stringify([[0.3, 4.5]]));
    insBp.run('node', 'steckdose230', 'Werkbank 3-fach', JSON.stringify([[0.3, 1.2]]));
    insBp.run('node', 'steckdose230', 'Rechte Wand', JSON.stringify([[7.7, 16.8]]));
    insBp.run('node', 'kompressor', 'Kompressor 270 L', JSON.stringify([[7.5, 18.1]]));
    insBp.run('node', 'abscheider', 'Wasserabscheider', JSON.stringify([[7.7, 15.6]]));
    insBp.run('node', 'kupplung', 'Kupplung hinten', JSON.stringify([[7.7, 6.0]]));
    insBp.run('line', 'v400', 'Zuleitung Bühne 1', JSON.stringify([[0.3, 18.3], [0.15, 18.3], [0.15, 4.5], [0.3, 4.5]]));
    insBp.run('line', 'v230', 'Ring Werkbank', JSON.stringify([[0.3, 18.3], [0.25, 18.3], [0.25, 1.2], [0.3, 1.2]]));
    insBp.run('line', 'v230', 'Rechte Wand', JSON.stringify([[0.3, 18.3], [0.3, 18.7], [7.85, 18.7], [7.85, 16.8], [7.7, 16.8]]));
    insBp.run('line', 'air', 'Druckluft Hauptleitung', JSON.stringify([[7.5, 18.1], [7.75, 18.1], [7.75, 15.6], [7.75, 6.0], [7.7, 6.0]]));

    /* Post-Event Quick-Check (Vorlage, inaktiv) */
    db.prepare('INSERT INTO quickchecks (title, event_id, vehicle_id, questions, active, created_by) VALUES (?,?,?,?,?,?)').run(
      'Post-Event Check: Drift-Weekend', e1, v1,
      JSON.stringify([
        { text: 'Reifen abgefahren?', taskOn: 'yes', taskTitle: 'Neue Reifen aufziehen' },
        { text: 'Diff-Öl gewechselt?', taskOn: 'no', taskTitle: 'Diff-Öl wechseln' },
        { text: 'Unterboden auf Schäden geprüft?', taskOn: 'no', taskTitle: 'Unterboden checken' }
      ]), 0, oliver);

    /* Geräte (Platzhalter für smarte Steckdosen / Webcams) */
    db.prepare('INSERT INTO devices (type, driver, name, endpoint, config, state, x, y) VALUES (?,?,?,?,?,?,?,?)')
      .run('plug', 'mock', 'Heizung Werkbank (Demo)', null, '{}', JSON.stringify({ on: false }), 0.5, 3.5);
  });
  tx();
  console.log('[db] Initialdaten angelegt. Logins: Oliver / PIN 1234 (Admin), Kumpel 1 und Kumpel 2 / PIN 0000');
}
seed();

/* ------------------------------------------------------------------ */
/* v2-Initialdaten: läuft genau einmal, auch für bestehende Datenbanken */
/* ------------------------------------------------------------------ */
function seedV2() {
  if (getSetting('seed_v2')) return;
  const tx = db.transaction(() => {
    const has = (type) => db.prepare('SELECT 1 FROM layout_objects WHERE type = ?').get(type);
    const insObj = db.prepare('INSERT INTO layout_objects (type, code, label, x, y, w, h, color, props, sort) VALUES (?,?,?,?,?,?,?,?,?,?)');
    if (!has('fridge')) insObj.run('fridge', 'KS', 'Kühlschrank / Chill-Ecke', 7.3, 0.35, 0.6, 0.85, '#38bdf8', '{}', 1);
    if (!has('tyrestack')) insObj.run('tyrestack', 'RL', 'Reifenlager', 7.25, 15.45, 0.7, 1.9, '#94a3b8', '{}', 1);

    const veh = (model) => (db.prepare('SELECT id FROM vehicles WHERE model = ? ORDER BY id LIMIT 1').get(model) || {}).id || null;
    const drift = veh('e46_coupe');
    const cabrio = veh('e46_cabrio');

    if (!db.prepare('SELECT COUNT(*) AS c FROM rims').get().c) {
      const insRim = db.prepare('INSERT INTO rims (model, size, pcd, color, condition, vehicle_id) VALUES (?,?,?,?,?,?)');
      const insTyre = db.prepare('INSERT INTO tyres (dimension, brand, model, condition, class, status, rim_id, vehicle_id, dot, burned_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
      const driftRims = [1, 2].map(() => insRim.run('BBS RC090', '8,5x18 ET35', '5x120', 'Silber', 'gut', drift).lastInsertRowid);
      [1, 2].forEach(() => insRim.run('Stahlfelge', '7x15 ET24', '5x120', 'Schwarz', 'Kratzer', null));
      const cabRims = [1, 2, 3, 4].map(() => insRim.run('BMW Style 68', '8x17 ET47', '5x120', 'Silber', 'gut', cabrio).lastInsertRowid);
      // Driftreifen fürs Coupé, zwei davon schon montiert
      for (let i = 0; i < 4; i += 1) insTyre.run('235/40 R18', 'Nankang', 'NS-2R', 'training', 'drift', 'aktiv', i < 2 ? driftRims[i] : null, drift, '2223', null);
      // Allgemeiner Drift-Bestand
      for (let i = 0; i < 6; i += 1) insTyre.run('225/45 R17', 'Gebraucht', 'Mix', 'training', 'drift', 'aktiv', null, null, null, null);
      // Gute Straßenreifen fürs Cabrio, komplett montiert
      for (let i = 0; i < 4; i += 1) insTyre.run('225/45 R17', 'Michelin', 'Pilot Sport 4', 'neu', 'strasse', 'aktiv', cabRims[i], cabrio, '1824', null);
      // Abgefahrene Burner
      for (let i = 0; i < 3; i += 1) insTyre.run('205/55 R16', 'Gebraucht', 'Burner', 'burner', 'drift', 'abgefahren', null, null, null, new Date().toISOString());
    }

    if (!db.prepare('SELECT COUNT(*) AS c FROM supplies').get().c) {
      const insSup = db.prepare('INSERT INTO supplies (name, category, unit, qty, min_qty, pack_size, sort) VALUES (?,?,?,?,?,?,?)');
      insSup.run('Bier', 'kuehlschrank', 'Dosen', 4, 6, 24, 1);
      insSup.run('Energy', 'kuehlschrank', 'Dosen', 8, 4, 12, 2);
      insSup.run('Cola', 'kuehlschrank', 'Flaschen', 6, 4, 6, 3);
      insSup.run('Kaffee', 'kuehlschrank', 'Packungen', 2, 1, 1, 4);
      insSup.run('Bremsenreiniger', 'werkstatt', 'Dosen', 1, 2, 6, 5);
      insSup.run('WD-40', 'werkstatt', 'Dosen', 2, 1, 1, 6);
      insSup.run('Papiertücher', 'werkstatt', 'Rollen', 3, 2, 6, 7);
    }

    if (drift && !db.prepare('SELECT COUNT(*) AS c FROM setups').get().c) {
      const ev = db.prepare("SELECT id FROM events WHERE name LIKE 'Drift%' ORDER BY date_start LIMIT 1").get();
      db.prepare('INSERT INTO setups (vehicle_id, title, event_id, track, setup_date, data, rating, is_current, notes) VALUES (?,?,?,?,?,?,?,?,?)').run(
        drift, 'Drift-Basis Trocken', ev ? ev.id : null, 'Driftpark', new Date().toISOString().slice(0, 10),
        JSON.stringify({
          camber: { fl: -4.5, fr: -4.5, rl: -0.8, rr: -0.8 },
          toe: { fl: 0.2, fr: 0.2, rl: 0.15, rr: 0.15 },
          caster: { fl: 8.5, fr: 8.5 },
          pressure: { cold: { fl: 2.2, fr: 2.2, rl: 2.0, rr: 2.0 }, warm: { fl: 2.6, fr: 2.6, rl: 2.4, rr: 2.4 } },
          steering: { kit: 'Wisefab', lock: 62, ackermann: 'parallel' },
          dampers: { front: { rebound: 10, bump: 8 }, rear: { rebound: 6, bump: 4 } },
          arb: { front: 'hart (Loch 1)', rear: 'aus' },
          rideHeight: { front: 330, rear: 340 }
        }), 4, 1, 'Viel Lenkwinkel, Heck bleibt gut stehen. Hinten etwas weicher probieren.');
    }
    setSetting('seed_v2', true);
  });
  tx();
}
seedV2();

/* v3: Standardwerte (nur wenn noch nicht vorhanden) + Demo-Anhänger ausschließlich für ganz neue Datenbanken */
(function seedV3() {
  if (getSetting('tv') === null) {
    setSetting('tv', {
      enabled: true, token: crypto.randomBytes(12).toString('hex'), interval: 18,
      screens: { tasks: true, event: true, stock: true, hall: true }, messages: [], weather: null
    });
  }
  if (IS_NEW_DB && !db.prepare('SELECT COUNT(*) AS c FROM trailers').get().c) {
    db.prepare(`INSERT INTO trailers (name, plate, empty_kg, gvw_kg, deck_length_cm, deck_width_cm, tow_name, tow_capacity_kg)
      VALUES (?,?,?,?,?,?,?,?)`).run('Brenderup 2-Achs Autotransporter', '', 650, 2700, 450, 200, 'Transporter', 2800);
    db.prepare(`INSERT INTO trailers (name, plate, empty_kg, gvw_kg, deck_length_cm, deck_width_cm, tow_name, tow_capacity_kg)
      VALUES (?,?,?,?,?,?,?,?)`).run('Leih-Anhänger kurz', '', 520, 2000, 400, 200, 'Kumpel 1 Touring', 1800);
  }
})();

/*
 * v3.1: Hebebühne 2 als Parkbühne (ein Auto oben, eins unten).
 * Ändert genau EIN Feld (props.capacity 1 -> 2) am Stellplatz "Hebebühne 2" (Art Hebebühne).
 * Alle anderen Eigenschaften bleiben erhalten. Läuft nur ein einziges Mal (Merker in settings);
 * stellst du die Kapazität im Baukasten später zurück auf 1, wird das respektiert.
 */
(function migrateParkbuehne() {
  if (getSetting('mig_parkbuehne_r1')) return;
  try {
    const rows = db.prepare("SELECT id, code, label, props FROM layout_objects WHERE type = 'slot'").all();
    const lift = rows.find((r) => r.label === 'Hebebühne 2') || rows.find((r) => r.code === 'R1');
    if (lift) {
      let props = {};
      try { props = JSON.parse(lift.props || '{}') || {}; } catch { props = null; }
      if (props && props.kind === 'lift' && (Number(props.capacity) || 1) === 1) {
        props.capacity = 2;
        db.prepare('UPDATE layout_objects SET props = ? WHERE id = ?').run(JSON.stringify(props), lift.id);
        console.log(`[db] Migration: ${lift.label} (${lift.code}) ist jetzt Parkbühne (2 Autos: oben + unten).`);
      }
    }
    setSetting('mig_parkbuehne_r1', true);
  } catch (e) {
    console.warn('[db] Migration Parkbühne übersprungen:', e.message);
  }
})();

/*
 * v4: Start-Sortiment für den Schnell-Verbrauch. Läuft genau einmal und nur, solange die NEUE Tabelle
 * consumables leer ist. Bestand bleibt "unbekannt" (NULL), bis ihr ihn eintragt: so gibt es keinen Fehlalarm.
 */
(function seedV4() {
  try {
    if (getSetting('seed_v4')) return;
    if (!db.prepare('SELECT COUNT(*) AS c FROM consumables').get().c) {
      const ins = db.prepare(`INSERT INTO consumables (name, kind, unit, min_qty, critical, steps, container_label, container_size, sort)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      const F = '[0.5,1,2]';
      const P = '[1,2]';
      [
        ['10W-60 Motoröl', 'fluid', 'L', 5, 1, F, 'Kanister', 5, 10],
        ['75W-140 Diff-Öl', 'fluid', 'L', 1, 0, F, 'Flasche', 1, 20],
        ['ATF Getriebeöl', 'fluid', 'L', 2, 1, F, 'Flasche', 1, 30],
        ['Kühlmittelkonzentrat', 'fluid', 'L', 3, 1, F, 'Kanister', 1.5, 40],
        ['Bremsflüssigkeit DOT 4', 'fluid', 'L', 1, 1, F, 'Flasche', 1, 50],
        ['Bremsenreiniger', 'piece', 'Dosen', 3, 1, P, 'Dose', 1, 60],
        ['WD-40', 'piece', 'Dosen', 1, 0, P, 'Dose', 1, 70],
        ['Kabelbinder', 'piece', 'Stk', 20, 0, P, 'Packung', 100, 80],
        ['Flexscheiben', 'piece', 'Stk', 3, 0, P, 'Packung', 10, 90],
        ['Panzertape', 'piece', 'Rollen', 1, 0, P, 'Rolle', 1, 100],
        ['Sicherungen (Sortiment)', 'piece', 'Stk', 10, 1, P, 'Packung', 50, 110]
      ].forEach((r) => ins.run(...r));
    }
    setSetting('seed_v4', true);
  } catch (e) {
    console.warn('[db] v4-Startsortiment übersprungen:', e.message);
  }
})();

/*
 * v4.2: Bestände, die in v4 per "Inventur" direkt an der Kritischen Liste eingetragen wurden, gehen nicht verloren:
 * Sie werden einmalig als Gebinde "(Bestand aus Inventur)" ohne Lagerort ins Inventar übernommen (neue Zeile in parts),
 * damit der neue, aus dem Inventar summierte Ist-Bestand stimmt. Nichts Bestehendes wird verändert.
 */
(function migrateV42() {
  try {
    if (getSetting('mig_v42_stock')) return;
    const rows = db.prepare('SELECT * FROM consumables WHERE qty IS NOT NULL AND qty > 0').all();
    const linked = db.prepare('SELECT COUNT(*) AS n FROM parts WHERE consumable_id = ?');
    const ins = db.prepare(`INSERT INTO parts (name, category, qty, condition, pack_size, pack_unit, consumable_id, notes, created_at)
      VALUES (?, 'Betriebsstoffe', 1, 'neu', ?, ?, ?, ?, ?)`);
    for (const c of rows) {
      if (linked.get(c.id).n) continue;
      ins.run(`${c.name} (Bestand aus Inventur)`, c.qty, c.unit, c.id, 'Aus der Schnell-Verbrauch-Inventur übernommen. Bitte Lagerort setzen oder in echte Gebinde aufteilen.', new Date().toISOString());
      console.log(`[db] v4.2: Inventur-Bestand ${c.qty} ${c.unit} ${c.name} als Gebinde ins Inventar übernommen.`);
    }
    setSetting('mig_v42_stock', true);
  } catch (e) {
    console.warn('[db] v4.2-Übernahme übersprungen:', e.message);
  }
})();

module.exports = { db, DATA_DIR, UPLOAD_DIR, BACKUP_DIR, getSetting, setSetting, hashPin, IS_NEW_DB };
