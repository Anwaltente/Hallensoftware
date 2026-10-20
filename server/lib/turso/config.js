/**
 * Turso-Zugangsdaten aus den Umgebungsvariablen lesen (Render.com, .env, Shell).
 * ------------------------------------------------------------
 * Offizielle Namen (empfohlen):  TURSO_DATABASE_URL  und  TURSO_AUTH_TOKEN
 * Ebenfalls erkannt:             TURSO_URL, TURSO_DB_URL, LIBSQL_URL, DATABASE_URL (nur libsql:// bzw. *.turso.io)
 *                                TURSO_TOKEN, TURSO_DB_TOKEN, TURSO_DB_AUTH_TOKEN, LIBSQL_AUTH_TOKEN, DATABASE_AUTH_TOKEN ...
 * Ist keine Turso-URL gesetzt, arbeitet die App wie bisher mit der lokalen Datei data/halle.db.
 * Mit HALLE_DB=lokal (oder local) lässt sich Turso trotz gesetzter Variablen abschalten.
 */
const URL_KEYS = ['TURSO_DATABASE_URL', 'TURSO_DB_URL', 'TURSO_URL', 'LIBSQL_URL', 'LIBSQL_DATABASE_URL', 'TURSO_DATABASE', 'DATABASE_URL', 'DB_URL'];
const TOKEN_KEYS = ['TURSO_AUTH_TOKEN', 'TURSO_DB_AUTH_TOKEN', 'TURSO_TOKEN', 'TURSO_DB_TOKEN', 'TURSO_API_TOKEN', 'LIBSQL_AUTH_TOKEN', 'LIBSQL_TOKEN', 'DATABASE_AUTH_TOKEN', 'DATABASE_TOKEN', 'DB_AUTH_TOKEN', 'DB_TOKEN', 'AUTH_TOKEN'];

const looksTurso = (v) => /^libsql:\/\//i.test(v) || /^(https?|wss?):\/\/[^/]*\.turso\.io/i.test(v);

function tursoConfig(env = process.env) {
  if (/^(lokal|local|sqlite|file)$/i.test(String(env.HALLE_DB || ''))) return null;
  let urlKey = null;
  let url = null;
  for (const k of URL_KEYS) {
    const v = String(env[k] || '').trim();
    // Explizit für Turso benannte Variablen dürfen auch eine eigene https-Adresse enthalten (z. B. selbst gehosteter libSQL-Server)
    if (v && (looksTurso(v) || (/^TURSO_|^LIBSQL_/.test(k) && /^(https?|wss?):\/\//i.test(v)))) { urlKey = k; url = v; break; }
  }
  if (!url) {
    for (const [k, v] of Object.entries(env)) if (v && looksTurso(String(v).trim())) { urlKey = k; url = String(v).trim(); break; }
  }
  if (!url) return null;

  let token = null;
  let tokenKey = null;
  // Token kann auch direkt in der URL stecken: libsql://...?authToken=...
  const q = url.match(/[?&]authToken=([^&]+)/i);
  if (q) { token = decodeURIComponent(q[1]); tokenKey = `${urlKey} (?authToken)`; }
  url = url.replace(/\?.*$/, '');
  if (!token) {
    for (const k of TOKEN_KEYS) if (env[k] && String(env[k]).trim()) { token = String(env[k]).trim(); tokenKey = k; break; }
  }
  if (!token) {
    for (const [k, v] of Object.entries(env)) {
      if (v && /TOKEN/i.test(k) && /(TURSO|LIBSQL|DB|DATABASE)/i.test(k)) { token = String(v).trim(); tokenKey = k; break; }
    }
  }
  const httpUrl = url
    .replace(/^libsql:\/\//i, 'https://')
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://')
    .replace(/\/+$/, '');
  const host = httpUrl.replace(/^https?:\/\//i, '');
  return { url: httpUrl, host, token, urlKey, tokenKey };
}

module.exports = { tursoConfig };
