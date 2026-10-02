'use strict';
const SQ3 = Math.sqrt(3);

const R = {
  cv: null, ctx: null, s: 24, ox: 0, oy: 0, w: 0, h: 0, dpr: 1, fx: [], cache: null, cacheFor: null,

  init(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(cv.parentElement);
    this.resize();
    const loop = () => { this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  },

  resize() {
    const b = this.cv.parentElement.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = b.width; this.h = b.height;
    this.cv.width = Math.round(b.width * this.dpr); this.cv.height = Math.round(b.height * this.dpr);
    this.cv.style.width = b.width + 'px'; this.cv.style.height = b.height + 'px';
    const pad = 14;
    this.s = Math.max(8, Math.min((this.w - pad * 2) / (1.5 * COLS + 0.5), (this.h - pad * 2) / (SQ3 * (ROWS + 0.5))));
    const mw = this.s * (1.5 * COLS + 0.5), mh = this.s * SQ3 * (ROWS + 0.5);
    this.ox = (this.w - mw) / 2; this.oy = (this.h - mh) / 2;
    this.cache = null;
  },

  center(c, r) {
    return { x: this.ox + this.s + 1.5 * this.s * c, y: this.oy + SQ3 / 2 * this.s + SQ3 * this.s * (r + 0.5 * (c & 1)) };
  },
  pos(e) {
    if (e.anim) {
      const p = Math.min(1, (performance.now() - e.anim.t0) / e.anim.dur), q = p * p * (3 - 2 * p);
      const a = this.center(e.anim.c0, e.anim.r0), b = this.center(e.anim.c1, e.anim.r1);
      return { x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q };
    }
    return this.center(e.c, e.r);
  },
  pick(x, y) {
    let best = null, bd = Infinity;
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const p = this.center(c, r), d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = { c, r }; }
    }
    return bd <= this.s * this.s ? best : null;
  },
  hexPath(ctx, x, y, s) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; ctx.lineTo(x + s * Math.cos(a), y + s * Math.sin(a)); }
    ctx.closePath();
  },

  // ---------- terrain layer (cached) ----------
  buildCache() {
    const cv = document.createElement('canvas');
    cv.width = this.cv.width; cv.height = this.cv.height;
    const ctx = cv.getContext('2d'); ctx.scale(this.dpr, this.dpr);
    const s = this.s, rnd = MapGen.rng(S.map.seed * 31 + 7);
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const { x, y } = this.center(c, r), t = S.map.t[r * COLS + c];
      const v = Math.floor(rnd() * 8);
      this.hexPath(ctx, x, y, s);
      ctx.fillStyle = `rgb(${24 + v},${33 + v},${30 + v})`; ctx.fill();
      ctx.strokeStyle = 'rgba(120,170,150,0.16)'; ctx.lineWidth = 1; ctx.stroke();
      if (t === 'crater') {
        const g = ctx.createRadialGradient(x - s * 0.1, y - s * 0.1, s * 0.05, x, y, s * 0.72);
        g.addColorStop(0, '#05070a'); g.addColorStop(0.65, '#10161a'); g.addColorStop(1, 'rgba(90,110,100,0.5)');
        ctx.beginPath(); ctx.ellipse(x, y, s * 0.7, s * 0.6, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(160,180,170,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
      } else if (t === 'rubble') {
        for (let i = 0; i < 9; i++) {
          const a = rnd() * Math.PI * 2, d = rnd() * s * 0.6, rs = s * (0.06 + rnd() * 0.1);
          ctx.save(); ctx.translate(x + Math.cos(a) * d, y + Math.sin(a) * d); ctx.rotate(rnd() * 3);
          ctx.fillStyle = `rgba(${110 + v * 6},${115 + v * 4},${100},0.55)`;
          ctx.fillRect(-rs, -rs * 0.6, rs * 2, rs * 1.2); ctx.restore();
        }
      } else if (rnd() < 0.25) {
        ctx.fillStyle = 'rgba(140,170,150,0.06)';
        ctx.beginPath(); ctx.arc(x + (rnd() - 0.5) * s, y + (rnd() - 0.5) * s, s * 0.15, 0, Math.PI * 2); ctx.fill();
      }
    }
    this.cache = cv; this.cacheFor = S.map;
  },

  // ---------- frame ----------
  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#06090c'; ctx.fillRect(0, 0, this.w, this.h);
    if (!S) return;
    if (!this.cache || this.cacheFor !== S.map) this.buildCache();
    ctx.drawImage(this.cache, 0, 0, this.w, this.h);
    const now = performance.now();
    this.drawOverlays(now);
    for (const u of S.units) if (u.alive) this.drawUnit(u, now);
    if (S.ogre.placed) this.drawOgre(now);
    this.drawFx(now);
    if (UI.hover) {
      const { x, y } = this.center(UI.hover.c, UI.hover.r);
      this.hexPath(ctx, x, y, this.s - 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  },

  fillHex(c, r, fill, stroke, lw = 1.5) {
    const ctx = this.ctx, { x, y } = this.center(c, r);
    this.hexPath(ctx, x, y, this.s - 1.5);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  },

  drawOverlays(now) {
    const ctx = this.ctx, pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const ph = S.phase;
    // Juggernaut entry edge
    if (ph === 'setupDef' || ph === 'setupOgre') {
      for (let r = 0; r < ROWS; r++) if (S.map.t[r * COLS + COLS - 1] !== 'crater')
        this.fillHex(COLS - 1, r, `rgba(255,90,54,${ph === 'setupOgre' && ctl('ogre') === 'human' ? 0.15 + 0.2 * pulse : 0.08})`, ph === 'setupOgre' ? 'rgba(255,120,80,0.6)' : null);
    }
    if (ph === 'setupDef' && ctl('def') === 'human') {
      const maxC = UI.placeType === 'CP' ? CP_MAX_COL : DEPLOY_MAX_COL;
      for (let c = 0; c <= maxC; c++) for (let r = 0; r < ROWS; r++)
        if (S.map.t[r * COLS + c] !== 'crater') this.fillHex(c, r, UI.placeType === 'CP' ? 'rgba(255,200,80,0.10)' : 'rgba(57,208,255,0.06)');
      // deploy line
      const a = this.center(DEPLOY_MAX_COL, 0), b = this.center(DEPLOY_MAX_COL, ROWS - 1);
      ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(57,208,255,0.5)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x + this.s * 0.9, this.oy); ctx.lineTo(b.x + this.s * 0.9, this.oy + this.s * SQ3 * (ROWS + 0.5)); ctx.stroke(); ctx.restore();
    }
    // hovered entity's weapon range
    const hu = UI.hover && (S.ogre.placed && ogreAt(UI.hover.c, UI.hover.r) ? S.ogre : unitAt(UI.hover.c, UI.hover.r));
    if (hu && !UI.reach && !S.phase.startsWith('setup')) {
      const rng = hu === S.ogre ? Math.max(0, ...liveWeapons().map(w => w.rng)) : T(hu).rng;
      const col = hu === S.ogre ? 'rgba(255,90,54,0.07)' : 'rgba(57,208,255,0.07)';
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
        const d = Hex.dist(hu, { c, r });
        if (d > 0 && d <= rng) this.fillHex(c, r, col);
      }
    }
    // move reach
    if (UI.reach) {
      const isOgre = ph === 'ogreMove';
      for (const k of UI.reach.ends) {
        const n = UI.reach.all.get(k);
        this.fillHex(n.c, n.r, isOgre ? 'rgba(255,120,60,0.16)' : 'rgba(93,255,154,0.14)', isOgre ? 'rgba(255,140,90,0.45)' : 'rgba(93,255,154,0.45)', 1);
      }
      // preview path to hovered hex
      if (UI.hover && UI.reach.ends.has(Hex.key(UI.hover.c, UI.hover.r))) {
        const path = pathTo(UI.reach.all, Hex.key(UI.hover.c, UI.hover.r));
        const mover = isOgre ? S.ogre : UI.selUnit;
        if (mover) {
          ctx.beginPath(); const p0 = this.pos(mover); ctx.moveTo(p0.x, p0.y);
          for (const h of path) { const p = this.center(h.c, h.r); ctx.lineTo(p.x, p.y); }
          ctx.strokeStyle = isOgre ? 'rgba(255,170,120,0.85)' : 'rgba(150,255,190,0.85)';
          ctx.lineWidth = 2.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    // ogre fire targets
    if (ph === 'ogreFire' && UI.wSel.size) {
      const weps = S.ogre.weapons.filter(w => UI.wSel.has(w.id));
      for (const u of S.units) if (u.alive && weps.every(w => canWeaponHit(w, u)))
        this.fillHex(u.c, u.r, `rgba(255,60,40,${0.12 + 0.12 * pulse})`, 'rgba(255,90,60,0.9)', 2);
    }
    // defender selection targeting ogre
    if (ph === 'defFire' && UI.selSet.size && S.ogre.placed)
      this.fillHex(S.ogre.c, S.ogre.r, `rgba(255,214,74,${0.1 + 0.15 * pulse})`, `rgba(255,214,74,${0.6 + 0.4 * pulse})`, 3);
  },

  drawUnit(u, now) {
    const ctx = this.ctx, { x, y } = this.pos(u), s = this.s * 0.64;
    const ph = S.phase, human = ctl('def') === 'human' && !UI.busy;
    const selected = UI.selUnit === u || UI.selSet.has(u);
    let ready = false, spent = false;
    if (human && (ph === 'defMove' || ph === 'defGev')) { ready = canMoveNow(u); spent = !ready && T(u).mov > 0; }
    if (human && ph === 'defFire') { ready = canFire(u); spent = u.fired; }
    ctx.save(); ctx.translate(x, y);
    if (selected) {
      ctx.shadowColor = '#ffd64a'; ctx.shadowBlur = 16;
    } else { ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2; }
    this.roundRect(ctx, -s, -s, s * 2, s * 2, s * 0.2);
    const g = ctx.createLinearGradient(0, -s, 0, s);
    if (u.type === 'CP') { g.addColorStop(0, '#8a6a1c'); g.addColorStop(1, '#4d3a0c'); }
    else { g.addColorStop(0, '#2370a3'); g.addColorStop(1, '#123852'); }
    ctx.fillStyle = g; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = selected ? '#ffd64a' : ready ? '#9dffc4' : u.type === 'CP' ? '#ffd27a' : '#62c9ff';
    ctx.lineWidth = selected ? 2.5 : ready ? 2 : 1.2; ctx.stroke();
    if (spent) ctx.globalAlpha = 0.55;
    if (u.disabled) ctx.globalAlpha = 0.5;
    ctx.fillStyle = ctx.strokeStyle = '#e9f6ff';
    this.icon(ctx, u, 0, -s * 0.2, s * 0.78);
    ctx.font = `600 ${Math.max(7, s * 0.42)}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e9f6ff';
    const t = T(u);
    const txt = u.type === 'CP' ? 'CP' : `${uAtk(u)}/${t.rng} ${uDef(u)}-${t.mov}`;
    ctx.fillText(txt, 0, s * 0.62);
    ctx.globalAlpha = 1;
    if (u.disabled) {
      ctx.save(); this.roundRect(ctx, -s, -s, s * 2, s * 2, s * 0.2); ctx.clip();
      ctx.rotate(-0.6); ctx.fillStyle = 'rgba(255,60,50,0.85)'; ctx.fillRect(-s * 2, -s * 0.22, s * 4, s * 0.44);
      ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(7, s * 0.36)}px "Chakra Petch", sans-serif`;
      ctx.fillText('DISABLED', 0, 1); ctx.restore();
    }
    ctx.restore();
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  },

  icon(ctx, u, x, y, k) {
    ctx.save(); ctx.translate(x, y);
    ctx.lineWidth = Math.max(1, k * 0.1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    switch (u.type) {
      case 'HVY':
        ctx.fillRect(-0.55 * k, -0.02 * k, 1.1 * k, 0.32 * k);
        ctx.fillRect(-0.28 * k, -0.26 * k, 0.5 * k, 0.26 * k);
        ctx.beginPath(); ctx.moveTo(0.2 * k, -0.15 * k); ctx.lineTo(0.72 * k, -0.15 * k); ctx.stroke();
        break;
      case 'MSL':
        ctx.fillRect(-0.55 * k, 0.02 * k, 1.1 * k, 0.28 * k);
        ctx.save(); ctx.translate(-0.15 * k, 0); ctx.rotate(-0.45);
        ctx.fillRect(-0.05 * k, -0.18 * k, 0.6 * k, 0.16 * k);
        ctx.beginPath(); ctx.moveTo(0.55 * k, -0.18 * k); ctx.lineTo(0.72 * k, -0.1 * k); ctx.lineTo(0.55 * k, -0.02 * k); ctx.fill();
        ctx.restore();
        break;
      case 'GEV':
        ctx.beginPath(); ctx.ellipse(0, 0.12 * k, 0.62 * k, 0.22 * k, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillRect(-0.4 * k, -0.12 * k, 0.75 * k, 0.24 * k);
        ctx.beginPath(); ctx.arc(-0.45 * k, -0.2 * k, 0.14 * k, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'HWZ':
        ctx.beginPath(); ctx.moveTo(-0.55 * k, 0.3 * k); ctx.lineTo(0.45 * k, 0.3 * k); ctx.lineTo(0.3 * k, 0.02 * k); ctx.lineTo(-0.4 * k, 0.02 * k); ctx.closePath(); ctx.fill();
        ctx.lineWidth = Math.max(1.5, k * 0.16);
        ctx.beginPath(); ctx.moveTo(-0.2 * k, 0.05 * k); ctx.lineTo(0.62 * k, -0.48 * k); ctx.stroke();
        break;
      case 'INF': {
        const n = u.squads;
        for (let i = 0; i < n; i++) {
          const fx = (i - (n - 1) / 2) * 0.42 * k;
          ctx.beginPath(); ctx.arc(fx, -0.22 * k, 0.1 * k, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.moveTo(fx, -0.1 * k); ctx.lineTo(fx, 0.14 * k);
          ctx.moveTo(fx - 0.13 * k, 0.32 * k); ctx.lineTo(fx, 0.14 * k); ctx.lineTo(fx + 0.13 * k, 0.32 * k);
          ctx.moveTo(fx - 0.14 * k, -0.02 * k); ctx.lineTo(fx + 0.14 * k, -0.02 * k); ctx.stroke();
        }
        break;
      }
      case 'CP':
        ctx.beginPath(); ctx.arc(0, 0.3 * k, 0.5 * k, Math.PI, 0); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, -0.2 * k); ctx.lineTo(0, -0.55 * k); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -0.55 * k, 0.07 * k, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -0.5 * k, 0.22 * k, -2.4, -0.7); ctx.stroke();
        break;
    }
    ctx.restore();
  },

  drawOgre(now) {
    const ctx = this.ctx, o = S.ogre, { x, y } = this.pos(o), s = this.s;
    const pulse = 0.5 + 0.5 * Math.sin(now / 400);
    const dead = o.treads <= 0;
    const glow = ctx.createRadialGradient(x, y, s * 0.3, x, y, s * 1.8);
    glow.addColorStop(0, `rgba(255,90,40,${dead ? 0.1 : 0.25 + 0.15 * pulse})`); glow.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, s * 1.8, 0, Math.PI * 2); ctx.fill();
    this.hexPath(ctx, x, y, s * 0.96);
    const g = ctx.createLinearGradient(x, y - s, x, y + s);
    g.addColorStop(0, dead ? '#5a3a30' : '#ff6a3d'); g.addColorStop(1, dead ? '#2a1a14' : '#7a160a');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#ffc2a0'; ctx.lineWidth = 2; ctx.stroke();
    // silhouette
    ctx.save(); ctx.translate(x, y); const k = s * 0.8;
    ctx.fillStyle = '#1b0805'; ctx.strokeStyle = '#1b0805'; ctx.lineCap = 'round';
    ctx.fillRect(-0.75 * k, 0.05 * k, 1.5 * k, 0.32 * k);
    ctx.fillStyle = '#3a120a'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-0.6 * k + i * 0.3 * k, 0.4 * k, 0.09 * k, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#1b0805';
    ctx.fillRect(-0.5 * k, -0.2 * k, 0.9 * k, 0.26 * k);
    ctx.fillRect(-0.2 * k, -0.42 * k, 0.45 * k, 0.24 * k);
    ctx.lineWidth = Math.max(2, k * 0.1);
    ctx.beginPath(); ctx.moveTo(0.2 * k, -0.32 * k); ctx.lineTo(0.85 * k, -0.32 * k); ctx.stroke();
    ctx.lineWidth = Math.max(1, k * 0.06);
    ctx.beginPath(); ctx.moveTo(0.35 * k, -0.08 * k); ctx.lineTo(0.75 * k, -0.08 * k); ctx.moveTo(-0.5 * k, -0.08 * k); ctx.lineTo(-0.8 * k, -0.2 * k); ctx.stroke();
    ctx.fillStyle = '#ffe3d2'; ctx.font = `700 ${Math.max(8, s * 0.3)}px "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.spec.label, 0, -0.72 * k);
    ctx.restore();
    // tread bar
    const bw = s * 1.3, bh = Math.max(3, s * 0.12), bx = x - bw / 2, by = y + s * 0.62;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx, by, bw, bh);
    const p = o.treads / o.treadsMax;
    ctx.fillStyle = p > 0.66 ? '#5dff9a' : p > 0.33 ? '#ffc24a' : '#ff4b3e'; ctx.fillRect(bx, by, bw * p, bh);
    if (S.phase === 'defFire' && ctl('def') === 'human' && UI.selSet.size) {
      ctx.strokeStyle = '#ffd64a'; ctx.lineWidth = 2; this.hexPath(ctx, x, y, s * 1.05 + pulse * 3); ctx.stroke();
    }
  },

  // ---------- effects ----------
  drawFx(now) {
    const ctx = this.ctx;
    this.fx = this.fx.filter(f => now - f.t0 < f.dur);
    for (const f of this.fx) {
      const p = Math.max(0, (now - f.t0) / f.dur);
      if (f.type === 'shot') {
        const hx = f.x0 + (f.x1 - f.x0) * p, hy = f.y0 + (f.y1 - f.y0) * p;
        const tx = f.x0 + (f.x1 - f.x0) * Math.max(0, p - 0.25), ty = f.y0 + (f.y1 - f.y0) * Math.max(0, p - 0.25);
        const g = ctx.createLinearGradient(tx, ty, hx, hy);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, f.color);
        ctx.strokeStyle = g; ctx.lineWidth = f.heavy ? 4 : 2.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx, hy, f.heavy ? 3.5 : 2, 0, Math.PI * 2); ctx.fill();
      } else if (f.type === 'boom') {
        const r = this.s * (0.3 + p * f.size);
        ctx.fillStyle = `rgba(255,${Math.floor(200 - 150 * p)},60,${0.8 * (1 - p)})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255,240,200,${1 - p})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, r * 1.4, 0, Math.PI * 2); ctx.stroke();
        for (const q of f.parts) {
          ctx.fillStyle = `rgba(255,${180 - q.h},80,${1 - p})`;
          ctx.fillRect(f.x + Math.cos(q.a) * q.v * p * this.s, f.y + Math.sin(q.a) * q.v * p * this.s, 3, 3);
        }
      } else if (f.type === 'text') {
        ctx.font = `700 ${Math.max(11, this.s * 0.45)}px "Chakra Petch", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = `rgba(0,0,0,${0.8 * (1 - p)})`;
        ctx.strokeText(f.text, f.x, f.y - p * this.s * 1.2);
        ctx.fillStyle = f.color; ctx.globalAlpha = 1 - p * p;
        ctx.fillText(f.text, f.x, f.y - p * this.s * 1.2); ctx.globalAlpha = 1;
      }
    }
  },

  async animateMove(e, path, dur = 150) {
    for (const h of path) {
      e.anim = { c0: e.c, r0: e.r, c1: h.c, r1: h.r, t0: performance.now(), dur };
      await sleep(dur);
      e.c = h.c; e.r = h.r; e.anim = null;
      e === S.ogre ? SFX.stomp() : SFX.move();
    }
  },
  async shot(from, to, color, heavy) {
    const a = this.pos(from), b = this.pos(to);
    const dur = 160 + Math.hypot(b.x - a.x, b.y - a.y) * 0.6;
    this.fx.push({ type: 'shot', x0: a.x, y0: a.y, x1: b.x, y1: b.y, t0: performance.now(), dur, color, heavy });
    SFX.shot(heavy);
    await sleep(dur);
  },
  async volley(froms, to, color, heavy) {
    const list = Array.isArray(froms) ? froms : [froms];
    const ps = list.map((f, i) => sleep(i * 70).then(() => this.shot(f, to, color, heavy)));
    await Promise.all(ps);
  },
  explode(e, size = 1.2) {
    const { x, y } = this.pos(e);
    const parts = Array.from({ length: 18 }, () => ({ a: Math.random() * Math.PI * 2, v: 0.4 + Math.random() * 1.2, h: Math.random() * 120 }));
    this.fx.push({ type: 'boom', x, y, t0: performance.now(), dur: 700, size, parts });
    SFX.boom();
  },
  floatText(e, text, color) {
    const { x, y } = this.pos(e);
    this.fx.push({ type: 'text', x, y: y - this.s * 0.4, text, color, t0: performance.now(), dur: 1500 });
  },
};
