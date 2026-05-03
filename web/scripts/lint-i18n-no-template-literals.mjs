// Fails if any web/src/i18n/*.json contains a JS template-literal placeholder
// (${...}) inside a string value. i18next uses {{mustache}}, not ${js}.
//
// Allowed exceptions: literal "${{amount}}" (= "$" + mustache "{{amount}}"),
// recognised by the explicit `${{` prefix.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const I18N_DIR = 'src/i18n';
const FAIL_RE = /\$\{(?!\{)[^}]+\}/; // matches `${anything}` but NOT `${{anything}}`

let failed = false;
for (const file of readdirSync(I18N_DIR).filter((f) => f.endsWith('.json'))) {
  const raw = readFileSync(join(I18N_DIR, file), 'utf8');
  raw.split('\n').forEach((line, idx) => {
    if (FAIL_RE.test(line)) {
      console.error(`[i18n-lint] ${I18N_DIR}/${file}:${idx + 1}  ${line.trim()}`);
      failed = true;
    }
  });
}

if (failed) {
  console.error(
    '\n  Found JS template literals in i18n JSON. i18next uses {{mustache}}, not ${js}.\n' +
      '  → Replace `${var}` with `{{var}}` and pass interpolation values via t(key, { var }).\n' +
      '  → For literal "$" + placeholder, use `${{var}}` (NOT `$${var}`).\n',
  );
  process.exit(1);
}

console.log(`[i18n-lint] OK — no template literals in ${I18N_DIR}/*.json`);
