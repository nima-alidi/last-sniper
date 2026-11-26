// Street graph (sidewalks around each block + crossings), its visibility from the tower, and the pedestrian crowd.
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, clamp, rnd } from './ctx.js';
import { PITCH, BS } from './world.js';
import { createPerson, randomLook } from './people.js';

const HALF = BS / 2 - 0.9;           // walking line, measured from the block centre
const rc = new THREE.Raycaster();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

// ---------------------------------------------------------------- graph
export function buildGraph(world, { radius = 230 } = {}) {
  const nodes = [], byKey = new Map(), key = (i, j, sx, sz) => `${i},${j},${sx},${sz}`;
  const R = Math.ceil(radius / PITCH) + 1;
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
    const cx = i * PITCH, cz = j * PITCH; if (Math.hypot(cx, cz) > radius) continue;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const n = { id: nodes.length, i, j, sx, sz, cx, cz, x: cx + sx * HALF, z: cz + sz * HALF, nbrs: [], vis: false };
      nodes.push(n); byKey.set(key(i, j, sx, sz), n);
    }
  }
  const edges = [], pair = new Map();
  const link = (a, b, cross) => {
    if (!a || !b) return;
    const k = a.id < b.id ? a.id + '-' + b.id : b.id + '-' + a.id;
    let shared = pair.get(k); if (!shared) { shared = { vis: 0, ready: false }; pair.set(k, shared); }
    const len = Math.hypot(a.x - b.x, a.z - b.z);
    // inward direction (towards the block centre) for sidewalk edges
    let inx = 0, inz = 0;
    if (!cross) { inx = a.sx !== b.sx ? 0 : -a.sx; inz = a.sz !== b.sz ? 0 : -a.sz; }
    const e = { a, b, len, cross, shared, inx, inz, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
    a.nbrs.push(e); edges.push(e);
  };
  for (const n of nodes) {
    link(n, byKey.get(key(n.i, n.j, -n.sx, n.sz)), false);
    link(n, byKey.get(key(n.i, n.j, n.sx, -n.sz)), false);
    link(n, byKey.get(key(n.i + n.sx, n.j, -n.sx, n.sz)), true);
    link(n, byKey.get(key(n.i, n.j + n.sz, n.sx, -n.sz)), true);
  }
  const graph = { nodes, edges, radius };

  // can the player on the tower see this point on the street?
  const tower = world.spawns.find(s => s.tower), eyeY = tower.y + 1.65;
  const eyes = [[0, 0], [-9, -9], [9, -9], [-9, 9], [9, 9]].map(([x, z]) => new THREE.Vector3(x, eyeY, z));
  const seen = (x, y, z) => {
    _b.set(x, y, z);
    for (const e of eyes) {
      _d.copy(_b).sub(e); const L = _d.length(); _d.divideScalar(L);
      rc.set(e, _d); rc.far = L - 0.4;
      if (!rc.intersectObjects(world.colliders, false).length) return true;
    }
    return false;
  };
  graph.computeVisibility = () => {
    for (const n of nodes) n.vis = seen(n.x, 1.3, n.z);
    for (const e of edges) {
      if (e.shared.ready) continue;
      let c = 0; for (const t of [0.25, 0.5, 0.75]) if (seen(e.a.x + (e.b.x - e.a.x) * t, 1.3, e.a.z + (e.b.z - e.a.z) * t)) c++;
      e.shared.vis = c / 3; e.shared.ready = true;
    }
    graph.visibleEdges = edges.filter(e => e.shared.vis > 0);
    graph.visibleCount = graph.visibleEdges.length;
    return graph.visibleCount;
  };
  graph.nearestNode = (x, z) => { let best = null, bd = 1e12; for (const n of nodes) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } } return best; };
  // shortest path between nodes, as a list of edges
  graph.path = (from, to) => {
    if (from === to) return [];
    const prev = new Map([[from, null]]), q = [from];
    while (q.length) {
      const n = q.shift(); if (n === to) break;
      for (const e of n.nbrs) if (!prev.has(e.b)) { prev.set(e.b, e); q.push(e.b); }
    }
    if (!prev.has(to)) return [];
    const out = []; let cur = to; while (prev.get(cur)) { const e = prev.get(cur); out.unshift(e); cur = e.a; }
    return out;
  };
  return graph;
}

// ---------------------------------------------------------------- walker
export class Walker {
  constructor(edge, t = 0, off = 0) { this.edge = edge; this.t = t; this.off = off; this.arrived = false; this.x = 0; this.z = 0; this.heading = 0; this.place(); }
  place() {
    const e = this.edge, t = this.t;
    this.x = e.a.x + (e.b.x - e.a.x) * t; this.z = e.a.z + (e.b.z - e.a.z) * t;
    if (e.cross) { this.x += -e.dz * this.off * 0.8; this.z += e.dx * this.off * 0.8; }
    else { this.x += e.inx * this.off; this.z += e.inz * this.off; }
    this.heading = Math.atan2(e.dx, e.dz);
  }
  // move `dist` metres; `choose(edge)` returns the next edge when the current one ends (or null to stop there)
  advance(dist, choose) {
    let d = dist;
    while (d > 0) {
      const rem = (1 - this.t) * this.edge.len;
      if (d < rem) { this.t += d / this.edge.len; break; }
      d -= rem; this.t = 1;
      const next = choose(this.edge);
      if (!next) { this.arrived = true; break; }
      this.edge = next; this.t = 0;
    }
    this.place();
  }
}

// weighted random onward edge (prefers sidewalks and streets the tower can see); when panicking, runs away from a point
export function randomNext(edge, panicFrom, bias = 1) {
  const n = edge.b;
  let opts = n.nbrs.filter(e => e.b !== edge.a);
  if (!opts.length) opts = n.nbrs;
  if (!opts.length) return null;
  const w = opts.map(e => {
    if (panicFrom) { const d0 = Math.hypot(n.x - panicFrom.x, n.z - panicFrom.z), d1 = Math.hypot(e.b.x - panicFrom.x, e.b.z - panicFrom.z); return Math.max(0.05, 1 + (d1 - d0) / 8) ** 2; }
    let x = 0.6 + e.shared.vis * 2.2 * bias;
    if (!e.cross) x += 0.7;
    if (e.dx === edge.dx && e.dz === edge.dz) x += 1.1;
    return x;
  });
  let r = Math.random() * w.reduce((s, v) => s + v, 0);
  for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
  return opts[opts.length - 1];
}

// friends walk together: the first of them to reach a junction decides, the other one takes the same way
function groupNext(p, e) {
  const g = p.group; let n = g.next.get(e);
  if (!n) { n = randomNext(e, null, p.bias); g.next.set(e, n); if (g.next.size > 30) g.next.delete(g.next.keys().next().value); }
  return n;
}

// ---------------------------------------------------------------- crowd
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
let pedId = 1;
export class Crowd {
  constructor(graph) {
    this.graph = graph; this.peds = []; this.root = new THREE.Group(); scene.add(this.root);
    this.frame = 0; this.cam = new THREE.Vector3(); this.panicPoint = null; this.trailT = 0;
  }
  spawn(look, { kind = 'civ', edge = null, t = Math.random(), speed = (Math.random() < 0.15 ? rnd(0.75, 1.05) : rnd(1.05, 1.6)), bias = 1, group = null, off = null } = {}) {
    if (look.scale === undefined) look = { ...look, scale: rnd(0.93, 1.07) };       // people are not all the same height
    const g = this.graph;
    if (!edge) {
      const list = g.visibleEdges && g.visibleEdges.length ? g.visibleEdges : g.edges;
      const w = list.map(e => 0.2 + e.shared.vis * 3); let r = Math.random() * w.reduce((s, v) => s + v, 0);
      edge = list[list.length - 1]; for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) { edge = list[i]; break; } }
    }
    const person = createPerson(look);
    if (off === null) off = edge.cross ? rnd(-1.6, 1.6) : rnd(-0.4, 1.3);
    const ped = { id: pedId++, kind, person, look, group, walker: new Walker(edge, t, off), speed, bias, state: 'walk', pauseT: rnd(6, 25), idleT: 0, hp: 100,
      yaw: 0, fleeT: 0, deadT: 0, accum: 0, dist: 0, trail: [], trailT: 0, panicFrom: null, extra: null };
    ped.yaw = ped.walker.heading;
    for (const h of person.hits) h.userData.owner = ped;
    person.root.position.set(ped.walker.x, 0.12, ped.walker.z); person.root.rotation.y = ped.yaw;
    person.play('walk', 0, speed / 1.3);
    this.root.add(person.root); this.peds.push(ped);
    return ped;
  }
  // everybody within `radius` of the point panics and runs away
  panic(point, radius = 9999, except = null) {
    this.panicPoint = { x: point.x, z: point.z };
    for (const p of this.peds) {
      if (p === except || p.state === 'dead' || p.state === 'gone') continue;
      if (Math.hypot(p.walker.x - point.x, p.walker.z - point.z) > radius) continue;
      if (p.state !== 'run') { p.state = 'run'; p.speed = rnd(3.8, 5.4); p.fleeT = 0; p.panicFrom = { x: point.x, z: point.z }; p.person.play('run', 0.12, p.speed / 4.6); }
    }
  }
  kill(ped, dir) {
    if (ped.state === 'dead') return;
    ped.state = 'dead'; ped.deadT = 0; ped.person.death();
  }
  remove(ped) {
    ped.state = 'gone'; this.root.remove(ped.person.root); ped.person.dispose();
    const i = this.peds.indexOf(ped); if (i >= 0) this.peds.splice(i, 1);
  }
  position(ped, out) { return out.set(ped.walker.x, 0.12, ped.walker.z); }

  update(dt, camPos) {
    this.frame++; this.cam.copy(camPos);
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i], w = p.walker;
      p.dist = Math.hypot(w.x - camPos.x, w.z - camPos.z);
      if (p.state === 'dead') { p.deadT += dt; }
      else if (p.state === 'run') {
        p.fleeT += dt;
        w.advance(p.speed * dt, e => randomNext(e, p.panicFrom));
        if (p.kind !== 'target' && p.fleeT > 16 + (p.id % 7)) { this.remove(p); continue; }
      } else if (p.state === 'idle') {
        p.idleT -= dt; if (p.idleT <= 0) { p.state = 'walk'; p.person.play('walk', 0.3, p.speed / 1.3); }
      } else if (p.state === 'walk') {
        w.advance(p.speed * dt, e => (p.override ? p.override(e) : p.group ? groupNext(p, e) : randomNext(e, null, p.bias)));
        if (p.kind === 'civ' && !p.group) { p.pauseT -= dt; if (p.pauseT <= 0) { p.state = 'idle'; p.idleT = rnd(3, 8); p.pauseT = rnd(10, 30); p.person.play('idle', 0.3); } }
      }
      // smooth facing
      if (p.state !== 'dead') { p.yaw += clamp(angDiff(p.yaw, w.heading), -6 * dt, 6 * dt); }
      const r = p.person.root; r.position.set(w.x, 0.12, w.z); r.rotation.y = p.yaw;
      // level of detail: hide far away, animate far ones at a lower rate, no shadows beyond 110 m
      const vis = p.dist < 300; r.visible = vis;
      if (vis) {
        p.accum += dt;
        if (p.dist < 90 || (this.frame + p.id) % (p.dist < 160 ? 2 : 4) === 0) { p.person.update(p.accum); p.accum = 0; }
        const shadow = p.dist < 100; if (p.person.mesh.castShadow !== shadow) p.person.mesh.castShadow = shadow;
      }
      if (p.kind === 'target' || p.trailOn) {            // remember where the target has been (bodyguards follow this trail)
        p.trailT += dt; if (p.trailT > 0.1) { p.trailT = 0; p.trail.push({ x: w.x, z: w.z, h: p.yaw }); if (p.trail.length > 90) p.trail.shift(); }
      }
    }
  }
  // hit proxies of every living, visible person (for bullets)
  collectHits(out) {
    for (const p of this.peds) {
      if (p.state === 'dead' || p.state === 'gone' || !p.person.root.visible || p.dist > 320) continue;
      for (const h of p.person.hits) out.push(h);
    }
  }
  living() { return this.peds.filter(p => p.state !== 'dead' && p.state !== 'gone'); }
}

export { randomLook };
