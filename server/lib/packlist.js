/**
 * Trackside-Packliste
 * ------------------------------------------------------------
 * Regeln:
 *  1. Alle Event-relevanten Werkzeuge (Wunschliste ausgenommen)
 *  2. Alle Event-relevanten Teile der ausgewählten Autos
 *  3. Alle Event-relevanten Universal-Teile
 *  4. Bonus: Event-relevante Teile mit Freitext-Modell, deren Text zu einem
 *     gewählten Auto passt (z. B. "E36" passt zum "BMW E36 Coupé")
 *  5. Eigene Zusatzpositionen pro Event
 *
 * Strikte Deduplizierung: Werkzeuge und Universal-Teile werden über den
 * normalisierten Namen zusammengefasst und erscheinen exakt EINMAL,
 * egal wie viele Autos am Event teilnehmen. Mehrere Exemplare / Lagerorte
 * werden innerhalb des Eintrags gesammelt.
 */
const { db } = require('../db');
const { getModels } = require('./vehicleModels');
const { norm } = require('./util');

const STOPWORDS = new Set(['bmw', 'auto', 'alle', 'fuer', 'für', 'und', 'mit', 'oder', 'vorne', 'hinten', 'links', 'rechts']);

function locationText(row) {
  const bits = [];
  if (row.shelf_code) bits.push(`Regal ${row.shelf_code}`);
  if (row.level) bits.push(`Etage ${row.level}`);
  if (row.box_label) bits.push(`Box „${row.box_label}“`);
  if (!bits.length && row.location_text) bits.push(row.location_text);
  return bits.join(' · ') || 'ohne festen Ort';
}

function vehicleHaystack(v) {
  const models = getModels();
  const m = models[v.model] || models.dummy || { label: '', chassis: '' };
  return ` ${norm(`${v.name} ${m.label} ${m.chassis} ${v.model.replace('_', ' ')}`)} `;
}

function foreignMatches(text, vehicles) {
  const tokens = norm(text).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  if (!tokens.length) return [];
  return vehicles.filter((v) => {
    const hay = vehicleHaystack(v);
    return tokens.some((t) => new RegExp(`[^a-z0-9]${t}[^a-z0-9]`).test(hay));
  });
}

function buildPacklist(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return null;

  const vehicles = db.prepare(`SELECT v.* FROM vehicles v JOIN event_vehicles ev ON ev.vehicle_id = v.id
    WHERE ev.event_id = ? ORDER BY v.name`).all(eventId);
  const vehicleIds = new Set(vehicles.map((v) => v.id));

  const checks = new Map(db.prepare(`SELECT pc.item_key, pc.packed, pc.packed_at, u.name AS packed_by_name
    FROM packlist_checks pc LEFT JOIN users u ON u.id = pc.packed_by WHERE pc.event_id = ?`).all(eventId)
    .map((c) => [c.item_key, c]));

  const withCheck = (item) => {
    const c = checks.get(item.key);
    return { ...item, packed: !!(c && c.packed), packedBy: c && c.packed ? c.packed_by_name : null };
  };

  /* 1) Werkzeug: deduplizieren über den Namen */
  const toolRows = db.prepare(`SELECT t.*, lo.code AS shelf_code, b.label AS box_label
    FROM tools t LEFT JOIN layout_objects lo ON lo.id = t.shelf_id LEFT JOIN boxes b ON b.id = t.box_id
    WHERE t.event_relevant = 1 AND t.wishlist = 0 ORDER BY t.category, t.name`).all();
  const toolMap = new Map();
  for (const t of toolRows) {
    const key = `tool:${norm(t.name)}`;
    const loc = locationText(t);
    if (!toolMap.has(key)) {
      toolMap.set(key, { key, kind: 'tool', name: t.name, category: t.category, qty: 0, locations: [], sourceIds: [], borrowed: [] });
    }
    const entry = toolMap.get(key);
    entry.qty += t.qty || 1;
    entry.sourceIds.push(t.id);
    if (!entry.locations.includes(loc)) entry.locations.push(loc);
    if (t.borrowed_by) entry.borrowed.push(t.id);
  }

  /* 2-4) Teile */
  const partRows = db.prepare(`SELECT p.*, lo.code AS shelf_code, b.label AS box_label
    FROM parts p LEFT JOIN layout_objects lo ON lo.id = p.shelf_id LEFT JOIN boxes b ON b.id = p.box_id
    WHERE p.event_relevant = 1 ORDER BY p.category, p.name`).all();

  const universalMap = new Map();
  const perVehicle = new Map(vehicles.map((v) => [v.id, []]));
  const foreign = [];

  for (const p of partRows) {
    const base = { kind: 'part', name: p.name, category: p.category, condition: p.condition, qty: p.qty, locations: [locationText(p)], sourceIds: [p.id] };
    if (p.universal) {
      const key = `upart:${norm(p.name)}`;
      if (!universalMap.has(key)) universalMap.set(key, { ...base, key, qty: 0, locations: [], sourceIds: [] });
      const entry = universalMap.get(key);
      entry.qty += p.qty || 1;
      entry.sourceIds.push(p.id);
      const loc = locationText(p);
      if (!entry.locations.includes(loc)) entry.locations.push(loc);
    } else if (p.vehicle_id && vehicleIds.has(p.vehicle_id)) {
      perVehicle.get(p.vehicle_id).push({ ...base, key: `part:${p.id}` });
    } else if (!p.vehicle_id && p.foreign_model) {
      const hits = foreignMatches(p.foreign_model, vehicles);
      if (hits.length) foreign.push({ ...base, key: `part:${p.id}`, foreignModel: p.foreign_model, matches: hits.map((v) => v.name) });
    }
  }

  const custom = db.prepare('SELECT * FROM packlist_custom WHERE event_id = ? ORDER BY id').all(eventId)
    .map((c) => ({ key: `custom:${c.id}`, kind: 'custom', id: c.id, name: c.name, qty: c.qty, locations: [] }));

  const sections = [
    { id: 'tools', title: 'Werkzeug', icon: 'wrench', items: [...toolMap.values()].map(withCheck) },
    { id: 'universal', title: 'Universal-Teile & Verbrauch', icon: 'box', items: [...universalMap.values()].map(withCheck) },
    ...vehicles.map((v) => ({
      id: `veh-${v.id}`, title: v.name, icon: 'car',
      vehicle: { id: v.id, name: v.name, model: v.model, color: v.color, status: v.status },
      items: perVehicle.get(v.id).map(withCheck)
    })),
    { id: 'foreign', title: 'Passt evtl. (Freitext-Treffer)', icon: 'search', items: foreign.map(withCheck) },
    { id: 'custom', title: 'Eigene Positionen', icon: 'plus', items: custom.map(withCheck) }
  ];

  const all = sections.flatMap((s) => s.items);
  return {
    event,
    vehicles: vehicles.map((v) => ({ id: v.id, name: v.name, model: v.model, color: v.color, status: v.status })),
    sections,
    stats: { total: all.length, packed: all.filter((i) => i.packed).length }
  };
}

module.exports = { buildPacklist, foreignMatches };
