// Mark all manifest units for a given source file as done in the windows ledger.
// Usage: node mark-file-done.js <root> <sourceFile> <evidenceLog>
// Only call AFTER per-unit coverage is verified AND all gates are green.
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const sourceFile = process.argv[3];
const evidenceLog = process.argv[4] || '';
const manPath = path.join(root, 'apps/parity/parity-manifest.json');
const ledPath = path.join(root, 'apps/parity/windows-ledger.json');
const units = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const led = JSON.parse(fs.readFileSync(ledPath, 'utf8'));
const byUnit = new Map(led.map(r => [r.unitId, r]));
const fileUnits = units.filter(u => (u.sourceFiles || []).includes(sourceFile));
let added = 0, updated = 0;
const touched = [];
for (const u of fileUnits) {
  const row = {
    unitId: u.id,
    platform: 'windows',
    status: 'done',
    coveredCount: u.requiredCount,
    requiredCount: u.requiredCount,
    promptId: 'windows-parity-loop',
    evidenceLog,
  };
  if (byUnit.has(u.id)) { Object.assign(byUnit.get(u.id), row); updated++; }
  else { led.push(row); byUnit.set(u.id, row); added++; }
  touched.push(`${u.id} kind=${u.kind} covered=${u.requiredCount}/${u.requiredCount}`);
}
fs.writeFileSync(ledPath, JSON.stringify(led, null, 2) + '\n');
console.log(`file=${sourceFile} units=${fileUnits.length} added=${added} updated=${updated}`);
touched.forEach(t => console.log('  ' + t));
const doneCount = led.filter(r => r.status === 'done').length;
console.log(`LEDGER_DONE=${doneCount}/${units.length}`);
