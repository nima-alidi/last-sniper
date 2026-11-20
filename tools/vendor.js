// Copies the Three.js addons the game uses into src/vendor/addons.
// electron-builder drops every node_modules/*/examples folder, so the addons must live in src/.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const from = path.join(root, 'node_modules', 'three', 'examples', 'jsm');
const to = path.join(root, 'src', 'vendor', 'addons');
const dirs = ['postprocessing', 'shaders', 'math', 'utils'];
const files = ['loaders/RGBELoader.js', 'loaders/GLTFLoader.js'];

fs.rmSync(to, { recursive: true, force: true });
for (const d of dirs) fs.cpSync(path.join(from, d), path.join(to, d), { recursive: true });
for (const f of files) { fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true }); fs.copyFileSync(path.join(from, f), path.join(to, f)); }
console.log('vendored three addons ->', path.relative(root, to));
