'use strict';
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let S = null;   // game state
const UI = {
  selUnit: null, selSet: new Set(), wSel: new Set(), reach: null, hover: null,
  busy: false, placeType: 'HVY', resolver: null, runId: 0,
};

const PHASES = ['ogreMove', 'ogreFire', 'defMove', 'defFire', 'defGev'];
const PHASE_NAMES = {
  setupDef: 'Defender Deployment', setupOgre: 'Juggernaut Entry', ogreMove: 'Juggernaut Movement', ogreFire: 'Juggernaut Fire',
  defMove: 'Defender Movement', defFire: 'Defender Fire', defGev: 'Hovertank Second Move', over: 'Battle Over',
};

// ---------- helpers ----------
const terr = (c, r) => S.map.t[r * COLS + c];
function unitAt(c, r) { for (const u of S.units) if (u.alive && u.c === c && u.r === r) return u; return null; }
const ogreAt = (c, r) => S.ogre.placed && S.ogre.c === c && S.ogre.r === r;
const cp = () => S.units.find(u => u.type === 'CP');
const T = u => UNIT_TYPES[u.type];
const uAtk = u => T(u).perSquad ? u.squads : T(u).atk;
const uDef = u => T(u).perSquad ? u.squads : T(u).def;
const ctl = side => side === 'ogre' ? S.opts.ogreCtl : S.opts.defCtl;
const liveWeapons = () => S.ogre.weapons.filter(w => w.alive);
function ogreMP() { const o = S.ogre; return o.treads <= 0 ? 0 : Math.ceil(o.treads * 3 / o.treadsMax); }
function unitValue(u) { return { HWZ: 9, HVY: 6, MSL: 5, GEV: 4, CP: 100 }[u.type] ?? u.squads * 1.6; }
const stopped = run => run !== UI.runId || S.over;

function log(msg, cls = '') {
  const li = document.createElement('li');
  li.className = cls; li.innerHTML = `<b>T${S.turn}</b> ${msg}`;
  const ol = $('log'); ol.prepend(li);
  while (ol.children.length > 250) ol.lastChild.remove();
}
let flashTimer = 0;
function flash(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(flashTimer); flashTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- movement ----------
function moveCost(type, c, r) {
  const t = terr(c, r);
  if (t === 'crater') return Infinity;
  if (t === 'rubble') return type === 'INF' ? 1 : 2;
  return 1;
}
function unitReach(u, mp) {
  const sk = Hex.key(u.c, u.r), all = new Map(), start = { c: u.c, r: u.r, cost: 0, prev: null };
  all.set(sk, start);
  const open = [start];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const cur = open.shift();
    for (const n of Hex.neighbors(cur.c, cur.r)) {
      if (ogreAt(n.c, n.r)) continue;
      const cost = cur.cost + moveCost(u.type, n.c, n.r);
      if (cost > mp) continue;
      const k = Hex.key(n.c, n.r), ex = all.get(k);
      if (ex && ex.cost <= cost) continue;
      const node = { c: n.c, r: n.r, cost, prev: cur };
      all.set(k, node); open.push(node);
    }
  }
  const ends = new Set();
  for (const [k, n] of all) if (k !== sk && !unitAt(n.c, n.r)) ends.add(k);
  return { all, ends };
}
// Juggernaut may roll through infantry, but can't stop on a stack that survives the overrun.
function ogreBlocksEnd(c, r) {
  const u = unitAt(c, r);
  if (!u || u.type !== 'INF') return false;
  return S.ogre.rammed.has(u.id) || u.squads > 1;
}
function ogreReach() {
  const o = S.ogre, sk = Hex.key(o.c, o.r), all = new Map();
  all.set(sk, { c: o.c, r: o.r, cost: 0, prev: null });
  const q = [all.get(sk)];
  while (q.length) {
    const cur = q.shift();
    if (cur.cost >= o.mpLeft) continue;
    for (const n of Hex.neighbors(cur.c, cur.r)) {
      const k = Hex.key(n.c, n.r);
      if (all.has(k) || terr(n.c, n.r) === 'crater') continue;
      const node = { c: n.c, r: n.r, cost: cur.cost + 1, prev: cur };
      all.set(k, node); q.push(node);
    }
  }
  const ends = new Set();
  for (const [k, n] of all) if (k !== sk && !ogreBlocksEnd(n.c, n.r)) ends.add(k);
  return { all, ends };
}
function pathTo(all, k) {
  const p = []; let n = all.get(k);
  while (n && n.prev) { p.unshift({ c: n.c, r: n.r }); n = n.prev; }
  return p;
}
function canMoveNow(u) {
  if (!u.alive || u.disabled || T(u).mov <= 0) return false;
  if (S.phase === 'defMove') return !u.moved;
  if (S.phase === 'defGev') return u.type === 'GEV' && !u.gevMoved;
  return false;
}
async function moveUnit(u, path) {
  await R.animateMove(u, path);
}
async function moveOgre(path, run) {
  for (const h of path) {
    if (stopped(run)) return;
    await R.animateMove(S.ogre, [h], 190);
    S.ogre.mpLeft--;
    const u = unitAt(h.c, h.r);
    if (u && !S.ogre.rammed.has(u.id)) ram(u);
    refresh();
    checkVictory();
  }
}
function ram(u) {
  const o = S.ogre;
  o.rammed.add(u.id);
  if (u.type === 'INF') {
    u.squads--;
    R.floatText(u, '-1 SQUAD', '#ffb347'); SFX.stomp();
    log(`Juggernaut overruns infantry — 1 squad crushed.`, 'ogre');
    if (u.squads <= 0) kill(u);
    return;
  }
  const loss = Math.min(o.treads, T(u).ram);
  kill(u);
  o.treads -= loss;
  R.floatText(u, 'RAMMED', '#ff7b52');
  log(`Juggernaut <b>rams</b> the ${T(u).name}! Destroyed.${loss ? ` Juggernaut loses ${loss} tread unit${loss > 1 ? 's' : ''}.` : ''}`, 'ogre');
  if (u.type === 'CP') cpKilled();
}
function kill(u) { u.alive = false; R.explode(u); }
function cpKilled() {
  if (S.cpDestroyed) return;
  S.cpDestroyed = true;
  log(`<b>THE COMMAND POST HAS BEEN DESTROYED.</b>`, 'big');
  flash('Command Post destroyed!');
}

// ---------- combat ----------
function canWeaponHit(w, t) {
  return w.alive && !w.fired && t.alive && Hex.dist(S.ogre, t) <= w.rng && (w.kind !== 'ap' || t.type === 'INF' || t.type === 'CP');
}
function canFire(u) {
  return u.alive && !u.disabled && !u.fired && u.type !== 'CP' && S.ogre.placed && Hex.dist(u, S.ogre) <= T(u).rng;
}
function resultWord(r) { return r === 'X' ? 'DESTROYED' : r === 'D' ? 'DISABLED' : 'no effect'; }
function describeWeapons(weps) {
  const n = {}; for (const w of weps) n[w.name] = (n[w.name] || 0) + 1;
  return Object.entries(n).map(([k, v]) => v > 1 ? `${v}× ${k}` : k).join(' + ');
}

async function ogreAttack(weps, t, run) {
  const atk = weps.reduce((s, w) => s + w.atk, 0), def = uDef(t), idx = Rules.oddsIndex(atk, def);
  for (const w of weps) w.fired = true;
  refresh();
  await R.volley(weps.map(() => S.ogre), t, '#ff7a45', weps.some(w => w.kind === 'msl' || w.kind === 'main'));
  if (run !== UI.runId) return;
  for (const w of weps) if (w.kind === 'msl') { w.alive = false; w.spent = true; }
  const res = Rules.resolve(idx);
  log(`Juggernaut fires ${describeWeapons(weps)} at ${T(t).name}: ${atk} vs ${def} <i>(${Rules.label(idx)})</i>${res.roll ? `, roll ${res.roll}` : ''} → <em class="${res.result}">${resultWord(res.result)}</em>`, 'ogre');
  applyHit(t, res.result);
  if (!t.alive && t.type === 'CP') cpKilled();
  refresh(); checkVictory();
}
function applyHit(u, result) {
  if (result === 'X') { kill(u); R.floatText(u, 'DESTROYED', '#ff5a3c'); return; }
  if (result === 'D') {
    if (u.type === 'INF') {
      u.squads--;
      if (u.squads <= 0) { kill(u); R.floatText(u, 'DESTROYED', '#ff5a3c'); }
      else { R.floatText(u, '-1 SQUAD', '#ffc24a'); SFX.boom(); }
    } else if (u.disabled) { kill(u); R.floatText(u, 'DESTROYED', '#ff5a3c'); }
    else { u.disabled = true; R.floatText(u, 'DISABLED', '#ffc24a'); SFX.miss(); }
    return;
  }
  R.floatText(u, 'MISS', '#9fb3c8'); SFX.miss();
}

async function defenderAttack(units, kind, run) {
  const o = S.ogre;
  for (const u of units) u.fired = true;
  if (kind === 'treads') {
    for (const u of units) {
      await R.shot(u, o, '#6fd8ff', false);
      if (run !== UI.runId) return;
      const res = Rules.resolve(1);
      const dmg = res.result === 'X' ? Math.min(uAtk(u), o.treads) : 0;
      o.treads -= dmg;
      log(`${T(u).name} fires at treads (1:1), roll ${res.roll} → ${dmg ? `<em class="X">${dmg} tread${dmg > 1 ? 's' : ''} destroyed</em>` : 'no effect'}`, 'def');
      R.floatText(o, dmg ? `-${dmg} TREADS` : 'MISS', dmg ? '#5dff9a' : '#9fb3c8');
      if (dmg) SFX.boom(); else SFX.miss();
      refresh(); checkVictory();
      if (S.over) return;
    }
    return;
  }
  const comp = o.weapons.find(w => w.kind === kind && w.alive);
  if (!comp) return;
  const atk = units.reduce((s, u) => s + uAtk(u), 0), idx = Rules.oddsIndex(atk, comp.def);
  await R.volley(units, o, '#6fd8ff', units.some(u => u.type === 'HWZ' || u.type === 'MSL'));
  if (run !== UI.runId) return;
  const res = Rules.resolve(idx);
  const hit = res.result === 'X';
  if (hit) comp.alive = false;
  const who = units.length > 1 ? `${units.length} units` : T(units[0]).name;
  log(`${who} ${units.length > 1 ? 'fire' : 'fires'} at ${comp.name}: ${atk} vs ${comp.def} <i>(${Rules.label(idx)})</i>${res.roll ? `, roll ${res.roll}` : ''} → ${hit ? `<em class="X">${comp.name} destroyed</em>` : 'no effect'}`, 'def');
  R.floatText(o, hit ? `${comp.name.toUpperCase()} KO` : 'MISS', hit ? '#5dff9a' : '#9fb3c8');
  if (hit) R.explode(o, 0.6); else SFX.miss();
  refresh(); checkVictory();
}

// ---------- victory ----------
function checkVictory() {
  if (!S || S.over || !S.ogre.placed) return;
  const o = S.ogre;
  if (S.cpDestroyed && o.c === COLS - 1 && S.phase === 'ogreMove') return end('ogre-total');
  if (o.treads <= 0) {
    if (S.cpDestroyed) return end('ogre-marginal');
    const d = Hex.dist(o, cp());
    if (!liveWeapons().some(w => w.rng >= d)) return end('defender');
  }
  if (!S.cpDestroyed && !liveWeapons().length && o.treads <= 0) return end('defender');
}
function end(result) {
  S.over = true; S.result = result; S.phase = 'over';
  clearSave();
  if (UI.resolver) { const r = UI.resolver; UI.resolver = null; r(); }
  clearSel(); refresh();
  const ogreWon = result !== 'defender';
  const human = S.opts.mode === 'hotseat' ? null : S.opts.mode === 'ogre' ? 'ogre' : 'def';
  const youWon = human && ((human === 'ogre') === ogreWon);
  (human === null || youWon) ? SFX.win() : SFX.lose();
  const titles = {
    'ogre-total': ['Juggernaut Total Victory', 'The Command Post is rubble and the Juggernaut has escaped the battlefield.'],
    'ogre-marginal': ['Juggernaut Marginal Victory', 'The Command Post was destroyed, but the Juggernaut was immobilized.'],
    'defender': ['Defender Victory', 'The Juggernaut has been stopped. The Command Post stands.'],
  };
  const [title, sub] = titles[result];
  log(`<b>${title.toUpperCase()}</b>`, 'big');
  const b = $('banner');
  b.className = 'banner ' + (ogreWon ? 'ogre' : 'def');
  b.innerHTML = `<div class="kicker">${human === null ? 'Battle over' : youWon ? 'You win' : 'You lose'} · turn ${S.turn}</div>
    <h2>${title}</h2><p>${sub}</p>
    <div class="row"><button data-act="rematch" class="primary">Rematch (same map)</button><button data-act="menu">New battle</button></div>`;
}

// ---------- save / load ----------
// Autosaves to localStorage whenever the game is at rest (between actions, never mid-animation).
const SAVE_KEY = 'ogre.save.v1';
function saveGame() {
  if (!S || S.over) return;
  try {
    const data = { ...S, map: { t: S.map.t, seed: S.map.seed },
      ogre: { ...S.ogre, rammed: [...S.ogre.rammed], spec: undefined, anim: undefined },
      units: S.units.map(u => ({ ...u, anim: undefined })), log: $('log').innerHTML, savedAt: Date.now() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { /* storage unavailable or full — play on without saving */ }
}
function readSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    return d && d.ogre && OGRE_SPECS[d.opts?.ogreType] ? d : null;
  } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
function loadGame() {
  const d = readSave();
  if (!d) return false;
  UI.runId++;
  if (UI.resolver) { const r = UI.resolver; UI.resolver = null; r(); }
  const { log: logHtml, savedAt, ...state } = d;
  S = state;
  S.ogre.rammed = new Set(S.ogre.rammed);
  S.ogre.spec = OGRE_SPECS[S.opts.ogreType];
  $('log').innerHTML = logHtml || '';
  $('banner').className = 'banner hidden';
  clearSel(); UI.busy = false; UI.placeType = 'HVY'; R.fx = [];
  runGame(UI.runId, true);
  return true;
}

// ---------- setup ----------
function newGame(opts) {
  UI.runId++;
  if (UI.resolver) { const r = UI.resolver; UI.resolver = null; r(); }
  const spec = OGRE_SPECS[opts.ogreType];
  const ogre = {
    c: COLS - 1, r: Math.floor(ROWS / 2), placed: false, treads: spec.treads, treadsMax: spec.treads,
    weapons: [], rammed: new Set(), mpLeft: 0, spec,
  };
  for (const [kind, count] of spec.weapons)
    for (let i = 0; i < count; i++) ogre.weapons.push({ id: kind + i, kind, ...WEAPONS[kind], alive: true, fired: false, spent: false });
  S = {
    opts, map: MapGen.generate(opts.seed), ogre, units: [], turn: 1, phase: 'setupDef',
    cpDestroyed: false, over: false, result: null, nextId: 1, budget: { armor: spec.armor, squads: spec.squads },
  };
  $('log').innerHTML = ''; $('banner').className = 'banner hidden';
  clearSel(); UI.busy = false; UI.placeType = 'HVY';
  R.fx = [];
  runGame(UI.runId);
}
function addUnit(type, c, r, squads = 3) {
  const u = { id: S.nextId++, type, c, r, alive: true, disabled: false, moved: false, fired: false, gevMoved: false, squads: type === 'INF' ? squads : 0 };
  S.units.push(u); return u;
}
function budgetUsed() {
  let armor = 0, squads = 0, cpN = 0;
  for (const u of S.units) {
    if (u.type === 'INF') squads += u.squads;
    else if (u.type === 'CP') cpN++;
    else armor += T(u).cost;
  }
  return { armor, squads, cpN };
}
function autoDeploy() {
  S.units = [];
  const spec = S.ogre.spec;
  const free = (c, r) => Hex.inBounds(c, r) && terr(c, r) !== 'crater' && !unitAt(c, r);
  const pick = (c0, c1, r0, r1) => {
    for (let i = 0; i < 400; i++) {
      const c = c0 + Math.floor(Math.random() * (c1 - c0 + 1)), r = r0 + Math.floor(Math.random() * (r1 - r0 + 1));
      if (free(c, r)) return { c, r };
    }
    for (let c = c0; c <= DEPLOY_MAX_COL; c++) for (let r = 0; r < ROWS; r++) if (free(c, r)) return { c, r };
  };
  const p = pick(0, 1, 4, ROWS - 5); const cpU = addUnit('CP', p.c, p.r);
  let armor = S.budget.armor;
  for (let i = 0; i < spec.hwz; i++) {
    const h = pick(cpU.c, cpU.c + 3, Math.max(0, cpU.r - 4), Math.min(ROWS - 1, cpU.r + 4));
    addUnit('HWZ', h.c, h.r); armor -= 2;
  }
  const gev = Math.round(armor * 0.3), msl = Math.round(armor * 0.3), hvy = armor - gev - msl;
  for (let i = 0; i < hvy; i++) { const h = pick(5, 11, 1, ROWS - 2); addUnit('HVY', h.c, h.r); }
  for (let i = 0; i < msl; i++) { const h = pick(3, 9, 1, ROWS - 2); addUnit('MSL', h.c, h.r); }
  for (let i = 0; i < gev; i++) { const h = pick(8, DEPLOY_MAX_COL, 0, ROWS - 1); addUnit('GEV', h.c, h.r); }
  let squads = S.budget.squads;
  while (squads > 0) {
    const n = Math.min(3, squads);
    const h = pick(cpU.c + 1, cpU.c + 6, Math.max(0, cpU.r - 4), Math.min(ROWS - 1, cpU.r + 4));
    addUnit('INF', h.c, h.r, n); squads -= n;
  }
}
function placeOgre(c, r) {
  Object.assign(S.ogre, { c, r, placed: true });
}
function placeClick(h) {
  const u = unitAt(h.c, h.r);
  if (u) { S.units = S.units.filter(x => x !== u); SFX.click(); refresh(); return; }
  if (terr(h.c, h.r) === 'crater') return flash('Cannot deploy in a crater.');
  const t = UI.placeType, used = budgetUsed();
  if (h.c > (t === 'CP' ? CP_MAX_COL : DEPLOY_MAX_COL))
    return flash(t === 'CP' ? `The Command Post must be in the first ${CP_MAX_COL + 1} columns.` : 'Deploy west of the dashed line.');
  if (t === 'CP') { if (used.cpN) return flash('Only one Command Post.'); addUnit('CP', h.c, h.r); UI.placeType = 'HVY'; }
  else if (t === 'INF') {
    const left = S.budget.squads - used.squads;
    if (left <= 0) return flash('No infantry squads left.');
    addUnit('INF', h.c, h.r, Math.min(3, left));
  } else {
    if (used.armor + UNIT_TYPES[t].cost > S.budget.armor) return flash('Not enough armor points left.');
    addUnit(t, h.c, h.r);
  }
  SFX.click(); refresh();
}

// ---------- game loop ----------
function waitHuman() { return new Promise(res => { UI.resolver = res; refresh(); }); }
function finishHuman() {
  if (UI.busy || !UI.resolver) return;
  if (S.phase === 'setupDef' && !cp()) return flash('Place your Command Post first.');
  const r = UI.resolver; UI.resolver = null; clearSel(); r();
}
function clearSel() { UI.selUnit = null; UI.selSet.clear(); UI.wSel.clear(); UI.reach = null; }

async function runGame(run, resumed = false) {
  const from = resumed ? S.phase : 'setupDef';
  if (from === 'setupDef') {
    S.phase = 'setupDef'; refresh();
    if (ctl('def') === 'ai') autoDeploy();
    else await waitHuman();
    if (run !== UI.runId) return;
  }
  if (from === 'setupDef' || from === 'setupOgre') {
    S.phase = 'setupOgre'; refresh();
    if (ctl('ogre') === 'ai') {
      const rows = [...Array(ROWS).keys()].filter(r => terr(COLS - 1, r) !== 'crater' && r > 1 && r < ROWS - 2);
      placeOgre(COLS - 1, rows[Math.floor(Math.random() * rows.length)]);
      await sleep(300);
    } else await waitHuman();
    if (run !== UI.runId) return;
    log(`The Juggernaut ${S.ogre.spec.label} has entered the battlefield.`, 'big');
  } else log(`Battle resumed.`, 'big');
  // a resumed game re-enters its saved phase without resetting per-phase flags
  let start = Math.max(0, PHASES.indexOf(from)), resumePhase = PHASES.includes(from);
  while (!S.over && run === UI.runId) {
    for (let i = start; i < PHASES.length; i++) {
      await runPhase(PHASES[i], run, resumePhase && i === start);
      if (stopped(run)) break;
    }
    if (stopped(run)) break;
    start = 0; resumePhase = false;
    endTurn();
  }
}
function phaseIsMoot(ph) {
  const o = S.ogre;
  if (ph === 'ogreMove') return o.mpLeft <= 0;
  if (ph === 'ogreFire') return !S.units.some(u => u.alive && liveWeapons().some(w => canWeaponHit(w, u)));
  if (ph === 'defMove') return !S.units.some(u => canMoveNow(u));
  if (ph === 'defFire') return !S.units.some(canFire);
  if (ph === 'defGev') return !S.units.some(u => canMoveNow(u));
  return false;
}
async function runPhase(ph, run, resumed = false) {
  S.phase = ph; clearSel();
  const o = S.ogre;
  if (!resumed) {
    if (ph === 'ogreMove') { o.mpLeft = ogreMP(); o.rammed.clear(); }
    if (ph === 'ogreFire') for (const w of o.weapons) w.fired = false;
    if (ph === 'defMove') for (const u of S.units) { u.moved = false; u.fired = false; u.gevMoved = false; }
  }
  refresh();
  if (phaseIsMoot(ph)) { await sleep(120); return; }
  const side = ph.startsWith('ogre') ? 'ogre' : 'def';
  if (ctl(side) === 'ai') {
    UI.busy = true; refresh();
    await sleep(350);
    await AI[ph](run);
    if (run !== UI.runId) return;
    UI.busy = false; refresh();
    await sleep(250);
  } else {
    if (ph === 'ogreMove') UI.reach = ogreReach();
    await waitHuman();
  }
  if (run === UI.runId) checkVictory();
}
function endTurn() {
  for (const u of S.units) u.disabled = false;
  S.turn++;
  if (S.turn > 40) end(S.cpDestroyed ? 'ogre-marginal' : 'defender');
}

// ---------- human actions ----------
async function onBoardClick(h) {
  if (!S || S.over || UI.busy || !h) return;
  SFX.ensure();
  const ph = S.phase;
  if (ph === 'setupDef' && ctl('def') === 'human') return placeClick(h);
  if (ph === 'setupOgre' && ctl('ogre') === 'human') {
    if (h.c === COLS - 1 && terr(h.c, h.r) !== 'crater') { placeOgre(h.c, h.r); SFX.stomp(); finishHuman(); }
    else flash('Choose a hex on the east (right) edge.');
    return;
  }
  if (ph === 'ogreMove' && ctl('ogre') === 'human') {
    const k = Hex.key(h.c, h.r);
    if (!UI.reach || !UI.reach.ends.has(k)) return;
    const path = pathTo(UI.reach.all, k);
    UI.busy = true; UI.reach = null; refresh();
    await moveOgre(path, UI.runId);
    UI.busy = false;
    if (S.over) return;
    if (S.ogre.mpLeft <= 0) finishHuman(); else { UI.reach = ogreReach(); refresh(); }
    return;
  }
  if (ph === 'ogreFire' && ctl('ogre') === 'human') {
    const u = unitAt(h.c, h.r);
    if (!u) return;
    if (!UI.wSel.size) return flash('Select Juggernaut weapons in the side panel first.');
    const weps = S.ogre.weapons.filter(w => UI.wSel.has(w.id));
    const bad = weps.filter(w => !canWeaponHit(w, u));
    if (bad.length) return flash(`${describeWeapons(bad)} can't hit that target.`);
    UI.busy = true; UI.wSel.clear(); refresh();
    await ogreAttack(weps, u, UI.runId);
    UI.busy = false; refresh();
    if (!S.over && phaseIsMoot('ogreFire')) finishHuman();
    return;
  }
  if ((ph === 'defMove' || ph === 'defGev') && ctl('def') === 'human') {
    const k = Hex.key(h.c, h.r);
    if (UI.selUnit && UI.reach && UI.reach.ends.has(k)) {
      const u = UI.selUnit, path = pathTo(UI.reach.all, k);
      UI.busy = true; UI.reach = null; refresh();
      await moveUnit(u, path);
      if (ph === 'defGev') u.gevMoved = true; else u.moved = true;
      UI.busy = false; UI.selUnit = null; refresh();
      return;
    }
    const u = unitAt(h.c, h.r);
    if (u && canMoveNow(u) && u !== UI.selUnit) {
      UI.selUnit = u; UI.reach = unitReach(u, ph === 'defGev' ? T(u).mov2 : T(u).mov); SFX.click();
    } else { UI.selUnit = null; UI.reach = null; }
    refresh();
    return;
  }
  if (ph === 'defFire' && ctl('def') === 'human') {
    const u = unitAt(h.c, h.r);
    if (u && canFire(u)) { UI.selSet.has(u) ? UI.selSet.delete(u) : UI.selSet.add(u); SFX.click(); }
    else if (u && u.type !== 'CP' && !u.fired) flash(u.disabled ? 'That unit is disabled this turn.' : 'The Juggernaut is out of range of that unit.');
    else if (!ogreAt(h.c, h.r)) UI.selSet.clear();
    refresh();
  }
}
async function humanDefFire(kind) {
  if (UI.busy || !UI.selSet.size) return;
  const units = [...UI.selSet];
  UI.busy = true; UI.selSet.clear(); refresh();
  await defenderAttack(units, kind, UI.runId);
  UI.busy = false; refresh();
  if (!S.over && phaseIsMoot('defFire')) finishHuman();
}

// ---------- panels ----------
function refresh() {
  if (!S) return;
  if (!UI.busy) saveGame();
  $('turnLabel').textContent = `Turn ${S.turn}`;
  const pl = $('phaseLabel');
  pl.textContent = PHASE_NAMES[S.phase] || S.phase;
  const side = S.phase === 'over' ? '' : S.phase.startsWith('ogre') || S.phase === 'setupOgre' ? 'ogre' : 'def';
  pl.className = 'phase ' + side;
  const who = side && ctl(side) === 'ai' ? 'Computer' : side ? (S.opts.mode === 'hotseat' ? (side === 'ogre' ? 'Juggernaut player' : 'Defense player') : 'Your move') : '';
  $('whoLabel').textContent = who;
  const btn = $('btnEndPhase');
  btn.disabled = !UI.resolver || UI.busy || S.phase === 'setupOgre';
  btn.textContent = S.phase === 'setupDef' ? 'Deploy ✓' : 'End Phase';
  renderOgrePanel(); renderActionPanel();
}

function renderOgrePanel() {
  const o = S.ogre, el = $('ogrePanel');
  const humanFire = S.phase === 'ogreFire' && ctl('ogre') === 'human' && !UI.busy;
  const groups = ['msl', 'main', 'sec', 'ap'].map(kind => {
    const ws = o.weapons.filter(w => w.kind === kind);
    if (!ws.length) return '';
    const W = WEAPONS[kind], alive = ws.filter(w => w.alive).length;
    const boxes = ws.map(w => {
      let cls = 'wbox';
      if (!w.alive) cls += w.spent ? ' spent' : ' dead';
      else if (w.fired && S.phase === 'ogreFire') cls += ' fired';
      else if (humanFire) cls += ' pick';
      if (UI.wSel.has(w.id)) cls += ' sel';
      const st = !w.alive ? (w.spent ? 'fired (one-shot)' : 'destroyed') : w.fired && S.phase === 'ogreFire' ? 'fired this turn' : 'ready';
      return `<button class="${cls}" data-wid="${w.id}" title="${W.name} — ${st}" ${humanFire && w.alive && !w.fired ? '' : 'tabindex="-1"'}>${W.atk}</button>`;
    }).join('');
    return `<div class="wgroup"><div class="wlabel"><span>${W.name}${ws.length > 1 ? 's' : ''} <b>${alive}/${ws.length}</b></span><span class="stat">atk ${W.atk} · rng ${W.rng} · def ${W.def}</span></div><div class="boxes">${boxes}</div></div>`;
  }).join('');
  const pct = o.treads / o.treadsMax * 100;
  const tcls = pct > 66 ? 'ok' : pct > 33 ? 'warn' : 'bad';
  el.innerHTML = `<div class="ph"><h3>Juggernaut ${o.spec.label}</h3><span class="chip ogre">Move ${ogreMP()}${S.phase === 'ogreMove' && o.mpLeft !== ogreMP() ? ` · ${o.mpLeft} left` : ''}</span></div>
    <div class="treads"><div class="tlabel"><span>Treads</span><span>${o.treads} / ${o.treadsMax}</span></div><div class="bar ${tcls}"><i style="width:${pct}%"></i></div></div>
    ${groups}`;
}

function forcesHtml() {
  const counts = {};
  for (const u of S.units) if (u.alive) counts[u.type] = (counts[u.type] || 0) + (u.type === 'INF' ? u.squads : 1);
  const order = ['HVY', 'MSL', 'GEV', 'HWZ', 'INF', 'CP'];
  return `<div class="forces">${order.filter(t => counts[t]).map(t => `<span><b>${counts[t]}</b> ${t === 'INF' ? 'squads' : UNIT_TYPES[t].name}</span>`).join('')}${S.cpDestroyed ? '<span class="bad">CP destroyed</span>' : ''}</div>`;
}

function renderActionPanel() {
  const el = $('actionPanel'), ph = S.phase;
  const side = ph.startsWith('ogre') || ph === 'setupOgre' ? 'ogre' : 'def';
  let html = '';
  if (ph === 'over') {
    html = `<h3>Battle over</h3><p class="hint">${$('banner').querySelector('h2')?.textContent || ''}</p>`;
  } else if (ctl(side) === 'ai') {
    html = `<h3>${side === 'ogre' ? 'The Juggernaut' : 'The defense'} is acting…</h3><p class="hint thinking">Computer is planning ${PHASE_NAMES[ph].toLowerCase()}.</p>`;
  } else if (ph === 'setupDef') {
    const used = budgetUsed();
    const pal = ['CP', 'HVY', 'MSL', 'GEV', 'HWZ', 'INF'].map(t => {
      const U = UNIT_TYPES[t];
      const cost = t === 'INF' ? '3 squads' : t === 'CP' ? 'required' : `${U.cost} pt${U.cost > 1 ? 's' : ''}`;
      const stats = t === 'CP' ? 'defense 0' : `${U.atk}/${U.rng} · def ${U.def} · mv ${U.mov}${U.mov2 ? '+' + U.mov2 : ''}`;
      return `<button class="pal ${UI.placeType === t ? 'sel' : ''}" data-place="${t}"><b>${U.name}</b><span>${stats}</span><em>${cost}</em></button>`;
    }).join('');
    html = `<h3>Deploy your defense</h3>
      <p class="hint">Pick a unit type, then click hexes west of the dashed line. Click a placed unit to remove it. The Command Post must sit in the first ${CP_MAX_COL + 1} columns.</p>
      <div class="budget"><span>Armor <b>${used.armor}/${S.budget.armor}</b></span><span>Infantry <b>${used.squads}/${S.budget.squads}</b></span><span>CP <b>${used.cpN}/1</b></span></div>
      <div class="palette">${pal}</div>
      <div class="row"><button data-act="auto">Auto-deploy</button><button data-act="clear">Clear</button></div>`;
  } else if (ph === 'setupOgre') {
    html = `<h3>Choose your entry point</h3><p class="hint">Click any glowing hex on the east (right) edge. Your objective lies somewhere to the west.</p>
      <div class="row"><button data-act="randEntry">Random entry</button></div>`;
  } else if (ph === 'ogreMove') {
    html = `<h3>Move the Juggernaut</h3><p class="hint">Click a highlighted hex (${S.ogre.mpLeft} MP left). Rolling over armor <b>rams</b> it — the unit dies, you lose treads. Rolling over infantry crushes a squad.${S.cpDestroyed ? ' <b>The CP is down — escape off the east edge!</b>' : ''}</p>`;
  } else if (ph === 'ogreFire') {
    const weps = S.ogre.weapons.filter(w => UI.wSel.has(w.id)), atk = weps.reduce((s, w) => s + w.atk, 0);
    html = `<h3>Juggernaut fire</h3><p class="hint">Click weapon boxes above to group them, then click a target on the map. AP guns can only hit infantry and the CP. Missiles are one-shot.</p>
      <div class="budget"><span>Selected attack <b>${atk}</b></span><span>Max range <b>${weps.length ? Math.min(...weps.map(w => w.rng)) : '–'}</b></span></div>
      <div class="row"><button data-act="clearW">Clear selection</button></div>`;
  } else if (ph === 'defMove' || ph === 'defGev') {
    const u = UI.selUnit;
    html = `<h3>${ph === 'defGev' ? 'Hovertank second move' : 'Move your units'}</h3>
      <p class="hint">${ph === 'defGev' ? 'Hovertanks may move again (3 MP) after firing — duck out of the Juggernaut\'s range.' : 'Click a unit with a green outline, then a highlighted hex. Rubble costs 2 MP for armor; craters are impassable.'}</p>
      ${u ? `<div class="selbox"><b>${T(u).name}</b> selected · ${ph === 'defGev' ? T(u).mov2 : T(u).mov} MP</div>` : ''}`;
  } else if (ph === 'defFire') {
    const units = [...UI.selSet], atk = units.reduce((s, u) => s + uAtk(u), 0);
    const o = S.ogre;
    let targets = '';
    if (units.length) {
      targets = ['msl', 'main', 'sec', 'ap'].map(kind => {
        const n = o.weapons.filter(w => w.kind === kind && w.alive).length;
        if (!n) return '';
        const W = WEAPONS[kind], idx = Rules.oddsIndex(atk, W.def);
        return `<button class="tgt" data-target="${kind}" ${idx < 0 ? 'disabled' : ''}><span>${W.name} <small>×${n}</small></span><span class="odds">${atk} vs ${W.def} · <b>${Rules.label(idx)}</b> · ${Math.round(Rules.pKill(idx) * 100)}%</span></button>`;
      }).join('') + (o.treads > 0 ? `<button class="tgt" data-target="treads"><span>Treads <small>${o.treads}</small></span><span class="odds">each unit 1:1 · <b>${Math.round(Rules.pKill(1) * 100)}%</b> to strip its attack in treads</span></button>` : '');
    }
    html = `<h3>Fire on the Juggernaut</h3>
      <p class="hint">Click units in range (green outline) to group them, then choose a target system. Combine fire for better odds; tread attacks are rolled per unit.</p>
      <div class="budget"><span>Units <b>${units.length}</b></span><span>Attack <b>${atk}</b></span></div>
      <div class="targets">${targets || '<p class="hint dim">No units selected.</p>'}</div>`;
  }
  el.innerHTML = html + (S.units.length ? forcesHtml() : '');
}

function tooltipFor(h) {
  if (!S || !h) return null;
  if (ogreAt(h.c, h.r)) {
    const o = S.ogre, ws = liveWeapons();
    return `<b>Juggernaut ${o.spec.label}</b><br>Treads ${o.treads}/${o.treadsMax} · Move ${ogreMP()}<br>${ws.length} weapon systems online`;
  }
  const u = unitAt(h.c, h.r);
  if (u) {
    const t = T(u);
    let s = `<b>${t.name}</b>`;
    s += u.type === 'CP' ? '<br>Defense 0 — any hit destroys it' : `<br>Attack ${uAtk(u)} · Range ${t.rng} · Defense ${uDef(u)} · Move ${t.mov}${t.mov2 ? '+' + t.mov2 : ''}`;
    if (u.type === 'INF') s += `<br>${u.squads} squad${u.squads > 1 ? 's' : ''}`;
    if (u.disabled) s += '<br><span class="bad">Disabled this turn</span>';
    if (S.phase === 'ogreFire' && UI.wSel.size) {
      const weps = S.ogre.weapons.filter(w => UI.wSel.has(w.id)), atk = weps.reduce((a, w) => a + w.atk, 0);
      const idx = Rules.oddsIndex(atk, uDef(u));
      s += weps.every(w => canWeaponHit(w, u))
        ? `<br>Attack ${atk} vs ${uDef(u)} → <b>${Rules.label(idx)}</b> · ${Math.round(Rules.pKill(idx) * 100)}% kill`
        : '<br><span class="bad">Out of range / invalid</span>';
    }
    return s;
  }
  const t = terr(h.c, h.r);
  return t === 'crater' ? 'Crater — impassable' : t === 'rubble' ? 'Rubble — 2 MP for armor, 1 for infantry' : null;
}

// ---------- menu / boot ----------
function readMenu() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  const ogreType = document.querySelector('input[name=ogreType]:checked').value;
  const seed = parseInt($('seed').value, 10) || 1;
  return {
    mode, ogreType, seed,
    ogreCtl: mode === 'def' ? 'ai' : 'human',
    defCtl: mode === 'ogre' ? 'ai' : 'human',
  };
}
function randomSeed() { $('seed').value = Math.floor(Math.random() * 99999) + 1; }
function openMenu() {
  $('menu').classList.remove('hidden');
  $('btnResume').hidden = !S || S.over;
  const save = !S || S.over ? readSave() : null;
  $('btnContinue').hidden = !save;
  if (save) $('btnContinue').textContent = `Continue saved battle · turn ${save.turn}`;
}
function closeMenu() { $('menu').classList.add('hidden'); }

function boot() {
  R.init($('board'));
  randomSeed();
  const cv = $('board'), tip = $('tooltip');
  cv.addEventListener('mousemove', e => {
    const b = cv.getBoundingClientRect(), h = R.pick(e.clientX - b.left, e.clientY - b.top);
    UI.hover = h;
    const html = tooltipFor(h);
    if (html) {
      tip.innerHTML = html; tip.classList.remove('hidden');
      const x = e.clientX - b.left + 16, y = e.clientY - b.top + 16;
      tip.style.left = Math.min(x, b.width - tip.offsetWidth - 8) + 'px';
      tip.style.top = Math.min(y, b.height - tip.offsetHeight - 8) + 'px';
    } else tip.classList.add('hidden');
  });
  cv.addEventListener('mouseleave', () => { UI.hover = null; tip.classList.add('hidden'); });
  cv.addEventListener('click', e => {
    const b = cv.getBoundingClientRect();
    onBoardClick(R.pick(e.clientX - b.left, e.clientY - b.top));
  });
  cv.addEventListener('contextmenu', e => { e.preventDefault(); if (!UI.busy) { clearSel(); refresh(); } });

  $('btnEndPhase').onclick = () => { SFX.ensure(); finishHuman(); };
  $('btnMenu').onclick = openMenu;
  $('btnHelp').onclick = () => $('help').classList.remove('hidden');
  $('btnSound').onclick = () => { SFX.on = !SFX.on; $('btnSound').textContent = SFX.on ? 'Sound on' : 'Sound off'; SFX.ensure(); };
  $('btnStart').onclick = () => { SFX.ensure(); closeMenu(); newGame(readMenu()); };
  $('btnResume').onclick = closeMenu;
  $('btnContinue').onclick = () => { SFX.ensure(); closeMenu(); loadGame(); };
  $('btnReroll').onclick = randomSeed;
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => b.closest('.modal').classList.add('hidden'));

  $('ogrePanel').addEventListener('click', e => {
    const b = e.target.closest('[data-wid]');
    if (!b || S.phase !== 'ogreFire' || ctl('ogre') !== 'human' || UI.busy) return;
    const w = S.ogre.weapons.find(x => x.id === b.dataset.wid);
    if (!w.alive || w.fired) return;
    UI.wSel.has(w.id) ? UI.wSel.delete(w.id) : UI.wSel.add(w.id);
    SFX.click(); refresh();
  });
  $('actionPanel').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || UI.busy) return;
    SFX.ensure();
    if (b.dataset.place) { UI.placeType = b.dataset.place; SFX.click(); refresh(); }
    else if (b.dataset.target) humanDefFire(b.dataset.target);
    else if (b.dataset.act === 'auto') { autoDeploy(); refresh(); }
    else if (b.dataset.act === 'clear') { S.units = []; refresh(); }
    else if (b.dataset.act === 'clearW') { UI.wSel.clear(); refresh(); }
    else if (b.dataset.act === 'randEntry') {
      const rows = [...Array(ROWS).keys()].filter(r => terr(COLS - 1, r) !== 'crater');
      placeOgre(COLS - 1, rows[Math.floor(Math.random() * rows.length)]); SFX.stomp(); finishHuman();
    }
  });
  $('banner').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'rematch') newGame(S.opts);
    if (b.dataset.act === 'menu') openMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') {
      const open = document.querySelector('.modal:not(.hidden)');
      if (open && open.id === 'help') open.classList.add('hidden');
      else if (S && !UI.busy) { clearSel(); refresh(); }
    }
    if ((e.key === 'Enter' || e.key === 'e') && S && document.querySelector('#menu.hidden')) { e.preventDefault(); finishHuman(); }
  });
  buildHelp();
  openMenu();
}

function buildHelp() {
  const head = Rules.ODDS.map(o => `<th>${o}</th>`).join('');
  const rows = Rules.CRT.map((row, i) => `<tr><th>${i + 1}</th>${row.map(r => `<td class="${r}">${r}</td>`).join('')}</tr>`).join('');
  $('crt').innerHTML = `<thead><tr><th>Die</th>${head}</tr></thead><tbody>${rows}</tbody>`;
  const ut = Object.entries(UNIT_TYPES).map(([k, u]) =>
    `<tr><td>${u.name}</td><td>${u.atk}${u.perSquad ? '/squad' : ''}</td><td>${u.rng}</td><td>${u.def}${u.perSquad ? '/squad' : ''}</td><td>${u.mov}${u.mov2 ? '+' + u.mov2 : ''}</td><td>${k === 'CP' ? '—' : k === 'INF' ? '3 squads/stack' : u.cost}</td></tr>`).join('');
  $('unitTable').innerHTML = `<thead><tr><th>Unit</th><th>Atk</th><th>Rng</th><th>Def</th><th>Move</th><th>Cost</th></tr></thead><tbody>${ut}</tbody>`;
}

window.addEventListener('DOMContentLoaded', boot);
