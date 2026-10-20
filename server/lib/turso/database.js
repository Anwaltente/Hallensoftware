/**
 * Turso / libSQL als Datenbank, mit derselben Schnittstelle wie better-sqlite3
 * ------------------------------------------------------------
 * Unterstützt genau das, was HALLE//OS benutzt:
 *   db.prepare(sql).get(...) / .all(...) / .run(...)  -> { changes, lastInsertRowid }
 *   db.exec(sql)            (auch mehrere Anweisungen, z. B. das Schema)
 *   db.transaction(fn)      (echte Transaktion auf dem Turso-Server, verschachtelt per SAVEPOINT)
 *   db.pragma('...')        (journal_mode wird ignoriert, foreign_keys gilt für jede Anfrage)
 *   db.backup(datei)        (Kopie der Turso-Datenbank als normale SQLite-Datei, z. B. für den Admin-Download)
 *
 * Protokoll: Hrana über HTTP (POST <url>/v2/pipeline, Authorization: Bearer <Token>), siehe
 * https://docs.turso.tech/sdk/http/reference. Jede Anfrage ist eine kurze, unabhängige Verbindung;
 * Transaktionen laufen über einen "baton" auf derselben Verbindung.
 */
const { SyncHttp } = require('./sync-http');
const { Replica, isLocalRead } = require('./replica');

/* ---------------- Werte umwandeln ---------------- */
function encodeValue(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (typeof v === 'bigint') return { type: 'integer', value: v.toString() };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { type: 'null' };
    return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? { type: 'integer', value: String(v) } : { type: 'float', value: v };
  }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(v).toString('base64') };
  if (v instanceof Date) return { type: 'text', value: v.toISOString() };
  return { type: 'text', value: String(v) };
}

function decodeValue(v) {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') { const n = Number(v.value); return Number.isSafeInteger(n) ? n : BigInt(v.value); }
  if (v.type === 'float') return Number(v.value);
  if (v.type === 'text') return v.value;
  if (v.type === 'blob') return Buffer.from(v.base64 || '', 'base64');
  return v.value === undefined ? null : v.value;
}

/** Fehler wie bei better-sqlite3 (mit .code), damit die Fehlerbehandlung gleich bleibt */
function sqlError(err, sql) {
  const message = (err && err.message) || 'Unbekannter Datenbankfehler';
  const e = new Error(message.replace(/^SQLite error:\s*/i, ''));
  let code = (err && err.code) || 'SQLITE_ERROR';
  if (/FOREIGN KEY constraint failed/i.test(message)) code = 'SQLITE_CONSTRAINT_FOREIGNKEY';
  else if (/UNIQUE constraint failed/i.test(message)) code = 'SQLITE_CONSTRAINT_UNIQUE';
  else if (/NOT NULL constraint failed/i.test(message)) code = 'SQLITE_CONSTRAINT_NOTNULL';
  else if (/CHECK constraint failed/i.test(message)) code = 'SQLITE_CONSTRAINT_CHECK';
  else if (/PRIMARY KEY/i.test(message) && /constraint/i.test(message)) code = 'SQLITE_CONSTRAINT_PRIMARYKEY';
  e.code = code;
  e.sql = sql;
  return e;
}

/* ---------------- SQL in einzelne Anweisungen zerlegen (für db.exec) ---------------- */
function splitSql(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  let depth = 0;   // BEGIN ... END in Triggern
  const s = String(sql);
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '-' && n === '-') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j + 1; cur += ' '; continue; }
    if (c === '/' && n === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; cur += ' '; continue; }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const end = c === '[' ? ']' : c;
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === end) { if (end !== ']' && s[j + 1] === end) { j += 2; continue; } break; }
        j += 1;
      }
      cur += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_]/.test(s[i - 1] || '')) {
      const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      const w = m[0].toUpperCase();
      if (w === 'BEGIN' && /CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER/i.test(cur)) depth += 1;
      if (w === 'END' && depth > 0) depth -= 1;
      cur += m[0];
      i += m[0].length;
      continue;
    }
    if (c === ';' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; i += 1; continue; }
    cur += c;
    i += 1;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ---------------- Statement ---------------- */
function normArgs(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}
const isNamed = (args) => args.length === 1 && args[0] && typeof args[0] === 'object' && !Buffer.isBuffer(args[0]) && !(args[0] instanceof Date) && !(args[0] instanceof Uint8Array);

class TursoStatement {
  constructor(db, sql) {
    this.db = db;
    this.source = sql;
    this.reader = /^\s*(SELECT|PRAGMA|WITH|VALUES|EXPLAIN)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
    this.localRead = isLocalRead(sql);
    this._raw = false;
    this._pluck = false;
  }

  _stmt(args) {
    const stmt = { sql: this.source, want_rows: true };
    if (isNamed(args)) {
      const obj = args[0];
      const prefixes = {};
      for (const m of this.source.matchAll(/([:@$])([A-Za-z_][A-Za-z0-9_]*)/g)) prefixes[m[2]] = m[1];
      stmt.named_args = Object.entries(obj).map(([k, v]) => ({ name: `${prefixes[k] || ':'}${k}`, value: encodeValue(v) }));
    } else {
      stmt.args = args.map(encodeValue);
    }
    return stmt;
  }

  _rows(result) {
    const cols = (result.cols || []).map((c) => c.name);
    return (result.rows || []).map((r) => {
      const o = {};
      const vals = r.map(decodeValue);
      cols.forEach((name, i) => { o[name] = vals[i]; });
      return o;
    });
  }

  _shape(rows) {
    if (this._pluck) return rows.map((o) => Object.values(o)[0]);
    if (this._raw) return rows.map((o) => Object.values(o));
    return rows;
  }

  all(...args) {
    const a = normArgs(args);
    if (this.localRead && this.db._useReplica()) return this._shape(this.db.replica.all(this.source, a));
    return this._shape(this._rows(this.db._write(this._stmt(a), this.source, a)));
  }

  get(...args) {
    const a = normArgs(args);
    if (this.localRead && this.db._useReplica()) { const r = this.db.replica.get(this.source, a); return r === undefined ? undefined : this._shape([r])[0]; }
    return this.all(...a)[0];
  }

  iterate(...args) { return this.all(...args)[Symbol.iterator](); }

  run(...args) {
    const a = normArgs(args);
    const r = this.db._write(this._stmt(a), this.source, a);
    const id = r.last_insert_rowid;
    return { changes: Number(r.affected_row_count || 0), lastInsertRowid: id === null || id === undefined ? 0 : Number(id) };
  }

  pluck(on = true) { this._pluck = !!on; return this; }
  raw(on = true) { this._raw = !!on; return this; }
  columns() { return []; }
}

/* ---------------- Datenbank ---------------- */
class TursoDatabase {
  constructor({ url, token, timeoutMs = 30000, debug = !!process.env.HALLE_DB_DEBUG, replica = !/^(0|nein|no|false|aus|off)$/i.test(String(process.env.HALLE_TURSO_REPLICA || '')) } = {}) {
    if (!url) throw new Error('Turso-URL fehlt.');
    this.url = url.replace(/\/+$/, '');
    this.token = token || null;
    this.http = new SyncHttp({ timeoutMs });
    this.fk = true;            // PRAGMA foreign_keys gilt je Verbindung, daher bei jeder Anfrage mitschicken
    this.stream = null;        // offene Transaktion { baton, baseUrl }
    this.depth = 0;            // Verschachtelung von db.transaction()
    this.debug = debug;
    this.stats = { requests: 0, statements: 0, ms: 0 };
    this.name = `${this.url} (Turso)`;
    this.open = true;
    this.memory = false;
    this.readonly = false;
    const syncS = Number(process.env.HALLE_TURSO_SYNC_S);
    this.replica = replica ? new Replica(this, { syncMs: (Number.isFinite(syncS) && syncS > 0 ? syncS : 15) * 1000 }) : null;
  }

  get inTransaction() { return this.depth > 0; }

  /** Lesen aus dem Spiegel nur außerhalb von Transaktionen (in Transaktionen direkt in Turso) */
  _useReplica() { return !!this.replica && !this.stream; }

  _headers() {
    const h = { 'content-type': 'application/json' };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  /** Eine Hrana-Pipeline senden; gibt die Ergebnisliste zurück */
  _pipeline(requests) {
    const base = (this.stream && this.stream.baseUrl) || this.url;
    const body = JSON.stringify({ baton: this.stream ? this.stream.baton : null, requests });
    const t0 = Date.now();
    const res = this.http.post(`${base}/v2/pipeline`, this._headers(), body);
    this.stats.requests += 1;
    this.stats.ms += Date.now() - t0;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Turso lehnt den Zugriff ab (HTTP ${res.status}). Ist der Auth-Token richtig und noch gültig?`);
    }
    if (res.status === 404) throw new Error(`Turso-Datenbank nicht gefunden (HTTP 404): ${this.url}`);
    if (res.status < 200 || res.status >= 300) {
      let msg = res.text;
      try { const j = JSON.parse(res.text); msg = j.message || j.error || msg; } catch { /* Text lassen */ }
      throw new Error(`Turso-Fehler (HTTP ${res.status}): ${String(msg).slice(0, 300)}`);
    }
    let json;
    try { json = JSON.parse(res.text); } catch { throw new Error('Turso: ungültige Antwort (kein JSON).'); }
    if (this.stream) {
      this.stream.baton = json.baton || null;
      if (json.base_url) this.stream.baseUrl = json.base_url;
    }
    if (this.debug) console.log(`[turso] ${requests.length} Anfrage(n) in ${Date.now() - t0} ms: ${requests.filter((r) => r.stmt).map((r) => r.stmt.sql.replace(/\s+/g, ' ').slice(0, 60)).slice(1, 3).join(' | ')}`);
    return json.results || [];
  }

  _fkReq() { return { type: 'execute', stmt: { sql: `PRAGMA foreign_keys = ${this.fk ? 'ON' : 'OFF'}`, want_rows: false } }; }

  /**
   * Mehrere Anweisungen in EINER Anfrage; liefert je Anweisung { type: 'ok', result } oder { type: 'error', error }.
   * Wirft nur bei Verbindungs-/Zugriffsfehlern.
   */
  _rawStatements(stmts) {
    this.stats.statements += stmts.length;
    const reqs = stmts.map((stmt) => ({ type: 'execute', stmt }));
    let results;
    if (this.stream) {
      if (!this.stream.baton && this.stream.started) throw new Error('Turso: Transaktion wurde vom Server beendet (Zeitüberschreitung?).');
      const first = !this.stream.started;
      results = this._pipeline(first ? [this._fkReq(), ...reqs] : reqs);
      this.stream.started = true;
      if (first) results = results.slice(1);
    } else {
      results = this._pipeline([this._fkReq(), ...reqs, { type: 'close' }]).slice(1, 1 + reqs.length);
    }
    return stmts.map((_s, i) => {
      const r = results[i];
      if (!r || r.type === 'error') return { type: 'error', error: (r && r.error) || { message: 'keine Antwort' } };
      return { type: 'ok', result: (r.response && r.response.result) || {} };
    });
  }

  /** Mehrere Anweisungen, Fehler werden geworfen; markiert Änderungen für den Lese-Spiegel */
  _executeMany(stmts) {
    const res = this._rawStatements(stmts);
    if (this.replica) stmts.forEach((s, i) => { if (res[i].type === 'ok' && !isLocalRead(s.sql)) this.replica.markWrite(s.sql); });
    return res.map((r, i) => {
      if (r.type === 'error') {
        if (this.replica && !isLocalRead(stmts[i].sql)) this.replica.markWrite(stmts[i].sql);
        throw sqlError(r.error, stmts[i].sql);
      }
      return r.result;
    });
  }

  _execute(stmt) { return this._executeMany([stmt])[0]; }

  /** Schreibende (oder in Transaktionen lesende) Anweisung ausführen und den Spiegel nachziehen */
  _write(stmt, sql, args) {
    if (!this.replica || this.stream) return this._execute(stmt);
    const plan = this.replica.plan(sql, args);
    if (!plan) return this._execute(stmt);
    const res = this._rawStatements(plan.extra ? [stmt, plan.extra] : [stmt]);
    if (res[0].type === 'error') { this.replica.markWrite(sql); throw sqlError(res[0].error, sql); }
    try {
      if (plan.extra && res[1].type === 'error') this.replica.markWrite(sql);
      else plan.apply(res[0].result, plan.extra ? res[1].result : null);
    } catch {
      this.replica.markWrite(sql);   // im Zweifel neu laden
    }
    return res[0].result;
  }

  prepare(sql) { return new TursoStatement(this, sql); }

  exec(sql) {
    const parts = splitSql(sql);
    if (!parts.length) return this;
    // in Blöcken, damit eine einzelne Anfrage nicht riesig wird
    for (let i = 0; i < parts.length; i += 200) this._executeMany(parts.slice(i, i + 200).map((s) => ({ sql: s, want_rows: false })));
    return this;
  }

  pragma(source, { simple = false } = {}) {
    const s = String(source).trim();
    const fk = s.match(/^foreign_keys\s*=\s*(\w+)/i);
    if (fk) { this.fk = /^(on|1|true|yes)$/i.test(fk[1]); return []; }
    if (/^journal_mode/i.test(s)) return simple ? 'wal' : [{ journal_mode: 'wal' }];   // verwaltet Turso selbst
    const rows = this.prepare(`PRAGMA ${s}`).all();
    if (simple) return rows.length ? Object.values(rows[0])[0] : undefined;
    return rows;
  }

  transaction(fn) {
    const self = this;
    const wrapped = function transactionWrapper(...args) {
      if (self.depth > 0) {
        const name = `halle_sp_${self.depth}`;
        self._execute({ sql: `SAVEPOINT ${name}`, want_rows: false });
        self.depth += 1;
        try {
          const r = fn.apply(this, args);
          self.depth -= 1;
          self._execute({ sql: `RELEASE ${name}`, want_rows: false });
          return r;
        } catch (err) {
          self.depth -= 1;
          try { self._executeMany([{ sql: `ROLLBACK TO ${name}`, want_rows: false }, { sql: `RELEASE ${name}`, want_rows: false }]); } catch { /* Fehler unten */ }
          throw err;
        }
      }
      self.stream = { baton: null, baseUrl: null, started: false, t0: Date.now() };
      self.depth = 1;
      try {
        self._execute({ sql: 'BEGIN', want_rows: false });
        const r = fn.apply(this, args);
        self._finish('COMMIT');
        return r;
      } catch (err) {
        try { self._finish('ROLLBACK'); } catch { /* ursprünglichen Fehler melden */ }
        throw err;
      } finally {
        self.depth = 0;
        self.stream = null;
      }
    };
    ['deferred', 'immediate', 'exclusive'].forEach((k) => { wrapped[k] = wrapped; });
    return wrapped;
  }

  _finish(word) {
    if (!this.stream) return;
    const took = Date.now() - (this.stream.t0 || Date.now());
    if (took > 3000) console.warn(`[turso] Transaktion dauerte ${took} ms (Turso erlaubt etwa 5 s).`);
    if (!this.stream.baton && this.stream.started) { this.stream = null; if (word === 'COMMIT') throw new Error('Turso: Transaktion abgelaufen, Änderungen wurden nicht gespeichert.'); return; }
    const results = this._pipeline([{ type: 'execute', stmt: { sql: word, want_rows: false } }, { type: 'close' }]);
    this.stream = null;
    const r = results[0];
    if (!r || r.type === 'error') throw sqlError(r && r.error, word);
  }

  /** Verbindung + Zugang prüfen (immer direkt in Turso); liefert die Anzahl Tabellen */
  ping() {
    const r = this._execute({ sql: "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'", want_rows: true });
    return Number(decodeValue(r.rows[0][0]));
  }

  /** Spiegel jetzt vollständig laden (z. B. beim Start) */
  warmup() { if (this.replica) this.replica.reloadAll(); }

  /**
   * Komplette Kopie als SQLite-Datei schreiben (gleiche Schnittstelle wie better-sqlite3: Promise).
   * Liest alle Tabellen in einer Anfrage und baut mit better-sqlite3 eine normale .db-Datei.
   */
  backup(file) {
    return new Promise((resolve, reject) => {
      try { dumpToFile(this, file); resolve({ totalPages: 0, remainingPages: 0 }); } catch (err) { reject(err); }
    });
  }

  close() { this.open = false; if (this.replica) this.replica.close(); this.http.close(); return this; }
}

/** Alle Tabellen/Indizes/Zeilen der Turso-Datenbank in eine lokale SQLite-Datei schreiben */
function dumpToFile(tdb, file) {
  const fs = require('fs');
  const Database = require('better-sqlite3');
  const mres = tdb._execute({ sql: "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid", want_rows: true });
  const master = mres.rows.map((r) => ({ type: decodeValue(r[0]), name: decodeValue(r[1]), tbl_name: decodeValue(r[2]), sql: decodeValue(r[3]) }));
  const tables = master.filter((m) => m.type === 'table' && !/^_litestream|^libsql_/i.test(m.name));
  // eine Anfrage für alle Tabellen (je Tabelle mit typeof, damit Ganzzahl/Kommazahl exakt erhalten bleiben)
  const results = tables.length ? tdb._executeMany(tables.map((t) => ({ sql: `SELECT * FROM "${t.name.replace(/"/g, '""')}"`, want_rows: true }))) : [];
  let seq = [];
  try { seq = tdb._execute({ sql: 'SELECT name, seq FROM sqlite_sequence', want_rows: true }).rows.map((r) => ({ name: decodeValue(r[0]), seq: decodeValue(r[1]) })); } catch { seq = []; }
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const out = new Database(file);
  try {
    out.pragma('foreign_keys = OFF');
    out.transaction(() => {
      tables.forEach((t, i) => {
        out.exec(t.sql);
        const res = results[i];
        const cols = (res.cols || []).map((c) => `"${String(c.name).replace(/"/g, '""')}"`);
        if (!cols.length || !(res.rows || []).length) return;
        const ins = out.prepare(`INSERT INTO "${t.name.replace(/"/g, '""')}" (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
        for (const row of res.rows) {
          ins.run(...row.map((v) => {
            if (!v || v.type === 'null') return null;
            if (v.type === 'integer') return BigInt(v.value);
            if (v.type === 'float') return Number(v.value);
            if (v.type === 'blob') return Buffer.from(v.base64 || '', 'base64');
            return v.value;
          }));
        }
      });
      for (const m of master.filter((x) => x.type !== 'table')) { try { out.exec(m.sql); } catch { /* Index/Trigger optional */ } }
      for (const s of seq) {
        try {
          if (!out.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(s.seq, s.name).changes) {
            out.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(s.name, s.seq);
          }
        } catch { /* egal */ }
      }
    })();
  } finally {
    out.close();
  }
}

module.exports = { TursoDatabase, splitSql, encodeValue, decodeValue, dumpToFile };
