#!/usr/bin/env node
// DataTable tableId persistence audit.
//
// Walks src/features/ and fails if any <DataTable...> JSX use is found
// without a `tableId=` attribute on the opening tag.
//
// Without `tableId`, the persistence layer in DataTable.tsx
// (column visibility, column widths, column order, sort, page size)
// short-circuits to a no-op — every reload throws away the user's
// table layout. makes `tableId` mandatory across
// every production caller. This audit locks that property in.
//
// Run via `npm run audit:datatable-tableid` (also chained from
// `npm run lint`).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

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

// Build a list of [start, end) ranges in `text` that correspond to
// string literals or comments. Used to filter out false-positive
// `<DataTable` matches inside JSDoc / block comments / strings.
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

// Scan forward from `from` (just past the `<DataTable` token) until we
// hit the matching `>` or `/>` that closes the JSX opening tag, while
// tracking brace depth and string/template state so embedded JS
// expressions (`columns={...}`) don't trip us up. Also handles the
// TypeScript generic-parameter form `<DataTable<Foo>...>` by skipping
// the immediately-following `<...>` block before scanning.
function findTagEnd(text, from) {
  let i = from;
  // Skip a leading TS generic param block: `<DataTable<Foo, Bar<Baz>>(...)`.
  if (text[i] === '<') {
    let angle = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '<') angle++;
      else if (c === '>') {
        angle--;
        if (angle === 0) {
          i++;
          break;
        }
      }
    }
  }
  let depth = 0;
  let inString = null; // ' " or `
  for (; i < text.length; i++) {
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

function auditFile(path) {
  const text = readFileSync(path, 'utf8');
  const masked = buildMaskedRegions(text);
  // Match `<DataTable` followed by either whitespace, `<` (for the
  // generic-arg form `<DataTable<Foo>`), `/`, or `>`. Excludes
  // `<DataTableColumnsMenu`, `<DataTableResizer`, etc.
  const re = /<DataTable(?=[\s</>])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (isMaskedRegion(masked, m.index)) continue;
    const tagEnd = findTagEnd(text, m.index + '<DataTable'.length);
    if (tagEnd === -1) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push({
        where: `${path}:${line}`,
        why: '<DataTable opening tag never closes — could not parse',
      });
      continue;
    }
    const tagSource = text.slice(m.index, tagEnd);
    const hasTableId = /\btableId\s*=/.test(tagSource);
    if (!hasTableId) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push({
        where: `${path}:${line}`,
        why: 'missing tableId — column visibility / widths / sort / page size will not persist',
      });
    }
  }
}

walk(ROOT);

if (offenders.length > 0) {
  console.error(
    `\n<DataTable> instances missing required tableId (${offenders.length}):`,
  );
  for (const o of offenders) {
    console.error(`  ${o.where}\n      ${o.why}`);
  }
  console.error(
    '\nFix by adding a stable, descriptive id of the form `<feature>:<purpose>`:\n' +
      '  <DataTable\n' +
      '    tableId="drives:list"\n' +
      '    columns={...}\n' +
      '    ...\n' +
      '  />\n' +
      '\nThe id namespaces persisted column visibility, widths, sort, and\n' +
      'page-size in localStorage so the user keeps their layout across reloads.',
  );
  process.exit(1);
}

console.log(`OK — every <DataTable> in ${ROOT} has a tableId`);
