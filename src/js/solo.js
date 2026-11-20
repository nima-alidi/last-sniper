// Solo mode: hold the central tower against enemy snipers, one at a time.
// Each enemy is first reported on the minimap, then walks onto its rooftop, takes cover
// behind sandbags and periodically stands up to aim and fire. No laser / scope glint:
// the player finds him with the minimap, the compass and the direction arrows.
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, rnd, clamp } from './ctx.js';
import { createSoldier } from './soldier.js';
import * as fx from './effects.js';
import * as hud from './hud.js';
import { sfx } from './audio.js';

const rc = new THREE.Raycaster();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const WARN_TIME = 5;      // seconds an enemy is shown on the minimap before he walks out
const WALK_SPEED = 1.5;   // m/s

let enemy = null, nextT = 0, count = 0, score = 0, kills = 0, headshots = 0, longest = 0;
let onGameOver = null;

export function startSolo(gameOverCb) {
  stopSolo();
  onGameOver = gameOverCb;
  enemy = null; nextT = 3; count = 0; score = 0; kills = 0; headshots = 0; longest = 0;
  const p = G.player;
  p.reset(); p.localHealth = true; p.reserve = 40;
  p.spawnAt(G.world.spawns.find(s => s.tower));
  G.world.nests.forEach(n => (n.busy = false));
  G.onBulletHit = onHit;
  G.onPlayerShot = null;
  G.onPlayerDeath = () => {
    hud.death(true, 'KILLED BY ENEMY SNIPER', '');
    setTimeout(() => onGameOver && onGameOver(summary()), 1800);
  };
  hud.matchInfo({ a: '', b: '', time: 'KILLS 0' });
}
export function stopSolo() {
  if (enemy) removeEnemy(enemy);
  enemy = null; G.hittables = [];
}
export function summary() { return { wave: count, kills, score, headshots, longest: Math.round(longest) }; }

function eye(out) { const p = G.player; return out.set(p.x, p.y + p.eye, p.z); }
function hasLOS(from, to) {
  const dir = _v3.copy(to).sub(from), d = dir.length(); dir.normalize();
  rc.set(from, dir); rc.far = d;
  const h = rc.intersectObjects(G.world.colliders, false)[0];
  return !(h && h.distance < d - 0.3);
}
const heading = (x, z) => { const p = G.player; return Math.atan2(x - p.x, -(z - p.z)); };
const compassName = rad => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((rad * 180 / Math.PI) + 360) % 360 / 45) % 8];

// ---------- spawning ----------
// Can the enemy's head at this nest be seen from somewhere along the tower edge facing it?
// (cached per nest; buildings in between, parapets and roof clutter are all taken into account)
function visibleFromTower(n) {
  if (n.towerLOS !== undefined) return n.towerLOS;
  const t = G.world.spawns.find(s => s.tower);
  const eyeY = t.y + 1.65, L = Math.hypot(n.x - t.x, n.z - t.z) || 1;
  const ux = (n.x - t.x) / L, uz = (n.z - t.z) / L, vx = -uz, vz = ux;
  const target = new THREE.Vector3(n.x, n.y + 1.55, n.z);
  n.towerLOS = false;
  for (const k of [0, -3, 3, -6, 6]) {
    const px = clamp(t.x + ux * t.hw + vx * k, t.x - t.hw, t.x + t.hw), pz = clamp(t.z + uz * t.hd + vz * k, t.z - t.hd, t.z + t.hd);
    if (hasLOS(_v.set(px, eyeY, pz), target)) { n.towerLOS = true; break; }
  }
  return n.towerLOS;
}
function pickNest() {
  const eyeY = G.world.spawns.find(s => s.tower).y + 1.65;
  // visible from the tower: not too far below the parapet line and nothing in between
  const ok = G.world.nests.filter(n => (n.roof || n.window) && !n.busy && (eyeY - (n.y + 1.6)) / Math.max(1, Math.hypot(n.x, n.z)) < 0.17 && visibleFromTower(n));
  if (!ok.length) return null;
  // distance grows as the player gets better
  const want = Math.min(60 + count * 14, 220);
  ok.sort((a, b) => Math.abs(Math.hypot(a.x, a.z) - want) - Math.abs(Math.hypot(b.x, b.z) - want));
  return ok[Math.floor(Math.random() * Math.min(4, ok.length))];
}

function spawnNext() {
  const nest = pickNest(); if (!nest) { nextT = 2; return; }
  count++;
  const s = createSoldier({ team: 'AI' });
  s.root.visible = false;
  scene.add(s.root);
  // walk-in start point: across the roof, away from the edge he will shoot from
  // rooftop: walk in from across the roof; window: already inside, behind the sill
  const r = nest.roof;
  const sx = r ? clamp(r.x + (r.x - nest.x) * 0.7, r.x - r.hw + 0.6, r.x + r.hw - 0.6) : nest.x;
  const sz = r ? clamp(r.z + (r.z - nest.z) * 0.7, r.z - r.hd + 0.6, r.z + r.hd - 0.6) : nest.z;
  const dist = Math.hypot(nest.x - G.player.x, nest.z - G.player.z);
  enemy = {
    s, nest, dist, state: 'incoming', t: WARN_TIME, hp: 100, x: sx, z: sz, yaw: Math.atan2(nest.x - sx, nest.z - sz),
    aimTime: Math.max(1.5, 3.4 - count * 0.12) + rnd(-0.2, 0.3), aimT: 0, aimP: 0, waited: 0, dead: 0,
  };
  s.setOwner(enemy);
  nest.busy = true;
  sfx.warn();
  hud.message(`HOSTILE SNIPER SPOTTED — ${Math.round(dist)} m ${compassName(heading(nest.x, nest.z))}${nest.window ? ' · IN A WINDOW' : ' · ROOFTOP'}`, 3.5);
}
function removeEnemy(e) { scene.remove(e.s.root); e.s.dispose(); e.nest.busy = false; }

// ---------- combat ----------
function enemyFire(e) {
  e.state = 'cover'; e.t = rnd(2.2, 4.2) - Math.min(count * 0.08, 1.2);
  e.s.playShoot();
  const mz = e.s.muzzleWorld(new THREE.Vector3()), ey = eye(new THREE.Vector3());
  const pan = clamp(Math.sin(heading(mz.x, mz.z) + G.player.yaw), -1, 1);
  sfx.remoteShot(e.dist, pan);
  fx.muzzleFlash(mz, mz.distanceTo(ey));
  if (hasLOS(mz, ey)) G.player.takeDamage(rnd(34, 45), [mz.x, mz.y, mz.z]);
  else { hud.message('INCOMING — STAY DOWN', 1.2); sfx.whiz(pan); }
}

function onHit(e, part, dist) {
  if (!e || e !== enemy || e.state === 'dead') return;
  const head = part === 'head';
  e.hp -= head ? 200 : part === 'limb' ? 45 : 75;
  hud.hitMarker(e.hp <= 0, head); sfx.hit();
  if (e.hp <= 0) {
    e.state = 'dead'; e.dead = 0;
    kills++; if (head) headshots++; longest = Math.max(longest, dist);
    const pts = 100 + Math.floor(dist / 10) * 5 + (head ? 100 : 0);
    score += pts;
    if (head) sfx.headshot(); else sfx.kill();
    hud.banner(head ? 'HEADSHOT' : 'ENEMY KILLED', pts);
    hud.feed(`<b>YOU</b> <span class="hs">${head ? '⌖ HEADSHOT' : '⌖'}</span> Enemy Sniper <span class="hs">${Math.round(dist)}m</span>`);
    hud.matchInfo({ a: '', b: '', time: `KILLS ${kills}` });
    const p = G.player;
    p.hp = Math.min(100, p.hp + 20);
    if (kills % 3 === 0) { p.reserve = Math.min(40, p.reserve + 10); hud.message('AMMO RESUPPLIED', 2); }
  } else {
    // wounded: visible flinch, bleeds from now on; the first time he also changes position
    e.s.playHit(); e.wounded = true;
    hud.banner('HIT — TARGET WOUNDED', 25); score += 25;
    if (!e.relocated) { e.relocated = true; e.state = 'flee'; e.t = 1.1; hud.message('WOUNDED — HE IS CHANGING POSITION', 2.5); }
    else if (e.state === 'aim') { e.state = 'cover'; e.t = rnd(3, 5); }
  }
}

// move a wounded enemy to another visible nest
function relocate(e) {
  const old = e.nest;
  const nest = pickNest();
  old.busy = false;
  if (!nest) { e.nest = old; old.busy = true; e.state = 'cover'; e.t = 3; return; }
  nest.busy = true; e.nest = nest;
  const r = nest.roof;
  e.x = r ? clamp(r.x + (r.x - nest.x) * 0.7, r.x - r.hw + 0.6, r.x + r.hw - 0.6) : nest.x;
  e.z = r ? clamp(r.z + (r.z - nest.z) * 0.7, r.z - r.hd + 0.6, r.z + r.hd - 0.6) : nest.z;
  e.dist = Math.hypot(nest.x - G.player.x, nest.z - G.player.z);
  e.state = 'incoming'; e.t = 3; e.s.root.visible = false;
  sfx.warn();
  hud.message(`WOUNDED ENEMY RELOCATED — ${Math.round(e.dist)} m ${compassName(heading(nest.x, nest.z))}`, 3);
}

// ---------- per frame ----------
export function updateSolo(dt) {
  const p = G.player;
  G.hittables = [];
  if (!enemy) {
    nextT -= dt;
    if (nextT <= 0) spawnNext();
    return;
  }
  const e = enemy, nest = e.nest;
  let moving = false, crouch = false, aim = false;
  let faceYaw = Math.atan2(p.x - e.x, p.z - e.z);
  switch (e.state) {
    case 'incoming':
      e.t -= dt;
      if (e.t <= 0) { e.state = nest.window ? 'cover' : 'walk'; e.t = rnd(1.5, 2.5); e.s.root.visible = true; }
      break;
    case 'walk': {
      const dx = nest.x - e.x, dz = nest.z - e.z, d = Math.hypot(dx, dz);
      if (d < 0.1) { e.state = 'cover'; e.t = rnd(1.5, 2.8); break; }
      const step = Math.min(d, (e.wounded ? 0.9 : WALK_SPEED) * dt);
      e.x += dx / d * step; e.z += dz / d * step;
      moving = true; faceYaw = Math.atan2(dx, dz);
      break;
    }
    case 'cover':
      crouch = true; e.t -= dt; e.waited += dt;
      if (e.t <= 0 && p.alive) {
        // stands up when he can see the player (or eventually anyway, so he can be found)
        if (hasLOS(_v.set(nest.x, nest.y + 1.5, nest.z), eye(_v2)) || e.waited > 8) { e.state = 'aim'; e.aimT = 0; e.waited = 0; }
        else e.t = 0.8;
      }
      break;
    case 'aim':
      aim = true; e.aimT += dt; e.aimP = e.aimT / e.aimTime;
      if (e.aimT >= e.aimTime && p.alive) enemyFire(e);
      break;
    case 'flee': // crouch down after being hit, then slip away to a new position
      crouch = true; e.t -= dt;
      if (e.t <= 0) { relocate(e); return; }
      break;
    case 'dead':
      e.dead += dt;
      if (e.dead > 3.5) { removeEnemy(e); enemy = null; nextT = rnd(2.5, 4); return; }
      break;
  }
  // a wounded enemy keeps bleeding
  if (e.wounded && e.state !== 'incoming' && e.state !== 'dead') {
    e.bleedT = (e.bleedT || 0) - dt;
    if (e.bleedT <= 0) { e.bleedT = 0.3; fx.burst(_v.set(e.x, nest.y + 1.1 - (crouch ? 0.5 : 0), e.z), 3, 'blood', 0.8, 0.9, 9.8); }
  }
  // smooth turning
  let dy = faceYaw - e.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  e.yaw += dy * Math.min(1, dt * 5);
  const r = e.s.root;
  r.position.x = e.x; r.position.z = e.z; r.rotation.y = e.yaw;
  const ddx = p.x - e.x, ddz = p.z - e.z, ddy = p.y + p.eye - (nest.y + 1.45);
  e.s.pose(dt, { crouch, aim, moving, pitch: aim ? Math.atan2(ddy, Math.hypot(ddx, ddz)) : 0, dead: e.state === 'dead', baseY: nest.y });
  if (e.state !== 'incoming' && e.state !== 'dead') G.hittables.push(...e.s.hits);
}

// direction arrows on screen: only while he is aiming at you
export function soloIndicators() {
  if (!enemy || enemy.state !== 'aim') return [];
  return [{ heading: heading(enemy.nest.x, enemy.nest.z), p: enemy.aimP }];
}
// compass + minimap know where he is once reported
export function soloCompass() {
  if (!enemy || enemy.state === 'dead') return [];
  return [{ heading: ((heading(enemy.x, enemy.z) * 180 / Math.PI) + 360) % 360, color: enemy.state === 'aim' ? '#ff2a2a' : '#ff8a3a' }];
}
export function soloMinimap() {
  if (!enemy || enemy.state === 'dead') return [];
  const e = enemy;
  const kind = e.state === 'aim' ? 'aim' : e.state === 'incoming' ? 'warn' : e.wounded ? 'wounded' : 'enemy';
  return [{ x: e.state === 'incoming' ? e.nest.x : e.x, z: e.state === 'incoming' ? e.nest.z : e.z, kind }];
}
export function soloScoreboard() {
  return `<h3><span>SOLO — TARGET ${count}</span><span>SCORE ${score}</span></h3>
  <table class="board"><tr><th>KILLS</th><th>HEADSHOTS</th><th>LONGEST SHOT</th><th>SCORE</th></tr>
  <tr class="me"><td>${kills}</td><td>${headshots}</td><td>${Math.round(longest)} m</td><td>${score}</td></tr></table>`;
}
