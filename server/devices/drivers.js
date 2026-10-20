/**
 * Geräte-Treiber (Smart Home / IoT)
 * ------------------------------------------------------------
 * Jeder Treiber implementiert:  async action(device, action, payload) -> neuer State
 * Optional:                       async read(device) -> State
 *
 * Neuen Treiber hinzufügen:
 *   1. Objekt unten ergänzen (z. B. "homematic")
 *   2. Gerät in der DB mit driver = "<name>" und endpoint = Basis-URL anlegen
 *   3. Fertig: POST /api/devices/:id/action { "action": "on" }
 */
const TIMEOUT = 5000;

async function httpGet(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } finally { clearTimeout(t); }
}

const drivers = {
  /** Demo-Treiber ohne Hardware: speichert nur den Zustand. */
  mock: {
    async action(device, action, payload = {}) {
      const state = { ...device.state };
      if (action === 'on') state.on = true;
      else if (action === 'off') state.on = false;
      else if (action === 'toggle') state.on = !state.on;
      else if (action === 'set') Object.assign(state, payload);
      state.updated_at = new Date().toISOString();
      return state;
    }
  },

  /** Shelly Gen1 (Plug S, 1PM ...): http://<ip>/relay/0?turn=on */
  shelly: {
    async action(device, action) {
      const turn = ['on', 'off', 'toggle'].includes(action) ? action : 'toggle';
      const r = await httpGet(`${device.endpoint.replace(/\/$/, '')}/relay/0?turn=${turn}`);
      return { on: !!r.ison, power: r.power, updated_at: new Date().toISOString() };
    },
    async read(device) {
      const r = await httpGet(`${device.endpoint.replace(/\/$/, '')}/relay/0`);
      return { on: !!r.ison, updated_at: new Date().toISOString() };
    }
  },

  /** Tasmota: http://<ip>/cm?cmnd=Power%20On */
  tasmota: {
    async action(device, action) {
      const cmd = { on: 'On', off: 'Off', toggle: 'Toggle' }[action] || 'Toggle';
      const r = await httpGet(`${device.endpoint.replace(/\/$/, '')}/cm?cmnd=Power%20${cmd}`);
      return { on: String(r.POWER || '').toUpperCase() === 'ON', updated_at: new Date().toISOString() };
    }
  },

  /** Generischer Webhook: ruft <endpoint>?action=<action> auf (z. B. Home Assistant, Node-RED). */
  webhook: {
    async action(device, action) {
      const url = new URL(device.endpoint);
      url.searchParams.set('action', action);
      const r = await httpGet(url.toString());
      return { ...device.state, last_action: action, response: r, updated_at: new Date().toISOString() };
    }
  }
};

module.exports = { drivers };
