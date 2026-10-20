/**
 * v4: Gemeinsame Logik für Schnell-Verbrauch, kritische Ressourcen, Einkaufsliste und Schwebe-Status.
 * v4.2: Der Ist-Bestand der Kritischen Liste ist die Summe aller verknüpften Gebinde im Inventar (lib/stock.js).
 *       Einkaufs-Radar = Kritische Liste unter Mindestbestand + Kühlschrank unter Mindestbestand.
 * Wird von routes/hub.js (App) und routes/tv.js (Hallen-TV) genutzt.
 */
const { db } = require('../db');
const { parseJSON } = require('./util');
const stock = require('./stock');

const round = (n, d = 3) => Math.round(Number(n) * 10 ** d) / 10 ** d;

/** Zahl hübsch für Anzeige: Flüssigkeiten immer mit einer Nachkommastelle (1,0 L), Stückzahlen ganz */
function fmtQty(n, kind = 'piece') {
  if (n === null || n === undefined) return '?';
  const v = Number(n);
  if (kind === 'fluid') return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  return Number.isInteger(v) ? String(v) : v.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

function parseSteps(text, kind) {
  const arr = (Array.isArray(text) ? text : parseJSON(text, null)) || (kind === 'fluid' ? [0.5, 1, 2] : [1, 2]);
  return arr.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 6);
}

const lastMove = () => db.prepare(`SELECT m.id, m.kind, m.delta, m.created_at, u.name AS user_name, v.name AS vehicle_name
  FROM consumable_moves m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN vehicles v ON v.id = m.vehicle_id
  WHERE m.consumable_id = ? AND m.undone = 0 ORDER BY m.id DESC LIMIT 1`);

/**
 * Kategorie der Kritischen Liste mit aggregiertem Ist-Bestand.
 * unknown = noch kein einziges Gebinde im Inventar verknüpft (dann kein Alarm, nur Hinweis).
 */
function serializeConsumable(c, last = lastMove(), smap = stock.stockMap()) {
  const st = smap.get(c.id) || { total: 0, rows: [] };
  const unknown = st.rows.length === 0;
  const qty = unknown ? null : round(st.total);
  const low = !unknown && qty < c.min_qty;
  const fmt = (n) => `${fmtQty(n, c.kind)} ${c.unit}`;
  const firstShelf = st.rows.find((r) => r.shelf_id);
  return {
    ...c,
    qty,
    legacy_qty: c.qty,                     // alter v4-Wert (wird nicht mehr verwendet)
    critical: !!c.critical,
    active: !!c.active,
    steps: parseSteps(c.steps, c.kind),
    unknown,
    low,
    empty: !unknown && qty <= 0,
    crit: !!c.critical && low,
    emptyAmount: stock.openedRest(c.id),
    stock: st.rows.map((r) => ({ id: r.id, name: r.name, qty: r.qty, pack_size: r.pack_size, pack_unit: r.pack_unit, open_rest: r.open_rest, opened: r.opened, content: r.content, location: r.location, shelf_id: r.shelf_id, level: r.level, box_id: r.box_id })),
    breakdown: stock.breakdown(st.rows, fmt),
    map_object_id: (firstShelf && firstShelf.shelf_id) || c.location_object_id || null,
    last: last.get(c.id) || null
  };
}

function listConsumables({ all = false } = {}) {
  const last = lastMove();
  const smap = stock.stockMap();
  return db.prepare(`SELECT c.*, lo.code AS location_code, lo.label AS location_label FROM consumables c
    LEFT JOIN layout_objects lo ON lo.id = c.location_object_id
    ${all ? '' : 'WHERE c.active = 1'} ORDER BY c.kind = 'piece', c.sort, c.name`).all().map((c) => serializeConsumable(c, last, smap));
}

/** Text wie "Nur noch 1,5 L 10W-60 Motoröl vorhanden!" */
function critText(c) {
  if (c.qty <= 0) return `${c.name} ist LEER!`;
  return `Nur noch ${fmtQty(c.qty, c.kind)} ${c.unit} ${c.name} vorhanden!`;
}

/** Einkaufs-Vorschlag auf Basis der Gebindegröße, die im Lager am häufigsten vorkommt */
function buySuggestion(c) {
  const need = Math.max(0, round(c.min_qty - (c.qty || 0)));
  const counts = new Map();
  for (const r of c.stock || []) if (r.pack_size) counts.set(r.pack_size, (counts.get(r.pack_size) || 0) + Math.max(1, r.qty));
  const size = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map((e) => e[0])[0];
  const needText = `${fmtQty(need || c.min_qty, c.kind)} ${c.unit}`;
  if (!size) return { need, text: `mind. ${needText}` };
  const n = Math.max(1, Math.ceil((need || 0.001) / size));
  return { need, containers: n, pack_size: size, text: `mind. ${needText}, z. B. ${n} × ${fmtQty(size, c.kind)} ${c.unit}` };
}

/* ======================= Einkaufs-Radar + Hallen-Einkaufsliste ======================= */
function openListKeys() {
  return new Set(db.prepare("SELECT source, ref_id FROM shopping_list WHERE status = 'open' AND ref_id IS NOT NULL").all().map((r) => `${r.source}:${r.ref_id}`));
}

/** "Demnächst einkaufen": Kritische Liste unter Soll + Kühlschrank unter Mindestbestand */
function radar() {
  const onList = openListKeys();
  const cons = listConsumables().filter((c) => c.low).sort((a, b) => b.crit - a.crit);
  const items = cons.map((c) => ({
    key: `consumable:${c.id}`, source: 'consumable', ref_id: c.id, name: c.name, level: c.crit ? 'critical' : 'low',
    kind: c.kind, unit: c.unit, qty: c.qty, min_qty: c.min_qty,
    text: c.qty <= 0 ? `${c.name} ist leer (Soll ${fmtQty(c.min_qty, c.kind)} ${c.unit})` : `Nur ${fmtQty(c.qty, c.kind)} ${c.unit} von ${fmtQty(c.min_qty, c.kind)} ${c.unit} da`,
    buy: buySuggestion(c), onList: onList.has(`consumable:${c.id}`)
  }));
  const fridge = db.prepare("SELECT id, name, qty, min_qty, unit, pack_size FROM supplies WHERE category = 'kuehlschrank' AND qty < min_qty ORDER BY sort, name").all()
    .map((s) => ({
      key: `supply:${s.id}`, source: 'supply', ref_id: s.id, name: s.name, level: 'low', unit: s.unit, qty: s.qty, min_qty: s.min_qty, pack_size: s.pack_size,
      text: s.qty <= 0 ? `${s.name} ist leer` : `Nur noch ${s.qty} ${s.unit} da (mind. ${s.min_qty})`,
      buy: { text: `${Math.max(1, Math.ceil((s.min_qty - s.qty) / (s.pack_size || 1)))} × Kiste/Packung (${s.pack_size} ${s.unit})` },
      onList: onList.has(`supply:${s.id}`)
    }));
  return [...items, ...fridge];
}

function shoppingListRows() {
  return db.prepare(`SELECT s.*, u.name AS created_by_name FROM shopping_list s LEFT JOIN users u ON u.id = s.created_by
    WHERE s.status = 'open' ORDER BY s.created_at`).all();
}

/** Alles für den Reiter "Einkauf": Radar, Hallen-Einkaufsliste, offene Auto-Einkäufe */
function shoppingList() {
  const r = radar();
  const list = shoppingListRows();
  const purchases = db.prepare(`SELECT p.id, p.name, p.price, p.qty, p.url, v.name AS vehicle_name FROM purchases p
    LEFT JOIN vehicles v ON v.id = p.vehicle_id WHERE p.status = 'todo' ORDER BY p.created_at`).all();
  return { radar: r, list, purchases, counts: { critical: r.filter((x) => x.level === 'critical').length, radar: r.length, radarNew: r.filter((x) => !x.onList).length, list: list.length, purchases: purchases.length } };
}

/* ======================= Schwebe-Status ======================= */
function homeOf(kind, refId) {
  if (!refId) return null;
  if (kind === 'tool') {
    const t = db.prepare(`SELECT t.location_text, t.level, lo.code AS shelf_code, b.label AS box_label FROM tools t
      LEFT JOIN layout_objects lo ON lo.id = t.shelf_id LEFT JOIN boxes b ON b.id = t.box_id WHERE t.id = ?`).get(refId);
    if (!t) return null;
    return t.shelf_code ? `Regal ${t.shelf_code}${t.level ? ` · E${t.level}` : ''}${t.box_label ? ` · ${t.box_label}` : ''}` : (t.location_text || null);
  }
  if (kind === 'box') {
    const b = db.prepare('SELECT b.level, b.position, lo.code AS shelf_code FROM boxes b JOIN layout_objects lo ON lo.id = b.shelf_id WHERE b.id = ?').get(refId);
    return b ? `Regal ${b.shelf_code} · E${b.level} · Platz ${b.position}` : null;
  }
  if (kind === 'part') {
    const p = db.prepare(`SELECT p.level, lo.code AS shelf_code, b.label AS box_label FROM parts p
      LEFT JOIN layout_objects lo ON lo.id = p.shelf_id LEFT JOIN boxes b ON b.id = p.box_id WHERE p.id = ?`).get(refId);
    if (!p || !p.shelf_code) return null;
    return `Regal ${p.shelf_code}${p.level ? ` · E${p.level}` : ''}${p.box_label ? ` · ${p.box_label}` : ''}`;
  }
  return null;
}

function listFloating() {
  const floats = db.prepare(`SELECT f.*, u.name AS user_name, u.color AS user_color, v.name AS vehicle_name, v.slot_id AS vehicle_slot_id,
      lo.code AS object_code, lo.label AS object_label
    FROM float_items f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN vehicles v ON v.id = f.vehicle_id
    LEFT JOIN layout_objects lo ON lo.id = f.object_id
    WHERE f.returned_at IS NULL ORDER BY f.created_at`).all()
    .map((f) => ({ ...f, source: 'float', home: homeOf(f.kind, f.ref_id) }));
  // Bestehende Werkzeug-Ausleihe ("Nehme ich") zählt ebenfalls als "liegt rum"
  const borrowed = db.prepare(`SELECT t.id AS ref_id, t.name AS label, t.borrowed_at AS created_at, u.name AS user_name, u.color AS user_color,
      v.name AS vehicle_name, v.id AS vehicle_id, v.slot_id AS vehicle_slot_id
    FROM tools t LEFT JOIN users u ON u.id = t.borrowed_by LEFT JOIN vehicles v ON v.id = t.borrowed_vehicle_id
    WHERE t.borrowed_by IS NOT NULL ORDER BY t.borrowed_at`).all()
    .filter((t) => !floats.some((f) => f.kind === 'tool' && f.ref_id === t.ref_id))
    .map((t) => ({ ...t, id: `tool-${t.ref_id}`, kind: 'tool', source: 'borrow', spot: t.vehicle_name ? `am ${t.vehicle_name}` : 'in Benutzung', home: homeOf('tool', t.ref_id) }));
  return [...floats, ...borrowed].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

/** v5.2: Werkzeug außer Haus, mit Überfälligkeit (Tage seit dem vereinbarten Rückgabedatum) */
function listLent() {
  const { today, daysBetween } = require('./util');
  const t = today();
  return db.prepare(`SELECT t.id, t.name, t.lent_to, t.lent_at, t.lent_due, t.lent_note, t.location_text, t.level, lo.code AS shelf_code, b.label AS box_label
    FROM tools t LEFT JOIN layout_objects lo ON lo.id = t.shelf_id LEFT JOIN boxes b ON b.id = t.box_id
    WHERE t.lent_to IS NOT NULL ORDER BY COALESCE(t.lent_due, '9999-12-31'), t.lent_at`).all().map((r) => {
    const overdueDays = r.lent_due && r.lent_due < t ? daysBetween(r.lent_due, t) : 0;
    const days = r.lent_at ? Math.max(0, daysBetween(String(r.lent_at).slice(0, 10), t)) : 0;
    return {
      ...r,
      days,
      overdue: overdueDays > 0,
      overdue_days: overdueDays,
      due_in: r.lent_due && !overdueDays ? daysBetween(t, r.lent_due) : null,
      home: r.shelf_code ? `Regal ${r.shelf_code}${r.level ? ` · E${r.level}` : ''}${r.box_label ? ` · ${r.box_label}` : ''}` : (r.location_text || null),
      text: overdueDays > 0 ? `Überfällig: ${r.name} bei ${r.lent_to} seit ${overdueDays} ${overdueDays === 1 ? 'Tag' : 'Tagen'}!` : `${r.name} bei ${r.lent_to}`
    };
  });
}

/** Kompakte Daten für HUD, Ticker und Hallen-TV */
function hudData() {
  const lent = listLent();
  const cons = listConsumables();
  const floating = listFloating();
  const r = radar();
  return {
    critical: cons.filter((c) => c.crit).map((c) => ({ id: c.id, name: c.name, qty: c.qty, unit: c.unit, kind: c.kind, min_qty: c.min_qty, text: critText(c), location_object_id: c.map_object_id })),
    low: cons.filter((c) => c.low && !c.crit).map((c) => ({ id: c.id, name: c.name, qty: c.qty, unit: c.unit, kind: c.kind, min_qty: c.min_qty })),
    unknownCritical: cons.filter((c) => c.critical && c.unknown).length,
    consumables: cons.map((c) => ({ id: c.id, name: c.name, kind: c.kind, unit: c.unit, qty: c.qty, min_qty: c.min_qty, critical: c.critical, crit: c.crit, low: c.low, unknown: c.unknown, location_object_id: c.map_object_id })),
    radar: r.map((x) => ({ key: x.key, source: x.source, ref_id: x.ref_id, name: x.name, level: x.level, text: x.text, onList: x.onList })),
    radarNew: r.filter((x) => !x.onList).length,
    shoppingOpen: db.prepare("SELECT COUNT(*) AS n FROM shopping_list WHERE status = 'open'").get().n,
    floating: floating.map((f) => ({ id: f.id, kind: f.kind, ref_id: f.ref_id || null, source: f.source, label: f.label, spot: f.spot, object_id: f.object_id || null, vehicle_id: f.vehicle_id || null, vehicle_slot_id: f.vehicle_slot_id || null, user_name: f.user_name, created_at: f.created_at })),
    floatCount: floating.length,
    lent,                 // v5.2: Werkzeug außer Haus
    overdue: lent.filter((l) => l.overdue).length
  };
}

module.exports = { listLent, radar, shoppingListRows, fmtQty, parseSteps, serializeConsumable, listConsumables, critText, buySuggestion, shoppingList, listFloating, homeOf, hudData, round };
