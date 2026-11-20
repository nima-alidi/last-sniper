// Loads Poly Haven PBR textures and builds all world materials (with procedural fallbacks).
import * as THREE from 'three';
import { maxAniso } from './engine.js';

const TEX = '../assets/textures/';
const imgLoader = new THREE.ImageLoader();

function loadImage(url) {
  return new Promise(res => imgLoader.load(url, img => res(img), undefined, () => res(null)));
}
function texFrom(img, srgb) {
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
function canvasTex(c, srgb) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tileImage(g, img, px, w, h, fallback) {
  if (!img) { g.fillStyle = fallback; g.fillRect(0, 0, w, h); return; }
  for (let y = 0; y < h; y += px) for (let x = 0; x < w; x += px) g.drawImage(img, x, y, px, px);
}
function noise(g, w, h, n, amp, alpha = [0.04, 0.14], sz = [1, 4]) {
  for (let i = 0; i < n; i++) {
    const v = (128 + (Math.random() * 2 - 1) * amp) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${alpha[0] + Math.random() * (alpha[1] - alpha[0])})`;
    g.fillRect(Math.random() * w, Math.random() * h, sz[0] + Math.random() * (sz[1] - sz[0]), sz[0] + Math.random() * (sz[1] - sz[0]));
  }
}

const SETS = ['asphalt_02', 'brushed_concrete', 'gravel_concrete_03', 'red_brick_03', 'white_stucco', 'rectangular_paving',
  'painted_metal_shutter', 'brown_planks_09', 'metal_plate', 'concrete_tile_facade'];

export const IMG = {};   // id -> {diff, nor, arm} HTMLImageElements (or null)
export const MAT = {};   // material library; each has userData.tile (metres per texture repeat)
export const FACADES = {};

export async function loadAssets(onProgress) {
  let done = 0; const total = SETS.length * 3;
  await Promise.all(SETS.map(async id => {
    const [diff, nor, arm] = await Promise.all(['diff', 'nor', 'arm'].map(async k => {
      const im = await loadImage(`${TEX}${id}/${k}.jpg`);
      onProgress && onProgress(++done / total);
      return im;
    }));
    IMG[id] = { diff, nor, arm };
  }));
  buildMaterials();
}

function pbr(id, tile, opts = {}, fallbackColor = 0x888888) {
  const s = IMG[id];
  const m = new THREE.MeshStandardMaterial({ color: opts.color ?? 0xffffff, roughness: 1, metalness: opts.metal ? 1 : 0, envMapIntensity: opts.env ?? 1 });
  if (s && s.diff) {
    m.map = texFrom(s.diff, true);
    if (s.nor) { m.normalMap = texFrom(s.nor, false); m.normalScale.set(opts.nscale ?? 1, opts.nscale ?? 1); }
    if (s.arm) { const a = texFrom(s.arm, false); m.aoMap = a; m.roughnessMap = a; if (opts.metal) m.metalnessMap = a; m.aoMapIntensity = 0.8; }
  } else {
    m.color.set(fallbackColor); m.roughness = opts.rough ?? 0.9;
  }
  m.userData.tile = tile;
  return m;
}

// ---------- facades: real wall texture + painted windows ----------
// Returns a material whose texture covers tu x tv metres.
function facade({ wallId, wallPx, wallFallback, tu, tv, cols, rows, win, frame, glass, sill, litChance = 0.07, tint = 0xffffff, spandrel }) {
  const S = 1024;
  const [cm, gm] = canvas(S), [cn, gn] = canvas(S), [ca, ga] = canvas(S), [ce, ge] = canvas(S);
  const w = IMG[wallId] || {};
  tileImage(gm, w.diff, wallPx, S, S, wallFallback);
  tileImage(gn, w.nor, wallPx, S, S, 'rgb(128,128,255)');
  tileImage(ga, w.arm, wallPx, S, S, 'rgb(255,230,0)');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S);
  if (!w.diff) noise(gm, S, S, 20000, 60);
  const cw = S / cols, ch = S / rows;
  if (spandrel) { // horizontal concrete bands between glass floors
    for (let r = 0; r < rows; r++) {
      const y = r * ch;
      gm.fillStyle = spandrel; gm.fillRect(0, y, S, ch * 0.2);
      ga.fillStyle = 'rgb(255,150,60)'; ga.fillRect(0, y, S, ch * 0.2);
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ww = cw * win[0], wh = ch * win[1];
    const x = c * cw + (cw - ww) / 2, y = r * ch + (ch - wh) * (spandrel ? 0.8 : 0.45);
    const lit = Math.random() < litChance;
    const fr = Math.max(4, cw * 0.035);
    // frame
    gm.fillStyle = frame; gm.fillRect(x - fr, y - fr, ww + fr * 2, wh + fr * 2);
    ga.fillStyle = 'rgb(220,110,200)'; ga.fillRect(x - fr, y - fr, ww + fr * 2, wh + fr * 2);
    // glass
    const gr = gm.createLinearGradient(0, y, 0, y + wh);
    if (lit) { gr.addColorStop(0, '#ffe1a8'); gr.addColorStop(1, '#c08440'); }
    else {
      const s = (Math.random() * 24 - 12) | 0;
      gr.addColorStop(0, `rgb(${glass[0] + s},${glass[1] + s},${glass[2] + s})`);
      gr.addColorStop(1, `rgb(${glass[0] * .45 + s | 0},${glass[1] * .5 + s | 0},${glass[2] * .55 + s | 0})`);
    }
    gm.fillStyle = gr; gm.fillRect(x, y, ww, wh);
    // blinds / curtains in some windows
    if (!lit && Math.random() < 0.3) { gm.fillStyle = `rgba(${200 + Math.random() * 40 | 0},${190 + Math.random() * 40 | 0},170,.55)`; gm.fillRect(x, y, ww, wh * (0.2 + Math.random() * 0.6)); }
    // mullions
    gm.fillStyle = frame;
    gm.fillRect(x + ww / 2 - fr * 0.4, y, fr * 0.8, wh);
    if (wh > ww) gm.fillRect(x, y + wh * 0.38, ww, fr * 0.8);
    ga.fillStyle = 'rgb(255,18,230)'; ga.fillRect(x, y, ww, wh);
    ga.fillStyle = 'rgb(220,110,200)'; ga.fillRect(x + ww / 2 - fr * 0.4, y, fr * 0.8, wh);
    // normals: flat glass, bevelled frame (OpenGL convention)
    gn.fillStyle = 'rgb(128,128,255)'; gn.fillRect(x - fr, y - fr, ww + 2 * fr, wh + 2 * fr);
    gn.fillStyle = 'rgb(70,128,235)'; gn.fillRect(x - fr, y - fr, fr * 0.6, wh + 2 * fr);
    gn.fillStyle = 'rgb(186,128,235)'; gn.fillRect(x + ww + fr * 0.4, y - fr, fr * 0.6, wh + 2 * fr);
    gn.fillStyle = 'rgb(128,186,235)'; gn.fillRect(x - fr, y - fr, ww + 2 * fr, fr * 0.6);
    gn.fillStyle = 'rgb(128,70,235)'; gn.fillRect(x - fr, y + wh + fr * 0.4, ww + 2 * fr, fr * 0.6);
    // recess shadow (AO) inside frame top
    ga.fillStyle = 'rgba(0,0,0,.35)'; ga.fillRect(x, y, ww, fr * 1.2);
    gm.fillStyle = 'rgba(0,0,0,.25)'; gm.fillRect(x, y, ww, fr * 1.4);
    if (sill) {
      gm.fillStyle = sill; gm.fillRect(x - fr * 2, y + wh + fr, ww + fr * 4, fr * 1.6);
      gn.fillStyle = 'rgb(128,200,220)'; gn.fillRect(x - fr * 2, y + wh + fr, ww + fr * 4, fr * 0.6);
    }
    if (lit) { ge.fillStyle = 'rgba(255,175,90,.85)'; ge.fillRect(x, y, ww, wh); }
  }
  const arm = canvasTex(ca, false); // R = AO, G = roughness, B = metalness
  const m = new THREE.MeshStandardMaterial({
    map: canvasTex(cm, true), normalMap: canvasTex(cn, false), aoMap: arm, aoMapIntensity: 0.7,
    roughnessMap: arm, metalnessMap: arm, emissiveMap: canvasTex(ce, true),
    emissive: 0xffffff, emissiveIntensity: 0.8, color: tint, roughness: 1, metalness: 1, envMapIntensity: 1.1,
  });
  m.userData.tu = tu; m.userData.tv = tv;
  return m;
}

function shopfront() {
  const [c, g] = canvas(1024, 512), [e, ge] = canvas(1024, 512), [r, gr] = canvas(1024, 512);
  g.fillStyle = '#26282b'; g.fillRect(0, 0, 1024, 512);
  gr.fillStyle = 'rgb(0,120,0)'; gr.fillRect(0, 0, 1024, 512);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 1024, 512);
  const signs = ['#b8322a', '#2a6fc9', '#d79a22', '#2f8a4e', '#7d3fa0', '#d0d0d0'];
  for (let i = 0; i < 2; i++) {
    const x = i * 512, col = signs[(Math.random() * signs.length) | 0];
    g.fillStyle = col; g.fillRect(x + 16, 20, 480, 92);
    g.fillStyle = 'rgba(255,255,255,.9)'; for (let k = 0; k < 6; k++) g.fillRect(x + 50 + k * 66, 46, 44, 40);
    ge.fillStyle = col; ge.globalAlpha = 0.5; ge.fillRect(x + 16, 20, 480, 92); ge.globalAlpha = 1;
    const grd = g.createLinearGradient(0, 140, 0, 500); grd.addColorStop(0, '#93a3b2'); grd.addColorStop(1, '#3a4450');
    g.fillStyle = grd; g.fillRect(x + 20, 140, 472, 360);
    gr.fillStyle = 'rgb(0,15,0)'; gr.fillRect(x + 20, 140, 472, 360);
    g.fillStyle = '#1d1f22'; g.fillRect(x + 248, 140, 14, 360); g.fillRect(x + 340, 220, 120, 280);
    ge.fillStyle = 'rgba(255,190,110,.3)'; ge.fillRect(x + 24, 300, 220, 200);
  }
  const m = new THREE.MeshStandardMaterial({ map: canvasTex(c, true), emissiveMap: canvasTex(e, true), emissive: 0xffffff, emissiveIntensity: 0.6, roughnessMap: canvasTex(r, false), roughness: 1, metalness: 0.3 });
  m.userData.tu = 8; m.userData.tv = 4.4;
  return m;
}

function proceduralTex(size, draw, srgb = true) { const [c, g] = canvas(size); draw(g, size); return canvasTex(c, srgb); }

function buildMaterials() {
  MAT.asphalt = pbr('asphalt_02', 7, { nscale: 0.8 }, 0x3b3c3e);
  MAT.concrete = pbr('brushed_concrete', 3, {}, 0x9d9a93);
  MAT.roof = pbr('gravel_concrete_03', 3.5, { nscale: 1.2 }, 0x77746d);
  MAT.sidewalk = pbr('rectangular_paving', 3, {}, 0xa19e97);
  MAT.metalPaint = pbr('painted_metal_shutter', 2.5, { metal: true }, 0x8a8f96);
  MAT.wood = pbr('brown_planks_09', 2.5, {}, 0x6a4a32);
  MAT.metal = pbr('metal_plate', 2, { metal: true }, 0x7c8087);
  MAT.brick = pbr('red_brick_03', 2.5, {}, 0x8a4a36);
  MAT.darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.45, metalness: 0.75 });
  MAT.paint = new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.7 });
  MAT.zebra = new THREE.MeshStandardMaterial({ color: 0xd9d6cd, roughness: 0.8 });
  MAT.sandbag = new THREE.MeshStandardMaterial({
    map: proceduralTex(256, (g, s) => {
      g.fillStyle = '#8f8160'; g.fillRect(0, 0, s, s); noise(g, s, s, 9000, 60, [0.1, 0.3], [1, 2]);
      g.strokeStyle = 'rgba(60,50,30,.35)'; for (let y = 0; y < s; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + Math.random() * 2 - 1); g.stroke(); }
      for (let x = 0; x < s; x += 4) { g.strokeStyle = 'rgba(255,240,200,.08)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke(); }
    }), roughness: 1,
  });
  MAT.grass = new THREE.MeshStandardMaterial({
    map: proceduralTex(256, (g, s) => {
      g.fillStyle = '#4b6531'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 12000; i++) { const v = Math.random() * 50 - 25; g.fillStyle = `rgba(${70 + v | 0},${100 + v | 0},${45 + v * .5 | 0},.5)`; g.fillRect(Math.random() * s, Math.random() * s, 1, 2 + Math.random() * 3); }
    }), roughness: 1,
  });
  MAT.grass.userData.tile = 4;
  MAT.heli = new THREE.MeshStandardMaterial({
    map: proceduralTex(512, (g, s) => {
      g.fillStyle = '#4f5256'; g.fillRect(0, 0, s, s); noise(g, s, s, 8000, 40);
      g.strokeStyle = '#e8c23a'; g.lineWidth = 18; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#f0f0f0'; g.fillRect(s * .33, s * .25, s * .08, s * .5); g.fillRect(s * .59, s * .25, s * .08, s * .5); g.fillRect(s * .33, s * .46, s * .34, s * .08);
    }), roughness: 0.85,
  });
  MAT.glassDark = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.05, metalness: 0.9 });

  FACADES.office = [0xffffff, 0xeadfcc, 0xd2d6dc].map(tint => facade({ wallId: 'white_stucco', wallPx: 200, wallFallback: '#d6d1c8', tu: 12, tv: 14, cols: 4, rows: 4, win: [0.68, 0.62], frame: '#2c2f33', glass: [160, 178, 196], sill: '#e9e5dc', tint }));
  FACADES.brick = [0xffffff, 0xd9c7b5].map(tint => facade({ wallId: 'red_brick_03', wallPx: 256, wallFallback: '#8a4a36', tu: 10, tv: 9, cols: 3, rows: 3, win: [0.42, 0.62], frame: '#e6e1d6', glass: [110, 130, 148], sill: '#d6cfc0', litChance: 0.1, tint }));
  FACADES.tiles = [0xffffff, 0xc7ccd3].map(tint => facade({ wallId: 'concrete_tile_facade', wallPx: 256, wallFallback: '#9a9a96', tu: 12, tv: 12, cols: 4, rows: 4, win: [0.6, 0.55], frame: '#1f2124', glass: [130, 160, 186], tint }));
  FACADES.glass = [0xffffff, 0xcfe2ea, 0xe0d2bc].map(tint => {
    const m = facade({ wallId: 'brushed_concrete', wallPx: 300, wallFallback: '#3a3f47', tu: 12, tv: 8, cols: 8, rows: 2, win: [0.94, 0.78], frame: '#202428', glass: [150, 176, 198], spandrel: '#3a3f47', litChance: 0.04, tint });
    m.metalness = 0.6; m.envMapIntensity = 1.3;
    return m;
  });
  // ----- extra materials for building variety -----
  MAT.awnings = [0xb8322a, 0x2a6fc9, 0xd79a22, 0x2f8a4e, 0x7d3fa0, 0xe9e3d2, 0xc4572b].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, side: THREE.DoubleSide }));
  MAT.copper = new THREE.MeshStandardMaterial({ color: 0x5aa08a, roughness: 0.45, metalness: 0.55 });
  MAT.water = new THREE.MeshStandardMaterial({ color: 0x3c8fb0, roughness: 0.04, metalness: 0.25, envMapIntensity: 1.6 });
  MAT.tiles = new THREE.MeshStandardMaterial({
    map: proceduralTex(256, (g, s) => {
      g.fillStyle = '#9a4a32'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 16) for (let x = (y / 16 % 2) * 8; x < s + 16; x += 16) {
        const v = (Math.random() * 40 - 20) | 0;
        g.fillStyle = `rgb(${160 + v},${78 + v * 0.6 | 0},${52 + v * 0.5 | 0})`; g.fillRect(x + 1, y + 1, 14, 14);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + 14, 16, 2);
      }
    }), roughness: 0.85, side: THREE.DoubleSide,
  });
  MAT.tiles.userData.tile = 3;
  const neon = (text, bg, fg) => {
    const [c, g] = canvas(512, 256);
    g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(12, 12, 488, 232);
    g.font = 'bold 118px Bahnschrift, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = fg; g.shadowBlur = 26; g.fillStyle = '#ffffff'; g.fillText(text, 256, 134);
    const t = canvasTex(c, true);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 1.15, roughness: 0.6 });
  };
  MAT.signs = [['HOTEL', '#1b0f2e', '#ff4fd8'], ['CAFE', '#2a1608', '#ffb347'], ['CINEMA', '#101c33', '#4fd0ff'], ['BANK', '#0f2a1a', '#5cff9a'],
    ['PIZZA', '#2e0f0f', '#ff6b4f'], ['METRO', '#0f1a2e', '#7fa8ff'], ['PLAZA', '#2e2a0f', '#ffe14f'], ['GRAND', '#1a0f2e', '#c08aff']].map(a => neon(...a));
  MAT.shop = shopfront();
}
