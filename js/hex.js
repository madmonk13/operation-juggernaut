'use strict';
// Flat-top hex grid, "odd-q" offset coordinates (odd columns shifted down).
const COLS = 22, ROWS = 15;
const DEPLOY_MAX_COL = 13;   // defenders deploy in columns 0..13
const CP_MAX_COL = 3;        // command post in columns 0..3

const Hex = {
  key: (c, r) => c + ',' + r,
  inBounds: (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS,
  toCube(c, r) { const x = c, z = r - (c - (c & 1)) / 2; return [x, -x - z, z]; },
  fromCube(x, z) { return { c: x, r: z + (x - (x & 1)) / 2 }; },
  dist(a, b) {
    const [ax, ay, az] = Hex.toCube(a.c, a.r), [bx, by, bz] = Hex.toCube(b.c, b.r);
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
  },
  DIRS: [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]],
  neighbors(c, r) {
    const [x, , z] = Hex.toCube(c, r), out = [];
    for (const [dx, , dz] of Hex.DIRS) {
      const h = Hex.fromCube(x + dx, z + dz);
      if (Hex.inBounds(h.c, h.r)) out.push(h);
    }
    return out;
  },
};

const MapGen = {
  rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  generate(seed) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const rnd = this.rng(seed + attempt * 7919);
      const t = new Array(COLS * ROWS).fill('clear');
      const idx = (c, r) => r * COLS + c;
      const nCraters = 18 + Math.floor(rnd() * 6);
      for (let i = 0; i < nCraters; i++) {
        const c = 2 + Math.floor(rnd() * (COLS - 4)), r = Math.floor(rnd() * ROWS);
        t[idx(c, r)] = 'crater';
      }
      const nRubble = 7 + Math.floor(rnd() * 4);
      for (let i = 0; i < nRubble; i++) {
        let c = 1 + Math.floor(rnd() * (COLS - 3)), r = Math.floor(rnd() * ROWS);
        const len = 2 + Math.floor(rnd() * 4), dir = Math.floor(rnd() * 6);
        for (let j = 0; j < len && Hex.inBounds(c, r); j++) {
          if (t[idx(c, r)] === 'clear') t[idx(c, r)] = 'rubble';
          const [x, , z] = Hex.toCube(c, r);
          const d = Hex.DIRS[(dir + (rnd() < 0.3 ? 1 : 0)) % 6];
          ({ c, r } = Hex.fromCube(x + d[0], z + d[2]));
        }
      }
      if (this.connected(t)) return { t, seed };
    }
    return { t: new Array(COLS * ROWS).fill('clear'), seed };
  },
  connected(t) {
    const seen = new Set(), q = [];
    for (let r = 0; r < ROWS; r++) if (t[r * COLS + COLS - 1] !== 'crater') { q.push({ c: COLS - 1, r }); seen.add(Hex.key(COLS - 1, r)); }
    while (q.length) {
      const h = q.pop();
      for (const n of Hex.neighbors(h.c, h.r)) {
        const k = Hex.key(n.c, n.r);
        if (seen.has(k) || t[n.r * COLS + n.c] === 'crater') continue;
        seen.add(k); q.push(n);
      }
    }
    const open = t.filter(x => x !== 'crater').length;
    return seen.size === open;
  },
};
