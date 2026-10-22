/**
 * v5.3: Progressive Web App
 * - registriert den Service Worker (/sw.js)
 * - merkt sich das Android/Chrome-Installationsangebot ("App installieren")
 * - erklärt am iPhone den Weg über "Teilen > Zum Home-Bildschirm"
 */
import { html, openModal, icon, toast } from './ui.js';

let deferred = null;

export const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initPwa() {
  document.documentElement.classList.toggle('pwa', isStandalone());
  if ('serviceWorker' in navigator && window.isSecureContext) {
    const reg = () => navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[pwa] Service Worker nicht registriert:', err.message));
    // erst wenn die Seite fertig geladen ist (stört den Start nicht); ist sie es schon, sofort
    if (document.readyState === 'complete') setTimeout(reg, 1500); else window.addEventListener('load', () => setTimeout(reg, 1500), { once: true });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { deferred = null; toast('Hallen-Manager ist jetzt auf dem Homescreen.', 'ok'); });
}

/** Soll im Profilmenü "Als App installieren" erscheinen? */
export const canOfferInstall = () => !isStandalone() && (!!deferred || isIos() || /Android/.test(navigator.userAgent));

export async function installApp() {
  if (deferred) {
    const ev = deferred;
    deferred = null;
    ev.prompt();
    try { await ev.userChoice; } catch { /* egal */ }
    return;
  }
  const ios = isIos();
  openModal({
    title: 'Als App auf den Homescreen', subtitle: 'Startet danach im Vollbild, ohne Adressleiste', size: 'sm', iconName: 'download',
    body: html`
      <div class="flex items-center gap-3 mb-4">
        <img src="/icons/icon-192.png" alt="" class="w-14 h-14 rounded-2xl shadow-lg">
        <div><div class="font-display font-bold text-white">Hallen-Manager</div><div class="text-xs text-slate-400">HALLE//OS · Kurzname „Halle“</div></div>
      </div>
      <ol class="space-y-2 text-sm text-slate-300 list-decimal pl-5">
        ${ios ? html`
          <li>Diese Seite in <b class="text-white">Safari</b> öffnen.</li>
          <li>Unten auf <b class="text-white">Teilen</b> tippen (Quadrat mit Pfeil nach oben).</li>
          <li><b class="text-white">Zum Home-Bildschirm</b> wählen und <b class="text-white">Hinzufügen</b> tippen.</li>`
        : html`
          <li>Im Browser-Menü (⋮ oben rechts) <b class="text-white">App installieren</b> bzw. <b class="text-white">Zum Startbildschirm hinzufügen</b> wählen.</li>
          <li>Bestätigen. Das Icon „Halle“ erscheint auf dem Homescreen.</li>`}
      </ol>
      <p class="text-[11px] text-slate-500 mt-4">${icon('lock', 'w-3 h-3 inline')} Angemeldet bleibst du wie im Browser. Daten kommen immer live vom Server.</p>`
  });
}
