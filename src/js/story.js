// Story mode: assassination contracts. A crowd walks the streets, one person is the target (shown in a dossier).
// Kill him and the crowd panics while his bodyguards — on the ground and on the buildings — open fire one at a time.
import * as THREE from 'three';
import { scene, camera } from './engine.js';
import { G, settings, clamp, rnd, mulberry32 } from './ctx.js';
import * as hud from './hud.js';
import { sfx } from './audio.js';
import * as fx from './effects.js';
import { createSoldier } from './soldier.js';
import { Crowd, buildGraph, Walker, randomLook } from './crowd.js';
import { renderPortrait, describeLook } from './people.js';
import { CONTRACTS, saveProgress } from './missions.js';
import { visibleFromTower } from './solo.js';

const rc = new THREE.Raycaster();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const COMPASS = ['NORTH', 'NORTH-EAST', 'EAST', 'SOUTH-EAST', 'SOUTH', 'SOUTH-WEST', 'WEST', 'NORTH-WEST'];
const compassName = rad => COMPASS[Math.round(((rad * 180 / Math.PI) + 360) % 360 / 45) % 8];
const heading = (x, z) => Math.atan2(x - G.player.x, -(z - G.player.z));      // 0 = north (-z)
const eye = out => out.set(G.player.x, G.player.y + G.player.eye, G.player.z);
const GROUND = 0.12;

let M = null;   // the running mission
export const storyActive = () => !!M;
export const storyPhase = () => (M ? M.phase : null);

function hasLOS(from, to) {
  const d = _v3.copy(to).sub(from), L = d.length(); d.divideScalar(L || 1);
  rc.set(from, d); rc.far = L;
  const h = rc.intersectObjects(G.world.colliders, false)[0];
  return !(h && h.distance < L - 0.3);
}

// ===================================================================== preparation (before the briefing)
export function prepareStory(idx) {
  stopStory();
  const c = CONTRACTS[idx], world = G.world;
  const graph = buildGraph(world, { radius: 230 });
  graph.computeVisibility();
  const crowd = new Crowd(graph);
  const rng = mulberry32(c.seed * 31 + idx * 7 + 1);

  // --- the target
  const look = Object.assign(randomLook(rng, { model: c.look.model }), c.look);
  const starts = graph.visibleEdges.filter(e => { const d = Math.hypot((e.a.x + e.b.x) / 2, (e.a.z + e.b.z) / 2); return !e.cross && d > 65 && d < 175; });
  const pool = starts.length ? starts : graph.visibleEdges.length ? graph.visibleEdges : graph.edges;
  const edge = pool[Math.floor(rng() * pool.length)];
  const target = crowd.spawn(look, { kind: 'target', edge, t: 0.5, speed: 1.15, bias: 4 });
  target.name = c.name; target.hp = 60; target.pauseT = 1e9;
  const tx = target.walker.x, tz = target.walker.z;

  // --- the crowd (nobody looks exactly like the target; a few decoys wear the same colour)
  let decoys = 0;
  const crowdSize = Math.round(c.civilians * 2.3 * ({ low: 0.5, medium: 0.75 }[settings.quality] || 1));   // busy streets; lighter crowd on slower PCs
  for (let i = 0; i < crowdSize; i++) {
    let l = randomLook(Math.random);
    if (l.model === look.model && l.top === look.top) l = randomLook(Math.random);
    if (decoys < 6 && i % 17 === 5 && look.top !== undefined) { l.top = look.top; l.acc = []; if (l.model === look.model) l.model = 'casual'; decoys++; }
    const p = crowd.spawn(l);
    if (Math.random() < 0.3 && i < crowdSize - 1) {            // a friend walks along
      p.group = { next: new Map() }; i++;
      const w = p.walker;
      crowd.spawn(randomLook(Math.random), { edge: w.edge, t: clamp(w.t + 0.02, 0, 0.98), speed: p.speed, bias: p.bias, group: p.group, off: w.off + (w.edge.cross ? 0.9 : 0.8) });
    }
  }

  // --- bodyguards walking with the target
  const guards = [];
  for (let i = 0; i < c.guards; i++) {
    const s = createSoldier({ team: 'G' }); scene.add(s.root);
    const g = { kind: 'guard', s, hp: 100, state: 'escort', x: tx, z: tz, yaw: target.yaw, idx: i, off: (i % 2 ? 1 : -1) * rnd(0.8, 1.3), delay: 1.0 + i * 0.9,
      moving: false, walker: null, route: null, ri: 0, goal: null, node: null, aimT: 0, aimTime: c.aimTime, t: 0, dead: 0, wounded: false, relocated: false, revealT: 0, readyT: 0, speed: 5.4 };
    s.setOwner(g); guards.push(g);
  }

  // --- briefing data (the photo is rendered from the very same look)
  const photo = renderPortrait(look);
  const d = describeLook(look);
  const brief = {
    idx, c, photo, gender: d.gender, build: d.build, clothes: d.clothes,
    lastSeen: `about ${Math.round(Math.hypot(tx, tz) / 10) * 10} m ${compassName(Math.atan2(tx, -tz))} of your tower`,
    security: `${c.guards} armed bodyguard${c.guards > 1 ? 's' : ''} on foot. Intel suggests ${c.snipers} shooter${c.snipers > 1 ? 's' : ''} on the rooftops.`,
    bonuses: [
      { id: 'head', label: 'Kill the target with a headshot' },
      { id: 'clean', label: 'No civilian casualties' },
      { id: 'fast', label: 'Eliminate the target within 3:00' },
      { id: 'safe', label: 'Take no damage' },
    ],
  };
  M = { c, idx, brief, graph, crowd, target, look, guards, snipers: [], hostiles: [...guards], phase: 'brief', time: 0, alertT: 0, civKills: 0, kills: 0, score: 0,
    targetDead: false, headshot: false, targetDeadAt: 0, dmgTaken: 0, lastHp: 100, turn: null, turnCd: 0, zone: { x: tx, z: tz, ox: 0, oz: 0, t: 0 },
    pendingShot: null, onEnd: null, ended: false, endDelay: 0, sniperQueue: [] };
  crowd.update(0.05, camera.position);
  return brief;
}

// ===================================================================== start / stop
export function beginStory(onEnd) {
  if (!M) return;
  const p = G.player;
  M.onEnd = onEnd;
  p.reset(); p.localHealth = true; p.reserve = 36;
  p.spawnAt(G.world.spawns.find(s => s.tower));
  G.onBulletHit = onHit; G.onPlayerShot = onShot; G.onFire = onFire;
  G.onPlayerDeath = () => { hud.death(true, 'YOU WERE KILLED', ''); schedule(false, 'YOU WERE KILLED', 1.8); };
  M.phase = 'recon'; M.time = 0; M.lastHp = p.hp;
  G.world.nests.forEach(n => (n.busy = false));
  hud.storyCard(M.brief.photo, M.c.name);
  hud.objective(`FIND AND ELIMINATE: ${M.c.name.toUpperCase()}`);
  hud.civCount(0, 3);
  hud.message(`CONTRACT: ${M.c.title} — MATCH THE PHOTO`, 4);
}
export function stopStory() {
  if (!M) return;
  const { crowd, hostiles } = M;
  for (const h of hostiles) { scene.remove(h.s.root); h.s.dispose(); if (h.nest) h.nest.busy = false; }
  for (const p of [...crowd.peds]) crowd.remove(p);
  scene.remove(crowd.root);
  G.hittables = []; G.timeScale = 1;
  G.onFire = null;
  hud.storyCard(null); hud.objective(''); hud.civCount(null);
  M = null;
}

// ===================================================================== events from the player
function onFire(bullet) {                    // decide whether the shot deserves the slow-motion bullet camera
  if (!M || M.ended) return;
  const aims = [];
  if (!M.targetDead) { const T = M.target; const sp = T.state === 'idle' ? 0 : T.speed; aims.push({ x: T.walker.x, z: T.walker.z, vx: Math.sin(T.yaw) * sp, vz: Math.cos(T.yaw) * sp, y0: GROUND }); }
  if (M.phase === 'alert') for (const h of M.hostiles) if (h.state !== 'dead' && h.state !== 'incoming') aims.push({ x: h.x, z: h.z, vx: 0, vz: 0, y0: h.nest ? h.nest.y : GROUND });
  for (const who of aims) {
    if (Math.hypot(who.x - bullet.pos.x, who.z - bullet.pos.z) < 60) continue;
    const p = bullet.pos.clone(), v = bullet.vel.clone(); let t = 0;
    for (let i = 0; i < 400; i++) {
      p.addScaledVector(v, 1 / 120); v.y -= 9.81 / 120; t += 1 / 120;
      if (Math.hypot(p.x - (who.x + who.vx * t), p.z - (who.z + who.vz * t)) < 0.5 && p.y > who.y0 - 0.1 && p.y < who.y0 + 1.9) { G.player.startBulletCam(bullet); return; }
      if (p.y < -2) break;
    }
  }
}
function onShot(from, end) { if (M && !M.ended) M.pendingShot = { end: end.clone(), from: from.clone() }; }

function onHit(owner, part, dist, point) {
  if (!M || M.ended || !owner) return;
  M.pendingShot = null;                      // this shot hit somebody: not a "near miss"
  if (owner.kind === 'civ') return civilianHit(owner, part, point);
  if (owner.kind === 'target') return targetHit(owner, part, dist, point);
  if (owner.kind === 'guard' || owner.kind === 'sniper') return hostileHit(owner, part, dist);
}
function civilianHit(ped, part, point) {
  if (ped.state === 'dead') return;
  hud.hitMarker(true, part === 'head'); sfx.hit();
  const pos = M.crowd.position(ped, _v.set(0, 0, 0));
  M.crowd.kill(ped); M.civKills++; M.score -= 500;
  hud.banner('CIVILIAN CASUALTY', -500); hud.civCount(M.civKills, 3); sfx.hurt();
  M.crowd.panic({ x: pos.x, z: pos.z }, 45, M.target);
  if (M.phase === 'recon' && Math.hypot(pos.x - M.target.walker.x, pos.z - M.target.walker.z) < 30) triggerAlert('noise', pos);
  if (M.civKills >= 3) schedule(false, 'TOO MANY CIVILIAN CASUALTIES', 1.4);
}
// end the mission a moment later (so the player sees what happened); uses game time, not a browser timer
function schedule(success, reason, delay) { if (M && !M.pending) M.pending = { success, reason, t: delay }; }
function targetHit(ped, part, dist, point) {
  if (ped.state === 'dead') return;
  hud.hitMarker(ped.hp - (part === 'head' ? 200 : part === 'limb' ? 45 : 90) <= 0, part === 'head'); sfx.hit();
  ped.hp -= part === 'head' ? 200 : part === 'limb' ? 45 : 90;
  const pos = { x: ped.walker.x, z: ped.walker.z };
  if (ped.hp <= 0) {
    M.crowd.kill(ped); M.targetDead = true; M.headshot = part === 'head'; M.targetDeadAt = M.time; M.targetDist = dist;
    M.score += 1000 + Math.floor(dist / 10) * 5;
    sfx.kill(); if (M.headshot) sfx.headshot();
    hud.banner(M.headshot ? 'TARGET ELIMINATED — HEADSHOT' : 'TARGET ELIMINATED', 1000);
    G.player.reserve = Math.min(40, G.player.reserve + 12);
    triggerAlert('kill', pos);
  } else {
    hud.banner('TARGET WOUNDED — HE IS RUNNING', 100);
    triggerAlert('wound', pos);
  }
}

// ===================================================================== alert phase
function triggerAlert(cause, pos) {
  if (!M || M.phase !== 'recon') return;
  M.phase = 'alert'; M.alertT = 0; M.turnCd = 4.5;
  const T = M.target;
  M.crowd.panic(pos, 9999, T);
  sfx.panic();
  if (T.state !== 'dead') {                 // the target runs for it
    T.state = 'run'; T.speed = cause === 'wound' ? 3.2 : 4.6; T.fleeT = 0; T.panicFrom = { x: pos.x, z: pos.z }; T.person.play('run', 0.1, T.speed / 4.6);
  }
  M.guards.forEach((g, i) => { if (g.state !== 'dead') { g.state = 'react'; g.t = 0.5 + i * 0.55 + rnd(0, 0.5); } });
  // the rooftop shooters take their positions one after another
  const n = M.c.snipers, eyeY = G.world.spawns.find(s => s.tower).y + 1.65;
  const nests = G.world.nests.filter(x => (x.roof || x.window) && !x.busy && (eyeY - (x.y + 1.6)) / Math.max(1, Math.hypot(x.x, x.z)) < 0.17 && Math.hypot(x.x, x.z) > 50 && visibleFromTower(x));
  nests.sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(n, nests.length); i++) M.sniperQueue.push({ nest: nests[i], at: 5 + i * 7 });
  hud.message('ALERT — BODYGUARDS ARE FIRING BACK', 3.5);
  hud.objective(M.targetDead ? 'ELIMINATE THE BODYGUARDS' : 'FINISH THE TARGET BEFORE HE ESCAPES');
}

// ===================================================================== hostiles
function doFire(h, hostileY) {
  const p = G.player, mz = h.s.muzzleWorld(_v.set(0, 0, 0)), ey = eye(_v2);
  const dist = mz.distanceTo(ey), pan = clamp(Math.sin(heading(mz.x, mz.z) + p.yaw), -1, 1);
  sfx.remoteShot(dist, pan); fx.muzzleFlash(mz.clone(), dist); fx.tracer(mz.clone(), ey.clone(), true);
  h.s.playShoot(); h.revealT = 3.2;
  if (hasLOS(mz, ey)) p.takeDamage(h.kind === 'guard' ? rnd(16, 26) : rnd(30, 40), [mz.x, mz.y, mz.z]);
  else { hud.message('INCOMING — STAY DOWN', 1.2); sfx.whiz(pan); }
}
function endTurn(h) { if (M.turn === h) { M.turn = null; M.turnCd = Math.max(1.5, rnd(3.2, 5.0) - M.idx * 0.35); } }

function hostileHit(h, part, dist) {
  if (h.state === 'dead') return;
  const head = part === 'head';
  h.hp -= head ? 200 : part === 'limb' ? 45 : 75;
  hud.hitMarker(h.hp <= 0, head); sfx.hit();
  if (h.hp <= 0) {
    h.state = 'dead'; h.dead = 0; endTurn(h); M.kills++;
    if (h.nest) h.nest.busy = false;
    const pts = 150 + Math.floor(dist / 10) * 5 + (head ? 100 : 0); M.score += pts;
    if (head) sfx.headshot(); else sfx.kill();
    hud.banner(head ? 'HEADSHOT' : h.kind === 'guard' ? 'BODYGUARD DOWN' : 'SNIPER DOWN', pts);
    hud.feed(`<b>YOU</b> <span class="hs">${head ? '⌖ HEADSHOT' : '⌖'}</span> ${h.kind === 'guard' ? 'Bodyguard' : 'Rooftop shooter'} <span class="hs">${Math.round(dist)}m</span>`);
  } else {
    h.s.playHit(); h.wounded = true; M.score += 25;
    hud.banner('HIT — WOUNDED', 25);
    endTurn(h);
    if (!h.relocated) { h.relocated = true; h.state = 'flee'; h.t = 1.0; }
    else if (h.state === 'aim') { h.state = h.kind === 'guard' ? 'seek' : 'cover'; h.t = rnd(2, 4); }
  }
}

// ----- ground bodyguards
function pickSpot(g) {
  const p = G.player, cur = g.node;
  let list = M.graph.nodes.filter(n => n.vis && n !== cur && !M.guards.some(o => o !== g && o.goal === n));
  list = list.filter(n => { const d = Math.hypot(n.x - p.x, n.z - p.z); return d > 40 && d < 235; });
  // he must be able to see the player where the player is standing right now
  const ey = eye(new THREE.Vector3());
  const seen = list.filter(n => hasLOS(_v.set(n.x, 1.6, n.z), ey));
  if (seen.length) list = seen;
  else { list = M.graph.nodes.filter(n => n.vis && n !== cur && hasLOS(_v.set(n.x, 1.6, n.z), ey)); }
  if (!list.length) list = M.graph.nodes.filter(n => n.vis);
  if (!list.length) return null;
  list.sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z));
  return list[Math.floor(Math.random() * Math.min(5, list.length))];
}
function planRoute(g, goal) {
  const graph = M.graph;
  if (g.walker && g.walker.arrived) {                       // continue from the node he is standing on
    const node = g.walker.edge.b; g.node = node;
    const route = graph.path(node, goal); g.route = route; g.ri = 0;
    g.walker = route.length ? new Walker(route[0], 0, 0) : null;
    return;
  }
  // first time: start on the sidewalk edge next to the target and go whichever way is shorter
  const e0 = M.target.walker.edge, ax = e0.a.x, az = e0.a.z;
  const t = clamp(((g.x - ax) * e0.dx + (g.z - az) * e0.dz) / e0.len, 0, 1);
  const rev = e0.b.nbrs.find(e => e.b === e0.a);
  const pathLen = r => r.reduce((s, e) => s + e.len, 0);
  const fwd = graph.path(e0.b, goal), bwd = graph.path(e0.a, goal);
  const lenF = (1 - t) * e0.len + pathLen(fwd), lenB = t * e0.len + pathLen(bwd);
  if (rev && lenB < lenF) { g.route = [rev, ...bwd]; g.walker = new Walker(rev, 1 - t, 0); }
  else { g.route = [e0, ...fwd]; g.walker = new Walker(e0, t, 0); }
  g.ri = 0;
}
// after the shot the bodyguards run into a nearby building and shoot from one of its windows
function pickBuilding(g) {
  const list = G.world.nests.filter(n => n.window && !n.busy && Math.hypot(n.x - g.x, n.z - g.z) < 120 && visibleFromTower(n));
  if (!list.length) return false;
  list.sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z));
  const nest = list[Math.floor(Math.random() * Math.min(3, list.length))];
  nest.busy = true; g.nest = nest; return true;
}
function enterBuilding(g) {
  const n = g.nest;
  g.inside = true; g.state = 'incoming'; g.t = rnd(2.5, 4); g.x = n.x; g.z = n.z; g.wait = 0; g.s.root.visible = false;
  M.snipers.push(g);
  hud.message('A BODYGUARD RAN INTO A BUILDING — WATCH THE WINDOWS', 3);
}
function startMoving(g) {
  if (!g.nestTried) { g.nestTried = true; pickBuilding(g); }
  if (g.nest && !g.inside) {
    const goal = M.graph.nearestNode(g.nest.x, g.nest.z); g.goal = goal; planRoute(g, goal);
    if (g.walker) g.state = 'run';
    else { g.state = 'enter'; if (g.node) { g.x = g.node.x; g.z = g.node.z; } }
    return;
  }
  const goal = pickSpot(g); if (!goal) { g.state = 'ready'; g.readyT = 1; return; }
  g.goal = goal; planRoute(g, goal);
  g.state = g.walker ? 'run' : 'ready'; g.readyT = rnd(0.6, 1.4);
  if (!g.walker && g.node) { g.x = g.node.x; g.z = g.node.z; }
}
function updateGuard(g, dt) {
  const T = M.target, p = G.player;
  let moving = false, aim = false, run = false, concealed = false;
  g.t -= dt; g.revealT = Math.max(0, g.revealT - dt);
  let faceYaw = g.yaw;
  switch (g.state) {
    case 'escort': {
      concealed = true;
      const tr = T.trail, k = Math.min(tr.length - 1, Math.round(g.delay * 10));
      const pt = tr.length ? tr[tr.length - 1 - Math.max(0, k)] : { x: T.walker.x, z: T.walker.z, h: T.yaw };
      const tx = pt.x + Math.cos(pt.h) * g.off, tz = pt.z - Math.sin(pt.h) * g.off;
      const dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz), sp = Math.min(d, 6 * dt);
      if (d > 0.001) { g.x += dx / d * sp; g.z += dz / d * sp; }
      moving = sp / dt > 0.6; faceYaw = moving ? Math.atan2(dx, dz) : pt.h;
      break;
    }
    case 'react': run = false; if (g.t <= 0) startMoving(g); faceYaw = Math.atan2(p.x - g.x, p.z - g.z); break;
    case 'flee': case 'seek': if (g.state === 'flee' && g.t > 0) { faceYaw = Math.atan2(p.x - g.x, p.z - g.z); break; } startMoving(g); break;
    case 'run': {
      moving = true; run = true;
      const w = g.walker;
      w.advance(g.speed * dt, () => (g.route[++g.ri] || null));
      g.x = w.x; g.z = w.z; faceYaw = w.heading;
      if (w.arrived) { g.state = g.nest && !g.inside ? 'enter' : 'ready'; g.readyT = rnd(0.5, 1.2); g.x = w.edge.b.x; g.z = w.edge.b.z; g.node = w.edge.b; }
      break;
    }
    case 'enter': {
      moving = true; run = true;
      const dx = g.nest.x - g.x, dz = g.nest.z - g.z, d = Math.hypot(dx, dz);
      if (d < 1.8) { enterBuilding(g); break; }
      const st = Math.min(d, g.speed * dt); g.x += dx / d * st; g.z += dz / d * st; faceYaw = Math.atan2(dx, dz);
      break;
    }
    case 'ready': {
      faceYaw = Math.atan2(p.x - g.x, p.z - g.z); g.readyT -= dt;
      if (g.readyT <= 0) {                                     // lost sight of the player (he moved or ducked): find another spot
        g.noLos = hasLOS(g.s.muzzleWorld(_v.set(0, 0, 0)), eye(_v2)) ? 0 : (g.noLos || 0) + dt;
        if (g.noLos > 4) { g.noLos = 0; g.state = 'seek'; }
      }
      break;
    }
    case 'aim': {
      aim = true; faceYaw = Math.atan2(p.x - g.x, p.z - g.z); g.aimT += dt;
      if (g.aimT >= g.aimTime && p.alive) { doFire(g, GROUND); endTurn(g); g.state = 'seek'; }
      break;
    }
    case 'dead': g.dead += dt; break;
  }
  let dy = faceYaw - g.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.yaw += dy * Math.min(1, dt * 9);
  const r = g.s.root; r.position.x = g.x; r.position.z = g.z; r.rotation.y = g.yaw;
  const ddx = p.x - g.x, ddz = p.z - g.z, ddy = p.y + p.eye - (GROUND + 1.45);
  g.s.pose(dt, { crouch: false, aim, moving, run, pitch: Math.atan2(ddy, Math.hypot(ddx, ddz)), dead: g.state === 'dead', baseY: GROUND, concealed });
  g.ready = g.state === 'ready' && g.readyT <= 0;
}

// ----- rooftop / window shooters
function spawnSniper(nest) {
  const s = createSoldier({ team: 'AI' }); s.root.visible = false; scene.add(s.root);
  const r = nest.roof;
  const sx = r ? clamp(r.x + (r.x - nest.x) * 0.7, r.x - r.hw + 0.6, r.x + r.hw - 0.6) : nest.x;
  const sz = r ? clamp(r.z + (r.z - nest.z) * 0.7, r.z - r.hd + 0.6, r.z + r.hd - 0.6) : nest.z;
  const h = { kind: 'sniper', s, nest, hp: 100, state: 'incoming', t: 4, x: sx, z: sz, yaw: Math.atan2(nest.x - sx, nest.z - sz), aimT: 0, aimTime: M.c.aimTime + rnd(-0.2, 0.3),
    dead: 0, wounded: false, relocated: false, revealT: 0, readyT: 0, ready: false, wait: 0 };
  nest.busy = true; s.setOwner(h); M.snipers.push(h); M.hostiles.push(h);
  hud.message(`ROOFTOP SHOOTER SPOTTED — ${Math.round(Math.hypot(nest.x - G.player.x, nest.z - G.player.z))} m ${compassName(heading(nest.x, nest.z))}${nest.window ? ' · IN A WINDOW' : ''}`, 3.2);
  sfx.warn();
}
function sniperRelocate(h) {
  const old = h.nest;
  const eyeY = G.world.spawns.find(s => s.tower).y + 1.65;
  const sib = G.world.nests.filter(n => n.bid === old.bid && n !== old && !n.busy && (h.inside || (eyeY - (n.y + 1.6)) / Math.max(1, Math.hypot(n.x, n.z)) < 0.17) && visibleFromTower(n));
  if (!sib.length) { h.state = 'cover'; h.t = rnd(4, 6.5); hud.message('WOUNDED SHOOTER IS KEEPING HIS HEAD DOWN', 2.2); return; }
  const nest = sib[Math.floor(Math.random() * sib.length)];
  old.busy = false; nest.busy = true; h.nest = nest;
  if (old.roof && nest.roof) { h.state = 'walk'; h.s.root.visible = true; hud.message('WOUNDED SHOOTER IS MOVING WITHIN HIS BUILDING', 2.2); }
  else { h.x = nest.x; h.z = nest.z; h.state = 'incoming'; h.t = 3; h.s.root.visible = false; sfx.warn(); hud.message(`WOUNDED SHOOTER MOVED — ${nest.window ? 'IN A WINDOW' : 'ROOFTOP'}`, 2.4); }
}
function updateSniper(h, dt) {
  const p = G.player, nest = h.nest;
  let crouch = false, aim = false, moving = false, faceYaw = h.yaw;
  h.t -= dt; h.revealT = Math.max(0, h.revealT - dt);
  switch (h.state) {
    case 'incoming': if (h.t <= 0) { h.state = nest.window ? 'cover' : 'walk'; h.t = rnd(1.0, 2.0); h.s.root.visible = true; } break;
    case 'walk': {
      const dx = nest.x - h.x, dz = nest.z - h.z, d = Math.hypot(dx, dz);
      if (d < 0.1) { h.state = 'cover'; h.t = rnd(1.0, 2.0); break; }
      const st = Math.min(d, (h.wounded ? 0.9 : 1.5) * dt); h.x += dx / d * st; h.z += dz / d * st; moving = true; faceYaw = Math.atan2(dx, dz);
      break;
    }
    case 'cover': case 'ready': {
      crouch = true; faceYaw = Math.atan2(p.x - h.x, p.z - h.z);
      if (h.state === 'cover' && h.t <= 0) {
        const ok = hasLOS(_v.set(nest.x, nest.y + 1.5, nest.z), eye(_v2));
        h.wait += dt; if (ok || h.wait > 12) { h.state = 'ready'; h.wait = 0; }
      }
      break;
    }
    case 'aim':
      aim = true; faceYaw = Math.atan2(p.x - h.x, p.z - h.z); h.aimT += dt;
      if (h.aimT >= h.aimTime && p.alive) { doFire(h, nest.y); endTurn(h); h.state = 'cover'; h.t = rnd(2.2, 4.2); }
      break;
    case 'flee': crouch = true; if (h.t <= 0) sniperRelocate(h); break;
    case 'dead': h.dead += dt; break;
  }
  let dy = faceYaw - h.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); h.yaw += dy * Math.min(1, dt * 5);
  const r = h.s.root; r.position.x = h.x; r.position.z = h.z; r.rotation.y = h.yaw;
  const ddx = p.x - h.x, ddz = p.z - h.z, ddy = p.y + p.eye - (nest.y + 1.45);
  h.s.pose(dt, { crouch, aim, moving, pitch: Math.atan2(ddy, Math.hypot(ddx, ddz)), dead: h.state === 'dead', baseY: nest.y });
  h.ready = h.state === 'ready';
}

// ===================================================================== per frame
export function updateStory(dt) {
  if (!M) return;
  const p = G.player;
  M.crowd.update(dt, camera.position);
  if (M.phase === 'brief') return;
  if (!M.ended) M.time += dt;

  // damage taken (for the bonus objective)
  if (p.hp < M.lastHp - 0.01) M.dmgTaken += M.lastHp - p.hp; M.lastHp = p.hp;
  if (M.pending) { M.pending.t -= G.realDt || dt; if (M.pending.t <= 0) { const q = M.pending; M.pending = null; endMission(q.success, q.reason); } }

  // approximate target area on the minimap: drifts around the real position, never exactly on it
  const T = M.target;
  M.zone.t -= dt;
  if (M.zone.t <= 0) { M.zone.t = 8; const a = Math.random() * 6.28, r = rnd(10, 26); M.zone.ox = Math.cos(a) * r; M.zone.oz = Math.sin(a) * r; }
  M.zone.x += (T.walker.x + M.zone.ox - M.zone.x) * Math.min(1, dt * 0.6); M.zone.z += (T.walker.z + M.zone.oz - M.zone.z) * Math.min(1, dt * 0.6);

  // a shot that landed close to the target (but did not hit anybody) makes everybody panic
  if (M.pendingShot && M.phase === 'recon' && !M.targetDead) {
    const e = M.pendingShot.end;
    if (Math.hypot(e.x - T.walker.x, e.z - T.walker.z) < 8 && e.y < 6) triggerAlert('miss', { x: T.walker.x, z: T.walker.z });
  }
  M.pendingShot = null;

  for (const g of M.guards) if (!g.inside) updateGuard(g, dt);
  for (const s of M.snipers) updateSniper(s, dt);

  if (M.phase === 'alert' && !M.ended) {
    M.alertT += dt;
    // rooftop shooters take their positions one after another
    for (let i = M.sniperQueue.length - 1; i >= 0; i--) if (M.alertT >= M.sniperQueue[i].at) { spawnSniper(M.sniperQueue[i].nest); M.sniperQueue.splice(i, 1); }
    // only one hostile may aim at a time
    M.turnCd -= dt;
    if (!M.turn && M.turnCd <= 0 && p.alive) {
      const ready = M.hostiles.filter(h => h.ready && h.state !== 'dead' && hasLOS(h.nest && (h.kind === 'sniper' || h.inside) ? _v.set(h.nest.x, h.nest.y + 1.5, h.nest.z) : h.s.muzzleWorld(_v.set(0, 0, 0)), eye(_v2)));
      if (ready.length) { const h = ready[Math.floor(Math.random() * ready.length)]; h.state = 'aim'; h.aimT = 0; M.turn = h; sfx.warn(); }
    }
    const alive = M.hostiles.filter(h => h.state !== 'dead').length + M.sniperQueue.length;
    hud.objective(M.targetDead ? `ELIMINATE THE BODYGUARDS — ${alive} LEFT` : 'FINISH THE TARGET BEFORE HE ESCAPES');
    if (M.targetDead && alive === 0) { M.endDelay += dt; if (M.endDelay > 2.2) endMission(true); }
    else if (M.targetDead && M.alertT > 150) endMission(true, 'SURVIVED THE RETURN FIRE');
    else if (!M.targetDead && T.state === 'run' && T.fleeT > 28) endMission(false, 'THE TARGET ESCAPED');
  }
  if (M.phase === 'recon' && M.time > M.c.time) endMission(false, 'TIME EXPIRED — THE TARGET LEFT THE AREA');

  // everything the bullets can hit
  const hits = []; M.crowd.collectHits(hits);
  for (const h of M.hostiles) if (h.state !== 'dead' && (h.state !== 'incoming') && h.s.root.visible) hits.push(...h.s.hits);
  G.hittables = hits;

  hud.matchInfo({ a: '', b: '', time: M.phase === 'recon' ? fmt(Math.max(0, M.c.time - M.time)) : M.phase === 'alert' ? 'ALERT' : '' });
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ===================================================================== end of mission
function endMission(success, reason = '') {
  if (!M || M.ended) return;
  M.ended = true; M.phase = 'done';
  const done = { head: M.headshot, clean: M.civKills === 0, fast: M.targetDead && M.targetDeadAt <= 180, safe: M.dmgTaken < 1 };
  const bonuses = M.brief.bonuses.map(b => ({ ...b, done: success && !!done[b.id] }));
  const n = bonuses.filter(b => b.done).length;
  const stars = success ? 1 + Math.min(2, Math.floor(n / 2)) : 0;
  const score = Math.max(0, Math.round(M.score + (success ? 1000 + n * 500 + Math.max(0, (M.c.time - M.time) * 3) : 0)));
  if (success) saveProgress(M.idx, stars);
  G.timeScale = 1;
  const res = { success, reason, stars, bonuses, score, time: M.time, civKills: M.civKills, kills: M.kills, targetDist: Math.round(M.targetDist || 0), idx: M.idx, title: M.c.title, name: M.c.name };
  if (M.onEnd) M.onEnd(res);
}

// ===================================================================== data for the HUD / minimap
export function storyMinimap() {
  if (!M) return [];
  const out = [];
  if (M.phase === 'recon') out.push({ kind: 'zone', x: M.zone.x, z: M.zone.z, r: 48 });
  if (M.phase === 'alert' || M.phase === 'done') {
    const T = M.target;
    if (!M.targetDead && T.state !== 'gone') out.push({ kind: 'wounded', x: T.walker.x, z: T.walker.z });
    for (const h of M.hostiles) {
      if (h.state === 'dead') continue;
      if (h.state === 'incoming') { if (h.t < 4) out.push({ kind: 'warn', x: h.nest.x, z: h.nest.z }); continue; }
      if (h.state === 'aim') out.push({ kind: 'aim', x: h.x, z: h.z });
      else if (h.revealT > 0) out.push({ kind: 'shot', x: h.x, z: h.z });
      else if (h.wounded) out.push({ kind: 'wounded', x: h.x, z: h.z });
    }
  }
  return out;
}
export function storyCompass() {
  if (!M) return [];
  const out = [];
  if (M.phase === 'recon') out.push({ heading: ((heading(M.zone.x, M.zone.z) * 180 / Math.PI) + 360) % 360, color: '#ffd166' });
  for (const h of M.hostiles) if (h.state === 'aim' || h.revealT > 0) out.push({ heading: ((heading(h.x, h.z) * 180 / Math.PI) + 360) % 360, color: h.state === 'aim' ? '#ff2a2a' : '#ff8a3a' });
  return out;
}
export function storyIndicators() {
  if (!M) return [];
  return M.hostiles.filter(h => h.state === 'aim').map(h => ({ heading: heading(h.x, h.z), p: clamp(h.aimT / h.aimTime, 0, 1) }));
}
export const storyKills = () => (M ? M.kills + (M.targetDead ? 1 : 0) : 0);
// TAB: the dossier in short (photo + what to look for) and the mission status
export function storyScoreboard() {
  if (!M) return '';
  const b = M.brief, rows = [['Time left', M.phase === 'recon' ? fmt(Math.max(0, M.c.time - M.time)) : '—'], ['Civilian casualties', `${M.civKills} / 3`], ['Hostiles down', M.kills], ['Score', M.score]];
  return `<h3><span>${b.c.title} — ${b.c.name.toUpperCase()}</span><span>${M.phase === 'recon' ? 'RECON' : 'ALERT'}</span></h3>
    <div style="display:flex;gap:22px;align-items:flex-start">
      <img src="${b.photo}" style="width:150px;height:180px;object-fit:cover;border:3px solid #d9cfb4">
      <div style="flex:1;font-size:14px;line-height:1.7"><b>LOOK FOR:</b> ${b.gender}, ${b.build}.<br>${b.clothes.join(', ')}.<br><b>LAST SEEN:</b> ${b.lastSeen}.<br><br>
        <table class="board">${rows.map(r => `<tr><th style="width:55%">${r[0]}</th><td>${r[1]}</td></tr>`).join('')}</table></div></div>`;
}
export function storyBrief() { return M ? M.brief : null; }
export function storyDebug() { return M; }       // for automated tests
