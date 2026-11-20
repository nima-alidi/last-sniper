// Pedestrians, targets and portraits.
// Characters are Quaternius' CC0 animated people. Every person is rebuilt as ONE merged skinned mesh with
// baked vertex colours (skin / hair / clothes recoloured per person), so a crowd costs one draw call per person.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { renderer } from './engine.js';
import { TAU } from './ctx.js';

const FILES = ['business_man', 'casual', 'hoodie', 'worker', 'farmer', 'woman_b', 'woman_c', 'adventurer', 'punk_a', 'punk_b',
  'woman_casual', 'woman_dress', 'woman_plain', 'woman_tank', 'man_in_suit'];
export const MODELS = {};
export const modelNames = () => Object.keys(MODELS);

const GENDER = { business_man: 'm', casual: 'm', hoodie: 'm', worker: 'm', farmer: 'm', adventurer: 'm', punk_a: 'm', punk_b: 'f', woman_b: 'f', woman_c: 'f',
  woman_casual: 'f', woman_dress: 'f', woman_plain: 'f', woman_tank: 'f', man_in_suit: 'm' };
const GARMENT = { business_man: 'suit', casual: 'shirt', hoodie: 'hoodie', worker: 'work jacket', farmer: 'shirt', adventurer: 'jacket', punk_a: 'vest', punk_b: 'jacket',
  woman_b: 'top', woman_c: 'dress', woman_casual: 'top', woman_dress: 'dress', woman_plain: 'top', woman_tank: 'tank top', man_in_suit: 'jacket' };

// ---------- colour palettes: [name, 0xRRGGBB] ----------
export const SKIN = [['light', 0xf0c8a4], ['fair', 0xe3b48c], ['tan', 0xc78e5f], ['brown', 0x9b6a43], ['dark brown', 0x6e4529], ['deep', 0x4a2e20]];
export const HAIR = [['black', 0x16110f], ['dark brown', 0x35241a], ['brown', 0x5a3a22], ['auburn', 0x7a3a1c], ['blond', 0xc8a45a], ['grey', 0x9a9a98], ['white', 0xdddddd], ['red', 0x8b2a18]];
export const TOP = [['red', 0xc23b32], ['crimson', 0x8e1b2e], ['orange', 0xe07a2c], ['mustard', 0xd8aa2a], ['yellow', 0xeed24a], ['lime', 0x8dba3a], ['green', 0x2f8a4e],
  ['teal', 0x1f8a8a], ['sky blue', 0x4a9be0], ['blue', 0x2a58c8], ['navy', 0x1d2e5c], ['purple', 0x7a3fa8], ['pink', 0xe0709e], ['white', 0xe8e6e1], ['grey', 0x7c8087],
  ['black', 0x1e1f22], ['brown', 0x6b4a32], ['cream', 0xe3d9bf]];
export const BOTTOM = [['blue jeans', 0x3b5a8c], ['dark jeans', 0x1f2a3d], ['khaki', 0xb39a6a], ['black', 0x1d1d20], ['grey', 0x6a6e75], ['olive', 0x5a6040], ['brown', 0x58402e], ['cream', 0xcdc2a3]];
export const SUITS = [['charcoal', 0x2c2f34], ['navy', 0x1c2947], ['black', 0x141416], ['brown', 0x4b3a2c], ['grey', 0x6b6e74], ['cream', 0xe2d8bd], ['white', 0xe9e7e2]];
export const SHOES = [['black', 0x151515], ['brown', 0x4a3220], ['white', 0xdddddd], ['red', 0xa02020], ['grey', 0x55585e]];
export const ACC_COLORS = [['black', 0x1b1b1d], ['white', 0xe8e6e1], ['red', 0xb52a2a], ['navy', 0x1d2e5c], ['tan', 0xb59a6a], ['green', 0x2f6b3c], ['yellow', 0xe0b92b]];
const nameOf = (list, hex) => (list.find(c => c[1] === hex) || [])[0];

// ---------- animation lookup (three different naming schemes across the models) ----------
const KEYS = { walk: /(^|[|_])walk(ing)?$/i, run: /(^|[|_])run(ning)?$/i, idle: /(^|[|_])(idle|standing)$/i, idleN: /idle_neutral$/i, death: /(^|[|_])death$/i, hit: /hitrec|hit_?react/i };
const clipOf = (clips, k) => clips.find(c => KEYS[k].test(c.name));

// ---------- loading ----------
export async function loadPeople(base = '../assets/models/people/') {
  const L = new GLTFLoader();
  await Promise.all(FILES.map(async f => {
    try { MODELS[f] = prepare(f, await L.loadAsync(base + f + '.glb')); }
    catch (e) { console.warn('person model failed', f, e); }
  }));
  return modelNames().length > 0;
}

const KEEP = ['position', 'normal', 'skinIndex', 'skinWeight'];
// copy real values (works for interleaved and normalised attributes, unlike reading `.array` directly)
function copyAttr(at) {
  const s = at.itemSize, out = new Float32Array(at.count * s);
  for (let i = 0; i < at.count; i++) for (let k = 0; k < s; k++) out[i * s + k] = at.getComponent(i, k);
  return out;
}
function prepare(name, gltf) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const prims = []; scene.traverse(o => { if (o.isSkinnedMesh) prims.push(o); });
  if (!prims.length) throw new Error('no skinned mesh in ' + name);
  const skeleton = prims[0].skeleton, bind = prims[0].bindMatrix.clone();
  const box = new THREE.Box3().setFromObject(scene);
  const height = box.max.y - box.min.y;

  const list = [], segments = []; let offset = 0;
  for (const m of prims) {
    let g = m.geometry.clone();
    if (g.index) g = g.toNonIndexed();
    let vc = null;
    for (const a of Object.keys(g.attributes)) {
      if (a === 'color') vc = g.attributes.color;
      if (!KEEP.includes(a)) g.deleteAttribute(a);
    }
    for (const a of ['position', 'normal', 'skinIndex', 'skinWeight']) {       // unify array types so geometries can be merged
      g.setAttribute(a, new THREE.BufferAttribute(copyAttr(g.attributes[a]), g.attributes[a].itemSize));
    }
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    // body part from the mesh name (the loader appends _0, _1 ... to the names of extra primitives)
    const pm = `${m.name || ''} ${(m.parent && m.parent.name) || ''}`.match(/body|legs|pants|feet|head/i);
    const part = pm ? pm[0][0].toUpperCase() + pm[0].slice(1).toLowerCase() : '';
    const n = g.attributes.position.count;
    segments.push({ start: offset, count: n, part, mname: mat.name || '', base: mat.color.clone(), vc: vc ? { array: copyAttr(vc), size: vc.itemSize } : null });
    offset += n; list.push(g);
  }
  const geo = mergeGeometries(list);
  if (!geo) throw new Error('merge failed for ' + name);

  const bones = skeleton.bones, idx = n => bones.findIndex(b => b.name === n);
  const headI = idx('Head'), torsoI = idx('Torso') >= 0 ? idx('Torso') : idx('Spine2');
  // body-part size measured in the standing (rest) pose, in the same world frame the height was measured in
  const _v = new THREE.Vector3();
  const metrics = i => {
    if (i < 0) return null;
    let n = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const m of prims) {
      const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
      for (let v = 0; v < pos.count; v++) {
        let w = 0; for (let k = 0; k < 4; k++) if (si.getComponent(v, k) === i) w += sw.getComponent(v, k);
        if (w < 0.6) continue;
        _v.fromBufferAttribute(pos, v); m.applyBoneTransform(v, _v); _v.applyMatrix4(m.matrixWorld); n++;
        x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y); z0 = Math.min(z0, _v.z); z1 = Math.max(z1, _v.z);
      }
    }
    return n ? { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2, rz: (z1 - z0) / 2, minY: y0, maxY: y1, minZ: z0, maxZ: z1 } : null;
  };
  const head = metrics(headI) || { cx: 0, cy: box.min.y + height * 0.93, cz: 0, rx: height * 0.06, ry: height * 0.07, rz: height * 0.07, maxY: box.min.y + height };
  const torso = metrics(torsoI) || { cx: 0, cy: box.min.y + height * 0.68, cz: 0, rx: height * 0.14, ry: height * 0.15, rz: height * 0.09, minZ: -height * 0.09, maxZ: height * 0.09, minY: 0, maxY: 0 };
  head.r = Math.min(head.rx, head.ry, head.rz * 1.2) * 1.0;
  // accessory parent matrix: world-space accessory coordinates -> bone-local, using the bone's rest world matrix
  const inv = i => (i >= 0 ? bones[i].matrixWorld.clone().invert() : new THREE.Matrix4());

  const clips = gltf.animations;
  return { name, scene, clips, geo, segments, bind, height, scale: 1.78 / height, minY: box.min.y, head, torso, headInv: inv(headI), torsoInv: inv(torsoI), headIdx: headI, torsoIdx: torsoI, gender: GENDER[name] || 'm',
    garment: GARMENT[name] || 'outfit', hasSuit: name === 'man_in_suit' || segments.some(s => /^suit$/i.test(s.mname)) };
}

// ---------- looks ----------
const pickFrom = (rng, a) => a[Math.floor(rng() * a.length)];
export function randomLook(rng = Math.random, opts = {}) {
  const names = modelNames();
  const model = opts.model || pickFrom(rng, names);
  const look = {
    model, scale: 0.94 + rng() * 0.12,
    skin: pickFrom(rng, SKIN)[1], hair: pickFrom(rng, HAIR)[1], top: pickFrom(rng, TOP)[1], bottom: pickFrom(rng, BOTTOM)[1],
    suit: pickFrom(rng, SUITS.slice(0, 5))[1], shoe: pickFrom(rng, SHOES)[1], tie: pickFrom(rng, TOP)[1], acc: [],
  };
  const r = rng();
  if (r < 0.12) look.acc.push({ type: 'cap', color: pickFrom(rng, ACC_COLORS)[1] });
  else if (r < 0.16) look.acc.push({ type: 'fedora', color: pickFrom(rng, ACC_COLORS)[1] });
  if (rng() < 0.13) look.acc.push({ type: 'glasses' });
  if (rng() < 0.1) look.acc.push({ type: 'backpack', color: pickFrom(rng, ACC_COLORS)[1] });
  return look;
}
export function describeLook(look) {
  const M = MODELS[look.model] || {};
  const bits = [];
  const gar = M.hasSuit ? `${nameOf(SUITS, look.suit) || 'dark'} suit${nameOf(TOP, look.tie) ? ' with a ' + nameOf(TOP, look.tie) + ' tie' : ''}` : `${nameOf(TOP, look.top) || 'plain'} ${M.garment || 'outfit'}`;
  bits.push(`Wearing ${/^[aeiou]/i.test(gar) ? 'an' : 'a'} ${gar}`);
  if (!M.hasSuit && M.garment !== 'dress') bits.push(`${nameOf(BOTTOM, look.bottom) || 'dark'} trousers`);
  for (const a of look.acc || []) {
    if (a.type === 'cap') bits.push(`${nameOf(ACC_COLORS, a.color) || ''} cap`.trim());
    if (a.type === 'fedora') bits.push(`${nameOf(ACC_COLORS, a.color) || ''} hat`.trim());
    if (a.type === 'glasses') bits.push('dark glasses');
    if (a.type === 'backpack') bits.push('backpack');
  }
  const tall = look.scale > 1.04 ? 'Tall' : look.scale < 0.97 ? 'Short' : 'Average height';
  return { gender: M.gender === 'f' ? 'Female' : 'Male', build: `${tall}, ${nameOf(HAIR, look.hair) || 'dark'} hair, ${nameOf(SKIN, look.skin) || ''} skin`.replace(' ,', ','), clothes: bits };
}

// ---------- geometry variants (cached per colour combination) ----------
const SHARED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 });
const variantCache = new Map();
function roleOf(seg, model) {
  const m = seg.mname;
  if (/^skin/i.test(m)) return 'skin';
  if (/^eyes?$/i.test(m) || /earring/i.test(m)) return 'keep';
  if (/hair|eyebrow|mousta|beard/i.test(m)) return 'hair';
  if (seg.part === 'Head' && /^(woman_c|woman_b|adventurer)$/.test(model)) return 'hair';   // their hair materials have colour names
  if (model === 'man_in_suit') return /^(shirt|pants)$/i.test(m) ? 'suit' : /^tie/i.test(m) ? 'tie' : 'keep';
  if (/^suit$/i.test(m)) return 'suit';
  if (/^tie$/i.test(m)) return 'tie';
  // the simple rigs name their materials after the garment
  if (/^pants$/i.test(m)) return 'bottom';
  if (/^(shoes|socks)$/i.test(m)) return 'shoe';
  if (/^(shirt|dress|jacket|lightjacket)$/i.test(m)) return 'top';
  if (seg.part === 'Feet') return 'shoe';
  if (seg.part === 'Legs' || seg.part === 'Pants') return 'bottom';
  if (seg.part === 'Body') return /^(black|white|grey)$/i.test(m) ? 'keep' : 'top';
  return 'keep';
}
const _c = new THREE.Color();
function variantGeometry(M, look) {
  const key = [M.name, look.skin, look.hair, look.top, look.bottom, look.suit, look.shoe, look.tie].join('|');
  let g = variantCache.get(key); if (g) return g;
  const n = M.geo.attributes.position.count, col = new Float32Array(n * 3);
  for (const seg of M.segments) {
    const role = roleOf(seg, M.name);
    const hex = { skin: look.skin, hair: look.hair, suit: look.suit, tie: look.tie ?? look.top, shoe: look.shoe, bottom: look.bottom, top: look.top }[role];
    const base = hex !== undefined && hex !== null ? _c.set(hex) : _c.copy(seg.base);
    let r = base.r, gr = base.g, b = base.b;
    if (role === 'skin' && /darker/i.test(seg.mname)) { r *= 0.92; gr *= 0.92; b *= 0.92; }
    for (let i = 0; i < seg.count; i++) {
      let k = 1, kg = 1, kb = 1;
      if (seg.vc) { const o = i * seg.vc.size; k = seg.vc.array[o]; kg = seg.vc.array[o + 1]; kb = seg.vc.array[o + 2]; }
      const o3 = (seg.start + i) * 3; col[o3] = r * k; col[o3 + 1] = gr * kg; col[o3 + 2] = b * kb;
    }
  }
  g = new THREE.BufferGeometry();
  for (const a of KEEP) g.setAttribute(a, M.geo.attributes[a]);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  variantCache.set(key, g);
  return g;
}

// ---------- accessories (built in the model's own units, attached to head / torso bones) ----------
const accMat = hex => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.7 });
function buildAccessory(M, a) {
  const g = new THREE.Group(), H = M.head, T = M.torso, u = M.height / 1.8, r = H.r;
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
  if (a.type === 'cap') {
    const mat = accMat(a.color);
    add(new THREE.SphereGeometry(r * 1.1, 14, 8, 0, TAU, 0, Math.PI / 2), mat, H.cx, H.cy + r * 0.12, H.cz);
    add(new THREE.BoxGeometry(r * 1.5, 0.03 * u, r * 0.95), mat, H.cx, H.cy + r * 0.2, H.cz + r * 1.05);
    return { obj: g, bone: 'head' };
  }
  if (a.type === 'fedora') {
    const mat = accMat(a.color);
    add(new THREE.CylinderGeometry(r * 0.98, r * 1.04, r * 0.8, 14), mat, H.cx, H.cy + r * 0.95, H.cz);
    add(new THREE.CylinderGeometry(r * 1.95, r * 1.95, 0.035 * u, 18), mat, H.cx, H.cy + r * 0.52, H.cz);
    add(new THREE.CylinderGeometry(r * 1.0, r * 1.06, r * 0.22, 14), accMat(0x15151a), H.cx, H.cy + r * 0.66, H.cz);
    return { obj: g, bone: 'head' };
  }
  if (a.type === 'glasses') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.2, metalness: 0.5 });
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(r * 0.62, r * 0.38, 0.03 * u), mat, H.cx + s * r * 0.4, H.cy + r * 0.08, H.cz + r * 1.0);
    add(new THREE.BoxGeometry(r * 0.3, 0.025 * u, 0.03 * u), mat, H.cx, H.cy + r * 0.14, H.cz + r * 1.0);
    return { obj: g, bone: 'head' };
  }
  if (a.type === 'backpack') {
    add(new THREE.BoxGeometry(0.34 * u, 0.44 * u, 0.17 * u), accMat(a.color), T.cx, T.cy + 0.04 * u, T.minZ - 0.075 * u);
    return { obj: g, bone: 'torso' };
  }
  return null;
}

// ---------- the person object ----------
const HIT_MAT = new THREE.MeshBasicMaterial({ visible: false });
const UB = new THREE.BoxGeometry(1, 1, 1), US = new THREE.SphereGeometry(1, 8, 6);
export function createPerson(look) {
  const M = MODELS[look.model] || MODELS[modelNames()[0]];
  const root = new THREE.Group();
  const body = SkeletonUtils.clone(M.scene);
  const prims = []; body.traverse(o => { if (o.isSkinnedMesh) prims.push(o); });
  const skeleton = prims[0].skeleton;
  prims.forEach(p => p.removeFromParent());
  const mesh = new THREE.SkinnedMesh(variantGeometry(M, look), SHARED);
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  body.add(mesh); mesh.bind(skeleton, M.bind);
  const sc = M.scale * (look.scale || 1);
  body.scale.multiplyScalar(sc);
  body.position.y = -M.minY * sc;     // feet on the ground
  root.add(body);

  const boneByName = n => body.getObjectByName(n);
  for (const a of look.acc || []) {
    const built = buildAccessory(M, a); if (!built) continue;
    const bone = built.bone === 'head' ? boneByName('Head') : boneByName('Torso') || boneByName('Spine2');
    if (!bone) continue;
    const holder = new THREE.Group(); holder.matrixAutoUpdate = false;
    holder.matrix.copy(built.bone === 'head' ? M.headInv : M.torsoInv); holder.matrixWorldNeedsUpdate = true;
    holder.add(built.obj); bone.add(holder);
  }

  // animations
  const mixer = new THREE.AnimationMixer(body), act = {};
  for (const k of ['walk', 'run', 'idle', 'death', 'hit']) {
    const c = (k === 'idle' ? clipOf(M.clips, 'idleN') || clipOf(M.clips, 'idle') : clipOf(M.clips, k));
    if (c) act[k] = mixer.clipAction(c);
  }
  for (const k of ['death', 'hit']) if (act[k]) { act[k].setLoop(THREE.LoopOnce, 1); act[k].clampWhenFinished = true; }
  let cur = null, curName = '', oneShot = 0;
  const play = (name, fade = 0.25, speed = 1) => {
    const a = act[name] || act.idle; if (!a) return;
    a.setEffectiveTimeScale(speed);
    if (a === cur) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (/walk|run|idle/.test(name)) a.time = Math.random() * a.getClip().duration;      // desync the crowd
    if (cur) cur.fadeOut(fade);
    cur = a; curName = name;
  };
  play('idle', 0);

  // hit proxies (simple, move with the root)
  const hits = [];
  const hb = (geo, part, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, HIT_MAT); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.userData.part = part; root.add(m); hits.push(m); return m; };
  const k = look.scale || 1;
  const headY = ((M.head.cy - M.minY) * sc);
  hb(US, 'head', 0, headY, 0, 0.14 * k, 0.16 * k, 0.15 * k);
  hb(UB, 'body', 0, 1.1 * k, 0, 0.5 * k, 0.72 * k, 0.34 * k);
  hb(UB, 'limb', 0, 0.45 * k, 0, 0.34 * k, 0.86 * k, 0.3 * k);

  const person = {
    root, body, mesh, look, hits, model: M, headY, play, get anim() { return curName; },
    update(dt) { mixer.update(dt); },
    headWorld(out) { const h = boneByName('Head'); if (h) { body.updateMatrixWorld(true); return h.getWorldPosition(out); } return out.set(0, headY, 0); },
    death() { if (act.death) { act.death.reset().setEffectiveWeight(1).play(); if (cur && cur !== act.death) cur.fadeOut(0.15); cur = act.death; curName = 'death'; } },
    flinch() { if (act.hit) { act.hit.reset().setEffectiveWeight(1).play(); } },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(body); },
  };
  return person;
}

// ---------- portrait for the dossier (rendered with the main renderer into a scissor region) ----------
export function renderPortrait(look, w = 300, h = 360) {
  const p = createPerson(look);
  const sc = new THREE.Scene();
  sc.background = new THREE.Color(0x6f747b);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x666a70, 1.6));
  const d = new THREE.DirectionalLight(0xfff0e0, 2.8); d.position.set(1.8, 2.6, 3.4); sc.add(d);
  const fill = new THREE.DirectionalLight(0x9db8ff, 0.8); fill.position.set(-2, 1, 1.5); sc.add(fill);
  sc.add(p.root); p.play('idle', 0); p.update(0.4); p.root.updateMatrixWorld(true);
  const head = p.headWorld(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(28, w / h, 0.1, 30);
  cam.position.set(head.x + 0.18, head.y + 0.02, head.z + 1.75); cam.lookAt(head.x, head.y - 0.13, head.z);
  const pr = renderer.getPixelRatio();
  const prevTest = renderer.getScissorTest();
  renderer.setRenderTarget(null);
  renderer.setScissorTest(true); renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
  renderer.render(sc, cam);
  const src = renderer.domElement, out = document.createElement('canvas');
  out.width = Math.round(w * pr); out.height = Math.round(h * pr);
  const g = out.getContext('2d');
  g.filter = 'sepia(0.35) contrast(1.12) saturate(0.85)';
  g.drawImage(src, 0, src.height - out.height, out.width, out.height, 0, 0, out.width, out.height);
  g.filter = 'none';
  // film grain + vignette
  const vg = g.createRadialGradient(out.width / 2, out.height / 2, out.width * 0.25, out.width / 2, out.height / 2, out.width * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = vg; g.fillRect(0, 0, out.width, out.height);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},0.045)`; g.fillRect(Math.random() * out.width, Math.random() * out.height, 2, 2); }
  renderer.setScissorTest(prevTest); renderer.setViewport(0, 0, innerWidth, innerHeight); renderer.setScissor(0, 0, innerWidth, innerHeight);
  p.dispose();
  return out.toDataURL('image/jpeg', 0.9);
}
