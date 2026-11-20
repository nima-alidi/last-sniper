// Minimal static server for testing the game in a browser during development.
// Usage: node tools/dev-server.js [port]   then open http://localhost:5173/src/index.html
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = +process.argv[2] || 5173;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.hdr': 'application/octet-stream' };

const shotDir = process.env.SHOT_DIR; // optional: lets test scripts save rendered frames (dev only)

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (req.method === 'POST' && p === '/__shot' && shotDir) {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const name = 'shot-' + Date.now() + '.jpg';
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, name), Buffer.from(Buffer.concat(chunks).toString(), 'base64'));
      res.writeHead(200); res.end(name);
    });
    return;
  }
  const file = path.normalize(path.join(root, p === '/' ? '/src/index.html' : p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log(`dev server ready on http://localhost:${port}/src/index.html`));
