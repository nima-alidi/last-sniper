// Multiplayer client: connection, lobby state, remote players, combat events.
import * as THREE from 'three';
import { scene } from './engine.js';
import { G, clamp } from './ctx.js';
import { createSoldier } from './soldier.js';
import * as fx from './effects.js';
import * as hud from './hud.js';
import { sfx } from './audio.js';

export const PROTOCOL = 3;
export const net = {
  ws: null, id: 0, admin: false, lobby: null, connected: false,
  listeners: {},
  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  emit(ev, data) { (this.listeners[ev] || []).forEach(f => f(data)); },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
};
const remotes = new Map(); // id -> {s, buf:[], alive, team, name}
let sendT = 0;

export function connect(host, port, name, token) {
  return new Promise((resolve, reject) => {
    disconnect();
    let ws;
    try { ws = new WebSocket(`ws://${host}:${port}`); } catch (e) { reject(new Error('Invalid address')); return; }
    net.ws = ws;
    const to = setTimeout(() => { ws.close(); reject(new Error('Connection timed out')); }, 6000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL, name, token }));
    ws.onerror = () => { clearTimeout(to); reject(new Error('Could not connect to ' + host + ':' + port)); };
    ws.onclose = () => { clearTimeout(to); if (net.connected) { net.connected = false; net.emit('disconnected'); } clearRemotes(); };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { clearTimeout(to); net.id = m.id; net.admin = m.admin; net.connected = true; resolve(); }
      if (m.t === 'error') { clearTimeout(to); reject(new Error(m.text)); }
      handle(m);
    };
  });
}
export function disconnect() {
  if (net.ws) { net.connected = false; try { net.ws.close(); } catch (e) {} }
  net.ws = null; net.lobby = null; clearRemotes();
}

function clearRemotes() { for (const r of remotes.values()) removeRemote(r); remotes.clear(); G.hittables = []; }
function removeRemote(r) { scene.remove(r.s.root); r.s.dispose(); }
const nameOf = id => (net.lobby && net.lobby.players.find(p => p.id === id) || {}).name || (id === net.id ? 'You' : 'Player');
const teamOf = id => (net.lobby && net.lobby.players.find(p => p.id === id) || {}).team;
const myTeam = () => teamOf(net.id);
function teamColorCss(team) { return team === 'A' ? 'var(--teamA)' : team === 'B' ? 'var(--teamB)' : 'var(--accent2)'; }
export function isEnemy(team) { const s = net.lobby && net.lobby.settings; return !(s && s.mode === 'tdm' && team === myTeam()); }

function ensureRemote(p) {
  let r = remotes.get(p.id);
  if (r && r.team !== p.team) { removeRemote(r); remotes.delete(p.id); r = null; }
  if (!r) {
    const friendly = !isEnemy(p.team);
    const s = createSoldier({ team: p.team, name: p.name, showName: friendly });
    scene.add(s.root);
    r = { id: p.id, s, buf: [], alive: p.alive, team: p.team, name: p.name };
    s.setOwner(r);
    remotes.set(p.id, r);
  }
  return r;
}

function handle(m) {
  switch (m.t) {
    case 'lobby': net.lobby = m; net.emit('lobby', m); break;
    case 'start': net.emit('start', m); break;
    case 'spawn': net.emit('spawn', m); break;
    case 'snap': {
      const now = performance.now();
      for (const p of m.players) {
        if (p.id === net.id) continue;
        const r = ensureRemote(p);
        r.alive = p.alive;
        r.buf.push({ time: now, p: p.p, yaw: p.yaw, pitch: p.pitch, crouch: p.crouch, moving: p.moving });
        if (r.buf.length > 20) r.buf.shift();
      }
      const ids = new Set(m.players.map(p => p.id));
      for (const [id, r] of remotes) if (!ids.has(id)) { removeRemote(r); remotes.delete(id); }
      break;
    }
    case 'left': { const r = remotes.get(m.id); if (r) { removeRemote(r); remotes.delete(m.id); } break; }
    case 'alive': { const r = remotes.get(m.id); if (r) r.alive = m.alive; break; }
    case 'shot': {
      const from = new THREE.Vector3(...m.from), to = new THREE.Vector3(...m.to);
      fx.tracer(from, to, true);
      const shooter = remotes.get(m.id); if (shooter) { shooter.s.playShoot(); shooter.lastShot = performance.now(); }
      if (G.player && G.player.roof) fx.muzzleFlash(from, Math.hypot(from.x - G.player.x, from.z - G.player.z));
      const p = G.player; if (!p || !p.roof) break;
      const dist = Math.hypot(from.x - p.x, from.z - p.z);
      const pan = clamp(Math.sin(Math.atan2(from.x - p.x, -(from.z - p.z)) + p.yaw), -1, 1);
      sfx.remoteShot(dist, pan);
      // near miss whiz
      const eye = new THREE.Vector3(p.x, p.y + p.eye, p.z);
      const line = new THREE.Line3(from, to), cp = new THREE.Vector3(); line.closestPointToPoint(eye, true, cp);
      if (cp.distanceTo(eye) < 4 && to.distanceTo(eye) > 1) sfx.whiz(pan);
      break;
    }
    case 'hurt': G.player.setHp(m.hp, m.fromPos); break;
    case 'heal': if (G.player.alive) G.player.hp = Math.max(G.player.hp, m.hp); break;
    case 'hitconfirm': hud.hitMarker(m.kill, m.head); sfx.hit(); break;
    case 'kill': {
      const kn = hud.esc(nameOf(m.killer)), vn = hud.esc(nameOf(m.victim));
      if (m.fall) {
        hud.feed(`<b style="color:${teamColorCss(teamOf(m.victim))}">${vn}</b> <span class="hs">FELL TO THEIR DEATH</span>`);
        if (m.victim === net.id) { G.player.alive = false; G.player.hp = 0; net.emit('died', { by: 'A FALL', head: false, dist: 0 }); }
        break;
      }
      hud.feed(`<b style="color:${teamColorCss(teamOf(m.killer))}">${kn}</b> <span class="hs">${m.head ? '⌖ HEADSHOT' : '⌖'} ${m.dist}m</span> <b style="color:${teamColorCss(teamOf(m.victim))}">${vn}</b>`);
      if (m.killer === net.id) {
        const pts = 100 + (m.head ? 50 : 0) + Math.floor(m.dist / 10) * 5;
        hud.banner(m.head ? `HEADSHOT — ${vn}` : `KILLED ${vn}`, pts); if (m.head) sfx.headshot(); else sfx.kill();
      }
      if (m.victim === net.id) { G.player.alive = false; G.player.hp = 0; net.emit('died', { by: kn, head: m.head, dist: m.dist }); }
      break;
    }
    case 'end': net.emit('end', m); break;
    case 'chat': net.emit('chat', m); break;
    case 'feed': hud.feed(`<span style="color:var(--dim)">${hud.esc(m.text)}</span>`); net.emit('sys', m.text); break;
    case 'kicked': net.emit('kicked'); break;
  }
}

// ---------- per-frame ----------
const INTERP_MS = 110;
export function updateNet(dt) {
  if (!net.connected) return;
  const p = G.player;
  sendT -= dt;
  if (sendT <= 0 && p.roof && G.state !== 'menu') { sendT = 0.05; net.send({ t: 'state', ...p.netState() }); }
  const renderTime = performance.now() - INTERP_MS;
  G.hittables = [];
  for (const r of remotes.values()) {
    const b = r.buf; if (!b.length) continue;
    let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) if (b[i].time <= renderTime && b[i + 1].time >= renderTime) { a = b[i]; c = b[i + 1]; break; }
    const k = c.time > a.time ? clamp((renderTime - a.time) / (c.time - a.time), 0, 1) : 1;
    const x = a.p[0] + (c.p[0] - a.p[0]) * k, y = a.p[1] + (c.p[1] - a.p[1]) * k, z = a.p[2] + (c.p[2] - a.p[2]) * k;
    let dy = c.yaw - a.yaw; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
    const yaw = a.yaw + dy * k;
    r.s.root.position.x = x; r.s.root.position.z = z;
    r.s.root.rotation.y = yaw + Math.PI; // soldier faces +z, player forward is -z
    const speed = Math.hypot(c.p[0] - a.p[0], c.p[2] - a.p[2]) / Math.max(0.001, (c.time - a.time) / 1000);
    r.s.pose(dt, { crouch: c.crouch, moving: c.moving, run: speed > 4.5, aim: c.ads, pitch: c.pitch, dead: !r.alive, baseY: y });
    r.s.root.visible = true;
    r.s.showTag(!isEnemy(r.team));
    if (r.alive && isEnemy(r.team)) G.hittables.push(...r.s.hits);
  }
}

export function sendFall(dmg) { net.send({ t: 'fall', dmg: Math.round(dmg) }); }
export function sendHit(owner, part, dist) { if (owner && owner.id) net.send({ t: 'hit', target: owner.id, part, dist }); }
export function sendShot(from, to) { net.send({ t: 'shot', from: [from.x, from.y, from.z].map(v => +v.toFixed(2)), to: [to.x, to.y, to.z].map(v => +v.toFixed(2)) }); }
export function admin(cmd, extra = {}) { net.send({ t: 'admin', cmd, ...extra }); }
export function chat(text) { net.send({ t: 'chat', text }); }

export function compassMarkers() {
  // teammates shown in team colour
  const p = G.player, out = [];
  if (!p || !p.roof) return out;
  for (const r of remotes.values()) {
    if (!r.alive || isEnemy(r.team)) continue;
    const pos = r.s.root.position;
    out.push({ heading: ((Math.atan2(pos.x - p.x, -(pos.z - p.z)) * 180 / Math.PI) + 360) % 360, color: r.team === 'A' ? '#4aa3ff' : '#ff6a4d' });
  }
  return out;
}

// minimap: teammates always, enemies only for 3 s after they fire (like a red dot on the radar)
export function minimapMarkers() {
  const out = [], now = performance.now();
  for (const r of remotes.values()) {
    if (!r.alive) continue;
    const pos = r.s.root.position;
    if (!isEnemy(r.team)) out.push({ x: pos.x, z: pos.z, kind: 'friend' });
    else if (r.lastShot && now - r.lastShot < 3000) out.push({ x: pos.x, z: pos.z, kind: 'shot' });
  }
  return out;
}

export function scoreboardHtml() {
  const L = net.lobby; if (!L) return '';
  const rows = list => list.sort((a, b) => b.score - a.score).map(p =>
    `<tr class="${p.id === net.id ? 'me' : ''}"><td class="${p.team}">${hud.esc(p.name)}${p.admin ? ' <small>HOST</small>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.score}</td><td>${p.ping || 0}</td></tr>`).join('');
  const head = '<tr><th>PLAYER</th><th>K</th><th>D</th><th>SCORE</th><th>PING</th></tr>';
  if (L.settings.mode === 'tdm') {
    return `<h3><span>TEAM DEATHMATCH</span><span><span class="team-a">${L.teamScore.A}</span> — <span class="team-b">${L.teamScore.B}</span></span></h3>
      <table class="board">${head}${rows(L.players.filter(p => p.team === 'A'))}</table><br>
      <table class="board">${head}${rows(L.players.filter(p => p.team === 'B'))}</table>`;
  }
  return `<h3><span>FREE FOR ALL</span><span>FIRST TO ${L.settings.scoreLimit}</span></h3><table class="board">${head}${rows([...L.players])}</table>`;
}
