/** Regenerate combined checkpoints only after complete per-file translation verification. */
import path from 'node:path';
import ts from 'typescript';
import fs from 'node:fs';
import * as a from './i18n-trio-checkpoint.mjs';
process.chdir(path.dirname(a.root));
a.enableTypedAudit();
const c = JSON.parse(fs.readFileSync('web/src/i18n/en.json'));
const canonical = 'src/i18n/authorized-canonical-recovery.test.ts', owner = 'src/i18n/authorized-owner-recovery.test.ts';
const fixture = (f, n) => a.literal(a.declarations(f).get(n).node);
const expected = fixture(canonical, 'producerCalls');
const canon = [];
const printer = ts.createPrinter({ removeComments: true });
const norm = s => { const tree = a.parse('call.tsx', s); const expression = tree.statements[0]?.expression; if (!expression)
    throw Error('Invalid call'); return printer.printNode(ts.EmitHint.Expression, expression, tree); };
for (const file of new Set(expected.map(x => x[0]))) {
    const calls = a.callsIn(file);
    const counts = new Map();
    for (const call of calls) {
        const sig = norm(call.node.getText(call.tree));
        counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }
    const required = new Map();
    for (const [, call] of expected.filter(x => x[0] === file)) {
        const sig = norm(call);
        required.set(sig, (required.get(sig) ?? 0) + 1);
    }
    if ([...required].some(([sig, count]) => counts.get(sig) !== count))
        canon.push(file);
}
const paths = fixture(owner, 'sourcePaths'), keys = fixture(owner, 'expectedOwnerCalls'), allowed = new Set(fixture(owner, 'ownerRecoveryAdditions').map(x => x[0]));
allowed.add('battery.degradation.predictionBandChartAria');
const owners = paths.filter((file, i) => JSON.stringify(a.callsIn(file).filter(x => allowed.has(x.key)).map(x => x.key)) !== JSON.stringify(keys[i]));
const files = [...new Set([...canon, ...owners])];
const results = files.map(f => a.verifyFile(f, c));
if (results.some(x => x.errors.length))
    throw Error('Unverified files: ' + JSON.stringify(results.filter(x => x.errors.length)));
const manifest = { canonical: canon, owner: owners, sources: files.map(file => ({ file, calls: a.callsIn(file).length, sha256: a.digest(fs.readFileSync(file)) })) };
fs.writeFileSync('web/src/i18n/verified-combined-checkpoints.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Verified combined producers:', files.length, 'canonical:', canon.length, 'owner:', owners.length);
console.log('active owner count', keys.filter((_, i) => !owners.includes(paths[i])).flat().length, 'distinct', new Set(keys.filter((_, i) => !owners.includes(paths[i])).flat()).size);
