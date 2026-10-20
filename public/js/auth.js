/**
 * Login (Profil + PIN-Pad), Hall-Pass-Gastzugang, Abmelden,
 * Admin-PIN-Bestätigung und Post-Event Quick-Check-Abfrage.
 */
import { store, setState, canEdit, refreshWhiteboard, refreshVehicles } from './state.js';
import { get, post } from './api.js';
import { $, html, setHTML, el, on, pinPad, toast, toastError, openModal, closeAllModals, initials, haptic, icon } from './ui.js';

let onReady = null;

export async function initAuth(readyCb) {
  onReady = readyCb;
  const params = new URLSearchParams(location.search);
  const pass = params.get('pass');
  if (pass) {
    try {
      await post('/auth/hallpass', { token: pass });
      toast(document.documentElement.classList.contains('biz') ? 'Angemeldet mit Lesezugriff.' : 'Willkommen! Du bist im Nur-Lese-Modus (Hall Pass).', 'info', 5000);
    } catch (err) { toastError(err); }
    params.delete('pass');
    history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
  }
  try {
    const me = await get('/auth/me');
    setState({ me }, ['me']);
    hideLogin();
    await onReady();
  } catch {
    showLogin();
  }
}

function hideLogin() { setHTML($('#loginRoot'), ''); }

export async function showLogin() {
  closeAllModals();
  let users = [];
  try { users = await get('/auth/users'); } catch (err) { toastError(err); }
  const root = $('#loginRoot');
  setHTML(root, html`
    <div class="fixed inset-0 z-[45] login-bg overflow-y-auto">
      <div class="min-h-full flex flex-col items-center justify-center px-5 py-10">
        <div class="game-only w-16 h-16 rounded-xl hazard-anim ring-2 ring-black shadow-[0_0_40px_rgba(250,204,21,.35)] mb-5"></div>
        <h1 class="game-only font-display text-3xl sm:text-4xl font-bold tracking-[0.2em] text-white">HALLE<span class="text-cyan-300">//</span>OS</h1>
        <p class="game-only text-slate-400 mt-2 mb-10 text-center">Wer schraubt heute?</p>
        <div class="biz-only biz-logo biz-logo-lg mb-4" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></div>
        <h1 class="biz-only text-2xl font-semibold text-slate-900">Fleet &amp; Resource Management Portal <span class="text-slate-400 font-normal">v2.4</span></h1>
        <p class="biz-only text-slate-500 mt-1 mb-8 text-center text-sm">Bitte Benutzerkonto auswählen und mit PIN anmelden.</p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full max-w-2xl">
          ${users.map((u) => html`
            <button class="profile-card card p-5 flex flex-col items-center gap-3" data-user="${u.id}" style="--pc:${u.color}">
              <span class="w-16 h-16 rounded-full grid place-items-center text-xl font-bold text-black font-display" style="background:${u.color};box-shadow:0 0 24px ${u.color}66">${initials(u.name)}</span>
              <span class="font-display font-semibold text-white">${u.name}</span>
              <span class="text-[10px] uppercase tracking-widest ${u.role === 'admin' ? 'text-cyan-300' : 'text-slate-500'}">${u.role === 'admin' ? 'Admin' : 'Schrauber'}</span>
            </button>`)}
        </div>
        <p class="game-only text-xs text-slate-500 mt-10 max-w-md text-center">Eltern & Freunde: Mit dem Hall-Pass-Link vom Admin siehst du die Halle im Nur-Lese-Modus.</p>
      </div>
    </div>`);
  on(root, 'click', '[data-user]', async (_e, btn) => {
    const user = users.find((u) => u.id === Number(btn.dataset.user));
    haptic(10);
    const pin = await pinPad({ title: `Hallo ${user.name}!`, subtitle: 'PIN eingeben' });
    if (!pin) return;
    try {
      const me = await post('/auth/login', { userId: user.id, pin });
      setState({ me }, ['me']);
      hideLogin();
      toast(document.documentElement.classList.contains('biz') ? `Angemeldet als ${me.name}.` : `Servus ${me.name}! Viel Spaß in der Halle.`, 'ok');
      await onReady();
    } catch (err) { haptic([30, 50, 30]); toastError(err); }
  });
}

export async function logout() {
  try { await post('/auth/logout'); } catch { /* egal */ }
  setState({ me: null, adminUnlocked: false, builder: false }, ['me', 'builder']);
  showLogin();
}

/** Admin-Werkzeuge erst nach erneuter PIN-Eingabe freischalten (gilt für die Sitzung im Tab). */
export async function ensureAdminUnlocked() {
  if (store.adminUnlocked) return true;
  const pin = await pinPad({ title: 'Admin-Bereich', subtitle: 'Zur Sicherheit PIN bestätigen' });
  if (!pin) return false;
  try {
    await post('/auth/verify', { pin });
    store.adminUnlocked = true;
    return true;
  } catch (err) { toastError(err); return false; }
}

/* ---------------- Post-Event Quick-Check ---------------- */
export async function checkQuickChecks() {
  if (!canEdit()) return;
  let pending = [];
  try { pending = await get('/quickchecks/pending'); } catch { return; }
  for (const qc of pending) {
    // nacheinander abfragen
    // eslint-disable-next-line no-await-in-loop
    await showQuickCheck(qc);
  }
}

function showQuickCheck(qc) {
  return new Promise((resolve) => {
    const answers = qc.questions.map(() => ({ value: null, note: '' }));
    const body = el(html`<div>
      <div class="hazard h-1.5 rounded mb-4"></div>
      <p class="text-sm text-slate-400 mb-4">${qc.event_name ? html`Nach <b class="text-white">${qc.event_name}</b>` : 'Kurzer Check'}${qc.vehicle_name ? html` · Auto: <b class="text-white">${qc.vehicle_name}</b>` : ''}. Deine Antworten erzeugen bei Bedarf automatisch Aufgaben.</p>
      <div class="space-y-3" data-qs>
        ${qc.questions.map((q, i) => html`
          <div class="card p-3" data-q="${i}">
            <div class="font-semibold text-white mb-2">${q.text}</div>
            <div class="flex gap-2 mb-2">
              <button class="btn flex-1" data-ans="yes">Ja</button>
              <button class="btn flex-1" data-ans="no">Nein</button>
            </div>
            <input class="input text-sm" placeholder="Notiz (optional)" data-note>
          </div>`)}
      </div></div>`);
    let done = false;
    const m = openModal({
      title: qc.title, subtitle: 'Post-Event Quick-Check', iconName: 'flag', size: 'md', body,
      footer: html`<button class="btn" data-close>Später</button><button class="btn btn-primary" data-submit disabled>${icon('check')} Absenden</button>`,
      onClose: () => { if (!done) resolve(); }
    });
    const submit = m.footer.querySelector('[data-submit]');
    on(body, 'click', '[data-ans]', (_e, b) => {
      const card = b.closest('[data-q]');
      const idx = Number(card.dataset.q);
      answers[idx].value = b.dataset.ans;
      card.querySelectorAll('[data-ans]').forEach((x) => x.classList.remove('btn-lime', 'btn-danger'));
      b.classList.add(b.dataset.ans === 'yes' ? 'btn-lime' : 'btn-danger');
      haptic(8);
      submit.disabled = answers.some((a) => !a.value);
    });
    on(body, 'input', '[data-note]', (_e, inp) => { answers[Number(inp.closest('[data-q]').dataset.q)].note = inp.value; });
    submit.addEventListener('click', async () => {
      try {
        const res = await post(`/quickchecks/${qc.id}/answer`, { answers: answers.map((a, index) => ({ index, ...a })) });
        done = true;
        m.close();
        toast(res.createdTasks.length ? `Danke! Neue Aufgaben: ${res.createdTasks.join(', ')}` : 'Danke, alles notiert.', 'ok', 5000);
        await Promise.all([refreshWhiteboard(), refreshVehicles()]);
        resolve();
      } catch (err) { toastError(err); }
    });
  });
}
