// Seeded procedural city. Same seed => same city on every client.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './engine.js';
import { MAT, FACADES } from './assets.js';
import { mulberry32, TAU } from './ctx.js';

export const N = 7, BS = 42, ST = 14, PITCH = BS + ST;
export const TOWER = { y: 48, half: 11, parapet: 1.0 };

const CGEO = new THREE.BoxGeometry(1, 1, 1), CMAT = new THREE.MeshBasicMaterial();

export function buildWorld(seed) {
  const R = mulberry32(seed);
  const rr = (a, b) => a + R() * (b - a);
  const pick = a => a[Math.floor(R() * a.length)];
  const root = new THREE.Group(); root.name = 'world';
  const buckets = new Map();
  const colliders = [];
  const nests = [];      // AI sniper positions (solo)
  const spawns = [];     // rooftop spawn areas (multiplayer)
  const treeSpots = [], carSpots = [], lampSpots = [];
  const footprints = []; // building outlines for the minimap
  const ambient = { plumes: [], dust: null };

  // ---------- low level builders ----------
  function addCollider(x, y, z, w, h, d, ry = 0) {
    const m = new THREE.Mesh(CGEO, CMAT);
    m.position.set(x, y, z); m.scale.set(w, h, d); m.rotation.y = ry; m.updateMatrixWorld(true);
    colliders.push(m); return m;
  }
  function addGeo(geo, mat, x, y, z, ry = 0) {
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geo);
  }
  // box with UVs in world metres (texture covers tu x tv metres); y0 offsets facade rows
  function boxUV(w, h, d, tu, tv = tu, y0 = 0) {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      const [fu, fv] = dims[f], side = f !== 2 && f !== 3;
      for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * fu / tu, side ? (uv.getY(k) * fv + y0) / tv : uv.getY(k) * fv / tu); }
    }
    return g;
  }
  function sbox(x, y, z, w, h, d, mat, { ry = 0, collide = true } = {}) {
    const t = mat.userData.tile || 0;
    addGeo(t ? boxUV(w, h, d, t) : new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry);
    if (collide) addCollider(x, y, z, w, h, d, ry);
  }
  function plane(x, y, z, w, d, mat, ry = 0) {
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
    const t = mat.userData.tile;
    if (t) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / t, uv.getY(i) * d / t); }
    addGeo(g, mat, x, y, z, ry);
  }
  function cyl(x, y, z, rt, rb, h, mat, seg = 14, collide = true) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    const t = mat.userData.tile; if (t) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (TAU * rb) / t, uv.getY(i) * h / t); }
    addGeo(g, mat, x, y, z);
    if (collide) addCollider(x, y, z, rb * 1.8, h, rb * 1.8);
  }

  // ---------- props ----------
  function parapet(x, z, w, d, h, ph = 0.55, t = 0.35) {
    sbox(x, h + ph / 2, z - d / 2 + t / 2, w, ph, t, MAT.concrete);
    sbox(x, h + ph / 2, z + d / 2 - t / 2, w, ph, t, MAT.concrete);
    sbox(x - w / 2 + t / 2, h + ph / 2, z, t, ph, d - 2 * t, MAT.concrete);
    sbox(x + w / 2 - t / 2, h + ph / 2, z, t, ph, d - 2 * t, MAT.concrete);
    if (ph > 0.8) { // coping stones on tall parapets
      sbox(x, h + ph + 0.05, z - d / 2 + t / 2, w + 0.1, 0.1, t + 0.12, MAT.concrete, { collide: false });
      sbox(x, h + ph + 0.05, z + d / 2 - t / 2, w + 0.1, 0.1, t + 0.12, MAT.concrete, { collide: false });
      sbox(x - w / 2 + t / 2, h + ph + 0.05, z, t + 0.12, 0.1, d, MAT.concrete, { collide: false });
      sbox(x + w / 2 - t / 2, h + ph + 0.05, z, t + 0.12, 0.1, d, MAT.concrete, { collide: false });
    }
  }
  function sandbagWall(cx, y, cz, ry, width = 3.4, rows = 4) {
    for (let r = 0; r < rows; r++) {
      const n = Math.round(width / 0.66) - (r % 2);
      for (let k = 0; k < n; k++) {
        const g = new THREE.SphereGeometry(1, 12, 7); g.scale(0.35, 0.14, 0.23);
        g.rotateY(rr(-0.1, 0.1)); g.rotateZ(rr(-0.05, 0.05));
        g.translate(-width / 2 + 0.33 + k * 0.66 + (r % 2) * 0.33, 0.12 + r * 0.24, rr(-0.02, 0.02));
        addGeo(g, MAT.sandbag, cx, y, cz, ry);
      }
    }
    addCollider(cx, y + rows * 0.12, cz, width, rows * 0.24, 0.5, ry);
  }
  function waterTower(x, y, z) {
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) sbox(x + a * 1.3, y + 1.6, z + b * 1.3, 0.18, 3.2, 0.18, MAT.darkMetal, { collide: false });
    sbox(x, y + 3.15, z, 3, 0.15, 3, MAT.metal, { collide: false });
    cyl(x, y + 4.9, z, 2, 2, 3.4, MAT.wood, 20);
    for (const hy of [3.9, 4.9, 5.9]) addGeo(new THREE.TorusGeometry(2.02, 0.03, 4, 28).rotateX(Math.PI / 2), MAT.darkMetal, x, y + hy, z);
    addGeo(new THREE.ConeGeometry(2.2, 1.3, 20), MAT.darkMetal, x, y + 7.25, z);
    addCollider(x, y + 1.6, z, 3, 3.2, 3);
  }
  function acUnit(x, y, z, ry) {
    sbox(x, y + 0.7, z, 2.2, 1.4, 1.6, MAT.metalPaint, { ry });
    addGeo(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 18), MAT.darkMetal, x, y + 1.43, z);
    sbox(x, y + 0.08, z, 2.4, 0.16, 1.8, MAT.darkMetal, { ry, collide: false });
  }
  function antenna(x, y, z) {
    const h = rr(6, 14);
    cyl(x, y + h / 2, z, 0.05, 0.09, h, MAT.metal, 6, false);
    sbox(x, y + h * 0.75, z, 1.4, 0.05, 0.05, MAT.metal, { collide: false });
    sbox(x, y + h * 0.6, z, 0.05, 0.05, 1.0, MAT.metal, { collide: false });
    const dish = new THREE.SphereGeometry(0.6, 14, 6, 0, TAU, 0, Math.PI / 3); dish.rotateX(Math.PI / 2);
    addGeo(dish, MAT.paint, x, y + h * 0.45, z + 0.3);
  }
  function stairHouse(x, y, z, ry = 0) {
    sbox(x, y + 1.45, z, 3, 2.9, 3.6, MAT.concrete, { ry });
    sbox(x, y + 2.95, z, 3.3, 0.12, 3.9, MAT.darkMetal, { ry, collide: false });
    const door = new THREE.BoxGeometry(0.06, 2.1, 1.0);
    door.translate(1.52, 1.05, 0); addGeo(door, MAT.metalPaint, x, y, z, ry);
  }

  // ---------- window nest: an open window recess in a facade facing the tower ----------
  let windowCount = 0;
  const INTERIOR = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 1 });
  function windowNest(x, z, w, d, top, dist) {
    const L = Math.hypot(x, z), ox = -x / L, oz = -z / L;          // direction to the tower
    const alongX = Math.abs(ox) > Math.abs(oz);
    const nx = alongX ? Math.sign(ox) : 0, nz = alongX ? 0 : Math.sign(oz); // outward face normal
    const faceW = alongX ? d : w;
    if (faceW < 7) return;
    const tx = -nz, tz = nx;                                           // tangent along the face
    const off = rr(-faceW / 2 + 2.5, faceW / 2 - 2.5);
    // floor height: high enough to be seen from the tower (same rule as rooftop nests), on a storey line
    const minY = Math.max(6, TOWER.y + 1.65 - 1.6 - 0.15 * dist);
    const yF = Math.ceil(minY / 3.5) * 3.5 + Math.floor(R() * 2) * 3.5;
    if (yF > top - 3.5) return;
    const fx = x + nx * (alongX ? w / 2 : d / 2), fz = z + nz * (alongX ? w / 2 : d / 2); // face centre line
    const cx = fx + tx * off, cz = fz + tz * off;
    const W = 2.0, Hh = 2.7, D = 1.1, ry = Math.atan2(nx, nz);
    const at = (n, t) => [cx + nx * n + tx * t, cz + nz * n + tz * t];
    // dark interior "hole" on the facade, then a frame projecting out of the wall
    let p = at(0.03, 0); addGeo(new THREE.BoxGeometry(W, Hh, 0.04), INTERIOR, p[0], yF + Hh / 2, p[1], ry);
    p = at(D / 2, 0); sbox(p[0], yF - 0.12, p[1], W + 0.4, 0.24, D, MAT.concrete, { ry });          // floor slab
    p = at(D - 0.1, 0); sbox(p[0], yF + 0.5, p[1], W, 1.0, 0.2, MAT.concrete, { ry });               // sill (cover)
    p = at(D / 2, 0); sbox(p[0], yF + Hh + 0.12, p[1], W + 0.4, 0.24, D, MAT.concrete, { ry });      // lintel / roof
    for (const s of [-1, 1]) { p = at(D / 2, s * (W / 2 + 0.1)); sbox(p[0], yF + Hh / 2, p[1], 0.2, Hh, D, MAT.concrete, { ry }); }
    p = at(0.45, 0);
    nests.push({ x: p[0], z: p[1], y: yF, dx: nx, dz: nz, busy: false, window: true });
    windowCount++;
  }

  // ---------- buildings ----------
  function pickFacade(h) {
    if (h < 34 && R() < 0.6) return pick(FACADES.brick);
    if (h > 55 && R() < 0.6) return pick(FACADES.glass);
    return pick([...FACADES.office, ...FACADES.tiles, FACADES.glass[0], FACADES.brick[0]]);
  }
  function building(x, z, w, d, h, dist, opts = {}) {
    const near = dist < 360;
    const mat = opts.facade || pickFacade(h);
    const tu = mat.userData.tu, tv = mat.userData.tv;
    const body = (bw, bd, y0, y1) => {
      const hh = y1 - y0;
      addGeo(boxUV(bw, hh, bd, tu, tv, y0), mat, x, y0 + hh / 2, z);
      addCollider(x, y0 + hh / 2, z, bw, hh, bd);
    };
    let tw = w, td = d, baseTop = h;
    if (!opts.noSetback && near && h > 42 && w > 18 && d > 18 && R() < 0.35) {
      const h1 = Math.round(h * rr(0.5, 0.68)); baseTop = h1;
      body(w, d, 0, h1); plane(x, h1 + 0.02, z, w, d, MAT.roof); parapet(x, z, w, d, h1);
      tw = w * rr(0.6, 0.75); td = d * rr(0.6, 0.75);
      body(tw, td, h1, h);
    } else body(w, d, 0, h);
    plane(x, h + 0.02, z, tw, td, MAT.roof);
    // cornice band at the roof line
    sbox(x, h - 0.25, z, tw + 0.5, 0.5, td + 0.5, MAT.concrete, { collide: false });
    if (near) {
      const g = boxUV(w + 0.3, 4.4, d + 0.3, MAT.shop.userData.tu, MAT.shop.userData.tv);
      addGeo(g, MAT.shop, x, 2.2, z);
      sbox(x, 4.55, z, w + 1.0, 0.3, d + 1.0, MAT.concrete, { collide: false });
    }
    footprints.push({ x, z, w, d, h });
    if (!near || opts.bare) return { tw, td, h };
    if (dist > 55 && dist < 220 && baseTop >= 16 && windowCount < 40 && R() < 0.45) windowNest(x, z, w, d, baseTop, dist);

    const spawnRoof = dist > 45 && dist < 240 && h >= 26 && h <= 84 && tw >= 11 && td >= 11;
    parapet(x, z, tw, td, h, spawnRoof ? 1.0 : 0.55);
    const occ = [];
    const obstacles = [];
    if (spawnRoof) {
      const L = Math.hypot(x, z), dx = -x / L, dz = -z / L;
      const hx = tw / 2 - 1.9, hz = td / 2 - 1.9;
      const tt = Math.min(Math.abs(dx) > 1e-3 ? hx / Math.abs(dx) : 1e9, Math.abs(dz) > 1e-3 ? hz / Math.abs(dz) : 1e9);
      const n = { x: x + dx * tt, z: z + dz * tt, y: h, dx, dz, busy: false };
      sandbagWall(n.x + dx * 0.95, h, n.z + dz * 0.95, Math.atan2(dx, dz));
      nests.push(n); occ.push({ x: n.x, z: n.z, r: 4.5 });
      // extra cover on the roof for multiplayer
      const ex = x + rr(-tw / 4, tw / 4), ez = z + rr(-td / 4, td / 4);
      if (Math.hypot(ex - n.x, ez - n.z) > 6) { sandbagWall(ex, h, ez, R() < 0.5 ? 0 : Math.PI / 2, 2.6, 4); occ.push({ x: ex, z: ez, r: 2 }); obstacles.push({ x: ex, z: ez, hw: 1.5, hd: 1.5 }); }
      const roofRec = { x, z, y: h, hw: tw / 2 - 1.1, hd: td / 2 - 1.1, side: x < 0 ? 'A' : 'B', obstacles, face: Math.atan2(-dx, -dz) };
      spawns.push(roofRec);
      n.roof = roofRec; // AI uses the roof to walk into its nest
    }
    const spot = r => {
      for (let k = 0; k < 12; k++) {
        const px = x + rr(-tw / 2 + r + 0.8, tw / 2 - r - 0.8), pz = z + rr(-td / 2 + r + 0.8, td / 2 - r - 0.8);
        if (occ.every(o => Math.hypot(o.x - px, o.z - pz) > o.r + r)) { occ.push({ x: px, z: pz, r }); return [px, pz]; }
      }
      return null;
    };
    if (FACADES.glass.includes(mat) && tw > 20 && td > 20 && R() < 0.3) { const s = spot(7.5); if (s) plane(s[0], h + 0.05, s[1], 13, 13, MAT.heli); }
    if (R() < 0.55) { const s = spot(2.4); if (s) { const ry = R() < 0.5 ? 0 : Math.PI / 2; stairHouse(s[0], h, s[1], ry); obstacles.push({ x: s[0], z: s[1], hw: ry ? 1.9 : 1.6, hd: ry ? 1.6 : 1.9 }); } }
    if (!FACADES.glass.includes(mat) && R() < 0.3) { const s = spot(2.4); if (s) { waterTower(s[0], h, s[1]); obstacles.push({ x: s[0], z: s[1], hw: 1.6, hd: 1.6 }); } }
    const nAC = 1 + Math.floor(R() * 3);
    for (let i = 0; i < nAC; i++) { const s = spot(1.4); if (s) { const ry = R() < 0.5 ? 0 : Math.PI / 2; acUnit(s[0], h, s[1], ry); obstacles.push({ x: s[0], z: s[1], hw: 1.2, hd: 1.2 }); } }
    if (R() < 0.25) { const s = spot(1); if (s) antenna(s[0], h, s[1]); }
    return { tw, td, h };
  }

  // ---------- the player's tower (solo mode) ----------
  function playerTower() {
    const Y = TOWER.y, B = TOWER.half;
    building(0, 0, B * 2, B * 2, Y, 0, { facade: FACADES.office[0], noSetback: true, bare: true });
    parapet(0, 0, B * 2, B * 2, Y, TOWER.parapet, 0.5);
    const shack = { x: -7.5, z: -7.5, hw: 1.6, hd: 1.9 };
    stairHouse(shack.x, Y, shack.z);
    sbox(7.6, Y + 0.6, -7.6, 2.6, 1.2, 2.6, MAT.metalPaint);
    acUnit(7.6, Y, 7.4, 0); acUnit(7.6, Y, 4.6, 0);
    sbox(-7.6, Y + 0.5, 7.6, 1.3, 1, 1.3, MAT.wood, { ry: 0.3 }); sbox(-6.2, Y + 0.4, 8.2, 1, 0.8, 1, MAT.wood, { ry: -0.2 }); sbox(-7.4, Y + 1.25, 7.5, 0.9, 0.5, 0.9, MAT.wood, { ry: 0.6 });
    sandbagWall(0, Y, -B + 0.85, 0, 5, 2); sandbagWall(B - 0.85, Y, 0, Math.PI / 2, 5, 2);
    antenna(-9.8, Y, 9.8);
    const obstacles = [shack, { x: 7.6, z: -7.6, hw: 1.3, hd: 1.3 }, { x: 7.6, z: 6, hw: 1.1, hd: 2.4 }, { x: -7, z: 7.9, hw: 1.5, hd: 1.2 }];
    spawns.push({ x: 0, z: 0, y: Y, hw: B - 1.1, hd: B - 1.1, side: 'N', obstacles, tower: true, face: 0 });
  }

  // ---------- city grid ----------
  T_asphaltGround();
  function T_asphaltGround() {
    const size = 5000;
    const g = new THREE.PlaneGeometry(size, size); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv, t = MAT.asphalt.userData.tile;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / t, uv.getY(i) * size / t);
    const ground = new THREE.Mesh(g, MAT.asphalt); ground.receiveShadow = true; root.add(ground);
    addCollider(0, -0.5, 0, size, 1, size);
  }
  const blocks = [];
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) blocks.push([i, j]);
  blocks.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  const LIMIT = (N + 0.6) * PITCH;
  for (const [i, j] of blocks) {
    const cx = i * PITCH, cz = j * PITCH, dist = Math.hypot(cx, cz);
    if (dist > LIMIT) continue;
    sbox(cx, 0.09, cz, BS, 0.18, BS, MAT.sidewalk, { collide: false });
    sbox(cx, 0.09, cz, BS + 0.3, 0.16, BS + 0.3, MAT.concrete, { collide: false }); // curb
    if (i === 0 && j === 0) { playerTower(); continue; }
    if (dist > 60 && dist < 340 && R() < 0.11) {
      sbox(cx, 0.22, cz, BS - 5, 0.1, BS - 5, MAT.grass, { collide: false });
      for (let k = 0; k < 24; k++) treeSpots.push([cx + rr(-16, 16), 0.27, cz + rr(-16, 16)]);
      continue;
    }
    const S = BS - 6, r = R();
    let lots;
    if (r < 0.35) lots = [[cx, cz, S, S]];
    else if (r < 0.68) lots = R() < 0.5 ? [[cx - S / 4, cz, S / 2 - 1.5, S], [cx + S / 4, cz, S / 2 - 1.5, S]] : [[cx, cz - S / 4, S, S / 2 - 1.5], [cx, cz + S / 4, S, S / 2 - 1.5]];
    else lots = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [cx + a * S / 4, cz + b * S / 4, S / 2 - 1.5, S / 2 - 1.5]);
    for (const [lx, lz, lw, ld] of lots) {
      const dd = Math.hypot(lx, lz);
      const h = dd < 260 ? rr(16, 76) : rr(22, 140);
      building(lx, lz, lw * rr(0.88, 1), ld * rr(0.88, 1), Math.round(h), dd);
    }
    if (dist < 330) {
      for (let k = -BS / 2 + 4; k <= BS / 2 - 4; k += 9) {
        for (const [px, pz] of [[cx + k, cz - BS / 2 + 1.4], [cx + k, cz + BS / 2 - 1.4], [cx - BS / 2 + 1.4, cz + k], [cx + BS / 2 - 1.4, cz + k]]) if (R() < 0.5) treeSpots.push([px, 0.18, pz]);
      }
      for (const [px, pz, ry] of [[cx - BS / 2 + 0.6, cz, 0], [cx + BS / 2 - 0.6, cz, Math.PI], [cx, cz - BS / 2 + 0.6, -Math.PI / 2], [cx, cz + BS / 2 - 0.6, Math.PI / 2]]) lampSpots.push([px, pz, ry]);
    }
  }
  // far skyline ring
  for (let i = 0; i < 70; i++) {
    const a = R() * TAU, r = rr(LIMIT + 60, LIMIT + 420);
    building(Math.cos(a) * r, Math.sin(a) * r, rr(26, 60), rr(26, 60), Math.round(rr(40, 170)), r);
  }
  // streets: lane dashes, crosswalks, parked cars
  for (let s = -N - 1; s <= N; s++) {
    const sp = (s + 0.5) * PITCH;
    for (let m = -N; m <= N; m++) {
      const c = m * PITCH, dist = Math.hypot(sp, c);
      if (dist > LIMIT) continue;
      for (let k = -BS / 2 + 4; k < BS / 2 - 4; k += 6) { plane(sp, 0.02, c + k + 1.5, 0.18, 3, MAT.paint); plane(c + k + 1.5, 0.021, sp, 3, 0.18, MAT.paint); }
      if (dist < 360) {
        for (let q = 0; q < 7; q++) {
          const o = -5.4 + q * 1.8;
          plane(sp + o, 0.025, c - BS / 2 + 1.8, 0.9, 3, MAT.zebra); plane(c - BS / 2 + 1.8, 0.026, sp + o, 3, 0.9, MAT.zebra);
        }
        for (const lane of [-3.4, 3.4]) {
          let k = -BS / 2 + 3 + rr(0, 6);
          while (k < BS / 2 - 3) { if (R() < 0.38) carSpots.push([sp + lane, c + k, 0]); k += rr(6, 13); }
          k = -BS / 2 + 3 + rr(0, 6);
          while (k < BS / 2 - 3) { if (R() < 0.38) carSpots.push([c + k, sp + lane, Math.PI / 2]); k += rr(6, 13); }
        }
      }
    }
  }

  // ---------- merge static geometry ----------
  for (const [mat, geos] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    geos.forEach(g => g.dispose());
    const flat = mat === MAT.paint || mat === MAT.zebra || mat === MAT.sidewalk || mat === MAT.heli || mat === MAT.grass;
    mesh.castShadow = !flat; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    root.add(mesh);
  }

  // ---------- instanced: trees, lamps, cars ----------
  const dm = new THREE.Object3D(), col = new THREE.Color();
  {
    const n = treeSpots.length;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.2, 3.4, 7), new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }), n);
    const parts = [];
    for (let k = 0; k < 5; k++) { const s = new THREE.IcosahedronGeometry(rr(1.1, 1.6), 1); s.translate(rr(-0.9, 0.9), rr(-0.4, 0.9), rr(-0.9, 0.9)); parts.push(s); }
    const crown = new THREE.InstancedMesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), n);
    treeSpots.forEach(([x, y, z], i) => {
      const s = rr(0.8, 1.3);
      dm.position.set(x, y + 1.7 * s, z); dm.scale.set(s, s, s); dm.rotation.set(0, rr(0, TAU), 0); dm.updateMatrix(); trunk.setMatrixAt(i, dm.matrix);
      dm.position.set(x, y + 4.0 * s, z); dm.scale.set(s * rr(0.9, 1.2), s * rr(0.9, 1.3), s * rr(0.9, 1.2)); dm.updateMatrix(); crown.setMatrixAt(i, dm.matrix);
      col.setHSL(rr(0.2, 0.3), rr(0.35, 0.55), rr(0.18, 0.3)); crown.setColorAt(i, col);
    });
    for (const m of [trunk, crown]) { m.castShadow = m.receiveShadow = true; root.add(m); }
  }
  {
    const pole = new THREE.CylinderGeometry(0.07, 0.11, 7.5, 8); pole.translate(0, 3.75, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 1.8); arm.translate(0, 7.3, -0.85);
    const head = new THREE.BoxGeometry(0.35, 0.12, 0.6); head.translate(0, 7.22, -1.7);
    const lp = new THREE.InstancedMesh(mergeGeometries([pole, arm, head]), MAT.darkMetal, lampSpots.length);
    lampSpots.forEach(([x, z, ry], i) => { dm.position.set(x, 0.18, z); dm.rotation.set(0, ry + Math.PI / 2, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); lp.setMatrixAt(i, dm.matrix); });
    lp.castShadow = true; root.add(lp);
  }
  {
    const prof = new THREE.Shape();
    [[-2.25, 0.32], [-2.28, 0.82], [-1.95, 0.95], [-1.2, 1.0], [-0.72, 1.42], [0.5, 1.45], [1.12, 1.0], [2.08, 0.88], [2.26, 0.62], [2.22, 0.32]].forEach(([x, y], i) => i ? prof.lineTo(x, y) : prof.moveTo(x, y));
    const bodyG = new THREE.ExtrudeGeometry(prof, { depth: 1.76, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
    bodyG.translate(0, 0, -0.88); bodyG.rotateY(Math.PI / 2);
    const gl = new THREE.Shape();
    [[-1.12, 1.0], [-0.68, 1.37], [0.47, 1.4], [1.04, 1.0]].forEach(([x, y], i) => i ? gl.lineTo(x, y) : gl.moveTo(x, y));
    const glassG = new THREE.ExtrudeGeometry(gl, { depth: 1.84, bevelEnabled: false }); glassG.translate(0, 0.005, -0.92); glassG.rotateY(Math.PI / 2);
    const wheels = [];
    for (const [a, b] of [[-1.38, -0.86], [-1.38, 0.86], [1.38, -0.86], [1.38, 0.86]]) { const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 16); w.rotateZ(Math.PI / 2); w.translate(b, 0.34, a); wheels.push(w); }
    const n = carSpots.length;
    const body = new THREE.InstancedMesh(bodyG, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.08 }), n);
    const glass = new THREE.InstancedMesh(glassG, MAT.glassDark, n);
    const wh = new THREE.InstancedMesh(mergeGeometries(wheels), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 }), n);
    const paints = [0x8c1d1d, 0x1d3f8c, 0xb8b8b8, 0x151515, 0xe8e8e8, 0x2e6b3c, 0xc89a2a, 0x5a5f66, 0xe0e0e0, 0x202020];
    carSpots.forEach(([x, z, ry], i) => {
      const r2 = ry + (R() < 0.5 ? 0 : Math.PI);
      dm.position.set(x, 0.02, z); dm.rotation.set(0, r2, 0); dm.scale.set(1, 1, 1); dm.updateMatrix();
      body.setMatrixAt(i, dm.matrix); glass.setMatrixAt(i, dm.matrix); wh.setMatrixAt(i, dm.matrix);
      body.setColorAt(i, col.set(pick(paints)));
      if (Math.hypot(x, z) < 320) addCollider(x, 0.8, z, ry ? 4.5 : 1.9, 1.5, ry ? 1.9 : 4.5);
    });
    for (const m of [body, glass, wh]) { m.castShadow = m.receiveShadow = true; root.add(m); }
  }

  // ---------- distant mountains ----------
  for (const [Rad, hMin, hMax, color] of [[2600, 160, 420, 0xa2adbb], [1900, 70, 240, 0x8995a4]]) {
    const seg = 240, pos = [], ph = [rr(0, 9), rr(0, 9), rr(0, 9)];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * TAU;
      const hh = hMin + (hMax - hMin) * (0.5 + 0.25 * Math.sin(a * 3 + ph[0]) + 0.15 * Math.sin(a * 7 + ph[1]) + 0.1 * Math.sin(a * 17 + ph[2]));
      pos.push(Math.cos(a) * Rad, -20, Math.sin(a) * Rad, Math.cos(a) * Rad, hh, Math.sin(a) * Rad);
    }
    const idx = []; for (let i = 0; i < seg; i++) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -5; root.add(m);
  }

  // ---------- smoke plumes (positions are seeded) ----------
  for (let i = 0; i < 4; i++) {
    const a = R() * TAU, r = rr(110, 280);
    ambient.plumes.push({ x: Math.round(Math.cos(a) * r / PITCH + 0.5) * PITCH - PITCH / 2, y: 0.2, z: Math.sin(a) * r, fire: i < 2 });
  }

  // ---------- spatial grid of colliders (fast local queries for player movement) ----------
  const CELL = 24, grid = new Map(), big = [];
  for (const c of colliders) {
    const r = Math.hypot(c.scale.x, c.scale.z) / 2;
    if (r > 150) { big.push(c); continue; }
    const x0 = Math.floor((c.position.x - r) / CELL), x1 = Math.floor((c.position.x + r) / CELL);
    const z0 = Math.floor((c.position.z - r) / CELL), z1 = Math.floor((c.position.z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i + ',' + j; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
    }
  }
  function near(x, z, r = 6) {
    const out = new Set(big);
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++)
      for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++)
        for (const c of grid.get(i + ',' + j) || []) out.add(c);
    return [...out];
  }

  scene.add(root);
  return { root, colliders, near, nests, spawns, ambient, footprints, dispose() { scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); } };
}
