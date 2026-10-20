/**
 * /api/blueprint: Röntgenblick für Leitungen (Elektrik 230/400 V, Druckluft, Daten)
 * Linien = Polylinien in Hallen-Metern, Knoten = einzelne Punkte (Verteiler, Steckdose ...)
 */
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');
const { BLUEPRINT_KINDS } = require('../lib/models');
const { insertRow, updateRow, mustGet, httpError, strOrNull, parseJSON, nowIso } = require('../lib/util');

const router = express.Router();
const serialize = (b) => ({ ...b, points: parseJSON(b.points, []) });

function readItem(body) {
  const type = body.type === 'node' ? 'node' : 'line';
  if (!BLUEPRINT_KINDS[type][body.kind]) throw httpError(400, 'Unbekannte Art.');
  const points = (Array.isArray(body.points) ? body.points : [])
    .map((p) => [Math.round(Number(p[0]) * 100) / 100, Math.round(Number(p[1]) * 100) / 100])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (type === 'line' && points.length < 2) throw httpError(400, 'Eine Leitung braucht mindestens 2 Punkte.');
  if (type === 'node' && points.length !== 1) throw httpError(400, 'Ein Knoten braucht genau 1 Punkt.');
  return { type, kind: body.kind, label: strOrNull(body.label), points: JSON.stringify(points) };
}

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM blueprint_items ORDER BY type DESC, id').all().map(serialize)));

router.post('/', requireRole('admin'), (req, res) => {
  const id = insertRow('blueprint_items', { ...readItem(req.body), created_at: nowIso() });
  res.status(201).json(serialize(mustGet('blueprint_items', id)));
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const cur = serialize(mustGet('blueprint_items', req.params.id, 'Element'));
  updateRow('blueprint_items', cur.id, readItem({ ...cur, ...req.body }));
  res.json(serialize(mustGet('blueprint_items', cur.id)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM blueprint_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
