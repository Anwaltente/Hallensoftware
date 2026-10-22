/**
 * v4: Schnell-Verbrauch (Zwei-Tap-Hub), kritische Ressourcen, Einkaufsliste, Schwebe-Status ("liegt rum").
 *
 *   GET  /api/hud                              Kompakte Daten für HUD, Map und Ticker (Polling)
 *   GET  /api/consumables                      Verbrauchsartikel inkl. Status (low, crit, unknown)
 *   POST /api/consumables/:id/use              { amount } oder { empty: true }, optional { vehicle_id }
 *   GET  /api/consumables/:id/stock            v4.2: Kategorie inkl. aller verknüpften Gebinde (Lagerorte)
 *   POST /api/consumables/:id/stock-in         v4.2: nach dem Einkauf einlagern (bestehendes Gebinde +N oder neues Gebinde)
 *   POST /api/consumable-moves/:id/undo        Buchung zurücknehmen (inkl. Wartungsheft-Eintrag)
 *   GET  /api/consumable-moves                 Verlauf (letzte Buchungen)
 *   GET  /api/shopping                         Einkauf: Radar + Hallen-Einkaufsliste + Auto-Einkäufe
 *   GET  /api/shopping/radar                   v4.2: "Demnächst einkaufen" (Kritische Liste + Kühlschrank unter Soll)
 *   POST /api/shopping-list, /:id/bought, /:id/remove   v4.2: Hallen-Einkaufsliste
 *   GET/POST /api/admin/consumables/assign...  v4.2: Zuordnungs-Assistent (Inventar-Teile verknüpfen, alte Werkstatt-Vorräte übernehmen)
 *   POST/PUT/DELETE /api/admin/consumables     Artikel + kritische Schwellenwerte verwalten (Admin)
 *
 *   GET  /api/floating                         Alles, was gerade "in der Schwebe" ist
 *   GET  /api/floating/candidates?q=           Werkzeug, Kisten, Teile für "Etwas rausgeholt"
 *   POST /api/floating                         { kind, ref_id | label, spot, object_id, vehicle_id }
 *   PUT  /api/floating/:id                     Ort nachtragen
 *   POST /api/floating/:id/return              "Liegt wieder im Fach"
 *   POST /api/floating/return-all              "Alles zurückgeräumt" (inkl. ausgeliehenem Werkzeug)
 */
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');
const { pick, insertRow, updateRow, mustGet, httpError, strOrNull, toIntOrNull, toNumOrNull, toBool, nowIso } = require('../lib/util');
const hub = require('../lib/hub');
const stock = require('../lib/stock');
const activity = require('../lib/activity');   // v5.3

const router = express.Router();
const { round, fmtQty } = hub;
const one = (id) => hub.listConsumables({ all: true }).find((c) => c.id === Number(id));

router.get('/hud', (_req, res) => res.json(hub.hudData()));
router.get('/consumables', (req, res) => res.json(hub.listConsumables({ all: req.query.all === '1' })));
router.get('/shopping', (_req, res) => res.json(hub.shoppingList()));

/* ======================= Verbrauch buchen (v4.2: aus den Gebinden im Inventar) ======================= */
router.post('/consumables/:id/use', (req, res) => {
  const c = mustGet('consumables', req.params.id, 'Artikel');
  const isEmpty = !!req.body.empty;
  let amount = isEmpty ? stock.openedRest(c.id) : toNumOrNull(req.body.amount);
  if (!amount || amount <= 0 || amount > 10000) throw httpError(400, isEmpty ? 'Es ist kein angebrochenes Gebinde im Lager.' : 'Menge fehlt.');
  amount = round(amount);
  const vehicleId = toIntOrNull(req.body.vehicle_id);
  const vehicle = vehicleId ? mustGet('vehicles', vehicleId, 'Fahrzeug') : null;
  const before = stock.stockOf(c.id);
  const ts = nowIso();
  let moveId;
  let result;
  db.transaction(() => {
    result = stock.deduct(c.id, amount);
    let logId = null;
    if (vehicle) {
      const cost = c.price_per_unit ? Math.round(c.price_per_unit * amount * 100) / 100 : null;
      logId = insertRow('maintenance_log', {
        vehicle_id: vehicle.id,
        title: `Verbrauch: ${fmtQty(amount, c.kind)} ${c.unit} ${c.name}`,
        description: `Schnell-Verbrauch${isEmpty ? ' · Gebinde leer' : ''}`,
        cost,
        done_at: ts,
        user_id: req.user.id
      });
    }
    const after = round(before.total - result.taken);
    moveId = insertRow('consumable_moves', {
      consumable_id: c.id, kind: isEmpty ? 'empty' : 'use', delta: -amount, qty_before: before.total, qty_after: after,
      vehicle_id: vehicle ? vehicle.id : null, log_id: logId, user_id: req.user.id, created_at: ts,
      detail: JSON.stringify({ changes: result.changes, shortfall: result.shortfall })
    });
  })();
  const item = one(c.id);
  activity.mark(req, 'quickuse', `Material entnommen: ${fmtQty(amount, c.kind)} ${c.unit} ${c.name}${vehicle ? ` für ${vehicle.name}` : ''}${isEmpty ? ' (Gebinde leer)' : ''}`,
    { consumable_id: c.id, amount, unit: c.unit, vehicle_id: vehicle ? vehicle.id : null, bestand_vorher: before.total, bestand_nachher: item ? item.qty : null });
  const min = Number(c.min_qty) || 0;
  const hadStock = before.rows.length > 0;
  const crossed = hadStock && min > 0 && before.total >= min && item.qty < min;
  res.json({
    item,
    move: { id: moveId, amount, vehicle_name: vehicle ? vehicle.name : null, shortfall: result.shortfall, noStock: !hadStock },
    popup: `-${fmtQty(amount, c.kind)} ${c.unit}`,
    crossed,
    crossedCritical: crossed && !!c.critical,
    becameEmpty: hadStock && before.total > 0 && item.qty <= 0,
    hud: hub.hudData()
  });
});

// v4.2: Kein "Kanister aus dem Nichts" mehr. Bestand kommt ausschließlich aus dem Inventar (Gebinde mit Lagerort).
router.post(['/consumables/:id/refill', '/consumables/:id/count'], (_req, _res) => {
  throw httpError(410, 'Bestand wird jetzt im Inventar gepflegt: Gebinde mit Lagerort einlagern oder dort zählen.');
});

/* Gebinde einer Kategorie (für die Anzeige im Schnell-Verbrauch) */
router.get('/consumables/:id/stock', (req, res) => {
  mustGet('consumables', req.params.id, 'Artikel');
  res.json(one(req.params.id));
});

/**
 * Einlagern nach dem Einkauf: { part_id, add } erhöht ein bestehendes Gebinde (Lagerort bleibt),
 * oder { create: { name, qty, pack_size, shelf_id, level, box_id } } legt ein neues Gebinde im Inventar an.
 */
router.post('/consumables/:id/stock-in', (req, res) => {
  const c = mustGet('consumables', req.params.id, 'Artikel');
  const ts = nowIso();
  let partId;
  if (req.body.part_id) {
    const p = mustGet('parts', req.body.part_id, 'Gebinde');
    if (p.consumable_id !== c.id) throw httpError(400, 'Gebinde gehört zu einer anderen Kategorie.');
    const add = Math.max(1, toIntOrNull(req.body.add) || 1);
    db.prepare('UPDATE parts SET qty = qty + ? WHERE id = ?').run(add, p.id);
    partId = p.id;
  } else if (req.body.create) {
    const d = req.body.create;
    const size = toNumOrNull(d.pack_size);
    if (!size || size <= 0) throw httpError(400, 'Gebindemenge fehlt (z. B. 5 für einen 5-L-Kanister).');
    const data = {
      name: strOrNull(d.name) || `${c.name} (${fmtQty(size, c.kind)} ${c.unit})`,
      category: 'Betriebsstoffe', qty: Math.max(1, toIntOrNull(d.qty) || 1), condition: 'neu',
      pack_size: size, pack_unit: c.unit, consumable_id: c.id,
      shelf_id: toIntOrNull(d.shelf_id), level: toIntOrNull(d.level), box_id: toIntOrNull(d.box_id), created_at: ts
    };
    if (data.box_id) {
      const b = db.prepare('SELECT shelf_id, level FROM boxes WHERE id = ?').get(data.box_id);
      if (b) { data.shelf_id = b.shelf_id; data.level = b.level; } else data.box_id = null;
    }
    partId = insertRow('parts', data);
  } else throw httpError(400, 'Was soll eingelagert werden?');
  // passende offene Einträge auf der Einkaufsliste abhaken
  if (req.body.list_id) db.prepare("UPDATE shopping_list SET status = 'bought', done_by = ?, done_at = ? WHERE id = ? AND status = 'open'").run(req.user.id, ts, toIntOrNull(req.body.list_id));
  res.json({ item: one(c.id), part_id: partId, hud: hub.hudData() });
});

router.post('/consumable-moves/:id/undo', (req, res) => {
  const m = mustGet('consumable_moves', req.params.id, 'Buchung');
  if (m.undone) throw httpError(409, 'Wurde schon zurückgenommen.');
  if (Date.now() - Date.parse(m.created_at) > 24 * 3600000) throw httpError(409, 'Nur Buchungen der letzten 24 Stunden können zurückgenommen werden.');
  const c = mustGet('consumables', m.consumable_id, 'Artikel');
  let info = { restored: 0, skipped: 0 };
  db.transaction(() => {
    let detail = null;
    try { detail = m.detail ? JSON.parse(m.detail) : null; } catch { detail = null; }
    if (detail && detail.changes) info = stock.undoChanges(detail.changes);
    // nur den Wartungsheft-Eintrag entfernen, den genau diese Buchung angelegt hat
    if (m.log_id) db.prepare('DELETE FROM maintenance_log WHERE id = ? AND vehicle_id IS ?').run(m.log_id, m.vehicle_id);
    db.prepare('UPDATE consumable_moves SET undone = 1 WHERE id = ?').run(m.id);
  })();
  res.json({ item: one(c.id), restored: info.restored, skipped: info.skipped, hud: hub.hudData() });
});

/* ======================= Einkaufs-Radar + Hallen-Einkaufsliste (v4.2) ======================= */
router.get('/shopping/radar', (_req, res) => res.json(hub.radar()));

router.get('/shopping-list', (_req, res) => res.json(hub.shoppingListRows()));

router.post('/shopping-list', (req, res) => {
  const source = ['consumable', 'supply'].includes(req.body.source) ? req.body.source : 'manual';
  const refId = source === 'manual' ? null : toIntOrNull(req.body.ref_id);
  let name = strOrNull(req.body.name);
  if (source === 'consumable') { const c = mustGet('consumables', refId, 'Artikel'); name = name || c.name; }
  if (source === 'supply') { const s = mustGet('supplies', refId, 'Vorrat'); name = name || s.name; }
  if (!name) throw httpError(400, 'Was soll eingekauft werden?');
  const dupe = refId ? db.prepare("SELECT id FROM shopping_list WHERE source = ? AND ref_id = ? AND status = 'open'").get(source, refId) : null;
  if (!dupe) insertRow('shopping_list', { source, ref_id: refId, name, qty_text: strOrNull(req.body.qty_text), note: strOrNull(req.body.note), status: 'open', created_by: req.user.id, created_at: nowIso() });
  res.status(dupe ? 200 : 201).json({ list: hub.shoppingListRows(), hud: hub.hudData(), already: !!dupe });
});

router.post('/shopping-list/:id/bought', (req, res) => {
  mustGet('shopping_list', req.params.id, 'Eintrag');
  db.prepare("UPDATE shopping_list SET status = 'bought', done_by = ?, done_at = ? WHERE id = ?").run(req.user.id, nowIso(), req.params.id);
  res.json({ list: hub.shoppingListRows(), hud: hub.hudData() });
});

router.post('/shopping-list/:id/remove', (req, res) => {
  mustGet('shopping_list', req.params.id, 'Eintrag');
  db.prepare("UPDATE shopping_list SET status = 'removed', done_by = ?, done_at = ? WHERE id = ?").run(req.user.id, nowIso(), req.params.id);
  res.json({ list: hub.shoppingListRows(), hud: hub.hudData() });
});

router.get('/consumable-moves', (req, res) => {
  const limit = Math.min(200, Math.max(1, toIntOrNull(req.query.limit) || 60));
  res.json(db.prepare(`SELECT m.*, c.name, c.unit, c.kind AS item_kind, u.name AS user_name, v.name AS vehicle_name
    FROM consumable_moves m JOIN consumables c ON c.id = m.consumable_id
    LEFT JOIN users u ON u.id = m.user_id LEFT JOIN vehicles v ON v.id = m.vehicle_id
    ORDER BY m.id DESC LIMIT ?`).all(limit));
});

/* ======================= Admin: Artikel & kritische Ressourcen ======================= */
const parseStepsInput = (v, kind) => {
  if (Array.isArray(v)) return JSON.stringify(hub.parseSteps(v, kind));
  const arr = String(v || '').split(/[;\s|/]+|,(?=\s)/).map((x) => toNumOrNull(x)).filter((n) => n && n > 0);
  return JSON.stringify(arr.length ? arr.slice(0, 6) : (kind === 'fluid' ? [0.5, 1, 2] : [1, 2]));
};
const consSchema = {
  name: (v) => strOrNull(v) || 'Artikel',
  kind: (v) => (v === 'fluid' ? 'fluid' : 'piece'),
  unit: (v) => strOrNull(v) || 'Stk',
  min_qty: (v) => Math.max(0, toNumOrNull(v) ?? 0),
  critical: toBool,
  container_label: (v) => strOrNull(v) || 'Packung',
  container_size: (v) => { const n = toNumOrNull(v); return n && n > 0 ? n : null; },
  price_per_unit: (v) => { const n = toNumOrNull(v); return n && n > 0 ? n : null; },
  location_object_id: toIntOrNull,
  sort: (v) => toIntOrNull(v) ?? 100,
  active: toBool
};

router.post('/admin/consumables', requireRole('admin'), (req, res) => {
  const data = pick(req.body, consSchema);
  if (!('active' in req.body)) data.active = 1;
  data.steps = parseStepsInput(req.body.steps, data.kind);
  const qty = toNumOrNull(req.body.qty);
  data.qty = qty === null ? null : Math.max(0, qty);
  data.created_at = nowIso();
  const id = insertRow('consumables', data);
  res.status(201).json(one(id));
});

router.put('/admin/consumables/:id', requireRole('admin'), (req, res) => {
  const c = mustGet('consumables', req.params.id, 'Artikel');
  const data = pick(req.body, consSchema, { partial: true });
  if ('steps' in req.body) data.steps = parseStepsInput(req.body.steps, data.kind || c.kind);
  data.updated_at = nowIso();
  updateRow('consumables', c.id, data);
  res.json(one(c.id));
});

router.delete('/admin/consumables/:id', requireRole('admin'), (req, res) => {
  const c = mustGet('consumables', req.params.id, 'Artikel');
  const used = db.prepare('SELECT COUNT(*) AS n FROM consumable_moves WHERE consumable_id = ?').get(c.id).n;
  if (used) {
    // Verlauf bleibt erhalten: Artikel wird nur ausgeblendet
    db.prepare('UPDATE consumables SET active = 0, updated_at = ? WHERE id = ?').run(nowIso(), c.id);
    return res.json({ archived: true });
  }
  db.prepare('DELETE FROM consumables WHERE id = ?').run(c.id);
  res.json({ deleted: true });
});

/* ======================= v4.2: Zuordnungs-Assistent (Admin) ======================= */
const { getSetting, setSetting } = require('../db');
const STOP = new Set(['motoröl', 'getriebeöl', 'diff-öl', 'öl', 'sortiment', 'flüssigkeit', 'the']);
const SYNONYMS = [
  [/atf|getriebe/i, ['atf', 'dexron', 'dextron', 'automatic', 'mercon']],
  [/brems.*flüss|dot/i, ['dot', 'bremsflüssigkeit', 'brake fluid']],
  [/kühl/i, ['kühlmittel', 'kühlerfrostschutz', 'frostschutz', 'glysantin', 'g12', 'g13', 'antifreeze']],
  [/bremsenreiniger/i, ['bremsenreiniger', 'brake clean']]
];
const tokens = (name) => {
  const base = String(name || '').toLowerCase().split(/[\s()/,]+/).filter((t) => t.length >= 3 && !STOP.has(t));
  for (const [re, extra] of SYNONYMS) if (re.test(name)) base.push(...extra);
  return [...new Set(base)];
};
/** Gebindemenge aus dem Namen raten: "Dot 4 5L" -> 5, "Öl 500ml" -> 0.5 */
function packFromName(name, unit) {
  const m = String(name || '').match(/(\d+(?:[.,]\d+)?)\s?(ml|l|liter|ltr)\b/i);
  if (!m || unit !== 'L') return null;
  const n = Number(m[1].replace(',', '.'));
  return /ml/i.test(m[2]) ? n / 1000 : n;
}

router.get('/admin/consumables/assign', requireRole('admin'), (_req, res) => {
  const cons = db.prepare('SELECT id, name, unit, kind FROM consumables WHERE active = 1').all();
  const parts = db.prepare(`SELECT p.id, p.name, p.qty, p.category, lo.code AS shelf_code, p.level, b.label AS box_label FROM parts p
    LEFT JOIN layout_objects lo ON lo.id = p.shelf_id LEFT JOIN boxes b ON b.id = p.box_id WHERE p.consumable_id IS NULL ORDER BY p.name`).all()
    .map((p) => {
      let best = null; let score = 0;
      for (const c of cons) {
        const sc = tokens(c.name).filter((t) => p.name.toLowerCase().includes(t)).length;
        if (sc > score) { score = sc; best = c; }
      }
      const fluidLike = /\d\s?(l|ml|liter)\b|öl|atf|dot\s?\d|w-?\d{2}|kühlmittel|bremsflüss/i.test(`${p.name} ${p.category || ''}`);
      return { ...p, suggest_consumable_id: best ? best.id : null, suggest_pack: best ? packFromName(p.name, best.unit) : null, likely: !!best || fluidLike,
        location: p.shelf_code ? `Regal ${p.shelf_code}${p.level ? ` · Ebene ${p.level}` : ''}${p.box_label ? ` · ${p.box_label}` : ''}` : 'ohne Lagerort' };
    });
  const imported = new Set(getSetting('v42_imported_supplies', []) || []);
  const supplies = db.prepare("SELECT * FROM supplies WHERE category = 'werkstatt' ORDER BY sort, name").all().filter((s) => !imported.has(s.id))
    .map((s) => {
      const c = cons.find((x) => x.name.toLowerCase() === s.name.toLowerCase()) || cons.find((x) => tokens(x.name).some((t) => s.name.toLowerCase().includes(t)));
      return { ...s, suggest_consumable_id: c ? c.id : null };
    });
  res.json({ parts, supplies });
});

router.post('/admin/consumables/link-part', requireRole('admin'), (req, res) => {
  const p = mustGet('parts', req.body.part_id, 'Teil');
  const c = mustGet('consumables', req.body.consumable_id, 'Kategorie');
  const size = toNumOrNull(req.body.pack_size);
  if (!size || size <= 0) throw httpError(400, 'Gebindemenge fehlt (z. B. 1 für eine 1-L-Dose, 5 für einen 5-L-Kanister).');
  // nur die neuen v4.2-Spalten dieses einen Teils setzen
  db.prepare('UPDATE parts SET consumable_id = ?, pack_size = ?, pack_unit = ? WHERE id = ?').run(c.id, size, c.unit, p.id);
  res.json({ item: one(c.id), hud: hub.hudData() });
});

router.post('/admin/consumables/unlink-part', requireRole('admin'), (req, res) => {
  const p = mustGet('parts', req.body.part_id, 'Teil');
  db.prepare('UPDATE parts SET consumable_id = NULL WHERE id = ?').run(p.id);
  res.json({ ok: true, hud: hub.hudData() });
});

/** Alte Werkstatt-Vorräte aus dem Kühlschrank-Radar als Gebinde ins Inventar übernehmen (der alte Eintrag bleibt unverändert) */
router.post('/admin/consumables/import-supply', requireRole('admin'), (req, res) => {
  const s = mustGet('supplies', req.body.supply_id, 'Vorrat');
  let consumableId = toIntOrNull(req.body.consumable_id);
  const ts = nowIso();
  db.transaction(() => {
    if (!consumableId) {
      consumableId = insertRow('consumables', {
        name: s.name, kind: 'piece', unit: s.unit || 'Stk', min_qty: s.min_qty || 0, critical: 0,
        steps: '[1,2]', container_label: 'Stück', container_size: 1, sort: 120, active: 1, created_at: ts
      });
    }
    const c = mustGet('consumables', consumableId, 'Kategorie');
    const data = {
      name: s.name, category: 'Betriebsstoffe', qty: Math.max(0, s.qty || 0), condition: 'neu', pack_size: 1, pack_unit: c.unit, consumable_id: c.id,
      shelf_id: toIntOrNull(req.body.shelf_id), level: toIntOrNull(req.body.level), box_id: toIntOrNull(req.body.box_id),
      notes: 'Aus den Werkstatt-Vorräten des Kühlschrank-Radars übernommen.', created_at: ts
    };
    if (data.box_id) { const b = db.prepare('SELECT shelf_id, level FROM boxes WHERE id = ?').get(data.box_id); if (b) { data.shelf_id = b.shelf_id; data.level = b.level; } else data.box_id = null; }
    insertRow('parts', data);
    const list = getSetting('v42_imported_supplies', []) || [];
    setSetting('v42_imported_supplies', [...new Set([...list, s.id])]);
  })();
  res.json({ item: one(consumableId), hud: hub.hudData() });
});

/* ======================= Schwebe-Status ======================= */
function resolveRef(kind, refId) {
  if (kind === 'tool') { const t = db.prepare('SELECT id, name FROM tools WHERE id = ?').get(refId); return t && t.name; }
  if (kind === 'box') { const b = db.prepare('SELECT b.label, lo.code FROM boxes b JOIN layout_objects lo ON lo.id = b.shelf_id WHERE b.id = ?').get(refId); return b && `Kiste ${b.label}`; }
  if (kind === 'part') { const p = db.prepare('SELECT name FROM parts WHERE id = ?').get(refId); return p && p.name; }
  return null;
}

function spotText({ spot, object_id: objectId, vehicle_id: vehicleId }) {
  if (spot) return spot;
  if (vehicleId) { const v = db.prepare('SELECT name FROM vehicles WHERE id = ?').get(vehicleId); if (v) return `am ${v.name}`; }
  if (objectId) {
    const o = db.prepare('SELECT code, label, type FROM layout_objects WHERE id = ?').get(objectId);
    if (o) return `${o.type === 'slot' && !/bühne/i.test(o.label || '') ? 'bei ' : 'an '}${o.label || o.code}`;
  }
  return null;
}

router.get('/floating', (_req, res) => { const items = hub.listFloating(); res.json({ items, count: items.length }); });

router.get('/floating/candidates', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const tools = db.prepare('SELECT id, name AS label, category FROM tools WHERE wishlist = 0 AND (name LIKE ? OR category LIKE ?) ORDER BY name LIMIT 12').all(q, q).map((t) => ({ kind: 'tool', ref_id: t.id, label: t.label, sub: t.category }));
  const boxes = db.prepare('SELECT b.id, b.label, lo.code FROM boxes b JOIN layout_objects lo ON lo.id = b.shelf_id WHERE b.label LIKE ? ORDER BY b.label LIMIT 8').all(q).map((b) => ({ kind: 'box', ref_id: b.id, label: `Kiste ${b.label}`, sub: `Regal ${b.code}` }));
  const parts = db.prepare('SELECT id, name, qty FROM parts WHERE name LIKE ? OR part_number LIKE ? ORDER BY name LIMIT 12').all(q, q).map((p) => ({ kind: 'part', ref_id: p.id, label: p.name, sub: `${p.qty}× Teil` }));
  const open = new Set(hub.listFloating().map((f) => `${f.kind}:${f.ref_id}`));
  res.json([...tools, ...boxes, ...parts].map((x) => ({ ...x, floating: open.has(`${x.kind}:${x.ref_id}`) })));
});

router.post('/floating', (req, res) => {
  const kind = ['tool', 'box', 'part'].includes(req.body.kind) ? req.body.kind : 'other';
  const refId = kind === 'other' ? null : toIntOrNull(req.body.ref_id);
  const label = kind === 'other' ? strOrNull(req.body.label) : resolveRef(kind, refId);
  if (!label) throw httpError(400, kind === 'other' ? 'Was liegt rum? Bitte eine Bezeichnung angeben.' : 'Eintrag nicht gefunden.');
  const place = { spot: strOrNull(req.body.spot), object_id: toIntOrNull(req.body.object_id), vehicle_id: toIntOrNull(req.body.vehicle_id) };
  const existing = refId ? db.prepare('SELECT id FROM float_items WHERE kind = ? AND ref_id = ? AND returned_at IS NULL').get(kind, refId) : null;
  let id;
  if (existing) {
    id = existing.id;
    if (place.spot || place.object_id || place.vehicle_id) updateRow('float_items', id, { ...place, spot: spotText(place) });
  } else {
    id = insertRow('float_items', { kind, ref_id: refId, label, ...place, spot: spotText(place), user_id: req.user.id, created_at: nowIso() });
  }
  const items = hub.listFloating();
  res.status(existing ? 200 : 201).json({ item: items.find((f) => f.source === 'float' && f.id === id), items, count: items.length, hud: hub.hudData() });
});

router.put('/floating/:id', (req, res) => {
  const f = mustGet('float_items', req.params.id, 'Eintrag');
  const place = { spot: strOrNull(req.body.spot), object_id: toIntOrNull(req.body.object_id), vehicle_id: toIntOrNull(req.body.vehicle_id) };
  updateRow('float_items', f.id, { ...place, spot: spotText(place) });
  const items = hub.listFloating();
  res.json({ items, count: items.length, hud: hub.hudData() });
});

router.post('/floating/return-all', (req, res) => {
  const ts = nowIso();
  let n = 0;
  db.transaction(() => {
    n += db.prepare('UPDATE float_items SET returned_at = ?, returned_by = ? WHERE returned_at IS NULL').run(ts, req.user.id).changes;
    n += db.prepare('UPDATE tools SET borrowed_by = NULL, borrowed_vehicle_id = NULL, borrowed_at = NULL WHERE borrowed_by IS NOT NULL').run().changes;
  })();
  res.json({ returned: n, items: [], count: 0, hud: hub.hudData() });
});

router.post('/floating/:id/return', (req, res) => {
  const f = mustGet('float_items', req.params.id, 'Eintrag');
  if (!f.returned_at) {
    db.transaction(() => {
      db.prepare('UPDATE float_items SET returned_at = ?, returned_by = ? WHERE id = ?').run(nowIso(), req.user.id, f.id);
      // war es zusätzlich per "Nehme ich" ausgeliehen, gilt es jetzt ebenfalls als zurück
      if (f.kind === 'tool' && f.ref_id) db.prepare('UPDATE tools SET borrowed_by = NULL, borrowed_vehicle_id = NULL, borrowed_at = NULL WHERE id = ?').run(f.ref_id);
    })();
  }
  const items = hub.listFloating();
  res.json({ items, count: items.length, hud: hub.hudData() });
});

module.exports = router;
