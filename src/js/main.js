// Bootstrap, game loop and menu/screen flow.
import { renderer, scene, camera, applyQuality, loadSky, useFallbackSky, render } from './engine.js';
import { G, settings, saveSettings, TAU } from './ctx.js';
import { loadAssets } from './assets.js';
import { buildWorld } from './world.js';
import { setupAmbient, updateEffects, clearAmbient } from './effects.js';
import { Player } from './player.js';
import * as hud from './hud.js';
import { audio, sfx, startWind, setVolume, loadSamples } from './audio.js';
import { loadCharacters } from './soldier.js';
import { loadPeople } from './people.js';
import { CONTRACTS, loadProgress } from './missions.js';
import { prepareStory, beginStory, stopStory, updateStory, storyPhase, storyActive, storyCompass, storyMinimap, storyIndicators, storyScoreboard, storyKills } from './story.js';
import { startSolo, stopSolo, updateSolo, soloIndicators, soloCompass, soloScoreboard, soloMinimap, summary } from './solo.js';
import { net, connect, disconnect, updateNet, sendHit, sendShot, sendFall, admin, chat, compassMarkers, scoreboardHtml, minimapMarkers } from './net.js';

G.scene = scene;
const $ = id => document.getElementById(id);
const SOLO_SEED = 20251;
let currentSeed = null, hosting = null, serverOffset = 0, backTo = 'menu', deathT = 0, wasLocked = false;
const isApp = !!(window.native && window.native.isApp);

function screen(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === id); }
function setLoad(p, text) { $('load-fill').style.width = (p * 100).toFixed(0) + '%'; $('load-text').textContent = text; }
// yield so the loading screen can repaint (setTimeout keeps working even if the window is hidden/occluded)
const frame = () => new Promise(r => setTimeout(r, 30));

function ensureWorld(seed, story = false) {
  const key = seed + (story ? 's' : '');
  if (currentSeed === key && G.world) return;
  if (G.world) { G.world.dispose(); clearAmbient(); }
  G.world = buildWorld(seed, { story });
  setupAmbient(G.world.ambient);
  currentSeed = key;
  renderer.compile(scene, camera);
}

async function boot() {
  applyQuality();
  setLoad(0.02, 'LOADING TEXTURES');
  await loadAssets(p => setLoad(0.05 + p * 0.6, 'LOADING TEXTURES'));
  setLoad(0.66, 'LOADING CHARACTERS & AUDIO');
  await Promise.all([loadCharacters(), loadSamples(), loadPeople()]);
  setLoad(0.7, 'LOADING SKY');
  try { await loadSky('../assets/hdri/sky.hdr'); } catch (e) { console.warn('sky failed', e); useFallbackSky(); }
  setLoad(0.85, 'BUILDING CITY'); await frame();
  ensureWorld(SOLO_SEED);
  G.player = new Player();
  G.player.roof = G.world.spawns.find(s => s.tower);
  setLoad(1, 'READY'); await frame();
  screen('menu');
  requestAnimationFrame(loop);
}

// ================= game loop =================
let last = performance.now(), fpsN = 0, fpsT = 0, menuT = 0;
function loop(now) {
  const realDt = Math.min(0.05, (now - last) / 1000); last = now;
  G.realDt = realDt;
  const dt = realDt * (G.timeScale || 1);               // slow motion during the bullet camera
  G.time += dt;
  const p = G.player;
  const briefing = G.mode === 'story' && storyPhase() === 'brief';
  const inGame = !!G.mode && !briefing;
  if (briefing) updateStory(dt);                         // the crowd keeps walking behind the dossier
  if (inGame) {
    if (!((G.mode === 'solo' || G.mode === 'story') && G.state === 'paused')) {
      if (p.roof) p.update(dt);
      if (G.mode === 'solo' && (G.state === 'play' || G.state === 'dead')) updateSolo(dt);
      if (G.mode === 'story' && (G.state === 'play' || G.state === 'dead')) updateStory(dt);
    }
    if (G.mode === 'mp') { updateNet(dt); updateMpHud(dt); }
    if (G.mode === 'solo') hud.kills(summary().kills);
    else if (G.mode === 'story') hud.kills(storyKills());
    else { const me = net.lobby && net.lobby.players.find(q => q.id === net.id); hud.kills(me ? me.kills : 0); }
    hud.compass(p.yaw, G.mode === 'solo' ? soloCompass() : G.mode === 'story' ? storyCompass() : compassMarkers());
    if (p.roof) hud.drawMinimap({ x: p.x, z: p.z, yaw: p.yaw, t: G.time, footprints: G.world.footprints, markers: G.mode === 'solo' ? soloMinimap() : G.mode === 'story' ? storyMinimap() : minimapMarkers() });
    // click-to-enter hint when pointer is not locked
    if (G.state === 'play' && !p.locked && !document.querySelector('.screen.show')) hud.message('CLICK TO DEPLOY', 0.2);
  } else {
    // cinematic orbit behind the menu
    menuT += dt * 0.025;
    camera.position.set(Math.sin(menuT) * 18, 74, Math.cos(menuT) * 18);
    camera.rotation.set(-0.12, menuT + Math.PI * 0.15, 0);
    if (camera.fov !== settings.fov) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
    p && p.weapon.setVisible(false);
  }
  updateEffects(dt, G.time, camera.position, p && p.scope > 0.5);
  render(realDt);
  let os = null;
  if (inGame && p.roof && G.state !== 'ended') { os = p.overlayState(G.time); os.aimIndicators = G.mode === 'solo' ? soloIndicators() : G.mode === 'story' ? storyIndicators() : []; }
  hud.drawOverlay(realDt, os);
  hud.tickDom(realDt);
  fpsN++; fpsT += realDt; if (fpsT >= 0.5) { hud.fps(Math.round(fpsN / fpsT)); fpsN = 0; fpsT = 0; }
  requestAnimationFrame(loop);
}

// ================= pointer lock / pause =================
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && wasLocked && G.mode && G.state === 'play') openPause();
  wasLocked = locked;
});
renderer.domElement.addEventListener('click', () => { if (G.mode && (G.state === 'play' || G.state === 'dead') && !G.player.locked) G.player.lock(); });
function openPause() {
  G.state = 'paused'; G.player.ads = false;
  $('p-admin-end').classList.toggle('hidden', !(G.mode === 'mp' && net.admin));
  screen('pause');
}
function resume() { screen(null); G.state = G.player.alive ? 'play' : 'dead'; G.player.lock(); }

addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.code === 'Tab' && G.mode) {
    e.preventDefault();
    hud.scoreboard(G.mode === 'solo' ? soloScoreboard() : G.mode === 'story' ? storyScoreboard() : scoreboardHtml());
  }
  if (e.code === 'Enter' && G.mode === 'mp' && G.state !== 'menu') {
    const inp = $('chat-hud-in'); inp.classList.remove('hidden'); inp.value = ''; inp.focus();
    for (const k in G.player.keys) G.player.keys[k] = false;
  }
});
addEventListener('keyup', e => { if (e.code === 'Tab') hud.scoreboard(null); });
$('chat-hud-in').addEventListener('keydown', e => {
  if (e.code === 'Enter') { const v = e.target.value.trim(); if (v) chat(v); e.target.value = ''; e.target.blur(); e.target.classList.add('hidden'); }
  if (e.code === 'Escape') { e.target.blur(); e.target.classList.add('hidden'); }
  e.stopPropagation();
});

// ================= enter / leave game =================
function enterGame() {
  audio(); startWind();
  screen(null); hud.show(true); hud.death(false);
  G.player.enabled = true;
  G.player.lock();
}
function leaveToMenu(note) {
  stopSolo(); stopStory();
  if (net.connected || net.ws) disconnect();
  if (hosting && isApp) window.native.hostStop();
  hosting = null;
  G.mode = null; G.state = 'menu';
  G.player.enabled = false; G.player.reset(); G.player.roof = G.world.spawns.find(s => s.tower);
  hud.show(false); hud.death(false); hud.matchInfo(null);
  if (document.pointerLockElement) document.exitPointerLock();
  ensureWorld(SOLO_SEED);
  screen('menu');
  if (note) setTimeout(() => alertMenu(note), 50);
}
function alertMenu(text) { hud.message(text, 4); const e = $('center-msg'); e.style.zIndex = 20; setTimeout(() => (e.style.zIndex = ''), 4000); }

// ---------- solo ----------
function startSoloGame() {
  ensureWorld(SOLO_SEED);
  G.mode = 'solo'; G.state = 'play';
  startSolo(res => {
    G.state = 'ended'; if (document.pointerLockElement) document.exitPointerLock();
    hud.death(false);
    $('end-title').textContent = 'MISSION FAILED'; $('end-title').className = 'lose';
    $('end-sub').textContent = `ENEMIES ELIMINATED: ${res.kills}  ·  LONGEST SHOT ${res.longest} m`;
    $('end-board').innerHTML = soloScoreboard();
    $('end-again').textContent = 'RETRY';
    screen('endscreen');
  });
  G.player.enabled = true;
  enterGame();
}

// ---------- story ----------
let lastStory = null;
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
function buildContractList() {
  const prog = loadProgress(), box = $('contracts'); box.innerHTML = '';
  CONTRACTS.forEach((c, i) => {
    const locked = i >= prog.unlocked, st = prog.stars[i] || 0;
    const d = document.createElement('div'); d.className = 'contract' + (locked ? ' locked' : '');
    d.innerHTML = `<div class="no">${i + 1}</div><div class="tt"><b>${c.title}</b><small>${locked ? 'LOCKED — complete the previous contract' : `Target: ${c.name} · ${c.role} · ${c.guards} guards + ${c.snipers} rooftop shooter${c.snipers > 1 ? 's' : ''}`}</small></div><div class="st">${locked ? '🔒' : stars(st)}</div>`;
    if (!locked) d.onclick = () => openContract(i);
    box.appendChild(d);
  });
}
async function openContract(idx) {
  audio();
  stopSolo(); stopStory();
  screen('loading'); setLoad(0.25, 'BUILDING THE CITY'); await frame();
  ensureWorld(CONTRACTS[idx].seed, true);
  G.mode = 'story'; G.state = 'brief'; G.player.enabled = false; hud.show(false);
  G.player.reset(); G.player.roof = G.world.spawns.find(s => s.tower);
  setLoad(0.6, 'PLACING THE CROWD'); await frame();
  let brief;
  try { brief = prepareStory(idx); } catch (e) { console.error(e); leaveToMenu('COULD NOT PREPARE THE CONTRACT'); return; }
  setLoad(1, 'READY'); await frame();
  showDossier(brief);
}
function showDossier(b) {
  const c = b.c;
  $('ds-code').textContent = `CONTRACT ${c.id} · CODENAME: ${c.codename}`; $('ds-title').textContent = c.title;
  $('ds-photo').src = b.photo; $('ds-name').textContent = c.name.toUpperCase();
  $('ds-fullname').textContent = c.name; $('ds-agesex').textContent = `${c.age} / ${b.gender}`; $('ds-role').textContent = c.role;
  $('ds-build').textContent = b.build; $('ds-clothes').textContent = b.clothes.join(', ');
  $('ds-seen').textContent = b.lastSeen; $('ds-sec').textContent = b.security; $('ds-intro').textContent = c.intro;
  $('ds-objs').innerHTML = `<li><b>PRIMARY:</b> eliminate ${c.name}. Max. 3 civilian casualties.</li>` + b.bonuses.map(x => `<li>BONUS: ${x.label}</li>`).join('');
  screen('dossier');
}
$('ds-back').onclick = () => { stopStory(); G.mode = null; G.state = 'menu'; ensureWorld(SOLO_SEED); G.player.roof = G.world.spawns.find(s => s.tower); buildContractList(); screen('story-menu'); };
$('ds-go').onclick = () => {
  G.state = 'play'; G.player.enabled = true;
  beginStory(res => {
    lastStory = res; G.state = 'ended'; if (document.pointerLockElement) document.exitPointerLock();
    hud.death(false); hud.show(false);
    $('end-title').textContent = res.success ? 'CONTRACT COMPLETE' : 'CONTRACT FAILED'; $('end-title').className = res.success ? 'win' : 'lose';
    $('end-sub').textContent = res.success ? `${res.title} — ${res.name.toUpperCase()}${res.reason ? ' · ' + res.reason : ''}` : res.reason;
    $('end-board').innerHTML = `${res.success ? `<div class="stars">${stars(res.stars)}</div>` : ''}
      ${res.bonuses.map(b => `<div class="end-bonus ${b.done ? 'done' : ''}"><span>${b.done ? '✔' : '✖'} ${b.label}</span><span>${b.done ? '+500' : ''}</span></div>`).join('')}
      <table class="board"><tr><th>SCORE</th><th>TIME</th><th>HOSTILES DOWN</th><th>CIVILIAN CASUALTIES</th>${res.targetDist ? '<th>TARGET SHOT</th>' : ''}</tr>
      <tr class="me"><td>${res.score}</td><td>${Math.floor(res.time / 60)}:${String(Math.floor(res.time % 60)).padStart(2, '0')}</td><td>${res.kills}</td><td>${res.civKills} / 3</td>${res.targetDist ? `<td>${res.targetDist} m</td>` : ''}</tr></table>`;
    $('end-again').textContent = res.success && res.idx < CONTRACTS.length - 1 ? 'NEXT CONTRACT' : 'RETRY';
    screen('endscreen');
  });
  enterGame();
};

// ---------- multiplayer ----------
G.onBulletHit = null;
function mpHooks() {
  G.onBulletHit = (owner, part, dist) => sendHit(owner, part, dist);
  G.onPlayerShot = (from, to) => sendShot(from, to);
  G.onPlayerDeath = () => {};
  G.onFall = dmg => sendFall(dmg);
}
net.on('lobby', L => {
  serverOffset = L.now - Date.now();
  renderLobby(L);
  hud.matchInfo(G.mode === 'mp' ? mpInfo() : null);
});
net.on('start', m => {
  ensureWorld(m.settings.seed);
  G.mode = 'mp'; mpHooks();
  G.player.reset(); G.player.localHealth = false;
  hud.feed('<span style="color:var(--accent2)">MATCH STARTED</span>');
});
net.on('spawn', m => {
  ensureWorld(m.seed);
  if (G.mode !== 'mp') { G.mode = 'mp'; mpHooks(); G.player.reset(); G.player.localHealth = false; }
  let all = G.world.spawns.filter(s => !s.tower && Math.hypot(s.x, s.z) < 180);
  if (all.length < 6) all = G.world.spawns;
  let list = m.team === 'A' || m.team === 'B' ? all.filter(s => s.side === m.team) : all;
  if (!list.length) list = all;
  const roof = list[m.spawn % list.length];
  G.player.spawnAt(roof); G.player.reserve = 30;
  G.state = 'play';
  if (!document.querySelector('#pause.show')) enterGame();
  hud.death(false);
});
net.on('died', d => {
  G.state = 'dead'; deathT = 4;
  hud.death(true, d.by === 'A FALL' ? 'YOU FELL' : `KILLED BY <b>${d.by}</b>${d.head ? ' — HEADSHOT' : ''} · ${d.dist} m`, 'RESPAWNING IN 4');
});
net.on('end', m => {
  G.state = 'ended'; if (document.pointerLockElement) document.exitPointerLock();
  hud.death(false);
  const L = net.lobby, me = L && L.players.find(p => p.id === net.id);
  let win;
  if (m.winner === 'draw') win = null;
  else if (L && L.settings.mode === 'tdm') win = me && me.team === m.winner;
  else win = m.winner === net.id;
  $('end-title').textContent = win === null ? 'DRAW' : win ? 'VICTORY' : 'DEFEAT';
  $('end-title').className = win === null ? '' : win ? 'win' : 'lose';
  $('end-sub').textContent = L && L.settings.mode === 'tdm' ? `BLUE ${L.teamScore.A}  —  ${L.teamScore.B} RED` : 'FREE FOR ALL';
  $('end-board').innerHTML = scoreboardHtml();
  $('end-again').textContent = 'BACK TO LOBBY';
  setTimeout(() => screen('endscreen'), 1200);
});
net.on('chat', m => {
  const col = m.team === 'A' ? 'var(--teamA)' : m.team === 'B' ? 'var(--teamB)' : 'var(--accent2)';
  const line = `<b style="color:${col}">${hud.esc(m.from)}:</b> ${hud.esc(m.text)}`;
  hud.chatLine(line); addChat(line);
});
net.on('sys', text => addChat(`<span class="sys">${hud.esc(text)}</span>`));
net.on('kicked', () => leaveToMenu('YOU WERE KICKED BY THE HOST'));
net.on('disconnected', () => { if (G.state !== 'menu' || document.querySelector('#lobby.show')) leaveToMenu('DISCONNECTED FROM SERVER'); });

function mpInfo() {
  const L = net.lobby; if (!L || L.phase !== 'playing') return null;
  const left = Math.max(0, L.endsAt - (Date.now() + serverOffset));
  const mm = Math.floor(left / 60000), ss = Math.floor(left / 1000) % 60;
  const time = `${mm}:${String(ss).padStart(2, '0')}`;
  if (L.settings.mode === 'tdm') return { a: L.teamScore.A, b: L.teamScore.B, time };
  const me = L.players.find(p => p.id === net.id);
  const best = Math.max(0, ...L.players.map(p => p.kills));
  return { a: me ? me.kills : 0, b: best, time };
}
function updateMpHud(dt) {
  hud.matchInfo(mpInfo());
  if (G.state === 'dead' && deathT > 0) { deathT -= dt; $('death-timer').textContent = `RESPAWNING IN ${Math.max(1, Math.ceil(deathT))}`; }
}
function addChat(html) { const l = $('chat-log'); const d = document.createElement('div'); d.innerHTML = html; l.append(d); l.scrollTop = l.scrollHeight; }

function renderLobby(L) {
  const modeName = L.settings.mode === 'tdm' ? 'TEAM DEATHMATCH' : 'FREE FOR ALL';
  $('lobby-mode').textContent = `${modeName} · ${L.settings.scoreLimit} ${L.settings.mode === 'tdm' ? 'KILLS' : 'KILLS'} · ${L.settings.timeLimit} MIN${L.phase === 'playing' ? ' · IN PROGRESS' : ''}`;
  const pl = p => `<div class="pl"><span class="nm ${p.id === net.id ? 'me' : ''}">${hud.esc(p.name)}</span>${p.admin ? '<span class="tag">HOST</span>' : ''}
    ${net.admin && L.settings.mode === 'tdm' ? `<button data-team="${p.id}" data-to="${p.team === 'A' ? 'B' : 'A'}">SWAP</button>` : ''}
    ${net.admin && !p.admin ? `<button data-kick="${p.id}">KICK</button>` : ''}</div>`;
  if (L.settings.mode === 'tdm') {
    $('lobby-teams').innerHTML = `<div class="team A"><h3>BLUE TEAM</h3>${L.players.filter(p => p.team === 'A').map(pl).join('')}</div>
      <div class="team B"><h3>RED TEAM</h3>${L.players.filter(p => p.team === 'B').map(pl).join('')}</div>`;
  } else $('lobby-teams').innerHTML = `<div class="team F"><h3>PLAYERS (${L.players.length})</h3>${L.players.map(pl).join('')}</div>`;
  $('lobby-admin').classList.toggle('hidden', !net.admin);
  $('lobby-start').classList.toggle('hidden', !net.admin);
  $('lobby-wait').classList.toggle('hidden', net.admin);
  $('lobby-start').textContent = L.phase === 'playing' ? 'MATCH RUNNING' : 'START MATCH';
  $('lobby-start').disabled = L.phase === 'playing';
  if (net.admin && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
    $('lb-mode').value = L.settings.mode; $('lb-score').value = L.settings.scoreLimit; $('lb-time').value = L.settings.timeLimit;
  }
  if (!net.admin && L.phase === 'playing' && G.mode !== 'mp') $('lobby-wait').textContent = 'Match in progress — you will join in a moment…';
}
$('lobby-teams').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.kick) admin('kick', { id: +b.dataset.kick });
  if (b.dataset.team) admin('team', { id: +b.dataset.team, team: b.dataset.to });
});
for (const id of ['lb-mode', 'lb-score', 'lb-time']) $(id).addEventListener('change', () => admin('settings', { settings: { mode: $('lb-mode').value, scoreLimit: +$('lb-score').value, timeLimit: +$('lb-time').value } }));
$('lobby-start').onclick = () => admin('start');
$('lobby-leave').onclick = () => leaveToMenu();
$('chat-in').addEventListener('keydown', e => { if (e.code === 'Enter' && e.target.value.trim()) { chat(e.target.value.trim()); e.target.value = ''; } e.stopPropagation(); });

async function hostGame() {
  $('host-err').textContent = '';
  if (!isApp) { $('host-err').textContent = 'Hosting is only available in the desktop app.'; return; }
  const name = $('host-name').value.trim() || settings.name; settings.name = name; saveSettings();
  const port = +$('host-port').value || 27015;
  $('host-go').disabled = true;
  try {
    const res = await window.native.hostStart(port);
    if (!res.ok) throw new Error(res.error);
    hosting = res;
    await connect('127.0.0.1', port, name, res.adminToken);
    admin('settings', { settings: { mode: $('host-mode').value, scoreLimit: +$('host-score').value, timeLimit: +$('host-time').value } });
    $('lobby-address').innerHTML = `<small>SHARE THIS ADDRESS WITH YOUR FRIENDS</small>${(res.ips.length ? res.ips : ['127.0.0.1']).map(ip => `${ip}:${res.port}`).join(' &nbsp;·&nbsp; ')}`;
    $('lobby-address').classList.remove('hidden');
    $('chat-log').innerHTML = '';
    screen('lobby');
  } catch (err) {
    $('host-err').textContent = err.message || String(err);
    if (isApp) window.native.hostStop(); hosting = null;
  } finally { $('host-go').disabled = false; }
}
async function joinGame() {
  $('join-err').textContent = '';
  const name = $('join-name').value.trim() || settings.name; settings.name = name;
  const ip = $('join-ip').value.trim(), port = +$('join-port').value || 27015;
  if (!ip) { $('join-err').textContent = 'Enter the host address.'; return; }
  settings.lastIp = ip; settings.port = port; saveSettings();
  $('join-go').disabled = true;
  try {
    await connect(ip, port, name);
    $('lobby-address').classList.add('hidden');
    $('chat-log').innerHTML = '';
    screen('lobby');
  } catch (err) { $('join-err').textContent = err.message || String(err); }
  finally { $('join-go').disabled = false; }
}
$('host-go').onclick = hostGame;
$('join-go').onclick = joinGame;

// ================= menus =================
document.querySelectorAll('.menu-list button').forEach(b => b.addEventListener('mouseenter', () => { audio(); sfx.ui(); }));
document.querySelector('.menu-list').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  audio();
  const go = b.dataset.go;
  if (go === 'story') { buildContractList(); screen('story-menu'); }
  if (go === 'solo') startSoloGame();
  if (go === 'host') { $('host-name').value = settings.name; screen('host'); }
  if (go === 'join') { $('join-name').value = settings.name; $('join-ip').value = settings.lastIp; $('join-port').value = settings.port; screen('join'); }
  if (go === 'settings') { backTo = 'menu'; openSettings(); }
  if (go === 'quit') { if (isApp) window.native.quit(); else window.close(); }
});
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { saveSettings(); screen(backTo); backTo = 'menu'; }));

function openSettings() {
  $('set-name').value = settings.name;
  $('set-sens').value = settings.sens; $('set-ssens').value = settings.scopeSens; $('set-fov').value = settings.fov; $('set-vol').value = settings.volume;
  $('set-quality').value = settings.quality; $('set-fps').checked = settings.showFps; $('set-invert').checked = settings.invert;
  syncOutputs(); screen('settings');
}
function syncOutputs() { $('o-sens').textContent = (+settings.sens).toFixed(2); $('o-ssens').textContent = (+settings.scopeSens).toFixed(2); $('o-fov').textContent = settings.fov; $('o-vol').textContent = Math.round(settings.volume * 100) + '%'; }
$('set-name').oninput = e => { settings.name = e.target.value.trim().slice(0, 16) || settings.name; };
$('set-sens').oninput = e => { settings.sens = +e.target.value; syncOutputs(); };
$('set-ssens').oninput = e => { settings.scopeSens = +e.target.value; syncOutputs(); };
$('set-fov').oninput = e => { settings.fov = +e.target.value; syncOutputs(); };
$('set-vol').oninput = e => { settings.volume = +e.target.value; setVolume(settings.volume); syncOutputs(); };
$('set-quality').onchange = e => { settings.quality = e.target.value; applyQuality(settings.quality); saveSettings(); };
$('set-fps').onchange = e => { settings.showFps = e.target.checked; };
$('set-invert').onchange = e => { settings.invert = e.target.checked; };

$('p-resume').onclick = resume;
$('p-settings').onclick = () => { backTo = 'pause'; openSettings(); };
$('p-leave').onclick = () => leaveToMenu();
$('p-admin-end').onclick = () => { admin('end'); resume(); };
$('end-menu').onclick = () => leaveToMenu();
$('end-again').onclick = () => {
  if (G.mode === 'story') { const next = lastStory && lastStory.success && lastStory.idx < CONTRACTS.length - 1 ? lastStory.idx + 1 : (lastStory ? lastStory.idx : 0); openContract(next); }
  else if (G.mode === 'solo') { screen(null); startSoloGame(); }
  else if (net.connected) { G.mode = null; G.state = 'menu'; hud.show(false); G.player.enabled = false; screen('lobby'); }
  else leaveToMenu();
};

// debug handle for automated testing
window.__rs = { G, net, settings, camera, startSoloGame, openContract };
boot().catch(err => { console.error(err); setLoad(1, 'ERROR: ' + err.message); });
