/**
 * Drift-Tyre Hub: Reifen, Felgen, Kompletträder, virtuelles Montieren und die 1-Klick-Burner-Funktion.
 *
 *   GET  /api/tyrehub?vehicleId=          Gesamtübersicht (Reifen, Felgen, Statistik)
 *   POST /api/tyres            { qty, ... } legt qty einzelne Reifen an
 *   POST /api/rims             { qty, ... } legt qty einzelne Felgen an
 *   POST /api/tyres/:id/mount  { rim_id }   Reifen auf Felge = Komplettrad
 *   POST /api/tyres/:id/unmount { to }      Reifen abziehen (to: 'lager' | 'abgefahren')
 *   POST /api/tyres/burn       { vehicle_id, count = 2 }  "-2 Burned"
 *   POST /api/tyres/unburn     { ids }      Rückgängig
 *   POST /api/tyres/dispose    { ids } | { all: true }  Altreifen austragen (nur Status abgefahren)
 */
const express = require('express');
const { db } = require('../db');
const { pick, insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, nowIso } = require('../lib/util');

const router = express.Router();

const CONDITIONS = ['neu', 'training', 'burner'];
const CLASSES = ['drift', 'strasse'];

const tyreSchema = {
  dimension: (v) => strOrNull(v) || 'unbekannt',
  brand: strOrNull,
  model: strOrNull,
  condition: (v) => (CONDITIONS.includes(v) ? v : 'neu'),
  class: (v) => (CLASSES.includes(v) ? v : 'drift'),
  vehicle_id: toIntOrNull,
  dot: strOrNull,
  notes: strOrNull
};

const rimSchema = {
  model: (v) => strOrNull(v) || 'Felge',
  size: strOrNull,
  pcd: strOrNull,
  color: strOrNull,
  condition: (v) => strOrNull(v) || 'gut',
  vehicle_id: toIntOrNull,
  notes: strOrNull
};

/** Zollgröße aus "225/45 R17" bzw. "8x17 ET20" lesen (für die Passt-Prüfung beim Montieren). */
const tyreInch = (dim) => { const m = /R\s?(\d{2})/i.exec(dim || ''); return m ? Number(m[1]) : null; };
const rimInch = (size) => { const m = /x\s?(\d{2})/i.exec(size || ''); return m ? Number(m[1]) : null; };

function hub(vehicleId = null) {
  const tyres = db.prepare(`SELECT t.*, v.name AS vehicle_name, r.model AS rim_model, r.size AS rim_size
    FROM tyres t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN rims r ON r.id = t.rim_id
    ORDER BY t.status, t.class, t.dimension, t.id`).all();
  const rims = db.prepare(`SELECT r.*, v.name AS vehicle_name, t.id AS tyre_id, t.dimension AS tyre_dimension, t.brand AS tyre_brand,
      t.model AS tyre_model, t.condition AS tyre_condition, t.class AS tyre_class
    FROM rims r LEFT JOIN vehicles v ON v.id = r.vehicle_id LEFT JOIN tyres t ON t.rim_id = r.id
    ORDER BY r.model, r.id`).all();
  const active = tyres.filter((t) => t.status === 'aktiv');
  const scope = (list) => (vehicleId ? list.filter((t) => t.vehicle_id === vehicleId) : list);
  // Bestand der aktiven Driftreifen nach Dimension (für Event-Planung)
  const byDim = {};
  for (const t of active.filter((x) => x.class === 'drift')) {
    byDim[t.dimension] = byDim[t.dimension] || { dimension: t.dimension, loose: 0, mounted: 0 };
    byDim[t.dimension][t.rim_id ? 'mounted' : 'loose'] += 1;
  }
  return {
    tyres,
    rims,
    stats: {
      driftLoose: scope(active.filter((t) => t.class === 'drift' && !t.rim_id)).length,
      driftMounted: scope(active.filter((t) => t.class === 'drift' && t.rim_id)).length,
      street: scope(active.filter((t) => t.class === 'strasse')).length,
      burned: tyres.filter((t) => t.status === 'abgefahren').length,
      wheels: rims.filter((r) => r.tyre_id).length,
      freeRims: rims.filter((r) => !r.tyre_id).length,
      byDimension: Object.values(byDim)
    }
  };
}

router.get('/tyrehub', (req, res) => res.json(hub(toIntOrNull(req.query.vehicleId))));

/* ---------------- Reifen ---------------- */
router.post('/tyres', (req, res) => {
  const qty = Math.min(40, Math.max(1, toIntOrNull(req.body.qty) || 1));
  const data = pick(req.body, tyreSchema);
  db.transaction(() => { for (let i = 0; i < qty; i += 1) insertRow('tyres', { ...data, status: 'aktiv', created_at: nowIso() }); })();
  res.status(201).json(hub());
});

router.put('/tyres/:id', (req, res) => {
  updateRow('tyres', req.params.id, pick(req.body, tyreSchema, { partial: true }));
  res.json(hub());
});

router.delete('/tyres/:id', (req, res) => {
  db.prepare('DELETE FROM tyres WHERE id = ?').run(req.params.id);
  res.json(hub());
});

/* ---------------- Felgen ---------------- */
router.post('/rims', (req, res) => {
  const qty = Math.min(20, Math.max(1, toIntOrNull(req.body.qty) || 1));
  const data = pick(req.body, rimSchema);
  db.transaction(() => { for (let i = 0; i < qty; i += 1) insertRow('rims', { ...data, created_at: nowIso() }); })();
  res.status(201).json(hub());
});

router.put('/rims/:id', (req, res) => {
  const data = pick(req.body, rimSchema, { partial: true });
  updateRow('rims', req.params.id, data);
  // Komplettrad: Fahrzeugzuordnung gilt auch für den montierten Reifen
  if (data.vehicle_id !== undefined) db.prepare('UPDATE tyres SET vehicle_id = ? WHERE rim_id = ?').run(data.vehicle_id, req.params.id);
  res.json(hub());
});

router.delete('/rims/:id', (req, res) => {
  db.prepare('DELETE FROM rims WHERE id = ?').run(req.params.id); // montierter Reifen wird automatisch lose (ON DELETE SET NULL)
  res.json(hub());
});

/* ---------------- Montieren / Abziehen ---------------- */
router.post('/tyres/:id/mount', (req, res) => {
  const tyre = mustGet('tyres', req.params.id, 'Reifen');
  const rim = mustGet('rims', toIntOrNull(req.body.rim_id), 'Felge');
  if (tyre.status !== 'aktiv') throw httpError(400, 'Abgefahrene Reifen werden nicht mehr montiert.');
  if (tyre.rim_id) throw httpError(409, 'Reifen ist schon montiert.');
  if (db.prepare('SELECT 1 FROM tyres WHERE rim_id = ?').get(rim.id)) throw httpError(409, 'Auf dieser Felge sitzt schon ein Reifen.');
  const ti = tyreInch(tyre.dimension); const ri = rimInch(rim.size);
  if (ti && ri && ti !== ri && !req.body.force) throw httpError(422, `Passt nicht: Reifen ${ti} Zoll, Felge ${ri} Zoll.`);
  db.prepare('UPDATE tyres SET rim_id = ?, vehicle_id = COALESCE(?, vehicle_id) WHERE id = ?').run(rim.id, rim.vehicle_id, tyre.id);
  res.json(hub());
});

router.post('/tyres/:id/unmount', (req, res) => {
  const tyre = mustGet('tyres', req.params.id, 'Reifen');
  if (!tyre.rim_id) throw httpError(400, 'Reifen ist nicht montiert.');
  if (req.body.to === 'abgefahren') {
    db.prepare("UPDATE tyres SET rim_id = NULL, status = 'abgefahren', condition = 'burner', burned_at = ? WHERE id = ?").run(nowIso(), tyre.id);
  } else {
    db.prepare('UPDATE tyres SET rim_id = NULL WHERE id = ?').run(tyre.id);
  }
  res.json(hub());
});

/* ---------------- 1-Klick-Burner ---------------- */
router.post('/tyres/burn', (req, res) => {
  const vehicleId = toIntOrNull(req.body.vehicle_id);
  const count = Math.min(8, Math.max(1, toIntOrNull(req.body.count) || 2));
  // Reihenfolge: montierte Driftreifen des Autos (die wurden gefahren) > lose des Autos > allgemeiner Drift-Bestand
  const candidates = db.prepare(`SELECT * FROM tyres WHERE status = 'aktiv' AND class = 'drift'
      AND (vehicle_id = ? OR vehicle_id IS NULL)
    ORDER BY CASE WHEN vehicle_id = ? AND rim_id IS NOT NULL THEN 0 WHEN vehicle_id = ? THEN 1 WHEN rim_id IS NULL THEN 2 ELSE 3 END,
      CASE condition WHEN 'burner' THEN 0 WHEN 'training' THEN 1 ELSE 2 END, id`)
    .all(vehicleId, vehicleId, vehicleId);
  if (!candidates.length) throw httpError(409, 'Keine aktiven Driftreifen mehr im Bestand!');
  const picked = candidates.slice(0, count);
  const ts = nowIso();
  db.transaction(() => {
    for (const t of picked) {
      db.prepare("UPDATE tyres SET status = 'abgefahren', condition = 'burner', rim_id = NULL, burned_at = ?, notes = COALESCE(notes, '') || ? WHERE id = ?")
        .run(ts, t.rim_id ? `[war auf Felge #${t.rim_id}]` : '', t.id);
    }
  })();
  const remaining = db.prepare("SELECT COUNT(*) AS c FROM tyres WHERE status = 'aktiv' AND class = 'drift'").get().c;
  res.json({ burned: picked.map((t) => ({ id: t.id, dimension: t.dimension, brand: t.brand, rim_id: t.rim_id })), remaining, partial: picked.length < count, hub: hub(vehicleId) });
});

router.post('/tyres/unburn', (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean);
  const rims = (req.body.rims && typeof req.body.rims === 'object') ? req.body.rims : {};
  db.transaction(() => {
    for (const id of ids) {
      const t = db.prepare('SELECT * FROM tyres WHERE id = ?').get(id);
      if (!t) continue;
      const rimId = toIntOrNull(rims[id]);
      const rimFree = rimId && !db.prepare('SELECT 1 FROM tyres WHERE rim_id = ?').get(rimId);
      db.prepare("UPDATE tyres SET status = 'aktiv', condition = 'training', burned_at = NULL, rim_id = ?, notes = REPLACE(COALESCE(notes, ''), ?, '') WHERE id = ?")
        .run(rimFree ? rimId : null, `[war auf Felge #${rimId}]`, id);
    }
  })();
  res.json(hub());
});

/**
 * Altreifen austragen (löscht NUR Reifen im Status "abgefahren").
 *   { ids: [..] }   einzelne Altreifen
 *   { all: true }   alle Altreifen (Sicherheitsabfrage passiert im Frontend)
 */
router.post('/tyres/dispose', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  let info;
  if (ids.length) {
    info = db.prepare(`DELETE FROM tyres WHERE status = 'abgefahren' AND id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  } else if (req.body.all === true) {
    info = db.prepare("DELETE FROM tyres WHERE status = 'abgefahren'").run();
  } else {
    throw httpError(400, 'Bitte ids angeben oder all: true setzen.');
  }
  res.json({ disposed: info.changes, hub: hub() });
});

module.exports = router;
