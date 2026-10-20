/**
 * v3: Zusätzliche Admin-Bereiche
 *   - Fahrzeug-Modelle verwalten (dynamische Liste aus der Datenbank, eigene Silhouetten)
 *   - TV-Dashboard konfigurieren (Wechseldauer, aktive Screens, Lauftexte, Wetter)
 */
import { renderDashBuilder } from './admin-dash.js';   // v5.2
import { store, refreshMeta, refreshVehicles } from './state.js';
import { get, post, put, del } from './api.js';
import { html, setHTML, on, icon, toast, toastError, confirmDialog, formData, openModal, el } from './ui.js';
import { carThumb } from './sprites.js';

function fresh(c) {
  const n = c.cloneNode(false);
  c.replaceWith(n);
  return n;
}

/* ====================================================================== */
/* Fahrzeug-Modelle                                                       */
/* ====================================================================== */
const PREVIEW_COLORS = ['#f5c518', '#1e40af', '#b91c1c', '#0f766e', '#9ca3af'];

function modelFields(m, shapes) {
  return html`
    <label class="sm:col-span-2"><span class="label">Bezeichnung</span><input class="input" name="label" value="${m.label || ''}" required placeholder="z. B. Trabant 601, Nissan S13, BMW E30"></label>
    <label><span class="label">Baureihe / Kürzel</span><input class="input" name="chassis" value="${m.chassis || ''}" placeholder="z. B. E30, S13"></label>
    <label><span class="label">Silhouette</span><select class="select" name="shape">${Object.entries(shapes).map(([k, l]) => html`<option value="${k}" ${m.shape === k ? 'selected' : ''}>${l}</option>`)}</select></label>
    <label><span class="label">Länge (m)</span><input class="input" type="number" step="0.01" min="2" max="8" name="length" value="${m.length || 4.4}"></label>
    <label><span class="label">Breite (m)</span><input class="input" type="number" step="0.01" min="1" max="3" name="width" value="${m.width || 1.8}"></label>
    <label><span class="label">Leergewicht (kg)</span><input class="input" type="number" min="0" name="weight_kg" value="${m.weight_kg || ''}" placeholder="für den Gespann-Rechner"></label>
    <label><span class="label">Sortierung</span><input class="input" type="number" name="sort" value="${m.sort ?? 100}"></label>`;
}

function previewFromForm(form, target) {
  const d = formData(form);
  const model = { shape: d.shape, length: Number(d.length) || 4.4, width: Number(d.width) || 1.8 };
  setHTML(target, html`${PREVIEW_COLORS.slice(0, 3).map((c) => html`<img src="${carThumb(model, c, { w: 120, h: 54 })}" class="w-[120px] h-[54px]" alt="">`)}`);
}

export async function tabModels(c0) {
  const c = fresh(c0);
  let data;
  try { data = await get('/vehicle-models'); } catch (err) { toastError(err); return; }
  const { models, shapes } = data;
  setHTML(c, html`
    <p class="text-sm text-slate-400 mb-4">Die Modellliste steuert das Dropdown beim Anlegen und Bearbeiten von Autos und die Silhouette auf der Hallen-Map. Standardmodelle können bearbeitet, aber nicht gelöscht werden.</p>
    <form class="card p-4 mb-5" data-newmodel>
      <div class="flex items-center gap-2 mb-3"><h4 class="font-display font-bold text-white flex-1">Neues Modell</h4><div class="flex gap-2" data-preview></div></div>
      <div class="grid sm:grid-cols-4 gap-2">${modelFields({ shape: 'coupe', length: 4.3, width: 1.7, sort: 100 }, shapes)}</div>
      <div class="flex justify-end mt-3"><button class="btn btn-primary">${icon('plus')} Modell anlegen</button></div>
    </form>
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
      ${models.map((m, i) => html`
        <div class="card p-3" data-model="${m.id}">
          <div class="flex items-center gap-3">
            <img src="${carThumb({ shape: m.shape, length: m.length, width: m.width }, PREVIEW_COLORS[i % PREVIEW_COLORS.length], { w: 96, h: 44 })}" class="w-24 h-11 shrink-0" alt="">
            <div class="min-w-0 flex-1">
              <div class="font-semibold text-white truncate">${m.label}</div>
              <div class="text-[11px] text-slate-400">${shapes[m.shape] || m.shape}${m.chassis ? ` · ${m.chassis}` : ''}</div>
              <div class="text-[11px] text-slate-500 font-mono">${m.length} × ${m.width} m${m.weight_kg ? ` · ${m.weight_kg} kg` : ''}</div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 mt-2">
            <span class="chip !text-[10px] ${m.builtin ? '' : '!text-cyan-200 !border-cyan-400/40'}">${m.builtin ? 'Standard' : 'Eigenes Modell'}</span>
            ${m.used ? html`<span class="chip !text-[10px]">${m.used} Auto${m.used > 1 ? 's' : ''}</span>` : ''}
            <button class="btn-icon !w-7 !h-7 ml-auto" data-editmodel="${m.id}" title="Bearbeiten">${icon('edit', 'w-3.5 h-3.5')}</button>
            ${m.builtin ? '' : html`<button class="btn-icon !w-7 !h-7 hover:!text-rose-300" data-delmodel="${m.id}" title="Löschen">${icon('trash', 'w-3.5 h-3.5')}</button>`}
          </div>
        </div>`)}
    </div>`);
  const form = c.querySelector('[data-newmodel]');
  const preview = () => previewFromForm(form, c.querySelector('[data-preview]'));
  form.addEventListener('input', preview);
  preview();
  const after = async (msg) => { await refreshMeta(); await refreshVehicles(); toast(msg, 'ok'); tabModels(c); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post('/admin/vehicle-models', formData(form)); await after('Modell angelegt. Es steht jetzt im Auto-Dropdown.'); } catch (err) { toastError(err); }
  });
  on(c, 'click', '[data-editmodel]', (_e, b) => {
    const m = models.find((x) => x.id === Number(b.dataset.editmodel));
    const body = el(html`<div><form class="grid sm:grid-cols-2 gap-3">${modelFields(m, shapes)}</form><div class="flex gap-2 mt-3" data-prev></div></div>`);
    const md = openModal({ title: `Modell: ${m.label}`, size: 'md', iconName: 'car', body,
      footer: html`<button class="btn" data-close>Abbrechen</button><button class="btn btn-primary" data-save>${icon('check')} Speichern</button>` });
    const f = body.querySelector('form');
    const pv = () => previewFromForm(f, body.querySelector('[data-prev]'));
    f.addEventListener('input', pv);
    pv();
    md.footer.querySelector('[data-save]').addEventListener('click', async () => {
      if (!f.reportValidity()) return;
      try { await put(`/admin/vehicle-models/${m.id}`, formData(f)); md.close(); await after('Modell gespeichert.'); } catch (err) { toastError(err); }
    });
  });
  on(c, 'click', '[data-delmodel]', async (_e, b) => {
    const m = models.find((x) => x.id === Number(b.dataset.delmodel));
    const q = m.used
      ? `${m.used} Auto(s) nutzen „${m.label}“. Beim Löschen werden sie auf „Dummy“ umgestellt (alle anderen Daten bleiben). Fortfahren?`
      : `Modell „${m.label}“ löschen?`;
    if (!(await confirmDialog(q, { danger: true, okLabel: 'Löschen' }))) return;
    try { await del(`/admin/vehicle-models/${m.id}${m.used ? '?force=1' : ''}`); await after('Modell gelöscht.'); } catch (err) { toastError(err); }
  });
}

/* ====================================================================== */
/* TV-Dashboard                                                            */
/* ====================================================================== */
const SCREENS = { tasks: 'Aufgaben & Schrauber-Status', event: 'Event-Radar & Countdown', stock: 'Vorräte & Probleme (Low-Stock)', hall: 'Hallen-Status & Wetter' };

export async function tabTv(c0) {
  const c = fresh(c0);
  let cfg;
  try { cfg = await get('/admin/tv'); } catch (err) { toastError(err); return; }
  const base = (store.settings && store.settings.publicUrl) || location.origin;
  const url = `${base}/tv?key=${cfg.token}`;
  setHTML(c, html`
    <div class="grid lg:grid-cols-2 gap-4">
      <div class="card p-4 space-y-3">
        <div class="flex items-center gap-3">
          <span class="text-cyan-300">${icon('board', 'w-6 h-6')}</span>
          <div class="flex-1"><h3 class="font-display font-bold text-white text-lg">Hallen-TV</h3><p class="text-sm text-slate-400">Vollbild-Slider für Smart-TV oder Mini-PC, ohne Maus und ohne Login.</p></div>
        </div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="check" name="enabled" ${cfg.enabled ? 'checked' : ''} form="tvform"> TV-Link aktiv</label>
        <div class="flex gap-2"><input class="input font-mono text-xs" readonly value="${url}" data-tvurl><button class="btn" data-copy>${icon('file')}</button></div>
        <div class="flex flex-wrap gap-2">
          <a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">${icon('eye')} Vorschau öffnen</a>
          <button class="btn" data-regen>${icon('refresh', 'w-3.5 h-3.5')} Neuer Schlüssel</button>
        </div>
        <p class="text-[11px] text-slate-500">Tipp: Am TV-Browser die Adresse öffnen und Vollbild (F11) aktivieren. Die Seite lädt sich selbst neu und hält das Display wach, wo der Browser das erlaubt. Auch erreichbar unter <span class="font-mono">/dashboard?key=…</span></p>
      </div>
      <form class="card p-4 space-y-3" id="tvform" data-tvform>
        <label class="block"><span class="label">Wechseldauer pro Screen / Seite (Sekunden)</span><input class="input" type="number" min="5" max="120" name="interval" value="${cfg.interval}"></label>
        <div><span class="label">Aktive Screens</span>
          <div class="grid sm:grid-cols-2 gap-1.5">${Object.entries(SCREENS).map(([k, l]) => html`<label class="flex items-center gap-2 text-sm card px-3 py-2"><input type="checkbox" class="check" name="screen_${k}" ${cfg.screens[k] ? 'checked' : ''}> ${l}</label>`)}</div></div>
        <label class="block"><span class="label">Hallen-Mitteilungen / Lauftexte (eine pro Zeile)</span>
          <textarea class="input" rows="4" name="messages" placeholder="Samstag 10 Uhr Reifenumziehen!&#10;Wer zuletzt geht, macht das Licht aus.">${(cfg.messages || []).join('\n')}</textarea></label>
        <div><span class="label">Wetter (optional, Open-Meteo, braucht Internet)</span>
          <div class="grid grid-cols-3 gap-1.5">
            <input class="input text-sm" name="wname" placeholder="Ort" value="${cfg.weather ? cfg.weather.name : ''}">
            <input class="input text-sm font-mono" name="wlat" placeholder="Breite 52.37" value="${cfg.weather ? cfg.weather.lat : ''}">
            <input class="input text-sm font-mono" name="wlon" placeholder="Länge 9.73" value="${cfg.weather ? cfg.weather.lon : ''}">
          </div>
          <p class="text-[10px] text-slate-500 mt-1">Koordinaten: in Google Maps Rechtsklick auf die Halle. Leer lassen = kein Wetter.</p></div>
        <button class="btn btn-primary w-full">${icon('check')} Speichern</button>
      </form>
    </div>
    <div class="mt-4" data-dash></div>`);
  renderDashBuilder(c.querySelector('[data-dash]'), { tvUrl: url });   // v5.2: Baukasten
  c.querySelector('[data-copy]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('TV-Link kopiert.', 'ok'); } catch { c.querySelector('[data-tvurl]').select(); }
  });
  c.querySelector('[data-regen]').addEventListener('click', async () => {
    if (!(await confirmDialog('Neuen Schlüssel erzeugen? Laufende TVs brauchen dann den neuen Link.', { okLabel: 'Erzeugen' }))) return;
    try { await post('/admin/tv/regenerate'); tabTv(c); } catch (err) { toastError(err); }
  });
  c.querySelector('[data-tvform]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const enabled = c.querySelector('[name="enabled"]').checked;
    const hasWeather = String(f.wlat).trim() !== '' && String(f.wlon).trim() !== '';
    try {
      await put('/admin/tv', {
        enabled,
        interval: Number(f.interval),
        screens: Object.fromEntries(Object.keys(SCREENS).map((k) => [k, !!f[`screen_${k}`]])),
        messages: String(f.messages || '').split('\n'),
        weather: hasWeather ? { name: f.wname, lat: String(f.wlat).replace(',', '.'), lon: String(f.wlon).replace(',', '.') } : null
      });
      toast('TV-Dashboard gespeichert. Der TV übernimmt es beim nächsten Abruf.', 'ok');
    } catch (err) { toastError(err); }
  });
}
