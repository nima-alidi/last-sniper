'use strict';
// Last Sniper - multiplayer game server.
// Runs inside the host's Electron app (or standalone: `node server/server.js [port]`).
// Lightweight authority: tracks lobby, teams, health, kills, scores and match flow.
// Hit detection is done by the shooter's client and validated loosely here.

const { WebSocketServer } = require('ws');
const os = require('os');
const crypto = require('crypto');

const PROTOCOL = 3;
const TICK_MS = 50;           // 20 Hz snapshots
const RESPAWN_MS = 4000;
const SHOT_COOLDOWN_MS = 900; // bolt action: rejects hit spam

function localIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

class GameServer {
  constructor({ port = 27015, adminToken = crypto.randomBytes(12).toString('hex') } = {}) {
    this.port = port;
    this.adminToken = adminToken;
    this.players = new Map(); // id -> player
    this.nextId = 1;
    this.settings = { mode: 'tdm', scoreLimit: 30, timeLimit: 10, seed: (Math.random() * 1e9) | 0 };
    this.phase = 'lobby';       // lobby | playing | ended
    this.endsAt = 0;
    this.teamScore = { A: 0, B: 0 };
    this.wss = null;
    this.timer = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port, maxPayload: 64 * 1024 });
      this.wss.once('listening', () => {
        this.timer = setInterval(() => this.tick(), TICK_MS);
        resolve({ port: this.port, ips: localIPs(), adminToken: this.adminToken });
      });
      this.wss.once('error', reject);
      this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    });
  }

  stop() {
    clearInterval(this.timer);
    if (this.wss) {
      for (const c of this.wss.clients) { try { c.close(1001, 'server closed'); } catch (e) {} }
      this.wss.close();
    }
    this.wss = null;
  }

  // ---------- helpers ----------
  send(p, msg) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }
  broadcast(msg, except) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(s);
  }
  lobbyInfo() {
    return {
      t: 'lobby', phase: this.phase, settings: this.settings, teamScore: this.teamScore,
      endsAt: this.endsAt, now: Date.now(),
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, team: p.team, admin: p.admin, kills: p.kills, deaths: p.deaths, score: p.score, ping: p.ping,
      })),
    };
  }
  pushLobby() { this.broadcast(this.lobbyInfo()); }
  smallerTeam() {
    let a = 0, b = 0;
    for (const p of this.players.values()) { if (p.team === 'A') a++; else if (p.team === 'B') b++; }
    return a <= b ? 'A' : 'B';
  }
  feed(text) { this.broadcast({ t: 'feed', text }); }

  // ---------- connection ----------
  onConnection(ws, req) {
    let p = null;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; if (p) p.ping = Date.now() - p.pingSent; });
    ws.on('message', raw => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (!p) {
        if (m.t !== 'hello') return;
        if (m.protocol !== PROTOCOL) { ws.send(JSON.stringify({ t: 'error', text: 'Version mismatch - update the game.' })); ws.close(); return; }
        if (this.players.size >= 16) { ws.send(JSON.stringify({ t: 'error', text: 'Server is full.' })); ws.close(); return; }
        const name = String(m.name || 'Player').replace(/[^\w \-.]/g, '').slice(0, 16).trim() || 'Player';
        p = {
          id: this.nextId++, ws, name, admin: m.token === this.adminToken,
          team: this.settings.mode === 'tdm' ? this.smallerTeam() : 'F',
          kills: 0, deaths: 0, score: 0, hp: 100, alive: false, lastHurt: 0, lastShot: 0,
          state: null, ping: 0, pingSent: 0, respawnAt: 0,
        };
        this.players.set(p.id, p);
        this.send(p, { t: 'welcome', id: p.id, admin: p.admin });
        this.feed(`${p.name} joined`);
        if (this.phase === 'playing') this.spawn(p);
        this.pushLobby();
        return;
      }
      this.onMessage(p, m);
    });
    ws.on('close', () => {
      if (!p) return;
      this.players.delete(p.id);
      this.broadcast({ t: 'left', id: p.id });
      this.feed(`${p.name} left`);
      this.pushLobby();
    });
  }

  onMessage(p, m) {
    switch (m.t) {
      case 'state': {
        if (!Array.isArray(m.p) || m.p.length !== 3 || !m.p.every(Number.isFinite)) return;
        p.state = { p: m.p, yaw: +m.yaw || 0, pitch: +m.pitch || 0, crouch: !!m.crouch, ads: !!m.ads, moving: !!m.moving };
        break;
      }
      case 'shot': {
        if (!p.alive) return;
        const now = Date.now();
        if (now - p.lastShot < SHOT_COOLDOWN_MS * 0.8) return;
        p.lastShot = now;
        if (Array.isArray(m.from) && Array.isArray(m.to)) this.broadcast({ t: 'shot', id: p.id, from: m.from, to: m.to }, p);
        break;
      }
      case 'hit': {
        if (this.phase !== 'playing' || !p.alive) return;
        const v = this.players.get(m.target);
        if (!v || !v.alive || v === p) return;
        if (this.settings.mode === 'tdm' && v.team === p.team) return;
        if (Date.now() - p.lastShot > 3000) return; // must follow a recent shot
        const head = m.part === 'head';
        const dmg = head ? 200 : (m.part === 'limb' ? 45 : 75);
        v.hp -= dmg; v.lastHurt = Date.now();
        this.send(v, { t: 'hurt', hp: Math.max(0, v.hp), from: p.id, fromPos: p.state ? p.state.p : null });
        this.send(p, { t: 'hitconfirm', kill: v.hp <= 0, head });
        if (v.hp <= 0) this.kill(p, v, head, +m.dist || 0);
        break;
      }
      case 'fall': { // fall damage reported by the player's own client
        if (this.phase !== 'playing' || !p.alive) return;
        const dmg = Math.max(0, Math.min(999, +m.dmg || 0));
        p.hp -= dmg; p.lastHurt = Date.now();
        this.send(p, { t: 'hurt', hp: Math.max(0, p.hp), from: p.id, fromPos: null });
        if (p.hp <= 0) {
          p.alive = false; p.deaths++; p.respawnAt = Date.now() + RESPAWN_MS;
          this.broadcast({ t: 'kill', killer: p.id, victim: p.id, head: false, dist: 0, fall: true, teamScore: this.teamScore });
          this.broadcast({ t: 'alive', id: p.id, alive: false });
          this.pushLobby();
        }
        break;
      }
      case 'chat': {
        const text = String(m.text || '').slice(0, 120).trim();
        if (text) this.broadcast({ t: 'chat', from: p.name, team: p.team, text });
        break;
      }
      case 'admin': if (p.admin) this.onAdmin(p, m); break;
    }
  }

  onAdmin(p, m) {
    switch (m.cmd) {
      case 'settings': {
        const s = m.settings || {};
        if (this.phase === 'playing') return;
        if (s.mode === 'tdm' || s.mode === 'ffa') {
          if (s.mode !== this.settings.mode) {
            this.settings.mode = s.mode;
            for (const q of this.players.values()) q.team = s.mode === 'tdm' ? this.smallerTeam() : 'F';
            if (s.mode === 'tdm') this.rebalance();
          }
        }
        if (Number.isFinite(s.scoreLimit)) this.settings.scoreLimit = Math.max(5, Math.min(100, s.scoreLimit | 0));
        if (Number.isFinite(s.timeLimit)) this.settings.timeLimit = Math.max(2, Math.min(30, s.timeLimit | 0));
        this.pushLobby();
        break;
      }
      case 'team': {
        const q = this.players.get(m.id);
        if (q && this.settings.mode === 'tdm' && (m.team === 'A' || m.team === 'B')) { q.team = m.team; this.pushLobby(); }
        break;
      }
      case 'kick': {
        const q = this.players.get(m.id);
        if (q && !q.admin) { this.send(q, { t: 'kicked' }); this.feed(`${q.name} was kicked`); setTimeout(() => q.ws.close(), 100); }
        break;
      }
      case 'start': this.startMatch(); break;
      case 'end': if (this.phase === 'playing') this.endMatch(); break;
      case 'lobby': this.phase = 'lobby'; this.pushLobby(); break;
    }
  }

  rebalance() {
    const list = [...this.players.values()];
    list.forEach((q, i) => { q.team = i % 2 ? 'B' : 'A'; });
  }

  // ---------- match flow ----------
  startMatch() {
    this.phase = 'playing';
    this.settings.seed = (Math.random() * 1e9) | 0;
    this.teamScore = { A: 0, B: 0 };
    this.endsAt = Date.now() + this.settings.timeLimit * 60000;
    for (const q of this.players.values()) {
      q.kills = q.deaths = q.score = 0;
      if (this.settings.mode === 'ffa') q.team = 'F';
      else if (q.team !== 'A' && q.team !== 'B') q.team = this.smallerTeam();
    }
    this.broadcast({ t: 'start', settings: this.settings, endsAt: this.endsAt, now: Date.now() });
    for (const q of this.players.values()) this.spawn(q);
    this.pushLobby();
  }

  endMatch() {
    this.phase = 'ended';
    let winner;
    const players = [...this.players.values()];
    if (this.settings.mode === 'tdm') {
      winner = this.teamScore.A === this.teamScore.B ? 'draw' : (this.teamScore.A > this.teamScore.B ? 'A' : 'B');
    } else {
      const best = players.sort((a, b) => b.score - a.score)[0];
      winner = best ? best.id : null;
    }
    this.broadcast({ t: 'end', winner });
    this.pushLobby();
  }

  spawn(p) {
    p.hp = 100; p.alive = true; p.respawnAt = 0;
    // the client resolves this number into a rooftop of its team's side
    this.send(p, { t: 'spawn', spawn: (Math.random() * 1e6) | 0, team: p.team, seed: this.settings.seed });
    this.broadcast({ t: 'alive', id: p.id, alive: true });
  }

  kill(killer, victim, head, dist) {
    victim.alive = false; victim.deaths++; victim.respawnAt = Date.now() + RESPAWN_MS;
    killer.kills++; killer.score += 100 + (head ? 50 : 0) + Math.floor(dist / 10) * 5;
    if (this.settings.mode === 'tdm') this.teamScore[killer.team]++;
    this.broadcast({ t: 'kill', killer: killer.id, victim: victim.id, head, dist: Math.round(dist), teamScore: this.teamScore });
    this.broadcast({ t: 'alive', id: victim.id, alive: false });
    this.pushLobby();
    const lim = this.settings.scoreLimit;
    if (this.settings.mode === 'tdm' ? this.teamScore[killer.team] >= lim : killer.kills >= lim) this.endMatch();
  }

  tick() {
    const now = Date.now();
    if (this.phase === 'playing') {
      if (now >= this.endsAt) this.endMatch();
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnAt && now >= p.respawnAt) this.spawn(p);
        if (p.alive && p.hp < 100 && now - p.lastHurt > 5000) {
          p.hp = Math.min(100, p.hp + 10 * TICK_MS / 1000);
          if (Math.round(p.hp) % 10 === 0) this.send(p, { t: 'heal', hp: p.hp });
        }
      }
    }
    // snapshots
    const snap = [];
    for (const p of this.players.values()) {
      if (p.state) snap.push({ id: p.id, ...p.state, alive: p.alive, team: p.team, name: p.name });
    }
    if (snap.length) this.broadcast({ t: 'snap', players: snap });
    // ping every ~2s
    if ((now / TICK_MS | 0) % 40 === 0) {
      for (const p of this.players.values()) {
        if (!p.ws.isAlive) { p.ws.terminate(); continue; }
        p.ws.isAlive = false; p.pingSent = now; try { p.ws.ping(); } catch (e) {}
      }
    }
  }
}

module.exports = { GameServer, PROTOCOL, localIPs };

if (require.main === module) {
  const port = +process.argv[2] || 27015;
  const s = new GameServer({ port });
  s.start().then(info => {
    console.log(`Last Sniper dedicated server on port ${info.port}`);
    console.log(`Addresses: ${info.ips.join(', ') || 'localhost'}`);
    console.log(`Admin token: ${info.adminToken}`);
  });
}
