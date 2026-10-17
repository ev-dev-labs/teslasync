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
import ts from 'typescript';

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
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const diagnostic of source.parseDiagnostics) {
    const line = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    offenders.push({
      where: `${path}:${line}`,
      why: `invalid TSX: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    });
  }
  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && node.tagName.getText(source) === 'DataTable'
    ) {
      const hasTableId = node.attributes.properties.some(
        attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'tableId',
      );
      if (!hasTableId) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        offenders.push({
          where: `${path}:${line}`,
          why: 'missing tableId — column visibility / widths / sort / page size will not persist',
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
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
