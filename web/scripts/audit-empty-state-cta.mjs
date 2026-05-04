#!/usr/bin/env node
// Phase-45 / Prompt 31 — EmptyState CTA wiring audit.
//
// Walks src/features/ and fails if any <EmptyState ...> JSX use is found
// without either:
//   - an `action=` or `actionTo=` prop (anywhere in the same JSX element), or
//   - an inline `// no-action: <reason>` comment within the surrounding context
//     (within 200 chars before, or 200 chars after the opening tag).
//
// Goal: every empty surface in a page either has an actionable CTA or a
// documented reason for being a dead end.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOT = join('src', 'features');
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
      walk(p);
      continue;
    }
    if (!p.endsWith('.tsx')) continue;
    auditFile(p);
  }
}

function auditFile(path) {
  const text = readFileSync(path, 'utf8');
  // Match `<EmptyState` followed by either whitespace or `>` (open tag),
  // not `<EmptyStateFoo` and not a closing tag. We skip matches that
  // fall inside string literals or comments via `isMaskedRegion`.
  const masked = buildMaskedRegions(text);
  const re = /<EmptyState(?=[\s/>])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isMaskedRegion(masked, m.index)) continue;
    // Find the end of the JSX opening tag — first `/>` or `>` that's not
    // inside a brace expression or string. Cheap heuristic: scan forward
    // tracking brace depth and string state until we hit the tag end.
    const tagEnd = findTagEnd(text, m.index + '<EmptyState'.length);
    const tagSource = text.slice(m.index, tagEnd === -1 ? m.index + 1200 : tagEnd);

    const hasAction = /\baction(To)?\s*=/.test(tagSource);

    // Look at 200 chars before the tag and the tag body itself for a
    // `no-action:` exemption comment.
    const exemptionWindow = text.slice(Math.max(0, m.index - 200), tagEnd === -1 ? m.index + 200 : tagEnd + 200);
    const hasExempt = /no-action:/.test(exemptionWindow);

    if (!hasAction && !hasExempt) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push(`${path}:${line}`);
    }
  }
}

function findTagEnd(text, from) {
  let depth = 0;
  let inString = null; // ' " or `
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === inString && text[i - 1] !== '\\') inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      continue;
    }
    if (c === '{') {
      depth++;
      continue;
    }
    if (c === '}') {
      depth--;
      continue;
    }
    if (depth === 0 && (c === '>' || (c === '/' && text[i + 1] === '>'))) {
      return c === '/' ? i + 2 : i + 1;
    }
  }
  return -1;
}

// Build a list of [start, end) ranges in `text` that correspond to
// string literals or comments. Used to filter out false-positive
// `<EmptyState` matches inside JSDoc / block comments / strings.
function buildMaskedRegions(text) {
  const regions = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const start = i;
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      regions.push([start, i]);
      continue;
    }
    if (c === '/' && next === '*') {
      const start = i;
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      regions.push([start, i]);
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const start = i;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 2;
        else i++;
      }
      i++;
      regions.push([start, i]);
      continue;
    }
    i++;
  }
  return regions;
}

function isMaskedRegion(regions, offset) {
  for (const [s, e] of regions) {
    if (offset >= s && offset < e) return true;
    if (s > offset) return false;
  }
  return false;
}

walk(ROOT);

if (offenders.length > 0) {
  console.error(
    `\nEmptyState without action / actionTo / // no-action: comment (${offenders.length}):`,
  );
  for (const o of offenders) console.error('  ', o);
  console.error(
    '\nFix by either:\n' +
      '  • Adding action={{label, onClick}} or actionTo={{label, to}} to the <EmptyState>, or\n' +
      '  • Adding an inline `// no-action: <reason>` comment near the <EmptyState> when no CTA makes sense.',
  );
  process.exit(1);
}

const _ = sep; // keep the import linter happy if sep is needed later
console.log(`OK — every <EmptyState> in ${ROOT} has a CTA or // no-action: exemption`);
