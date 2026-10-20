/**
 * Chill-Ecke & Kühlschrank-Radar (Vorräte mit Mindestbestand) + Drift-Setup-Sheets + LED-Ticker.
 *
 *   GET    /api/supplies                 Vorräte inkl. low-Flag und letzter Bewegung
 *   POST   /api/supplies/:id/adjust      { delta }  Schnell-Buttons +1 / -1 / +Kiste
 *   GET    /api/vehicles/:id/setups      Setup-Historie eines Autos
 *   POST   /api/setups, PUT /api/setups/:id, POST /api/setups/:id/current
 *   GET    /api/ticker                   Daten für das LED-Laufband (nächstes Event, To-Dos, Packliste, Vorräte)
 */
const express = require('express');
const { db } = require('../db');
const { buildPacklist } = require('../lib/packlist');
const { pick, insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, parseJSON, today, nowIso } = require('../lib/util');

const router = express.Router();

/* ======================= Vorräte ======================= */
function listSupplies() {
  const last = db.prepare(`SELECT m.delta, m.created_at, u.name AS user_name FROM supply_moves m LEFT JOIN users u ON u.id = m.user_id
    WHERE m.supply_id = ? ORDER BY m.id DESC LIMIT 1`);
  // v4.2: Kühlschrank-Radar = nur Getränke & Snacks. Alte Werkstatt-Vorräte bleiben in der Datenbank, werden aber hier nicht mehr gezeigt
  return db.prepare("SELECT * FROM supplies WHERE category = 'kuehlschrank' ORDER BY sort, name").all()
    .map((s) => ({ ...s, low: s.qty < s.min_qty, empty: s.qty <= 0, last: last.get(s.id) || null }));
}

const supplySchema = {
  name: (v) => strOrNull(v) || 'Artikel',
  category: () => 'kuehlschrank',   // v4.2: Werkstatt-Betriebsstoffe laufen über Inventar + Kritische Liste
  unit: (v) => strOrNull(v) || 'Stk',
  qty: (v) => Math.max(0, toIntOrNull(v) ?? 0),
  min_qty: (v) => Math.max(0, toIntOrNull(v) ?? 0),
  pack_size: (v) => Math.max(1, toIntOrNull(v) || 6),
  sort: (v) => toIntOrNull(v) ?? 0
};

router.get('/supplies', (_req, res) => res.json(listSupplies()));

router.post('/supplies', (req, res) => {
  insertRow('supplies', { ...pick(req.body, supplySchema), created_at: nowIso() });
  res.status(201).json(listSupplies());
});

router.put('/supplies/:id', (req, res) => {
  updateRow('supplies', req.params.id, pick(req.body, supplySchema, { partial: true }));
  res.json(listSupplies());
});

router.delete('/supplies/:id', (req, res) => {
  db.prepare('DELETE FROM supplies WHERE id = ?').run(req.params.id);
  res.json(listSupplies());
});

router.post('/supplies/:id/adjust', (req, res) => {
  const s = mustGet('supplies', req.params.id, 'Artikel');
  const delta = toIntOrNull(req.body.delta) || 0;
  if (!delta) throw httpError(400, 'delta fehlt.');
  const next = Math.max(0, s.qty + delta);
  db.transaction(() => {
    db.prepare('UPDATE supplies SET qty = ? WHERE id = ?').run(next, s.id);
    insertRow('supply_moves', { supply_id: s.id, delta: next - s.qty, user_id: req.user.id, created_at: nowIso() });
  })();
  const list = listSupplies();
  res.json({ item: list.find((x) => x.id === s.id), becameLow: next < s.min_qty && s.qty >= s.min_qty, list });
});

/* ======================= Setups ======================= */
const setupSchema = {
  title: (v) => strOrNull(v) || 'Setup',
  event_id: toIntOrNull,
  track: strOrNull,
  setup_date: (v) => strOrNull(v) || today(),
  data: (v) => JSON.stringify(v && typeof v === 'object' ? v : {}),
  rating: (v) => { const n = toIntOrNull(v); return n ? Math.min(5, Math.max(1, n)) : null; },
  notes: strOrNull,
  // v5.2: Spur in mm (Summe je Achse, + = Vorspur, - = Nachspur)
  toe_front_mm: (v) => { const n = Number(String(v ?? '').replace(',', '.')); return v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100; },
  toe_rear_mm: (v) => { const n = Number(String(v ?? '').replace(',', '.')); return v === '' || v === null || v === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100; }
};
const serializeSetup = (s) => ({ ...s, data: parseJSON(s.data, {}) });

router.get('/vehicles/:id/setups', (req, res) => {
  res.json(db.prepare(`SELECT s.*, e.name AS event_name, u.name AS created_by_name FROM setups s
    LEFT JOIN events e ON e.id = s.event_id LEFT JOIN users u ON u.id = s.created_by
    WHERE s.vehicle_id = ? ORDER BY s.is_current DESC, s.setup_date DESC, s.id DESC`).all(req.params.id).map(serializeSetup));
});

router.post('/setups', (req, res) => {
  const vehicleId = toIntOrNull(req.body.vehicle_id);
  mustGet('vehicles', vehicleId, 'Fahrzeug');
  let id;
  db.transaction(() => {
    if (req.body.is_current) db.prepare('UPDATE setups SET is_current = 0 WHERE vehicle_id = ?').run(vehicleId);
    id = insertRow('setups', { ...pick(req.body, setupSchema), vehicle_id: vehicleId, is_current: req.body.is_current ? 1 : 0, created_by: req.user.id, created_at: nowIso() });
  })();
  res.status(201).json(serializeSetup(mustGet('setups', id)));
});

router.put('/setups/:id', (req, res) => {
  mustGet('setups', req.params.id, 'Setup');
  updateRow('setups', req.params.id, pick(req.body, setupSchema, { partial: true }));
  res.json(serializeSetup(mustGet('setups', req.params.id)));
});

router.post('/setups/:id/current', (req, res) => {
  const s = mustGet('setups', req.params.id, 'Setup');
  db.transaction(() => {
    db.prepare('UPDATE setups SET is_current = 0 WHERE vehicle_id = ?').run(s.vehicle_id);
    db.prepare('UPDATE setups SET is_current = 1 WHERE id = ?').run(s.id);
  })();
  res.json({ ok: true });
});

router.delete('/setups/:id', (req, res) => {
  db.prepare('DELETE FROM setups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ======================= LED-Ticker ======================= */
router.get('/ticker', (_req, res) => {
  const t = today();
  const ev = db.prepare('SELECT * FROM events WHERE COALESCE(date_end, date_start) >= ? ORDER BY date_start, start_time LIMIT 1').get(t);
  const low = listSupplies().filter((s) => s.low).map((s) => ({ name: s.name, qty: s.qty, unit: s.unit }));
  if (!ev) return res.json({ event: null, vehicles: [], packlist: null, low });
  const vehicles = db.prepare(`SELECT v.id, v.name, v.status,
      (SELECT COUNT(*) FROM tasks t WHERE t.vehicle_id = v.id AND t.status = 'open') AS open_tasks
    FROM vehicles v JOIN event_vehicles ev ON ev.vehicle_id = v.id WHERE ev.event_id = ? ORDER BY v.name`).all(ev.id);
  const pl = buildPacklist(ev.id);
  const drift = db.prepare("SELECT COUNT(*) AS c FROM tyres WHERE status = 'aktiv' AND class = 'drift'").get().c;
  res.json({
    event: { id: ev.id, name: ev.name, date_start: ev.date_start, date_end: ev.date_end, start_time: ev.start_time, location: ev.location },
    vehicles,
    packlist: pl ? { total: pl.stats.total, packed: pl.stats.packed, pct: pl.stats.total ? Math.round((pl.stats.packed / pl.stats.total) * 100) : 0 } : null,
    driftTyres: drift,
    low
  });
});

module.exports = router;
