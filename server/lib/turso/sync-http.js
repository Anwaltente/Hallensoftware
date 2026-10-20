/**
 * Synchroner HTTP-POST (JSON) für die Turso-Anbindung
 * ------------------------------------------------------------
 * Der gesamte Server ist auf eine synchrone Datenbank ausgelegt (better-sqlite3-Stil:
 * db.prepare(...).get()). Turso spricht HTTP, also asynchron. Damit kein einziger Endpunkt
 * umgebaut werden muss, läuft der eigentliche fetch() in einem Worker-Thread; der Hauptthread
 * wartet blockierend (Atomics.wait) und holt die Antwort synchron ab (receiveMessageOnPort).
 *
 * Ohne Zusatzpakete: nur Node-Bordmittel (worker_threads, fetch ab Node 18).
 */
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const { port, signal } = workerData;
const flag = new Int32Array(signal);
parentPort.on('message', async (req) => {
  let out;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
  try {
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: ctrl.signal });
    out = { id: req.id, status: res.status, text: await res.text() };
  } catch (err) {
    const cause = err && err.cause ? (err.cause.code || err.cause.message) : '';
    out = { id: req.id, error: (err && err.name === 'AbortError') ? 'Zeitüberschreitung' : ((err && err.message) || String(err)) + (cause ? ' (' + cause + ')' : '') };
  } finally {
    clearTimeout(timer);
  }
  port.postMessage(out);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
`;

class SyncHttp {
  constructor({ timeoutMs = 30000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.signal = new SharedArrayBuffer(4);
    this.flag = new Int32Array(this.signal);
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.worker = new Worker(WORKER_SRC, { eval: true, workerData: { port: port2, signal: this.signal }, transferList: [port2] });
    this.worker.unref();
    this.port.unref();
    this.seq = 0;
  }

  /** POST mit JSON-Text, wartet synchron. Gibt { status, text } zurück oder wirft. */
  post(url, headers, bodyText) {
    this.seq += 1;
    const id = this.seq;
    Atomics.store(this.flag, 0, 0);
    this.worker.postMessage({ id, url, headers, body: bodyText, timeoutMs: this.timeoutMs });
    const deadline = Date.now() + this.timeoutMs + 5000;
    for (;;) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Datenbank (Turso) antwortet nicht: Zeitüberschreitung nach ${Math.round(this.timeoutMs / 1000)} s`);
      Atomics.wait(this.flag, 0, 0, left);
      Atomics.store(this.flag, 0, 0);   // vor dem Abholen zurücksetzen, damit keine Meldung verloren geht
      let msg;
      // ältere, verspätete Antworten (nach einer Zeitüberschreitung) überspringen
      while ((msg = receiveMessageOnPort(this.port))) {
        if (msg.message && msg.message.id === id) {
          const m = msg.message;
          if (m.error) throw new Error(`Datenbank (Turso) nicht erreichbar: ${m.error}`);
          return m;
        }
      }
    }
  }

  close() { try { this.worker.terminate(); } catch { /* egal */ } }
}

module.exports = { SyncHttp };
