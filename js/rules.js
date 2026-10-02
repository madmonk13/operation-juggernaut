'use strict';
// Unit and weapon data follow classic microarmor scenario values.
const UNIT_TYPES = {
  HVY: { name: 'Heavy Tank',   atk: 4, rng: 2, def: 3, mov: 3, cost: 1, ram: 2 },
  MSL: { name: 'Missile Tank', atk: 3, rng: 4, def: 2, mov: 2, cost: 1, ram: 1 },
  GEV: { name: 'Hovertank',    atk: 2, rng: 2, def: 2, mov: 4, mov2: 3, cost: 1, ram: 1 },
  HWZ: { name: 'Howitzer',     atk: 6, rng: 8, def: 1, mov: 0, cost: 2, ram: 1 },
  INF: { name: 'Infantry',     atk: 1, rng: 1, def: 1, mov: 2, perSquad: true, ram: 0 },
  CP:  { name: 'Command Post', atk: 0, rng: 0, def: 0, mov: 0, ram: 0 },
};

const WEAPONS = {
  msl:  { name: 'Missile',      atk: 6, rng: 5, def: 3 },
  main: { name: 'Main Battery', atk: 4, rng: 3, def: 4 },
  sec:  { name: 'Secondary',    atk: 3, rng: 2, def: 3 },
  ap:   { name: 'AP Gun',       atk: 1, rng: 1, def: 1 },
};

const OGRE_SPECS = {
  mk3: { name: 'J-3',      label: 'J-3',    treads: 45, armor: 12, squads: 18, hwz: 1,
         weapons: [['msl', 2], ['main', 1], ['sec', 4], ['ap', 8]] },
  mk5: { name: 'J-5',      label: 'J-5',   treads: 60, armor: 20, squads: 30, hwz: 2,
         weapons: [['msl', 6], ['main', 2], ['sec', 6], ['ap', 12]] },
};

const Rules = {
  ODDS: ['1:2', '1:1', '2:1', '3:1', '4:1', '5:1'],
  // CRT[die-1][oddsIndex]
  CRT: [
    ['NE', 'NE', 'NE', 'NE', 'D',  'X'],
    ['NE', 'NE', 'NE', 'D',  'X',  'X'],
    ['NE', 'NE', 'D',  'X',  'X',  'X'],
    ['NE', 'D',  'X',  'X',  'X',  'X'],
    ['D',  'X',  'X',  'X',  'X',  'X'],
    ['X',  'X',  'X',  'X',  'X',  'X'],
  ],
  // -1 = hopeless (< 1:2), 0..5 = table column, 6 = automatic kill
  oddsIndex(atk, def) {
    if (def <= 0) return 6;
    if (atk <= 0 || atk * 2 < def) return -1;
    if (atk < def) return 0;
    return Math.min(6, Math.floor(atk / def));
  },
  label(i) { return i < 0 ? '<1:2' : i >= 6 ? 'AUTO' : this.ODDS[i]; },
  resolve(i) {
    if (i < 0) return { result: 'NE', roll: null };
    if (i >= 6) return { result: 'X', roll: null };
    const roll = 1 + Math.floor(Math.random() * 6);
    return { result: this.CRT[roll - 1][i], roll };
  },
  pKill(i) {
    if (i < 0) return 0;
    if (i >= 6) return 1;
    return this.CRT.filter(row => row[i] === 'X').length / 6;
  },
};
