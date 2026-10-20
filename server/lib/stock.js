/**
 * v4.2: Bestand aus dem Inventar (Gebinde) statt aus einer Zahl an der Kritischen Liste
 * ------------------------------------------------------------
 * Ein Inventar-Teil (Tabelle parts) ist ein Gebinde-Typ an einem Lagerort, z. B.
 *   2× "10W-60 (1 L Dose)"     Regal A, Ebene 2   -> qty 2, pack_size 1, pack_unit L, consumable_id = 10W-60
 *   1× "10W-60 (5 L Kanister)" Regal B, Ebene 1   -> qty 1, pack_size 5
 * open_rest = Restmenge im angebrochenen Gebinde dieser Zeile (NULL = keins offen).
 *
 * Ist-Bestand einer Kategorie = Summe über alle verknüpften Gebinde:
 *   (qty - offen) × pack_size + open_rest
 *
 * Abzug (Schnell-Verbrauch): zuerst aus angebrochenen Gebinden (kleinster Rest zuerst),
 * dann wird das kleinste volle Gebinde angebrochen bzw. ganz verbraucht.
 */
const { db } = require('../db');

const r3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** Inhalt einer Gebinde-Zeile in der Einheit der Kategorie */
function partContent(p) {
  const qty = Math.max(0, Number(p.qty) || 0);
  const size = Number(p.pack_size) || 0;
  if (!qty || size <= 0) return 0;
  const open = p.open_rest !== null && p.open_rest !== undefined;
  return r3((open ? qty - 1 : qty) * size + (open ? Math.max(0, Number(p.open_rest)) : 0));
}

function locationText(p) {
  if (!p.shelf_code) return 'ohne Lagerort';
  return `Regal ${p.shelf_code}${p.level ? ` · Ebene ${p.level}` : ''}${p.box_label ? ` · ${p.box_label}` : ''}`;
}

const STOCK_SELECT = `SELECT p.id, p.name, p.qty, p.pack_size, p.pack_unit, p.open_rest, p.consumable_id, p.shelf_id, p.level, p.box_id,
    lo.code AS shelf_code, b.label AS box_label
  FROM parts p LEFT JOIN layout_objects lo ON lo.id = p.shelf_id LEFT JOIN boxes b ON b.id = p.box_id`;

/** Alle verknüpften Gebinde, gruppiert nach Kategorie: Map(consumable_id -> { total, rows }) */
function stockMap() {
  const map = new Map();
  for (const p of db.prepare(`${STOCK_SELECT} WHERE p.consumable_id IS NOT NULL ORDER BY p.pack_size, p.id`).all()) {
    const row = { ...p, content: partContent(p), location: locationText(p), opened: p.open_rest !== null && p.qty > 0 };
    if (!map.has(p.consumable_id)) map.set(p.consumable_id, { total: 0, rows: [] });
    const e = map.get(p.consumable_id);
    e.rows.push(row);
    e.total = r3(e.total + row.content);
  }
  return map;
}

function stockOf(consumableId) {
  return stockMap().get(Number(consumableId)) || { total: 0, rows: [] };
}

/** Kurztext wie "2× 1 L · 1× 5 L (1 angebrochen)" */
function breakdown(rows, fmt) {
  const byPack = new Map();
  let opened = 0;
  for (const r of rows) {
    if (!r.qty || !r.pack_size) continue;
    const k = r.pack_size;
    byPack.set(k, (byPack.get(k) || 0) + r.qty);
    if (r.opened) opened += 1;
  }
  const parts = [...byPack.entries()].sort((a, b) => a[0] - b[0]).map(([size, n]) => `${n}× ${fmt(size)}`);
  return parts.length ? `${parts.join(' · ')}${opened ? ` (${opened} angebrochen)` : ''}` : '';
}

const getRow = db.prepare('SELECT id, qty, open_rest, pack_size FROM parts WHERE id = ?');
const setRow = db.prepare('UPDATE parts SET qty = ?, open_rest = ? WHERE id = ?');

/**
 * Menge abziehen. Muss innerhalb einer Transaktion laufen.
 * Rückgabe: { taken, shortfall, changes: [{ part_id, qty_before, open_before, qty_after, open_after }] }
 */
function deduct(consumableId, amount) {
  let remaining = r3(amount);
  const changes = new Map();
  const rows = db.prepare('SELECT id, qty, open_rest, pack_size FROM parts WHERE consumable_id = ? AND qty > 0 AND pack_size > 0 ORDER BY pack_size, id')
    .all(consumableId).map((r) => ({ ...r }));
  const touch = (r, qty, open) => {
    if (!changes.has(r.id)) changes.set(r.id, { part_id: r.id, qty_before: r.qty, open_before: r.open_rest });
    r.qty = qty; r.open_rest = open;
    const c = changes.get(r.id);
    c.qty_after = qty; c.open_after = open;
  };
  // 1) angebrochene Gebinde zuerst (kleinster Rest zuerst)
  for (const r of rows.filter((x) => x.open_rest !== null).sort((a, b) => a.open_rest - b.open_rest)) {
    if (remaining <= 0) break;
    const take = Math.min(r.open_rest, remaining);
    const rest = r3(r.open_rest - take);
    remaining = r3(remaining - take);
    if (rest <= 0.0005) touch(r, r.qty - 1, null);
    else touch(r, r.qty, rest);
  }
  // 2) dann das kleinste volle Gebinde anbrechen oder ganz verbrauchen
  while (remaining > 0.0005) {
    const r = rows.filter((x) => x.qty > 0 && x.open_rest === null).sort((a, b) => a.pack_size - b.pack_size || a.id - b.id)[0];
    if (!r) break;
    if (remaining >= r.pack_size - 0.0005) {
      remaining = r3(remaining - r.pack_size);
      touch(r, r.qty - 1, null);
    } else {
      touch(r, r.qty, r3(r.pack_size - remaining));
      remaining = 0;
    }
  }
  for (const c of changes.values()) setRow.run(c.qty_after, c.open_after, c.part_id);
  const shortfall = Math.max(0, r3(remaining));
  return { taken: r3(amount - shortfall), shortfall, changes: [...changes.values()] };
}

/** Kleinster offener Rest (für den Button "Angebrochenes leer!") */
function openedRest(consumableId) {
  const r = db.prepare('SELECT id, open_rest FROM parts WHERE consumable_id = ? AND qty > 0 AND open_rest IS NOT NULL ORDER BY open_rest LIMIT 1').get(consumableId);
  return r ? r3(r.open_rest) : null;
}

/** Rückgängig: nur Zeilen zurücksetzen, die seitdem niemand verändert hat */
function undoChanges(changes) {
  let restored = 0; let skipped = 0;
  for (const c of changes || []) {
    const cur = getRow.get(c.part_id);
    if (!cur) { skipped += 1; continue; }
    const same = cur.qty === c.qty_after && (cur.open_rest === null ? c.open_after === null : Math.abs(cur.open_rest - (c.open_after ?? -1)) < 0.0005);
    if (!same) { skipped += 1; continue; }
    setRow.run(c.qty_before, c.open_before, c.part_id);
    restored += 1;
  }
  return { restored, skipped };
}

module.exports = { partContent, stockMap, stockOf, breakdown, deduct, openedRest, undoChanges, locationText, STOCK_SELECT, r3 };
