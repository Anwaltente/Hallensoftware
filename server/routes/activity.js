/**
 * v5.3: Aktivitäts- und Audit-Log
 *
 *   POST /api/activity/track     Klicks und Interaktionen aus dem Browser (gesammelt, max. 100 je Anfrage)
 *   GET  /api/admin/activity     Admin: Protokoll lesen
 *        ?level=high|all  ?user=<Name>  ?from=JJJJ-MM-TT  ?to=JJJJ-MM-TT  ?q=<Text>  ?before=<id>  ?limit=100
 */
const express = require('express');
const { db } = require('../db');
const { requireRole } = require('../auth');
const activity = require('../lib/activity');
const { TZ } = require('../lib/util');

const router = express.Router();

/* ---------- Browser-Ereignisse (nur Detail-Ebene; Meilensteine entstehen ausschließlich auf dem Server) ---------- */
router.post('/activity/track', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Bitte anmelden.' });
  const list = Array.isArray(req.body && req.body.events) ? req.body.events.slice(0, 100) : [];
  let n = 0;
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const type = String(e.type || 'click').toLowerCase().replace(/[^a-z_]/g, '').slice(0, 24) || 'click';
    const text = String(e.text || '').trim();
    if (!text) continue;
    activity.log(req.user, { type: `ui_${type}`, text, details: e.details && typeof e.details === 'object' ? e.details : null, high: false, at: e.t || null });
    n += 1;
  }
  res.json({ ok: true, n });
});

/** Beginn eines Kalendertags (Hallen-Zeitzone) als UTC-ISO-Zeitstempel */
function dayStartUtc(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return null;
  const guess = Date.parse(`${day}T00:00:00Z`);
  // Abweichung der Zeitzone zu diesem Zeitpunkt bestimmen (Sommer-/Winterzeit)
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  const asLocal = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:00Z`);
  return new Date(guess - (asLocal - guess)).toISOString();
}

router.get('/admin/activity', requireRole('admin'), (req, res) => {
  activity.flush();   // gepufferte Einträge zuerst schreiben, damit die Ansicht aktuell ist
  const where = [];
  const args = [];
  const level = req.query.level === 'all' ? 'all' : 'high';
  if (level === 'high') where.push('is_high_level = 1');
  if (req.query.user) { where.push('user_name = ?'); args.push(String(req.query.user).slice(0, 60)); }
  const from = dayStartUtc(req.query.from);
  if (from) { where.push('created_at >= ?'); args.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || ''))) {
    const next = new Date(Date.parse(`${req.query.to}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    where.push('created_at < ?'); args.push(dayStartUtc(next));
  }
  if (req.query.q) {
    const like = `%${String(req.query.q).slice(0, 80)}%`;
    where.push('(description LIKE ? OR action_type LIKE ?)'); args.push(like, like);
  }
  if (/^\d+$/.test(String(req.query.before || ''))) { where.push('id < ?'); args.push(Number(req.query.before)); }
  const limit = Math.max(10, Math.min(300, Number(req.query.limit) || 100));
  const rows = db.prepare(`SELECT id, user_id, user_name, action_type, description, details_json, is_high_level, created_at
    FROM activity_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1);
  const hasMore = rows.length > limit;
  const users = db.prepare("SELECT name, color FROM users WHERE role != 'gast' ORDER BY id").all();
  res.json({
    level,
    rows: rows.slice(0, limit).map((r) => ({ ...r, details: (() => { try { return r.details_json ? JSON.parse(r.details_json) : null; } catch { return null; } })(), details_json: undefined })),
    hasMore,
    users
  });
});

module.exports = router;
