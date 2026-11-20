// First-person bolt-action sniper rifle with procedural animation.
import * as THREE from 'three';
import { TEX } from './effects.js';
import { clamp, lerp } from './ctx.js';

function noiseTex(base, amp, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.35; i++) {
    const v = 128 + (Math.random() * 2 - 1) * amp | 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.05 + Math.random() * 0.12})`; g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function camoTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#56593f'; g.fillRect(0, 0, 256, 256);
  const cols = ['#3d4030', '#6b6a4d', '#2d2f25', '#7a7458'];
  for (let i = 0; i < 70; i++) {
    g.fillStyle = cols[i % cols.length]; g.beginPath();
    let x = Math.random() * 256, y = Math.random() * 256; g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += Math.random() * 40 - 20; y += Math.random() * 40 - 20; g.lineTo(x, y); }
    g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

const roughTex = noiseTex('#8a8a8a', 70);
const M = {
  chassis: new THREE.MeshStandardMaterial({ color: 0x6b6a4e, roughness: 0.72, roughnessMap: roughTex, metalness: 0.1 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.4, roughnessMap: roughTex, metalness: 0.75 }),
  barrel: new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.32, metalness: 0.85 }),
  scope: new THREE.MeshStandardMaterial({ color: 0x26282b, roughness: 0.45, roughnessMap: roughTex, metalness: 0.5 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0e0e0e, roughness: 0.95 }),
  lens: new THREE.MeshPhysicalMaterial({ color: 0x0c1a26, roughness: 0.02, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.5 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x2b2a25, roughness: 0.92, roughnessMap: roughTex }),
  knuckle: new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.7 }),
  sleeve: new THREE.MeshStandardMaterial({ map: camoTex(), roughness: 0.95 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.3, metalness: 1 }),
};

// side profile helper: points are [forward, up] in metres; extruded symmetric across x
function profile(points, width, bevel = 0.004) {
  const s = new THREE.Shape();
  points.forEach(([u, v], i) => (i ? s.lineTo(u, v) : s.moveTo(u, v)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // forward (+u) -> -z
  return g;
}
// lathe along -z: points are [radius, distance forward]
function lathe(points, seg = 28) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Weapon {
  constructor(camera) {
    this.root = new THREE.Group();       // pose / sway
    this.gun = new THREE.Group();        // rifle + hands, animated
    this.root.add(this.gun);
    camera.add(this.root);
    this.build();
    this.t = 0; this.ads = 0; this.kick = 0; this.kickV = 0;
    this.bolt = -1; this.reloadT = -1; this.reloadDur = 2.4;
    this.swayX = 0; this.swayY = 0; this.sprint = 0; this.crouch = 0;
    this.flashT = 0;
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  }

  add(geo, mat, x = 0, y = 0, z = 0, parent = this.gun) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
  }

  build() {
    const g = this.gun;
    // ---- chassis / stock ----
    this.add(profile([[-0.64, -0.135], [-0.64, 0.035], [-0.44, 0.045], [-0.26, 0.04], [-0.2, 0.012], [-0.12, 0.004], [0.43, 0.004], [0.455, -0.02], [0.44, -0.062],
      [0.03, -0.062], [0.0, -0.05], [-0.12, -0.05], [-0.2, -0.062], [-0.36, -0.09], [-0.64, -0.135]], 0.054, 0.007), M.chassis);
    // M-LOK slots on the forend
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) this.add(new THREE.BoxGeometry(0.003, 0.012, 0.03), M.rubber, sx * 0.0272, -0.03, -(0.12 + i * 0.05));
    // cheek riser + adjust knobs
    this.add(profile([[-0.46, 0.04], [-0.46, 0.07], [-0.27, 0.07], [-0.25, 0.045]], 0.046, 0.005), M.chassis);
    this.add(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 10).rotateZ(Math.PI / 2), M.metal, 0, 0.055, 0.29);
    // butt pad + monopod
    this.add(new THREE.BoxGeometry(0.058, 0.18, 0.02), M.rubber, 0, -0.045, 0.645);
    this.add(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 10), M.metal, 0, -0.14, 0.5);
    this.add(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12), M.rubber, 0, -0.18, 0.5);
    // pistol grip
    this.add(profile([[-0.105, -0.05], [-0.145, -0.05], [-0.21, -0.175], [-0.175, -0.19], [-0.11, -0.07]], 0.036, 0.006), M.rubber);
    // trigger guard + trigger
    const tg = new THREE.TorusGeometry(0.03, 0.004, 6, 16, Math.PI); tg.rotateY(Math.PI / 2); tg.rotateX(Math.PI);
    this.add(tg, M.metal, 0, -0.05, 0.065);
    this.trigger = this.add(new THREE.BoxGeometry(0.006, 0.025, 0.006), M.metal, 0, -0.06, 0.065);
    // ---- receiver ----
    const rec = lathe([[0, 0], [0.019, 0], [0.019, 0.27], [0, 0.27]], 24); rec.translate(0, 0.024, 0.12);
    this.add(rec, M.metal);
    this.add(new THREE.BoxGeometry(0.026, 0.01, 0.34), M.metal, 0, 0.047, -0.02);
    for (let i = 0; i < 16; i++) this.add(new THREE.BoxGeometry(0.027, 0.004, 0.006), M.rubber, 0, 0.051, 0.13 - i * 0.02);
    this.add(new THREE.BoxGeometry(0.03, 0.028, 0.06), M.metal, 0.004, 0.03, 0.02); // ejection port block
    this.add(new THREE.BoxGeometry(0.012, 0.006, 0.05), M.brass, 0.014, 0.034, 0.02); // visible round
    // ---- bolt ----
    this.boltG = new THREE.Group(); this.boltG.position.set(0, 0.024, 0.13); g.add(this.boltG);
    this.add(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 16).rotateX(Math.PI / 2), M.metal, 0, 0, 0.02, this.boltG);
    this.boltHandle = new THREE.Group(); this.boltG.add(this.boltHandle);
    this.add(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 8).rotateZ(Math.PI / 2 - 0.5), M.metal, 0.03, -0.012, 0, this.boltHandle);
    this.add(new THREE.SphereGeometry(0.011, 14, 10), M.metal, 0.058, -0.03, 0, this.boltHandle);
    // ---- magazine ----
    this.mag = new THREE.Group(); this.mag.position.set(0, -0.05, -0.04); g.add(this.mag);
    this.add(profile([[-0.04, 0], [0.04, 0], [0.035, -0.085], [-0.045, -0.08]], 0.032, 0.003), M.metal, 0, 0, 0, this.mag);
    this.add(new THREE.BoxGeometry(0.036, 0.01, 0.09), M.rubber, 0, -0.085, 0, this.mag);
    // ---- barrel + brake ----
    const brl = lathe([[0, 0], [0.0175, 0], [0.0175, 0.06], [0.0158, 0.12], [0.0118, 0.62], [0, 0.62]], 24);
    brl.translate(0, 0.024, -0.14); this.add(brl, M.barrel);
    const brake = lathe([[0, 0], [0.016, 0], [0.017, 0.012], [0.017, 0.07], [0.014, 0.08], [0, 0.08]], 20);
    brake.translate(0, 0.024, -0.76); this.add(brake, M.metal);
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) this.add(new THREE.BoxGeometry(0.006, 0.02, 0.012), M.rubber, sx * 0.0145, 0.024, -(0.78 + i * 0.02));
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.024, -0.85); g.add(this.muzzle);
    // ---- bipod (folded) ----
    this.add(new THREE.BoxGeometry(0.03, 0.02, 0.04), M.metal, 0, -0.07, -0.38);
    for (const sx of [-1, 1]) { const leg = this.add(new THREE.CylinderGeometry(0.006, 0.005, 0.24, 8).rotateX(Math.PI / 2), M.metal, sx * 0.014, -0.078, -0.26); leg.rotation.y = sx * 0.02; }
    // ---- scope ----
    const SY = 0.092; this.scopeY = SY;
    const scope = lathe([[0, 0], [0.021, 0], [0.022, 0.012], [0.021, 0.075], [0.0155, 0.11], [0.015, 0.24], [0.016, 0.25], [0.016, 0.3], [0.0155, 0.31], [0.0152, 0.37], [0.027, 0.44], [0.0285, 0.5], [0.027, 0.505], [0, 0.505]], 32);
    scope.translate(0, SY, 0.2); this.add(scope, M.scope);
    this.add(new THREE.CircleGeometry(0.025, 24).rotateY(Math.PI), M.lens, 0, SY, -0.3045);
    this.add(new THREE.CircleGeometry(0.018, 24), M.lens, 0, SY, 0.2005);
    this.add(new THREE.TorusGeometry(0.02, 0.003, 6, 24), M.rubber, 0, SY, 0.2);
    // turrets
    this.add(new THREE.BoxGeometry(0.034, 0.034, 0.05), M.scope, 0, SY, -0.06);
    this.add(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 24), M.scope, 0, SY + 0.03, -0.06);
    this.add(new THREE.CylinderGeometry(0.015, 0.015, 0.008, 24), M.metal, 0, SY + 0.046, -0.06);
    this.add(new THREE.CylinderGeometry(0.012, 0.012, 0.026, 24).rotateZ(Math.PI / 2), M.scope, 0.028, SY, -0.06);
    this.add(new THREE.CylinderGeometry(0.011, 0.011, 0.024, 24).rotateZ(Math.PI / 2), M.scope, -0.027, SY, -0.06);
    this.add(new THREE.BoxGeometry(0.004, 0.01, 0.004), M.brass, 0, SY + 0.05, -0.048);
    // rings
    for (const z of [0.08, -0.17]) {
      this.add(new THREE.TorusGeometry(0.0175, 0.0045, 8, 24), M.metal, 0, SY, z);
      this.add(new THREE.BoxGeometry(0.03, SY - 0.055, 0.02), M.metal, 0, (SY + 0.05) / 2 + 0.006, z);
      this.add(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 8).rotateZ(Math.PI / 2), M.metal, 0, 0.058, z);
    }
    // ---- hands ----
    const hand = (x, y, z, rx, ry, rz, grip) => {
      const h = new THREE.Group(); h.position.set(x, y, z); h.rotation.set(rx, ry, rz); g.add(h);
      this.add(new THREE.BoxGeometry(0.075, 0.03, 0.085), M.glove, 0, 0, 0, h);
      for (let i = 0; i < 4; i++) {
        const f = this.add(new THREE.CapsuleGeometry(0.0095, grip ? 0.045 : 0.05, 4, 8), M.glove, -0.028 + i * 0.019, -0.012, -0.06, h);
        f.rotation.x = grip ? 1.1 : 1.35;
        this.add(new THREE.SphereGeometry(0.0105, 8, 6), M.knuckle, -0.028 + i * 0.019, 0.006, -0.04, h);
      }
      const th = this.add(new THREE.CapsuleGeometry(0.01, 0.045, 4, 8), M.glove, 0.045, 0.005, -0.02, h); th.rotation.set(1.3, 0, -0.6);
      const wrist = this.add(new THREE.CylinderGeometry(0.034, 0.04, 0.09, 12).rotateX(Math.PI / 2), M.glove, 0, -0.002, 0.07, h);
      const arm = this.add(new THREE.CylinderGeometry(0.042, 0.05, 0.42, 14).rotateX(Math.PI / 2), M.sleeve, 0, -0.005, 0.32, h);
      return h;
    };
    this.rHand = hand(0.006, -0.11, 0.18, -0.35, 0, Math.PI / 2 - 0.15, true);
    this.lHand = hand(-0.012, -0.072, -0.3, 0.15, 0.35, -Math.PI / 2 + 0.25, false);
    this.lHandBase = this.lHand.position.clone();
    // ---- muzzle flash ----
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.muzzle, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.material.color.setRGB(10, 6, 2.5); this.flash.scale.setScalar(0.32); this.flash.visible = false;
    this.muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 6, 2); this.muzzle.add(this.flashLight);
    // soft fill so the rifle reads well even in building shadow (short range: only reaches the viewmodel)
    const fill = new THREE.PointLight(0xdfe8ff, 0.9, 1.6, 1.5); fill.position.set(0.25, 0.35, 0.25); this.root.add(fill);
  }

  // ---- triggers ----
  fire() { this.kickV += 1; this.flashT = 0.05; this.flash.material.rotation = Math.random() * 6.28; this.bolt = 0; }
  startReload(d) { this.reloadT = 0; this.reloadDur = d; }
  muzzleWorld(out) { this.gun.updateMatrixWorld(true); return this.muzzle.getWorldPosition(out); }
  setVisible(v) { this.root.visible = v; }

  update(dt, s) {
    this.t += dt;
    const t = this.t;
    this.ads = lerp(this.ads, s.ads ? 1 : 0, Math.min(1, dt * 12));
    this.sprint = lerp(this.sprint, s.sprint ? 1 : 0, Math.min(1, dt * 7));
    this.crouch = lerp(this.crouch, s.crouch ? 1 : 0, Math.min(1, dt * 8));
    // recoil spring
    this.kick += this.kickV * dt * 28; this.kickV *= Math.exp(-dt * 18);
    this.kick = lerp(this.kick, 0, Math.min(1, dt * 7));
    // mouse inertia sway
    this.swayX = lerp(this.swayX, clamp(-s.mouseDX * 0.0009, -0.04, 0.04), Math.min(1, dt * 10));
    this.swayY = lerp(this.swayY, clamp(s.mouseDY * 0.0009, -0.04, 0.04), Math.min(1, dt * 10));

    const hip = { x: 0.15, y: -0.2, z: -0.3 }, ads = { x: 0, y: -this.scopeY, z: -0.06 };
    const a = this.ads * this.ads * (3 - 2 * this.ads);
    const walk = s.moving ? 1 : 0;
    const bobX = Math.cos(t * 4.6) * 0.008 * walk * (1 - a * 0.8) + Math.sin(t * 1.3) * 0.0012;
    const bobY = Math.abs(Math.sin(t * 4.6)) * 0.01 * walk * (1 - a * 0.8) + Math.sin(t * 1.7) * 0.0015;
    this.root.position.set(
      lerp(hip.x, ads.x, a) + bobX + this.swayX - this.sprint * 0.02,
      lerp(hip.y, ads.y, a) - bobY + this.swayY - this.sprint * 0.04 - this.crouch * 0.01,
      lerp(hip.z, ads.z, a) + this.kick * 0.05,
    );
    this.root.rotation.set(this.kick * 0.09 - this.sprint * 0.35 + this.swayY * 2, this.sprint * 0.55 + this.swayX * 2, this.sprint * 0.25 + this.swayX * -1.5);

    // bolt cycle
    this.gun.position.set(0, 0, 0); this.gun.rotation.set(0, 0, 0);
    this.boltHandle.rotation.z = 0; this.boltG.position.z = 0.13;
    if (this.bolt >= 0) {
      this.bolt += dt;
      const b = this.bolt - 0.2; // short delay after the shot
      if (b > 0) {
        const up = clamp(b / 0.12, 0, 1) - clamp((b - 0.62) / 0.12, 0, 1);
        const back = clamp((b - 0.14) / 0.18, 0, 1) - clamp((b - 0.38) / 0.2, 0, 1);
        this.boltHandle.rotation.z = up * 1.2;
        this.boltG.position.z = 0.13 + back * 0.085;
        this.gun.rotation.z = -Math.sin(clamp(b / 0.8, 0, 1) * Math.PI) * 0.18;
        this.gun.position.y = -Math.sin(clamp(b / 0.8, 0, 1) * Math.PI) * 0.015;
      }
      if (this.bolt > 1.15) this.bolt = -1;
    }
    // reload
    this.mag.position.set(0, -0.05, -0.04); this.mag.visible = true; this.lHand.position.copy(this.lHandBase);
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      const k = this.reloadT / this.reloadDur;
      const tilt = Math.sin(clamp(k, 0, 1) * Math.PI);
      this.gun.rotation.z = tilt * 0.55; this.gun.rotation.x = tilt * 0.25; this.gun.position.y = -tilt * 0.05;
      const out = clamp((k - 0.15) / 0.15, 0, 1), inn = clamp((k - 0.55) / 0.15, 0, 1);
      this.mag.position.y = -0.05 - (out - inn) * 0.25;
      this.mag.visible = !(k > 0.3 && k < 0.5);
      this.lHand.position.lerpVectors(this.lHandBase, new THREE.Vector3(0, -0.13, -0.05), Math.sin(clamp((k - 0.1) / 0.75, 0, 1) * Math.PI));
      if (k > 0.75) { const b = (k - 0.75) / 0.25; this.boltHandle.rotation.z = Math.sin(b * Math.PI) * 1.2; this.boltG.position.z = 0.13 + Math.sin(clamp(b * 1.3, 0, 1) * Math.PI) * 0.085; }
      if (k >= 1) this.reloadT = -1;
    }
    // muzzle flash
    if (this.flashT > 0) { this.flashT -= dt; this.flash.visible = true; this.flashLight.intensity = 6; }
    else { this.flash.visible = false; this.flashLight.intensity = 0; }
    this.root.visible = s.visible;
  }
}
