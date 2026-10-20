/**
 * v5.1: Budget-Kopplung
 * ------------------------------------------------------------
 * Kosten werden nur EINMAL eingegeben und erscheinen automatisch im Budget-Reiter:
 *   - Aufgabe mit Preis (offen)          -> Budget "Noch zu kaufen"  (purchases.task_id)
 *   - Aufgabe erledigt                   -> dieselbe Zeile wandert nach "Bereits gekauft" und hängt am Wartungsheft-Eintrag
 *   - Wartungsheft-Eintrag mit Kosten    -> Budget "Bereits gekauft"  (purchases.log_id)
 * Es entsteht pro Vorgang genau EINE Budget-Zeile. Verbrauchsbuchungen aus dem Schnell-Verbrauch zählen nicht
 * (das Material steht bereits beim Einkauf im Budget).
 */
const { db } = require('../db');

const nowIso = () => new Date().toISOString();
const money = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; };
const isConsumption = (l) => /^Verbrauch:/.test(l.title || '') && /^Schnell-Verbrauch/.test(l.description || '');

const byTask = (taskId) => db.prepare('SELECT * FROM purchases WHERE task_id = ? ORDER BY id LIMIT 1').get(taskId);
const byLog = (logId) => db.prepare('SELECT * FROM purchases WHERE log_id = ? ORDER BY id LIMIT 1').get(logId);

/** Offene Aufgabe anlegen/ändern: Budget-Zeile "Noch zu kaufen" anlegen, anpassen oder entfernen */
function syncTask(taskId) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!t) return;
  const cost = money(t.cost);
  const p = byTask(t.id);
  if (!cost) {
    if (p && !p.log_id) db.prepare('DELETE FROM purchases WHERE id = ?').run(p.id);
    return;
  }
  if (p) {
    db.prepare('UPDATE purchases SET name = ?, price = ?, qty = 1, vehicle_id = ? WHERE id = ?').run(t.title, cost, t.vehicle_id, p.id);
  } else {
    db.prepare(`INSERT INTO purchases (vehicle_id, name, price, qty, status, bought_at, created_at, task_id)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)`).run(t.vehicle_id, t.title, cost, t.status === 'done' ? 'bought' : 'todo', t.status === 'done' ? (t.done_at || nowIso()) : null, nowIso(), t.id);
  }
}

/** Aufgabe erledigt: Budget-Zeile auf "gekauft" setzen und mit dem neuen Wartungsheft-Eintrag verknüpfen */
function taskDone(task, logId, cost, ts) {
  const amount = money(cost);
  const p = byTask(task.id);
  if (p) {
    db.prepare(`UPDATE purchases SET status = 'bought', bought_at = COALESCE(bought_at, ?), log_id = COALESCE(?, log_id)${amount ? ', price = ?, qty = 1' : ''} WHERE id = ?`)
      .run(...[ts, logId || null, ...(amount ? [amount] : []), p.id]);
  } else if (amount) {
    db.prepare(`INSERT INTO purchases (vehicle_id, name, price, qty, status, bought_at, created_at, task_id, log_id)
      VALUES (?, ?, ?, 1, 'bought', ?, ?, ?, ?)`).run(task.vehicle_id, task.title, amount, ts, ts, task.id, logId || null);
  }
}

/** Aufgabe wieder geöffnet: Wartungsheft-Eintrag ist weg, Budget-Zeile zurück nach "Noch zu kaufen" */
function taskReopened(task) {
  const p = byTask(task.id);
  if (!p) return;
  if (money(task.cost)) db.prepare("UPDATE purchases SET status = 'todo', bought_at = NULL, log_id = NULL WHERE id = ?").run(p.id);
  else db.prepare('DELETE FROM purchases WHERE id = ?').run(p.id);
}

/** Aufgabe gelöscht: geplante Ausgabe entfällt, bereits getätigte bleibt im Budget */
function taskDeleted(taskId) {
  const p = byTask(taskId);
  if (!p) return;
  if (p.status === 'todo' && !p.log_id) db.prepare('DELETE FROM purchases WHERE id = ?').run(p.id);
  else db.prepare('UPDATE purchases SET task_id = NULL WHERE id = ?').run(p.id);
}

/** Manueller Wartungsheft-Eintrag mit Kosten -> Budget "Bereits gekauft" */
function syncLog(logId) {
  const l = db.prepare('SELECT * FROM maintenance_log WHERE id = ?').get(logId);
  if (!l || isConsumption(l)) return;
  const cost = money(l.cost);
  const p = byLog(l.id);
  if (!cost) {
    if (p && !p.task_id) db.prepare('DELETE FROM purchases WHERE id = ?').run(p.id);
    return;
  }
  if (p) db.prepare('UPDATE purchases SET name = ?, price = ?, qty = 1, vehicle_id = ?, bought_at = COALESCE(bought_at, ?) WHERE id = ?').run(l.title, cost, l.vehicle_id, l.done_at || nowIso(), p.id);
  else {
    db.prepare(`INSERT INTO purchases (vehicle_id, name, price, qty, status, bought_at, created_at, log_id)
      VALUES (?, ?, ?, 1, 'bought', ?, ?, ?)`).run(l.vehicle_id, l.title, cost, l.done_at || nowIso(), nowIso(), l.id);
  }
}

/** Wartungsheft-Eintrag gelöscht: eigene Budget-Zeile entfällt; gehört sie zu einer erledigten Aufgabe, bleibt sie */
function logDeleted(logId) {
  const p = byLog(logId);
  if (!p) return;
  if (p.task_id) db.prepare('UPDATE purchases SET log_id = NULL WHERE id = ?').run(p.id);
  else db.prepare('DELETE FROM purchases WHERE id = ?').run(p.id);
}

module.exports = { syncTask, taskDone, taskReopened, taskDeleted, syncLog, logDeleted, money };
