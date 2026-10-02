'use strict';
// Computer opponents for both sides. Simple heuristics, but they play the classic
// game plan: the Juggernaut drives for the CP while saving a missile for it; the defense
// knocks out the Juggernaut's long-range weapons first and chips at its treads.

const AI = {
  // ---------------- Juggernaut ----------------
  async ogreMove(run) {
    const o = S.ogre, reach = ogreReach();
    let best = null, bestScore = this.scoreOgre(o.c, o.r, []);
    for (const k of reach.ends) {
      const n = reach.all.get(k), path = pathTo(reach.all, k);
      const s = this.scoreOgre(n.c, n.r, path) + Math.random() * 2;
      if (s > bestScore) { bestScore = s; best = path; }
    }
    if (best) await moveOgre(best, run);
  },

  scoreOgre(c, r, path) {
    const o = S.ogre, here = { c, r };
    let s = 0, lostTreads = 0, hitsCP = false;
    for (const h of path) {
      const u = unitAt(h.c, h.r);
      if (!u || o.rammed.has(u.id)) continue;
      if (u.type === 'CP') { hitsCP = true; s += 2000; }
      else if (u.type === 'INF') s += 3;
      else { s += unitValue(u) * 2; lostTreads += T(u).ram; }
    }
    s -= lostTreads * 2.5 * (45 / o.treadsMax);
    const maxR = Math.max(0, ...liveWeapons().map(w => w.rng));
    if (!S.cpDestroyed && !hitsCP) {
      const d = Hex.dist(here, cp());
      s -= d * 12;
      if (d <= maxR) s += 400;
    } else {
      s += c * 15;
      if (c === COLS - 1) s += 2000;
    }
    for (const u of S.units) {
      if (!u.alive || u.type === 'CP') continue;
      const d = Hex.dist(here, u);
      if (d <= 3) s += unitValue(u) * 0.6;
      if (d <= T(u).rng) s -= uAtk(u) * 0.3;   // mild preference for fewer guns on it
    }
    return s;
  },

  async ogreFire(run) {
    const o = S.ogre;
    let avail = o.weapons.filter(w => w.alive && !w.fired);
    const cpu = cp();
    // Any hit on the CP destroys it — use the cheapest gun that reaches.
    if (!S.cpDestroyed && cpu.alive) {
      const inR = avail.filter(w => canWeaponHit(w, cpu)).sort((a, b) => a.atk - b.atk || (a.kind === 'msl') - (b.kind === 'msl'));
      if (inR.length) {
        await ogreAttack([inR[0]], cpu, run);
        if (stopped(run)) return;
        avail = avail.filter(w => w !== inR[0]);
      }
    }
    const missiles = avail.filter(w => w.kind === 'msl').length;
    const reserve = !S.cpDestroyed && o.treads > o.treadsMax * 0.34 ? 1 : 0;
    let missileBudget = Math.max(0, missiles - reserve);

    const targets = S.units.filter(u => u.alive && u.type !== 'CP')
      .map(u => ({ u, v: unitValue(u) * (u.disabled ? 0.7 : 1) + (Hex.dist(o, u) <= T(u).rng ? 2 : 0) }))
      .sort((a, b) => b.v - a.v);

    for (const { u } of targets) {
      if (stopped(run)) return;
      if (!u.alive) continue;
      const def = uDef(u);
      const cand = avail.filter(w => canWeaponHit(w, u))
        .filter(w => w.kind !== 'msl' || (missileBudget > 0 && unitValue(u) >= 5))
        .sort((a, b) => (a.kind === 'msl') - (b.kind === 'msl') || b.atk - a.atk);
      if (!cand.length) continue;
      const goal = def * 3;
      let pick = [], sum = 0, mUsed = 0;
      for (const w of cand) {
        if (sum >= goal) break;
        if (w.kind === 'msl' && mUsed >= missileBudget) continue;
        if (w.kind === 'msl') mUsed++;
        pick.push(w); sum += w.atk;
      }
      if (sum < def * 2 && !(sum >= def && avail.length - pick.length < 2)) {
        if (sum < def) continue;
      }
      for (const w of [...pick].sort((a, b) => a.atk - b.atk))
        if (sum - w.atk >= goal) { pick = pick.filter(x => x !== w); sum -= w.atk; }
      await ogreAttack(pick, u, run);
      avail = avail.filter(w => !pick.includes(w));
      missileBudget -= pick.filter(w => w.kind === 'msl').length;
    }
  },

  // ---------------- Defense ----------------
  async defMove(run) {
    const units = S.units.filter(u => canMoveNow(u))
      .sort((a, b) => Hex.dist(a, S.ogre) - Hex.dist(b, S.ogre));
    for (const u of units) {
      if (stopped(run)) return;
      const reach = unitReach(u, T(u).mov);
      let best = null, bestScore = this.scoreDef(u, u.c, u.r);
      for (const k of reach.ends) {
        const n = reach.all.get(k), s = this.scoreDef(u, n.c, n.r) + Math.random();
        if (s > bestScore) { bestScore = s; best = pathTo(reach.all, k); }
      }
      if (best) { await moveUnit(u, best); refresh(); }
      u.moved = true;
    }
  },

  scoreDef(u, c, r) {
    const o = S.ogre, here = { c, r }, d = Hex.dist(here, o), rng = T(u).rng;
    let s = 0;
    if (d <= rng) s += 100 + d * 4;
    else s -= (d - rng) * 10;
    if (u.type !== 'INF' && d <= 1) s -= 25;           // don't invite a ram
    if (u.type === 'INF') {
      // infantry hangs back to screen the CP unless the Juggernaut comes to them
      const dc = Hex.dist(here, cp());
      s -= Math.max(0, dc - 4) * 4;
    }
    return s;
  },

  // Tuned by AI-vs-AI simulation: 1:1 is the most kill-per-point column on the CRT, and
  // after the missiles (the CP snipers) are gone, treads beat every other target.
  oddsGoal: 1,
  targetKinds: ['msl'],

  async defFire(run) {
    const o = S.ogre;
    let avail = S.units.filter(canFire);
    if (!avail.length) return;
    for (const kind of this.targetKinds) {
      for (const comp of o.weapons.filter(w => w.kind === kind && w.alive)) {
        if (stopped(run)) return;
        const need = comp.def * this.oddsGoal;
        const total = avail.reduce((s, u) => s + uAtk(u), 0);
        if (total < need) break;
        const pick = this.cheapestGroup(avail, need);
        await defenderAttack(pick, kind, run);
        avail = avail.filter(u => !pick.includes(u));
      }
    }
    if (stopped(run)) return;
    if (avail.length && o.treads > 0) await defenderAttack(avail, 'treads', run);
  },

  // Smallest-overshoot group of units whose attack reaches `need`.
  cheapestGroup(units, need) {
    const single = units.filter(u => uAtk(u) >= need).sort((a, b) => uAtk(a) - uAtk(b))[0];
    let pick = [], sum = 0;
    for (const u of [...units].sort((a, b) => uAtk(b) - uAtk(a))) { if (sum >= need) break; pick.push(u); sum += uAtk(u); }
    for (const u of [...pick].sort((a, b) => uAtk(a) - uAtk(b)))
      if (sum - uAtk(u) >= need) { pick = pick.filter(x => x !== u); sum -= uAtk(u); }
    return single && uAtk(single) <= sum ? [single] : pick;
  },

  async defGev(run) {
    const o = S.ogre;
    for (const u of S.units.filter(x => canMoveNow(x))) {
      if (stopped(run)) return;
      const reach = unitReach(u, T(u).mov2);
      const score = (c, r) => { const d = Hex.dist({ c, r }, o); return Math.min(d, 6) * 10 - d; };
      let best = null, bestScore = score(u.c, u.r);
      for (const k of reach.ends) {
        const n = reach.all.get(k), s = score(n.c, n.r);
        if (s > bestScore) { bestScore = s; best = pathTo(reach.all, k); }
      }
      if (best) { await moveUnit(u, best); refresh(); }
      u.gevMoved = true;
    }
  },
};
