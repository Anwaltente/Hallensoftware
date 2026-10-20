/**
 * Lokaler Lese-Spiegel der Turso-Datenbank (im Arbeitsspeicher)
 * ------------------------------------------------------------
 * Ziel: Seiten laden so schnell wie mit der lokalen Datei, obwohl die Daten in der Cloud liegen.
 *
 *   Lesen  (SELECT, PRAGMA table_info ...)  -> aus dem Spiegel, ohne Netzwerk
 *   Schreiben (INSERT/UPDATE/DELETE/DDL)     -> IMMER direkt in Turso (Turso bleibt die einzige Wahrheit)
 *
 * Nach jedem Schreiben wird der Spiegel nachgezogen:
 *   - einfache Fälle in derselben Anfrage (neue Zeile per last_insert_rowid(), UPDATE/DELETE ... WHERE id = ?)
 *   - sonst wird die betroffene Tabelle (inkl. per ON DELETE CASCADE abhängiger Tabellen) vor dem
 *     nächsten Lesen neu geladen; Schema-Änderungen laden alles neu.
 * Zusätzlich wird der Spiegel regelmäßig komplett erneuert (Standard alle 15 s, nur wenn gelesen wird),
 * damit auch Änderungen von außen (z. B. ein zweiter Server) ankommen.
 * Innerhalb einer Transaktion wird direkt in Turso gelesen (sieht eigene, noch nicht bestätigte Änderungen).
 */

const { encodeValue } = require('./values');

const INTERNAL = /^(sqlite_|libsql_|_litestream|_cf_)/i;
const MASTER_SQL = "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid";
const IDENT = String.raw`(?:main\.)?(?:"((?:[^"]|"")+)"|\x60([^\x60]+)\x60|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))`;
const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
const identName = (m, i) => (m[i] !== undefined ? m[i].replace(/""/g, '"') : (m[i + 1] || m[i + 2] || m[i + 3]));

/** Anzahl ? außerhalb von Zeichenketten */
function countPlaceholders(sql) {
  let n = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '?') n += 1;
  }
  return n;
}

/** Ist die Anweisung ein reines Lesen, das der Spiegel beantworten kann? */
function isLocalRead(sql) {
  if (/^\s*PRAGMA\s+(table_info|table_xinfo|index_list|index_info|foreign_key_list)\s*\(/i.test(sql)) return true;
  if (/\bRETURNING\b/i.test(sql)) return false;
  if (/^\s*(SELECT|VALUES)\b/i.test(sql)) return !/\b(last_insert_rowid|changes|total_changes)\s*\(/i.test(sql);
  if (/^\s*WITH\b/i.test(sql)) return !/\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
  return false;
}

/** Was ändert eine schreibende Anweisung? */
function classify(sql) {
  const s = String(sql);
  if (/^\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(s)) return { kind: 'tx' };
  if (/^\s*EXPLAIN\b/i.test(s)) return { kind: 'none' };
  let m = s.match(new RegExp(String.raw`^\s*(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO\s+${IDENT}`, 'i'));
  if (m) return { kind: 'replace', table: identName(m, 1) };
  m = s.match(new RegExp(String.raw`^\s*INSERT\s+OR\s+\w+\s+INTO\s+${IDENT}`, 'i'));
  if (m) return { kind: 'insert-or', table: identName(m, 1) };
  m = s.match(new RegExp(String.raw`^\s*INSERT\s+INTO\s+${IDENT}`, 'i'));
  if (m) return { kind: 'insert', table: identName(m, 1) };
  m = s.match(new RegExp(String.raw`^\s*UPDATE\s+OR\s+REPLACE\s+${IDENT}`, 'i'));
  if (m) return { kind: 'replace', table: identName(m, 1) };
  m = s.match(new RegExp(String.raw`^\s*UPDATE(?:\s+OR\s+\w+)?\s+${IDENT}`, 'i'));
  if (m) return { kind: 'update', table: identName(m, 1) };
  m = s.match(new RegExp(String.raw`^\s*DELETE\s+FROM\s+${IDENT}`, 'i'));
  if (m) return { kind: 'delete', table: identName(m, 1) };
  return { kind: 'ddl' };   // CREATE/ALTER/DROP/PRAGMA/... -> alles neu laden
}

function decode(v) {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') { const n = Number(v.value); return Number.isSafeInteger(n) ? n : BigInt(v.value); }
  if (v.type === 'float') return Number(v.value);
  if (v.type === 'blob') return Buffer.from(v.base64 || '', 'base64');
  return v.value === undefined ? null : v.value;
}

class Replica {
  constructor(tdb, { syncMs = 15000 } = {}) {
    this.tdb = tdb;
    this.syncMs = syncMs;
    this.local = null;
    this.stmts = new Map();
    this.tables = [];          // bekannte Tabellen (Namen)
    this.info = new Map();     // name -> { rowid: bool, hasId: bool }
    this.children = new Map(); // name -> Set(abhängige Tabellen bei DELETE)
    this.schemaSig = '';
    this.dirty = new Set();
    this.needFull = true;
    this.lastFull = 0;
    this.stats = { localReads: 0, fullLoads: 0, tableLoads: 0, inline: 0 };
  }

  /* ---------- Lesen ---------- */
  ensureFresh() {
    if (this.needFull || !this.local || Date.now() - this.lastFull > this.syncMs) { this.reloadAll(); return; }
    if (this.dirty.size) this.reloadTables([...this.dirty]);
  }

  _stmt(sql) {
    let st = this.stmts.get(sql);
    if (!st) { st = this.local.prepare(sql); this.stmts.set(sql, st); }
    return st;
  }

  all(sql, args) {
    this.ensureFresh();
    this.stats.localReads += 1;
    return this._stmt(sql).all(...args);
  }

  get(sql, args) {
    this.ensureFresh();
    this.stats.localReads += 1;
    return this._stmt(sql).get(...args);
  }

  /* ---------- Laden ---------- */
  _openLocal(master) {
    const Database = require('better-sqlite3');
    if (this.local) { try { this.local.close(); } catch { /* egal */ } }
    this.local = new Database(':memory:');
    this.local.pragma('foreign_keys = OFF');
    this.stmts.clear();
    this.info.clear();
    this.children.clear();
    const tables = master.filter((m) => m.type === 'table' && !INTERNAL.test(m.name));
    for (const t of tables) this.local.exec(t.sql);
    for (const m of master.filter((x) => (x.type === 'index' || x.type === 'view') && !INTERNAL.test(x.name))) {
      try { this.local.exec(m.sql); } catch { /* nur Beschleunigung */ }
    }
    this.tables = tables.map((t) => t.name);
    for (const t of tables) {
      const cols = this.local.prepare(`PRAGMA table_info(${q(t.name)})`).all().map((c) => c.name);
      this.info.set(t.name, { rowid: !/WITHOUT\s+ROWID/i.test(t.sql), hasId: cols.includes('id') });
      // Fremdschlüssel mit ON DELETE CASCADE / SET NULL: Kind-Tabelle muss nach DELETE im Eltern-Teil neu geladen werden
      const re = new RegExp(String.raw`REFERENCES\s+${IDENT}\s*(?:\([^)]*\))?\s*ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT)`, 'gi');
      for (const m of t.sql.matchAll(re)) {
        const parent = identName(m, 1);
        if (!this.children.has(parent)) this.children.set(parent, new Set());
        this.children.get(parent).add(t.name);
      }
    }
    // transitiv (Kaskade über mehrere Ebenen)
    for (const [p, set] of this.children) {
      const stack = [...set];
      while (stack.length) {
        const c = stack.pop();
        for (const g of this.children.get(c) || []) if (!set.has(g) && g !== p) { set.add(g); stack.push(g); }
      }
    }
  }

  _replace(table, result) {
    const cols = (result.cols || []).map((c) => c.name);
    const local = this.local;
    local.prepare(`DELETE FROM ${q(table)}`).run();
    if (!cols.length || !(result.rows || []).length) return;
    const ins = local.prepare(`INSERT INTO ${q(table)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    for (const r of result.rows) ins.run(...r.map(decode));
  }

  _upsertRow(table, result) {
    const cols = (result.cols || []).map((c) => c.name);
    const row = (result.rows || [])[0];
    if (!cols.length || !row) return false;
    this._stmt(`INSERT OR REPLACE INTO ${q(table)} (${cols.map(q).join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...row.map(decode));
    return true;
  }

  reloadAll() {
    const known = this.tables.slice();
    const res = this.tdb._rawStatements([{ sql: MASTER_SQL, want_rows: true }, ...known.map((t) => ({ sql: `SELECT * FROM ${q(t)}`, want_rows: true }))]);
    if (res[0].type === 'error') throw new Error(`Turso: Schema konnte nicht gelesen werden: ${res[0].error && res[0].error.message}`);
    const master = res[0].result.rows.map((r) => ({ type: decode(r[0]), name: decode(r[1]), tbl_name: decode(r[2]), sql: decode(r[3]) }));
    const sig = JSON.stringify(master.filter((m) => !INTERNAL.test(m.name)).map((m) => [m.type, m.name, m.sql]));
    const data = new Map();
    known.forEach((t, i) => { if (res[i + 1] && res[i + 1].type !== 'error') data.set(t, res[i + 1].result); });
    if (sig !== this.schemaSig || !this.local) { this._openLocal(master); this.schemaSig = sig; }
    const missing = this.tables.filter((t) => !data.has(t));
    if (missing.length) {
      const more = this.tdb._rawStatements(missing.map((t) => ({ sql: `SELECT * FROM ${q(t)}`, want_rows: true })));
      missing.forEach((t, i) => {
        if (more[i].type === 'error') throw new Error(`Turso: Tabelle ${t} konnte nicht gelesen werden: ${more[i].error && more[i].error.message}`);
        data.set(t, more[i].result);
      });
    }
    this.local.transaction(() => { for (const t of this.tables) this._replace(t, data.get(t)); })();
    this.dirty.clear();
    this.needFull = false;
    this.lastFull = Date.now();
    this.stats.fullLoads += 1;
  }

  reloadTables(names) {
    if (names.some((n) => !this.info.has(n))) { this.reloadAll(); return; }
    const res = this.tdb._rawStatements(names.map((t) => ({ sql: `SELECT * FROM ${q(t)}`, want_rows: true })));
    if (res.some((r) => r.type === 'error')) { this.reloadAll(); return; }
    this.local.transaction(() => { names.forEach((t, i) => this._replace(t, res[i].result)); })();
    names.forEach((n) => this.dirty.delete(n));
    this.stats.tableLoads += names.length;
  }

  /* ---------- Schreiben ---------- */
  _markTable(table, withChildren) {
    if (!table || !this.info.has(table)) { this.needFull = true; return; }
    this.dirty.add(table);
    if (withChildren) for (const c of this.children.get(table) || []) this.dirty.add(c);
  }

  /** Nach einer schreibenden Anweisung ohne Sonderbehandlung */
  markWrite(sql) {
    const c = classify(sql);
    if (c.kind === 'tx' || c.kind === 'none') return;
    if (c.kind === 'ddl') { this.needFull = true; return; }
    this._markTable(c.table, c.kind === 'delete' || c.kind === 'replace');
  }

  /**
   * Plan für eine einzelne schreibende Anweisung außerhalb einer Transaktion:
   * liefert eine Zusatz-Abfrage, die in DERSELBEN Anfrage die geänderte Zeile mitliefert.
   * Rückgabe { extra, apply(mainResult, extraResult) } oder null.
   */
  plan(sql, args) {
    if (this.needFull || !this.local || !Array.isArray(args)) return null;
    const c = classify(sql);
    const info = c.table && this.info.get(c.table);
    if (!info) return null;
    if (c.kind === 'insert' && info.rowid && !/\b(ON\s+CONFLICT|RETURNING|SELECT|DEFAULT\s+VALUES)\b/i.test(sql)
      && /\)\s*VALUES\s*\([^()]*(\([^()]*\)[^()]*)*\)\s*;?\s*$/i.test(sql)) {
      return {
        extra: { sql: `SELECT * FROM ${q(c.table)} WHERE rowid = last_insert_rowid()`, want_rows: true },
        apply: (main, extra) => {
          if (!Number(main.affected_row_count)) return;
          if (!this._upsertRow(c.table, extra)) this._markTable(c.table, false);
          else this.stats.inline += 1;
        }
      };
    }
    const byId = /\bWHERE\s+id\s*=\s*\?\s*;?\s*$/i.test(sql) && info.hasId && countPlaceholders(sql) === args.length && args.length >= 1;
    // ID wie in der Anwendung (z. B. "12" aus der URL) für die Folgeabfrage sauber als Zahl
    const lastId = () => { const v = args[args.length - 1]; return typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v; };
    if (c.kind === 'update' && byId && !/\bRETURNING\b/i.test(sql)) {
      const id = lastId();
      if (id === undefined || id === null || (typeof id === 'object' && !Buffer.isBuffer(id))) return null;
      return {
        extra: { sql: `SELECT * FROM ${q(c.table)} WHERE id = ?`, args: [encodeValue(id)], want_rows: true },
        apply: (main, extra) => {
          if (!(extra.rows || []).length) this._stmt(`DELETE FROM ${q(c.table)} WHERE id = ?`).run(id);
          else this._upsertRow(c.table, extra);
          this.stats.inline += 1;
        }
      };
    }
    if (c.kind === 'delete' && byId && !/\bRETURNING\b/i.test(sql)) {
      const id = lastId();
      if (id === undefined || id === null || (typeof id === 'object' && !Buffer.isBuffer(id))) return null;
      return {
        extra: null,
        apply: () => {
          this._stmt(`DELETE FROM ${q(c.table)} WHERE id = ?`).run(id);
          for (const ch of this.children.get(c.table) || []) this.dirty.add(ch);   // Kaskaden
          this.stats.inline += 1;
        }
      };
    }
    return null;
  }

  close() { if (this.local) { try { this.local.close(); } catch { /* egal */ } } this.local = null; }
}

module.exports = { Replica, isLocalRead, classify, countPlaceholders };
