/**
 * v5.3: Physischen Ort eines Teils / Werkzeugs / einer Box auf der Hallenkarte bestimmen (für den Such-Pin).
 * Ergebnis: { objectId, frac } (Punkt entlang des Objekts, 0..1), oder { vehicleId }, plus Beschriftung.
 * Liest nur.
 */
const { db } = require('../db');
const { norm } = require('./util');

/** Position einer Box entlang des Regals: Boxen derselben Etage nach Platz verteilt */
function boxFrac(box) {
  if (!box) return 0.5;
  const list = db.prepare('SELECT id FROM boxes WHERE shelf_id = ? AND level = ? ORDER BY position, id').all(box.shelf_id, box.level);
  const i = Math.max(0, list.findIndex((b) => b.id === box.id));
  return list.length ? (i + 0.5) / list.length : 0.5;
}

let objCache = { at: 0, list: [] };
function objects() {
  if (Date.now() - objCache.at > 10000) {
    objCache = { at: Date.now(), list: db.prepare("SELECT id, type, code, label FROM layout_objects WHERE type != 'door'").all() };
  }
  return objCache.list;
}

const TYPE_WORDS = [
  [/werkzeugwand|lochwand/, (o) => o.type === 'toolwall'],
  [/werkbank|schraubstock/, (o) => o.type === 'workbench'],
  [/kuehlschrank|kühlschrank|fridge/, (o) => o.type === 'fridge'],
  [/chill/, (o) => o.type === 'fridge' || (o.type === 'zone' && /chill/i.test(`${o.code} ${o.label}`))],
  [/reifen(lager|stapel)?/, (o) => o.type === 'tyrestack'],
  [/kompressor/, (o) => /kompressor|komp/i.test(`${o.code} ${o.label}`)]
];

/** Freitext-Ort ("Werkzeugwand", "neben Hebebühne 1", "Regal A, Etage 3") einem Kartenobjekt zuordnen */
function matchObject(text) {
  const t = norm(text);
  if (!t) return null;
  const list = objects();
  const reg = t.match(/regal\s+([a-z0-9]+)/);
  if (reg) {
    const s = list.find((o) => o.type === 'shelf' && norm(o.code) === reg[1]);
    if (s) return s;
  }
  let best = null;
  let score = 0;
  for (const o of list) {
    for (const cand of [o.label, o.code && o.code.length > 1 ? o.code : null]) {
      const c = norm(cand);
      if (c.length < 3) continue;
      if (t.includes(c) && c.length > score) { best = o; score = c.length; }
    }
  }
  if (best) return best;
  for (const [re, fn] of TYPE_WORDS) if (re.test(t)) { const o = list.find(fn); if (o) return o; }
  return null;
}

function openFloat(kind, refId) {
  return db.prepare('SELECT * FROM float_items WHERE kind = ? AND ref_id = ? AND returned_at IS NULL ORDER BY id DESC LIMIT 1').get(kind, refId) || null;
}

function shelfLabel(shelfId) {
  const s = db.prepare('SELECT code, label FROM layout_objects WHERE id = ?').get(shelfId);
  return s ? s.label || `Regal ${s.code}` : 'Regal';
}

/** Teil */
function locatePart(p) {
  const fl = openFloat('part', p.id);
  if (fl && (fl.object_id || fl.vehicle_id)) return { objectId: fl.object_id || null, vehicleId: fl.vehicle_id || null, frac: 0.5, label: p.name, sub: `liegt rum${fl.spot ? `: ${fl.spot}` : ''}`, floating: true };
  if (!p.shelf_id) return null;
  const box = p.box_id ? db.prepare('SELECT * FROM boxes WHERE id = ?').get(p.box_id) : null;
  const level = box ? box.level : p.level;
  return { objectId: p.shelf_id, frac: box ? boxFrac(box) : 0.5, label: p.name, sub: `${shelfLabel(p.shelf_id)}${level ? ` · Etage ${level}` : ''}${box ? ` · ${box.label}` : ''}` };
}

/** Werkzeug */
function locateTool(t) {
  if (t.wishlist) return null;
  if (t.lent_to) return null;   // außer Haus
  if (t.borrowed_vehicle_id) {
    const v = db.prepare('SELECT id, name, slot_id FROM vehicles WHERE id = ?').get(t.borrowed_vehicle_id);
    if (v) return { vehicleId: v.id, label: t.name, sub: `in Benutzung an ${v.name}` };
  }
  const fl = openFloat('tool', t.id);
  if (fl && (fl.object_id || fl.vehicle_id)) return { objectId: fl.object_id || null, vehicleId: fl.vehicle_id || null, frac: 0.5, label: t.name, sub: `liegt rum${fl.spot ? `: ${fl.spot}` : ''}`, floating: true };
  if (t.shelf_id) {
    const box = t.box_id ? db.prepare('SELECT * FROM boxes WHERE id = ?').get(t.box_id) : null;
    const level = box ? box.level : t.level;
    return { objectId: t.shelf_id, frac: box ? boxFrac(box) : 0.5, label: t.name, sub: `${shelfLabel(t.shelf_id)}${level ? ` · Etage ${level}` : ''}${box ? ` · ${box.label}` : ''}` };
  }
  const o = matchObject(t.location_text);
  if (o) return { objectId: o.id, frac: 0.5, label: t.name, sub: t.location_text || o.label };
  return null;
}

function locateBox(b) {
  return { objectId: b.shelf_id, frac: boxFrac(b), label: `Box ${b.label}`, sub: `${shelfLabel(b.shelf_id)} · Etage ${b.level}` };
}

function locateType(type, label, sub) {
  const o = objects().find((x) => x.type === type);
  return o ? { objectId: o.id, frac: 0.5, label, sub } : null;
}

module.exports = { locatePart, locateTool, locateBox, locateType, matchObject };
