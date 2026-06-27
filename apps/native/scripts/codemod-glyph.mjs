// Codemod: in every web-parity file that defines a LOCAL monogram `Glyph`
// component, rename the local definition out of the way and import the shared
// real-icon Glyph (Glyph.web.tsx renders lucide; Glyph.tsx renders text on
// device). JSX `<Glyph .../>` then resolves to the shared component.
import {readdirSync, statSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const nativeRoot = join(__dirname, '..');
const srcRoot = join(nativeRoot, 'src');
const wpRoot = join(srcRoot, 'web-parity');
const glyphModuleAbs = join(srcRoot, 'components', 'icons', 'Glyph');

function walk(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    const s = statSync(f);
    if (s.isDirectory()) walk(f, acc);
    else if (f.endsWith('.tsx')) acc.push(f);
  }
  return acc;
}

const files = walk(wpRoot);
let changed = 0;
const report = [];

for (const file of files) {
  let src = readFileSync(file, 'utf8');
  if (src.includes("components/icons/Glyph'")) continue; // already done
  const hasLocal =
    /\bfunction Glyph\s*\(/.test(src) ||
    /\bconst Glyph\s*[:=]/.test(src);
  if (!hasLocal) continue;

  // Rename local definitions so the imported Glyph wins in JSX.
  src = src
    .replace(/\bfunction Glyph\s*\(/g, 'function GlyphLegacyUnused(')
    .replace(/\bconst Glyph\s*=/g, 'const GlyphLegacyUnused =')
    .replace(/\bconst Glyph\s*:/g, 'const GlyphLegacyUnused:');

  // Compute relative import path to the shared Glyph module (posix, no ext).
  let rel = relative(dirname(file), glyphModuleAbs).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  // Insert the import as the first line (valid: imports are top-level and need
  // not precede file comments). Avoids landing inside a multi-line import.
  const importLine = `import {Glyph} from '${rel}';`;
  src = importLine + '\n' + src;

  writeFileSync(file, src, 'utf8');
  changed++;
  report.push('FIXED ' + file.substring(wpRoot.length + 1).replace(/\\/g, '/'));
}

console.log(`Rewrote ${changed} files.`);
report.slice(0, 12).forEach((r) => console.log('  ' + r));
