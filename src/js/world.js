// Seeded procedural city. Same seed => same city on every client.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './engine.js';
import { MAT, FACADES } from './assets.js';
import { mulberry32, TAU } from './ctx.js';

export const N = 7, BS = 42, ST = 14, PITCH = BS + ST;
export const TOWER = { y: 48, half: 11, parapet: 1.0 };

const CGEO = new THREE.BoxGeometry(1, 1, 1), CMAT = new THREE.MeshBasicMaterial();

// opts.story: lower buildings and more parks/plazas around the tower, so the streets stay visible from the tower
export function buildWorld(seed, opts = {}) {
  const story = !!opts.story;
  const R = mulberry32(seed), R2 = mulberry32(seed ^ 0x5bd1e995);
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
  // returns the offset used (so a second window in the same building can keep its distance) or null
  // `low` (story mode): ground-floor windows for bodyguards, drawn from their own random stream so the city itself does not change
  function windowNest(bx, bz, bw, bd, top, dist, bid, avoid, low = null) {
    const rnd = low ? low : R;
    const L = Math.hypot(bx, bz) || 1, ox = -bx / L, oz = -bz / L;   // direction to the tower
    const alongX = Math.abs(ox) > Math.abs(oz);
    const nx = alongX ? Math.sign(ox) : 0, nz = alongX ? 0 : Math.sign(oz); // outward face normal
    const faceW = alongX ? bd : bw;
    if (faceW < 7) return null;
    const tx = -nz, tz = nx;                                           // tangent along the face
    const off = (-faceW / 2 + 2.5) + rnd() * (faceW - 5);
    if (avoid !== undefined && Math.abs(off - avoid) < 4.5) return null;
    // floor height: high enough to be seen from the tower (same rule as rooftop nests), on a storey line
    const minY = low ? 5 : Math.max(6, TOWER.y + 1.65 - 1.6 - 0.15 * dist);
    const yF = Math.ceil(minY / 3.5) * 3.5 + Math.floor(rnd() * 2) * 3.5;
    if (yF > top - 3.5) return null;
    const fx = bx + nx * (alongX ? bw / 2 : bd / 2), fz = bz + nz * (alongX ? bw / 2 : bd / 2); // face centre line
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
    nests.push({ x: p[0], z: p[1], y: yF, dx: nx, dz: nz, busy: false, window: true, bid });
    if (!low) windowCount++;
    return off;
  }

  // ---------- architectural details ----------
  const FACES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function gableRoof(x, z, w, d, y) {
    const alongX = w >= d, W = alongX ? d : w, Ln = (alongX ? w : d) + 0.8;
    const ridge = Math.min(4.8, W * 0.34);
    const s = new THREE.Shape(); s.moveTo(-W / 2 - 0.4, 0); s.lineTo(W / 2 + 0.4, 0); s.lineTo(0, ridge); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: Ln, bevelEnabled: false });
    g.translate(0, 0, -Ln / 2);
    if (alongX) g.rotateY(Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
    addGeo(g, MAT.tiles, x, y, z);
  }
  function billboard(x, y, z, ry, w = 10, h = 5) {
    const m = pick(MAT.signs);
    const panel = new THREE.BoxGeometry(w, h, 0.3); panel.translate(0, 3 + h / 2, 0); addGeo(panel, m, x, y, z, ry);
    for (const s of [-1, 1]) { const p = new THREE.BoxGeometry(0.3, 3.2, 0.3); p.translate(s * w * 0.34, 1.6, -0.1); addGeo(p, MAT.darkMetal, x, y, z, ry); }
  }
  function crown(cx, cz, tw, td, h, dist, occ) {
    const r = R(), m = Math.min(tw, td);
    if (r < 0.16) {                                  // radio mast on a small base
      sbox(cx, h + 1.2, cz, tw * 0.28, 2.4, td * 0.28, MAT.concrete);
      const H = rr(12, 20), g = new THREE.ConeGeometry(0.5, H, 6); addGeo(g, MAT.metal, cx, h + 2.4 + H / 2, cz);
      occ.push({ x: cx, z: cz, r: m * 0.25 });
    } else if (r < 0.3) {                            // copper pyramid
      const H = rr(5, 9), g = new THREE.ConeGeometry(m * 0.56, H, 4); g.rotateY(Math.PI / 4);
      addGeo(g, MAT.copper, cx, h + H / 2, cz); occ.push({ x: cx, z: cz, r: m * 0.45 });
    } else if (r < 0.4) {                            // dome on a drum
      const rad = m * 0.36;
      cyl(cx, h + 0.8, cz, rad, rad, 1.6, MAT.concrete, 16, false);
      addGeo(new THREE.SphereGeometry(rad, 18, 10, 0, TAU, 0, Math.PI / 2), MAT.copper, cx, h + 1.6, cz);
      occ.push({ x: cx, z: cz, r: rad + 0.5 });
    } else if (r < 0.54 && dist < 300) {             // rooftop billboard
      const a = Math.floor(R() * 4), [nx, nz] = FACES[a];
      const out = (nx !== 0 ? tw : td) / 2 - 1.4, ry = Math.atan2(nx, nz);
      billboard(cx + nx * out, h, cz + nz * out, ry);
      occ.push({ x: cx + nx * out, z: cz + nz * out, r: 5 });
    } else if (r < 0.64 && tw > 14 && td > 14) {     // plant room
      sbox(cx, h + 2, cz, tw * 0.4, 4, td * 0.4, MAT.concrete);
      sbox(cx, h + 4.15, cz, tw * 0.44, 0.3, td * 0.44, MAT.darkMetal, { collide: false });
      occ.push({ x: cx, z: cz, r: m * 0.3 });
    }
  }
  function decorate(cx, cz, bw, bd, top, mat, near, minor = false) {
    const L = Math.hypot(cx, cz) || 1, tdx = -cx / L, tdz = -cz / L;
    const isGlass = FACADES.glass.includes(mat), isBrick = FACADES.brick.includes(mat);
    for (const [nx, nz] of FACES) {
      const along = nx !== 0 ? bd : bw, out = (nx !== 0 ? bw : bd) / 2;
      const px = cx + nx * (out + 0.15), pz = cz + nz * (out + 0.15), tx = -nz, tz = nx, ry = Math.atan2(nx, nz);
      // coloured shop awnings
      if (along > 8) {
        const n = Math.floor(along / 7);
        for (let i = 0; i < n; i++) {
          if (R() < 0.35) continue;
          const t = (i + 0.5) * along / n - along / 2;
          const g = new THREE.BoxGeometry(along / n - 1.3, 0.08, 1.7); g.rotateX(0.22); g.translate(0, 0, 0.85);
          addGeo(g, pick(MAT.awnings), px + tx * t, 3.7, pz + tz * t, ry);
        }
      }
      if (minor || nx * tdx + nz * tdz > 0.7) continue;   // keep the faces towards the tower clear for window nests
      if (isGlass) {                                      // vertical fins
        const nf = Math.floor(along / 4);
        for (let i = 1; i < nf; i++) {
          const t = i * along / nf - along / 2;
          const g = new THREE.BoxGeometry(0.28, top - 6, 0.55); g.translate(0, 0, 0.27);
          addGeo(g, MAT.darkMetal, px + tx * t, 6 + (top - 6) / 2, pz + tz * t, ry);
        }
      }
      if (isBrick && near) {                              // balconies
        const cols = Math.max(1, Math.floor(along / 9));
        for (let y = 7; y < Math.min(top - 3, 30); y += 3.5) for (let i = 0; i < cols; i++) {
          if (R() < 0.4) continue;
          const t = (i + 0.5) * along / cols - along / 2;
          const s = new THREE.BoxGeometry(2.8, 0.16, 1.3); s.translate(0, 0, 0.65); addGeo(s, MAT.concrete, px + tx * t, y, pz + tz * t, ry);
          const rl = new THREE.BoxGeometry(2.8, 0.9, 0.06); rl.translate(0, 0.53, 1.27); addGeo(rl, MAT.darkMetal, px + tx * t, y, pz + tz * t, ry);
        }
      }
      if (R() < 0.2 && top > 14) {                        // neon blade sign near a corner
        const t = (R() < 0.5 ? -1 : 1) * (along / 2 - 1.2);
        const g = new THREE.BoxGeometry(0.3, 1.4, 2.8); g.translate(0, 0, 1.55);
        addGeo(g, pick(MAT.signs), px + tx * t, 7 + R() * 4, pz + tz * t, ry);
      }
    }
    if (!minor && R() < 0.55) for (let y = 10.5; y < top - 3; y += 10.5) sbox(cx, y, cz, bw + 0.5, 0.3, bd + 0.5, MAT.concrete, { collide: false }); // ledge bands
  }

  // ---------- buildings ----------
  let bidCounter = 0;
  function pickFacade(h) {
    if (h < 34 && R() < 0.6) return pick(FACADES.brick);
    if (h > 55 && R() < 0.6) return pick(FACADES.glass);
    return pick([...FACADES.office, ...FACADES.tiles, FACADES.glass[0], FACADES.brick[0]]);
  }
  function building(x, z, w, d, h, dist, opts = {}) {
    const near = dist < 360, bid = bidCounter++;
    const mat = opts.facade || pickFacade(h);
    const tu = mat.userData.tu, tv = mat.userData.tv;
    const volume = (cx, cz, bw, bd, y0, y1, m = mat) => {
      const hh = y1 - y0;
      addGeo(boxUV(bw, hh, bd, m.userData.tu, m.userData.tv, y0), m, cx, y0 + hh / 2, cz);
      addCollider(cx, y0 + hh / 2, cz, bw, hh, bd);
    };
    const shopBand = (cx, cz, bw, bd) => {
      if (!near) return;
      addGeo(boxUV(bw + 0.3, 4.4, bd + 0.3, MAT.shop.userData.tu, MAT.shop.userData.tv), MAT.shop, cx, 2.2, cz);
      sbox(cx, 4.55, cz, bw + 1.0, 0.3, bd + 1.0, MAT.concrete, { collide: false });
    };

    // ----- round tower -----
    if (opts.round) {
      const r = Math.min(w, d) / 2;
      const g = new THREE.CylinderGeometry(r, r, h, 18, 1, true);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (TAU * r) / tu, uv.getY(i) * h / tv);
      addGeo(g, mat, x, h / 2, z); addCollider(x, h / 2, z, r * 1.8, h, r * 1.8);
      const cap = new THREE.CircleGeometry(r, 18); cap.rotateX(-Math.PI / 2); addGeo(cap, MAT.roof, x, h + 0.02, z);
      addGeo(new THREE.CylinderGeometry(r + 0.35, r + 0.35, 0.7, 18), MAT.concrete, x, h - 0.2, z);
      if (near) {
        const sg = new THREE.CylinderGeometry(r + 0.15, r + 0.15, 4.4, 18, 1, true);
        const su = sg.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, su.getX(i) * (TAU * r) / MAT.shop.userData.tu, su.getY(i) * 4.4 / MAT.shop.userData.tv);
        addGeo(sg, MAT.shop, x, 2.2, z);
      }
      const k = R();
      if (k < 0.4) { cyl(x, h + 0.8, z, r * 0.8, r * 0.8, 1.6, MAT.concrete, 18, false); addGeo(new THREE.SphereGeometry(r * 0.8, 18, 10, 0, TAU, 0, Math.PI / 2), MAT.copper, x, h + 1.6, z); }
      else if (k < 0.75) { const H = rr(14, 26); addGeo(new THREE.ConeGeometry(0.6, H, 6), MAT.metal, x, h + H / 2, z); }
      footprints.push({ x, z, w: r * 2, d: r * 2, h });
      return { tw: w, td: d, h };
    }

    // ----- massing: plain box, stepped setback, 3-tier tower, or main block + lower wing -----
    let bx = x, bz = z, bw = w, bd = d, tw = w, td = d, baseTop = h, wing = null, massing = 'plain';
    if (!opts.noSetback && near && !opts.bare) {
      const roll = R();
      if (h > 42 && w > 18 && d > 18 && roll < 0.3) massing = 'setback';
      else if (h > 50 && w > 22 && d > 22 && roll < 0.48) massing = 'tiered';
      else if (w > 24 && d > 18 && dist > 45 && roll < 0.78) massing = 'wing';
    }
    if (massing === 'wing') {
      const awayX = Math.abs(x) >= Math.abs(z), sgn = Math.sign(awayX ? x : z) || 1, frac = 0.38;
      if (awayX) { const wW = w * frac, mW = w - wW; bw = mW; bx = x - sgn * (w / 2 - mW / 2); wing = { cx: x + sgn * (w / 2 - wW / 2), cz: z, w: wW, d: d * rr(0.75, 1) }; }
      else { const wD = d * frac, mD = d - wD; bd = mD; bz = z - sgn * (d / 2 - mD / 2); wing = { cx: x, cz: z + sgn * (d / 2 - wD / 2), w: w * rr(0.75, 1), d: wD }; }
      wing.h = Math.max(8, Math.round(h * rr(0.3, 0.6)));
      tw = bw; td = bd;
    }
    if (massing === 'setback') {
      const h1 = Math.round(h * rr(0.5, 0.68)); baseTop = h1;
      volume(x, z, w, d, 0, h1); plane(x, h1 + 0.02, z, w, d, MAT.roof); parapet(x, z, w, d, h1);
      tw = w * rr(0.6, 0.75); td = d * rr(0.6, 0.75);
      volume(x, z, tw, td, h1, h);
    } else if (massing === 'tiered') {
      const y1 = Math.round(h * 0.5), y2 = Math.round(h * 0.78); baseTop = y1;
      volume(x, z, w, d, 0, y1); plane(x, y1 + 0.02, z, w, d, MAT.roof); parapet(x, z, w, d, y1);
      volume(x, z, w * 0.78, d * 0.78, y1, y2); plane(x, y2 + 0.02, z, w * 0.78, d * 0.78, MAT.roof); parapet(x, z, w * 0.78, d * 0.78, y2);
      tw = w * 0.55; td = d * 0.55;
      volume(x, z, tw, td, y2, h);
    } else volume(bx, bz, bw, bd, 0, h);
    plane(bx, h + 0.02, bz, tw, td, MAT.roof);
    sbox(bx, h - 0.25, bz, tw + 0.5, 0.5, td + 0.5, MAT.concrete, { collide: false });   // cornice
    shopBand(bx, bz, bw, bd);
    footprints.push({ x: bx, z: bz, w: bw, d: bd, h });
    if (wing) {
      volume(wing.cx, wing.cz, wing.w, wing.d, 0, wing.h, mat); plane(wing.cx, wing.h + 0.02, wing.cz, wing.w, wing.d, MAT.roof);
      parapet(wing.cx, wing.cz, wing.w, wing.d, wing.h); shopBand(wing.cx, wing.cz, wing.w, wing.d);
      footprints.push({ x: wing.cx, z: wing.cz, w: wing.w, d: wing.d, h: wing.h });
    }
    if (!near || opts.bare) return { tw, td, h };

    // window positions (up to two per building, so a wounded sniper can move inside the same building)
    if (dist > 55 && dist < 220 && baseTop >= 16 && windowCount < 60 && R() < 0.55) {
      const o1 = windowNest(bx, bz, bw, bd, baseTop, dist, bid);
      if (o1 !== null && R() < 0.6) windowNest(bx, bz, bw, bd, baseTop, dist, bid, o1);
    }
    if (story && dist > 40 && dist < 235 && baseTop >= 10.6 && R2() < 0.8) {
      const o1 = windowNest(bx, bz, bw, bd, baseTop, dist, bid, undefined, R2);
      if (o1 !== null && R2() < 0.7) windowNest(bx, bz, bw, bd, baseTop, dist, bid, o1, R2);
    }
    decorate(bx, bz, bw, bd, baseTop, mat, near);
    if (wing) decorate(wing.cx, wing.cz, wing.w, wing.d, wing.h, mat, near, true);

    const spawnRoof = !opts.bridged && dist > 45 &&dist < 240 && h >= 26 && h <= 84 && tw >= 11 && td >= 11;
    // low-rise houses get a tiled gable roof instead of a flat one
    if (!spawnRoof && h < 26 && massing === 'plain' && R() < 0.6) { gableRoof(bx, bz, bw, bd, h); return { tw, td, h }; }
    parapet(bx, bz, tw, td, h, spawnRoof ? 1.0 : 0.55);
    const occ = [];
    const obstacles = [];
    if (spawnRoof) {
      const L = Math.hypot(bx, bz) || 1, dx = -bx / L, dz = -bz / L;
      const hx = tw / 2 - 1.9, hz = td / 2 - 1.9;
      const tt = Math.min(Math.abs(dx) > 1e-3 ? hx / Math.abs(dx) : 1e9, Math.abs(dz) > 1e-3 ? hz / Math.abs(dz) : 1e9);
      const n = { x: bx + dx * tt, z: bz + dz * tt, y: h, dx, dz, busy: false, bid };
      sandbagWall(n.x + dx * 0.95, h, n.z + dz * 0.95, Math.atan2(dx, dz));
      nests.push(n); occ.push({ x: n.x, z: n.z, r: 4.5 });
      // a second firing position further along the same edge (a wounded sniper relocates here)
      const tgx = -dz, tgz = dx, sgn2 = R() < 0.5 ? -1 : 1;
      const room = Math.abs(dx) > Math.abs(dz) ? td / 2 - 3.4 : tw / 2 - 3.4;
      let n2 = null;
      if (room > 6) {
        const s = sgn2 * Math.min(room - 0.5, rr(6, room));
        const x2 = clampTo(n.x + tgx * s, bx, tw / 2 - 1.9), z2 = clampTo(n.z + tgz * s, bz, td / 2 - 1.9);
        if (Math.hypot(x2 - n.x, z2 - n.z) > 5.5) {
          n2 = { x: x2, z: z2, y: h, dx, dz, busy: false, bid };
          sandbagWall(x2 + dx * 0.95, h, z2 + dz * 0.95, Math.atan2(dx, dz)); occ.push({ x: x2, z: z2, r: 4 });
        }
      }
      // extra cover on the roof for multiplayer
      const ex = bx + rr(-tw / 4, tw / 4), ez = bz + rr(-td / 4, td / 4);
      if (Math.hypot(ex - n.x, ez - n.z) > 6 && (!n2 || Math.hypot(ex - n2.x, ez - n2.z) > 6)) { sandbagWall(ex, h, ez, R() < 0.5 ? 0 : Math.PI / 2, 2.6, 4); occ.push({ x: ex, z: ez, r: 2 }); obstacles.push({ x: ex, z: ez, hw: 1.5, hd: 1.5 }); }
      const roofRec = { x: bx, z: bz, y: h, hw: tw / 2 - 1.1, hd: td / 2 - 1.1, side: x < 0 ? 'A' : 'B', obstacles, face: Math.atan2(-dx, -dz) };
      spawns.push(roofRec);
      n.roof = roofRec; // AI uses the roof to walk into its nest
      if (n2) { n2.roof = roofRec; nests.push(n2); }
    } else crown(bx, bz, tw, td, h, dist, occ);
    const spot = r => {
      for (let k = 0; k < 12; k++) {
        const px = bx + rr(-tw / 2 + r + 0.8, tw / 2 - r - 0.8), pz = bz + rr(-td / 2 + r + 0.8, td / 2 - r - 0.8);
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
  const clampTo = (v, c, half) => Math.max(c - half, Math.min(c + half, v));

  // ---------- plaza (fountain square) and park ----------
  function plaza(cx, cz) {
    sbox(cx, 0.24, cz, BS - 4, 0.12, BS - 4, MAT.sidewalk, { collide: false });
    cyl(cx, 0.6, cz, 5.4, 5.8, 0.9, MAT.concrete, 28);                                    // basin wall
    addGeo(new THREE.CylinderGeometry(4.7, 4.7, 0.14, 28), MAT.water, cx, 1.02, cz);       // water
    cyl(cx, 2.4, cz, 0.45, 0.8, 3.4, MAT.concrete, 12, false);                              // column
    addGeo(new THREE.SphereGeometry(1.3, 14, 10), MAT.copper, cx, 4.5, cz);
    for (let k = 0; k < 8; k++) {                                                            // benches around the fountain
      const a = k / 8 * TAU, bxp = cx + Math.cos(a) * 9, bzp = cz + Math.sin(a) * 9;
      sbox(bxp, 0.55, bzp, 2.4, 0.4, 0.7, MAT.wood, { ry: -a + Math.PI / 2 });
    }
    for (let k = 0; k < 18; k++) { const a = k / 18 * TAU + 0.2; treeSpots.push([cx + Math.cos(a) * rr(13.5, 16.5), 0.3, cz + Math.sin(a) * rr(13.5, 16.5)]); }
    const kx = cx + rr(-14, 14), kz = cz + (R() < 0.5 ? -16 : 16);                           // kiosk with awning
    sbox(kx, 1.4, kz, 3, 2.8, 2.4, MAT.concrete);
    const ag = new THREE.BoxGeometry(4.2, 0.1, 1.8); ag.rotateX(0.2); ag.translate(0, 0, 0.9);
    addGeo(ag, pick(MAT.awnings), kx, 2.9, kz + (kz > cz ? -1.2 : 1.2), kz > cz ? Math.PI : 0);
  }
  function park(cx, cz) {
    sbox(cx, 0.22, cz, BS - 5, 0.1, BS - 5, MAT.grass, { collide: false });
    for (let k = 0; k < 24; k++) treeSpots.push([cx + rr(-16, 16), 0.27, cz + rr(-16, 16)]);
    for (let k = 0; k < 4; k++) sbox(cx + rr(-12, 12), 0.55, cz + rr(-12, 12), 2.2, 0.4, 0.7, MAT.wood, { ry: rr(0, TAU) });
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
  // steel footbridge between two roofs at the same level: span a0..a1 along one axis, centred on `c` across it
  function bridge(alongX, a0, a1, c, y) {
    const W = 2.6, top = y + 1.0, mid = (a0 + a1) / 2;
    const bx = (al, ac, l, h, w, yc, m) => (alongX ? sbox(al, yc, ac, l, h, w, m) : sbox(ac, yc, al, w, h, l, m));
    bx(mid, c, a1 - a0 + 1.6, 0.3, W, top - 0.15, MAT.metalPaint);
    for (const s of [-1, 1]) {
      bx(mid, c + s * (W / 2 - 0.06), a1 - a0, 0.07, 0.07, top + 1.0, MAT.darkMetal);       // handrail
      bx(mid, c + s * (W / 2 - 0.06), a1 - a0, 0.05, 0.05, top + 0.45, MAT.darkMetal);      // lower rail
      for (let k = 0; k <= 6; k++) bx(a0 + (a1 - a0) * k / 6, c + s * (W / 2 - 0.06), 0.07, 1.0, 0.07, top + 0.5, MAT.darkMetal);
    }
    for (const [e, dir] of [[a0, -1], [a1, 1]]) {            // three low steps up from the roof to the deck
      bx(e + dir * 1.05, c, 0.5, 0.66, W, y + 0.33, MAT.concrete);
      bx(e + dir * 1.55, c, 0.5, 0.33, W, y + 0.165, MAT.concrete);
    }
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
    const openP = story ? (dist < 170 ? 0.34 : 0.14) : 0.11;
    if (dist > 60 && dist < 340 && R() < openP) { if (R() < 0.45) plaza(cx, cz); else park(cx, cz); continue; }
    const S = BS - 6, r = R();
    let lots;
    if (r < 0.35) lots = [[cx, cz, S, S]];
    else if (r < 0.68) lots = R() < 0.5 ? [[cx - S / 4, cz, S / 2 - 1.5, S], [cx + S / 4, cz, S / 2 - 1.5, S]] : [[cx, cz - S / 4, S, S / 2 - 1.5], [cx, cz + S / 4, S, S / 2 - 1.5]];
    else lots = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [cx + a * S / 4, cz + b * S / 4, S / 2 - 1.5, S / 2 - 1.5]);
    // the two blocks next to the tower (west, south) get a roof at tower level, joined to it by a footbridge (not in story mode)
    const bridged = !story && ((i === -1 && j === 0) || (i === 0 && j === 1));
    if (bridged) lots = [[cx, cz, S, S]];
    let blockH = 0;
    lots.forEach(([lx, lz, lw, ld], li) => {
      const dd = Math.hypot(lx, lz);
      let h = story && dd < 175 ? (R() < 0.8 ? rr(7, 21) : rr(21, 38)) : dd < 260 ? rr(16, 76) : rr(22, 140);
      // buildings of one block are about equally high, so you can hop from roof to roof
      if (!story && dd < 260) { if (li === 0) blockH = h; else h = blockH + (h - blockH) * 0.1; }
      const round = !bridged && lots.length === 1 && dd > 40 && R() < 0.18;
      if (bridged) h = TOWER.y;
      const fi = footprints.length;
      building(lx, lz, lw * rr(0.88, 1), ld * rr(0.88, 1), Math.round(h), dd, { round, bridged, noSetback: bridged });
      if (bridged) {
        const f = footprints[fi];
        if (i === -1) bridge(true, f.x + f.w / 2, -TOWER.half, 0, TOWER.y);
        else bridge(false, TOWER.half, f.z - f.d / 2, 0, TOWER.y);
      }
    });
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
    building(Math.cos(a) * r, Math.sin(a) * r, rr(26, 60), rr(26, 60), Math.round(rr(40, 170)), r, { round: R() < 0.3 });
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
