/**
 * /api/auth: Login per Profil + PIN, Hall Pass (Gast), Logout, Me
 */
const express = require('express');
const { db, getSetting } = require('../db');
const { verifyPin, createSession, clearSession, loginThrottle } = require('../auth');
const activity = require('../lib/activity');   // v5.3: Anmeldungen und Profilwechsel im Aktivitäts-Log

const router = express.Router();

// Profilauswahl für den Login-Screen (ohne Login abrufbar)
router.get('/users', (_req, res) => {
  res.json(db.prepare("SELECT id, name, color, role FROM users WHERE active = 1 AND role != 'gast' ORDER BY id").all());
});

router.post('/login', loginThrottle, (req, res) => {
  const { userId, pin } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(userId);
  if (!user || !verifyPin(pin, user.pin_hash)) {
    req.loginFailed();
    if (user) activity.log(user, { type: 'login_failed', text: 'Anmeldung fehlgeschlagen (PIN falsch)', details: { device: activity.deviceOf(req) }, high: true });
    return res.status(401).json({ error: 'PIN falsch.' });
  }
  req.loginOk();
  const prev = req.user && req.user.id && req.user.id !== user.id ? req.user.name : null;
  createSession(res, req, { userId: user.id, role: user.role });
  activity.log(user, { type: prev ? 'profile_switch' : 'login', text: prev ? `Profilwechsel von ${prev} zu ${user.name}` : 'Angemeldet', details: { device: activity.deviceOf(req) }, high: true });
  res.json({ id: user.id, name: user.name, role: user.role, color: user.color });
});

// Hall Pass: Gast-Link für Eltern/Freunde (Nur-Lese-Modus)
router.post('/hallpass', loginThrottle, (req, res) => {
  const pass = getSetting('hallpass', { enabled: false });
  if (!pass.enabled || !req.body || req.body.token !== pass.token) {
    req.loginFailed();
    return res.status(401).json({ error: 'Hall Pass ungültig oder deaktiviert.' });
  }
  req.loginOk();
  createSession(res, req, { role: 'gast', label: 'Gast (Hall Pass)' });
  activity.log({ id: null, name: 'Gast' }, { type: 'login', text: 'Gast-Zugang (Hall Pass) geöffnet', details: { device: activity.deviceOf(req) }, high: true });
  res.json({ id: null, name: 'Gast', role: 'gast', color: '#94a3b8' });
});

router.post('/logout', (req, res) => {
  if (req.user) activity.log(req.user, { type: 'logout', text: (req.body && req.body.reason) === 'switch' ? 'Abgemeldet (Profil wechseln)' : 'Abgemeldet', details: { device: activity.deviceOf(req) }, high: true });
  clearSession(req, res);
  res.json({ ok: true });
});

// PIN erneut bestätigen (z. B. bevor der Admin-Baukasten entsperrt wird)
router.post('/verify', loginThrottle, (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ error: 'Bitte anmelden.' });
  const user = db.prepare('SELECT pin_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user || !verifyPin(req.body && req.body.pin, user.pin_hash)) {
    req.loginFailed();
    return res.status(401).json({ error: 'PIN falsch.' });
  }
  req.loginOk();
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  res.json(req.user);
});

module.exports = router;
