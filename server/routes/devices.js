/**
 * /api/devices: vorbereitete Endpunkte für smarte Steckdosen, Heizungen, Sensoren & Webcams.
 *
 *   GET    /api/devices                 Liste
 *   POST   /api/devices                 anlegen (Admin)
 *   PUT    /api/devices/:id             ändern (Admin)
 *   DELETE /api/devices/:id             löschen (Admin)
 *   POST   /api/devices/:id/action      { action: "on" | "off" | "toggle" | "set", payload }
 *   GET    /api/devices/:id/state       Zustand (optional live vom Gerät)
 *   GET    /api/devices/:id/snapshot    Webcam-Standbild als Proxy (type = "camera")
 */
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');
const { drivers } = require('../devices/drivers');
const { insertRow, updateRow, mustGet, httpError, strOrNull, toNumOrNull, parseJSON, nowIso } = require('../lib/util');

const router = express.Router();
const TYPES = ['plug', 'heater', 'camera', 'sensor', 'light'];
const serialize = (d) => ({ ...d, config: parseJSON(d.config, {}), state: parseJSON(d.state, {}) });

function readDevice(body) {
  return {
    type: TYPES.includes(body.type) ? body.type : 'plug',
    driver: drivers[body.driver] ? body.driver : 'mock',
    name: strOrNull(body.name) || 'Neues Gerät',
    endpoint: strOrNull(body.endpoint),
    config: JSON.stringify(body.config && typeof body.config === 'object' ? body.config : {}),
    x: toNumOrNull(body.x),
    y: toNumOrNull(body.y)
  };
}

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM devices ORDER BY id').all().map(serialize)));

router.post('/', requireRole('admin'), (req, res) => {
  const id = insertRow('devices', { ...readDevice(req.body), state: '{}', created_at: nowIso() });
  res.status(201).json(serialize(mustGet('devices', id)));
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const cur = serialize(mustGet('devices', req.params.id, 'Gerät'));
  updateRow('devices', cur.id, readDevice({ ...cur, ...req.body }));
  res.json(serialize(mustGet('devices', cur.id)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/action', async (req, res, next) => {
  try {
    const device = serialize(mustGet('devices', req.params.id, 'Gerät'));
    const driver = drivers[device.driver];
    if (!driver || !driver.action) throw httpError(501, `Treiber "${device.driver}" unterstützt keine Aktionen.`);
    const state = await driver.action(device, String(req.body.action || 'toggle'), req.body.payload);
    db.prepare('UPDATE devices SET state = ? WHERE id = ?').run(JSON.stringify(state), device.id);
    res.json(serialize(mustGet('devices', device.id)));
  } catch (err) {
    next(err.status ? err : httpError(502, `Gerät nicht erreichbar: ${err.message}`));
  }
});

router.get('/:id/state', async (req, res, next) => {
  try {
    const device = serialize(mustGet('devices', req.params.id, 'Gerät'));
    const driver = drivers[device.driver];
    if (req.query.live === '1' && driver && driver.read) {
      const state = await driver.read(device);
      db.prepare('UPDATE devices SET state = ? WHERE id = ?').run(JSON.stringify(state), device.id);
      return res.json(state);
    }
    res.json(device.state);
  } catch (err) { next(httpError(502, `Gerät nicht erreichbar: ${err.message}`)); }
});

router.get('/:id/snapshot', async (req, res, next) => {
  try {
    const device = serialize(mustGet('devices', req.params.id, 'Gerät'));
    if (device.type !== 'camera' || !device.endpoint) throw httpError(400, 'Kein Kamera-Gerät mit Endpunkt.');
    const r = await fetch(device.endpoint);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) { next(err.status ? err : httpError(502, `Kamera nicht erreichbar: ${err.message}`)); }
});

module.exports = router;
