// Shared game context and persistent settings.
export const G = {
  mode: null,          // null | 'solo' | 'mp'
  state: 'menu',       // menu | play | paused | dead | ended
  time: 0,
  world: null,
  player: null,
  hittables: [],       // meshes that bullets can damage (enemies / remote players)
  onBulletHit: null,   // (hitObjectUserData, part, dist, point, dir) => void, set by the active mode
  onPlayerShot: null,  // (from, to) => void
};

const DEFAULTS = {
  name: 'Ghost' + (100 + Math.floor(Math.random() * 900)),
  sens: 1, scopeSens: 1, fov: 75, volume: 0.8, quality: 'high', showFps: false, invert: false,
  lastIp: '', port: 27015,
};
let saved = {};
try { saved = JSON.parse(localStorage.getItem('rs_settings') || '{}'); } catch (e) { saved = {}; }
export const settings = Object.assign({}, DEFAULTS, saved);
export function saveSettings() {
  try { localStorage.setItem('rs_settings', JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
}

// Deterministic RNG so every client builds the same city from the same seed.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const TAU = Math.PI * 2;
