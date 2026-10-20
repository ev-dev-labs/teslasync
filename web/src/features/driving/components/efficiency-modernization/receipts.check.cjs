/* Read-only acquisition/current closure receipts, not an application audit. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const web = path.resolve(__dirname, '../../../../..');
const repo = path.dirname(web);
const artifacts = 'C:\\Users\\AtulM\\.copilot\\session-state\\bba4960d-f516-4831-bda3-877640f907ce\\files\\parallel-efficiency-page-live';
const page = path.join(web, 'src/features/driving/pages/EfficiencyPage.tsx');
const baselinePath = path.join(artifacts, 'originals/EfficiencyPage.tsx');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = [page, ...fs.readdirSync(__dirname).map(name => path.join(__dirname, name))];
const production = files.filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx$|fixtures\.ts$/.test(file));
const original = fs.readFileSync(baselinePath, 'utf8');
const closure = production.map(file => fs.readFileSync(file, 'utf8')).join('\n');
const keyPattern = /\bt\(\s*['"]([^'"]+)['"]/g;
const originalKeys = new Set([...original.matchAll(keyPattern)].map(m => m[1]));
const fallbacks = /\bt\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g;
const newEnglish = Object.fromEntries([...closure.matchAll(fallbacks)].filter(m => !originalKeys.has(m[1])).map(m => [m[1], m[2]]));
const receipt = {
  artifactRoot: artifacts,
  baseline: { path: baselinePath, sha256: hash(baselinePath), origin: 'current dirty working-tree acquisition; never HEAD' },
  currentHashes: Object.fromEntries(files.map(file => [path.relative(repo, file).replaceAll('\\', '/'), hash(file)])),
  productionClosure: { files: production.length, originalLines: original.split(/\r?\n/).length,
    currentLines: closure.split(/\r?\n/).length,
    originalSections: (original.match(/<section\b/g) ?? []).length,
    currentSections: (fs.readFileSync(page, 'utf8').match(/<section\b/g) ?? []).length },
  newEnglish,
  routeProof: fs.readFileSync(path.join(repo, 'internal/api/router.go'), 'utf8').split(/\r?\n/)
    .flatMap((line, index) => /r\.Route\("\/drives"|r\.Get\("\/stats", driveHandler\.Stats\)|r\.Get\("\/", driveHandler\.ListByVehicle\)/.test(line)
      ? [{ line: index + 1, text: line.trim() }] : []),
  dependencyHashesAtReceipt: Object.fromEntries([
    'web/src/api/hooks/useDriving.ts', 'web/src/api/client.ts', 'internal/api/router.go',
    'internal/api/drives/listing.go', 'web/src/components/layout/layout-reference/ChartCard.tsx',
    'web/src/components/charts/EmbeddedChart.tsx',
  ].map(file => [file, hash(path.join(repo, file))])),
};
console.log(JSON.stringify(receipt, null, 2));
