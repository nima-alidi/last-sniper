// Soldier characters for AI snipers and remote players.
// Main model: realistic Mixamo "Soldier" (three.js examples) with a procedural rifle pose:
// the rifle is placed on the shoulder and both arms are solved with two-bone IK onto it.
// Fallback: simple box soldier (if the model fails to load).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { lerp, clamp } from './ctx.js';

const TEAM_COLORS = { A: 0x3a8cff, B: 0xff5a3c, F: 0xe8b14a, N: 0x666666, AI: 0x7a1f1f };

function nameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.font = 'bold 34px Bahnschrift, Segoe UI, sans-serif'; g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(text, 128, 44);
  g.fillStyle = '#' + new THREE.Color(color).getHexString(); g.fillText(text, 128, 44);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
  s.scale.set(1.6, 0.4, 1); s.renderOrder = 10; return s;
}

// ---------- shared rifle model (origin = firing grip, +z = muzzle) ----------
const RIFLE_MAT = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.45, metalness: 0.7 });
const STOCK_MAT = new THREE.MeshStandardMaterial({ color: 0x5a5840, roughness: 0.8 });
const LENS_MAT = new THREE.MeshStandardMaterial({ color: 0x0c1824, roughness: 0.05, metalness: 0.6 });
function makeRifle() {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  add(new THREE.BoxGeometry(0.055, 0.08, 0.6), STOCK_MAT, 0, 0, 0.14);       // fore-end
  add(new THREE.BoxGeometry(0.05, 0.12, 0.34), STOCK_MAT, 0, -0.02, -0.2);   // stock
  add(new THREE.BoxGeometry(0.035, 0.1, 0.04), STOCK_MAT, 0, -0.07, -0.01); // grip
  add(new THREE.CylinderGeometry(0.011, 0.014, 0.6, 10), RIFLE_MAT, 0, 0.03, 0.72, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.022, 0.028, 0.34, 12), RIFLE_MAT, 0, 0.1, 0.1, Math.PI / 2);
  add(new THREE.CircleGeometry(0.028, 12), LENS_MAT, 0, 0.1, 0.271);
  add(new THREE.BoxGeometry(0.03, 0.08, 0.06), RIFLE_MAT, 0, -0.07, 0.12);   // magazine
  return g;
}

// =================== fallback box soldier ===================
const BMAT = {
  cloth: new THREE.MeshStandardMaterial({ color: 0x555842, roughness: 0.95 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xb48868, roughness: 0.75 }),
  boot: new THREE.MeshStandardMaterial({ color: 0x1d1a16, roughness: 0.8 }),
};
function createBoxSoldier({ team = 'AI', name = '', showName = false } = {}) {
  const root = new THREE.Group(); const hits = [];
  const box = (w, h, d, mat, x, y, z, part) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; root.add(m); if (part) { m.userData.part = part; hits.push(m); } return m; };
  box(0.36, 0.9, 0.24, BMAT.cloth, 0, 0.45, 0, 'limb');
  box(0.44, 0.6, 0.28, BMAT.cloth, 0, 1.2, 0, 'body');
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), BMAT.skin); head.position.set(0, 1.62, 0); root.add(head); head.userData.part = 'head'; hits.push(head);
  const rifle = makeRifle(); rifle.position.set(-0.12, 1.4, 0.2); root.add(rifle);
  let tag = null;
  if (showName && name) { tag = nameSprite(name, TEAM_COLORS[team]); tag.position.set(0, 2.15, 0); root.add(tag); }
  let dead = 0, crouchK = 0;
  return {
    root, hits, team,
    scopeWorld(out) { return rifle.localToWorld(out.set(0, 0.1, 0.27)); },
    muzzleWorld(out) { root.updateMatrixWorld(true); return rifle.localToWorld(out.set(0, 0.03, 1.03)); },
    setOwner(o) { for (const h of hits) h.userData.owner = o; },
    showTag(v) { if (tag) tag.visible = v; },
    playShoot() {}, playHit() {},
    pose(dt, st) {
      dead = st.dead ? Math.min(1, dead + dt * 2) : 0;
      crouchK = lerp(crouchK, st.crouch && !st.dead ? 1 : 0, Math.min(1, dt * 8));
      root.rotation.x = -dead * 1.45;
      root.position.y = (st.baseY || 0) - crouchK * 0.55;
      rifle.rotation.x = st.aim ? -(st.pitch || 0) : 0.5;
    },
    dispose() { root.traverse(o => { if (o.geometry && o.geometry !== undefined && o.material !== RIFLE_MAT) o.geometry.dispose(); }); },
  };
}

// =================== Mixamo soldier ===================
let LIB = null; // { scene, clips }
export async function loadCharacters(base = '../assets/models/') {
  try {
    const g = await new GLTFLoader().loadAsync(base + 'mixamo_soldier.glb');
    LIB = { scene: g.scene, clips: g.animations };
    return true;
  } catch (e) { console.warn('character model failed, using fallback', e); return false; }
}

// uniform tint multiplied over the texture, per team
const TINT = { A: 0x9db8ff, B: 0xffa08c, F: 0xe8dcc0, N: 0xcccccc, AI: 0xe6d9ae };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
// rotate `bone` (in world space) so that the direction bone->childPos points at target
function aimBone(bone, childPos, target) {
  const bp = bone.getWorldPosition(_a);
  const cur = _b.copy(childPos).sub(bp).normalize();
  const des = _c.copy(target).sub(bp).normalize();
  if (cur.lengthSq() < 1e-8 || des.lengthSq() < 1e-8) return;
  _q1.setFromUnitVectors(cur, des);
  bone.getWorldQuaternion(_q2);
  _q1.multiply(_q2);                                  // new world rotation
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q1));
  bone.updateMatrixWorld(true);
}
// rotate a bone about a world axis (keeps children attached)
function rotateBoneWorld(bone, axis, angle) {
  _q1.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_q2);
  _q1.multiply(_q2);
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q1));
  bone.updateMatrixWorld(true);
}
// analytic two-bone IK: upper -> lower -> end reaches `target`, elbow bends towards `pole`
const _el = new THREE.Vector3(), _pd = new THREE.Vector3(), _dir = new THREE.Vector3(), _tmp = new THREE.Vector3();
function twoBoneIK(upper, lower, end, target, pole) {
  const a = upper.getWorldPosition(new THREE.Vector3());
  const b = lower.getWorldPosition(new THREE.Vector3());
  const c = end.getWorldPosition(new THREE.Vector3());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  _dir.copy(target).sub(a); let d = _dir.length(); _dir.divideScalar(d || 1);
  d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const along = (l1 * l1 + d * d - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  _pd.copy(pole).sub(a); _pd.addScaledVector(_dir, -_pd.dot(_dir)).normalize();
  _el.copy(a).addScaledVector(_dir, along).addScaledVector(_pd, h);
  aimBone(upper, b, _el);
  aimBone(lower, end.getWorldPosition(_tmp), target);
}

function createMixamoSoldier({ team = 'AI', name = '', showName = false } = {}) {
  const root = new THREE.Group();
  const body = SkeletonUtils.clone(LIB.scene);
  body.rotation.y = Math.PI; // model faces -z, our soldiers face +z
  root.add(body);
  body.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      o.material = o.material.clone();
      if (o.material.name === 'VanguardBodyMat') o.material.color.set(TINT[team] ?? TINT.N);
      o.material.envMapIntensity = 0.8;
    }
  });
  const bone = n => body.getObjectByName('mixamorig' + n);
  const B = {
    hips: bone('Hips'), spine: bone('Spine2'), neck: bone('Neck'), head: bone('Head'),
    rArm: bone('RightArm'), rFore: bone('RightForeArm'), rHand: bone('RightHand'),
    lArm: bone('LeftArm'), lFore: bone('LeftForeArm'), lHand: bone('LeftHand'),
    lUp: bone('LeftUpLeg'), lLeg: bone('LeftLeg'), lFoot: bone('LeftFoot'),
    rUp: bone('RightUpLeg'), rLeg: bone('RightLeg'), rFoot: bone('RightFoot'),
  };

  const mixer = new THREE.AnimationMixer(body);
  const act = {};
  for (const n of ['Idle', 'Walk', 'Run']) { const c = LIB.clips.find(x => x.name === n); if (c) act[n] = mixer.clipAction(c); }
  let current = null;
  const play = (n, fade = 0.3) => {
    const a = act[n] || act.Idle; if (!a || a === current) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play(); if (current) current.fadeOut(fade); current = a;
  };
  play('Idle', 0);
  mixer.update(Math.random() * 2); // desync idle breathing between soldiers

  // hitboxes following the skeleton
  const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
  const UB = new THREE.BoxGeometry(1, 1, 1), US = new THREE.SphereGeometry(1, 8, 6);
  const hits = [];
  const hb = (geo, part) => { const m = new THREE.Mesh(geo, HIT_MAT); m.userData.part = part; root.add(m); hits.push(m); return m; };
  const H = {
    head: hb(US, 'head'), torso: hb(UB, 'body'),
    thighL: hb(UB, 'limb'), shinL: hb(UB, 'limb'), thighR: hb(UB, 'limb'), shinR: hb(UB, 'limb'),
    armL: hb(UB, 'limb'), foreL: hb(UB, 'limb'), armR: hb(UB, 'limb'), foreR: hb(UB, 'limb'),
  };
  const wa = new THREE.Vector3(), wb = new THREE.Vector3(), mid = new THREE.Vector3();
  const seg = (m, A, Bn, t) => {
    A.getWorldPosition(wa); Bn.getWorldPosition(wb);
    mid.copy(wa).add(wb).multiplyScalar(0.5);
    m.position.copy(root.worldToLocal(mid.clone())); m.lookAt(wb); m.scale.set(t, t, Math.max(0.05, wa.distanceTo(wb)));
  };

  const rifle = makeRifle(); root.add(rifle);
  let tag = null;
  if (showName && name) { tag = nameSprite(name, TEAM_COLORS[team]); tag.position.set(0, 2.15, 0); root.add(tag); }

  let deadT = 0, crouchK = 0, aimK = 0, recoil = 0, hitT = 0;
  const up = new THREE.Vector3(0, 1, 0);
  const rightW = new THREE.Vector3(), fwdW = new THREE.Vector3(), tgt = new THREE.Vector3(), pole = new THREE.Vector3();
  const shoulder = new THREE.Vector3();

  return {
    root, hits, team,
    scopeWorld(out) { return rifle.localToWorld(out.set(0, 0.1, 0.27)); },
    muzzleWorld(out) { root.updateMatrixWorld(true); return rifle.localToWorld(out.set(0, 0.03, 1.03)); },
    setOwner(o) { for (const h of hits) h.userData.owner = o; },
    showTag(v) { if (tag) tag.visible = v; },
    playShoot() { recoil = 1; },
    playHit() { hitT = 0.6; },
    // st: {crouch, moving, run, aim, pitch, dead, baseY}
    pose(dt, st) {
      if (st.dead) deadT += dt; else deadT = 0;
      if (st.moving && !st.dead) play(st.run ? 'Run' : 'Walk'); else play('Idle');
      mixer.update(dt);
      crouchK = lerp(crouchK, st.crouch && !st.dead ? 1 : 0, Math.min(1, dt * 8));
      aimK = lerp(aimK, st.aim && !st.dead ? 1 : 0, Math.min(1, dt * 7));
      recoil = Math.max(0, recoil - dt * 5); hitT = Math.max(0, hitT - dt);
      // death: fall backwards
      const fall = clamp(deadT * 2.2, 0, 1);
      root.rotation.x = -fall * fall * 1.45;
      root.position.y = (st.baseY || 0) - crouchK * 0.55 - fall * 0.15;
      root.updateMatrixWorld(true);
      body.updateMatrixWorld(true);

      // world-space frame of the soldier
      rightW.set(-1, 0, 0).transformDirection(root.matrixWorld);   // character's right
      fwdW.set(0, 0, 1).transformDirection(root.matrixWorld);
      const pitch = clamp(st.pitch || 0, -1, 1) * aimK;

      if (!st.dead) {
        // lean the upper body with the aim pitch, flinch back when hit
        // strong visible flinch for ~0.6 s when hit (bends back and twists)
        const hk = hitT > 0 ? Math.sin((1 - hitT / 0.6) * Math.PI) : 0;
        rotateBoneWorld(B.spine, rightW, -pitch * 0.45 - hk * 0.7);
        if (hk) rotateBoneWorld(B.spine, up, hk * 0.5);
        // rifle: shouldered when aiming, low-ready across the body otherwise
        B.rArm.getWorldPosition(shoulder);
        const lowPitch = -0.75, lowYaw = 0.55;
        const p = lerp(lowPitch, pitch, aimK), y = lerp(lowYaw, 0, aimK);
        const grip = tgt.copy(shoulder)
          .addScaledVector(fwdW, lerp(0.12, 0.2, aimK) - recoil * 0.05)
          .addScaledVector(up, lerp(-0.28, -0.07, aimK))
          .addScaledVector(rightW, lerp(-0.12, -0.03, aimK));
        rifle.position.copy(root.worldToLocal(grip.clone()));
        rifle.rotation.set(-(p + recoil * 0.12), y, lerp(0.25, 0, aimK), 'YXZ');
        rifle.updateMatrixWorld(true);
        // hands onto the rifle
        twoBoneIK(B.rArm, B.rFore, B.rHand, rifle.localToWorld(_d.set(0, -0.05, -0.02)),
          pole.copy(shoulder).addScaledVector(up, -0.5).addScaledVector(rightW, 0.45).addScaledVector(fwdW, -0.2));
        B.lArm.getWorldPosition(_e);
        twoBoneIK(B.lArm, B.lFore, B.lHand, rifle.localToWorld(_d.set(0, -0.04, 0.4)),
          pole.copy(_e).addScaledVector(up, -0.6).addScaledVector(rightW, -0.25));
        // head follows the aim
        rotateBoneWorld(B.head, rightW, -pitch * 0.35);
      }
      rifle.visible = !(st.dead && deadT > 0.3);

      // hitboxes
      B.head.getWorldPosition(wa); wa.y += 0.1;
      H.head.position.copy(root.worldToLocal(wa.clone())); H.head.scale.setScalar(0.14);
      seg(H.torso, B.hips, B.neck, 0.36);
      seg(H.thighL, B.lUp, B.lLeg, 0.17); seg(H.shinL, B.lLeg, B.lFoot, 0.14);
      seg(H.thighR, B.rUp, B.rLeg, 0.17); seg(H.shinR, B.rLeg, B.rFoot, 0.14);
      seg(H.armL, B.lArm, B.lFore, 0.12); seg(H.foreL, B.lFore, B.lHand, 0.1);
      seg(H.armR, B.rArm, B.rFore, 0.12); seg(H.foreR, B.rFore, B.rHand, 0.1);
    },
    dispose() {
      mixer.stopAllAction();
      body.traverse(o => { if (o.isMesh) o.material.dispose(); });
    },
  };
}

export function createSoldier(opts) {
  return LIB ? createMixamoSoldier(opts) : createBoxSoldier(opts);
}
