// Copies the web app (index.html, css/, js/ from the repo root) into desktop/app/ for the desktop build, so there is
// one copy of the app to edit. `npm start` and every build run this first. tests/, tools/ and docs/ stay out.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(__dirname, 'app');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
for (const d of ['css', 'js']) fs.cpSync(path.join(root, d), path.join(out, d), { recursive: true });
let n = 0; (function count(d){ for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? count(path.join(d, e.name)) : n++; })(out);
console.log(`desktop/app <- index.html, css/, js/ (${n} files)`);
