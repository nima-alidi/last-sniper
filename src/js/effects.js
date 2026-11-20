// Particles, tracers, impact decals, smoke plumes and floating dust.
import * as THREE from 'three';
import { scene } from './engine.js';
import { rnd, TAU } from './ctx.js';

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const TEX = {
  glow: canvasTex(128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,240,210,.8)'); gr.addColorStop(0.5, 'rgba(255,200,130,.15)'); gr.addColorStop(1, 'rgba(255,200,130,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }),
  smoke: canvasTex(128, (g) => {
    for (let i = 0; i < 30; i++) {
      const x = 64 + rnd(-26, 26), y = 64 + rnd(-26, 26), r = rnd(12, 34);
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }
  }),
  hole: canvasTex(64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.25, 'rgba(20,18,16,.95)'); gr.addColorStop(0.45, 'rgba(60,55,50,.6)'); gr.addColorStop(1, 'rgba(90,85,80,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(30,28,25,.6)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) { const a = Math.random() * TAU; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * rnd(14, 28), 32 + Math.sin(a) * rnd(14, 28)); g.stroke(); }
  }),
  muzzle: canvasTex(128, (g) => {
    g.translate(64, 64);
    for (let i = 0; i < 7; i++) {
      g.rotate(TAU / 7 + rnd(-0.2, 0.2));
      const gr = g.createLinearGradient(0, 0, 0, -60); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(-6, 0); g.lineTo(0, -rnd(35, 60)); g.lineTo(6, 0); g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 28); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(1, 'rgba(255,180,80,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 28, 0, TAU); g.fill();
  }),
};

const PGEO = new THREE.BoxGeometry(1, 1, 1);
const PMAT = {
  spark: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3, 1.2) }),
  dust: new THREE.MeshStandardMaterial({ color: 0xa9a398, roughness: 1 }),
  blood: new THREE.MeshStandardMaterial({ color: 0x6a0a0d, roughness: 0.5 }),
};
const holeMat = new THREE.MeshBasicMaterial({ map: TEX.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const holeGeo = new THREE.PlaneGeometry(0.16, 0.16);

const parts = [], tracers = [], holes = [];

export function burst(pos, n, kind, speed, life, grav = 9.8, dir = null) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(PGEO, PMAT[kind]); const s = rnd(0.02, 0.07) * (kind === 'dust' ? 2 : 1);
    m.scale.setScalar(s); m.position.copy(pos);
    const v = new THREE.Vector3(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).multiplyScalar(speed * rnd(0.3, 1));
    if (dir) v.addScaledVector(dir, speed * 0.6);
    scene.add(m); parts.push({ obj: m, v, life: rnd(0.4, 1) * life, grav });
  }
}
export function puff(pos, color = [0.75, 0.72, 0.66], size = 1, life = 1.5, rise = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.smoke, depthWrite: false, transparent: true, opacity: 0.9 }));
  s.material.color.setRGB(...color); s.material.rotation = rnd(0, TAU);
  s.position.copy(pos); s.scale.setScalar(size); scene.add(s);
  parts.push({ obj: s, v: new THREE.Vector3(rnd(-0.2, 0.2), rise, rnd(-0.2, 0.2)), life, max: life, grav: 0, puff: size });
}
export function impact(point, normal, dir, surface = 'concrete') {
  const n = normal || dir.clone().negate();
  burst(point.clone().addScaledVector(n, 0.05), 10, 'dust', 3, 0.8, 4, n);
  burst(point, 5, 'spark', 5, 0.25, 9.8, n);
  puff(point.clone().addScaledVector(n, 0.15), [0.78, 0.75, 0.7], 0.6, 1.6, 0.5);
  if (normal) {
    const h = new THREE.Mesh(holeGeo, holeMat);
    h.position.copy(point).addScaledVector(normal, 0.01);
    h.lookAt(point.clone().add(normal)); h.rotateZ(rnd(0, TAU)); h.scale.setScalar(rnd(0.8, 1.3));
    scene.add(h); holes.push(h);
    if (holes.length > 80) scene.remove(holes.shift());
  }
}
export function bloodHit(point, dir) {
  burst(point, 16, 'blood', 3.5, 0.6, 9.8, dir);
  puff(point, [0.45, 0.05, 0.05], 0.5, 0.6, 0.1);
}
export function tracer(from, to, enemy = false) {
  const len = from.distanceTo(to); if (len < 0.5) return;
  const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  mat.color.setRGB(...(enemy ? [6, 2.6, 0.9] : [4, 3.4, 2.2]));
  const m = new THREE.Mesh(PGEO, mat);
  const w = enemy ? 0.05 + len * 0.0016 : 0.02;
  m.scale.set(w, w, len); m.position.copy(from).add(to).multiplyScalar(0.5); m.lookAt(to);
  scene.add(m); tracers.push({ obj: m, life: enemy ? 0.2 : 0.12, max: enemy ? 0.2 : 0.12 });
}

// Enemy muzzle flash: a short bright burst + light + smoke so the shooter's position is revealed.
// size grows with viewer distance so it stays visible far away.
const flashes = [];
export function muzzleFlash(pos, viewerDist = 50) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.muzzle, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  // bright star-shaped spark: small core, sharp rays, no big glow (so it doesn't blind the scope)
  s.material.color.setRGB(9, 6, 2.5); s.material.rotation = Math.random() * TAU;
  const sz = 0.55 + viewerDist * 0.013; s.scale.set(sz, sz, 1); s.position.copy(pos);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  glow.material.color.setRGB(2.5, 1.5, 0.6); glow.scale.set(sz * 1.3, sz * 1.3, 1); glow.position.copy(pos);
  const light = new THREE.PointLight(0xffaa55, 220, 8, 2); light.position.copy(pos);
  scene.add(s, glow, light);
  flashes.push({ objs: [s, glow, light], life: 0.13 });
  burst(pos, 10, 'spark', 7, 0.35, 6);          // flying sparks
  puff(pos, [0.8, 0.78, 0.74], 0.7, 1.8, 0.4);
}

// ---------- ambient: smoke plumes & dust ----------
let plumes = [], dust = null;
export function setupAmbient(ambient) {
  clearAmbient();
  for (const p of ambient.plumes) {
    const pl = { ...p, sprites: [], fire: null, light: null };
    if (p.fire) {
      pl.fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      pl.fire.material.color.setRGB(6, 2.4, 0.6); pl.fire.position.set(p.x, p.y + 1, p.z); scene.add(pl.fire);
      pl.light = new THREE.PointLight(0xff7a2a, 400, 45, 2); pl.light.position.set(p.x, p.y + 2, p.z); scene.add(pl.light);
    }
    for (let i = 0; i < 36; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.smoke, depthWrite: false, transparent: true, opacity: 0 }));
      s.material.color.setRGB(0.16, 0.15, 0.14); s.material.rotation = rnd(0, TAU);
      s.userData = { life: -rnd(0, 9), max: 9, seed: Math.random() * 10 };
      scene.add(s); pl.sprites.push(s);
    }
    plumes.push(pl);
  }
  const n = 500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = rnd(-25, 25); pos[i * 3 + 1] = rnd(-6, 10); pos[i * 3 + 2] = rnd(-25, 25); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ size: 0.045, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
  m.color.setRGB(1.6, 1.45, 1.15);
  dust = new THREE.Points(g, m); dust.frustumCulled = false; scene.add(dust);
}
export function clearAmbient() {
  for (const p of plumes) { scene.remove(...p.sprites); if (p.fire) scene.remove(p.fire, p.light); }
  plumes = [];
  if (dust) scene.remove(dust); dust = null;
  for (const h of holes) scene.remove(h); holes.length = 0;
  for (const p of parts) scene.remove(p.obj); parts.length = 0;
  for (const t of tracers) scene.remove(t.obj); tracers.length = 0;
  for (const f of flashes) for (const o of f.objs) scene.remove(o); flashes.length = 0;
}

export function updateEffects(dt, t, camPos, scoped) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]; f.life -= dt;
    if (f.life <= 0) { for (const o of f.objs) { scene.remove(o); if (o.material) o.material.dispose(); } flashes.splice(i, 1); }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt; p.v.y -= p.grav * dt; p.obj.position.addScaledVector(p.v, dt);
    if (p.puff) { const k = 1 - p.life / p.max; p.obj.scale.setScalar(p.puff * (0.8 + k * 3)); p.obj.material.opacity = (1 - k) * 0.7; }
    if (p.life <= 0) { scene.remove(p.obj); if (p.puff) p.obj.material.dispose(); parts.splice(i, 1); }
  }
  for (let i = tracers.length - 1; i >= 0; i--) {
    const tr = tracers[i]; tr.life -= dt; tr.obj.material.opacity = Math.max(0, tr.life / tr.max);
    if (tr.life <= 0) { scene.remove(tr.obj); tr.obj.material.dispose(); tracers.splice(i, 1); }
  }
  for (const p of plumes) {
    for (const s of p.sprites) {
      const u = s.userData; u.life += dt; if (u.life > u.max) u.life = 0;
      if (u.life < 0) { s.visible = false; continue; }
      s.visible = true;
      const k = u.life / u.max;
      s.position.set(p.x + Math.sin(u.life * 0.7 + u.seed) * 1.5 + k * k * 24, p.y + 1 + k * 42, p.z + Math.cos(u.life * 0.5 + u.seed) * 1.5 + k * k * 9);
      const sc = 3 + k * 22; s.scale.set(sc, sc, 1);
      s.material.opacity = Math.min(1, k * 6) * (1 - k) * 0.85;
      s.material.rotation += dt * 0.12;
    }
    if (p.fire) { const f = 0.8 + Math.sin(t * 23) * 0.12 + Math.sin(t * 37) * 0.1; p.fire.scale.set(5 * f, 6 * f, 1); p.light.intensity = 400 * f; }
  }
  if (dust) {
    dust.visible = !scoped;
    const pa = dust.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i) + Math.sin(t * 0.3 + i) * 0.004 + dt * 0.25, y = pa.getY(i) + Math.cos(t * 0.2 + i * 1.7) * 0.003, z = pa.getZ(i) + dt * 0.1;
      if (x > 25) x -= 50; if (z > 25) z -= 50;
      pa.setXYZ(i, x, y, z);
    }
    pa.needsUpdate = true;
    dust.position.set(Math.floor(camPos.x / 50) * 50, camPos.y, Math.floor(camPos.z / 50) * 50);
  }
}
