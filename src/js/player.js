// Local player: input, movement, scope, breathing, ballistics, health.
import * as THREE from 'three';
import { camera, renderer, updateShadow, SUN } from './engine.js';
import { G, settings, clamp, lerp, rnd } from './ctx.js';
import { Weapon } from './weapon.js';
import * as hud from './hud.js';
import { sfx } from './audio.js';
import * as fx from './effects.js';

const ZOOMS = [8, 4];               // vertical FOV when scoped
const ZEROS = [100, 200, 300, 400, 500];
const MUZZLE_V = 850, GRAV = 9.81;
const MAG = 5, BOLT_TIME = 1.35, RELOAD_TIME = 1.6;
const GRAVITY = 12, JUMP_V = 5.6, STEP = 0.35, RADIUS = 0.35; // jump apex ~1.3 m, clears a 1 m parapet
const DOWN = new THREE.Vector3(0, -1, 0);
const rc = new THREE.Raycaster();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const streakMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
streakMat.color.setRGB(3, 2.6, 1.8);
const streakGeo = new THREE.BoxGeometry(1, 1, 1);

export class Player {
  constructor() {
    this.weapon = new Weapon(camera);
    this.keys = {};
    this.mdx = 0; this.mdy = 0;
    this.bullets = [];
    this.enabled = false;
    this.localHealth = true;
    this.reset();
    this.bindInput();
  }

  reset() {
    Object.assign(this, {
      hp: 100, mag: MAG, reserve: 40, yaw: 0, pitch: 0, x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0, grounded: true, peakY: 0, jumpHeld: false, eye: 1.65, alive: true,
      ads: false, scope: 0, zi: 0, zeroIdx: 0, breath: 1, winded: 0, holding: false,
      cool: 0, reload: 0, crouch: false, sprint: false, moving: false, kick: 0, kickV: 0,
      lastHurt: -99, dmgFlash: 0, stepT: 0, range: 0, rangeT: 0, flareT: 0, flareVis: false, sway: { x: 0, y: 0 },
    });
    for (const b of this.bullets) G.scene && G.scene.remove(b.streak);
    this.bullets.length = 0;
  }

  spawnAt(roof) {
    this.roof = roof;
    let x = roof.x, z = roof.z;
    for (let k = 0; k < 30; k++) {
      x = roof.x + rnd(-roof.hw * 0.7, roof.hw * 0.7); z = roof.z + rnd(-roof.hd * 0.7, roof.hd * 0.7);
      if (!(roof.obstacles || []).some(o => Math.abs(x - o.x) < o.hw + 0.6 && Math.abs(z - o.z) < o.hd + 0.6)) break;
    }
    if (roof.tower) { x = 0; z = 4; }
    this.x = x; this.z = z; this.yaw = roof.face || 0; this.pitch = 0;
    this.y = roof.y + 0.05; this.vx = this.vz = this.vy = 0; this.grounded = true; this.peakY = this.y;
    this.hp = 100; this.alive = true; this.mag = MAG; this.reload = 0; this.cool = 0; this.ads = false; this.scope = 0;
    this.dmgFlash = 0; this.crouch = false;
    hud.setDamageVignette(0);
  }

  // ---------- input ----------
  get locked() { return document.pointerLockElement === renderer.domElement; }
  lock() {
    // raw mouse input when available; silently ignore failures (e.g. window not focused) — the player can click to retry
    const plain = () => { try { const r2 = renderer.domElement.requestPointerLock(); if (r2 && r2.catch) r2.catch(() => {}); } catch (e) { /* ignore */ } };
    try { const r = renderer.domElement.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(plain); } catch (e) { plain(); }
  }
  bindInput() {
    addEventListener('keydown', e => {
      if (e.target && e.target.tagName === 'INPUT') return;
      this.keys[e.code] = true;
      if (!this.enabled || !this.alive) return;
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'KeyZ') this.zi = (this.zi + 1) % ZOOMS.length;
      if (e.code === 'PageUp') { this.zeroIdx = Math.min(ZEROS.length - 1, this.zeroIdx + 1); sfx.ui(); }
      if (e.code === 'PageDown') { this.zeroIdx = Math.max(0, this.zeroIdx - 1); sfx.ui(); }
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouch = !this.crouch;
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('mousedown', e => {
      if (!this.enabled || !this.alive || G.state !== 'play') return;
      if (e.button === 0) this.fire();
      if (e.button === 2) this.ads = true;
    });
    addEventListener('mouseup', e => { if (e.button === 2) this.ads = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => { if (this.enabled && this.scope > 0.5) this.zi = clamp(this.zi + (e.deltaY < 0 ? 1 : -1), 0, ZOOMS.length - 1); });
    addEventListener('mousemove', e => {
      if (!this.enabled || G.state !== 'play' || !this.locked) return;
      const fovK = camera.fov / settings.fov;
      const s = 0.0021 * settings.sens * (this.scope > 0.5 ? fovK * settings.scopeSens : 1);
      this.yaw -= e.movementX * s;
      this.pitch = clamp(this.pitch - e.movementY * s * (settings.invert ? -1 : 1), -1.45, 1.45);
      this.mdx += e.movementX; this.mdy += e.movementY;
    });
  }

  // ---------- actions ----------
  startReload() {
    if (this.reload > 0 || this.mag >= MAG || this.reserve <= 0 || !this.alive) return;
    this.reload = RELOAD_TIME; this.ads = false; this.weapon.startReload(RELOAD_TIME); sfx.reload(RELOAD_TIME);
  }
  fire() {
    if (this.cool > 0 || this.reload > 0 || this.sprintAmt > 0.5) return;
    if (this.mag <= 0) { sfx.dry(); this.startReload(); return; }
    this.mag--; this.cool = BOLT_TIME;
    sfx.shot(); sfx.bolt(); this.weapon.fire();
    this.kickV += this.scope > 0.85 ? 0.045 : 0.03;
    camera.updateMatrixWorld(true);
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const scoped = this.scope > 0.85;
    const spread = scoped ? 0.00012 + (this.moving ? 0.003 : 0) + (this.winded > 0 ? 0.0012 : 0) + (this.holding ? 0 : 0.0002) : 0.025;
    dir.x += rnd(-spread, spread); dir.y += rnd(-spread, spread); dir.z += rnd(-spread, spread); dir.normalize();
    // zeroing: angle up so the bullet crosses the sight line at the zero distance
    const Z = ZEROS[this.zeroIdx], tz = Z / MUZZLE_V;
    dir.y += (0.5 * GRAV * tz * tz) / Z; dir.normalize();
    const muzzle = this.weapon.muzzleWorld(new THREE.Vector3());
    if (!scoped) fx.puff(muzzle, [0.8, 0.8, 0.8], 0.3, 0.8, 0.4);
    const streak = new THREE.Mesh(streakGeo, streakMat); streak.visible = false; G.scene.add(streak);
    this.bullets.push({ pos: origin.clone(), vel: dir.multiplyScalar(MUZZLE_V), life: 2.5, dist: 0, from: scoped ? origin.clone().add(_v.set(0, -0.2, 0)) : muzzle, streak });
  }

  stepBullets(dt) {
    const targets = G.hittables;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let remaining = dt, done = false;
      while (remaining > 0 && !done) {
        const h = Math.min(remaining, 1 / 120); remaining -= h;
        const next = _v.copy(b.pos).addScaledVector(b.vel, h);
        const seg = _v2.copy(next).sub(b.pos); const len = seg.length(); seg.divideScalar(len);
        rc.set(b.pos, seg); rc.far = len;
        const wh = rc.intersectObjects(G.world.colliders, false)[0];
        const eh = targets.length ? rc.intersectObjects(targets, false)[0] : null;
        if (eh && (!wh || eh.distance < wh.distance)) {
          const ud = eh.object.userData;
          fx.bloodHit(eh.point, seg);
          this.finishBullet(b, eh.point); // announce the shot first; the server only accepts hits after a shot
          G.onBulletHit && G.onBulletHit(ud.owner, ud.part, b.dist + eh.distance, eh.point, seg.clone());
          done = true;
        } else if (wh) {
          const n = wh.face ? wh.face.normal.clone().transformDirection(wh.object.matrixWorld) : null;
          fx.impact(wh.point, n, seg);
          this.finishBullet(b, wh.point); done = true;
        } else {
          b.pos.copy(next); b.dist += len; b.vel.y -= GRAV * h;
        }
      }
      b.life -= dt;
      if (!done && b.life <= 0) { this.finishBullet(b, b.pos); done = true; }
      if (done) { G.scene.remove(b.streak); this.bullets.splice(i, 1); continue; }
      // visible bullet trail (great through the scope)
      const L = Math.min(b.dist, 7);
      if (b.dist > 3) {
        const back = _v.copy(b.vel).normalize();
        b.streak.visible = true;
        b.streak.position.copy(b.pos).addScaledVector(back, -L / 2);
        b.streak.lookAt(b.pos); b.streak.scale.set(0.012 + b.dist * 0.00012, 0.012 + b.dist * 0.00012, L);
      }
    }
  }
  finishBullet(b, end) { fx.tracer(b.from, end.clone()); G.onPlayerShot && G.onPlayerShot(b.from, end); }

  // ---------- damage ----------
  hurtFrom(fromPos) {
    if (fromPos) hud.damageFrom(Math.atan2(fromPos[0] - this.x, -(fromPos[2] - this.z)));
    this.dmgFlash = 1; this.lastHurt = G.time; sfx.hurt();
  }
  takeDamage(dmg, fromPos) {
    if (!this.alive) return;
    this.hp -= dmg; this.hurtFrom(fromPos);
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }
  setHp(hp, fromPos) { if (hp < this.hp) this.hurtFrom(fromPos); this.hp = hp; if (hp <= 0 && this.alive) this.die(); }
  die() { this.alive = false; this.ads = false; G.onPlayerDeath && G.onPlayerDeath(); }

  netState() {
    return { p: [+this.x.toFixed(2), +this.y.toFixed(2), +this.z.toFixed(2)], yaw: +this.yaw.toFixed(3), pitch: +this.pitch.toFixed(3), crouch: this.eye < 1.2, ads: this.scope > 0.5, moving: this.moving };
  }

  // ---------- movement physics: gravity, ground, walls, fall damage ----------
  // Uses the real world colliders, so parapets, roof props and neighbouring buildings all block or support.
  groundAt(x, z, list) {
    rc.set(_v.set(x, this.y + STEP + 0.05, z), DOWN); rc.far = 400;
    const h = rc.intersectObjects(list, false)[0];
    return h ? h.point.y : -50;
  }
  blocked(x, z, dx, dz, list) {
    const len = Math.hypot(dx, dz); if (len < 1e-6) return false;
    _v2.set(dx / len, 0, dz / len);
    rc.far = len + RADIUS;
    for (const hh of [STEP + 0.05, 0.9, 1.5]) {
      rc.set(_v.set(x, this.y + hh, z), _v2);
      if (rc.intersectObjects(list, false).length) return true;
    }
    return false;
  }
  physics(dt) {
    const list = G.world.near(this.x, this.z, 8);
    // horizontal, axis by axis so you slide along walls
    const sx = this.vx * dt, sz = this.vz * dt;
    // a wall just stops the step; velocity is kept so a jump carries on once it clears a parapet
    if (sx && !this.blocked(this.x, this.z, sx, 0, list)) this.x += sx;
    if (sz && !this.blocked(this.x, this.z, 0, sz, list)) this.z += sz;
    // vertical
    const ground = this.groundAt(this.x, this.z, list);
    if (this.grounded) {
      if (ground < this.y - 0.05) { this.grounded = false; this.vy = 0; this.peakY = this.y; } // walked off an edge
      else this.y = Math.max(this.y, ground);                                                    // small steps up
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt; this.y += this.vy * dt;
      this.peakY = Math.max(this.peakY, this.y);
      if (this.y <= ground) {
        this.y = ground; this.vy = 0; this.grounded = true;
        const drop = this.peakY - this.y;
        if (drop > 3.5) {
          const dmg = drop > 14 ? 999 : (drop - 3.5) * 10;
          this.kickV += 0.03; sfx.step();
          if (this.localHealth) this.takeDamage(dmg, null);
          else { G.onFall && G.onFall(dmg); this.hurtFrom(null); }
        }
      }
    }
  }

  // ---------- frame ----------
  update(dt) {
    const k = this.keys, t = G.time;
    const alive = this.alive && G.state === 'play';
    // movement
    let mx = 0, my = 0;
    if (alive) { mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0); my = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0); }
    this.moving = !!(mx || my);
    const shift = k.ShiftLeft || k.ShiftRight;
    this.sprint = alive && shift && this.moving && my > 0 && !this.crouch && this.scope < 0.3 && this.reload <= 0;
    this.sprintAmt = lerp(this.sprintAmt || 0, this.sprint ? 1 : 0, Math.min(1, dt * 8));
    // desired horizontal velocity from input
    let wx = 0, wz = 0;
    if (this.moving) {
      const l = Math.hypot(mx, my); mx /= l; my /= l;
      const spd = this.sprint ? 5.6 : this.crouch ? 1.6 : this.scope > 0.5 ? 1.3 : 3.2;
      const fx_ = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      wx = (fx_ * my + rx * mx) * spd; wz = (fz * my + rz * mx) * spd;
    }
    // full control on the ground, a little air control while jumping
    const ctrl = this.grounded ? 1 : Math.min(1, dt * 3);
    this.vx = lerp(this.vx, wx, ctrl); this.vz = lerp(this.vz, wz, ctrl);
    // jump: take off with the running speed you are asking for (even if a parapet stopped you)
    if (alive && k.Space && this.grounded && !this.jumpHeld) {
      this.vy = JUMP_V; this.grounded = false; this.peakY = this.y; this.jumpHeld = true; this.crouch = false; sfx.step();
      this.vx = wx; this.vz = wz;
    }
    if (!k.Space) this.jumpHeld = false;
    this.physics(dt);
    if (this.grounded && this.moving) {
      this.stepT -= dt * (this.sprint ? 1.6 : 1);
      if (this.stepT <= 0) { sfx.step(); this.stepT = this.crouch ? 0.7 : 0.48; }
    }
    this.eye = lerp(this.eye, this.crouch ? 0.85 : 1.65, Math.min(1, dt * 9));
    // scope / breath
    const wantAds = this.ads && alive && this.reload <= 0 && !this.sprint;
    this.scope = clamp(this.scope + (wantAds ? dt / 0.22 : -dt / 0.15), 0, 1);
    const wasHolding = this.holding;
    this.holding = !!shift && this.scope > 0.85 && this.winded <= 0 && this.breath > 0;
    if (this.holding) { this.breath -= dt / 5; if (this.breath <= 0) { this.winded = 2.2; sfx.breath(false); } }
    else this.breath = Math.min(1, this.breath + dt / 6);
    if (this.holding && !wasHolding) sfx.breath(true);
    if (!this.holding && wasHolding && this.winded <= 0) sfx.breath(false);
    if (this.winded > 0) this.winded -= dt;
    // timers
    if (this.cool > 0) this.cool -= dt;
    if (this.reload > 0) { this.reload -= dt; if (this.reload <= 0) { const n = Math.min(MAG - this.mag, this.reserve); this.mag += n; this.reserve -= n; } }
    this.kick += this.kickV * dt * 30; this.kickV *= Math.exp(-dt * 20); this.kick = lerp(this.kick, 0, Math.min(1, dt * 5));
    this.dmgFlash = Math.max(0, this.dmgFlash - dt * 0.7);
    if (this.localHealth && alive && G.time - this.lastHurt > 5 && this.hp < 100) this.hp = Math.min(100, this.hp + 12 * dt);
    // camera
    const ease = this.scope * this.scope * (3 - 2 * this.scope);
    const fov = lerp(settings.fov, this.scope > 0.85 ? ZOOMS[this.zi] : settings.fov * 0.8, ease);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const sw = (this.scope > 0.5 ? 1 : 0.3) * (this.holding ? 0.1 : 1) * (this.moving ? 2.2 : 1) * (this.winded > 0 ? 2 : 1) * (this.crouch ? 0.7 : 1);
    this.sway.x = (Math.sin(t * 0.9) * 0.0024 + Math.sin(t * 2.3) * 0.0009) * sw;
    this.sway.y = (Math.cos(t * 0.75) * 0.0019 + Math.cos(t * 2.9) * 0.0007) * sw + (this.holding ? 0 : Math.sin(t * 1.6) * 0.0006 * sw);
    const deadDrop = this.alive ? 0 : 0.9;
    camera.position.set(this.x, this.y + this.eye - deadDrop, this.z);
    camera.rotation.set(this.pitch + this.sway.y + this.kick, this.yaw + this.sway.x, this.alive ? 0 : 0.5);
    updateShadow(camera.position);
    // weapon
    this.weapon.update(dt, { ads: this.scope > 0.05 && wantAds, moving: this.moving, sprint: this.sprint, crouch: this.crouch, mouseDX: this.mdx, mouseDY: this.mdy, visible: this.scope < 0.9 && this.alive });
    this.mdx = 0; this.mdy = 0;
    this.stepBullets(dt);
    // range finder (throttled)
    if (this.scope > 0.85 && (this.rangeT -= dt) <= 0) {
      this.rangeT = 0.08;
      rc.set(camera.position, camera.getWorldDirection(_v)); rc.far = 2000;
      const h = rc.intersectObjects(G.world.colliders.concat(G.hittables), false)[0];
      this.range = h ? h.distance : 0;
    }
    // HUD
    hud.health(this.hp);
    hud.setDamageVignette(this.dmgFlash * 0.9 + (this.hp < 35 && this.alive ? 0.25 + Math.sin(t * 4) * 0.08 : 0));
    hud.ammo(this.mag, this.reserve, this.reload > 0 ? 'RELOADING' : this.cool > 0.25 && this.mag > 0 ? 'CHAMBERING' : this.mag === 0 ? (this.reserve ? 'RELOAD [R]' : 'NO AMMO') : '');
    hud.zero(ZEROS[this.zeroIdx]);
  }

  overlayState(t) {
    const fovR = camera.fov * Math.PI / 180;
    let flare = null;
    if (this.scope < 0.3) {
      if ((this.flareT -= 1) <= 0) {
        this.flareT = 10; rc.set(camera.position, SUN); rc.far = 3000;
        this.flareVis = !rc.intersectObjects(G.world.colliders, false).length;
      }
      const p = _v.copy(camera.position).addScaledVector(SUN, 1000).project(camera);
      if (p.z < 1 && this.flareVis) {
        const k = 1 - clamp(Math.hypot(p.x, p.y) / 1.4, 0, 1);
        if (k > 0) flare = { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight, k };
      }
    }
    return {
      t, scope: this.scope, sway: this.sway, range: this.range, zoomX: Math.round(settings.fov / ZOOMS[this.zi] * 1.5),
      zero: ZEROS[this.zeroIdx], breath: this.breath, winded: this.winded > 0, holding: this.holding, moving: this.moving,
      milPx: 0.001 * innerHeight / (2 * Math.tan(fovR / 2)), headingRad: -this.yaw, flare, crosshair: this.alive && this.sprintAmt < 0.5,
    };
  }
}
