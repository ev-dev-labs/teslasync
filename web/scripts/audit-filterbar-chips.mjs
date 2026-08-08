#!/usr/bin/env node
// FilterBar / ActiveFilterChips co-mount audit.
//
// Walks every src/features/**/*.tsx (and src/components/forms/*.tsx for
// shared filter wrappers reused inside features) and asserts that any
// file containing a `<FilterBar>` JSX use ALSO contains an
// `<ActiveFilterChips>` JSX use somewhere in the same file (the chips
// belong directly under the filter bar in the JSX tree).
//
// Why per-file rather than per-JSX-tree? A precise tree-level audit
// would need a real JSX parser; the per-file gate is a high-signal
// proxy that catches the actual failure mode (a feature ships filter
// controls without a chip summary) and is cheap to enforce on every
// lint run.
//
// Run via `npm run audit:filterbar-chips` (also chained from
// `npm run lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process from 'node:process';

const ROOTS = [join('src', 'features'), join('src', 'components', 'forms')];
const FILTERBAR_DEFINITION = join('src', 'components', 'forms', 'FilterBar.tsx');
const offenders = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip __tests__ — chip co-mount is a runtime UI concern.
      if (name === '__tests__') continue;
      walk(p);
      continue;
    }
    if (!p.endsWith('.tsx')) continue;
    // Same rationale as the __tests__ skip above: co-located `*.test.tsx`
    // files mount <FilterBar> in isolation to exercise the primitive itself,
    // so requiring a sibling <ActiveFilterChips> there tests nothing real.
    if (p.endsWith('.test.tsx')) continue;
    auditFile(p);
  }
}

// Build a list of [start, end) ranges in `text` that correspond to
// string literals, template literals, regex literals, or comments. Used
// to filter out false-positive `<FilterBar` matches inside JSDoc, block
// comments, strings, or regex literals (e.g. `/["]/g` would otherwise
// confuse the string-state machine and swallow real JSX tokens further
// downstream).
function buildMaskedRegions(text) {
  const regions = [];
  // Tokens that — when last seen — mean the next `/` starts a regex
  // literal, not a division operator. JS expression positions.
  const REGEX_PRECEDERS = new Set([
    '=', '(', '[', ',', ':', ';', '<', '>', '!', '&', '|',
    '?', '+', '-', '*', '%', '^', '~', '{', '}',
  ]);
  const REGEX_PRECEDING_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
    'void', 'throw', 'case', 'await', 'yield',
  ]);
  let lastMeaningful = '';
  let lastWordEnd = -1;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    // Line comment.
    if (c === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      regions.push([start, i]);
      continue;
    }
    // Block comment.
    if (c === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      regions.push([start, i]);
      continue;
    }
    // Regex literal — ONLY when preceded by an expression-position token
    // (otherwise `/` is division). Scan until the closing `/`, respecting
    // character classes (`[...]`) where `/` is literal, and `\` escapes.
    if (c === '/') {
      const wordPrecedes =
        lastWordEnd === i &&
        REGEX_PRECEDING_KEYWORDS.has(getPrecedingWord(text, i));
      if (REGEX_PRECEDERS.has(lastMeaningful) || lastMeaningful === '' || wordPrecedes) {
        const start = i;
        i++;
        let inClass = false;
        while (i < text.length) {
          const rc = text[i];
          if (rc === '\\') { i += 2; continue; }
          if (rc === '\n') break; // unterminated — bail.
          if (rc === '[' && !inClass) { inClass = true; i++; continue; }
          if (rc === ']' && inClass) { inClass = false; i++; continue; }
          if (rc === '/' && !inClass) { i++; break; }
          i++;
        }
        // Skip flag chars (gimsuy).
        while (i < text.length && /[a-z]/.test(text[i])) i++;
        regions.push([start, i]);
        lastMeaningful = ')';
        continue;
      }
    }
    // String literal (single, double, or template).
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const start = i;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') { i += 2; continue; }
        i++;
      }
      i++;
      regions.push([start, i]);
      lastMeaningful = quote;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // Track word-end for keyword-based regex detection.
    if (/[A-Za-z_$]/.test(c)) {
      i++;
      while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i++;
      lastMeaningful = 'w';
      lastWordEnd = i;
      continue;
    }
    if (/[0-9]/.test(c)) {
      i++;
      while (i < text.length && /[0-9.eE+\-_xXa-fA-F]/.test(text[i])) i++;
      lastMeaningful = '0';
      continue;
    }
    lastMeaningful = c;
    i++;
  }
  return regions;
}

function getPrecedingWord(text, i) {
  let j = i;
  while (j > 0 && /[A-Za-z0-9_$]/.test(text[j - 1])) j--;
  return text.slice(j, i);
}

function isMaskedRegion(regions, offset) {
  for (const [s, e] of regions) {
    if (offset >= s && offset < e) return true;
    if (s > offset) return false;
  }
  return false;
}

function findMatchOutsideMasked(text, masked, re) {
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!isMaskedRegion(masked, m.index)) return m;
  }
  return null;
}

function auditFile(path) {
  // Don't audit FilterBar's own definition file.
  const normalised = path.split(sep).join('/');
  const normalisedDef = FILTERBAR_DEFINITION.split(sep).join('/');
  if (normalised.endsWith(normalisedDef)) return;

  const text = readFileSync(path, 'utf8');
  const masked = buildMaskedRegions(text);

  // Match `<FilterBar` followed by whitespace, `>`, or `/`. Excludes
  // identifiers like `<FilterBarChips`, `<FilterBarRow`, etc.
  const filterBarRe = /<FilterBar(?=[\s/>])/g;
  const filterBarMatch = findMatchOutsideMasked(text, masked, filterBarRe);
  if (!filterBarMatch) return;

  const chipsRe = /<ActiveFilterChips(?=[\s/>])/g;
  const chipsMatch = findMatchOutsideMasked(text, masked, chipsRe);
  if (chipsMatch) return;

  const line = text.slice(0, filterBarMatch.index).split('\n').length;
  offenders.push({
    where: `${path}:${line}`,
    why:
      '<FilterBar> present but no sibling <ActiveFilterChips> — users cannot ' +
      'see what they have filtered without re-opening every control.',
  });
}

for (const root of ROOTS) walk(root);

if (offenders.length > 0) {
  console.error(
    `\n<FilterBar> instances without a sibling <ActiveFilterChips> (${offenders.length}):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.why}`);
  }
  console.error(
    '\nFix by mounting <ActiveFilterChips> immediately after the <FilterBar> in\n' +
      'the same JSX tree, wired to the page\'s active filter state:\n' +
      '  <FilterBar>\n' +
      '    <SearchInput value={search} onChange={setSearch} />\n' +
      '    <Select value={vehicle} onChange={setVehicle} options={...} />\n' +
      '  </FilterBar>\n' +
      '  <ActiveFilterChips\n' +
      '    filters={chips}\n' +
      '    onClearAll={() => { setSearch(\'\'); setVehicle(undefined); }}\n' +
      '  />\n' +
      '\nThe chips give users a one-glance summary of what is filtering the\n' +
      'current view and a single-click affordance to remove any of them.',
  );
  process.exit(1);
}

console.log(
  `OK — every <FilterBar> in [${ROOTS.join(', ')}] has a sibling <ActiveFilterChips>`,
);
