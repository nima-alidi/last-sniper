// HUD: DOM widgets + 2D overlay canvas (scope, markers, indicators).
import { clamp, TAU, settings } from './ctx.js';

const $ = id => document.getElementById(id);
const cv = $('overlay'), g = cv.getContext('2d');
let W = innerWidth, H = innerHeight, DPR = 1;
function resize() { W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2); cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; g.setTransform(DPR, 0, 0, DPR, 0, 0); }
addEventListener('resize', resize); resize();

// ---------- compass ----------
const strip = $('compass-strip');
const PX = 3; // px per degree
(function buildCompass() {
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  let html = '';
  for (let d = -360; d <= 720; d += 15) {
    const n = ((d % 360) + 360) % 360;
    const lab = names[n];
    html += lab ? `<span class="c" style="left:${(d + 360) * PX}px">${lab}</span>` : `<span style="left:${(d + 360) * PX}px">${n}</span>`;
    html += `<span class="t" style="left:${(d + 367.5) * PX}px">|</span>`;
  }
  strip.innerHTML = html + '<div id="compass-marks"></div>';
})();
const marks = document.getElementById('compass-marks');
export const headingOf = yaw => ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
export function compass(yaw, markers = []) {
  const h = headingOf(yaw);
  strip.style.transform = `translateX(${230 - (h + 360) * PX}px)`;
  let html = '';
  for (const m of markers) {
    let d = m.heading; if (d - h > 180) d -= 360; if (h - d > 180) d += 360;
    html += `<span class="e" style="left:${(d + 360) * PX}px;color:${m.color || '#e2483d'}">▼</span>`;
  }
  marks.innerHTML = html;
}

// ---------- DOM widgets ----------
export function show(v) { $('hud').classList.toggle('hidden', !v); if (!v) scoreboard(null); }
export function health(hp) { const f = $('hp-fill'); f.style.width = clamp(hp, 0, 100) + '%'; f.classList.toggle('low', hp < 35); }
let lastAmmoKey = '';
export function ammo(mag, res, state, magSize = 5) {
  const key = `${mag}|${res}|${state}`;
  if (key === lastAmmoKey) return; // avoid touching the DOM every frame
  lastAmmoKey = key;
  $('ammo-mag').textContent = mag; $('ammo-res').textContent = '/ ' + res; $('ammo-state').textContent = state || '';
  $('ammo-rounds').innerHTML = Array.from({ length: magSize }, (_, i) => `<i class="${i < mag ? '' : 'spent'}"></i>`).join('');
  $('mag-count').innerHTML = `MAGAZINES <b>×${Math.ceil(res / magSize)}</b>`;
}
// story mode widgets
export function storyCard(photo, name) {
  const c = $('target-card');
  if (!photo) { c.classList.add('hidden'); return; }
  $('tc-photo').src = photo; $('tc-name').textContent = name; c.classList.remove('hidden');
}
export function objective(text) { const e = $('objective'); e.textContent = text; e.classList.toggle('hidden', !text); }
export function civCount(n, max) { const e = $('civ-count'); if (n === null || n === undefined) { e.classList.add('hidden'); return; } e.classList.remove('hidden'); e.textContent = `CIVILIAN CASUALTIES ${n} / ${max}`; e.classList.toggle('warn', n > 0); }
export function kills(n) { const e = $('kills-count'); if (e.textContent !== String(n)) e.textContent = n; }
export function zero(m) { $('zero-info').textContent = `ZERO ${m} m`; }
let msgT = 0, banT = 0;
export function message(text, sec = 2.5) { const e = $('center-msg'); e.textContent = text; e.style.opacity = 1; msgT = sec; }
export function banner(text, pts) { const e = $('kill-banner'); e.innerHTML = `${text}${pts ? `<span class="pts">+${pts}</span>` : ''}`; e.style.opacity = 1; banT = 1.8; }
export function feed(html) {
  const kf = $('killfeed'); const d = document.createElement('div'); d.innerHTML = html; kf.prepend(d);
  while (kf.children.length > 6) kf.lastChild.remove();
  setTimeout(() => d.remove(), 7000);
}
export function chatLine(html) {
  const c = $('chat-hud'); const d = document.createElement('div'); d.innerHTML = html; c.append(d);
  while (c.children.length > 6) c.firstChild.remove();
  setTimeout(() => d.remove(), 9000);
}
export function matchInfo(info) {
  const e = $('match-info');
  if (!info) { e.classList.add('hidden'); return; }
  e.classList.remove('hidden');
  $('mi-a').textContent = info.a ?? ''; $('mi-b').textContent = info.b ?? ''; $('mi-time').textContent = info.time ?? '';
}
export function death(on, by = '', timer = '') {
  $('death').classList.toggle('hidden', !on);
  if (on) { $('death-by').innerHTML = by; $('death-timer').textContent = timer; }
}
export function scoreboard(html) { const e = $('scoreboard'); if (!html) { e.classList.add('hidden'); return; } e.innerHTML = html; e.classList.remove('hidden'); }
export function fps(v) { $('fps').textContent = settings.showFps ? v + ' FPS' : ''; }
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function tickDom(dt) {
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('center-msg').style.opacity = 0; }
  if (banT > 0) { banT -= dt; if (banT <= 0) $('kill-banner').style.opacity = 0; }
}

// ---------- minimap (bottom-left, player-up) ----------
const mm = $('minimap'), mg = mm.getContext('2d');
const MM_SIZE = 220, MM_RANGE = 260; // metres from centre to edge
function mmResize() { const d = Math.min(devicePixelRatio || 1, 2); mm.width = MM_SIZE * d; mm.height = MM_SIZE * d; mg.setTransform(d, 0, 0, d, 0, 0); }
mmResize(); addEventListener('resize', mmResize);
// s: {x, z, yaw, t, footprints:[{x,z,w,d,h}], markers:[{x,z,kind:'warn'|'enemy'|'aim'|'friend'|'shot'}]}
export function drawMinimap(s) {
  const S = MM_SIZE, c = S / 2, k = (S / 2 - 8) / MM_RANGE;
  mg.clearRect(0, 0, S, S);
  if (!s) return;
  const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
  // world (dx,dz) -> screen, forward is up: right = (cos yaw, -sin yaw), forward = (-sin yaw, -cos yaw)
  const toS = (x, z) => { const dx = x - s.x, dz = z - s.z; return [c + (dx * cy - dz * sy) * k, c + (dx * sy + dz * cy) * k]; };
  mg.save();
  mg.beginPath(); mg.arc(c, c, S / 2 - 2, 0, TAU); mg.clip();
  // range rings
  mg.strokeStyle = 'rgba(255,255,255,.07)'; mg.lineWidth = 1;
  for (const r of [100, 200]) { mg.beginPath(); mg.arc(c, c, r * k, 0, TAU); mg.stroke(); }
  // buildings (rotated rectangles)
  for (const f of s.footprints) {
    if (Math.abs(f.x - s.x) > MM_RANGE + 40 || Math.abs(f.z - s.z) > MM_RANGE + 40) continue;
    const pts = [[-f.w / 2, -f.d / 2], [f.w / 2, -f.d / 2], [f.w / 2, f.d / 2], [-f.w / 2, f.d / 2]].map(([a, b]) => toS(f.x + a, f.z + b));
    const shade = Math.round(55 + Math.min(1, f.h / 90) * 60);
    mg.fillStyle = `rgba(${shade},${shade + 6},${shade + 14},.85)`;
    mg.beginPath(); pts.forEach(([x, y], i) => (i ? mg.lineTo(x, y) : mg.moveTo(x, y))); mg.closePath(); mg.fill();
  }
  // view cone
  const g2r = mg.createRadialGradient(c, c, 0, c, c, S / 2);
  g2r.addColorStop(0, 'rgba(255,255,255,.22)'); g2r.addColorStop(1, 'rgba(255,255,255,0)');
  mg.fillStyle = g2r; mg.beginPath(); mg.moveTo(c, c); mg.arc(c, c, S / 2, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); mg.closePath(); mg.fill();
  // markers
  for (const m of s.markers) {
    let [x, y] = toS(m.x, m.z);
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy), max = S / 2 - 10;
    const clamped = d > max; if (clamped) { x = c + dx / d * max; y = c + dy / d * max; }
    const pulse = 0.5 + 0.5 * Math.sin(s.t * (m.kind === 'aim' ? 14 : 6));
    if (m.kind === 'zone') {                       // approximate target area (story mode)
      mg.save(); mg.strokeStyle = `rgba(255,209,102,${0.55 + pulse * 0.35})`; mg.lineWidth = 2; mg.setLineDash([6, 5]);
      mg.beginPath(); mg.arc(x, y, Math.max(8, m.r * k), 0, TAU); mg.stroke(); mg.setLineDash([]);
      mg.fillStyle = 'rgba(255,209,102,.13)'; mg.fill();
      mg.fillStyle = '#ffd166'; mg.font = 'bold 16px Bahnschrift, Segoe UI'; mg.textAlign = 'center'; mg.fillText('?', x, y + 6); mg.restore();
      continue;
    }
    if (m.kind === 'friend') { mg.fillStyle = '#4aa3ff'; mg.beginPath(); mg.arc(x, y, 4, 0, TAU); mg.fill(); continue; }
    if (m.kind === 'warn') {
      mg.strokeStyle = `rgba(255,140,40,${0.5 + pulse * 0.5})`; mg.lineWidth = 2;
      mg.beginPath(); mg.arc(x, y, 6 + pulse * 7, 0, TAU); mg.stroke();
      mg.fillStyle = '#ff8a3a'; mg.font = 'bold 13px Bahnschrift, Segoe UI'; mg.textAlign = 'center'; mg.fillText('!', x, y + 5);
      continue;
    }
    if (m.kind === 'wounded') { // dark red dot with a white cross
      mg.fillStyle = '#9a0f12'; mg.beginPath(); mg.arc(x, y, 6, 0, TAU); mg.fill();
      mg.strokeStyle = '#fff'; mg.lineWidth = 1.8; mg.beginPath(); mg.moveTo(x - 3, y); mg.lineTo(x + 3, y); mg.moveTo(x, y - 3); mg.lineTo(x, y + 3); mg.stroke();
      continue;
    }
    const r = m.kind === 'aim' ? 5 + pulse * 3 : 5;
    mg.fillStyle = m.kind === 'aim' ? '#ff2a2a' : m.kind === 'shot' ? `rgba(255,60,40,${0.4 + pulse * 0.6})` : '#ff6a3a';
    mg.shadowColor = '#f00'; mg.shadowBlur = m.kind === 'aim' ? 10 : 4;
    mg.beginPath(); mg.arc(x, y, r, 0, TAU); mg.fill(); mg.shadowBlur = 0;
    if (clamped) { mg.strokeStyle = '#ff6a3a'; mg.lineWidth = 1.5; mg.beginPath(); mg.arc(x, y, r + 3, 0, TAU); mg.stroke(); }
  }
  mg.restore();
  // player arrow
  mg.fillStyle = '#ffffff'; mg.strokeStyle = 'rgba(0,0,0,.6)'; mg.lineWidth = 1.5;
  mg.beginPath(); mg.moveTo(c, c - 8); mg.lineTo(c + 6, c + 6); mg.lineTo(c, c + 3); mg.lineTo(c - 6, c + 6); mg.closePath(); mg.fill(); mg.stroke();
  // north marker on the rim
  const nx = c + Math.sin(s.yaw) * (S / 2 - 12), ny = c - Math.cos(s.yaw) * (S / 2 - 12);
  mg.fillStyle = '#f6cf7a'; mg.font = 'bold 12px Bahnschrift, Segoe UI'; mg.textAlign = 'center'; mg.fillText('N', nx, ny + 4);
}

// ---------- overlay ----------
const dmgInd = [];  // {angle (world heading rad), t}
let hitT = 0, hitKill = false, hitHead = false;
export function hitMarker(kill, head) { hitT = 0.35; hitKill = kill; hitHead = head; }
export function damageFrom(worldAngle) { dmgInd.push({ a: worldAngle, t: 1.6 }); }
export function setDamageVignette(v) { $('vignette-dmg').style.opacity = clamp(v, 0, 1); }

// s: {scope, sway:{x,y}, range, zoomX, breath, winded, yaw, aimIndicators:[{bearing,p}], flare:{x,y,k}|null, moving, t, crosshair}
export function drawOverlay(dt, s) {
  g.clearRect(0, 0, W, H);
  if (!s) return;
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.47;

  // lens flare (unscoped only)
  if (s.flare && s.scope < 0.3) {
    const { x: sx, y: sy, k } = s.flare;
    g.save(); g.globalCompositeOperation = 'lighter';
    const fl = [[0, 220, '255,230,190', 0.3], [0.35, 40, '255,200,140', 0.1], [0.6, 22, '160,200,255', 0.12], [0.9, 70, '255,180,120', 0.07], [1.25, 30, '180,255,200', 0.08], [1.6, 120, '200,160,255', 0.05]];
    for (const [f, r, c, a] of fl) {
      const x = sx + (cx - sx) * f, y = sy + (cy - sy) * f;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${c},${a * k})`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.restore();
  }

  if (s.scope > 0.85) {
    const a = clamp((s.scope - 0.85) / 0.12, 0, 1);
    const ox = -s.sway.x * 4000, oy = s.sway.y * 4000 + (s.moving ? Math.sin(s.t * 9) * 8 : 0);
    g.save(); g.globalAlpha = a;
    // tube / eye relief
    g.fillStyle = '#000'; g.beginPath(); g.rect(0, 0, W, H); g.arc(cx + ox, cy + oy, R, 0, TAU, true); g.fill('evenodd');
    const gr = g.createRadialGradient(cx + ox, cy + oy, R * 0.7, cx + ox, cy + oy, R);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,.95)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx + ox, cy + oy, R, 0, TAU); g.fill();
    const lg = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R); lg.addColorStop(0, 'rgba(140,180,255,.07)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(255,200,140,.05)');
    g.fillStyle = lg; g.beginPath(); g.arc(cx + ox, cy + oy, R, 0, TAU); g.fill();
    // reticle: mil-dot, 1 mil spacing in screen space
    const mil = s.milPx;
    g.strokeStyle = 'rgba(0,0,0,.92)'; g.fillStyle = 'rgba(0,0,0,.92)';
    g.lineWidth = 1.1; g.beginPath();
    g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    g.lineWidth = 5; g.beginPath();
    g.moveTo(cx - R, cy); g.lineTo(cx - mil * 5.5, cy); g.moveTo(cx + mil * 5.5, cy); g.lineTo(cx + R, cy);
    g.moveTo(cx, cy + mil * 5.5); g.lineTo(cx, cy + R); g.moveTo(cx, cy - R); g.lineTo(cx, cy - mil * 5.5); g.stroke();
    for (let i = 1; i <= 5; i++) for (const [dx, dy] of [[i, 0], [-i, 0], [0, i], [0, -i]]) {
      g.beginPath(); g.arc(cx + dx * mil, cy + dy * mil, Math.max(1.6, mil * 0.09), 0, TAU); g.fill();
    }
    // half-mil hash marks below centre for holdover
    g.lineWidth = 1; g.beginPath();
    for (let i = 1; i <= 10; i++) { const y = cy + i * mil * 0.5; const w = i % 2 ? 3 : 6; g.moveTo(cx - w, y); g.lineTo(cx + w, y); } g.stroke();
    g.fillStyle = 'rgba(255,40,30,.95)'; g.beginPath(); g.arc(cx, cy, 1.5, 0, TAU); g.fill();
    // info
    g.font = '15px Bahnschrift, Segoe UI'; g.textAlign = 'center'; g.fillStyle = 'rgba(230,236,245,.92)';
    g.fillText(`${s.range ? Math.round(s.range) + ' m' : '--- m'}    ${s.zoomX}x    ZERO ${s.zero} m`, cx, cy + R + 26);
    // breath meter
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(cx - 70, cy + R - 30, 140, 4);
    g.fillStyle = s.winded ? '#ff6b6b' : '#a7e3ff'; g.fillRect(cx - 70, cy + R - 30, 140 * clamp(s.breath, 0, 1), 4);
    if (s.holding) { g.fillStyle = 'rgba(167,227,255,.9)'; g.font = '12px Bahnschrift, Segoe UI'; g.fillText('HOLDING BREATH', cx, cy + R - 38); }
    g.restore();
  } else if (s.crosshair) {
    g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(cx, cy, 2, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 3, 0, TAU); g.stroke();
  }

  // hit marker
  if (hitT > 0) {
    hitT -= dt;
    g.save(); g.globalAlpha = clamp(hitT * 4, 0, 1);
    g.strokeStyle = hitKill ? '#ff3b30' : '#ffffff'; g.lineWidth = hitHead ? 3.5 : 2.5;
    g.beginPath(); const r1 = 7, r2 = hitKill ? 20 : 15;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.moveTo(cx + sx * r1, cy + sy * r1); g.lineTo(cx + sx * r2, cy + sy * r2); }
    g.stroke(); g.restore();
  }

  // incoming damage direction
  const ring = Math.min(W, H) * 0.3;
  for (let i = dmgInd.length - 1; i >= 0; i--) {
    const d = dmgInd[i]; d.t -= dt; if (d.t <= 0) { dmgInd.splice(i, 1); continue; }
    const rel = d.a - s.headingRad;
    g.save(); g.translate(cx, cy); g.rotate(rel);
    g.globalAlpha = clamp(d.t, 0, 1) * 0.9;
    const gr = g.createLinearGradient(0, -ring - 30, 0, -ring + 10); gr.addColorStop(0, 'rgba(255,40,30,0)'); gr.addColorStop(1, 'rgba(255,40,30,.95)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, ring, -Math.PI / 2 - 0.35, -Math.PI / 2 + 0.35); g.arc(0, 0, ring + 26, -Math.PI / 2 + 0.28, -Math.PI / 2 - 0.28, true); g.fill();
    g.restore();
  }
  // enemy aiming at you (solo): pulsing chevrons
  for (const ind of s.aimIndicators || []) {
    const rel = ind.heading - s.headingRad, rr = Math.min(W, H) * 0.42;
    const px = cx + Math.sin(rel) * rr, py = cy - Math.cos(rel) * rr;
    const pulse = 0.55 + 0.45 * Math.abs(Math.sin(s.t * (6 + ind.p * 14)));
    g.save(); g.translate(px, py); g.rotate(rel); g.globalAlpha = pulse;
    g.fillStyle = '#ff2a2a'; g.shadowColor = '#f00'; g.shadowBlur = 12;
    const z = 13 + ind.p * 14;
    g.beginPath(); g.moveTo(0, -z); g.lineTo(z * 0.7, z * 0.6); g.lineTo(0, z * 0.2); g.lineTo(-z * 0.7, z * 0.6); g.closePath(); g.fill();
    g.restore();
  }
}
