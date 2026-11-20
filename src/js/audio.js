// Synthesised game audio with simple spatial panning and distance delay.
import { settings, clamp } from './ctx.js';

let AC = null, master = null, windGain = null;
export function audio() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.connect(AC.destination);
      const comp = AC.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4;
      master.disconnect(); master.connect(comp); comp.connect(AC.destination);
    } catch (e) { return null; }
  }
  if (AC.state === 'suspended') AC.resume();
  master.gain.value = settings.volume;
  return AC;
}
export function setVolume(v) { if (master) master.gain.value = v; }
// stop every sound when the page/window goes away
addEventListener('pagehide', () => { try { if (AC) AC.close(); } catch (e) { /* ignore */ } AC = null; });

function out(pan = 0) {
  const p = AC.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(master); return p;
}
function noise(dur, fc, gain, delay = 0, type = 'lowpass', pan = 0, q = 0.7, decay = 2.2) {
  const a = audio(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur), b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  const s = a.createBufferSource(); s.buffer = b;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = fc; f.Q.value = q;
  const g = a.createGain(); g.gain.value = gain;
  s.connect(f); f.connect(g); g.connect(out(pan)); s.start(a.currentTime + delay);
}
function tone(freq, dur, gain, delay = 0, type = 'sine', slide = 0, pan = 0) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(out(pan)); o.start(t); o.stop(t + dur + 0.02);
}

// ---------- recorded samples (CC0 recordings, see tools/slice-sounds.js) ----------
const SAMPLES = ['rifle_shot_1', 'rifle_shot_2', 'rifle_shot_3', 'rifle_bolt', 'enemy_shot_1', 'enemy_shot_2'];
const buffers = {};
export async function loadSamples(base = '../assets/sounds/') {
  const a = audio(); if (!a) return;
  await Promise.all(SAMPLES.map(async n => {
    try { const r = await fetch(`${base}${n}.wav`); if (r.ok) buffers[n] = await a.decodeAudioData(await r.arrayBuffer()); }
    catch (e) { /* missing sample -> synth fallback */ }
  }));
}
function sample(name, { gain = 1, pan = 0, delay = 0, rate = 1, lowpass = 0 } = {}) {
  const a = audio(); const buf = buffers[name]; if (!a || !buf) return false;
  const s = a.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
  const g = a.createGain(); g.gain.value = gain;
  let node = s;
  if (lowpass) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node.connect(f); node = f; }
  node.connect(g); g.connect(out(pan));
  s.start(a.currentTime + delay);
  return true;
}
const pickOf = names => names[Math.floor(Math.random() * names.length)];

export const sfx = {
  shot() {
    const ok = sample(pickOf(['rifle_shot_1', 'rifle_shot_2', 'rifle_shot_3']), { gain: 1.0, rate: 0.96 + Math.random() * 0.08 });
    tone(80, 0.35, ok ? 0.45 : 0.8, 0, 'sine', -50); // sub thump for weight
    if (!ok) {
      noise(0.35, 3200, 0.9, 0, 'lowpass', 0, 0.7, 3); noise(1.0, 600, 0.65, 0, 'lowpass', 0, 0.7, 2.5);
    }
    noise(1.6, 700, 0.16, 0.38, 'lowpass', -0.4); noise(2.2, 450, 0.1, 0.95, 'lowpass', 0.4); // city echoes
  },
  bolt() {
    if (sample('rifle_bolt', { gain: 0.9, delay: 0.2, rate: 1.2 })) return;
    noise(0.05, 3500, 0.35, 0.25, 'highpass'); noise(0.07, 2200, 0.35, 0.45, 'highpass'); noise(0.05, 2800, 0.4, 0.62, 'highpass'); noise(0.04, 3000, 0.3, 0.82, 'highpass');
  },
  // distant shot: supersonic crack arrives first, the muzzle report is delayed by distance
  remoteShot(dist, pan) {
    const g = clamp(1.15 - dist / 260, 0.15, 0.85), d = Math.min(0.8, dist / 343);
    noise(0.12, 4000, g * 0.6, 0, 'highpass', pan);
    const lp = clamp(9000 - dist * 25, 1200, 9000);
    if (sample(pickOf(['enemy_shot_1', 'enemy_shot_2']), { gain: g * 1.1, pan, delay: d, rate: 0.95 + Math.random() * 0.1, lowpass: lp })) return;
    noise(0.4, 1800, g, d, 'lowpass', pan); noise(1.0, 450, g * 0.6, d, 'lowpass', pan); noise(1.6, 500, g * 0.2, d + 0.45, 'lowpass', -pan);
  },
  whiz(pan) { tone(2400, 0.18, 0.15, 0, 'sawtooth', -1600, pan); noise(0.2, 5000, 0.2, 0, 'bandpass', pan, 4); },
  warn() { tone(880, 0.09, 0.1); tone(660, 0.11, 0.08, 0.11); },
  hit() { tone(1500, 0.05, 0.22, 0.02, 'square'); noise(0.05, 4000, 0.2, 0.02, 'highpass'); },
  kill() { tone(180, 0.25, 0.4, 0, 'triangle', -90); tone(1100, 0.07, 0.18, 0.03); },
  headshot() { tone(1800, 0.08, 0.25); tone(2400, 0.1, 0.2, 0.06); },
  hurt() { tone(110, 0.35, 0.55, 0, 'sawtooth', -60); noise(0.25, 500, 0.5); },
  // mag out, mag in, bolt up/back, bolt forward/down — timed to the reload duration
  reload(d = 1.6) { noise(0.06, 2500, 0.3, d * 0.12, 'highpass'); noise(0.08, 1800, 0.38, d * 0.55, 'highpass'); noise(0.05, 3000, 0.35, d * 0.8, 'highpass'); noise(0.05, 2600, 0.35, d * 0.93, 'highpass'); },
  dry() { noise(0.04, 3000, 0.25, 0, 'highpass'); },
  step() { noise(0.08, 600 + Math.random() * 300, 0.12, 0, 'lowpass', (Math.random() - 0.5) * 0.3); },
  breath(inhale) { noise(inhale ? 0.5 : 0.7, inhale ? 1200 : 800, 0.08, 0, 'bandpass', 0, 1); },
  ui() { tone(1200, 0.04, 0.08, 0, 'square'); },
};

export function startWind() {
  const a = audio(); if (!a || windGain) return;
  const n = a.sampleRate * 4, b = a.createBuffer(2, n, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let last = 0; for (let i = 0; i < n; i++) { last = last * 0.995 + (Math.random() * 2 - 1) * 0.05; d[i] = last; } }
  const s = a.createBufferSource(); s.buffer = b; s.loop = true;
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
  windGain = a.createGain(); windGain.gain.value = 0.35;
  s.connect(f); f.connect(windGain); windGain.connect(master); s.start();
  // slow gusts
  setInterval(() => { if (windGain) windGain.gain.setTargetAtTime(0.2 + Math.random() * 0.35, a.currentTime, 1.5); }, 3000);
}
