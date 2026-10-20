/**
 * Authentifizierung & Rollen
 * ------------------------------------------------------------
 * Rollen:  gast (Hall Pass, nur lesen) < schrauber (schreiben) < admin (Baukasten)
 * Session: Token per Cookie "halle_sid" ODER Header "Authorization: Bearer <token>"
 *          (der Header ist für künftige Geräte/Skripte gedacht).
 */
const crypto = require('crypto');
const { db } = require('./db');

const ROLE_LEVEL = { gast: 0, schrauber: 1, admin: 2 };
const COOKIE = 'halle_sid';
const SESSION_DAYS = 60;

function verifyPin(pin, stored) {
  if (!stored || pin === undefined || pin === null) return false;
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(String(pin), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === calc.length && crypto.timingSafeEqual(calc, expected);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return parseCookies(req)[COOKIE] || null;
}

function createSession(res, req, { userId = null, role, label = null }) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, role, label) VALUES (?,?,?,?)').run(token, userId, role, label);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`);
  return token;
}

function clearSession(req, res) {
  const token = getToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Hängt req.user an (oder null). Blockiert nie selbst. */
function authenticate(req, _res, next) {
  req.user = null;
  const token = getToken(req);
  if (!token) return next();
  const row = db.prepare(`
    SELECT s.token, s.role AS s_role, s.label, s.created_at, u.id, u.name, u.role, u.color, u.active
    FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return next();
  const ageDays = (Date.now() - Date.parse(row.created_at)) / 86400000;
  if (ageDays > SESSION_DAYS) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return next();
  }
  if (row.s_role === 'gast') {
    req.user = { id: null, name: row.label || 'Gast', role: 'gast', color: '#94a3b8' };
  } else if (row.id && row.active) {
    req.user = { id: row.id, name: row.name, role: row.role, color: row.color };
  }
  next();
}

/** Zentrale Schranke für /api: Lesen ab Gast, Schreiben ab Schrauber. */
function guard(req, res, next) {
  // /tv/* prüft selbst den TV-Schlüssel (Kiosk ohne Login)
  if (req.path.startsWith('/auth/') || req.path === '/meta' || req.path === '/health' || req.path.startsWith('/tv/')) return next();
  if (!req.user) return res.status(401).json({ error: 'Bitte anmelden.' });
  if (req.method !== 'GET' && ROLE_LEVEL[req.user.role] < ROLE_LEVEL.schrauber) {
    return res.status(403).json({ error: 'Nur-Lese-Modus (Hall Pass).' });
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Bitte anmelden.' });
    if (ROLE_LEVEL[req.user.role] < ROLE_LEVEL[role]) return res.status(403).json({ error: 'Keine Berechtigung.' });
    next();
  };
}

/* Einfacher Brute-Force-Schutz für PIN-Logins (pro IP) */
const attempts = new Map();
function loginThrottle(req, res, next) {
  const key = req.ip || 'x';
  const entry = attempts.get(key) || { count: 0, until: 0 };
  if (entry.until > Date.now()) {
    return res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte kurz warten.' });
  }
  req.loginFailed = () => {
    entry.count += 1;
    if (entry.count >= 6) { entry.until = Date.now() + 5 * 60000; entry.count = 0; }
    attempts.set(key, entry);
  };
  req.loginOk = () => attempts.delete(key);
  next();
}

module.exports = { ROLE_LEVEL, verifyPin, authenticate, guard, requireRole, createSession, clearSession, loginThrottle };
