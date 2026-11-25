
/* LEXICON is expanded from LEXICON_SRC: term → Set of tags */
const LEXICON = (() => {
  const m = new Map();
  for (const line of LEXICON_SRC) {
    const [tags, words] = line.split('|');
    const ts = tags.split(' ');
    for (const w of words.split(',')) {
      const k = norm(w);
      if (!k) continue;
      if (!m.has(k)) m.set(k, new Set());
      ts.forEach(t => m.get(k).add(t));
    }
  }
  return m;
})();

/* =====================================================================
   SCORING  — pure: no DOM, no storage, no clock.
   scoreGuess(guess, puzzle) → { score, depth, zone, zoneIndex, label, reason, solved, exact, corrected }
   ===================================================================== */
const STOP = new Set(('a an the and or but of to in on at for with is it its be are was were you your i im me my we our they them their he she his her ' +
  'this that so too very just like as by from up out about into over than then when what who how not no do does did have has had get got can will would one some any all more most much really still even only also if because off down back after before while being been s t now isnt dont whole same').split(' '));
const BANDS = { exact: [100, 100], hot: [80, 95], warm: [50, 75], cool: [20, 45] };
const TIER_LABEL = { hot: 'Same meaning, different word.', warm: 'Right neighbourhood.', cool: 'Right world, wrong meaning.' };
const FLAVOUR = [
  'That is not slang, that is a sneeze.', 'The definition has never met that word.', 'Bold. Wrong, but bold.',
  'You are still in the shallows.', 'Not even in the same dictionary.', 'The fish are confused.',
  'Splash. Nothing happened.', 'A brave guess that changed nothing.'
];

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
function tokens(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}
function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/* optimal string alignment distance: insert, delete, substitute, swap neighbours */
function osa(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
function zoneIndexFor(score) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return CONFIG.ZONES.findIndex(z => s >= z.min && s <= z.max);
}
function scoreToDepth(score) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const z = CONFIG.ZONES[zoneIndexFor(s)];
  if (z.min === z.max) return z.d1;
  return Math.round(z.d0 + (s - z.min) / (z.max - z.min + 1) * (z.d1 - z.d0));
}
/* entries may carry their own number as "word:88" */
function parseEntry(e) {
  const m = /^(.*?):(\d{1,3})$/.exec(e);
  return m ? { text: m[1], own: +m[2] } : { text: e, own: null };
}
const INDEX = new Map();
function indexFor(p) {
  if (INDEX.has(p.id)) return INDEX.get(p.id);
  const map = new Map();
  for (const e of p.exact) map.set(norm(e), { tier: 'exact', score: 100, text: e });
  for (const tier of ['hot', 'warm', 'cool']) {
    const list = (p.tiers[tier] || []).map(parseEntry), [lo, hi] = BANDS[tier], n = list.length;
    list.forEach((en, i) => {
      const k = norm(en.text);
      if (!k || map.has(k)) return;
      const score = en.own != null ? Math.max(lo, Math.min(hi, en.own)) : (n === 1 ? hi : Math.round(hi - i * (hi - lo) / (n - 1)));
      map.set(k, { tier, score, text: en.text });
    });
  }
  const defWords = new Set(tokens(p.definition).filter(w => w.length > 2 && !STOP.has(w)).map(stem));
  const idx = { map, defWords, exactKeys: p.exact.map(norm) };
  INDEX.set(p.id, idx);
  return idx;
}
/* words we know are real, so autocorrect must leave them alone */
const KNOWN = (() => {
  const s = new Set(LEXICON.keys());
  for (const p of PUZZLES) {
    s.add(norm(p.term)); p.exact.forEach(e => s.add(norm(e)));
    for (const t of ['hot', 'warm', 'cool']) (p.tiers[t] || []).forEach(e => s.add(norm(parseEntry(e).text)));
  }
  return s;
})();
const GUESS_TAGS = (() => {
  const m = new Map();
  const add = (k, tags) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); tags.forEach(t => m.get(k).add(t)); };
  for (const [k, set] of LEXICON) add(k, set);
  for (const p of PUZZLES) {
    add(norm(p.term), p.tags); p.exact.forEach(e => add(norm(e), p.tags));
    ['hot', 'warm'].forEach(t => (p.tiers[t] || []).forEach(e => add(norm(parseEntry(e).text), p.tags)));
  }
  return m;
})();

/* Autocorrect, deliberately stingy:
   - never touches a word we already know is real
   - target must be 5+ characters and share the first letter
   - 1 edit for targets up to 8 characters, 2 edits for 9+
   - a corrected answer solves the puzzle but lands at 92, never the Slanger, and earns no bonus */
function autocorrect(g, idx) {
  if (g.length < 4 || KNOWN.has(g)) return null;
  let best = null;
  for (const [k, v] of idx.map) {
    if (k.length < 5 || k[0] !== g[0]) continue;
    const allow = k.length >= 9 ? 2 : 1;
    if (Math.abs(k.length - g.length) > allow) continue;
    const d = osa(g, k);
    if (d === 0 || d > allow) continue;
    const rank = (v.tier === 'exact' ? 0 : 10) + d * 2 + (100 - v.score) / 100;
    if (!best || rank < best.rank) best = Object.assign({ rank, d, key: k }, v);
  }
  return best;
}
function result(score, o) {
  const zi = zoneIndexFor(score);
  return { score, depth: scoreToDepth(score), zone: CONFIG.ZONES[zi].name, zoneIndex: zi, label: o.label, reason: o.reason, solved: !!o.solved, exact: !!o.exact, corrected: o.corrected || null };
}
function scoreGuess(guess, puzzle) {
  const g = norm(guess);
  const idx = indexFor(puzzle);
  if (!g) return result(0, { label: 'Nothing to dive with.', reason: 'empty' });
  const hit = idx.map.get(g);
  if (hit) {
    if (hit.tier === 'exact') return result(100, { label: 'Bang on.', reason: 'exact', solved: true, exact: true });
    return result(hit.score, { label: TIER_LABEL[hit.tier], reason: 'tier:' + hit.tier });
  }
  const ac = autocorrect(g, idx);
  if (ac) {
    if (ac.tier === 'exact') return result(CONFIG.AUTOCORRECT_SCORE, { label: 'Autocorrected to “' + ac.text + '”. Counts, but typos don’t reach the bottom.', reason: 'autocorrect:exact', solved: true, corrected: ac.text });
    return result(Math.max(15, ac.score - 10), { label: 'Autocorrected to “' + ac.text + '”, minus a little for the typo. ' + TIER_LABEL[ac.tier], reason: 'autocorrect:' + ac.tier, corrected: ac.text });
  }
  const toks = tokens(guess);
  if (toks.length > 1) {
    for (let i = 0; i < toks.length; i++) for (let j = i + 1; j <= toks.length; j++) {
      if ((j - i) < toks.length && idx.exactKeys.includes(toks.slice(i, j).join(''))) return result(88, { label: 'The answer is in there somewhere. Lose the extra words.', reason: 'phrase' });
    }
  }
  const content = toks.filter(w => !STOP.has(w) && w.length > 2);
  let tagScore = 0, contentScore = 0, partial = 0, spell = 0;
  const gtags = new Set();
  const addTags = k => { const s = GUESS_TAGS.get(k); if (s) s.forEach(t => gtags.add(t)); };
  addTags(g); toks.forEach(t => addTags(norm(t)));
  if (gtags.size) {
    const overlap = puzzle.tags.filter(t => gtags.has(t)).length;
    if (overlap) tagScore = Math.round(30 + 30 * overlap / Math.min(puzzle.tags.length, gtags.size));
  }
  if (content.length) {
    const matched = content.filter(w => idx.defWords.has(stem(w))).length;
    if (matched) contentScore = Math.min(40, Math.round(20 + 20 * matched / content.length));
  }
  if (toks.length > 1) toks.forEach(t => { const h = idx.map.get(norm(t)); if (h && h.tier !== 'exact') partial = Math.max(partial, Math.round(h.score * 0.7)); });
  if (!KNOWN.has(g)) for (const k of idx.exactKeys) { const d = osa(g, k); if (d > 0 && (d <= 1 || d / Math.max(k.length, g.length) <= 0.25)) spell = 55; }
  let best = Math.max(tagScore, contentScore, partial, spell);
  if (tagScore && contentScore) best += 5;
  best = Math.min(70, best);
  if (best > 0) {
    let label = 'Same vibe, different word.';
    if (best === spell && spell >= tagScore) label = 'So close it hurts. Check the spelling — autocorrect won’t save this one.';
    else if (best === partial && partial > tagScore) label = 'Part of that lands.';
    else if (contentScore > tagScore) label = 'You found a word from the definition. Bit literal.';
    return result(best, { label, reason: 'fallback' });
  }
  const hh = fnv(g);
  return result(5 + (hh % 11), { label: FLAVOUR[hh % FLAVOUR.length], reason: 'fallback:miss' });
}
function isBlocked(text) {
  const leet = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
  const canon = s => s.toLowerCase().replace(/[013457@$!]/g, c => leet[c]).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '').replace(/(.)\1{2,}/g, '$1$1');
  const parts = [canon(text)].concat(String(text).split(/\s+/).map(canon));
  return parts.some(p => p && (CONFIG.BLOCK.includes(fnv(p)) || (p.length > 3 && p.endsWith('s') && CONFIG.BLOCK.includes(fnv(p.slice(0, -1))))));
}

/* ---------- daily seeding ---------- */
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function seededPerm(n, seed) {
  const r = mulberry32(seed), a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function dayNumber(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); }
function weekdayOf(n) { return (n + 3) % 7; } // Monday = 0
function slotTargets(w) { return Array.from({ length: CONFIG.PER_DAY }, (_, i) => Math.max(1, Math.min(5, Math.round(1 + i / 3 + w / 3)))); }
function diveNumber(dateStr) { return dayNumber(dateStr) - dayNumber(CONFIG.EPOCH) + 1; }
/* Same seven for everyone on a date (per content-filter setting). Difficulty climbs within each dive and Monday→Sunday.
   Each difficulty bucket is walked in a fixed shuffled order so puzzles don't repeat until the bucket runs out. */
function dailyPuzzles(dateStr, filterOn) {
  const pool = PUZZLES.filter(p => !(filterOn && p.nsfw)).slice().sort((a, b) => a.id < b.id ? -1 : 1);
  const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  pool.forEach(p => buckets[Math.max(1, Math.min(5, p.difficulty))].push(p));
  const bucketFor = t => { for (let r = 0; r < 5; r++) { if (buckets[t - r] && buckets[t - r].length) return t - r; if (buckets[t + r] && buckets[t + r].length) return t + r; } return 1; };
  const n = dayNumber(dateStr), salt = fnv(CONFIG.NAME + (filterOn ? ':clean' : ':all'));
  const weekly = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let w = 0; w < 7; w++) slotTargets(w).forEach(t => weekly[bucketFor(t)]++);
  const cum = {}, weeks = Math.floor(n / 7);
  for (const b in weekly) cum[b] = weeks * weekly[b];
  for (let k = weeks * 7; k < n; k++) slotTargets(weekdayOf(k)).forEach(t => cum[bucketFor(t)]++);
  const used = new Set(), out = [], today = {};
  for (const t of slotTargets(weekdayOf(n))) {
    const b = bucketFor(t), arr = buckets[b];
    const k = cum[b] + (today[b] || 0); today[b] = (today[b] || 0) + 1;
    let pick = null;
    for (let tries = 0; tries < arr.length * 2 && !pick; tries++) {
      const kk = k + tries, cyc = Math.floor(kk / arr.length);
      const p = arr[seededPerm(arr.length, (salt ^ fnv(b + ':' + cyc)) >>> 0)[kk % arr.length]];
      if (!used.has(p.id)) pick = p;
    }
    if (!pick) pick = pool.find(p => !used.has(p.id));
    used.add(pick.id); out.push(pick);
  }
  return out.sort((a, b) => a.difficulty - b.difficulty).map(p => p.id);
}

/* ---------- round arithmetic ---------- */
function hintCost(keys) { return keys.reduce((s, k) => s + (CONFIG.HINTS.find(h => h.key === k) || { cost: 0 }).cost, 0); }
function roundFinal(r, plain) {
  if (plain) return { pen: 0, bonus: 0, tb: 0, final: r.bestDepth };
  const pen = hintCost(r.h);
  const clean = r.solved && !r.ac;
  const bonus = clean ? (CONFIG.MAX_GUESSES - r.g.length) * CONFIG.BONUS_PER_SPARE_GUESS : 0;
  const tb = clean && r.tl > 0 ? Math.ceil(r.tl / 1000) * CONFIG.TIME_BONUS_PER_SEC : 0;
  let final = Math.max(0, r.bestDepth - pen) + bonus + tb;
  if (r.h.length) final = Math.min(final, CONFIG.HINT_CAP);
  return { pen, bonus, tb, final };
}
function shareText(run) {
  const rows = run.rounds.map(r => {
    let s = r.g.map((g, i) => {
      if (g.s === 100) return r.slanger ? '🎯✨' : '🎯';
      if (r.ac && i === r.g.length - 1) return '✏️';
      return CONFIG.ZONES[g.z].emoji;
    }).join('');
    if (r.out === 'time') s += '⌛';
    if (r.h.length) s += '💡';
    return s || '⬛';
  });
  return CONFIG.NAME + ' #' + run.no + ' · ' + fmtM(run.total) + '\n' + rows.join('\n') + '\n' + CONFIG.SHARE_URL;
}
function fmtM(n) { return Math.round(n).toLocaleString('en-GB') + 'm'; }
function mss(ms) { const s = Math.ceil(Math.max(0, ms) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function peekPattern(term) { let i = 0; return [...term].map(ch => /[a-z0-9]/i.test(ch) ? (i++ % 2 === 0 ? ch.toLowerCase() : '_') : ch).join(''); }
function lengthHint(term) { const w = term.trim().split(/\s+/).map(x => x.replace(/[^a-z0-9]/gi, '').length); return w.length === 1 ? w[0] + ' letters' : w.length + ' words: ' + w.join(' + '); }
function hintText(key, p) {
  if (key === 'letter') return 'Starts with “' + p.term.trim()[0].toUpperCase() + '”';
  if (key === 'length') return lengthHint(p.term);
  if (key === 'pos') return p.pos;
  if (key === 'peek') return peekPattern(p.term);
  return '';
}

/* =====================================================================
   STATE AND STORAGE — one versioned key, every access in try/catch.
   ===================================================================== */
function freshModes() {
  return {
    endless: { best: 0, played: 0, words: 0, run: null, last: null },
    packs: { run: null, best: {}, played: {} },
    speed: { best: 0, played: 0, run: null },
    reverse: { best: 0, played: 0 },
    party: { played: 0, run: null, last: null }
  };
}
function freshState() {
  return {
    v: CONFIG.SCHEMA,
    settings: { filter: true, reducedMotion: false, highContrast: false, sound: true },
    streak: { cur: 0, max: 0, last: null },
    stats: { played: 0, wins: 0, totalDepth: 0, slangers: 0, words: 0, hist: [0, 0, 0, 0, 0, 0, 0] },
    runs: {},
    modes: freshModes()
  };
}
/* MIGRATIONS[n] turns a version-n object into version n+1. Never drop streaks or runs. */
const MIGRATIONS = {
  0: o => ({ v: 1, settings: o.settings || {}, streak: o.streak || {}, stats: o.stats || {}, runs: o.runs || {} }),
  1: o => { o.settings = o.settings || {}; o.settings.sound = true; o.modes = freshModes(); return o; }
};
function migrate(o) {
  const out = freshState();
  if (!o || typeof o !== 'object') return out;
  let v = +o.v || 0;
  while (v < CONFIG.SCHEMA) { o = (MIGRATIONS[v] || (x => x))(o); v++; o.v = v; }
  Object.assign(out.settings, o.settings || {});
  Object.assign(out.streak, o.streak || {});
  Object.assign(out.stats, o.stats || {});
  if (!Array.isArray(out.stats.hist) || out.stats.hist.length !== 7) out.stats.hist = [0, 0, 0, 0, 0, 0, 0];
  out.runs = (o.runs && typeof o.runs === 'object') ? o.runs : {};
  const fm = freshModes(), om = o.modes || {};
  for (const k in fm) out.modes[k] = Object.assign(fm[k], om[k] || {});
  return out;
}
let S = freshState();
let storageOK = false;
function load() {
  try {
    const ls = window.localStorage;
    let raw = ls.getItem(CONFIG.STORE_KEY);
    if (!raw) for (const k of CONFIG.LEGACY_KEYS) { raw = ls.getItem(k); if (raw) break; }
    S = migrate(raw ? JSON.parse(raw) : null);
    ls.setItem(CONFIG.STORE_KEY, JSON.stringify(S));
    storageOK = true;
  } catch (e) { storageOK = false; }
}
function save() {
  if (!storageOK) return;
  try { window.localStorage.setItem(CONFIG.STORE_KEY, JSON.stringify(S)); } catch (e) { storageOK = false; }
}
let DATE_OVERRIDE = null;
function todayStr() { const d = DATE_OVERRIDE ? new Date(DATE_OVERRIDE + 'T12:00:00Z') : new Date(); return d.toISOString().slice(0, 10); }
function shiftDay(ds, k) { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
function msToUtcMidnight() { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime(); }
const byId = id => PUZZLES.find(p => p.id === id);
function newRound() { return { g: [], h: [], done: false, solved: false, ac: false, slanger: false, best: 0, bestDepth: 0, final: 0, pen: 0, bonus: 0, tb: 0, tl: CONFIG.WORD_MS, out: null }; }
function sumFinals(run) { return run.rounds.reduce((s, r) => s + (r.done ? r.final : 0), 0); }
function getDayRun(date) {
  let run = S.runs[date];
  if (!run || !Array.isArray(run.ids) || run.ids.some(id => !byId(id))) {
    const ids = dailyPuzzles(date, S.settings.filter);
    run = { date, no: diveNumber(date), ids, i: 0, rounds: ids.map(newRound), done: false, total: 0 };
    S.runs[date] = run; save();
  }
  run.rounds.forEach(r => { if (r.tl == null) r.tl = r.done ? 0 : CONFIG.WORD_MS; });
  return run;
}
function liveStreak() { const t = todayStr(); return (S.streak.last === t || S.streak.last === shiftDay(t, -1)) ? S.streak.cur : 0; }
function recordRound(r) {
  S.stats.hist[zoneIndexFor(r.best)]++;
  S.stats.words++;
  if (r.slanger) S.stats.slangers++;
}
function completeRun(run) {
  if (run.done) return;
  run.done = true;
  run.total = run.rounds.reduce((s, r) => s + r.final, 0);
  const st = S.stats;
  st.played++; if (run.rounds.filter(r => r.solved).length >= 4) st.wins++;
  st.totalDepth += run.total;
  if (run.date === todayStr() && S.streak.last !== run.date) {
    S.streak.cur = S.streak.last === shiftDay(run.date, -1) ? S.streak.cur + 1 : 1;
    S.streak.last = run.date;
    S.streak.max = Math.max(S.streak.max, S.streak.cur);
  }
  save();
}
function pool() { return PUZZLES.filter(p => !(S.settings.filter && p.nsfw)); }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pickRandom(exclude, target) {
  let c = pool().filter(p => !exclude.has(p.id));
  if (!c.length) c = pool();
  if (target) { const best = Math.min(...c.map(p => Math.abs(p.difficulty - target))); c = c.filter(p => Math.abs(p.difficulty - target) === best); }
  return c[Math.floor(Math.random() * c.length)];
}
function packPuzzles(key) {
  const pk = CONFIG.PACKS.find(x => x.key === key);
  return pool().filter(p => p.pack === key || (p.pack === 'core' && pk.tags.some(t => p.tags.includes(t))));
}

/* =====================================================================
   ROUTER — plain hash names so links survive hosting (#daily, #day-2026-11-20 …)
   ===================================================================== */
const ROUTES = {
  home: viewHome, daily: viewDaily, endless: viewEndless, archive: viewArchive, packs: viewPacks, 'pack-play': viewPackPlay,
  speed: viewSpeed, reverse: viewReverse, party: viewParty, 'party-play': viewPartyPlay, stats: viewStats, how: viewHow, options: viewOptions
};
const NAV_OF = { 'pack-play': 'packs', 'party-play': 'party' };
let TIMERS = [];
function currentRoute() { return location.hash.replace(/^#\/?/, '').split(/[/?&]/)[0].toLowerCase() || 'home'; }
function route() {
  TIMERS.forEach(t => clearInterval(t)); TIMERS = [];
  stopClock(); P = null; REVCLOCK = false;
  document.body.classList.remove('playing');
  $('#burst').replaceChildren();
  let r = currentRoute(), node;
  const dm = /^day-(\d{4}-\d{2}-\d{2})$/.exec(r);
  if (dm && dm[1] >= CONFIG.EPOCH && dm[1] <= todayStr()) node = dayView(dm[1], dm[1] !== todayStr()), r = 'archive';
  else if (ROUTES[r]) node = ROUTES[r]();
  else { node = viewHome(); r = 'home'; }
  $('#view').replaceChildren(node);
  const navKey = NAV_OF[r] || r;
  document.querySelectorAll('.nav [data-nav]').forEach(a => { if (a.dataset.nav === navKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
  focusFirst();
}
function focusFirst() {
  const view = $('#view');
  const f = view.querySelector('[data-autofocus]');
  if (f && !f.disabled && f.offsetParent !== null) f.focus({ preventScroll: true }); else view.focus({ preventScroll: true });
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

/* =====================================================================
   VIEWS
   ===================================================================== */
const MODE_CARDS = [
  { href: '#daily', t: 'Daily Dive', d: 'Seven definitions, the same for everyone. Sixty seconds of oxygen per word.', ic: 'dive', c: 'var(--z6)', best: () => liveStreak() ? 'Streak ' + liveStreak() : '' },
  { href: '#endless', t: 'Endless', d: 'Word after word until you choose to surface. No streak at stake.', ic: 'loop', c: 'var(--z5)', best: () => S.modes.endless.best ? 'Best ' + fmtM(S.modes.endless.best) : '' },
  { href: '#speed', t: 'Speed Trench', d: 'Ninety seconds on one clock. How deep can you get?', ic: 'clock', c: 'var(--hot)', best: () => S.modes.speed.best ? 'Best ' + fmtM(S.modes.speed.best) : '' },
  { href: '#reverse', t: 'Reverse Dive', d: 'You get the word. Pick the real definition from four.', ic: 'swap', c: '#ff6bd5', best: () => S.modes.reverse.best ? 'Best ' + fmtM(S.modes.reverse.best) : '' },
  { href: '#party', t: 'Puffer Party', d: 'Pass-and-play for two to six divers on one phone.', ic: 'party', c: 'var(--z1)', best: () => S.modes.party.played ? S.modes.party.played + ' played' : '' },
  { href: '#packs', t: 'Themed packs', d: 'Money, Drunk, Internet, Gym, Workplace and the 2000s.', ic: 'grid', c: 'var(--z2)', best: () => '' },
  { href: '#archive', t: 'Archive', d: 'Replay any past day. Finished ones are marked.', ic: 'cal', c: 'var(--z4)', best: () => '' },
  { href: '#stats', t: 'Stats', d: 'Streaks, win rate, average depth and where your guesses land.', ic: 'bars', c: 'var(--z3)', best: () => '' },
  { href: '#how', t: 'How to play', d: 'Zones, tiers, oxygen and the stingy autocorrect.', ic: 'how', c: 'var(--z0)', best: () => '' },
  { href: '#options', t: 'Options', d: 'Content filter, motion, contrast, sound, reset.', ic: 'opts', c: '#9bb3c6', best: () => '' }
];
function modeCard(m) {
  const b = m.best();
  return h('li', null, h('a', { class: 'mode', href: m.href, style: '--mc:' + m.c },
    h('div', { class: 'ic', html: IC[m.ic], 'aria-hidden': 'true' }), h('h3', null, m.t), h('p', null, m.d), b ? h('span', { class: 'best' }, b) : null));
}
function viewHome() {
  document.title = 'Slanger';
  setSeaDepth(0.36);
  const run = S.runs[todayStr()];
  const done = run && run.done, started = run && !run.done && run.rounds.some(r => r.g.length || r.done);
  const label = done ? 'See today’s result' : started ? 'Carry on: puzzle ' + (run.i + 1) + ' of 7' : 'Dive in';
  const cd = h('p', { class: 'countdown num' });
  if (done) tick(() => { cd.textContent = 'Next daily dive in ' + hms(msToUtcMidnight()); if (msToUtcMidnight() < 1000) route(); });
  const streak = liveStreak();
  return h('div', { class: 'wrap home' },
    h('section', { class: 'hero' },
      h('div', null,
        h('h1', { class: 'title' }, 'Slanger'),
        h('p', { class: 'tag' }, h('span', null, CONFIG.TAGLINE, h('i', { 'aria-hidden': 'true', html: '<svg class="scribble" viewBox="0 0 300 22" preserveAspectRatio="none"><path stroke-width="3.6" d="M3 13c38-6 71-4 109-1s72 2 104-3 52-4 81 0"/><path d="M40 19c46-4 98-3 150-2 33 1 61-1 86-3"/></svg>' }))),
        h('p', { class: 'lede' }, 'Read a slang definition. Guess the word before your oxygen runs out. The closer you get, the deeper you sink. Nail it first time and you’re one in a slanger.'),
        h('div', { class: 'cta' },
          h('a', { class: 'btn primary', href: '#daily', 'data-autofocus': true, html: IC.down }, h('span', null, label)),
          h('span', { class: 'chip num' }, 'Streak ' + streak),
          S.stats.slangers ? h('span', { class: 'chip num' }, S.stats.slangers + ' Slanger' + (S.stats.slangers > 1 ? 's' : '')) : null),
        done ? cd : null),
      h('div', { class: 'heroart', role: 'img', 'aria-label': 'A diver sinking through zones named Gibberish, Small Talk, Buzzword, Jargon, Vernacular and Lingo towards a glowing swarm of letters.', html: heroSVG() })),
    h('h2', { class: 'sect' }, 'Pick your dive'),
    h('ul', { class: 'modes' }, MODE_CARDS.map(modeCard)),
    h('p', { class: 'foot' }, 'Every definition here was written by hand for this game, not lifted from a dictionary. A few are on the cheeky side; you can hide those in ', h('a', { href: '#options' }, 'Options'), '.'));
}
function startScreen(o) {
  return h('div', { class: 'wrap page' },
    h('p', { class: 'kicker' }, o.kicker || 'Mode'),
    h('h1', { tabindex: '-1' }, o.title),
    h('p', { class: 'intro' }, o.intro),
    o.stats ? h('div', { class: 'stats' }, o.stats.map(s => stat(s[1], s[0]))) : null,
    o.extra || null,
    h('div', { class: 'rowbtns' }, h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: o.start }, o.startLabel || 'Start'), h('a', { class: 'btn', href: '#home' }, 'Home')));
}

/* ---------- the shared play engine (Daily, Archive, Endless, Packs, Speed, Party) ---------- */
let P = null;   // { s: session, o: options }
let UI = {};
function mountPlay(s, o) {
  stopClock();
  P = { s, o };
  document.body.classList.add('playing');
  document.title = o.title() + ' · Slanger';
  UI = { lastZone: 0 };
  UI.title = h('h1');
  UI.tot = h('div', { class: 'tot num' });
  const bar = h('header', { class: 'bar' },
    h('a', { class: 'back', href: o.back || '#home', 'aria-label': 'Back', html: IC.back }), UI.title,
    o.endBtn ? h('button', { class: 'btn', type: 'button', onclick: o.endBtn.fn }, o.endBtn.label) : null, UI.tot);
  UI.scale = h('div', { class: 'scale' });
  UI.fill = h('div', { class: 'fill' });
  UI.scale.append(UI.fill);
  CONFIG.ZONES.forEach((z, k) => {
    const top = k === 6 ? 0.94 : z.min / 100 * 0.94, bot = k === 6 ? 1 : (z.max + 1) / 100 * 0.94;
    UI.scale.append(h('div', { class: 'seg z' + k, style: 'top:' + (top * 100) + '%;height:' + ((bot - top) * 100) + '%' }, h('b', null, z.name), h('span', { class: 'num' }, fmtM(z.d0))));
  });
  UI.ticks = h('div');
  UI.diver = h('div', { class: 'diver', html: SVG.diver });
  UI.scale.append(UI.ticks, UI.diver);
  UI.gauge = h('aside', { class: 'gauge', role: 'img', 'aria-label': 'Depth gauge' }, UI.scale);
  UI.card = h('article', { class: 'card panel' });
  UI.oxyBar = h('i'); UI.oxyT = h('span', { class: 't num' });
  UI.oxy = h('div', { class: 'oxy', role: 'timer', 'aria-label': o.timer === 'global' ? 'Trench clock' : 'Oxygen for this word' },
    h('b', null, o.timer === 'global' ? 'CLOCK' : 'O₂'), h('div', { class: 'trk' }, UI.oxyBar), UI.oxyT);
  UI.oxy.hidden = !o.timer;
  UI.pips = h('div', { class: 'air', 'aria-hidden': 'true' });
  UI.airlab = h('span', { class: 'airlab num' });
  UI.airrow = h('div', { class: 'airrow' }, UI.pips, UI.airlab);
  UI.input = h('input', { type: 'text', id: 'guess', name: 'guess', maxlength: '40', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'Your guess', 'aria-label': 'Your guess', 'data-autofocus': true });
  UI.dive = h('button', { class: 'btn primary', type: 'submit' }, 'Dive');
  UI.form = h('form', { class: 'guess', onsubmit: onSubmit }, UI.input, UI.dive);
  UI.skip = o.skip ? h('button', { class: 'btn small skipbtn', type: 'button', onclick: onSkip }, 'Skip word') : null;
  UI.msg = h('p', { class: 'msgline', role: 'status' });
  UI.result = h('div', { class: 'result' });
  UI.hints = o.hints ? h('div', { class: 'hints', role: 'group', 'aria-label': 'Hints, each costs depth' }) : null;
  UI.log = h('ol', { class: 'log', 'aria-label': 'Your guesses, deepest first' });
  UI.loghead = h('div', { class: 'loghead' }, h('h2', null, 'Dive log'), h('span', { class: 'airlab' }, 'deepest first'));
  UI.play = h('div', { class: 'col' }, UI.card, UI.oxy, UI.airrow, UI.form, UI.skip, UI.msg, UI.result, UI.hints, UI.loghead, UI.log);
  const root = h('div', null, bar, h('div', { class: 'play' }, UI.gauge, UI.play));
  renderPuzzle(false);
  return root;
}
function cur() { const s = P.s; return { s, o: P.o, r: s.rounds[s.i], p: byId(s.ids[s.i]) }; }
function frac(score) { return score >= 100 ? 0.97 : Math.max(0, score) / 100 * 0.94; }
function updateTotal() { const o = P.o; UI.tot.replaceChildren(fmtM(o.total()), h('small', null, o.totalLabel ? o.totalLabel() : 'total')); }
function renderPuzzle(animate) {
  const { s, o, r, p } = cur();
  UI.title.replaceChildren(o.title(), h('small', null, o.sub()));
  updateTotal();
  const gated = !!o.gate && !r.started && !r.done;
  const active = !r.done && !gated;
  if (r.done && !o.autoNext) showReveal(false);
  else if (gated) UI.card.replaceChildren(...gateCard(o.gate(s.i)));
  else UI.card.replaceChildren(...questionCard(p, r));
  if (animate && motionOK()) { UI.card.classList.remove('slide', 'in'); void UI.card.offsetWidth; UI.card.classList.add('slide'); }
  [UI.form, UI.airrow, UI.hints, UI.skip].forEach(el => { if (el) el.hidden = !active; });
  UI.oxy.hidden = !o.timer || gated || (o.timer === 'word' && r.done);
  UI.input.disabled = UI.dive.disabled = !active;
  UI.msg.textContent = '';
  UI.lastZone = zoneIndexFor(r.best);
  renderAir(r); if (UI.hints) renderHints(r, p); renderLog(r); renderGauge(r, !animate);
  const last = r.g[r.g.length - 1];
  if (last && active) showResult(last); else UI.result.classList.remove('show');
  if (o.timer) drawOxy(o.timer === 'global' ? s.tl : r.tl);
  if (active && o.timer) startClock();
  if (animate) { const f = gated ? UI.card.querySelector('button') : UI.input; if (f) f.focus({ preventScroll: true }); }
}
function gateCard(name) {
  const { r } = cur();
  return [h('div', { class: 'gate' },
    h('p', { class: 'kicker' }, 'Pass the phone to'),
    h('h2', { class: 'who' }, name),
    h('p', null, 'Everyone else, look away. Your sixty seconds of oxygen start when you tap.'),
    h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => { r.started = true; save(); sound('dive'); renderPuzzle(true); } }, 'I’m ' + name + ' — dive'))];
}
function questionCard(p, r) {
  const peek = r.h.includes('peek');
  const parts = p.example.split('___');
  const ex = h('p', { class: 'ex' });
  parts.forEach((part, i) => {
    ex.append(part);
    if (i < parts.length - 1) ex.append(h('span', { class: 'mask', 'aria-label': peek ? 'partly hidden word ' + peekPattern(p.term).split('').join(' ') : 'hidden word' }, peek ? peekPattern(p.term) : '▇▇▇▇▇'));
  });
  const chips = r.h.filter(k => k !== 'peek').map(k => h('span', { class: 'chip' }, hintText(k, p)));
  return [h('p', { class: 'kicker' }, 'Definition'), h('p', { class: 'def' }, p.definition), ex, chips.length ? h('div', { class: 'hintout' }, chips) : null].filter(Boolean);
}
function renderAir(r) {
  const left = CONFIG.MAX_GUESSES - r.g.length;
  UI.pips.replaceChildren(...Array.from({ length: CONFIG.MAX_GUESSES }, (_, i) => h('span', { class: 'pip' + (i >= left ? ' used' : '') })));
  UI.airlab.textContent = left + ' of ' + CONFIG.MAX_GUESSES + ' guesses left';
}
function renderHints(r, p) {
  UI.hints.replaceChildren(...CONFIG.HINTS.map(hd => {
    const taken = r.h.includes(hd.key);
    return h('button', { type: 'button', class: 'hint', 'aria-pressed': taken ? 'true' : 'false', disabled: taken || r.done ? true : null, onclick: () => takeHint(hd.key) },
      h('b', null, taken ? hd.label + ' used' : hd.label), h('span', { class: 'num' }, '−' + fmtM(hd.cost)));
  }));
}
function renderLog(r) {
  const sorted = r.g.map((g, i) => Object.assign({ n: i + 1 }, g)).sort((a, b) => b.s - a.s || a.n - b.n);
  UI.log.replaceChildren(...sorted.map(g => h('li', { class: 'z' + g.z },
    h('span', { class: 'w' }, g.c ? [h('s', { 'aria-label': 'typed ' + g.t }, g.t), g.c] : g.t),
    h('span', { class: 'd num' }, fmtM(g.d)),
    h('span', { class: 'sub' }, h('span', { class: 'zc z' + g.z }, CONFIG.ZONES[g.z].name),
      g.cue === 'first' ? h('span', null, 'first dive') : h('span', { class: 'cue' + (g.cue === 'deeper' ? ' deeper' : '') }, g.cue), h('span', null, '· guess ' + g.n)))));
  UI.loghead.hidden = !r.g.length;
}
function renderGauge(r, instant) {
  const f = frac(r.best);
  UI.diver.style.top = (f * 100) + '%';
  UI.fill.style.height = (f * 100) + '%';
  UI.ticks.replaceChildren(...r.g.map(g => h('span', { class: 'tick z' + g.z, style: 'top:' + (frac(g.s) * 100) + '%' })));
  UI.gauge.setAttribute('aria-label', 'Depth gauge: ' + (r.g.length ? fmtM(r.bestDepth) + ', ' + CONFIG.ZONES[zoneIndexFor(r.best)].name : 'at the surface'));
  setSeaDepth(f, instant);
}
function showResult(g) {
  UI.result.className = 'result z' + g.z;
  UI.result.replaceChildren(
    h('div', { class: 'top' }, h('span', { class: 'm num' }, fmtM(g.d)), h('span', { class: 'zc z' + g.z }, CONFIG.ZONES[g.z].name),
      g.cue === 'first' ? null : h('span', { class: 'cue' + (g.cue === 'deeper' ? ' deeper' : '') }, g.cue)),
    h('p', null, '“' + (g.c || g.t) + '” — ' + g.l));
  void UI.result.offsetWidth; UI.result.classList.add('show');
}

/* ---------- oxygen clock ---------- */
const CLOCK = { id: 0, deadline: 0, last: -1 };
function clockTL() { const { s, o, r } = cur(); return o.timer === 'global' ? s.tl : r.tl; }
function setClockTL(v) { const { s, o, r } = cur(); if (o.timer === 'global') s.tl = v; else r.tl = v; }
function startClock() {
  stopClock(false);
  if (!P || !P.o.timer) return;
  const tl = clockTL();
  CLOCK.deadline = performance.now() + tl; CLOCK.last = Math.ceil(tl / 1000);
  CLOCK.id = setInterval(clockTick, 100);
}
function stopClock(doSave) { if (CLOCK.id) { clearInterval(CLOCK.id); CLOCK.id = 0; if (doSave !== false) save(); } }
function clockTick() {
  if (!P) return stopClock();
  const left = Math.max(0, CLOCK.deadline - performance.now());
  setClockTL(left); drawOxy(left);
  const sec = Math.ceil(left / 1000);
  if (sec !== CLOCK.last) {
    CLOCK.last = sec;
    if (sec <= 10 && sec > 0) sound('tick', sec);
    if (sec === 10) announce('Ten seconds of oxygen left.');
    if (sec % 2 === 0) save();
  }
  if (left <= 0) { stopClock(); timeUp(); }
}
function drawOxy(left) {
  if (!UI.oxy || left == null) return;
  const total = P.o.timer === 'global' ? CONFIG.SPEED_MS : CONFIG.WORD_MS;
  UI.oxyBar.style.transform = 'scaleX(' + Math.max(0, left / total).toFixed(4) + ')';
  UI.oxyT.textContent = mss(left);
  UI.oxy.classList.toggle('low', left <= 10000 && left > 0);
}
function timeUp() {
  const { o, r, p } = cur();
  if (o.timer === 'global') { o.onTimeUp(); return; }
  if (r.done) return;
  endRound(r, 'time');
  sound('timeout');
  announce('Out of oxygen. The word was ' + p.term + '.');
  afterRound(r);
}
function endRound(r, out) {
  r.out = out;
  Object.assign(r, roundFinal(r, P.o.plain));
  r.done = true;
  recordRound(r);
  save();
}
function afterRound(r) {
  const { s, o, p } = cur();
  UI.input.disabled = UI.dive.disabled = true;
  if (o.timer === 'word') stopClock();
  if (o.autoNext) {
    if (!r.solved) toast('It was “' + p.term + '”');
    const i = s.i;
    setTimeout(() => { if (P && P.s === s && s.i === i && !s.done) o.onNext(); }, r.solved ? 1150 : 900);
    return;
  }
  const delay = !motionOK() ? 0 : r.solved && !r.ac ? 1650 : 900;
  setTimeout(() => { if (P && P.s === s && s.rounds[s.i] === r) showReveal(true); }, delay);
}
let busy = false;
function onSubmit(ev) {
  ev.preventDefault();
  if (busy || !P) return;
  const { r, p, o } = cur();
  if (r.done) return;
  const t = UI.input.value.trim();
  UI.msg.classList.remove('warn');
  if (!t) { UI.msg.textContent = 'Type a guess first. You can’t dive on an empty word.'; return; }
  if (isBlocked(t)) { UI.msg.classList.add('warn'); UI.msg.textContent = 'Not that one. It doesn’t count and costs you nothing.'; announce('Guess not accepted.'); UI.input.select(); return; }
  const res = scoreGuess(t, p);
  const n = norm(t), nc = res.corrected ? norm(res.corrected) : null;
  if (r.g.some(x => norm(x.t) === n || (x.c && norm(x.c) === n) || (nc && (norm(x.t) === nc || (x.c && norm(x.c) === nc))))) { UI.msg.textContent = 'Already tried that. Oxygen is precious.'; UI.input.select(); return; }
  const commit = () => {
    busy = false;
    if (!P || P.s.rounds[P.s.i] !== r || r.done) return;
    const prev = r.best, first = r.g.length === 0;
    const g = { t, c: res.corrected, s: res.score, d: res.depth, z: res.zoneIndex, l: res.label, cue: first ? 'first' : (res.score > prev ? 'deeper' : 'no deeper') };
    r.g.push(g);
    const deeper = res.score > r.best;
    if (deeper) { r.best = res.score; r.bestDepth = res.depth; }
    if (res.solved) { r.solved = true; r.ac = !!res.corrected; r.slanger = res.exact && r.g.length === 1 && r.h.length === 0 && !o.plain; }
    const finished = r.solved || r.g.length >= CONFIG.MAX_GUESSES;
    if (finished) endRound(r, r.solved ? 'solved' : 'air'); else save();
    UI.input.value = ''; UI.input.classList.remove('ac');
    announce((g.c || g.t) + '. ' + g.d.toLocaleString('en-GB') + ' metres. ' + CONFIG.ZONES[g.z].name + '.' + (g.cue === 'deeper' ? ' Deeper.' : g.cue === 'no deeper' ? ' No deeper.' : ''));
    // the show
    if (res.score === 100) { wordBurst(p.term, 6, r.slanger ? 'slanger' : 'exact'); sound(r.slanger ? 'slanger' : 'exact'); }
    else if (res.solved) { wordBurst(res.corrected, res.zoneIndex, 'close', 'Autocorrected · ' + fmtM(res.depth)); sound('ding', res.score); }
    else if (res.score >= 70) { wordBurst(g.c || g.t, res.zoneIndex, 'close'); sound('ding', res.score); }
    else if (res.score >= 50) { FX.burst(innerWidth / 2, innerHeight * 0.45, zoneColor(res.zoneIndex), 26, null); sound('dive', res.score); }
    else sound('dive', res.score);
    if (deeper && motionOK()) { UI.diver.classList.remove('sinking'); void UI.diver.offsetWidth; UI.diver.classList.add('sinking'); }
    renderAir(r); renderLog(r); renderGauge(r, false); showResult(g); updateTotal();
    if (finished) afterRound(r); else UI.input.focus({ preventScroll: true });
  };
  if (res.corrected && motionOK()) { busy = true; UI.input.value = res.corrected; UI.input.classList.add('ac'); setTimeout(commit, 600); }
  else commit();
}
function onSkip() {
  const { r } = cur();
  if (r.done || busy) return;
  endRound(r, 'skip');
  afterRound(r);
}
function takeHint(key) {
  const { r, p } = cur();
  if (r.done || r.h.includes(key)) return;
  r.h.push(key); save();
  UI.card.replaceChildren(...questionCard(p, r));
  renderHints(r, p);
  const hd = CONFIG.HINTS.find(x => x.key === key);
  announce(hd.label + ' hint: ' + hintText(key, p) + '. Costs ' + hd.cost + ' metres.');
  UI.input.focus({ preventScroll: true });
}
function showReveal(animate) {
  const { s, o, r, p } = cur();
  [UI.form, UI.hints, UI.airrow, UI.skip].forEach(el => { if (el) el.hidden = true; });
  UI.oxy.hidden = true;
  UI.result.classList.remove('show');
  const z = zoneIndexFor(r.best);
  const parts = p.example.split('___');
  const ex = h('p', { class: 'ex' });
  parts.forEach((part, i) => { ex.append(part); if (i < parts.length - 1) ex.append(h('mark', null, p.term.toLowerCase())); });
  const score = h('b', { class: 'num' }, fmtM(animate ? 0 : r.final));
  const next = h('button', { class: 'btn primary next', type: 'button', onclick: () => { sound('dive'); o.onNext(); } }, o.nextLabel());
  const badge = r.slanger ? h('div', { class: 'stamp', role: 'img', 'aria-label': 'Stamped: one in a slanger' }, 'One in a slanger', h('small', { 'aria-hidden': 'true' }, 'First guess. No hints.'))
    : r.ac ? h('div', { class: 'badge ac' }, 'Autocorrected. Solved, but typos don’t reach the bottom.')
    : r.solved ? h('div', { class: 'stamp solved', role: 'img', 'aria-label': 'Stamped: found in ' + r.g.length + ' guesses' }, 'Found it', h('small', { 'aria-hidden': 'true' }, 'in ' + r.g.length + ' guesses'))
    : r.out === 'time' ? h('div', { class: 'badge out' }, 'Out of oxygen')
    : h('div', { class: 'badge out' }, 'Out of guesses');
  const content = h('div', { class: 'reveal' },
    h('p', { class: 'kicker' }, 'The word was'),
    h('h2', { class: 'term' }, p.term),
    h('p', { class: 'pos' }, p.pos),
    h('p', { class: 'def' }, p.definition), ex, badge,
    h('dl', { class: 'tally' },
      h('dt', null, 'Deepest'), h('dd', { class: 'num' }, fmtM(r.bestDepth) + ' · ' + CONFIG.ZONES[z].name),
      r.pen ? [h('dt', null, 'Hints (' + r.h.length + ')'), h('dd', { class: 'num' }, '−' + fmtM(r.pen))] : null,
      r.bonus ? [h('dt', null, 'Spare guesses'), h('dd', { class: 'num' }, '+' + fmtM(r.bonus))] : null,
      r.tb ? [h('dt', null, 'Oxygen left'), h('dd', { class: 'num' }, '+' + fmtM(r.tb))] : null,
      r.h.length && r.final >= CONFIG.HINT_CAP ? [h('dt', null, 'Hint cap'), h('dd', null, 'max ' + fmtM(CONFIG.HINT_CAP))] : null),
    h('div', { class: 'scoreline' }, h('span', null, 'Puzzle score'), score),
    next);
  const swap = () => {
    UI.card.replaceChildren(content);
    UI.card.classList.remove('out', 'slide');
    fitText(content.querySelector('.term'));
    if (animate && motionOK()) { UI.card.classList.remove('in'); void UI.card.offsetWidth; UI.card.classList.add('in'); }
    if (animate) { countUp(score, r.final, 1100); drift(z); }
    updateTotal();
    next.focus({ preventScroll: true });
    UI.card.scrollIntoView({ block: 'nearest', behavior: motionOK() ? 'smooth' : 'auto' });
  };
  if (animate) announce('The word was ' + p.term + '. ' + (r.slanger ? 'One in a Slanger! ' : '') + 'Puzzle score ' + r.final.toLocaleString('en-GB') + ' metres.');
  if (animate && motionOK()) { UI.card.classList.add('out'); setTimeout(swap, 300); } else swap();
}

/* ---------- Daily + Archive ---------- */
function viewDaily() { return dayView(todayStr(), false); }
function dayView(date, archive) {
  const run = getDayRun(date);
  if (run.done) return viewDaySummary(run, archive);
  return mountPlay(run, {
    title: () => (archive ? 'Archive #' : 'Daily Dive #') + run.no,
    sub: () => 'Puzzle ' + (run.i + 1) + ' of 7',
    back: archive ? '#archive' : '#home', timer: 'word', hints: true,
    total: () => sumFinals(run),
    nextLabel: () => run.i >= run.ids.length - 1 ? 'Surface and see your dive' : 'Next puzzle',
    onNext: () => {
      if (run.i >= run.ids.length - 1) { completeRun(run); sound('surface'); route(); return; }
      run.i++; save(); renderPuzzle(true); window.scrollTo(0, 0);
    }
  });
}
function viewDaySummary(run, archive) {
  document.title = (archive ? 'Archive #' : 'Dive #') + run.no + ' result · Slanger';
  const deepest = run.rounds.reduce((b, r, i) => r.bestDepth > b.d ? { d: r.bestDepth, i } : b, { d: -1, i: 0 });
  setSeaDepth(Math.min(0.97, frac(run.rounds[deepest.i].best)));
  const guesses = run.rounds.reduce((s, r) => s + r.g.length, 0);
  const hints = run.rounds.reduce((s, r) => s + r.h.length, 0);
  const solved = run.rounds.filter(r => r.solved).length;
  const text = shareText(run);
  const cd = archive ? null : h('p', { class: 'countdown num' });
  if (cd) tick(() => { cd.textContent = 'Next daily dive in ' + hms(msToUtcMidnight()) + ' (midnight UTC)'; if (msToUtcMidnight() < 1000) route(); });
  const dp = byId(run.ids[deepest.i]);
  return resultsView({
    kicker: (archive ? 'Archive #' : 'Daily Dive #') + run.no + ' · surfaced',
    total: run.total, back: archive ? '#archive' : '#home', backLabel: archive ? 'Archive' : 'Home',
    lede: solved + ' of 7 words found. ' + (run.rounds.some(r => r.slanger) ? 'You were one in a slanger at least once.' : 'No first-guess Slangers this time.'),
    stats: [[fmtM(deepest.d), 'deepest · ' + dp.term], [guesses + ' / 42', 'guesses used'], [String(hints), hints === 1 ? 'hint taken' : 'hints taken'], archive ? [String(run.rounds.filter(r => r.out === 'time').length), 'ran out of oxygen'] : [String(liveStreak()), 'day streak · best ' + S.streak.max]],
    share: text, after: cd,
    listTitle: archive ? 'That day’s seven' : 'Today’s seven',
    items: run.rounds.map((r, i) => ({ id: run.ids[i], r }))
  });
}
function viewArchive() {
  document.title = 'Archive · Slanger';
  setSeaDepth(0.5);
  const t = todayStr(), days = [];
  for (let d = t; d >= CONFIG.EPOCH; d = shiftDay(d, -1)) days.push(d);
  const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return h('div', { class: 'wrap page' },
    h('p', { class: 'kicker' }, 'Archive'),
    h('h1', { tabindex: '-1', 'data-autofocus': true }, 'Every dive so far'),
    h('p', { class: 'intro' }, 'Replay any past day with the same seven words everyone got. Archive dives don’t touch your streak.'),
    h('ol', { class: 'days' }, days.map(d => {
      const run = S.runs[d], isToday = d === t;
      const st = run && run.done ? fmtM(run.total) : run && run.rounds.some(r => r.g.length) ? 'In progress' : 'Not played';
      return h('li', null, h('a', { class: 'panel', href: isToday ? '#daily' : '#day-' + d },
        h('b', null, '#' + diveNumber(d) + ' · ' + (isToday ? 'Today' : fmt(d))),
        h('span', { class: 'st num', style: run && run.done ? 'color:var(--acc)' : '' }, st),
        h('span', null, run && run.done ? run.rounds.filter(r => r.solved).length + ' of 7 found' + (run.rounds.some(r => r.slanger) ? ' · Slanger' : '') : isToday ? 'Today’s daily dive' : 'Tap to dive')));
    })));
}

/* ---------- Endless ---------- */
function viewEndless() {
  const M = S.modes.endless;
  if (M.run && !M.run.done) return playEndless(M.run);
  document.title = 'Endless · Slanger';
  setSeaDepth(0.5);
  return startScreen({
    kicker: 'Endless', title: 'Keep sinking', intro: 'One word after another, sixty seconds of oxygen each, until you choose to surface. Words get harder the deeper you go. Your run keeps everything you bank.',
    stats: [['best run', M.best ? fmtM(M.best) : '—'], ['runs', String(M.played)], ['words dived', String(M.words)]],
    start: () => { M.run = { kind: 'endless', ids: [pickRandom(new Set(), 1).id], i: 0, rounds: [newRound()], done: false }; save(); route(); }
  });
}
function playEndless(run) {
  return mountPlay(run, {
    title: () => 'Endless', sub: () => 'Word ' + (run.i + 1) + ' · surface any time', back: '#home', timer: 'word', hints: true,
    total: () => sumFinals(run), endBtn: { label: 'Surface', fn: endEndless }, nextLabel: () => 'Next word',
    onNext: () => {
      const used = new Set(run.ids.slice(-50));
      run.ids.push(pickRandom(used, Math.min(5, 1 + Math.floor((run.i + 1) / 3))).id);
      run.rounds.push(newRound()); run.i++; save(); renderPuzzle(true); window.scrollTo(0, 0);
    }
  });
}
function endEndless() {
  const M = S.modes.endless, run = M.run;
  if (!run) return;
  stopClock();
  const items = run.rounds.map((r, i) => ({ id: run.ids[i], r })).filter(x => x.r.done);
  const total = items.reduce((a, x) => a + x.r.final, 0);
  const newBest = total > M.best;
  M.played++; M.words += items.length; M.best = Math.max(M.best, total);
  M.run = null; save();
  showResults({ kicker: 'Endless · surfaced', total, newBest, back: '#endless', backLabel: 'Endless',
    lede: items.length + (items.length === 1 ? ' word' : ' words') + ' dived. ' + (newBest ? 'New best run.' : 'Best run: ' + fmtM(M.best) + '.'),
    share: CONFIG.NAME + ' Endless · ' + fmtM(total) + ' over ' + items.length + ' words\n' + CONFIG.SHARE_URL,
    items, again: () => { M.run = { kind: 'endless', ids: [pickRandom(new Set(), 1).id], i: 0, rounds: [newRound()], done: false }; save(); go('#endless'); } });
}

/* ---------- Themed packs ---------- */
function viewPacks() {
  document.title = 'Themed packs · Slanger';
  setSeaDepth(0.45);
  const M = S.modes.packs, act = M.run && !M.run.done ? CONFIG.PACKS.find(x => x.key === M.run.pack) : null;
  const colors = ['var(--z1)', 'var(--z2)', 'var(--z5)', 'var(--z3)', 'var(--z4)', '#ff6bd5'];
  return h('div', { class: 'wrap page' },
    h('p', { class: 'kicker' }, 'Themed packs'),
    h('h1', { tabindex: '-1' }, 'Pick a pack'),
    h('p', { class: 'intro' }, 'Up to ' + CONFIG.PACK_SIZE + ' words from one corner of slang, in a fresh order every time.'),
    act ? h('div', { class: 'rowbtns' }, h('a', { class: 'btn primary', href: '#pack-play', 'data-autofocus': true }, 'Resume the ' + act.name + ' pack')) : null,
    h('ul', { class: 'packs' }, CONFIG.PACKS.map((pk, i) => {
      const n = Math.min(CONFIG.PACK_SIZE, packPuzzles(pk.key).length), best = M.best[pk.key];
      return h('li', null, h('button', { class: 'mode', type: 'button', style: '--mc:' + colors[i], 'data-autofocus': !act && i === 0 ? true : null, onclick: () => startPack(pk.key) },
        h('div', { class: 'ic', html: IC.grid, 'aria-hidden': 'true' }), h('h3', null, pk.name), h('p', null, pk.blurb + ' ' + n + ' words.'),
        h('span', { class: 'best' }, best ? 'Best ' + fmtM(best) : 'Not played yet')));
    })));
}
function startPack(key) {
  const ids = shuffle(packPuzzles(key)).slice(0, CONFIG.PACK_SIZE).sort((a, b) => a.difficulty - b.difficulty).map(p => p.id);
  S.modes.packs.run = { kind: 'pack', pack: key, ids, i: 0, rounds: ids.map(newRound), done: false };
  save(); go('#pack-play');
}
function viewPackPlay() {
  const run = S.modes.packs.run;
  if (!run || run.done) return viewPacks();
  const pk = CONFIG.PACKS.find(x => x.key === run.pack);
  return mountPlay(run, {
    title: () => pk.name + ' pack', sub: () => 'Word ' + (run.i + 1) + ' of ' + run.ids.length, back: '#packs', timer: 'word', hints: true,
    total: () => sumFinals(run), nextLabel: () => run.i >= run.ids.length - 1 ? 'Finish the pack' : 'Next word',
    onNext: () => {
      if (run.i < run.ids.length - 1) { run.i++; save(); renderPuzzle(true); window.scrollTo(0, 0); return; }
      const M = S.modes.packs, total = sumFinals(run), newBest = total > (M.best[pk.key] || 0);
      M.best[pk.key] = Math.max(M.best[pk.key] || 0, total); M.played[pk.key] = (M.played[pk.key] || 0) + 1; M.run = null; save();
      showResults({ kicker: pk.name + ' pack · surfaced', total, newBest, back: '#packs', backLabel: 'Packs',
        lede: run.rounds.filter(r => r.solved).length + ' of ' + run.ids.length + ' found. ' + (newBest ? 'New best for this pack.' : 'Pack best: ' + fmtM(M.best[pk.key]) + '.'),
        share: CONFIG.NAME + ' · ' + pk.name + ' pack · ' + fmtM(total) + '\n' + CONFIG.SHARE_URL,
        items: run.rounds.map((r, i) => ({ id: run.ids[i], r })), again: () => startPack(pk.key) });
    }
  });
}

/* ---------- Speed Trench ---------- */
function viewSpeed() {
  const M = S.modes.speed;
  if (M.run && !M.run.done) return playSpeed(M.run);
  document.title = 'Speed Trench · Slanger';
  setSeaDepth(0.6);
  return startScreen({
    kicker: 'Speed Trench', title: 'Ninety seconds', intro: 'One clock for the whole dive. Each word banks the deepest guess you make on it. No hints, no bonuses — solve it or skip it and keep sinking.',
    stats: [['best', M.best ? fmtM(M.best) : '—'], ['dives', String(M.played)]], startLabel: 'Start the clock',
    start: () => { M.run = { kind: 'speed', ids: [pickRandom(new Set(), 1).id], i: 0, rounds: [newRound()], tl: CONFIG.SPEED_MS, done: false }; save(); route(); }
  });
}
function speedTotal(run) { return run.rounds.reduce((a, r) => a + (r.done ? r.final : r.bestDepth), 0); }
function playSpeed(run) {
  if (run.rounds[run.i].done && run.tl > 0) { run.ids.push(pickRandom(new Set(run.ids), Math.min(5, 1 + Math.floor((run.i + 1) / 2))).id); run.rounds.push(newRound()); run.i++; save(); }
  return mountPlay(run, {
    title: () => 'Speed Trench', sub: () => 'Word ' + (run.i + 1), back: '#speed', timer: 'global', hints: false, skip: true, plain: true, autoNext: true,
    total: () => speedTotal(run),
    nextLabel: () => 'Next word',
    onNext: () => {
      if (run.done) return;
      const used = new Set(run.ids);
      run.ids.push(pickRandom(used, Math.min(5, 1 + Math.floor((run.i + 1) / 2))).id);
      run.rounds.push(newRound()); run.i++; save(); renderPuzzle(true);
    },
    onTimeUp: () => finishSpeed(run)
  });
}
function finishSpeed(run) {
  if (run.done) return;
  const r = run.rounds[run.i];
  if (!r.done) endRound(r, 'time');
  run.done = true; run.tl = 0;
  const M = S.modes.speed, total = speedTotal(run), newBest = total > M.best;
  M.best = Math.max(M.best, total); M.played++; M.run = null; save();
  sound('surface');
  const items = run.rounds.map((x, i) => ({ id: run.ids[i], r: x })).filter(x => x.r.g.length || x.r.solved);
  showResults({ kicker: 'Speed Trench · time', total, newBest, back: '#speed', backLabel: 'Speed Trench',
    lede: run.rounds.filter(x => x.solved).length + ' solved in 90 seconds. ' + (newBest ? 'New best.' : 'Best: ' + fmtM(M.best) + '.'),
    share: CONFIG.NAME + ' Speed Trench · ' + fmtM(total) + ' in 90s · ' + run.rounds.filter(x => x.solved).length + ' solved\n' + CONFIG.SHARE_URL,
    items, again: () => { M.run = { kind: 'speed', ids: [pickRandom(new Set(), 1).id], i: 0, rounds: [newRound()], tl: CONFIG.SPEED_MS, done: false }; save(); go('#speed'); } });
}

/* ---------- Reverse Dive ---------- */
let REV = null, REVCLOCK = false;
function viewReverse() {
  if (REV && !REV.done) return revPlay();
  const M = S.modes.reverse;
  document.title = 'Reverse Dive · Slanger';
  setSeaDepth(0.4);
  return startScreen({
    kicker: 'Reverse Dive', title: 'Flip it', intro: 'You get the word. Pick its real definition from four. Sixty seconds per word — the faster you’re right, the deeper you go.',
    stats: [['best', M.best ? fmtM(M.best) : '—'], ['dives', String(M.played)]],
    start: () => {
      const all = pool(), qs = shuffle(all).slice(0, CONFIG.REVERSE_QS).map(p => {
        const others = shuffle(all.filter(x => x.id !== p.id && x.term.toLowerCase() !== p.term.toLowerCase())).slice(0, 3);
        return { id: p.id, opts: shuffle([p].concat(others)).map(x => x.id), pick: null, pts: 0, tl: CONFIG.WORD_MS };
      });
      REV = { qs, i: 0, total: 0, done: false }; route();
    }
  });
}
function revPlay() {
  document.body.classList.add('playing');
  const q = REV.qs[REV.i], p = byId(q.id);
  document.title = 'Reverse Dive · Slanger';
  setSeaDepth(Math.min(0.95, REV.i / CONFIG.REVERSE_QS * 0.95));
  const tot = h('div', { class: 'tot num' }, fmtM(REV.total), h('small', null, 'total'));
  const oxyBar = h('i'), oxyT = h('span', { class: 't num' });
  const oxy = h('div', { class: 'oxy', role: 'timer', 'aria-label': 'Oxygen for this word' }, h('b', null, 'O₂'), h('div', { class: 'trk' }, oxyBar), oxyT);
  const msg = h('p', { class: 'msgline', role: 'status' });
  const next = h('button', { class: 'btn primary next', type: 'button', hidden: true, onclick: () => { REV.i++; if (REV.i >= REV.qs.length) finishReverse(); else route(); } }, REV.i >= REV.qs.length - 1 ? 'See your dive' : 'Next word');
  const btns = q.opts.map(id => h('button', { type: 'button', 'data-id': id, onclick: () => answer(id) }, byId(id).definition));
  const draw = left => { oxyBar.style.transform = 'scaleX(' + (left / CONFIG.WORD_MS).toFixed(4) + ')'; oxyT.textContent = mss(left); oxy.classList.toggle('low', left <= 10000 && left > 0); };
  let deadline = performance.now() + q.tl, last = -1, id = 0;
  const stop = () => { if (id) { clearInterval(id); id = 0; } };
  const answer = pick => {
    if (q.pick !== null) return;
    stop(); q.pick = pick || '';
    const right = pick === q.id;
    q.pts = right ? 1000 + Math.round(q.tl / 60) : 0;
    REV.total += q.pts;
    btns.forEach(b => { b.disabled = true; if (b.dataset.id === q.id) b.classList.add('right'); else if (b.dataset.id === pick) b.classList.add('wrong'); });
    tot.replaceChildren(fmtM(REV.total), h('small', null, 'total'));
    if (right) { wordBurst(p.term, 6, 'exact', 'Correct · +' + fmtM(q.pts)); sound('exact'); setSeaDepth(Math.min(0.95, (REV.i + 1) / CONFIG.REVERSE_QS * 0.95)); }
    else { sound(pick ? 'wrong' : 'timeout'); }
    msg.textContent = right ? 'Correct. +' + fmtM(q.pts) + '.' : (pick ? 'Not that one.' : 'Out of oxygen.') + ' The real one is highlighted.';
    announce(msg.textContent);
    next.hidden = false; next.focus({ preventScroll: true });
  };
  if (q.pick === null) {
    draw(q.tl);
    id = setInterval(() => {
      if (!document.body.contains(oxy)) return stop();
      q.tl = Math.max(0, deadline - performance.now()); draw(q.tl);
      const sec = Math.ceil(q.tl / 1000);
      if (sec !== last) { last = sec; if (sec <= 10 && sec > 0) sound('tick', sec); }
      if (q.tl <= 0) answer(null);
    }, 100);
    TIMERS.push(id);
  } else {
    draw(q.tl);
    setTimeout(() => { btns.forEach(b => { b.disabled = true; if (b.dataset.id === q.id) b.classList.add('right'); else if (b.dataset.id === q.pick) b.classList.add('wrong'); }); next.hidden = false; });
  }
  return h('div', null,
    h('header', { class: 'bar' }, h('a', { class: 'back', href: '#home', 'aria-label': 'Back', html: IC.back }),
      h('h1', null, 'Reverse Dive', h('small', null, 'Word ' + (REV.i + 1) + ' of ' + REV.qs.length)), tot),
    h('div', { class: 'wrap', style: 'padding-top:16px;max-width:720px' },
      h('article', { class: 'card panel slide' }, h('p', { class: 'kicker' }, 'Which one means'), h('h2', { class: 'bigterm' }, p.term), h('p', { class: 'reveal pos', style: 'margin:0;color:var(--mute);font-style:italic' }, p.pos)),
      h('div', { style: 'margin-top:12px' }, oxy),
      h('div', { class: 'rq', role: 'group', 'aria-label': 'Possible definitions' }, btns), msg, next));
}
function finishReverse() {
  REV.done = true;
  const M = S.modes.reverse, newBest = REV.total > M.best;
  M.best = Math.max(M.best, REV.total); M.played++; save();
  const right = REV.qs.filter(q => q.pick === q.id).length;
  sound('surface');
  showResults({ kicker: 'Reverse Dive · surfaced', total: REV.total, newBest, back: '#reverse', backLabel: 'Reverse Dive',
    lede: right + ' of ' + REV.qs.length + ' right. ' + (newBest ? 'New best.' : 'Best: ' + fmtM(M.best) + '.'),
    share: CONFIG.NAME + ' Reverse Dive · ' + fmtM(REV.total) + ' · ' + right + '/' + REV.qs.length + '\n' + CONFIG.SHARE_URL,
    items: REV.qs.map(q => ({ id: q.id, note: q.pick === q.id ? 'Right · +' + fmtM(q.pts) : q.pick ? 'Wrong' : 'Out of oxygen' })),
    again: () => { REV = null; go('#reverse'); } });
}

/* ---------- Puffer Party ---------- */
function viewParty() {
  document.title = 'Puffer Party · Slanger';
  setSeaDepth(0.35);
  const M = S.modes.party, act = M.run && !M.run.done ? M.run : null;
  const names = (M.last && M.last.players) || ['', ''];
  const list = h('div', { class: 'players' });
  const msg = h('p', { class: 'msgline', role: 'status' });
  const addRow = v => {
    if (list.children.length >= 6) return;
    const inp = h('input', { type: 'text', maxlength: '16', placeholder: 'Diver ' + (list.children.length + 1), 'aria-label': 'Player ' + (list.children.length + 1) + ' name', autocomplete: 'off' });
    inp.value = v || '';
    const row = h('div', { class: 'p' }, inp, h('button', { class: 'btn small', type: 'button', 'aria-label': 'Remove player', onclick: () => { if (list.children.length > 2) { row.remove(); relabel(); } } }, 'Remove'));
    list.append(row); relabel();
  };
  const relabel = () => [...list.children].forEach((row, i) => { const inp = row.querySelector('input'); inp.placeholder = 'Diver ' + (i + 1); inp.setAttribute('aria-label', 'Player ' + (i + 1) + ' name'); });
  names.forEach(addRow);
  const per = h('select', { id: 'per' }, [2, 3, 5].map(n => h('option', { value: String(n), selected: n === 3 ? true : null }, n + ' words each')));
  const start = () => {
    const ps = [...list.querySelectorAll('input')].map((x, i) => x.value.trim().slice(0, 16) || 'Diver ' + (i + 1));
    if (new Set(ps.map(x => x.toLowerCase())).size !== ps.length) { msg.textContent = 'Two divers can’t share a name.'; return; }
    if (ps.some(isBlocked)) { msg.textContent = 'Pick a different name.'; return; }
    startParty(ps, +per.value);
  };
  return h('div', { class: 'wrap page' },
    h('p', { class: 'kicker' }, 'Puffer Party'),
    h('h1', { tabindex: '-1' }, 'Pass the phone'),
    h('p', { class: 'intro' }, 'Two to six divers, one device. Everyone gets the same number of words at matching difficulty, with sixty seconds of oxygen each. Deepest total wins.'),
    act ? h('div', { class: 'rowbtns' }, h('a', { class: 'btn primary', href: '#party-play', 'data-autofocus': true }, 'Resume the party in progress'),
      h('button', { class: 'btn', type: 'button', onclick: () => { M.run = null; save(); route(); } }, 'Abandon it')) : null,
    h('section', { class: 'block panel' },
      h('h2', null, 'Divers'), list,
      h('button', { class: 'btn small', type: 'button', onclick: () => { addRow(''); const ins = list.querySelectorAll('input'); ins[ins.length - 1].focus(); } }, 'Add a diver'),
      h('div', { class: 'field' }, h('label', { for: 'per' }, 'Words per diver'), per),
      msg,
      h('div', { class: 'rowbtns' }, h('button', { class: 'btn primary', type: 'button', 'data-autofocus': act ? null : true, onclick: start }, 'Start the party'))));
}
function startParty(players, per) {
  const n = players.length, used = new Set(), ids = [];
  for (let k = 0; k < per; k++) {
    const target = Math.min(5, 1 + Math.round(k * 3 / Math.max(1, per - 1)));
    for (let j = 0; j < n; j++) { const p = pickRandom(used, target); used.add(p.id); ids.push(p.id); }
  }
  S.modes.party.run = { kind: 'party', players, per, ids, i: 0, rounds: ids.map(newRound), done: false };
  save(); go('#party-play');
}
function partyTotals(run) { const t = run.players.map(() => 0); run.rounds.forEach((r, i) => { if (r.done) t[i % run.players.length] += r.final; }); return t; }
function viewPartyPlay() {
  const run = S.modes.party.run;
  if (!run || run.done) return viewParty();
  const n = run.players.length, who = i => run.players[i % n];
  return mountPlay(run, {
    title: () => 'Puffer Party', sub: () => who(run.i) + ' · word ' + (Math.floor(run.i / n) + 1) + ' of ' + run.per,
    back: '#party', timer: 'word', hints: true, gate: i => who(i),
    total: () => partyTotals(run)[run.i % n], totalLabel: () => who(run.i) + '’s total',
    nextLabel: () => run.i >= run.ids.length - 1 ? 'See who sank deepest' : 'Pass to ' + who(run.i + 1),
    onNext: () => {
      if (run.i < run.ids.length - 1) { run.i++; save(); renderPuzzle(true); window.scrollTo(0, 0); return; }
      finishParty(run);
    }
  });
}
function finishParty(run) {
  run.done = true;
  const M = S.modes.party, tot = partyTotals(run);
  M.played++; M.last = { players: run.players, per: run.per }; M.run = null; save();
  const order = run.players.map((name, i) => ({ name, total: tot[i], slangers: run.rounds.filter((r, k) => k % run.players.length === i && r.slanger).length })).sort((a, b) => b.total - a.total);
  const tie = order.length > 1 && order[0].total === order[1].total;
  stopClock(); P = null; document.body.classList.remove('playing');
  setSeaDepth(0.9);
  const view = h('div', { class: 'wrap sum' },
    h('p', { class: 'kicker' }, 'Puffer Party · results'),
    h('h1', { class: 'totalbig', tabindex: '-1', style: 'color:var(--z1);text-shadow:0 0 34px rgba(255,207,61,.6)' }, tie ? 'It’s a tie' : order[0].name),
    h('p', { class: 'lede' }, tie ? 'Dead level at the top. Rematch?' : 'Sank deepest with ' + fmtM(order[0].total) + '.'),
    h('ol', { class: 'board' }, order.map((o, i) => h('li', { class: 'panel' + (i === 0 ? ' win' : '') },
      h('span', { class: 'rk num' }, String(i + 1)), h('span', null, h('span', { class: 'nm' }, o.name), o.slangers ? h('span', { class: 'chip', style: 'margin-left:8px' }, o.slangers + ' Slanger' + (o.slangers > 1 ? 's' : '')) : null), h('span', { class: 'sc num' }, fmtM(o.total))))),
    h('div', { class: 'rowbtns' }, h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => startParty(run.players, run.per) }, 'Rematch'), h('a', { class: 'btn', href: '#party' }, 'New party'), h('a', { class: 'btn', href: '#home' }, 'Home')));
  $('#view').replaceChildren(view); window.scrollTo(0, 0); focusFirst();
  if (!tie) setTimeout(() => wordBurst(order[0].name, 1, 'exact', 'Sank deepest'), 250);
  sound('slanger');
}

/* ---------- shared results ---------- */
function resultsView(o) {
  setSeaDepth(o.depth || 0.85);
  const big = h('p', { class: 'totalbig num' }, fmtM(motionOK() ? 0 : o.total));
  if (motionOK()) setTimeout(() => countUp(big, o.total, 1400), 150);
  const status = h('p', { class: 'msgline', role: 'status' });
  const shareBox = o.share ? h('div', { class: 'share panel' }, h('p', { class: 'kicker' }, 'Share card · no answers in it'), h('pre', null, o.share),
    h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => copyShare(o.share, shareBox, status) }, 'Copy result'), status) : null;
  return h('div', { class: 'wrap sum' },
    h('a', { class: 'btn small', href: o.back || '#home' }, '← ' + (o.backLabel || 'Home')),
    h('p', { class: 'kicker', style: 'margin-top:22px' }, o.kicker),
    h('h1', { class: 'sr' }, 'Your result'),
    big,
    o.lede ? h('p', { class: 'lede' }, o.lede) : null,
    o.stats ? h('div', { class: 'stats' }, o.stats.map(s => stat(s[0], s[1]))) : null,
    o.again ? h('div', { class: 'rowbtns' }, h('button', { class: 'btn primary', type: 'button', 'data-autofocus': o.share ? null : true, onclick: o.again }, 'Dive again'), h('a', { class: 'btn', href: '#home' }, 'Home')) : null,
    shareBox, o.after || null,
    o.items && o.items.length ? [h('h2', { class: 'sect' }, o.listTitle || 'The words'), h('ol', { class: 'terms' }, o.items.map(it => {
      const p = byId(it.id), r = it.r;
      if (!r) return h('li', { class: 'panel' }, h('h3', null, p.term), h('p', null, p.definition), h('p', null, it.note));
      const z = zoneIndexFor(r.best);
      return h('li', { class: 'panel' },
        h('h3', null, p.term, h('span', { class: 'zc z' + z }, CONFIG.ZONES[z].name), r.slanger ? h('span', { class: 'chip' }, 'One in a Slanger') : null),
        h('p', null, p.definition),
        h('p', { class: 'num' }, fmtM(r.final) + ' · ' + r.g.length + (r.g.length === 1 ? ' guess' : ' guesses') + (r.h.length ? ' · ' + r.h.length + ' hint' + (r.h.length > 1 ? 's' : '') : '') + (r.ac ? ' · autocorrected' : '') + (r.out === 'time' ? ' · out of oxygen' : r.out === 'air' ? ' · out of guesses' : r.out === 'skip' ? ' · skipped' : '')));
    }))] : null,
    storageOK ? null : h('p', { class: 'store' }, 'Storage is off in this browser, so this result will be gone after a reload.'));
}
function showResults(o) {
  stopClock(); P = null; document.body.classList.remove('playing');
  document.title = o.kicker + ' · Slanger';
  $('#view').replaceChildren(resultsView(o));
  window.scrollTo(0, 0); focusFirst();
  if (o.newBest && o.total > 0) setTimeout(() => wordBurst('New best', 6, 'exact', fmtM(o.total)), 300);
}
function stat(b, s) { return h('div', { class: 'stat panel' }, h('b', { class: 'num' }, b), h('span', null, s)); }
function copyShare(text, box, status) {
  const fallback = () => {
    let ta = box.querySelector('textarea');
    if (!ta) { ta = h('textarea', { readonly: true, 'aria-label': 'Share text, selected for copying' }); box.append(ta); }
    ta.value = text; ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand && document.execCommand('copy'); } catch (e) { ok = false; }
    status.textContent = ok ? 'Copied.' : 'Clipboard is blocked here. The text is selected: copy it with your keyboard or long-press.';
  };
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return fallback();
    navigator.clipboard.writeText(text).then(() => { status.textContent = 'Copied. Go and gloat.'; toast('Copied'); }, fallback);
  } catch (e) { fallback(); }
}

/* ---------- Stats ---------- */
function viewStats() {
  document.title = 'Stats · Slanger';
  setSeaDepth(0.55);
  const st = S.stats, M = S.modes, total = st.hist.reduce((a, b) => a + b, 0), max = Math.max(1, ...st.hist);
  const rate = st.played ? Math.round(st.wins / st.played * 100) + '%' : '—';
  const avg = st.played ? fmtM(st.totalDepth / st.played) : '—';
  const packBest = CONFIG.PACKS.filter(pk => M.packs.best[pk.key]).map(pk => pk.name + ' ' + fmtM(M.packs.best[pk.key]));
  return h('div', { class: 'wrap page' },
    h('p', { class: 'kicker' }, 'Stats'),
    h('h1', { tabindex: '-1', 'data-autofocus': true }, 'Your logbook'),
    h('p', { class: 'intro' }, st.played ? 'Daily and archive dives count towards these. A dive is a win when you find at least four of the seven words.' : 'No dives finished yet. Finish a daily dive and this fills up.'),
    h('div', { class: 'stats' },
      stat(String(st.played), 'dives played'), stat(rate, 'win rate'), stat(String(liveStreak()), 'current streak'), stat(String(S.streak.max), 'best streak'),
      stat(avg, 'average depth per dive'), stat(String(st.slangers), 'first-guess Slangers'), stat(String(st.words), 'words dived, all modes'), stat(M.endless.best ? fmtM(M.endless.best) : '—', 'best Endless run')),
    h('section', { class: 'block panel' },
      h('h2', null, 'Where your words land'),
      h('p', null, total ? 'The deepest zone you reached on each of ' + total + ' words, across every mode with guessing.' : 'Your zones will show here once you’ve dived a word.'),
      h('div', { class: 'hist', role: 'table', 'aria-label': 'Words by deepest zone' },
        CONFIG.ZONES.slice().reverse().map((z, k) => {
          const zi = 6 - k, n = st.hist[zi], pct = total ? Math.round(n / total * 100) : 0;
          return h('div', { class: 'row z' + zi, role: 'row', title: z.name + ': ' + n + ' words (' + pct + '%)' },
            h('b', { role: 'rowheader' }, z.name), h('div', { class: 'trk', role: 'cell' }, h('i', { style: 'width:' + (n / max * 100) + '%' })), h('span', { class: 'num', role: 'cell' }, n + ' · ' + pct + '%'));
        }))),
    h('section', { class: 'block panel' },
      h('h2', null, 'Mode bests'),
      h('div', { class: 'stats', style: 'margin:0' },
        stat(M.speed.best ? fmtM(M.speed.best) : '—', 'Speed Trench'), stat(M.reverse.best ? fmtM(M.reverse.best) : '—', 'Reverse Dive'),
        stat(String(M.party.played), 'parties played'), stat(String(M.endless.played), 'Endless runs')),
      packBest.length ? h('p', { style: 'margin-top:12px' }, 'Pack bests: ' + packBest.join(' · ')) : null));
}

/* ---------- How to play ---------- */
function viewHow() {
  document.title = 'How to play · Slanger';
  setSeaDepth(0.55);
  return h('div', { class: 'wrap page' },
    h('h1', { 'data-autofocus': true, tabindex: '-1' }, 'How to play'),
    h('p', { class: 'intro' }, 'Every puzzle is a slang definition. You get six guesses and sixty seconds of oxygen to name the word. Each guess sinks you as deep as it deserves, and you never float back up.'),
    h('div', { class: 'steps' },
      step(IC.read, 'Read', 'A definition and an example sentence, with the word blacked out.'),
      step(IC.dive, 'Guess', 'Type a word and press Dive. Close in meaning sinks you deep. Way off barely gets your feet wet.'),
      step(IC.clock, 'Breathe', 'Sixty seconds of oxygen per word. Run out and the word surfaces without you. Solve it fast and the oxygen you saved adds depth.')),
    h('section', { class: 'block panel' }, h('h2', null, 'The zones'),
      h('p', null, 'Depth is scored 0 to 100 and shown in metres. Zones are always named, never just coloured.'),
      h('ol', { class: 'ladder' }, CONFIG.ZONES.map((z, k) => h('li', { class: 'z' + k }, h('span', { class: 'sw' }), h('b', null, z.name), h('span', { class: 'num' }, k === 6 ? fmtM(z.d1) + ' · exact' : fmtM(z.d0) + '–' + fmtM(z.d1)))))),
    h('section', { class: 'block panel' }, h('h2', null, 'What counts as close'),
      h('div', { class: 'tiers' },
        tierBox('Exact', 'The word itself, any accepted spelling. Straight to the Slanger.'),
        tierBox('Same meaning', 'Real synonyms, other slang for the same thing. Lingo and Vernacular.'),
        tierBox('Right neighbourhood', 'Same feeling or category. Jargon.'),
        tierBox('Right world', 'Right topic, wrong meaning. Buzzword.')),
      h('p', null, 'Anything else gets a best guess from the game’s own slang dictionary, capped well short of the bottom.')),
    h('section', { class: 'block panel' }, h('h2', null, 'The autocorrect is not your friend'),
      h('p', null, 'Misspell the answer by a letter and Slanger will fix it for you, grudgingly. It counts as solved, but lands at Lingo, never the Slanger, and earns no bonuses.'),
      h('ul', null, h('li', null, 'Only for words of five letters or more, and only if the first letter is right.'), h('li', null, 'One slip allowed, two for long words. Real words are never “corrected”.'), h('li', null, 'Short words get no help at all. Spell “lit” properly.'))),
    h('section', { class: 'block panel' }, h('h2', null, 'Hints and scoring'),
      h('ul', null, CONFIG.HINTS.map(x => h('li', null, x.label + ' costs ' + fmtM(x.cost) + ' off that puzzle’s score.')),
        h('li', null, 'Take any hint and that puzzle can’t score more than ' + fmtM(CONFIG.HINT_CAP) + '.'),
        h('li', null, 'Solve with guesses to spare: each one adds ' + fmtM(CONFIG.BONUS_PER_SPARE_GUESS) + '.'),
        h('li', null, 'Every second of oxygen left adds ' + fmtM(CONFIG.TIME_BONUS_PER_SEC) + '.'),
        h('li', null, 'Exact on the very first guess, no hints: that’s one in a slanger.'))),
    h('section', { class: 'block panel' }, h('h2', null, 'The other modes'),
      h('ul', null, MODE_CARDS.slice(1, 7).map(m => h('li', null, h('b', null, m.t + ': '), m.d)))),
    h('p', { style: 'margin-top:20px' }, h('a', { class: 'btn primary', href: '#daily' }, 'Go dive')));
}
function step(ic, t, d) { return h('div', { class: 'panel' }, h('div', { html: ic, 'aria-hidden': 'true' }), h('h3', null, t), h('p', null, d)); }
function tierBox(t, d) { return h('div', null, h('b', null, t), h('span', null, d)); }

/* ---------- Options ---------- */
function viewOptions() {
  document.title = 'Options · Slanger';
  setSeaDepth(0.6);
  const todayRun = S.runs[todayStr()];
  const opt = (key, title, desc) => {
    const btn = h('button', { class: 'sw2', type: 'button', role: 'switch', 'aria-checked': String(!!S.settings[key]), 'aria-label': title,
      onclick: () => { S.settings[key] = !S.settings[key]; save(); applySettings(); btn.setAttribute('aria-checked', String(!!S.settings[key])); if (key === 'sound' && S.settings.sound) sound('ding', 95); } });
    return h('div', { class: 'opt' }, h('div', null, h('b', null, title), h('p', null, desc)), btn);
  };
  return h('div', { class: 'wrap page' },
    h('h1', { 'data-autofocus': true, tabindex: '-1' }, 'Options'),
    h('section', { class: 'block panel' },
      opt('filter', 'Hide crude puzzles', 'Skips puzzles flagged as mildly crude. On by default.' + (todayRun ? ' Changes apply from your next daily dive.' : '')),
      opt('sound', 'Sound', 'Bells for close guesses and the big ding when you nail it. On by default.'),
      opt('reducedMotion', 'Reduce motion', 'Stops the moving sea, bursts, flips and flashes. Your system setting is respected either way.'),
      opt('highContrast', 'High contrast', 'Solid black panels and white text over a darkened sea.')),
    h('section', { class: 'block panel' },
      h('h2', null, 'Your data'),
      h('p', null, storageOK ? 'Progress is saved in this browser only. Nothing leaves your device.' : 'Storage is unavailable in this browser, so the game still plays but forgets everything when you leave.'),
      h('button', { class: 'btn danger', type: 'button', onclick: confirmReset }, 'Reset all data')),
    h('p', { class: 'store' }, 'Slanger · build 2 · ' + PUZZLES.length + ' words · definitions written for this game, not copied from anywhere.'));
}
function confirmReset() {
  openModal('Reset everything?', 'Your streak, stats, settings, mode bests and any dive in progress will be wiped from this browser. This can’t be undone.', [
    { label: 'Cancel', cls: 'btn', fn: closeModal },
    { label: 'Reset', cls: 'btn danger', fn: () => { S = freshState(); REV = null; save(); applySettings(); closeModal(); toast('All data reset'); go('#home'); } }
  ]);
}

/* =====================================================================
   RENDER — tiny DOM helpers. Player text only ever goes in as text nodes.
   ===================================================================== */
function $(s) { return document.querySelector(s); }
function h(tag, attrs) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // static SVG constants only
    else if (k === 'style') el.style.cssText = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  for (let i = 2; i < arguments.length; i++) add(arguments[i]);
  return el;
}
function fitText(el) {
  if (!el) return;
  el.style.fontSize = '';
  let fs = parseFloat(getComputedStyle(el).fontSize);
  while (el.scrollWidth > el.clientWidth + 1 && fs > 22) { fs -= 2; el.style.fontSize = fs + 'px'; }
}
function announce(t) { const l = $('#live'); l.textContent = ''; setTimeout(() => { l.textContent = t; }, 60); }
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), 1700); }
function hms(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const p = n => String(n).padStart(2, '0'); return p(Math.floor(s / 3600)) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60); }
function tick(fn) { fn(); TIMERS.push(setInterval(fn, 1000)); }
let modalReturn = null;
function openModal(title, body, actions) {
  const m = $('#modal');
  modalReturn = document.activeElement;
  $('#mtitle').textContent = title; $('#mbody').textContent = body;
  $('#mrow').replaceChildren(...actions.map(a => h('button', { class: a.cls, type: 'button', onclick: a.fn }, a.label)));
  m.hidden = false;
  m.querySelector('#mrow button').focus();
}
function closeModal() { $('#modal').hidden = true; if (modalReturn && modalReturn.isConnected) modalReturn.focus(); }
function applySettings() {
  document.documentElement.classList.toggle('rm', !!S.settings.reducedMotion);
  document.documentElement.classList.toggle('hc', !!S.settings.highContrast);
  if (FX.c) { if (motionOK()) ensureLoop(); else frameStatic(); }
}
const IC = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v15M6 12l6 6 6-6"/><path d="M5 21h14"/></svg>',
  dive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0"/><circle cx="12" cy="13" r="2.2"/><path d="M12 15.2V21M9 18l3 3 3-3"/></svg>',
  how: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.4 2.5c-.6.2-.9.8-.9 1.4V14"/><circle cx="12" cy="17.3" r=".6" fill="currentColor"/></svg>',
  opts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5h16v14H4z"/><path d="M7 9h10M7 13h4"/><rect x="12" y="11.5" width="5" height="3" rx="1" fill="currentColor"/></svg>',
  loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 9a3.5 3.5 0 1 0 0 6c2.5 0 3.5-3 5.5-3s3 3 5.5 3a3.5 3.5 0 1 0 0-6c-2.5 0-3.5 3-5.5 3S9 9 6.5 9z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 13l3-3M10 2h4"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  party: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V12M12 20V5M19 20v-9"/></svg>'
};

/* =====================================================================
   ANIMATION — the live sea (canvas), word bursts, count-ups, sound.
   Everything checks motionOK(); reduced motion draws one still frame.
   ===================================================================== */
const SVG = {
  diver: '<svg viewBox="0 0 48 48" role="img" aria-label="Diver"><path d="M10 22 L2 17 L4 24.5 L2 32 L10 27Z" fill="#3ff5e0"/><path d="M10 22 Q22 16 34 20 L35 26 Q22 30 10 27Z" fill="#f2fbff"/><rect x="14" y="13" width="14" height="6" rx="3" fill="#ffcf3d"/><circle cx="39" cy="22.5" r="5.5" fill="#f2fbff"/><rect x="39.5" y="19" width="6" height="5" rx="1.5" fill="#0a72aa"/><path d="M30 24 L41 31" stroke="#f2fbff" stroke-width="2.6" stroke-linecap="round"/><circle cx="44" cy="12" r="1.8" fill="none" stroke="#f2fbff" stroke-width="1"/><circle cx="46" cy="6" r="1.2" fill="none" stroke="#f2fbff" stroke-width="1"/></svg>',
  fish: '<svg viewBox="0 0 80 40"><g fill="#ffcf3d"><path d="M10 10 Q18 4 26 10 Q18 16 10 10Z M10 10 L4 5 L5 10 L4 15Z"/><path d="M36 20 Q44 14 52 20 Q44 26 36 20Z M36 20 L30 15 L31 20 L30 25Z"/><path d="M14 30 Q22 24 30 30 Q22 36 14 30Z M14 30 L8 25 L9 30 L8 35Z"/><path d="M56 10 Q64 4 72 10 Q64 16 56 10Z M56 10 L50 5 L51 10 L50 15Z"/><path d="M52 31 Q60 25 68 31 Q60 37 52 31Z M52 31 L46 26 L47 31 L46 36Z"/></g></svg>',
  jelly: '<svg viewBox="0 0 40 52"><path d="M4 20 Q4 3 20 3 Q36 3 36 20 Q30 17 26 20 Q20 17 14 20 Q10 17 4 20Z" fill="#ff7a3d" opacity=".9"/><g fill="none" stroke="#ffc59a" stroke-width="1.6" stroke-linecap="round"><path d="M9 20 q-3 8 0 15 q3 8 0 15"/><path d="M16 20 q3 8 0 15 q-3 7 0 13"/><path d="M24 20 q-3 8 0 15 q3 7 0 13"/><path d="M31 20 q3 8 0 15 q-3 8 0 15"/></g><circle cx="15" cy="11" r="2.5" fill="#fff" opacity=".5"/></svg>',
  angler: '<svg viewBox="0 -8 66 52"><circle cx="54" cy="-1" r="7" fill="#fff7a8" opacity=".25"/><path d="M36 8 Q40 -4 54 -1" fill="none" stroke="#3ee07a" stroke-width="1.6"/><circle cx="54" cy="-1" r="3" fill="#fff7a8"/><path d="M8 24 L0 14 L2 24 L0 34Z" fill="#2e8a4a"/><path d="M8 24 Q10 8 32 8 Q52 8 58 22 Q52 38 32 38 Q12 38 8 24Z" fill="#3ee07a"/><path d="M44 25 L58 25 L56 33 Q48 34 44 30Z" fill="#06240f"/><path d="M45 25 L47 29 L49 25 L51 29 L53 25 L55 29 L57 25" fill="none" stroke="#fff" stroke-width="1.2"/><circle cx="45" cy="16" r="3.2" fill="#06240f"/><circle cx="46" cy="15" r="1" fill="#fff"/></svg>',
  squid: '<svg viewBox="0 0 76 34"><path d="M76 17 L66 9 L66 25Z" fill="#1a7fc6"/><path d="M70 17 L48 6 Q22 6 20 17 Q22 28 48 28Z" fill="#2fb4ff"/><circle cx="26" cy="14" r="2.4" fill="#05223a"/><g fill="none" stroke="#9adfff" stroke-width="1.8" stroke-linecap="round"><path d="M20 13 Q10 8 1 10"/><path d="M20 16 Q10 15 2 18"/><path d="M20 19 Q10 21 3 26"/><path d="M20 21 Q12 27 6 32"/></g></svg>',
  snail: '<svg viewBox="0 0 60 30"><path d="M52 15 Q52 5 40 5 Q26 6 15 13 Q7 16 0 15 Q7 18 15 19 Q26 25 40 25 Q52 25 52 15Z" fill="#d7a8ff" opacity=".9"/><circle cx="45" cy="12" r="2.2" fill="#2a0f3d"/><path d="M28 9 Q30 15 28 21" fill="none" stroke="#fff" stroke-width="1" opacity=".5"/></svg>',
  letters: '<svg viewBox="0 0 100 56"><g fill="#3ff5e0" font-family="ui-rounded,system-ui,sans-serif" font-weight="900"><text x="4" y="22" font-size="16">s</text><text x="20" y="40" font-size="13">l</text><text x="30" y="18" font-size="18">a</text><text x="48" y="44" font-size="15">n</text><text x="58" y="20" font-size="17">g</text><text x="74" y="38" font-size="14">e</text><text x="86" y="16" font-size="16">r</text></g><g fill="#d8fffb"><circle cx="14" cy="46" r="1.4"/><circle cx="40" cy="30" r="1"/><circle cx="68" cy="50" r="1.3"/><circle cx="92" cy="30" r="1"/><circle cx="54" cy="6" r="1.1"/></g></svg>'
};
const ZONE_HEX = ['#c6f4ff', '#ffcf3d', '#ff7a3d', '#3ee07a', '#2fb4ff', '#a46bff', '#3ff5e0'];
const ZONE_CREATURE = [null, 'fish', 'jelly', 'angler', 'squid', 'snail', 'letters'];
function zoneColor(zi) { return ZONE_HEX[zi] || '#fff'; }
function motionOK() {
  let sys = false;
  try { sys = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { sys = false; }
  return !S.settings.reducedMotion && !sys;
}
const FX = { cv: null, c: null, w: 0, h: 0, dpr: 1, f: 0.36, target: 0.36, v: 0, t: 0, last: 0, run: false, snow: [], bubs: [], parts: [] };
function initFX() {
  FX.cv = $('#fx');
  try { FX.c = FX.cv.getContext('2d'); } catch (e) { FX.c = null; }
  if (!FX.c) return;
  const size = () => {
    FX.dpr = Math.min(2, window.devicePixelRatio || 1); FX.w = innerWidth; FX.h = innerHeight;
    FX.cv.width = Math.round(FX.w * FX.dpr); FX.cv.height = Math.round(FX.h * FX.dpr);
    FX.c.setTransform(FX.dpr, 0, 0, FX.dpr, 0, 0);
    if (!motionOK()) frameStatic();
  };
  size(); window.addEventListener('resize', size);
  const n = Math.round(Math.min(150, FX.w * FX.h / 9000));
  for (let i = 0; i < n; i++) { const L = [0.35, 0.65, 1][i % 3]; FX.snow.push({ x: Math.random() * FX.w, y: Math.random() * FX.h, r: 0.6 + L * 1.3 * Math.random() + 0.3, L, a: 0.25 + L * 0.45 * Math.random() }); }
  const letters = 'slangerwordsxyzq';
  for (let i = 0; i < 26; i++) FX.bubs.push(newBubble(true, i % 7 === 0 ? letters[i % letters.length] : null));
  if (motionOK()) ensureLoop(); else frameStatic();
}
function newBubble(anywhere, letter) {
  const r = letter ? 9 + Math.random() * 6 : 1.5 + Math.random() * Math.random() * 9;
  return { x: Math.random() * FX.w, y: anywhere ? Math.random() * FX.h : FX.h + 20 + Math.random() * 60, r, spd: 22 + r * 5 + Math.random() * 20, ph: Math.random() * 6.28, amp: 4 + Math.random() * 10, L: letter };
}
function setSeaDepth(f, instant) {
  FX.target = Math.max(0, Math.min(1, f));
  if (instant || !motionOK()) { FX.f = FX.target; FX.v = 0; }
  if (!FX.c) { applyWater(); return; }
  if (motionOK()) ensureLoop(); else frameStatic();
}
function ensureLoop() { if (!FX.run && FX.c) { FX.run = true; FX.last = performance.now(); requestAnimationFrame(loop); } }
function loop(now) {
  if (!motionOK()) { FX.run = false; frameStatic(); return; }
  const dt = Math.min(0.05, (now - FX.last) / 1000); FX.last = now; FX.t += dt;
  const a = (FX.target - FX.f) * 10 - FX.v * 5.2;   // a touch under-damped: overshoots then settles
  FX.v += a * dt; FX.f += FX.v * dt;
  applyWater(); draw(dt);
  requestAnimationFrame(loop);
}
function applyWater() {
  const f = Math.max(0, Math.min(1, FX.f));
  const w = $('#sea .water'); if (w) w.style.backgroundPosition = '50% ' + (f * 100).toFixed(2) + '%';
  const cs = $('#sea .caustic'); if (cs) cs.style.opacity = String(Math.max(0, 0.38 - f * 1.2));
  const fl = $('#sea .floor'); if (fl) fl.style.opacity = String(Math.max(0, Math.min(1, (f - 0.62) / 0.33)));
}
function frameStatic() { if (!FX.c) return; applyWater(); draw(0); }
function draw(dt) {
  const c = FX.c, W = FX.w, H = FX.h, f = Math.max(0, Math.min(1, FX.f)), t = FX.t;
  c.clearRect(0, 0, W, H);
  // light shafts, fading with depth
  const ra = Math.max(0, 0.2 - f * 0.45);
  if (ra > 0.005) {
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x0 = W * (0.05 + i * 0.18) + Math.sin(t * 0.25 + i * 1.7) * 50, spread = 90 + i * 25 + Math.sin(t * 0.4 + i) * 40;
      const g = c.createLinearGradient(0, 0, 0, H * 0.95);
      g.addColorStop(0, 'rgba(190,255,250,' + (ra * (0.6 + 0.4 * Math.sin(t * 0.6 + i * 2))).toFixed(3) + ')'); g.addColorStop(1, 'rgba(190,255,250,0)');
      c.fillStyle = g; c.beginPath(); c.moveTo(x0 - 14, -10); c.lineTo(x0 + 26, -10); c.lineTo(x0 + spread + 60, H * 0.95); c.lineTo(x0 + spread - 30, H * 0.95); c.closePath(); c.fill();
    }
  }
  // marine snow: drifts down at rest, streaks upward as you sink
  c.globalCompositeOperation = 'source-over';
  const rush = FX.v * H * 1.6;
  c.lineCap = 'round';
  for (const p of FX.snow) {
    const vy = 7 * p.L - rush * p.L;
    p.y += vy * dt; p.x += Math.sin(t * 0.5 + p.y * 0.01) * 3 * dt * p.L;
    if (p.y < -30) { p.y = H + 20; p.x = Math.random() * W; } else if (p.y > H + 30) { p.y = -20; p.x = Math.random() * W; }
    const len = Math.min(70, Math.abs(vy) * 0.06);
    c.strokeStyle = c.fillStyle = 'rgba(215,240,255,' + (p.a * (0.5 + f * 0.6)).toFixed(3) + ')';
    if (len > 2) { c.lineWidth = p.r; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y + (vy < 0 ? len : -len)); c.stroke(); }
    else { c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.283); c.fill(); }
  }
  // bubbles
  for (let i = 0; i < FX.bubs.length; i++) {
    const b = FX.bubs[i];
    b.y -= (b.spd + Math.max(0, rush) * 0.35) * dt;
    const x = b.x + Math.sin(t * 2 + b.ph) * b.amp;
    if (b.y < -30) FX.bubs[i] = newBubble(false, b.L);
    const g = c.createRadialGradient(x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, x, b.y, b.r);
    g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(0.45, 'rgba(190,245,255,.12)'); g.addColorStop(0.9, 'rgba(190,245,255,.22)'); g.addColorStop(1, 'rgba(230,252,255,.6)');
    c.fillStyle = g; c.beginPath(); c.arc(x, b.y, b.r, 0, 6.283); c.fill();
    if (b.L) { c.fillStyle = 'rgba(235,253,255,.85)'; c.font = '900 ' + Math.round(b.r * 1.1) + 'px ui-rounded,system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(b.L, x, b.y + 1); }
  }
  // burst particles
  if (FX.parts.length) {
    c.globalCompositeOperation = 'lighter';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    FX.parts = FX.parts.filter(p => (p.life -= dt) > 0);
    for (const p of FX.parts) {
      p.vx *= 1 - 1.6 * dt; p.vy = p.vy * (1 - 1.6 * dt) - 40 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const a = Math.min(1, p.life / p.max * 1.4);
      c.globalAlpha = a; c.fillStyle = p.col;
      if (p.g) { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.font = '900 ' + p.s + 'px ui-rounded,system-ui,sans-serif'; c.fillText(p.g, 0, 0); c.restore(); }
      else { c.beginPath(); c.arc(p.x, p.y, p.s * 0.18, 0, 6.283); c.fill(); }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
}
FX.burst = (x, y, col, n, glyphs) => {
  if (!FX.c || !motionOK()) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, sp = 140 + Math.random() * 520;
    FX.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8, life: 0.9 + Math.random() * 1.1, max: 2, col: Math.random() < 0.25 ? '#ffffff' : col,
      g: glyphs && Math.random() < 0.6 ? glyphs[Math.floor(Math.random() * glyphs.length)] : null, s: 12 + Math.random() * 22, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 8 });
  }
  ensureLoop();
};
/* the big moment: letters spring in, rings blast out, sea sparks */
function wordBurst(text, zi, level, kick) {
  const host = $('#burst');
  host.replaceChildren();
  const hold = level === 'slanger' ? 2.1 : level === 'exact' ? 1.45 : 1.0;
  const wrap = h('div', { class: 'wb ' + level + ' z' + zi, style: '--hold:' + hold + 's' });
  const word = h('div', { class: 'word' });
  let i = 0;
  String(text).split(/\s+/).forEach(w => { const ws = h('span', { class: 'w' }); [...w].forEach(ch => ws.append(h('span', { class: 'l', style: '--i:' + (i++) }, ch))); word.append(ws, ' '); });
  const kt = kick || (level === 'slanger' ? 'ONE IN A SLANGER' : level === 'exact' ? 'BANG ON · SLANGER' : CONFIG.ZONES[zi].name.toUpperCase() + ' · SO CLOSE');
  wrap.append(word, h('div', { class: 'kick' }, kt));
  host.append(h('div', { class: 'scrim ' + level, style: 'animation-duration:' + (hold + 0.6) + 's' }));
  const rings = level === 'close' ? 1 : level === 'exact' ? 3 : 5;
  for (let k = 0; k < rings; k++) host.append(h('span', { class: 'ring z' + zi, style: '--d:' + (k * 0.16) + 's' }));
  host.append(wrap);
  fitText(word);
  if (motionOK()) {
    const glyphs = [...String(text).replace(/\s/g, '')];
    FX.burst(innerWidth / 2, innerHeight / 2, zoneColor(zi), level === 'close' ? 50 : level === 'exact' ? 130 : 220, glyphs);
    if (level !== 'close') {
      const app = $('#app'); app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake'); setTimeout(() => app.classList.remove('shake'), 600);
      const fl = $('#flash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
      if (level === 'slanger') { drift(6); setTimeout(() => drift(6), 600); setTimeout(() => FX.burst(innerWidth / 2, innerHeight / 2, '#ffffff', 120, glyphs), 450); }
    }
  }
  clearTimeout(wordBurst._t);
  wordBurst._t = setTimeout(() => host.replaceChildren(), (hold + 0.6) * 1000);
}
function drift(zi) {
  const kind = ZONE_CREATURE[zi];
  if (!kind || !motionOK()) return;
  const el = h('div', { style: 'position:absolute;left:0;top:' + (16 + Math.random() * 60).toFixed(0) + '%;width:' + (kind === 'letters' ? 190 : 140) + 'px;filter:drop-shadow(0 0 8px rgba(63,245,224,.4));pointer-events:none', html: SVG[kind] });
  $('#sea').insertBefore(el, $('#sea .vignette'));
  const anim = el.animate([{ transform: 'translateX(-200px)' }, { transform: 'translateX(' + (innerWidth + 60) + 'px)' }], { duration: 8000 + Math.random() * 3000, easing: 'linear' });
  anim.onfinish = () => el.remove();
  el.firstChild.setAttribute('style', 'width:100%;height:auto;display:block');
}
function countUp(el, to, ms) {
  if (!motionOK()) { el.textContent = fmtM(to); return; }
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmtM(to * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

/* ---------- sound: synthesised bells with a watery echo, no files ---------- */
let AU = null;
function audio() {
  if (AU) return AU;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  const ctx = new C(), master = ctx.createGain(), comp = ctx.createDynamicsCompressor();
  master.gain.value = 0.55; master.connect(comp); comp.connect(ctx.destination);
  const delay = ctx.createDelay(1), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
  delay.delayTime.value = 0.21; fb.gain.value = 0.34; lp.type = 'lowpass'; lp.frequency.value = 2200; wet.gain.value = 0.4;
  delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(master);
  AU = { ctx, master, send: delay };
  return AU;
}
function bell(A, f, t, g, dur) {
  const nyq = A.ctx.sampleRate / 2 - 500;
  [[1, 1], [2, 0.55], [2.76, 0.42], [5.4, 0.2], [8.93, 0.08]].forEach(([ratio, amp]) => {
    if (f * ratio > nyq) return;
    const o = A.ctx.createOscillator(), gn = A.ctx.createGain(), end = t + dur / Math.pow(ratio, 0.55);
    o.type = 'sine'; o.frequency.setValueAtTime(f * ratio, t);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g * amp, t + 0.006); gn.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(gn); gn.connect(A.master); gn.connect(A.send); o.start(t); o.stop(end + 0.05);
  });
}
function thump(A, t, g) {
  const o = A.ctx.createOscillator(), gn = A.ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(gn); gn.connect(A.master); o.start(t); o.stop(t + 0.65);
}
function whoosh(A, t, g, from, to, dur) {
  const len = Math.floor(A.ctx.sampleRate * dur), buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = A.ctx.createBufferSource(), bp = A.ctx.createBiquadFilter(), gn = A.ctx.createGain();
  src.buffer = buf; bp.type = 'bandpass'; bp.Q.value = 1.4; bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.05); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(gn); gn.connect(A.master); gn.connect(A.send); src.start(t); src.stop(t + dur + 0.05);
}
function sound(kind, arg) {
  if (!S.settings.sound) return;
  try {
    const A = audio(); if (!A) return;
    if (A.ctx.state === 'suspended') A.ctx.resume();
    const t = A.ctx.currentTime + 0.02;
    if (kind === 'dive') { whoosh(A, t, 0.22, 1400, 260, 0.55); thump(A, t, 0.18 + (arg || 0) / 400); }
    else if (kind === 'ding') { const base = arg >= 90 ? 1318.5 : 1046.5; whoosh(A, t, 0.14, 2400, 600, 0.4); bell(A, base, t, 0.34, 2.2); bell(A, base * 1.5, t + 0.09, 0.22, 1.9); bell(A, base * 2, t + 0.18, 0.12, 1.4); }
    else if (kind === 'exact' || kind === 'slanger') {
      thump(A, t, 0.6); whoosh(A, t, 0.25, 3000, 400, 0.8); bell(A, 523.25, t, 0.28, 3.2);
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => bell(A, f, t + i * 0.085, 0.3, 2.8));
      if (kind === 'slanger') { [2093, 2637, 3136, 4186].forEach((f, i) => bell(A, f, t + 0.42 + i * 0.07, 0.18, 2.6)); bell(A, 784, t + 0.42, 0.25, 3.4); thump(A, t + 0.42, 0.45); }
    }
    else if (kind === 'tick') bell(A, arg <= 3 ? 1760 : 1320, t, arg <= 3 ? 0.16 : 0.08, 0.25);
    else if (kind === 'timeout') { whoosh(A, t, 0.3, 900, 120, 1.1); bell(A, 392, t, 0.3, 1.8); bell(A, 311.1, t + 0.28, 0.3, 2.2); }
    else if (kind === 'wrong') { bell(A, 233, t, 0.26, 0.7); bell(A, 220, t + 0.12, 0.22, 0.8); }
    else if (kind === 'surface') { whoosh(A, t, 0.2, 300, 2600, 0.9); [784, 988, 1175, 1568].forEach((f, i) => bell(A, f, t + 0.2 + i * 0.1, 0.22, 2)); }
  } catch (e) { /* no audio, no problem */ }
}
function heroSVG() {
  let bands = '';
  CONFIG.ZONES.slice(0, 6).forEach((z, k) => {
    const y = 18 + k * 32;
    bands += '<line x1="16" x2="344" y1="' + y + '" y2="' + y + '" stroke="' + ZONE_HEX[k] + '" stroke-opacity=".5" stroke-dasharray="3 5"/>' +
      '<text x="340" y="' + (y + 16) + '" text-anchor="end" font-size="12.5" font-weight="900" fill="' + ZONE_HEX[k] + '">' + z.name + '</text>';
  });
  const strip = (s, w, hgt) => s.replace(/^<svg viewBox="([^"]+)"[^>]*>/, '<svg width="' + w + '" height="' + hgt + '" viewBox="$1">');
  return '<svg viewBox="0 0 360 260"><defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38d6e6"/><stop offset=".22" stop-color="#0a72aa"/><stop offset=".55" stop-color="#0a2468"/><stop offset=".8" stop-color="#08093a"/><stop offset="1" stop-color="#010008"/></linearGradient><radialGradient id="hglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#3ff5e0" stop-opacity=".7"/><stop offset="1" stop-color="#3ff5e0" stop-opacity="0"/></radialGradient><linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d2fffb" stop-opacity=".35"/><stop offset="1" stop-color="#d2fffb" stop-opacity="0"/></linearGradient></defs>' +
    '<rect width="360" height="260" fill="url(#hg)"/><path d="M40 0 L70 0 L150 200 L100 200Z M140 0 L160 0 L230 180 L200 180Z M230 0 L262 0 L330 170 L290 170Z" fill="url(#ray)"/>' +
    '<g font-family="system-ui,sans-serif">' + bands + '</g>' +
    '<ellipse cx="160" cy="240" rx="150" ry="40" fill="url(#hglow)"/>' +
    '<g transform="translate(84 200)">' + strip(SVG.letters, 150, 60) + '</g>' +
    '<g class="bob"><g transform="translate(112 66) rotate(58 32 32)">' + strip(SVG.diver, 72, 72) + '</g></g>' +
    '<g class="pulse"><g transform="translate(232 98)">' + strip(SVG.jelly, 38, 50) + '</g></g>' +
    '<g fill="none" stroke="#f2fbff" stroke-opacity=".75"><circle cx="184" cy="56" r="4"/><circle cx="192" cy="40" r="3"/><circle cx="186" cy="24" r="5.5"/><circle cx="60" cy="122" r="7"/><circle cx="286" cy="186" r="6"/></g>' +
    '<g font-family="ui-rounded,system-ui,sans-serif" font-weight="900" fill="#f2fbff" fill-opacity=".85" font-size="10" text-anchor="middle"><text x="186" y="27.5">w</text><text x="60" y="125.5">a</text><text x="286" y="189.5">z</text></g></svg>';
}

/* =====================================================================
   SELFTEST — inert unless you run SLANGER.SELFTEST() in the console.
   ===================================================================== */
function SELFTEST() {
  const out = []; let fails = 0;
  const ok = (c, m) => { out.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  let bad = [];
  PUZZLES.forEach(p => p.exact.forEach(e => { if (scoreGuess(e, p).score !== 100) bad.push(p.term + ':' + e); }));
  ok(!bad.length, 'every exact spelling scores 100' + (bad.length ? ' — ' + bad.join(', ') : ''));
  bad = [];
  PUZZLES.forEach(p => ['hot', 'warm', 'cool'].forEach(t => (p.tiers[t] || []).forEach(e => {
    const s = scoreGuess(parseEntry(e).text, p).score, [lo, hi] = BANDS[t];
    if (s < lo || s > hi) bad.push(p.term + ':' + e + '=' + s);
  })));
  ok(!bad.length, 'every tier entry lands in its own band' + (bad.length ? ' — ' + bad.slice(0, 8).join(', ') : ''));
  let max = 0, n = 0;
  PUZZLES.forEach(p => { for (const k of LEXICON.keys()) { const r = scoreGuess(k, p); if (r.reason.indexOf('fallback') === 0) { n++; max = Math.max(max, r.score); } } });
  ['qwerty', 'banana bread', 'very tired indeed', 'zzzz'].forEach(g => PUZZLES.forEach(p => { const r = scoreGuess(g, p); if (r.reason.indexOf('fallback') === 0) max = Math.max(max, r.score); }));
  ok(max <= 70, 'heuristic fallback never exceeds 70 (max ' + max + ' over ' + n + ' lexicon checks)');
  const p1 = PUZZLES[0], seq = ['pub', 'tipsy', 'qwerty', 'wasted', 'drunk', 'hammered'];
  let best = 0, mono = true;
  seq.forEach(g => { const d = scoreGuess(g, p1).depth; const nb = Math.max(best, d); if (nb < best) mono = false; best = nb; });
  for (let s = 1; s <= 100; s++) if (scoreToDepth(s) < scoreToDepth(s - 1)) mono = false;
  ok(mono, 'diver depth never decreases within a round, and depth rises with score');
  const a = dailyPuzzles('2026-11-23', true), b = dailyPuzzles('2026-11-23', true);
  ok(JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(CONFIG.SEED_SNAPSHOT), 'daily seed for 2026-11-23 is stable and matches the snapshot');
  let uniq = true;
  for (let i = 0; i < 120; i++) { const d = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10); [true, false].forEach(f => { if (new Set(dailyPuzzles(d, f)).size !== 7) uniq = false; }); }
  ok(uniq, 'every day for 120 days gets seven different puzzles');
  const fake = { no: 23, total: 41250, rounds: [] };
  for (let i = 0; i < 7; i++) fake.rounds.push({ g: Array.from({ length: 6 }, () => ({ s: 40, z: 2 })), h: ['letter'], slanger: false, ac: false, out: 'time' });
  fake.rounds[0] = { g: [{ s: 100, z: 6 }], h: [], slanger: true, ac: false, out: 'solved' };
  const st = shareText(fake), lines = st.split('\n');
  ok(lines.length === 9, 'share string has exactly seven emoji rows');
  ok(st.length < 300, 'share string is under 300 characters (' + st.length + ')');
  const ham = scoreGuess('hamered', p1);
  ok(ham.corrected === 'hammered' && ham.solved && ham.score === CONFIG.AUTOCORRECT_SCORE, 'a one-letter typo of the answer autocorrects, solves, and stops at 92');
  const lit = PUZZLES.find(p => p.term === 'lit');
  ok(!scoreGuess('lot', lit).corrected && !scoreGuess('lot', lit).solved, 'short answers are never autocorrected');
  ok(!scoreGuess('drunk', p1).corrected, 'real words are never autocorrected');
  ok(!scoreGuess('jammered', p1).corrected, 'a wrong first letter is never autocorrected');
  ok(!scoreGuess('hamrd', p1).solved, 'two slips on a short answer are not autocorrected');
  ok(isBlocked('test') === false, 'the guess filter lets ordinary words through');
  const rr = Object.assign(newRound(), { g: [{ s: 100 }], solved: true, bestDepth: 10994, tl: 30000 });
  const fin = roundFinal(rr);
  ok(fin.tb === 600 && fin.bonus === 750 && fin.final === 10994 + 750 + 600, 'clean solve banks spare-guess and oxygen bonuses');
  const rt = Object.assign(newRound(), { g: [{ s: 60 }], solved: false, bestDepth: 2000, tl: 0 });
  ok(roundFinal(rt).final === 2000, 'running out of oxygen keeps the depth reached, with no bonus');
  ok(CONFIG.PACKS.every(pk => packPuzzles(pk.key).length >= 6), 'every themed pack has at least six words');
  console.log(out.join('\n') + '\n' + (fails ? fails + ' FAILED' : 'ALL PASSED'));
  return { pass: fails === 0, results: out };
}

/* =====================================================================
   INIT
   ===================================================================== */
function init() {
  load();
  applySettings();
  initFX();
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', e => {
    const m = $('#modal');
    if (m.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    if (e.key === 'Tab') {
      const f = [...m.querySelectorAll('button')]; if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  const unlock = () => { if (S.settings.sound) { const A = audio(); if (A && A.ctx.state === 'suspended') A.ctx.resume(); } };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('pagehide', () => { if (P) stopClock(); save(); });
  route();
}

const SLANGER = Object.freeze({
  version: 2,
  SELFTEST,
  scoreGuess,
  dailyPuzzles,
  debug: { setDate: d => { DATE_OVERRIDE = d; route(); }, state: () => JSON.parse(JSON.stringify(S)) }
});
Object.defineProperty(window, 'SLANGER', { value: SLANGER, configurable: false, writable: false });

init();
})();
</script>
</body>
</html>
