// Assembles the single-file game: node src/build.js  →  public/index.html
const fs = require('fs'), path = require('path');
const d = f => path.join(__dirname, f);
const snap = fs.existsSync(d('snapshot.json')) ? fs.readFileSync(d('snapshot.json'), 'utf8').trim() : '[]';
const block = fs.readFileSync(d('block.json'), 'utf8').trim();
const cfg = fs.readFileSync(d('config.js'), 'utf8').replace('__BLOCK__', block).replace('__SNAPSHOT__', snap);
const out = fs.readFileSync(d('head.html'), 'utf8') + cfg + fs.readFileSync(d('data.js'), 'utf8') + fs.readFileSync(d('app.js'), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'public', 'index.html'), out);
console.log('public/index.html', Buffer.byteLength(out), 'bytes');
