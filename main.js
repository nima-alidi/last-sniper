'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { GameServer, localIPs } = require('./server/server');

// Serve the game from a privileged custom scheme so ES modules, fetch and workers behave like on the web.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let server = null;

// Only one copy of the game at a time (a second launch just focuses the first window).
if (!app.requestSingleInstanceLock()) { app.exit(0); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// Hard shutdown: mute immediately, stop the LAN server and exit the process so no audio or
// network socket can outlive the window.
function shutdown() {
  try { if (win && !win.isDestroyed()) win.webContents.setAudioMuted(true); } catch (e) { /* window already gone */ }
  try { if (server) server.stop(); } catch (e) { /* ignore */ }
  server = null;
  app.exit(0);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#07090d',
    title: 'Last Sniper',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('close', () => { try { win.webContents.setAudioMuted(true); } catch (e) { /* ignore */ } });
  win.on('closed', () => { win = null; shutdown(); });
  win.loadURL('app://game/src/index.html');
  if (process.env.RS_SELFTEST) {
    // automated smoke test: report load result and quit
    win.webContents.on('console-message', (_e, level, msg) => console.log(`[renderer:${level}] ${msg}`));
    setTimeout(async () => {
      try {
        const r = await win.webContents.executeJavaScript(`JSON.stringify({ready: !!(window.__rs && window.__rs.G.world), menu: !!document.querySelector('#menu.show'), shown: [...document.querySelectorAll('.screen.show')].map(s=>s.id), state: window.__rs.G.state, player: !!window.__rs.G.player, vis: document.visibilityState, load: document.getElementById('load-text').textContent, native: !!window.native})`);
        console.log('SELFTEST ' + r);
        const h = await win.webContents.executeJavaScript(`window.native.hostStart(27099).then(r => JSON.stringify({ok:r.ok, ips:r.ips, err:r.error}))`);
        console.log('HOSTTEST ' + h);
      } catch (e) { console.log('SELFTEST ERROR ' + e.message); }
      app.quit();
    }, Number(process.env.RS_SELFTEST) || 20000);
  }
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
}

app.whenReady().then(() => {
  const root = __dirname;
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});

app.on('window-all-closed', shutdown);
app.on('before-quit', () => { try { if (server) server.stop(); } catch (e) { /* ignore */ } });

ipcMain.handle('host:start', async (_e, { port }) => {
  if (server) { server.stop(); server = null; }
  const s = new GameServer({ port: Number(port) || 27015 });
  try {
    const info = await s.start();
    server = s;
    return { ok: true, ...info };
  } catch (err) {
    return { ok: false, error: err.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : String(err.message || err) };
  }
});
ipcMain.handle('host:stop', () => { if (server) { server.stop(); server = null; } return true; });
ipcMain.handle('net:ips', () => localIPs());
ipcMain.handle('app:quit', () => shutdown());
ipcMain.handle('app:fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
