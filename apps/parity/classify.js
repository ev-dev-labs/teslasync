// Classify open parity files as COMPLETE (verify-ready) or INCOMPLETE (needs implementation)
// by string-coverage (dotted i18n keys + GetString fallback text) and chart-count.
// Usage: node classify.js <root> [limit]
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const limit = parseInt(process.argv[3] || '15', 10);
const units = JSON.parse(fs.readFileSync(path.join(root, 'apps/parity/parity-manifest.json'), 'utf8'));
const led = JSON.parse(fs.readFileSync(path.join(root, 'apps/parity/windows-ledger.json'), 'utf8'));
const closed = new Set(led.filter(r => r.status === 'done' || r.status === 'blocked').map(r => r.unitId));
const fvRoot = path.join(root, 'apps/windows/TeslaSync.App/feature-views');

// group open units by source file
const byFile = {};
for (const u of units) { if (closed.has(u.id)) continue; const f = (u.sourceFiles || [])[0] || '(none)'; (byFile[f] = byFile[f] || []).push(u); }
const files = Object.entries(byFile).map(([f, us]) => ({ f, us, n: us.length })).sort((a, b) => b.n - a.n);

function nativeDir(srcFile) {
  const base = path.basename(srcFile, '.tsx'); // e.g. EnergyPage
  const d = path.join(fvRoot, base);
  return fs.existsSync(d) ? d : null;
}
function nativeText(dir) {
  let txt = '';
  for (const fn of fs.readdirSync(dir)) { if (fn.endsWith('.cs')) txt += fs.readFileSync(path.join(dir, fn), 'utf8') + '\n'; }
  return txt;
}
const CHART_RE = /Ts\w*Chart|Ts\w*Gauge|ChartContainer|MetricSwitcher|Sparkline|Heatmap|Histogram|\.Series\s*=|AddMetric\(|RadialGauge/g;

const out = [];
for (const { f, us, n } of files.slice(0, limit)) {
  const dir = nativeDir(f);
  if (!dir) { out.push({ f, n, cls: 'NO-NATIVE-DIR' }); continue; }
  const txt = nativeText(dir);
  // native string tokens: dotted keys + GetString fallback 2nd arg
  const native = new Set();
  for (const m of txt.matchAll(/"([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g)) native.add(m[1]);
  for (const m of txt.matchAll(/GetString\([^,]+,\s*"([^"]+)"/g)) native.add(m[1]);
  // Robust: capture EVERY C# string literal (handles multi-line GetString + commas/escapes inside the string).
  for (const m of txt.matchAll(/"((?:[^"\\]|\\.)*)"/g)) native.add(m[1].replace(/\\"/g, '"'));
  // Native i18n keys carry a "translation." namespace prefix the manifest's keys omit — add the stripped form.
  for (const k of [...native]) if (k.startsWith('translation.')) native.add(k.slice('translation.'.length));
  const sg = us.find(u => u.kind === 'string-group');
  const reqStr = sg ? (sg.strings || []) : [];
  const missStr = reqStr.filter(k => !native.has(k));
  const reqCh = us.filter(u => u.kind === 'chart').length;
  const natCh = (txt.match(CHART_RE) || []).length;
  const strOk = missStr.length === 0;
  const chOk = reqCh === 0 || natCh >= reqCh;
  const cls = (strOk && chOk) ? 'COMPLETE' : (missStr.length <= 3 && chOk) ? `MOSTLY(${missStr.length}s)` : `INCOMPLETE(${missStr.length}s,ch${natCh}/${reqCh})`;
  out.push({ f, n, cls, missStr: missStr.slice(0, 6) });
}
for (const o of out) console.log(`${o.cls.padEnd(22)} ${String(o.n).padStart(3)}u  ${o.f}` + (o.missStr && o.missStr.length ? `  miss:[${o.missStr.join(', ')}]` : ''));
const complete = out.filter(o => o.cls === 'COMPLETE');
console.log(`\nCOMPLETE: ${complete.length}/${out.length}  -> ${complete.reduce((s, o) => s + o.n, 0)} units ready to verify-mark`);
