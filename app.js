/* Jukebox Catalog app.
   Live mode: the app has the Google Sheet's web address, so it reads and saves through the Sheet.
   Demo mode: no address, so it runs on the sample albums in sample-data.js and keeps changes on this device.

   Where the web address comes from (first match wins):
     1. apiUrl in config.js
     2. the page address after #api= (how the tablet is set up, so the address never sits in the public files)
     3. the address this device saved the last time it was opened with #api=
   Opening the page with #api=off forgets the saved address. */
(function () {
'use strict';

/* =========================================================
   Config
   ========================================================= */
const USER = window.JUKEBOX_CONFIG || {};
const API_KEY = 'jukebox-catalog-api';
// Only a Google Apps Script address is accepted from a link, so a crafted link can't send the PIN elsewhere.
const GOOGLE_API = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
function findApiUrl() {
  const fromConfig = String(USER.apiUrl || '').trim();
  if (fromConfig) return fromConfig;
  const m = /[#&]api=([^&]*)/.exec(location.hash || '');
  let fromPage = null;
  try { fromPage = m ? decodeURIComponent(m[1]).trim() : null; } catch (e) { fromPage = null; }
  try {
    if (fromPage === 'off') { localStorage.removeItem(API_KEY); return ''; }
    if (fromPage && GOOGLE_API.test(fromPage)) { localStorage.setItem(API_KEY, fromPage); return fromPage; }
    const saved = localStorage.getItem(API_KEY) || '';
    return GOOGLE_API.test(saved) ? saved : '';
  } catch (e) {
    return fromPage && GOOGLE_API.test(fromPage) ? fromPage : '';   // storage blocked: use the link only
  }
}
const API_URL = findApiUrl();
const LIVE = !!API_URL;
const CONFIG = {
  apiUrl: API_URL,
  printing: USER.printing !== false,
  jukeboxName: 'Rowe AMI',
  slotCount: 100,       // slots are numbered 00–99, like the jukebox
  indexPerPage: 25,
  slotsPerCard: 2,      // each title card: one disc on the top half, the next on the bottom
  // Title card size and sheet layout, in inches. The cards are 3 × 5 5/8 in (measured 11/2), so a
  // letter sheet turned landscape holds 3 upright cards side by side.
  card: { w: 3, h: 5.625, gap: 0.25, perSheet: 3, sheetW: 11, sheetH: 8.5 },
  idleMinutes: 2,
  newDays: 14,
  paper: 'letter',      // binder page size; A5 would need its own entry in PAPER
  demoKey: 'jukebox-catalog-demo-v3',
  cacheKey: 'jukebox-catalog-cache-v1',
  refreshMs: 10 * 60 * 1000,
};
const PAPER = {
  letter: { ratio: '8.5 / 11', twoColAfter: 16 },
};

// Confirmed at the jukebox (11/1): disc number 00–99 first, then the two-digit track.
function selectionCode(slot, track) { return [pad2(slot), pad2(track)]; }
function pad2(n) { return String(n).padStart(2, '0'); }

// Discogs genre names, shortened for the filter chips.
const GENRE_LABELS = { 'Funk / Soul': 'Funk & Soul', 'Folk, World, & Country': 'Folk & Country' };
const GENRE_ORDER = ['Rock', 'Pop', 'Funk & Soul', 'Jazz', 'Blues', 'Folk & Country', 'Country', 'Folk', 'Reggae', 'Latin', 'World', 'Electronic', 'Hip Hop', 'Classical', 'Stage & Screen'];

const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }

/* =========================================================
   Data
   ========================================================= */
let ALBUMS = [];
let BY_ID = {};
let state = { slots: {}, tags: {}, vocab: [], swapLog: [], reprint: [], printed: {}, arrived: [], newIds: [] };
const remote = { settings: {}, lastSync: {}, loadedAt: 0, offline: false, loaded: false, pinRequired: false };

function prepAlbum(a) {
  a.genres = (a.genres || []).map(g => GENRE_LABELS[g] || g);
  a.styles = a.styles || [];
  a.format = a.format || 'CD';
  a.discs = a.discs && a.discs.length ? a.discs : [[]];
  a._hay = norm([a.artist, a.sortName, a.title].join(' '));
  a._tracks = a.discs.map(d => d.map(t => norm(t || '')));
  return a;
}
function setAlbums(list) {
  ALBUMS = list.map(prepAlbum);
  BY_ID = Object.fromEntries(ALBUMS.map(a => [a.id, a]));
}

let LOC = {};          // "id:disc" -> slot
let SLOTS_BY_ID = {};  // id -> [{slot, disc}]
function reindex() {
  LOC = {}; SLOTS_BY_ID = {};
  Object.entries(state.slots).forEach(([s, v]) => {
    LOC[v.id + ':' + v.disc] = +s;
    (SLOTS_BY_ID[v.id] = SLOTS_BY_ID[v.id] || []).push({ slot: +s, disc: v.disc });
  });
  Object.values(SLOTS_BY_ID).forEach(list => list.sort((a, b) => a.disc - b.disc));
}

// ---- Live: the catalog from the Sheet ----
function validKey(k) {
  const [kind, ref] = String(k).split(':');
  return kind === 'album' ? !!BY_ID[ref] : (kind === 'index' || kind === 'card') && /^\d+$/.test(ref || '');
}
function applyCatalog(cat) {
  setAlbums(cat.albums.map(a => {
    const discs = (cat.tracks[a.releaseId] || []).map(d => Array.from(d, t => t || ''));
    while (discs.length < (a.discs || 1)) discs.push([]);
    return {
      id: a.id, artist: a.artist, sortName: a.sortName || a.artist, title: a.title, origYear: a.origYear || 0,
      pressYear: a.pressYear || 0, format: a.format, genres: a.genres, styles: a.styles, label: a.label,
      cover: a.cover, added: a.added, removed: !!a.removed, discs,
    };
  }));
  state.slots = {};
  Object.keys(cat.slots || {}).forEach(k => {
    const v = cat.slots[k];
    if (BY_ID[v.id] && +k >= 0 && +k < CONFIG.slotCount) state.slots[+k] = { id: v.id, disc: Number(v.disc) || 1 };
  });
  state.tags = Object.fromEntries(cat.albums.map(a => [a.id, a.tags || []]));
  state.vocab = cat.tags || [];
  const list = (cat.printList || []).filter(p => validKey(p.key)).sort((x, y) => x.queued - y.queued);
  state.reprint = list.map(p => p.key);
  state.printed = {};
  list.forEach(p => { if (p.printed) state.printed[p.key] = p.printed; });
  state.swapLog = cat.swapLog || [];
  remote.settings = cat.settings || {};
  remote.pinRequired = cat.pinRequired !== false;   // an older script that doesn't say still wants its PIN
  remote.lastSync = cat.lastSync || {};
  remote.loadedAt = cat.generatedAt || Date.now();
  remote.loaded = true;
  reindex();
}

// ---- Demo: sample albums, changes kept on this device ----
const SAMPLE = window.JUKEBOX_SAMPLE || { raw: '', pending: [], tagVocab: [], tags: {}, slots: [] };
function demoAlbums() {
  const split = s => s.split(',').map(x => x.trim()).filter(Boolean);
  return SAMPLE.raw.trim().split('\n').filter(Boolean).map(line => {
    const f = line.split('|').map(s => s.trim());
    return {
      id: f[0], artist: f[1], sortName: f[2], title: f[3], origYear: +f[4], pressYear: +f[5], format: 'CD',
      genres: split(f[6]), styles: split(f[7]), label: f[8], cover: '', added: '',
      discs: f[9].split('##').map(d => d.split(';').map(t => t.trim()).filter(Boolean)),
    };
  });
}
function demoFresh() {
  const slots = {};
  SAMPLE.slots.forEach(([s, id, d]) => { slots[s] = { id, disc: d }; });
  return { v: 3, slots, tags: JSON.parse(JSON.stringify(SAMPLE.tags)), vocab: SAMPLE.tagVocab.slice(),
    arrived: [], newIds: [], swapLog: [], reprint: [], printed: {} };
}
function demoLoad() { const s = readJSON(CONFIG.demoKey); return s && s.v === 3 ? s : demoFresh(); }
function demoSave() { writeJSON(CONFIG.demoKey, state); reindex(); }

/* =========================================================
   Settings
   ========================================================= */
const LOCAL_SETTINGS_KEY = CONFIG.demoKey + '-settings';
let localSettings = readJSON(LOCAL_SETTINGS_KEY) || {};
function setting(key) { return LIVE ? remote.settings[key] : localSettings[key]; }
// The PIN is optional: it's only asked for when the Sheet's Settings tab has one. The demo never asks.
function pinRequired() { return LIVE && remote.pinRequired; }
function unlocked() { return !pinRequired() || ui.unlocked; }
function idleMs() { return (Number(setting('idle_minutes')) || CONFIG.idleMinutes) * 60000; }
function jukeboxName() { return setting('jukebox_name') || CONFIG.jukeboxName; }
function deviceReducesMotion() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
function motionSetting() { const m = String(setting('idle_motion') || 'auto').toLowerCase(); return m === 'on' || m === 'off' ? m : 'auto'; }
function motionOn() { const m = motionSetting(); return m === 'on' ? true : m === 'off' ? false : !deviceReducesMotion(); }

/* =========================================================
   Reading the catalog
   ========================================================= */
const Store = {
  albums() {
    return LIVE ? ALBUMS.filter(a => !a.removed)
      : ALBUMS.filter(a => !SAMPLE.pending.includes(a.id) || state.arrived.includes(a.id));
  },
  slotsOf(id) { return SLOTS_BY_ID[id] || []; },
  slotFor(id, disc) { const k = id + ':' + disc; return k in LOC ? LOC[k] : null; },   // slot 00 is a real slot, so check for null
  tagsOf(id) { return state.tags[id] || []; },
  filledCount() { return Object.keys(state.slots).length; },
  isNew(id) {
    if (!LIVE) return (state.newIds || []).includes(id);
    const a = BY_ID[id];
    const t = a && a.added ? Date.parse(a.added) : 0;
    return t > 0 && Date.now() - t < (Number(setting('new_days')) || CONFIG.newDays) * 86400000;
  },
  unprintedCount() { return state.reprint.filter(k => !state.printed[k]).length; },
};

/* =========================================================
   Saving changes
   A change shows on screen right away. In live mode it also joins a save list that goes to the Sheet
   in the background, several changes per trip. The list is kept on this device, so a Wi-Fi drop or a
   reload doesn't lose anything: it's sent as soon as the Sheet can be reached again.
   ========================================================= */
const Api = {
  async load() {
    const url = CONFIG.apiUrl + (CONFIG.apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'action=catalog&t=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    const cat = await res.json();
    if (!cat.ok) throw new Error(cat.error || 'The catalog did not load.');
    return cat;
  },
  async post(action, body) {
    // text/plain keeps this a "simple" request, which Apps Script accepts from another site.
    const res = await fetch(CONFIG.apiUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, pin: ui.pinValue }, body || {})),
    });
    return res.json();
  },
};

const PENDING_KEY = 'jukebox-catalog-pending-v1';
const Saver = {
  queue: LIVE ? (readJSON(PENDING_KEY) || []) : [],
  sending: false,
  gen: 0,          // goes up after each save, so a catalog load that started before it is ignored
  retryMs: 0,
  timer: null,
  needPin: false,  // a PIN was set or changed in the Sheet: changes wait until it's entered
  pending() { return this.queue.length; },
  push(op) { this.queue.push(op); this.persist(); renderRail(); this.kick(300); },   // a short wait lets quick taps share a trip
  persist() { writeJSON(PENDING_KEY, this.queue); },
  kick(ms) { this.needPin = false; clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), ms || 0); },
  async flush() {
    if (this.sending || !this.queue.length) return;
    this.sending = true;
    renderRail();
    const batch = this.queue.slice(0, 50);
    let reload = false, waitForPin = false;
    try {
      const r = await Api.post('batch', { ops: batch });
      remote.offline = false;
      if (r.ok) {
        this.queue.splice(0, batch.length);
        this.gen++;
        this.retryMs = 0;
        const bad = (r.results || []).filter(x => !x.ok);
        if (bad.length) { toast(bad[0].message || "Some changes didn't save."); reload = true; }
      } else if (r.error === 'pin' || r.error === 'locked') {
        waitForPin = this.needPin = true;      // the changes wait until the PIN is entered again
        lockManage();
        ui.pinError = r.message || '';
        rerenderAfterChange();
        toast(r.message || 'Enter the PIN to save your changes.');
      } else if (r.error === 'busy') {
        this.retryMs = 30000;                  // the nightly Discogs sync is running
      } else {
        this.queue.splice(0, batch.length);    // refused: drop it and show what the Sheet has
        toast(r.message || "That change didn't save.");
        reload = true;
      }
    } catch (e) {
      remote.offline = true;
      this.retryMs = Math.min(Math.max(this.retryMs * 2, 5000), 60000);   // try again in 5 s, 10 s, … up to a minute
    } finally {
      this.sending = false;
      this.persist();
      renderRail();
    }
    if (this.queue.length) { if (!waitForPin) this.kick(this.retryMs); }
    else scheduleRefresh(reload ? 0 : 15000);    // then check the Sheet once things are quiet
  },
};

let refreshTimer;
// Waits for a quiet moment, so a fresh copy never redraws the screen in the middle of a swap.
function scheduleRefresh(ms) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (quietMoment()) refresh(true); else scheduleRefresh(15000); }, ms);
}
// Safe moments to redraw from the Sheet: nothing waiting to save, and nobody mid-swap or mid-print.
function quietMoment() {
  return !Saver.pending() && !Saver.sending && !ui.sheet && $('#askWrap').hidden &&
    !(ui.view === 'manage' && ui.manage !== 'home' && ui.manage !== 'history');
}

async function refresh(quiet) {
  if (!LIVE) return true;
  const gen = Saver.gen;
  try {
    const cat = await Api.load();
    if (gen !== Saver.gen || Saver.sending) return false;   // a save landed meanwhile; the next load includes it
    applyCatalog(cat);
    Saver.queue.forEach(op => applyLocal(op, true));        // changes still waiting to save stay on screen
    remote.offline = false;
    writeJSON(CONFIG.cacheKey, cat);
    rerenderAfterChange();
    return true;
  } catch (e) {
    remote.offline = true;
    renderRail();
    if (!remote.loaded) renderFind();
    if (!quiet) toast("Couldn't reach the catalog. Check the Wi-Fi.");
    return false;
  }
}

function queueLocal(key) {
  if (!state.reprint.includes(key)) state.reprint.push(key);
  delete state.printed[key];   // changed again since it was printed, so it needs a fresh print
}
// Same clean-up the Sheet's script does: no semicolons (they separate tags), at most 30 characters.
function cleanTag(tag) {
  return String(tag).replace(/[;\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
}
function tagName(t) { return state.vocab.find(v => v.toLowerCase() === t.toLowerCase()) || t; }

// One change, applied to what's on screen. The Sheet's script makes the same change when it gets it.
// replay is true when a change still waiting to save is laid back over a fresh copy of the catalog.
function applyLocal(op, replay) {
  switch (op.action) {
    case 'swap': {
      const out = state.slots[op.slot] || null;
      if (op.incoming) state.slots[op.slot] = { id: op.incoming.id, disc: op.incoming.disc }; else delete state.slots[op.slot];
      if (!replay) state.swapLog.unshift({ at: Date.now(), slot: op.slot, out, in: op.incoming || null });
      queueLocal('index:' + (Math.floor(op.slot / CONFIG.indexPerPage) + 1));
      queueLocal('card:' + Math.floor(op.slot / CONFIG.slotsPerCard));
      if (out && !(op.incoming && out.id === op.incoming.id && out.disc === op.incoming.disc)) queueLocal('album:' + out.id);
      if (op.incoming) queueLocal('album:' + op.incoming.id);
      break;
    }
    case 'tagAdd': {
      const name = tagName(op.tag);
      if (!state.vocab.includes(name)) state.vocab.push(name);
      const list = state.tags[op.id] = state.tags[op.id] || [];
      if (!list.includes(name)) list.push(name);
      break;
    }
    case 'tagRemove': state.tags[op.id] = (state.tags[op.id] || []).filter(x => x !== op.tag); break;
    case 'queue': op.keys.forEach(queueLocal); break;
    case 'printed': { const now = Date.now(); op.keys.forEach(k => { if (state.reprint.includes(k)) state.printed[k] = state.printed[k] || now; }); break; }
    case 'skip': state.reprint = state.reprint.filter(k => k !== op.key); delete state.printed[op.key]; break;
    case 'clearPrinted': state.reprint = state.reprint.filter(k => !state.printed[k]); state.printed = {}; break;
    case 'setting':
      if (LIVE) remote.settings[op.key] = op.value;
      else { localSettings = Object.assign({}, localSettings, { [op.key]: op.value }); writeJSON(LOCAL_SETTINGS_KEY, localSettings); }
      break;
    default: break;
  }
  reindex();
}
// Show the change now; in live mode, also send it to the Sheet.
function change(op, msg) {
  applyLocal(op);
  if (LIVE) Saver.push(op); else demoSave();
  if (msg) toast(msg);
  return { ok: true };
}

const Actions = {
  // Only used when a PIN is set in the Sheet. Returns { ok, message }, or { net: true } when the Sheet can't be reached.
  async verifyPin(pin) {
    try {
      const r = await Api.post('verifyPin', { pin });
      return { ok: !!r.ok, message: r.message };
    } catch (e) {
      return { ok: false, net: true };
    }
  },
  swap(slot, incoming) {
    const out = state.slots[slot] || null;
    change({ action: 'swap', slot, incoming: incoming ? { id: incoming.id, disc: incoming.disc } : null });
    return { ok: true, out };
  },
  addTag(id, tag) {
    const t = cleanTag(tag);
    if (!t) return { ok: false };
    const name = tagName(t);
    if (Store.tagsOf(id).includes(name)) { toast('That tag is already on this album.'); return { ok: true }; }
    return change({ action: 'tagAdd', id, tag: t }, `Added ${name}.`);
  },
  removeTag(id, tag) { return change({ action: 'tagRemove', id, tag }, `Removed ${tag}.`); },
  queue(keys, msg) { return change({ action: 'queue', keys }, msg); },
  printed(keys) { return change({ action: 'printed', keys }); },
  skip(key, msg) { return change({ action: 'skip', key }, msg); },
  clearPrinted() { return change({ action: 'clearPrinted' }, 'Printed items cleared from the list.'); },
  setMotion(on) {
    return change({ action: 'setting', key: 'idle_motion', value: on ? 'on' : 'off' }, on ? 'Moving covers are on.' : 'Moving covers are off.');
  },
  // Checking Discogs is the one change that waits for the Sheet, since the new albums come back with the answer.
  async sync() {
    if (!LIVE) {
      const incoming = SAMPLE.pending.filter(id => !state.arrived.includes(id));
      incoming.forEach(id => { state.arrived.push(id); state.newIds.push(id); queueLocal('album:' + id); });
      demoSave();
      toast(incoming.length ? `${incoming.length} new album from Discogs: ${incoming.map(id => BY_ID[id].title).join(', ')}.` : 'No new albums since the last check.');
      return { ok: true };
    }
    if (ui.busy) return { ok: false };
    ui.busy = true;
    toast('Checking Discogs. This can take up to half a minute…', true);
    try {
      const r = await Api.post('sync', {});
      if (!r.ok) {
        if (r.error === 'pin' || r.error === 'locked') { lockManage(); ui.pinError = r.message || ''; rerenderAfterChange(); }
        toast(r.message || "Discogs didn't answer. Try again in a few minutes.");
        return r;
      }
      const s = r.result || {};
      let m = s.added ? `${s.added} new album${s.added > 1 ? 's' : ''} from Discogs.` : 'No new albums since the last check.';
      if (s.remaining) m += ` Details for ${s.remaining} more are still coming in.`;
      toast(m);
      if (!Saver.pending()) refresh(true);
      return r;
    } catch (e) {
      toast("Couldn't reach the catalog. Check the Wi-Fi and try again.");
      return { ok: false };
    } finally {
      ui.busy = false;
    }
  },
  reset() { state = demoFresh(); demoSave(); },
};

/* =========================================================
   Helpers
   ========================================================= */
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decadeOf = y => Math.floor(y / 10) * 10;
const decadeLabel = d => (d >= 2000 ? d + 's' : String(d).slice(2) + 's');
const fileLetter = a => { const c = String(a.sortName).replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase(); return /[A-Z]/.test(c) ? c : '#'; };
const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const when = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const clock = ts => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const byArtist = (a, b) => String(a.sortName).localeCompare(String(b.sortName)) || String(a.title).localeCompare(String(b.title));
const discLabel = (a, disc) => (a.discs.length > 1 ? ` (disc ${disc} of ${a.discs.length})` : '');
const byCardNo = (x, y) => +x.split(':')[1] - +y.split(':')[1];

function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const SCHEMES = [
  ['#b8432f', '#f2c14e', '#fff7e8'], ['#1f3a5f', '#e98a3c', '#f7efe2'], ['#2f6f64', '#e9d8a6', '#fdf8ec'],
  ['#e3b23c', '#2b2118', '#2b2118'], ['#5b2a4a', '#e7a1b0', '#fbeef2'], ['#24452f', '#b6d369', '#f3f8e6'],
  ['#3c4a57', '#9cc9e3', '#eef6fb'], ['#efe3cf', '#c2412d', '#2a1a12'], ['#7a3b1d', '#f0a35e', '#fff1e2'],
  ['#14213d', '#fca311', '#f5f5f5'], ['#6d597a', '#eaac8b', '#fff4ec'], ['#d9d4c7', '#355070', '#1e2a38'],
];
const PATTERNS = [
  (b, a) => `repeating-radial-gradient(circle at 72% 28%, ${a} 0 5%, ${b} 5% 11%)`,
  (b, a) => `repeating-linear-gradient(180deg, ${b} 0 14%, ${a} 14% 20%)`,
  (b, a) => `linear-gradient(135deg, ${b} 0 52%, ${a} 52% 100%)`,
  (b, a) => `radial-gradient(circle at 50% 108%, ${a} 0 46%, ${b} 46.5% 100%)`,
  (b, a) => `radial-gradient(circle, ${a} 0 22%, transparent 23%) 0 0 / 25% 25%, ${b}`,
  (b, a) => `linear-gradient(90deg, ${b} 0 64%, ${a} 64% 70%, ${b} 70% 78%, ${a} 78% 80%, ${b} 80%)`,
];
// The album's Discogs cover when there is one, over a generated pattern that shows if the image fails.
function coverHTML(a) {
  const h = hash(a.id + a.title);
  const [bg, ac, fg] = SCHEMES[h % SCHEMES.length];
  const pat = PATTERNS[(h >>> 8) % PATTERNS.length](bg, ac);
  const img = a.cover ? `<img src="${esc(a.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<span class="cover" style="background:${pat};--cv-bg:${bg};--cv-fg:${fg}" aria-hidden="true">${img}<span class="cv-text"><span class="cv-artist">${esc(a.artist)}</span><span class="cv-title">${esc(a.title)}</span></span></span>`;
}
function plateHTML(slot, track) {
  const c = selectionCode(slot, track);
  return `<span class="plate" title="Selection ${c.join('')}"><span class="sr-only">Selection </span><b>${c[0]}</b><b>${c[1]}</b></span>`;
}
function badgesHTML(a) {
  const slots = Store.slotsOf(a.id);
  let h = Store.isNew(a.id) ? '<span class="badge badge-new">New</span>' : '';
  if (a.format !== 'CD') h += `<span class="badge badge-shelf">${esc(a.format)}</span>`;
  else h += slots.length
    ? `<span class="badge badge-juke">Jukebox ${slots.map(s => pad2(s.slot)).join(' + ')}</span>`
    : '<span class="badge badge-shelf">Shelf</span>';
  return h;
}
let toastTimer;
function toast(msg, sticky) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => t.classList.remove('show'), 3400);
}
// An in-page yes/no question (browser pop-ups don't suit a kiosk).
function ask(message, yesLabel, noLabel) {
  return new Promise(resolve => {
    $('#askText').textContent = message;
    $('#askYes').textContent = yesLabel;
    $('#askNo').textContent = noLabel;
    $('#askWrap').hidden = false;
    const done = v => { $('#askWrap').hidden = true; $('#askYes').onclick = $('#askNo').onclick = null; resolve(v); };
    $('#askYes').onclick = () => done(true);
    $('#askNo').onclick = () => done(false);
    $('#askYes').focus();
  });
}
const ICON = {
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.8"/></svg>',
  disc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
};

/* =========================================================
   UI state
   ========================================================= */
const ui = {
  view: 'find',
  q: '',
  decades: new Set(), genres: new Set(), tags: new Set(), formats: new Set(), onlyJuke: false,
  sort: 'artist',
  allSongs: false,
  unlocked: false, pin: '', pinError: '', pinValue: '', checkingPin: false,
  manage: 'home',            // home | swap-slot | swap-pick | swap-confirm | swap-done | print | history
  swap: { slot: null, incoming: null, fromAlbum: false, q: '' },
  sheet: null,               // { id, disc, track }
  resetArmed: false,
  lastSwap: null,            // { text, added } for the "Swap saved" screen
  busy: false,
};

/* =========================================================
   Rail
   ========================================================= */
function renderRail() {
  $('#navManage').innerHTML = `${pinRequired() ? (ui.unlocked ? ICON.unlock : ICON.lock) : ICON.sliders}<span>Manage</span>`;
  let sync = '';
  const waiting = Saver.pending();
  if (LIVE && waiting) {
    const what = `${waiting} change${waiting > 1 ? 's' : ''}`;
    sync = remote.offline ? `<span class="rail-sync offline">Offline · ${what} waiting to save</span>`
      : Saver.needPin ? `<span class="rail-sync offline">${what} waiting for the PIN</span>`
      : `<span class="rail-sync">Saving ${what}…</span>`;
  } else if (LIVE) {
    sync = remote.offline
      ? `<span class="rail-sync offline">Offline${remote.loadedAt ? ` · saved copy from ${clock(remote.loadedAt)}` : ''}</span>`
      : remote.loadedAt ? `<span class="rail-sync">Updated ${clock(remote.loadedAt)}</span>` : '';
  }
  $('#railStats').innerHTML = `<span>${Store.albums().length} albums</span><span>${Store.filledCount()} of ${CONFIG.slotCount} slots filled</span>${sync}`;
  document.querySelectorAll('.nav-btn').forEach(b => {
    if (b.dataset.view === ui.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

function setView(v) {
  ui.view = v;
  ['find', 'jukebox', 'manage'].forEach(name => { $('#view-' + name).hidden = name !== v; });
  if (v === 'manage') { ui.manage = 'home'; ui.resetArmed = false; }
  renderRail();
  if (v === 'find') renderFind();
  if (v === 'jukebox') renderJukebox();
  if (v === 'manage') renderManage();
  $('#main').scrollTop = 0;
}

/* =========================================================
   Find music
   ========================================================= */
function anyFilter() { return ui.decades.size || ui.genres.size || ui.tags.size || ui.formats.size || ui.onlyJuke; }
function clearFilters() { ui.decades.clear(); ui.genres.clear(); ui.tags.clear(); ui.formats.clear(); ui.onlyJuke = false; ui.allSongs = false; }
function matchesFilters(a) {
  if (ui.decades.size && !(a.origYear && ui.decades.has(decadeOf(a.origYear)))) return false;
  if (ui.genres.size && !a.genres.some(g => ui.genres.has(g))) return false;
  if (ui.tags.size && !Store.tagsOf(a.id).some(t => ui.tags.has(t))) return false;
  if (ui.formats.size && !ui.formats.has(a.format)) return false;
  if (ui.onlyJuke && !Store.slotsOf(a.id).length) return false;
  return true;
}
function chipHTML(group, value, label, on) {
  return `<button class="chip" data-chip="${group}" data-value="${esc(value)}" aria-pressed="${on}">${esc(label)}</button>`;
}
function renderFilters() {
  const albums = Store.albums();
  const decades = [...new Set(albums.filter(a => a.origYear).map(a => decadeOf(a.origYear)))].sort((x, y) => x - y);
  const present = new Set(albums.flatMap(a => a.genres));
  const genres = GENRE_ORDER.filter(g => present.has(g)).concat([...present].filter(g => !GENRE_ORDER.includes(g)).sort());
  const formats = [...new Set(albums.map(a => a.format))].sort();
  const n = ui.decades.size + ui.genres.size + ui.tags.size + ui.formats.size + (ui.onlyJuke ? 1 : 0);
  $('#filters').innerHTML = `
    <div class="fgroup"><span class="flabel">Decade</span><div class="chips">${decades.map(d => chipHTML('decade', d, decadeLabel(d), ui.decades.has(d))).join('')}</div></div>
    <div class="fgroup"><span class="flabel">Genre</span><div class="chips">${genres.map(g => chipHTML('genre', g, g, ui.genres.has(g))).join('')}</div></div>
    <div class="fgroup"><span class="flabel">Your tags</span><div class="chips">${state.vocab.map(t => chipHTML('tag', t, t, ui.tags.has(t))).join('')}</div></div>
    ${formats.length > 1 ? `<div class="fgroup"><span class="flabel">Format</span><div class="chips">${formats.map(f => chipHTML('format', f, f, ui.formats.has(f))).join('')}</div></div>` : ''}
    <div class="frow">
      <button class="toggle" id="onlyJuke" aria-pressed="${ui.onlyJuke}">${ICON.disc}Only what's in the jukebox</button>
      ${n ? `<button class="btn-quiet" id="clearAll">Clear ${n} filter${n > 1 ? 's' : ''}</button>` : ''}
    </div>`;
}
function songRowHTML(s) {
  const slot = Store.slotFor(s.a.id, s.disc);
  const where = slot !== null
    ? `${plateHTML(slot, s.track)}<span>Slot ${pad2(slot)}, track ${pad2(s.track)}</span>`
    : `<span class="badge badge-shelf">${s.a.format === 'CD' ? 'Shelf' : esc(s.a.format)}</span>`;
  return `<button class="song" data-open="${esc(s.a.id)}" data-disc="${s.disc}" data-track="${s.track}">
    ${coverHTML(s.a)}
    <span class="song-text"><span class="song-title">${esc(s.title)}</span><span class="song-sub">${esc(s.a.artist)} · ${esc(s.a.title)}</span></span>
    <span class="song-where">${where}</span></button>`;
}
function cardHTML(a) {
  return `<button class="card" data-open="${esc(a.id)}">
    ${coverHTML(a)}
    <span class="card-text"><span class="card-title">${esc(a.title)}</span><span class="card-artist">${esc(a.artist)}</span></span>
    <span class="card-foot"><span class="year">${a.origYear || ''}</span>${badgesHTML(a)}</span></button>`;
}
function renderResults() {
  const all = Store.albums();
  if (!all.length) {
    $('#results').innerHTML = LIVE
      ? `<div class="empty-state"><h2>${remote.loaded ? 'The catalog is empty.' : 'The catalog hasn\'t loaded yet.'}</h2>
         <p class="muted">${remote.loaded ? 'Run a Discogs sync from the Sheet (Jukebox → Sync with Discogs now).' : 'Check the Wi-Fi. The tablet tries again every few minutes.'}</p></div>`
      : '<div class="empty-state"><h2>No sample albums.</h2></div>';
    $('#qClear').hidden = !ui.q;
    return;
  }
  const q = norm(ui.q);
  const words = q ? q.split(' ') : [];
  const pool = all.filter(matchesFilters);
  const albums = words.length ? pool.filter(a => words.every(w => a._hay.includes(w))) : pool.slice();
  albums.sort(ui.sort === 'year' ? (a, b) => (a.origYear || 9999) - (b.origYear || 9999) || byArtist(a, b) : byArtist);

  const songs = [];
  if (q.length >= 2) {
    pool.slice().sort(byArtist).forEach(a => a._tracks.forEach((disc, di) => disc.forEach((t, ti) => {
      if (t.includes(q)) songs.push({ a, disc: di + 1, track: ti + 1, title: a.discs[di][ti] });
    })));
  }

  let h = '';
  if (!albums.length && !songs.length) {
    const what = ui.q ? `Nothing matches “${esc(ui.q)}”` : 'No albums match these filters';
    h = `<div class="empty-state"><h2>${what}.</h2><p class="muted">Check the spelling, or take off a filter.</p>
      <button class="btn btn-secondary" id="clearEverything">Start over</button></div>`;
  } else {
    if (albums.length) {
      const label = (ui.q || anyFilter()) ? `${albums.length} album${albums.length > 1 ? 's' : ''} match` : `All ${albums.length} albums`;
      h += `<div class="results-head"><h2 class="results-count">${label}</h2>
        <div class="seg" role="group" aria-label="Sort albums">
          <button data-sort="artist" aria-pressed="${ui.sort === 'artist'}">Artist A–Z</button>
          <button data-sort="year" aria-pressed="${ui.sort === 'year'}">Year</button>
        </div></div>
        <div class="grid">${albums.map(cardHTML).join('')}</div>`;
    }
    if (songs.length) {
      const shown = ui.allSongs ? songs : songs.slice(0, 10);
      h += `<section class="songs" aria-label="Songs"><h2 class="section-title">${songs.length} song${songs.length > 1 ? 's' : ''} match “${esc(ui.q)}”</h2>
        ${shown.map(songRowHTML).join('')}
        ${songs.length > shown.length ? `<button class="btn btn-secondary" id="allSongs">Show all ${songs.length} songs</button>` : ''}</section>`;
    }
  }
  $('#results').innerHTML = h;
  $('#qClear').hidden = !ui.q;
}
function renderFind() { renderFilters(); renderResults(); }

/* =========================================================
   In the jukebox
   ========================================================= */
function slotsGridHTML(mode) {
  let h = '';
  for (let s = 0; s < CONFIG.slotCount; s++) {
    const v = state.slots[s];
    const a = v && BY_ID[v.id];
    const sel = mode === 'pick' && ui.swap.slot === s ? ' is-selected' : '';
    if (a) {
      const extra = a.discs.length > 1 ? ` · disc ${v.disc}` : '';
      h += `<button class="slot${sel}" data-slot="${s}" data-mode="${mode}"><span class="slot-no">${pad2(s)}</span>${coverHTML(a)}
        <span class="slot-title">${esc(a.title)}</span><span class="slot-artist">${esc(a.artist)}${extra}</span></button>`;
    } else if (mode === 'pick') {
      h += `<button class="slot empty${sel}" data-slot="${s}" data-mode="pick"><span class="slot-no">${pad2(s)}</span><span class="slot-hole">Empty</span></button>`;
    } else {
      h += `<div class="slot empty"><span class="slot-no">${pad2(s)}</span><span class="slot-hole">Empty</span></div>`;
    }
  }
  return h;
}
function renderJukebox() {
  const filled = Store.filledCount();
  $('#view-jukebox').innerHTML = `
    <header class="view-head"><h1>Now in the Jukebox</h1>
      <p>${filled} of ${CONFIG.slotCount} slots are filled${LIVE ? '' : ' in this sample'}. Tap a slot to see its songs and selection numbers.</p></header>
    <div class="slots">${slotsGridHTML('open')}</div>`;
}

/* =========================================================
   Album detail
   ========================================================= */
function openAlbum(id, disc, track) {
  if (!BY_ID[id]) return;
  ui.sheet = { id, disc: disc || null, track: track || null };
  $('#sheetWrap').hidden = false;
  renderSheet();
  $('#sheetClose').focus();
  const hit = document.getElementById('hit');
  if (hit) hit.scrollIntoView({ block: 'center' });
  else $('.sheet').scrollTop = 0;
}
function closeSheet() { ui.sheet = null; $('#sheetWrap').hidden = true; }
function renderSheet() {
  if (!ui.sheet) return;
  const a = BY_ID[ui.sheet.id];
  if (!a) { closeSheet(); return; }
  const slots = Store.slotsOf(a.id);
  const multi = a.discs.length > 1;
  const isCD = a.format === 'CD';
  const unloaded = a.discs.map((_, i) => i + 1).filter(d => Store.slotFor(a.id, d) === null);

  let where;
  if (slots.length) {
    const label = slots.map(s => (multi ? `Disc ${s.disc} in slot ${pad2(s.slot)}` : `Slot ${pad2(s.slot)}`)).join(' · ');
    where = `<div class="where where-juke"><span class="where-label"><span>In the jukebox</span><strong>${label}</strong></span>
      <span>Punch in the number next to a song to play it.</span></div>`;
  } else {
    where = `<div class="where where-shelf"><span class="where-label"><span class="muted">${isCD ? 'Not in the jukebox' : esc(a.format)}</span><strong>On the shelf</strong></span>
      ${unlocked() && isCD ? `<button class="btn btn-primary" data-load-album="${esc(a.id)}">Put it in the jukebox</button>` : ''}</div>`;
  }
  if (slots.length && unloaded.length && unlocked()) {
    where += `<div class="where where-shelf"><span class="where-label"><span class="muted">Still on the shelf</span><strong>Disc ${unloaded.join(', ')}</strong></span>
      <button class="btn btn-primary" data-load-album="${esc(a.id)}">Put it in the jukebox</button></div>`;
  }

  const tags = Store.tagsOf(a.id);
  const tagChips = tags.length
    ? tags.map(t => unlocked()
      ? `<span class="tag">${esc(t)}<button class="tag-x" data-tag-remove="${esc(t)}" aria-label="Remove ${esc(t)}">×</button></span>`
      : `<span class="tag">${esc(t)}</span>`).join('')
    : '<span class="muted">No tags yet.</span>';
  const suggestions = state.vocab.filter(t => !tags.includes(t));
  const tagTools = unlocked()
    ? `${suggestions.length ? `<div class="tagrow">${suggestions.map(t => `<button class="tag tag-add" data-tag-add="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}
       <form class="tag-new" id="tagForm"><label for="tagNew" class="sr-only">New tag name</label>
         <input id="tagNew" placeholder="Make a new tag" maxlength="24" autocomplete="off"><button class="btn btn-secondary" type="submit">Add tag</button></form>`
    : '<p class="muted small">Unlock Manage to add or change tags.</p>';

  const trackHTML = a.discs.map((tracks, di) => {
    const d = di + 1;
    const slot = Store.slotFor(a.id, d);
    const head = multi ? `<div class="disc-head"><span>Disc ${d}</span><span>${slot !== null ? `Slot ${pad2(slot)}` : 'On the shelf'}</span></div>` : '';
    const rows = tracks.map((t, ti) => {
      const hit = ui.sheet.disc === d && ui.sheet.track === ti + 1;
      return `<div class="track${hit ? ' is-hit' : ''}"${hit ? ' id="hit"' : ''}><span class="track-no">${ti + 1}</span>
        <span class="track-title">${esc(t)}</span>${slot !== null ? plateHTML(slot, ti + 1) : '<span></span>'}</div>`;
    }).join('');
    return head + (rows || '<p class="muted small">No track list on Discogs.</p>');
  }).join('');

  const meta = [a.origYear ? `First released ${a.origYear}` : '', a.pressYear ? `This ${isCD ? 'CD' : esc(a.format)} pressed ${a.pressYear}` : '', esc(a.label)].filter(Boolean).join(' · ');
  $('#sheetBody').innerHTML = `
    <div class="detail-top">${coverHTML(a)}
      <div class="detail-info">
        ${Store.isNew(a.id) ? '<span><span class="badge badge-new">New from Discogs</span></span>' : ''}
        <h2 class="detail-title" id="sheetTitle">${esc(a.title)}</h2>
        <p class="detail-artist">${esc(a.artist)}</p>
        <p class="detail-meta">${meta}</p>
        <p class="detail-meta">${esc(a.genres.concat(a.styles).join(', '))}</p>
      </div>
    </div>
    ${where}
    ${unlocked() ? `<div class="frow"><button class="btn btn-secondary" data-queue-album="${esc(a.id)}">Reprint this album's page</button></div>` : ''}
    <section class="detail-sec"><h3 class="section-title">Your tags</h3><div class="tagrow">${tagChips}</div>${tagTools}</section>
    <section class="detail-sec"><h3 class="section-title">Songs${multi ? ` · ${a.discs.length} discs` : ''}</h3><div class="tracks">${trackHTML}</div></section>`;
}

/* =========================================================
   Binder pages and title cards
   ========================================================= */
// Title card for the jukebox's flip display, printed front only.
// Card k holds slot 2k on the top half and slot 2k+1 on the bottom half.
const ARROW_DOWN = '<svg class="tc-arrow" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 1h10L5 9z"/></svg>';
const ARROW_LEFT = '<svg class="tc-arrow" viewBox="0 0 10 10" aria-hidden="true"><path d="M9 0v10L1 5z"/></svg>';
function cardHalfHTML(slot, withHints) {
  const v = state.slots[slot];
  const a = v && BY_ID[v.id];
  const labels = `<div class="tc-labels">
      <span class="tc-hint">${withHints ? `Track no.<br>next 2 digits ${ARROW_DOWN}` : ''}</span>
      <span class="tc-box">${pad2(slot)}</span>
      <span class="tc-hint right">${withHints ? `${ARROW_LEFT} Disc no.<br>first 2 digits` : ''}</span></div>`;
  if (!a) return `<div class="tc-half">${labels}<div class="tc-empty">Empty</div></div>`;
  const list = a.discs[v.disc - 1] || [];
  const MAX = 34;                                 // longer discs list the first 33 songs
  const tooMany = list.length > MAX;
  const shown = tooMany ? list.slice(0, MAX - 1) : list;
  const rows = shown.map((t, i) => `<div class="tc-track"><span>${pad2(i + 1)}</span><span>${esc(t)}</span></div>`).join('')
    + (tooMany ? `<div class="tc-track"><span></span><span>+ ${list.length - (MAX - 1)} more songs</span></div>` : '');
  return `<div class="tc-half">${labels}
      <div class="tc-artist">${esc(a.artist)}</div>
      <div class="tc-title">${esc(a.title)}${a.discs.length > 1 ? ` (disc ${v.disc})` : ''}</div>
      <div class="tc-tracks">${rows}</div></div>`;
}
function titleCardBodyHTML(k) {
  const first = k * CONFIG.slotsPerCard;
  return `<div class="tcard"><div class="tc-in">${cardHalfHTML(first, true)}${cardHalfHTML(first + 1, false)}</div></div>`;
}
function titleCardHTML(k, actions = '') {
  const first = k * CONFIG.slotsPerCard;
  const cards = Math.ceil(CONFIG.slotCount / CONFIG.slotsPerCard);
  return `<div class="card-item">${titleCardBodyHTML(k)}
    <span class="page-cap">Discs ${pad2(first)} and ${pad2(first + 1)} (card ${k + 1} of ${cards}). It replaces that card in the jukebox's display.</span>${actions}</div>`;
}
// How up to 3 cards sit on one letter sheet in landscape: upright, side by side, centered,
// with a gap between them to trim.
function sheetPreviewHTML(keys) {
  const c = CONFIG.card;
  const left0 = (c.sheetW - (c.perSheet * c.w + (c.perSheet - 1) * c.gap)) / 2;
  const top0 = (c.sheetH - c.h) / 2;
  const pct = (v, of) => (v / of * 100).toFixed(3) + '%';
  let h = '';
  for (let i = 0; i < c.perSheet; i++) {
    const pos = `left:${pct(left0 + i * (c.w + c.gap), c.sheetW)};top:${pct(top0, c.sheetH)};width:${pct(c.w, c.sheetW)};height:${pct(c.h, c.sheetH)}`;
    h += keys[i]
      ? `<div class="sheet-slot" style="${pos}">${titleCardBodyHTML(+keys[i].split(':')[1])}</div>`
      : `<div class="sheet-slot unused" style="${pos}"></div>`;
  }
  return `<div class="sheet-page">${h}</div>`;
}
// Fits each card's song list: 9 pt in one column if it fits, then 8.5 and 8 pt, then two columns
// from 9 pt down to 6 pt. The cards must be laid out (on screen, or in the print area while it's
// being measured) for this to work.
const FIT_STEPS = [[9, 1], [8.5, 1], [8, 1], [9, 2], [8.5, 2], [8, 2], [7.5, 2], [7, 2], [6.5, 2], [6, 2]];
function fitCards(root) {
  root.querySelectorAll('.tc-half').forEach(half => {
    const box = half.querySelector('.tc-tracks');
    if (!box) return;
    const n = box.children.length;
    let i = n > 15 ? FIT_STEPS.findIndex(s => s[1] === 2) : 0;   // long discs skip straight to two columns
    for (; i < FIT_STEPS.length; i++) {
      const [size, cols] = FIT_STEPS[i];
      half.style.setProperty('--tk', size);
      box.classList.toggle('two-col', cols === 2);
      if (box.scrollHeight <= box.clientHeight + 1 && box.scrollWidth <= box.clientWidth + 1) return;
    }
  });
}
function fitCardsSoon(root) {
  fitCards(root);
  // Fonts can arrive a moment later and change the measurements, so fit once more when they're in.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitCards(root));
}

// One binder page (index or album), without the caption around it.
function pageBodyHTML(key) {
  const [kind, ref] = key.split(':');
  const pageOpen = `<div class="page page-${CONFIG.paper}" style="aspect-ratio:${PAPER[CONFIG.paper].ratio}"><div class="pg-in">`;
  if (kind === 'index') {
    const n = +ref;
    const start = (n - 1) * CONFIG.indexPerPage;
    const end = Math.min(n * CONFIG.indexPerPage, CONFIG.slotCount) - 1;
    const pages = Math.ceil(CONFIG.slotCount / CONFIG.indexPerPage);
    let rows = '';
    for (let s = start; s <= end; s++) {
      const v = state.slots[s];
      const a = v && BY_ID[v.id];
      rows += `<div class="pg-irow"><span>${pad2(s)}</span><span>${a ? esc(a.artist) : '—'}</span><span>${a ? esc(a.title) + (a.discs.length > 1 ? ` (disc ${v.disc})` : '') : ''}</span></div>`;
    }
    return `${pageOpen}
        <div class="pg-top"><span>Jukebox index · p. ${n}</span><span>Slots ${pad2(start)}–${pad2(end)}</span></div>
        <div class="pg-title">Now in the Jukebox</div>
        <div class="pg-index">${rows}</div>
        <div class="pg-foot"><span>Page ${n} of ${pages}</span><span>Printed ${today()}</span></div></div></div>`;
  }
  const a = BY_ID[ref];
  const slots = Store.slotsOf(a.id);
  const multi = a.discs.length > 1;
  const right = slots.length ? `${esc(jukeboxName())} ${slots.map(s => pad2(s.slot)).join(' + ')}` : 'On the shelf';
  const tracks = a.discs.map((list, di) => {
    const d = di + 1;
    const slot = Store.slotFor(a.id, d);
    const head = multi ? `<div class="pg-disc">Disc ${d}${slot !== null ? ` · slot ${pad2(slot)}` : ''}</div>` : '';
    return head + list.map((t, ti) => `<div class="pg-track"><span>${ti + 1}</span><span>${esc(t)}</span>${slot !== null ? `<span class="pg-code">${selectionCode(slot, ti + 1).join('')}</span>` : '<span></span>'}</div>`).join('');
  }).join('');
  const whereTxt = slots.length
    ? 'In the jukebox: ' + slots.map(s => (multi ? `disc ${s.disc} in slot ${pad2(s.slot)}` : `slot ${pad2(s.slot)}`)).join(', ')
    : 'On the shelf';
  // Long albums switch to two columns so every song fits on one page.
  const rows = a.discs.reduce((n, d) => n + d.length, 0) + (multi ? a.discs.length : 0);
  const meta = [a.origYear || '', esc(a.genres.join(', ')), a.pressYear ? `${esc(a.format)} ${a.pressYear}` : esc(a.format), esc(a.label)].filter(Boolean).join(' · ');
  return `${pageOpen}
      <div class="pg-top"><span>Collection · ${fileLetter(a)}</span><span>${right}</span></div>
      <div class="pg-head">${coverHTML(a)}
        <div class="pg-headtext">
          <div class="pg-artist">${esc(a.artist)}</div>
          <div class="pg-title">${esc(a.title)}</div>
          <div class="pg-meta">${meta}</div>
          <div class="pg-where${slots.length ? '' : ' shelf'}">${whereTxt}</div>
        </div></div>
      <div class="pg-colhead"><span>Songs</span><span>${slots.length ? 'Selection' : ''}</span></div>
      <div class="pg-tracks${rows > PAPER[CONFIG.paper].twoColAfter ? ' two-col' : ''}">${tracks}</div>
      <div class="pg-foot"><span>Jukebox Catalog</span><span>Printed ${today()}</span></div></div></div>`;
}
function pageHTML(key, actions = '') {
  const [kind, ref] = key.split(':');
  if (kind === 'card') return titleCardHTML(+ref, actions);
  const cap = kind === 'index'
    ? `Replaces: Jukebox index, page ${ref}`
    : `Goes in: Collection, letter ${fileLetter(BY_ID[ref])} (replaces the old page)`;
  return `<div class="page-wrap">${pageBodyHTML(key)}<span class="page-cap">${cap}</span>${actions}</div>`;
}

/* =========================================================
   Printing
   ========================================================= */
// Binder pages print in filing order: index pages first, then albums in shelf order.
function pageOrder(x, y) {
  const [kx, rx] = x.split(':'), [ky, ry] = y.split(':');
  if (kx !== ky) return kx === 'index' ? -1 : 1;
  return kx === 'index' ? +rx - +ry : byArtist(BY_ID[rx], BY_ID[ry]);
}
// Binder pages (portrait) and title card sheets (landscape) print as separate jobs, so each job has
// one page shape, and there's a pause to load the card stock between them.
function pagesHTML(keys) { return keys.slice().sort(pageOrder).map(k => `<div class="print-page">${pageBodyHTML(k)}</div>`).join(''); }
function cardSheetsHTML(keys) {
  const cards = keys.slice().sort(byCardNo);
  let h = '';
  for (let i = 0; i < cards.length; i += CONFIG.card.perSheet) {
    h += `<div class="print-sheet">${sheetPreviewHTML(cards.slice(i, i + CONFIG.card.perSheet))}</div>`;
  }
  return h;
}
function guidePrintHTML(list) {
  return list.map(g => `<div class="print-page"><div class="guide-page">
      <div class="gp-top">Jukebox Catalog · How to</div>
      <h1>${esc(g.title)}</h1>
      <ol class="gp-steps">${g.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      ${g.note ? `<p class="gp-note">${esc(g.note)}</p>` : ''}</div></div>`).join('');
}
// Put the pages in the print area, wait for cover images, then open the print screen.
// On the kiosk, Fully Kiosk's own print call is used when it's there.
// Card sheets are landscape. A computer's browser takes that from the page itself. The kiosk
// (Fully Kiosk on Android) prints portrait unless someone changes it, so there the landscape sheet is
// turned a quarter turn onto a portrait page instead: the cards come out exactly the same size.
function setPageShape(landscape) {
  let tag = document.getElementById('pageShape');
  if (!tag) { tag = document.createElement('style'); tag.id = 'pageShape'; document.head.appendChild(tag); }
  const turn = landscape && !!(window.fully && typeof window.fully.print === 'function');
  $('#printArea').classList.toggle('turned', turn);
  tag.textContent = `@page { size: letter ${landscape && !turn ? 'landscape' : 'portrait'}; margin: 0; }`;
}
function runPrint(html, landscape) {
  return new Promise(resolve => {
    const area = $('#printArea');
    setPageShape(!!landscape);
    area.innerHTML = html;
    // Lay the pages out off screen at full size: covers start loading, and the song lists are fitted.
    area.classList.add('measuring');
    const imgs = Array.from(area.querySelectorAll('img'));
    imgs.forEach(i => { i.loading = 'eager'; });
    const loaded = Promise.all(imgs.map(i => (i.complete ? null : new Promise(r => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))));
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([Promise.all([loaded, fonts]), new Promise(r => setTimeout(r, 4000))]).then(() => {
      fitCards(area);
      area.classList.remove('measuring');
      if (window.fully && typeof window.fully.print === 'function') {
        window.fully.print();
        setTimeout(resolve, 1500);
      } else {
        let done = false;
        const end = () => { if (!done) { done = true; resolve(); } };
        window.addEventListener('afterprint', end, { once: true });
        window.print();
        setTimeout(end, 600);
      }
    });
  });
}
async function printKeys(keys) {
  if (!keys.length) return;
  const n = keys.length;
  if (!CONFIG.printing) {
    await Actions.printed(keys);
    toast(`Preview only. On the kiosk, this opens the print screen for ${n === 1 ? 'this item' : `all ${n} items`}.`);
    renderManage();
    return;
  }
  const pages = keys.filter(k => !k.startsWith('card:'));
  const cards = keys.filter(k => k.startsWith('card:'));
  let done = 0;
  if (pages.length) {
    await runPrint(pagesHTML(pages), false);
    const ok = await ask(`Did the binder page${pages.length > 1 ? 's' : ''} come out of the printer?`, 'Yes, mark printed', 'No, keep on the list');
    if (ok) { Actions.printed(pages); done += pages.length; }
  }
  if (cards.length) {
    const sheets = Math.ceil(cards.length / CONFIG.card.perSheet);
    const go = !pages.length || await ask(`Next, the title cards (${sheets} sheet${sheets > 1 ? 's' : ''}). Put card stock in the manual feed slot, then tap Print the cards.`, 'Print the cards', 'Not now');
    if (go) {
      await runPrint(cardSheetsHTML(cards), true);
      const ok = await ask(`Did the title card sheet${sheets > 1 ? 's' : ''} come out of the printer?`, 'Yes, mark printed', 'No, keep on the list');
      if (ok) { Actions.printed(cards); done += cards.length; }
    }
  }
  if (done) toast('Marked as printed.');
  renderManage();
}
async function printGuides(ids) {
  const list = ids === 'all' ? GUIDES : GUIDES.filter(g => g.id === ids);
  if (!CONFIG.printing) {
    toast(list.length > 1 ? `Preview only. On the kiosk, this prints all ${list.length} guides, one page each.` : 'Preview only. On the kiosk, this prints these steps on one page.');
    return;
  }
  await runPrint(guidePrintHTML(list), false);
}

/* =========================================================
   Manage
   ========================================================= */
function shelfDiscs() {
  const list = [];
  Store.albums().filter(a => a.format === 'CD').sort(byArtist).forEach(a => a.discs.forEach((_, i) => {
    if (Store.slotFor(a.id, i + 1) === null) list.push({ a, disc: i + 1 });
  }));
  return list;
}
function backbar(target, step, title) {
  return `<div class="backbar"><button class="btn btn-secondary" data-manage="${target}">${ICON.back}Back</button>
    <div class="view-head">${step ? `<span class="step">${step}</span>` : ''}<h2>${title}</h2></div></div>`;
}
function renderPickList() {
  const box = document.getElementById('pickList');
  if (!box) return;
  const q = norm(ui.swap.q);
  const items = shelfDiscs().filter(x => !q || x.a._hay.includes(q));
  box.innerHTML = items.length
    ? items.slice(0, 60).map(x => `<button class="pick" data-incoming="${esc(x.a.id)}:${x.disc}">${coverHTML(x.a)}
        <span class="song-text"><span class="song-title">${esc(x.a.title)}${discLabel(x.a, x.disc)}</span><span class="song-sub">${esc(x.a.artist)}${x.a.origYear ? ' · ' + x.a.origYear : ''}</span></span>
        <span class="badge badge-shelf">Shelf</span></button>`).join('')
      + (items.length > 60 ? `<p class="muted">Showing 60 of ${items.length}. Type part of a name to narrow the list.</p>` : '')
    : '<p class="muted">Nothing on the shelf matches. Try another name.</p>';
}
function renderManage() {
  const el = $('#view-manage');
  if (!unlocked()) {
    const msg = ui.checkingPin ? 'Checking…' : ui.pinError || '';
    el.innerHTML = `<div class="lock">
      <header class="view-head"><h1>Manage</h1><p>Enter the PIN to swap discs, change tags, and print.</p></header>
      <div class="pin-dots" aria-label="${ui.pin.length} of 4 digits entered">${[0, 1, 2, 3].map(i => `<span class="${i < ui.pin.length ? 'on' : ''}"></span>`).join('')}</div>
      <p class="pin-msg${ui.pinError ? ' err' : ''}" role="status">${esc(msg)}</p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="key" data-key="${n}">${n}</button>`).join('')}
        <button class="key key-sm" data-key="clear">Clear</button><button class="key" data-key="0">0</button><button class="key key-sm" data-key="del">Delete</button></div>
    </div>`;
    return;
  }
  const n = Store.unprintedCount();
  const sw = ui.swap;
  switch (ui.manage) {
    case 'swap-slot': {
      const inc = sw.incoming && BY_ID[sw.incoming.id];
      el.innerHTML = `${backbar('home', 'Step 1 of 3', 'Pick the slot to change')}
        <div class="do-now"><span class="section-title">What to do</span>
          <p>${inc ? `You're putting in <strong>${esc(inc.title)}${discLabel(inc, sw.incoming.disc)}</strong>. Tap an empty slot, or the slot of the disc that's coming out.` : 'Tap the slot you want to change. Dashed slots are empty.'}</p></div>
        <div class="slots">${slotsGridHTML('pick')}</div>`;
      break;
    }
    case 'swap-pick': {
      const cur = state.slots[sw.slot];
      const curA = cur && BY_ID[cur.id];
      el.innerHTML = `${backbar('swap-slot', 'Step 2 of 3', `Pick what goes into slot ${pad2(sw.slot)}`)}
        <div class="do-now"><span class="section-title">What to do</span><p>Tap the album that's going into slot ${pad2(sw.slot)}. Type part of its name in the search box to find it faster.</p></div>
        ${curA
          ? `<div class="current">${coverHTML(curA)}<span class="song-text"><span class="song-sub">Now in slot ${pad2(sw.slot)}</span><span class="song-title">${esc(curA.title)}${discLabel(curA, cur.disc)}</span><span class="song-sub">${esc(curA.artist)}</span></span></div>`
          : `<p class="detail-meta">Slot ${pad2(sw.slot)} is empty right now.</p>`}
        <div class="search search-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>
          <label for="pickQ" class="sr-only">Search the shelf</label>
          <input id="pickQ" type="search" placeholder="Search the shelf by artist or album" autocomplete="off" value="${esc(sw.q)}">
        </div>
        <div class="pick-list" id="pickList"></div>
        ${curA ? `<div><button class="btn btn-secondary" data-incoming="">Leave slot ${pad2(sw.slot)} empty</button></div>` : ''}`;
      renderPickList();
      break;
    }
    case 'swap-confirm': {
      const cur = state.slots[sw.slot];
      const outA = cur && BY_ID[cur.id];
      const inA = sw.incoming && BY_ID[sw.incoming.id];
      const pages = 1 + (outA ? 1 : 0) + (inA ? 1 : 0);
      const side = (label, a, disc, cls, none) => `<div class="swap-side ${cls}"><span class="section-title">${label}</span>
        ${a ? `${coverHTML(a)}<span class="song-title">${esc(a.title)}${discLabel(a, disc)}</span><span class="song-sub">${esc(a.artist)}</span>` : `<span class="muted">${none}</span>`}</div>`;
      el.innerHTML = `${backbar(sw.fromAlbum ? 'swap-slot' : 'swap-pick', 'Step 3 of 3', `Check the swap for slot ${pad2(sw.slot)}`)}
        <div class="swap-confirm">
          ${side(`Take out of slot ${pad2(sw.slot)}`, outA, cur && cur.disc, 'out', 'Nothing. The slot is empty.')}
          ${side(`Put into slot ${pad2(sw.slot)}`, inA, sw.incoming && sw.incoming.disc, 'in', 'Nothing. Leave the slot empty.')}
        </div>
        <div class="do-now"><span class="section-title">Now, at the jukebox</span>
          <ol class="steps">
            <li><span>Unlock and open the top door. Move the SERVICE switch to SERVICE.</span></li>
            <li><span>Press the SCAN button (it may be labeled CANCEL/SCAN) to move the disc space to the left or right of the transfer arm.</span></li>
            ${outA ? `<li><span>Slide ${esc(outA.title)}${discLabel(outA, cur.disc)} out of slot ${pad2(sw.slot)}.</span></li>` : ''}
            ${inA ? `<li><span>Slide ${esc(inA.title)}${discLabel(inA, sw.incoming.disc)} into slot ${pad2(sw.slot)}, label facing right. Check it sits in slot ${pad2(sw.slot)} at the front and the back.</span></li>` : ''}
            <li><span>With SERVICE MODE on the display, type 3 1, then ${pad2(sw.slot)}, then press POPULAR.</span></li>
            <li><span>Move the SERVICE switch back to NORMAL and close the door.</span></li>
          </ol></div>
        <p class="detail-meta">When the CDs are switched, tap Make the swap. ${pages} binder page${pages > 1 ? 's' : ''} and 1 title card will go on the print list.</p>
        <div class="frow"><button class="btn btn-primary" data-swap-confirm>Make the swap</button>
          <button class="btn btn-secondary" data-manage="home">Cancel</button></div>`;
      break;
    }
    case 'print': {
      const total = state.reprint.length;
      const printedCount = total - n;
      const actions = (key, noun) => (state.printed[key]
        ? `<div class="page-actions"><span class="badge badge-printed">Printed ${when(state.printed[key])}</span><button class="btn-quiet" data-print-page="${key}">Print again</button></div>`
        : `<div class="page-actions"><button class="btn btn-secondary" data-print-page="${key}">Print this ${noun}</button><button class="btn-quiet" data-skip-page="${key}">Skip</button></div>`);
      const indexPages = Math.ceil(CONFIG.slotCount / CONFIG.indexPerPage);
      const cardCount = Math.ceil(CONFIG.slotCount / CONFIG.slotsPerCard);
      const pageKeys = state.reprint.filter(k => !k.startsWith('card:'));
      const cardKeys = state.reprint.filter(k => k.startsWith('card:')).sort(byCardNo);
      const sheets = Math.ceil(cardKeys.length / CONFIG.card.perSheet);
      const extras = `<p class="muted small">Need a fresh copy of a page? Open any album while Manage is unlocked and tap Reprint this album's page.</p>
        <div class="frow"><button class="btn-quiet" data-queue-index>Add the full jukebox index (${indexPages} pages)</button>
          <button class="btn-quiet" data-queue-cards>Add all ${cardCount} title cards</button>
          <button class="btn-quiet" data-queue-albums>Add every album page (${Store.albums().length})</button></div>`;
      el.innerHTML = `${backbar('home', '', 'Pages to print')}
        ${total
          ? `${CONFIG.printing ? '' : '<p class="detail-meta">In this preview, Print only marks an item as printed. On the kiosk it opens the tablet\'s print screen.</p>'}
             <div class="frow"><button class="btn btn-primary" data-print-all>Print everything (${total})</button>
               ${printedCount ? `<button class="btn btn-secondary" data-clear-printed>Clear ${printedCount} printed</button>` : ''}</div>
             ${pageKeys.length ? `<h2 class="section-title">Binder pages (${pageKeys.length})</h2>
               <p class="muted small">Plain letter paper. Each page says in its top corner where it goes in the binder.</p>
               <div class="pages">${pageKeys.map(k => pageHTML(k, actions(k, 'page'))).join('')}</div>` : ''}
             ${cardKeys.length ? `<h2 class="section-title">Jukebox title cards (${cardKeys.length})</h2>
               <p class="muted small">Cards print 3 side by side on a landscape letter sheet of heavy paper, front side only (${sheets} sheet${sheets > 1 ? 's' : ''} here). Each card has a thin border to line up on the paper cutter, with a small gap between cards to trim away. Cards print after the binder pages, and the app tells you when to load the card stock.</p>
               <div class="sheet-preview">${sheetPreviewHTML(cardKeys.slice(0, CONFIG.card.perSheet))}
                 <span class="page-cap">How the first sheet prints${sheets > 1 ? ` (1 of ${sheets})` : ''}.</span></div>
               <div class="cards-list">${cardKeys.map(k => pageHTML(k, actions(k, 'card'))).join('')}</div>` : ''}`
          : `<div class="empty-state"><h2>Nothing to print.</h2><p class="muted">The binder and the jukebox cards match the catalog. Swaps and new albums add items here.</p></div>`}
        ${extras}`;
      fitCardsSoon(el);
      break;
    }
    case 'swap-done': {
      const ls = ui.lastSwap || { text: '', added: 0 };
      el.innerHTML = `<header class="view-head"><h1>Swap saved</h1>
          <p>${esc(ls.text)} ${ls.added} binder page${ls.added === 1 ? '' : 's'} and 1 title card need reprinting. Print them, then change the title card. The ? button has the steps.</p></header>
        <div class="frow"><button class="btn btn-primary" data-manage="print">Print the pages</button>
          <button class="btn btn-secondary" data-manage="swap-slot">Swap another disc</button>
          <button class="btn btn-secondary" data-manage="home">Back to Manage</button></div>`;
      break;
    }
    case 'history': {
      const rows = state.swapLog.map(e => {
        const o = e.out && BY_ID[e.out.id];
        const i = e.in && BY_ID[e.in.id];
        const outTxt = o ? `took out ${esc(o.title)}${discLabel(o, e.out.disc)}` : e.out ? 'took out an album no longer in the catalog' : 'slot was empty';
        const inTxt = i ? `put in ${esc(i.title)}${discLabel(i, e.in.disc)}` : 'left it empty';
        return `<div class="history-row"><span class="song-title">Slot ${pad2(e.slot)}: ${outTxt}, ${inTxt}</span><span class="song-sub">${when(e.at)}</span></div>`;
      }).join('');
      el.innerHTML = `${backbar('home', '', 'Swap history')}
        ${rows ? `<div class="history">${rows}</div>` : `<div class="empty-state"><h2>No swaps yet.</h2><p class="muted">Every swap shows up here with the date and time.</p></div>`}`;
      break;
    }
    default: {
      const ls = remote.lastSync || {};
      const syncNote = LIVE && ls.when
        ? `<p class="sync-note">Last Discogs check: ${when(ls.when)}${ls.remaining ? `. Details for ${Number(ls.remaining) || 0} albums are still coming in.` : '.'}${ls.error ? ` It stopped with this message: ${esc(ls.error)}` : ''}</p>` : '';
      const intro = pinRequired()
        ? `Unlocked. It locks again by itself after ${Number(setting('idle_minutes')) || CONFIG.idleMinutes} minutes without a touch.`
        : 'Swap discs, print pages and title cards, and bring in new albums from Discogs.';
      el.innerHTML = `<header class="view-head"><h1>Manage</h1><p>${intro}</p></header>
        <div class="tiles">
          <button class="tile" data-manage="swap-slot"><span class="tile-title">Swap a disc</span><span class="tile-desc">Change what's in a jukebox slot.</span></button>
          <button class="tile" data-manage="print"><span class="tile-title">Pages to print${n ? ` <span class="count">${n}</span>` : ''}</span><span class="tile-desc">${n ? `${n} item${n > 1 ? 's' : ''} waiting to print.` : 'The binder and the jukebox cards are up to date.'}</span></button>
          <button class="tile" data-sync><span class="tile-title">Check Discogs</span><span class="tile-desc">Bring in albums you've scanned since the last check. This also runs every night.</span></button>
          <button class="tile" data-manage="history"><span class="tile-title">Swap history</span><span class="tile-desc">${state.swapLog.length ? `${state.swapLog.length} swap${state.swapLog.length > 1 ? 's' : ''} recorded.` : 'No swaps yet.'}</span></button>
        </div>
        ${syncNote}
        <section class="detail-sec"><h2 class="section-title">Idle screen</h2>
          <div class="frow"><button class="toggle" data-motion aria-pressed="${motionOn()}">${ICON.disc}Moving covers: ${motionOn() ? 'On' : 'Off'}</button>
            <button class="btn btn-secondary" data-idle-preview>Show it now</button></div>
          ${motionSetting() === 'auto' ? `<p class="muted small">This follows the device's own animation setting until you change it here.</p>` : ''}
        </section>
        <p class="muted">To change an album's tags, open it from Find music${pinRequired() ? ' while Manage is unlocked' : ''}.</p>
        <div class="frow">${pinRequired() ? `<button class="btn btn-secondary" data-lock>${ICON.lock}Lock</button>` : ''}
          ${LIVE ? '' : `<button class="btn btn-warn" data-reset>${ui.resetArmed ? 'Tap again to reset' : 'Reset sample data'}</button>`}</div>`;
    }
  }
}

/* =========================================================
   How-to guides (each prints on one letter-size page)
   ========================================================= */
const GUIDES = [
  { id: 'swap', title: 'Swap a disc in the jukebox', start: true,
    note: 'The tablet shows each step on screen while you swap. On the disc holder, only every other slot has a number: even numbers on one half, odd numbers on the other.',
    steps: [
      "On the tablet, tap Manage and enter your PIN. Tap Swap a disc, tap the slot you're changing, then tap the album that's going in.",
      'At the jukebox, unlock and open the top door. Move the SERVICE switch to SERVICE.',
      'Press the SCAN button (it may be labeled CANCEL/SCAN) to move the disc space to the left or right of the transfer arm.',
      'Slide the old CD out of the slot. Slide the new CD in with the label facing right. Check that it sits in the same numbered slot at the front and the back.',
      'With SERVICE MODE on the display, type 3 1. The display shows PROGRAM INIT. Type the two-digit disc number, then press POPULAR.',
      'Move the SERVICE switch back to NORMAL and close the door. The jukebox reads the new disc, and you can play music while it does.',
      'Back at the tablet, tap Make the swap.',
      'Print the pages and the title card it lists. File the pages in the binder, then change the title card (see Change a title card).',
    ] },
  { id: 'card', title: 'Change a title card',
    note: 'Never turn the title pages by hand. Use the handwheel on top of the title page assembly. If you have several new cards, change them all while the assembly is out.',
    steps: [
      'Open the jukebox door.',
      'Lift the latching lever and slide the CBA-2 back toward you until it locks in place.',
      "Unplug the title page assembly's cable (the harness).",
      'Steady the top of the title page assembly with your index fingers, and release the two catches with your thumbs.',
      'Let the assembly tip back until it rests on its support brackets. Lift it off the brackets and out of the jukebox.',
      'Turn the handwheel to the page with that disc number. Slide the new card under the top left and right tabs, then down until it locks in place.',
      'Put the assembly back by reversing steps 2 to 5, then close the door.',
    ] },
  { id: 'add', title: 'Add a new album',
    steps: [
      'Scan the new CD with the Discogs app on your phone, the way you do now.',
      'The tablet checks Discogs every night, so the album shows up the next morning with a red New badge. To bring it in right away, tap Manage, then Check Discogs.',
      'Print its binder page: tap Manage, then Pages to print.',
      'File the page in the binder under the letter printed in its top corner.',
      'If you like, open the album and add your tags while Manage is unlocked.',
    ] },
  { id: 'print', title: 'Print binder pages and title cards',
    steps: [
      'Tap Manage and enter your PIN.',
      'Tap Pages to print. The number shows how many pages changed.',
      "Tap Print everything, or tap Print this page under one page. Tap Skip for a page you don't need.",
      'The print screen opens. Check that it shows your printer, then tap the round Print button.',
      'Title cards print after the binder pages, 3 to a sheet. When the app asks, put card stock in the manual feed slot and tap Print the cards. Cut them apart on the paper cutter along the thin border around each card.',
      'Each page says in its top corner where it goes. Put it in the binder and throw away the old page.',
      'Back at the tablet, answer whether everything printed. Then tap Clear printed.',
    ] },
  { id: 'clear', title: 'Clear the play queue',
    note: 'Use this to skip the songs that are lined up. It clears every song waiting to play.',
    steps: [
      'Unlock and open the jukebox.',
      'Move the SERVICE switch to SERVICE.',
      'Type 8 3, then press POPULAR. The display says CLEAR SELECTIONS.',
      'Move the SERVICE switch back to NORMAL.',
      'Close the jukebox.',
    ] },
  { id: 'find', title: 'Find a song to play',
    steps: [
      'Tap Find music.',
      'Type part of a song, album, or artist name. You can also tap a decade, genre, or tag.',
      'Songs in the jukebox show a number like 22 06.',
      'Punch that number into the jukebox.',
    ] },
];
function renderHelp() {
  $('#helpBody').innerHTML = `
    <header class="view-head"><h1 id="helpTitle">How to</h1>
      <p>Each guide prints on one page, so you can keep a copy at the front of the binder and follow it at the jukebox.</p></header>
    <div class="frow"><button class="btn btn-secondary" data-print-guide="all">Print all ${GUIDES.length} guides</button></div>
    <div class="guides">${GUIDES.map(g => `
      <section class="guide-card" aria-labelledby="g-${g.id}">
        <h2 id="g-${g.id}">${esc(g.title)}</h2>
        <ol class="steps">${g.steps.map(s => `<li><span>${esc(s)}</span></li>`).join('')}</ol>
        ${g.note ? `<p class="guide-note">${esc(g.note)}</p>` : ''}
        <div class="frow"><button class="btn btn-secondary" data-print-guide="${g.id}">Print these steps</button>
          ${g.start ? '<button class="btn btn-primary" data-help-start>Start a swap</button>' : ''}</div>
      </section>`).join('')}</div>`;
}
function openHelp() { renderHelp(); $('#helpWrap').hidden = false; $('#helpClose').focus(); $('#helpWrap .sheet').scrollTop = 0; }
function closeHelp() { $('#helpWrap').hidden = true; }

/* =========================================================
   Idle screen + auto-lock
   ========================================================= */
let idleTimer;
function bump() { clearTimeout(idleTimer); idleTimer = setTimeout(goIdle, idleMs()); }
function lockManage() { ui.unlocked = false; ui.pin = ''; ui.pinValue = ''; ui.pinError = ''; ui.manage = 'home'; ui.resetArmed = false; }
function goIdle() {
  if (!$('#askWrap').hidden) { bump(); return; }   // don't interrupt a print question
  lockManage();
  closeSheet();
  closeHelp();
  clearFilters(); ui.q = ''; $('#q').value = '';
  setView('find');
  showIdle();
}
// Two rows of covers drifting in opposite directions. Each row holds enough covers to fill a wide
// screen and repeats once, so the loop is seamless. With only a few discs loaded, covers from the
// rest of the collection fill in, and the heading changes to match.
const IDLE_MIN = 12;          // covers per row before it repeats
const IDLE_SPEED = 20;        // pixels per second
const IDLE_STEP = 168;        // one cover (150px) plus the gap (18px)
function showIdle() {
  const loaded = [...new Set(Object.values(state.slots).map(v => v.id))].filter(id => BY_ID[id]);
  let ids = loaded.slice();
  if (ids.length < IDLE_MIN) {
    const rest = Store.albums().map(a => a.id).filter(id => !ids.includes(id)).sort((x, y) => hash(x) - hash(y));
    ids = ids.concat(rest.slice(0, IDLE_MIN - ids.length));
  }
  const list = ids.map(id => BY_ID[id]);
  if (!list.length) return;
  $('#idle h2').textContent = ids.length === loaded.length ? 'Now in the Jukebox' : 'Jukebox Catalog';
  // Enough covers for two different rows: split them. Otherwise both rows show all of them, the second one shifted.
  const half = Math.ceil(list.length / 2);
  const rowA = list.length >= IDLE_MIN * 2 ? list.slice(0, half) : list;
  const rowB = list.length >= IDLE_MIN * 2 ? list.slice(half) : list.slice(half).concat(list.slice(0, half));
  const fill = items => { let out = items.slice(); while (out.length < IDLE_MIN) out = out.concat(items); return out; };
  const row = (items, cls) => {
    const seq = fill(items);
    const secs = Math.round(seq.length * IDLE_STEP / IDLE_SPEED);   // same speed however many covers
    return `<div class="idle-row ${cls}" style="animation-duration:${secs}s">${seq.concat(seq).map(coverHTML).join('')}</div>`;
  };
  $('#idleRows').innerHTML = row(rowA, '') + row(rowB, 'rev');
  $('#idle').classList.toggle('still', !motionOn());
  $('#idle').hidden = false;
}

/* =========================================================
   Events
   ========================================================= */
function rerenderAfterChange() {
  renderRail();
  if (ui.view === 'find') renderFind();
  if (ui.view === 'jukebox') renderJukebox();
  if (ui.view === 'manage') renderManage();
  if (ui.sheet) renderSheet();
}
const fresh = () => ({ slot: null, incoming: null, fromAlbum: false, q: '' });

async function onClick(e) {
  const t = e.target.closest('button, [data-close-sheet], [data-help-close]');
  if (!t || t.id === 'askYes' || t.id === 'askNo') return;
  const d = t.dataset;

  if ('goIdle' in d) { goIdle(); return; }
  if ('helpOpen' in d) { openHelp(); return; }
  if ('helpClose' in d) { closeHelp(); return; }
  if (d.printGuide) { await printGuides(d.printGuide); return; }
  if ('helpStart' in d) {
    closeHelp(); closeSheet(); setView('manage');
    if (unlocked()) { ui.swap = fresh(); ui.manage = 'swap-slot'; renderManage(); }
    return;
  }
  if (d.view) { closeSheet(); setView(d.view); return; }
  if ('closeSheet' in d) { closeSheet(); return; }
  if (d.open) { openAlbum(d.open, +d.disc || null, +d.track || null); return; }

  if (d.chip) {
    const set = { decade: ui.decades, genre: ui.genres, tag: ui.tags, format: ui.formats }[d.chip];
    const val = d.chip === 'decade' ? +d.value : d.value;
    if (set.has(val)) set.delete(val); else set.add(val);
    ui.allSongs = false;
    renderFind();
    return;
  }
  if (t.id === 'onlyJuke') { ui.onlyJuke = !ui.onlyJuke; renderFind(); return; }
  if (t.id === 'clearAll') { clearFilters(); renderFind(); return; }
  if (t.id === 'clearEverything') { clearFilters(); ui.q = ''; $('#q').value = ''; renderFind(); return; }
  if (t.id === 'qClear') { ui.q = ''; $('#q').value = ''; ui.allSongs = false; renderResults(); $('#q').focus(); return; }
  if (t.id === 'allSongs') { ui.allSongs = true; renderResults(); return; }
  if (d.sort) { ui.sort = d.sort; renderResults(); return; }

  if (d.slot && d.mode === 'open') { const v = state.slots[+d.slot]; if (v) openAlbum(v.id, v.disc, null); return; }
  if (d.slot && d.mode === 'pick') {
    ui.swap.slot = +d.slot;
    ui.manage = ui.swap.fromAlbum ? 'swap-confirm' : 'swap-pick';
    ui.swap.q = '';
    renderManage(); $('#main').scrollTop = 0;
    return;
  }

  // Manage: keypad
  if (d.key) {
    if (ui.checkingPin) return;
    if (d.key === 'clear') ui.pin = '';
    else if (d.key === 'del') ui.pin = ui.pin.slice(0, -1);
    else if (ui.pin.length < 4) ui.pin += d.key;
    ui.pinError = '';
    if (ui.pin.length === 4) {
      const pin = ui.pin;
      ui.checkingPin = true; renderManage();
      const r = await Actions.verifyPin(pin);
      ui.checkingPin = false; ui.pin = '';
      if (r.ok) { ui.unlocked = true; ui.pinValue = pin; ui.manage = 'home'; toast('Manage is unlocked.'); Saver.kick(0); }
      else ui.pinError = r.net ? "Couldn't check the PIN. Check the Wi-Fi and try again." : (r.message || "That PIN didn't match. Try again.");
    }
    renderRail(); renderManage();
    return;
  }
  if (!unlocked() && !('closeSheet' in d)) {
    // Everything below needs Manage unlocked.
    if (d.manage || d.loadAlbum || d.tagAdd || d.tagRemove || d.queueAlbum) return;
  }
  if (d.manage) {
    if (d.manage === 'swap-slot' && !ui.swap.fromAlbum) ui.swap = fresh();
    if (d.manage === 'home') ui.swap = fresh();
    ui.manage = d.manage; ui.resetArmed = false;
    renderManage(); $('#main').scrollTop = 0;
    return;
  }
  if (('incoming' in d && t.classList.contains('pick')) || d.incoming === '') {
    if (d.incoming) { const i = d.incoming.lastIndexOf(':'); ui.swap.incoming = { id: d.incoming.slice(0, i), disc: +d.incoming.slice(i + 1) }; }
    else ui.swap.incoming = null;
    ui.manage = 'swap-confirm';
    renderManage(); $('#main').scrollTop = 0;
    return;
  }
  if ('swapConfirm' in d) {
    const slot = ui.swap.slot;
    const inc = ui.swap.incoming;
    const inA = inc && BY_ID[inc.id];
    const r = await Actions.swap(slot, inc);
    if (!r.ok) return;
    ui.lastSwap = {
      text: inA ? `Slot ${pad2(slot)} now holds ${inA.title}${discLabel(inA, inc.disc)}.` : `Slot ${pad2(slot)} is now empty.`,
      added: 1 + (r.out ? 1 : 0) + (inc ? 1 : 0),
    };
    ui.swap = fresh();
    ui.manage = 'swap-done';
    rerenderAfterChange();
    $('#main').scrollTop = 0;
    return;
  }
  if (d.loadAlbum) {
    const a = BY_ID[d.loadAlbum];
    const disc = a.discs.map((_, i) => i + 1).find(x => Store.slotFor(a.id, x) === null);
    ui.swap = { slot: null, incoming: { id: a.id, disc }, fromAlbum: true, q: '' };
    closeSheet();
    ui.view = 'manage';
    ['find', 'jukebox', 'manage'].forEach(name => { $('#view-' + name).hidden = name !== 'manage'; });
    ui.manage = 'swap-slot';
    renderRail(); renderManage(); $('#main').scrollTop = 0;
    return;
  }
  if (d.printPage) { await printKeys([d.printPage]); return; }
  if ('printAll' in d) { await printKeys(state.reprint.slice()); return; }
  if ('clearPrinted' in d) { await Actions.clearPrinted(); renderManage(); return; }
  if (d.skipPage) {
    await Actions.skip(d.skipPage, d.skipPage.startsWith('card')
      ? 'Skipped. The jukebox keeps its old title card.'
      : d.skipPage.startsWith('index')
      ? 'Skipped. The binder keeps its old index page.'
      : 'Skipped. The binder keeps its old page. You can reprint it from the album any time.');
    renderManage();
    return;
  }
  if ('queueCards' in d) {
    const cards = Math.ceil(CONFIG.slotCount / CONFIG.slotsPerCard);
    await Actions.queue(Array.from({ length: cards }, (_, i) => 'card:' + i), `Added all ${cards} title cards to Pages to print.`);
    renderManage();
    return;
  }
  if ('queueIndex' in d) {
    const pages = Math.ceil(CONFIG.slotCount / CONFIG.indexPerPage);
    await Actions.queue(Array.from({ length: pages }, (_, i) => 'index:' + (i + 1)), `Added ${pages} index pages to Pages to print.`);
    renderManage();
    return;
  }
  if ('queueAlbums' in d) {
    // The whole binder, in shelf order. For the first print or a fresh binder.
    const keys = Store.albums().slice().sort(byArtist).map(a => 'album:' + a.id);
    await Actions.queue(keys, `Added ${keys.length} album pages to Pages to print.`);
    renderManage();
    return;
  }
  if (d.queueAlbum) {
    await Actions.queue(['album:' + d.queueAlbum], "Added this album's page to Pages to print.");
    if (ui.view === 'manage') renderManage();
    return;
  }
  if ('sync' in d) { await Actions.sync(); rerenderAfterChange(); return; }
  if ('motion' in d) { await Actions.setMotion(!motionOn()); renderManage(); return; }
  if ('lock' in d) { lockManage(); toast('Manage is locked.'); rerenderAfterChange(); return; }
  if ('reset' in d) {
    if (!ui.resetArmed) { ui.resetArmed = true; renderManage(); return; }
    Actions.reset(); ui.resetArmed = false; clearFilters(); toast('Sample data reset.'); rerenderAfterChange();
    return;
  }
  if ('idlePreview' in d) { showIdle(); return; }

  if (d.tagAdd && ui.sheet) { await Actions.addTag(ui.sheet.id, d.tagAdd); renderSheet(); if (ui.view === 'find') renderFind(); return; }
  if (d.tagRemove && ui.sheet) { await Actions.removeTag(ui.sheet.id, d.tagRemove); renderSheet(); if (ui.view === 'find') renderFind(); return; }
}

document.addEventListener('click', e => {
  onClick(e).catch(err => { ui.busy = false; toast('Something went wrong: ' + (err && err.message ? err.message : err)); });
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'tagForm') return;
  e.preventDefault();
  const input = $('#tagNew');
  if (!ui.sheet || !unlocked() || !input.value.trim()) return;
  Actions.addTag(ui.sheet.id, input.value);
  renderSheet();
  if (ui.view === 'find') renderFind();
});

document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; ui.allSongs = false; renderResults(); }
  if (e.target.id === 'pickQ') { ui.swap.q = e.target.value; renderPickList(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#askWrap').hidden) return;
    if (!$('#idle').hidden) { $('#idle').hidden = true; return; }
    if (!$('#helpWrap').hidden) { closeHelp(); return; }
    if (ui.sheet) closeSheet();
  }
});

// A cover image that fails to load is removed, so the pattern and title show instead.
document.addEventListener('error', e => {
  const el = e.target;
  if (el && el.tagName === 'IMG' && el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('cover')) el.remove();
}, true);

$('#idle').addEventListener('click', () => { $('#idle').hidden = true; bump(); if (quietMoment()) refresh(true); });
// A new #api= address typed into the page address takes effect right away.
window.addEventListener('hashchange', () => { if (/[#&]api=/.test(location.hash)) location.reload(); });
['pointerdown', 'keydown', 'input'].forEach(ev => document.addEventListener(ev, bump, { passive: true }));

/* =========================================================
   Start
   ========================================================= */
if (LIVE) {
  const cached = readJSON(CONFIG.cacheKey);
  if (cached && cached.ok) {
    try { applyCatalog(cached); Saver.queue.forEach(op => applyLocal(op, true)); } catch (e) { /* stale cache: ignore */ }
  }
  renderRail(); renderFind();
  if (Saver.pending()) Saver.kick(0); else refresh(true);   // unsaved changes from last time go first
  setInterval(() => { if (quietMoment()) refresh(true); }, CONFIG.refreshMs);
} else {
  $('#demoNote').hidden = false;
  state = demoLoad();
  setAlbums(demoAlbums());
  reindex();
  renderRail(); renderFind();
}
bump();
})();
