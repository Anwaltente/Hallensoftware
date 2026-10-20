/**
 * Kleine, wiederverwendbare Helfer für Routen.
 */
const { db } = require('../db');

const TZ = process.env.HALLE_TZ || 'Europe/Berlin';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const httpError = (status, message) => new HttpError(status, message);

const nowIso = () => new Date().toISOString();

/** Heutiges Datum (YYYY-MM-DD) in der Hallen-Zeitzone. */
function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(toDate + 'T00:00:00Z') - Date.parse(fromDate + 'T00:00:00Z')) / 86400000);
}

const toBool = (v) => (v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0);
const toIntOrNull = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.trunc(Number(v)));
const toNumOrNull = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(String(v).replace(',', '.'))) ? null : Number(String(v).replace(',', '.')));
const strOrNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

function parseJSON(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

/**
 * Baut aus einem Request-Body einen sauberen Datensatz.
 * schema: { spalte: konverter }  (nur bekannte Spalten werden übernommen)
 */
function pick(body, schema, { partial = false } = {}) {
  const out = {};
  for (const [key, conv] of Object.entries(schema)) {
    if (body[key] === undefined) { if (!partial) out[key] = conv(undefined); continue; }
    out[key] = conv(body[key]);
  }
  return out;
}

/** v5.1: IDs aus URL/Body ("12") als Zahl, damit jede Datenbank (lokal oder Turso) sie gleich behandelt */
const normId = (id) => (typeof id === 'string' && /^\s*-?\d+\s*$/.test(id) ? Number(id) : id);
/** v5.1: undefined ist kein gültiger SQL-Wert: wird zu NULL */
const cleanVal = (v) => (v === undefined ? null : v);

function insertRow(table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  return db.prepare(sql).run(...keys.map((k) => cleanVal(data[k]))).lastInsertRowid;
}

function updateRow(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  const info = db.prepare(sql).run(...keys.map((k) => cleanVal(data[k])), normId(id));
  if (!info.changes) throw httpError(404, 'Eintrag nicht gefunden.');
}

function mustGet(table, id, label = 'Eintrag') {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(normId(id));
  if (!row) throw httpError(404, `${label} nicht gefunden.`);
  return row;
}

/** Normalisiert Namen für die Deduplizierung (Groß/Klein, Leerzeichen). */
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

module.exports = {
  normId, cleanVal,
  TZ, HttpError, httpError, nowIso, today, daysBetween,
  toBool, toIntOrNull, toNumOrNull, strOrNull, parseJSON, pick, insertRow, updateRow, mustGet, norm
};
