// Orchestrator: writes (or, with --check, verifies) the three platform theme
// files deterministically from tokens.json.
//
//   node index.mjs            # generate/overwrite generated/**
//   node index.mjs --check    # exit 1 if any generated file is missing or drifted
//
// Determinism: emitters take only tokens.json as input and join string arrays,
// so identical tokens always produce identical bytes — making --check a true
// drift gate.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadTokens, GENERATED_DIR } from './lib/tokens.mjs';
import { generateFluent } from './gen-fluent.mjs';
import { generateMaterial } from './gen-material.mjs';
import { generateApple } from './gen-apple.mjs';

const check = process.argv.includes('--check') || process.argv.includes('-Check');

function main() {
  const tokens = loadTokens();
  const artifacts = [generateFluent(tokens), generateMaterial(tokens), generateApple(tokens)];

  let drift = 0;
  for (const { rel, content } of artifacts) {
    const abs = join(GENERATED_DIR, rel);
    if (check) {
      if (!existsSync(abs)) {
        console.error(`DRIFT: missing ${rel}`);
        drift++;
        continue;
      }
      const onDisk = readFileSync(abs, 'utf8');
      if (onDisk !== content) {
        console.error(`DRIFT: ${rel} differs from tokens.json output`);
        drift++;
      } else {
        console.log(`OK (no drift): ${rel}`);
      }
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
      console.log(`wrote ${rel} (${content.length} bytes)`);
    }
  }

  if (check && drift > 0) {
    console.error(`FAIL: ${drift} generated file(s) drifted. Run gen-themes.ps1 to regenerate.`);
    process.exit(1);
  }
  console.log(check ? 'CHECK PASSED: no drift.' : 'GENERATION COMPLETE.');
}

main();
