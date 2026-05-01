#!/usr/bin/env node
/**
 * i18n-validate-keys.mjs
 *
 * Cross-references every t('key', ...) call in web/src/ against the keys
 * defined in web/src/i18n/en.json. Reports:
 *
 *   - Missing keys: used in code but not present in en.json (will fall back to
 *     the second argument in production, but should be added so translators
 *     have a clear contract).
 *   - Unused keys: defined in en.json but never referenced (dead translations).
 *
 * Exit codes:
 *   0  no missing keys (or non-strict mode)
 *   1  one or more missing keys (CI-failing in --strict mode)
 *
 * Usage:
 *   node scripts/i18n-validate-keys.mjs                 # default (warn only)
 *   node scripts/i18n-validate-keys.mjs --strict        # exit 1 on missing
 *   node scripts/i18n-validate-keys.mjs --report=json   # emit JSON summary
 *   node scripts/i18n-validate-keys.mjs --extract       # ADD missing keys
 *                                                       # to en.json using
 *                                                       # the fallback string
 *                                                       # from each t() call
 *
 * The script is intentionally pure-Node (no rg/grep dependency) so it works
 * the same on Windows, macOS, and Linux CI runners.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const EN_PATH = path.join(REPO_ROOT, 'web', 'src', 'i18n', 'en.json');
const SRC_ROOT = path.join(REPO_ROOT, 'web', 'src');

const args = new Set(process.argv.slice(2));
const STRICT = args.has('--strict');
const EXTRACT = args.has('--extract');
const JSON_OUT = [...args].find((a) => a.startsWith('--report=json'));

function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) return flatten(v, key);
    return [key];
  });
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Match t('key', 'Default') / t("key", "Default") / t(`key`, `Default`).
// Captures the key (group 2) and the optional fallback string (group 4).
//
//   t('foo.bar')                         -> key=foo.bar, fallback=null
//   t('foo.bar', 'Hello')                -> key=foo.bar, fallback=Hello
//   t('foo.bar', 'Hello {{n}}', {n})     -> key=foo.bar, fallback=Hello {{n}}
//
// Dynamic keys (template literals with ${...}) are skipped — they cannot be
// statically validated. The companion DEFAULT_VALUE_OPT regex below picks up
// the i18next options-object form `t('key', { defaultValue: 'Hello' })`.
const T_CALL =
  /(?<![a-zA-Z0-9_$])t\(\s*(['"`])([a-zA-Z0-9_.\-]+)\1(?:\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3)?/g;

// Picks up `defaultValue: 'Hello'` (or `"Hello"` / `\`Hello\``) from the
// options object form. Used as a secondary scan when T_CALL captured a key but
// no positional fallback string (i.e. the second argument was an object).
const DEFAULT_VALUE_OPT =
  /(?<![a-zA-Z0-9_$])t\(\s*(['"`])([a-zA-Z0-9_.\-]+)\1\s*,\s*\{[^{}]*?defaultValue\s*:\s*(['"`])((?:\\.|(?!\3).)*)\3/g;

function collectUsedKeys(files) {
  const used = new Map(); // key -> { refs: [{file, line}], fallback?: string }
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      T_CALL.lastIndex = 0;
      while ((m = T_CALL.exec(line)) !== null) {
        const key = m[2];
        const fallbackRaw = m[4];
        const fallback =
          typeof fallbackRaw === 'string'
            ? fallbackRaw.replace(/\\(['"`\\])/g, '$1')
            : null;
        const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
        if (!used.has(key)) used.set(key, { refs: [], fallback: null });
        const entry = used.get(key);
        entry.refs.push({ file: rel, line: i + 1 });
        if (entry.fallback === null && fallback) entry.fallback = fallback;
      }
      // Secondary scan: i18next options-object form with `defaultValue`.
      DEFAULT_VALUE_OPT.lastIndex = 0;
      while ((m = DEFAULT_VALUE_OPT.exec(line)) !== null) {
        const key = m[2];
        const fallbackRaw = m[4];
        const fallback = fallbackRaw.replace(/\\(['"`\\])/g, '$1');
        if (!used.has(key)) {
          const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
          used.set(key, {
            refs: [{ file: rel, line: i + 1 }],
            fallback,
          });
        } else {
          const entry = used.get(key);
          if (entry.fallback === null) entry.fallback = fallback;
        }
      }
    }
  }
  return used;
}

// Insert a flat dotted key into a nested object, e.g.
//   setNested(obj, 'foo.bar.baz', 'Hi') -> obj.foo.bar.baz = 'Hi'
// If a path collision occurs (e.g. existing string at obj.foo when we try to
// set obj.foo.bar), the function returns false and leaves the tree untouched.
function setNested(obj, dottedKey, value) {
  const parts = dottedKey.split('.');
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (node[p] === undefined) {
      node[p] = {};
    } else if (typeof node[p] !== 'object' || Array.isArray(node[p])) {
      return false; // collision with an existing leaf
    }
    node = node[p];
  }
  const last = parts[parts.length - 1];
  if (node[last] !== undefined) {
    // Existing leaf — leave it as-is. Caller checks definedKeys first.
    return false;
  }
  node[last] = value;
  return true;
}

function main() {
  if (!fs.existsSync(EN_PATH)) {
    console.error(`error: en.json not found at ${EN_PATH}`);
    process.exit(2);
  }
  const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
  const definedKeys = new Set(flatten(en));

  const files = walk(SRC_ROOT);
  const used = collectUsedKeys(files);

  // A key is considered "defined" if the exact key exists. We use exact match
  // because i18next does not auto-resolve prefixes.
  const missing = [];
  for (const [key, info] of used) {
    if (!definedKeys.has(key)) missing.push({ key, refs: info.refs, fallback: info.fallback });
  }

  // Defined-but-unused leaf keys. We do not count parent objects.
  const unused = [];
  const usedSet = new Set(used.keys());
  for (const k of definedKeys) {
    if (!usedSet.has(k)) unused.push(k);
  }

  // ─── Extract mode: write missing keys (with their fallback strings) into
  //     en.json so the bundle is the source of truth for translators. Keys
  //     without a fallback are left for manual entry — we do not invent text.
  //     Special case: a single-word key like t('Run') with no fallback is
  //     i18next's "use the key as the value" pattern; we add it to en.json
  //     using the key itself as the value so future bundles can override it.
  if (EXTRACT) {
    let added = 0;
    let skippedNoFallback = 0;
    let skippedCollision = 0;
    for (const { key, fallback } of missing) {
      let value = fallback;
      if (!value) {
        // i18next pattern: t('Run') or t('kW') with no fallback uses the key
        // itself as the displayed value. We mirror that in en.json so other
        // language bundles can override. Restrict this convenience to short
        // identifiers without dots — anything with a dotted namespace and no
        // fallback is a real bug we want translators to fix manually.
        const isLiteralEnglishKey =
          !key.includes('.') &&
          /^[A-Za-z][a-zA-Z0-9]*$/.test(key) &&
          key.length <= 32;
        if (isLiteralEnglishKey) {
          value = key;
        } else {
          skippedNoFallback++;
          continue;
        }
      }
      const ok = setNested(en, key, value);
      if (ok) added++;
      else skippedCollision++;
    }
    fs.writeFileSync(EN_PATH, JSON.stringify(en, null, 2) + '\n', 'utf8');
    console.log(`Extract complete:`);
    console.log(`  Added:                ${added}`);
    console.log(`  Skipped (no default): ${skippedNoFallback}`);
    console.log(`  Skipped (collision):  ${skippedCollision}`);
    process.exit(0);
  }

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          definedCount: definedKeys.size,
          usedCount: used.size,
          missingCount: missing.length,
          unusedCount: unused.length,
          missing: missing.slice(0, 200).map(({ key, refs, fallback }) => ({
            key,
            fallback,
            firstRef: refs[0],
          })),
          unused: unused.slice(0, 200),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Defined keys (en.json): ${definedKeys.size}`);
    console.log(`Used keys (t() calls):  ${used.size}`);
    console.log(`Missing in en.json:     ${missing.length}`);
    console.log(`Unused in en.json:      ${unused.length}`);
    if (missing.length > 0) {
      console.log('\nFirst 50 missing keys:');
      for (const { key, refs, fallback } of missing.slice(0, 50)) {
        const ref = refs[0];
        const f = fallback ? ` = "${fallback.slice(0, 40)}${fallback.length > 40 ? '…' : ''}"` : '';
        console.log(`  - ${key}${f}  (${ref.file}:${ref.line})`);
      }
    }
    if (unused.length > 0) {
      console.log('\nFirst 30 unused keys:');
      for (const k of unused.slice(0, 30)) console.log(`  - ${k}`);
    }
  }

  if (STRICT && missing.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
