// Assembles the single-file game: node src/build.js  →  public/index.html
// Fonts in src/fonts are inlined as data: URLs, so the page still makes no network requests.
const fs = require('fs'), path = require('path');
const d = f => path.join(__dirname, f);
const snap = fs.existsSync(d('snapshot.json')) ? fs.readFileSync(d('snapshot.json'), 'utf8').trim() : '[]';
const block = fs.readFileSync(d('block.json'), 'utf8').trim();
const FONTS = [
  ['Cardo', 400, 'normal', 'cardo-regular.woff'],
  ['Cardo', 400, 'italic', 'cardo-italic.woff'],
  ['Fira Sans', 300, 'normal', 'fira-light.woff'],
  ['Fira Sans', 400, 'normal', 'fira-regular.woff'],
  ['Fira Sans', 500, 'normal', 'fira-medium.woff']
];
const faces = '/* Cardo and Fira Sans, SIL Open Font License 1.1 (see src/fonts) */\n' + FONTS.map(([fam, w, st, file]) =>
  '@font-face{font-family:"' + fam + '";font-weight:' + w + ';font-style:' + st + ';font-display:swap;src:url(data:font/woff;base64,' +
  fs.readFileSync(d('fonts/' + file)).toString('base64') + ') format("woff")}').join('\n');
const head = fs.readFileSync(d('head.html'), 'utf8').replace('/*__FONTS__*/', faces);
const cfg = fs.readFileSync(d('config.js'), 'utf8').replace('__BLOCK__', block).replace('__SNAPSHOT__', snap);
const out = head + cfg + fs.readFileSync(d('data.js'), 'utf8') + fs.readFileSync(d('app.js'), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'public', 'index.html'), out);
console.log('public/index.html', Buffer.byteLength(out), 'bytes');
