/**
 * v5.3: Aktivitäts- und Audit-Log
 * ------------------------------------------------------------
 * Zwei Stufen in einer Tabelle (activity_logs):
 *   is_high_level = 1  Meilensteine: Anmeldung/Profilwechsel, Materialentnahme (Schnell-Verbrauch),
 *                      Fahrzeug umgeparkt, To-do erledigt oder pausiert, Setup geändert
 *   is_high_level = 0  Detail: jede Interaktion (Klicks aus dem Browser, jede Änderung über die API)
 *
 * Einträge werden kurz gepuffert und gesammelt in EINER Anweisung geschrieben
 * (mit Turso spart das pro Klick eine Netzwerk-Anfrage). Geheimnisse (PIN, Token, Passwörter, Schlüssel)
 * werden vor dem Speichern entfernt. Bestehende Tabellen werden nicht angefasst.
 */
const { db } = require('../db');

const FLUSH_MS = 1500;
const MAX_ROWS_PER_INSERT = 60;
const SECRET_KEY = /(pin|token|pass|secret|api[_-]?key|auth|cookie|session)/i;

const buf = [];
let timer = null;

function clip(s, n) {
  const t = String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Kopie ohne Geheimnisse, gekürzt (für details_json) */
function sanitize(v, depth = 0) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return clip(v, 300);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (depth > 3) return '…';
  if (Array.isArray(v)) return v.slice(0, 25).map((x) => sanitize(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    let n = 0;
    for (const [k, val] of Object.entries(v)) {
      if (SECRET_KEY.test(k)) { out[k] = '***'; continue; }
      if (n++ >= 30) { out['…'] = 'gekürzt'; break; }
      out[k] = sanitize(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!buf.length) return;
  const rows = buf.splice(0, buf.length);
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_INSERT) {
    const chunk = rows.slice(i, i + MAX_ROWS_PER_INSERT);
    const sql = `INSERT INTO activity_logs (user_id, user_name, action_type, description, details_json, is_high_level, created_at) VALUES ${chunk.map(() => '(?,?,?,?,?,?,?)').join(',')}`;
    const args = [];
    for (const r of chunk) args.push(r.user_id, r.user_name, r.action_type, r.description, r.details_json, r.is_high_level, r.created_at);
    try {
      db.prepare(sql).run(...args);
    } catch (err) {
      // Das Protokoll darf nie die eigentliche Arbeit blockieren
      console.warn(`[aktivität] ${chunk.length} Einträge konnten nicht gespeichert werden:`, err.message);
    }
  }
}

function schedule() {
  if (buf.length >= 200) { flush(); return; }
  if (!timer) {
    timer = setTimeout(flush, FLUSH_MS);
    if (timer.unref) timer.unref();
  }
}

/**
 * Eintrag ins Protokoll.
 * user: { id, name } (oder null für "unbekannt")
 */
function log(user, { type, text, details = null, high = false, at = null }) {
  if (!type || !text) return;
  let createdAt = new Date().toISOString();
  if (at) {
    const t = Date.parse(at);
    // Zeitstempel aus dem Browser nur übernehmen, wenn er plausibel ist (max. 1 Tag alt, nicht in der Zukunft)
    if (Number.isFinite(t) && t <= Date.now() + 60000 && t >= Date.now() - 86400000) createdAt = new Date(Math.min(t, Date.now())).toISOString();
  }
  let det = null;
  if (details !== null && details !== undefined) {
    try { det = JSON.stringify(sanitize(details)); } catch { det = null; }
    if (det && det.length > 4000) det = JSON.stringify({ gekuerzt: det.slice(0, 3900) });
  }
  buf.push({
    user_id: user && user.id ? Number(user.id) : null,
    user_name: user && user.name ? clip(user.name, 60) : 'Unbekannt',
    action_type: clip(type, 32),
    description: clip(text, 300),
    details_json: det,
    is_high_level: high ? 1 : 0,
    created_at: createdAt
  });
  schedule();
}

/** Meilenstein am Request vormerken: wird erst geschrieben, wenn die Anfrage erfolgreich war */
function mark(req, type, text, details = null, { high = true, user = null, always = false } = {}) {
  if (!req._activity) req._activity = [];
  req._activity.push({ type, text, details, high, user, always });
}

/* ---------- Detail-Protokoll für jede schreibende API-Anfrage ---------- */
const NOUN = {
  parts: 'Teil', tools: 'Werkzeug', boxes: 'Eurobox', tasks: 'Aufgabe', log: 'Wartungsheft-Eintrag', purchases: 'Budget-Posten',
  events: 'Event', vehicles: 'Fahrzeug', supplies: 'Vorrat', setups: 'Setup', tyres: 'Reifen', rims: 'Felge', trailers: 'Anhänger',
  consumables: 'Verbrauchsartikel', 'consumable-moves': 'Verbrauchsbuchung', 'shopping-list': 'Einkaufsliste', floating: 'Ablage (liegt rum)',
  layout: 'Hallen-Layout', blueprint: 'Blueprint', devices: 'Gerät', documents: 'Dokument', quickchecks: 'Quick-Check', work: 'Arbeit',
  settings: 'Einstellung', cars: 'KI-Serienmaße', users: 'Nutzer', hallpass: 'Hall Pass', import: 'CSV-Import', 'vehicle-models': 'Fahrzeug-Modell',
  tv: 'TV-Dashboard', dashboards: 'TV-Seite', backup: 'Sicherung', objects: 'Hallen-Objekt', hall: 'Hallenmaße'
};
const VERB = {
  done: 'erledigt', reopen: 'wieder geöffnet', borrow: 'genommen', return: 'zurückgegeben', lend: 'verliehen', back: 'wieder in der Halle',
  acquire: 'gekauft', move: 'umgeparkt', stop: 'beendet', current: 'als aktuell markiert', burn: 'abgefahren gebucht', unburn: 'zurückgebucht',
  dispose: 'entsorgt', undo: 'rückgängig gemacht', bought: 'gekauft', remove: 'entfernt', 'return-all': 'alles zurückgeräumt',
  'stock-in': 'eingelagert', use: 'entnommen', pause: 'pausiert', assign: 'zugewiesen', regenerate: 'neu erzeugt', order: 'sortiert',
  'quick-specs': 'Quick Specs gespeichert', specs: 'Daten gespeichert', documents: 'Dokument hochgeladen', commit: 'übernommen',
  preview: 'Vorschau erstellt', mount: 'montiert', unmount: 'demontiert', toggle: 'geschaltet', check: 'abgehakt', pack: 'gepackt',
  answer: 'beantwortet', loading: 'Beladung geändert', 'fetch-dimensions': 'abgefragt', 'link-part': 'verknüpft', 'unlink-part': 'Verknüpfung gelöst',
  'import-supply': 'übernommen', 'public-url': 'Adresse gespeichert'
};
const BASE_VERB = { POST: 'angelegt', PUT: 'geändert', PATCH: 'geändert', DELETE: 'gelöscht' };

function nameOf(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const v = obj.name || obj.title || obj.label || (obj.item && (obj.item.name || obj.item.title));
  return v ? clip(v, 80) : null;
}

function describe(req, res) {
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/^\/api\/?/, '');
  const segs = path.split('/').filter(Boolean);
  if (segs[0] === 'admin' && segs.length > 1) segs.shift();
  const nounKey = segs[0] || 'api';
  const noun = NOUN[nounKey] || nounKey;
  const id = segs.find((s) => /^\d+$/.test(s));
  const tail = segs.filter((s, i) => i > 0 && !/^\d+$/.test(s));
  const action = tail.length ? tail[tail.length - 1] : null;
  const verb = (action && VERB[action]) || (action ? `${BASE_VERB[req.method] || ''} (${action})`.trim() : BASE_VERB[req.method] || req.method);
  const nm = nameOf(res._hallePayload) || nameOf(req.body);
  const text = `${noun} ${verb}${nm ? `: „${nm}“` : ''}${id && !nm ? ` (#${id})` : ''}`;
  return { type: `api_${String(action || req.method).toLowerCase().replace(/[^a-z_-]/g, '').slice(0, 20)}`, text };
}

const SKIP_GENERIC = /^\/api\/(activity|auth|tv)\b/;

/** Middleware: Detail-Eintrag für jede erfolgreiche schreibende Anfrage, plus vorgemerkte Meilensteine */
function middleware(req, res, next) {
  const orig = res.json.bind(res);
  res.json = (body) => { res._hallePayload = body; return orig(body); };
  res.on('finish', () => {
    try {
      const ok = res.statusCode < 400;
      const marks = req._activity || [];
      for (const m of marks) {
        if (!ok && !m.always) continue;
        log(m.user || req.user, { type: m.type, text: m.text, details: m.details, high: m.high });
      }
      if (!ok || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
      if (!req.user || SKIP_GENERIC.test(req.originalUrl || req.url || '')) return;
      if (marks.length) return;   // schon mit eigener, sprechender Beschreibung protokolliert
      const d = describe(req, res);
      log(req.user, { type: d.type, text: d.text, details: { method: req.method, path: String(req.originalUrl || req.url || '').split('?')[0], body: req.body && Object.keys(req.body).length ? req.body : undefined }, high: false });
    } catch (err) {
      console.warn('[aktivität] Protokoll übersprungen:', err.message);
    }
  });
  next();
}

/** Grobe Geräteangabe aus dem User-Agent (ohne IP) */
function deviceOf(req) {
  const ua = String(req.headers['user-agent'] || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Gerät';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const pwa = /standalone/i.test(String(req.headers['x-halle-display'] || '')) ? ' (App)' : '';
  return `${os}${br ? ` · ${br}` : ''}${pwa}`;
}

// Beim Beenden nichts verlieren
process.on('exit', flush);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { flush(); } catch { /* egal */ } });

module.exports = { log, mark, flush, middleware, sanitize, deviceOf, describe };
