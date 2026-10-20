/**
 * v3: Hallen-TV / Dashboard (/tv bzw. /dashboard)
 *
 *   GET  /api/tv/data?key=TOKEN     alle Daten für den Kiosk-Slider (ohne Login, nur mit TV-Schlüssel)
 *   GET  /api/admin/tv              Konfiguration lesen (Admin)
 *   PUT  /api/admin/tv              Wechseldauer, aktive Screens, Lauftexte, Wetter-Ort (Admin)
 *   POST /api/admin/tv/regenerate   neuen TV-Schlüssel erzeugen (alter Link wird ungültig)
 */
const crypto = require('crypto');
const express = require('express');
const { db, getSetting, setSetting } = require('../db');
const { requireRole } = require('../auth');
const { buildWhiteboard } = require('../lib/whiteboard');
const { buildPacklist } = require('../lib/packlist');
const { loadingPlan } = require('../lib/loading');
const { activeWork } = require('../lib/queries');
const { hudData } = require('../lib/hub');
const { strOrNull, toNumOrNull, today, httpError, parseJSON } = require('../lib/util');

const router = express.Router();

const DEFAULT_TV = { enabled: true, token: '', interval: 18, screens: { tasks: true, event: true, stock: true, hall: true }, messages: [], weather: null };
const tvConfig = () => ({ ...DEFAULT_TV, ...(getSetting('tv', {}) || {}) });

/* ---------------- Wetter (optional, Open-Meteo, ohne API-Schlüssel) ---------------- */
let weatherCache = { at: 0, key: '', data: null };
const WEATHER_TEXT = {
  0: 'Klar', 1: 'Überwiegend klar', 2: 'Teilweise bewölkt', 3: 'Bedeckt', 45: 'Nebel', 48: 'Raureifnebel',
  51: 'Leichter Niesel', 53: 'Niesel', 55: 'Starker Niesel', 61: 'Leichter Regen', 63: 'Regen', 65: 'Starker Regen',
  66: 'Gefrierender Regen', 67: 'Gefrierender Regen', 71: 'Leichter Schnee', 73: 'Schnee', 75: 'Starker Schnee',
  80: 'Regenschauer', 81: 'Regenschauer', 82: 'Heftige Schauer', 85: 'Schneeschauer', 86: 'Schneeschauer', 95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel'
};

async function weather(cfg) {
  const w = cfg.weather;
  if (!w || !Number.isFinite(Number(w.lat)) || !Number.isFinite(Number(w.lon))) return null;
  const key = `${w.lat},${w.lon}`;
  if (weatherCache.key === key && Date.now() - weatherCache.at < 15 * 60000) return weatherCache.data;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code,wind_speed_10m,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FBerlin&forecast_days=3`;
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    const data = {
      place: w.name || '',
      temp: j.current && j.current.temperature_2m,
      wind: j.current && j.current.wind_speed_10m,
      code: j.current && j.current.weather_code,
      text: WEATHER_TEXT[j.current && j.current.weather_code] || '',
      days: (j.daily && j.daily.time || []).map((d, i) => ({
        date: d, max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i], rain: j.daily.precipitation_probability_max[i]
      }))
    };
    weatherCache = { at: Date.now(), key, data };
    return data;
  } catch {
    return weatherCache.key === key ? weatherCache.data : null; // offline: letzter bekannter Stand
  }
}

/* ---------------- Daten für den Kiosk ---------------- */
router.get('/tv/data', async (req, res, next) => {
  try {
    const cfg = tvConfig();
    const authed = req.user && req.user.role === 'admin';
    if (!authed && (!cfg.enabled || !cfg.token || req.query.key !== cfg.token)) throw httpError(401, 'TV-Schlüssel ungültig oder TV-Dashboard deaktiviert.');

    const t = today();
    const hall = getSetting('hall', { name: 'Halle' });
    const wb = buildWhiteboard();
    const vehicles = db.prepare(`SELECT v.id, v.name, v.model, v.color, v.status, v.slot_id, v.slot_pos, v.extern_location,
        (SELECT COUNT(*) FROM tasks t WHERE t.vehicle_id = v.id AND t.status = 'open') AS open_tasks
      FROM vehicles v ORDER BY v.name`).all();
    const slots = db.prepare("SELECT id, code, label, props, x, y, w, h FROM layout_objects WHERE type = 'slot' ORDER BY y, x").all()
      .map((s) => {
        const props = parseJSON(s.props, {});
        const occ = vehicles.filter((v) => v.slot_id === s.id).map((v) => ({ id: v.id, name: v.name, status: v.status, color: v.color, pos: v.slot_pos }));
        return { id: s.id, code: s.code, label: s.label, kind: props.kind || 'standard', capacity: Number(props.capacity) || 1, blocksLane: !!props.blocksLane, x: s.x, y: s.y, w: s.w, h: s.h, vehicles: occ };
      });
    const freePlaces = slots.reduce((a, s) => a + Math.max(0, s.capacity - s.vehicles.length), 0);

    const ev = db.prepare('SELECT * FROM events WHERE COALESCE(date_end, date_start) >= ? ORDER BY date_start, start_time LIMIT 1').get(t);
    let event = null;
    if (ev) {
      const pl = buildPacklist(ev.id);
      const lp = loadingPlan(ev.id);
      event = {
        id: ev.id, name: ev.name, date_start: ev.date_start, date_end: ev.date_end, start_time: ev.start_time, location: ev.location,
        vehicles: vehicles.filter((v) => db.prepare('SELECT 1 FROM event_vehicles WHERE event_id = ? AND vehicle_id = ?').get(ev.id, v.id)),
        packlist: { total: pl.stats.total, packed: pl.stats.packed, pct: pl.stats.total ? Math.round((pl.stats.packed / pl.stats.total) * 100) : 0 },
        loading: lp && lp.trailers.length ? { summary: lp.summary, rows: lp.rows.map((r) => ({ car: r.car.name, trailer: r.trailer_id ? (lp.trailers.find((x) => x.id === r.trailer_id) || {}).name : null, status: r.eval ? r.eval.status : null, issue: r.eval && r.eval.issues.find((i) => i.level !== 'info') ? r.eval.issues.find((i) => i.level !== 'info').text : null })) } : null
      };
    }

    const supplies = db.prepare("SELECT name, qty, min_qty, unit, category FROM supplies WHERE category = 'kuehlschrank' ORDER BY sort").all().map((s) => ({ ...s, low: s.qty < s.min_qty }));
    const driftActive = db.prepare("SELECT COUNT(*) AS c FROM tyres WHERE status = 'aktiv' AND class = 'drift'").get().c;
    const driftLoose = db.prepare("SELECT COUNT(*) AS c FROM tyres WHERE status = 'aktiv' AND class = 'drift' AND rim_id IS NULL").get().c;
    const burned = db.prepare("SELECT COUNT(*) AS c FROM tyres WHERE status = 'abgefahren'").get().c;
    const borrowed = db.prepare(`SELECT t.name, u.name AS user_name, v.name AS vehicle_name FROM tools t
      LEFT JOIN users u ON u.id = t.borrowed_by LEFT JOIN vehicles v ON v.id = t.borrowed_vehicle_id WHERE t.borrowed_by IS NOT NULL`).all();

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      now: new Date().toISOString(),
      config: { interval: cfg.interval, screens: cfg.screens, messages: cfg.messages },
      hall: { name: hall.name },
      work: activeWork(),
      tasks: { urgent: wb.urgent.slice(0, 8), hall: wb.hall.slice(0, 6), backlog: wb.backlog.length },
      vehicles,
      slots,
      freePlaces,
      extern: vehicles.filter((v) => !v.slot_id).map((v) => ({ name: v.name, where: v.extern_location || 'Paddock', status: v.status })),
      event,
      supplies,
      tyres: { driftActive, driftLoose, burned },
      borrowed,
      hud: hudData(),   // v4: kritische Ressourcen, Verbrauchsartikel, Dinge in der Schwebe
      weather: await weather(cfg)
    });
  } catch (err) { next(err); }
});

/* ---------------- Admin-Konfiguration ---------------- */
router.get('/admin/tv', requireRole('admin'), (_req, res) => res.json(tvConfig()));

router.put('/admin/tv', requireRole('admin'), (req, res) => {
  const cur = tvConfig();
  const b = req.body || {};
  const screens = { ...cur.screens };
  for (const k of ['tasks', 'event', 'stock', 'hall']) if (b.screens && b.screens[k] !== undefined) screens[k] = !!b.screens[k];
  if (!Object.values(screens).some(Boolean)) throw httpError(400, 'Mindestens ein Screen muss aktiv sein.');
  const lat = toNumOrNull(b.weather && b.weather.lat);
  const lon = toNumOrNull(b.weather && b.weather.lon);
  const next = {
    ...cur,
    enabled: b.enabled !== undefined ? !!b.enabled : cur.enabled,
    interval: Math.min(120, Math.max(5, Number(b.interval) || cur.interval)),
    screens,
    messages: Array.isArray(b.messages) ? b.messages.map((m) => String(m).trim()).filter(Boolean).slice(0, 20) : cur.messages,
    weather: b.weather === null ? null : (lat !== null && lon !== null ? { lat, lon, name: strOrNull(b.weather.name) || '' } : cur.weather)
  };
  if (!next.token) next.token = crypto.randomBytes(12).toString('hex');
  setSetting('tv', next);
  weatherCache = { at: 0, key: '', data: null };
  res.json(next);
});

router.post('/admin/tv/regenerate', requireRole('admin'), (_req, res) => {
  const cur = tvConfig();
  cur.token = crypto.randomBytes(12).toString('hex');
  setSetting('tv', cur);
  res.json(cur);
});

module.exports = router;
