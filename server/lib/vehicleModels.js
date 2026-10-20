/**
 * v3: Dynamische Fahrzeugmodelle aus der Datenbank (Tabelle vehicle_models).
 * Liefert dieselbe Struktur wie früher MODELS: { key: { label, chassis, shape, length, width, weight, builtin } }
 */
const { db } = require('../db');

function getModels() {
  const out = {};
  for (const m of db.prepare('SELECT * FROM vehicle_models ORDER BY sort, label').all()) {
    out[m.key] = { id: m.id, label: m.label, chassis: m.chassis || '', shape: m.shape, length: m.length, width: m.width, weight: m.weight_kg, builtin: !!m.builtin, sort: m.sort };
  }
  return out;
}

function hasModel(key) {
  return !!db.prepare('SELECT 1 FROM vehicle_models WHERE key = ?').get(key);
}

module.exports = { getModels, hasModel };
