// App-wide parity recheck: a required string is COVERED if it appears as a literal ANYWHERE in
// apps/windows/TeslaSync.App (catches strings rendered via shared components/registrations in other dirs).
// Usage: node recheck-appwide.js <root>
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const appRoot = path.join(root, 'apps/windows/TeslaSync.App');
const units = JSON.parse(fs.readFileSync(path.join(root, 'apps/parity/parity-manifest.json'), 'utf8'));
const led = JSON.parse(fs.readFileSync(path.join(root, 'apps/parity/windows-ledger.json'), 'utf8'));
const closed = new Set(led.filter(r => r.status === 'done' || r.status === 'blocked').map(r => r.unitId));

// Build the global native string set (all .cs literals, with translation. prefix stripped).
const global = new Set();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!/\\(obj|bin)$|\/(obj|bin)$/.test(path.join(dir, e.name)) && e.name !== 'obj' && e.name !== 'bin') walk(path.join(dir, e.name)); }
    else if (e.name.endsWith('.cs')) {
      const txt = fs.readFileSync(path.join(dir, e.name), 'utf8');
      for (const m of txt.matchAll(/"((?:[^"\\]|\\.)*)"/g)) { const s = decode(m[1]); global.add(s); if (s.startsWith('translation.')) global.add(s.slice('translation.'.length)); }
    }
  }
}
function decode(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}
walk(appRoot);
console.log(`global native string literals: ${global.size}`);

// group open units by file
const byFile = {};
for (const u of units) { if (closed.has(u.id)) continue; const f = (u.sourceFiles || [])[0] || '(none)'; (byFile[f] = byFile[f] || []).push(u); }
const files = Object.entries(byFile).map(([f, us]) => ({ f, us, n: us.length })).sort((a, b) => b.n - a.n);
let nowComplete = 0, nowUnits = 0;
for (const { f, us, n } of files) {
  const sg = us.find(u => u.kind === 'string-group');
  const reqStr = sg ? (sg.strings || []) : [];
  const miss = reqStr.filter(k => !global.has(k));
  const tag = miss.length === 0 ? 'COVERED-APPWIDE' : `STILL-MISSING(${miss.length})`;
  if (miss.length === 0) { nowComplete++; nowUnits += n; }
  console.log(`${tag.padEnd(20)} ${String(n).padStart(3)}u  ${path.basename(f)}` + (miss.length ? `  miss:[${miss.slice(0, 6).join(' | ')}]` : ''));
}
console.log(`\nNewly app-wide-covered files: ${nowComplete} (${nowUnits} units)`);
