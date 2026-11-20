// Cuts the downloaded CC0 recordings into game-ready mono WAV clips in assets/sounds/.
// Source: "Gunshot Sounds" (CC0) from opengameart.org — mosin.wav (bolt-action rifle) and sks.wav.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const raw = path.join(root, 'assets', 'sounds', 'raw', 'zip', 'sounds');
const outDir = path.join(root, 'assets', 'sounds');

function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12, fmt, data;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') data = { off: p + 8, size };
    p += 8 + size + (size & 1);
  }
  if (fmt.bits !== 16) throw new Error('only 16-bit wav supported: ' + file);
  const frames = Math.floor(data.size / (2 * fmt.ch));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0; for (let c = 0; c < fmt.ch; c++) s += b.readInt16LE(data.off + (i * fmt.ch + c) * 2) / 32768;
    mono[i] = s / fmt.ch;
  }
  return { rate: fmt.rate, mono };
}
function writeWav(file, rate, samples) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, b);
}
function cut(src, a, z, { fadeIn = 0.004, fadeOut = 0.25, gain = 1 } = {}) {
  const s = Math.floor(a * src.rate), e = Math.min(src.mono.length, Math.floor(z * src.rate));
  const out = src.mono.slice(s, e);
  let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
  const norm = gain * 0.89 / (peak || 1); // normalise each clip to about -1 dBFS
  const fi = fadeIn * src.rate, fo = fadeOut * src.rate;
  for (let i = 0; i < out.length; i++) {
    let k = 1;
    if (i < fi) k *= i / fi;
    if (i > out.length - fo) k *= (out.length - i) / fo;
    out[i] *= k * norm;
  }
  return out;
}

const mosin = readWav(path.join(raw, 'mosin.wav'));
const sks = readWav(path.join(raw, 'sks.wav'));
const clips = {
  rifle_shot_1: cut(mosin, 0.41, 1.6),
  rifle_shot_2: cut(mosin, 5.96, 7.2),
  rifle_shot_3: cut(mosin, 8.82, 10.25),
  rifle_bolt: cut(mosin, 1.6, 3.2, { fadeIn: 0.02, fadeOut: 0.15, gain: 0.7 }),
  enemy_shot_1: cut(sks, 0.32, 1.9),
  enemy_shot_2: cut(sks, 5.98, 7.5),
};
for (const [name, data] of Object.entries(clips)) {
  writeWav(path.join(outDir, name + '.wav'), mosin.rate, data);
  console.log(`${name}.wav  ${(data.length / mosin.rate).toFixed(2)}s`);
}
