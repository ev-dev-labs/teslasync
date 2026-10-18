/** Verified, reproducible updates for the i18n trio. Dry-run unless a repair mode is selected. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const root = fileURLToPath(new URL('../', import.meta.url));
const repo = path.dirname(root);
const catalogFile = path.join(root, 'src/i18n/en.json');
const unwrap = node => node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) ? unwrap(node.expression) : node;
export const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
export const digest = value => createHash('sha256').update(value).digest('hex');
export function literal(node) {
  node = unwrap(node);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  throw new Error('Nonliteral fixture: ' + node.getText());
}
export function declarations(file) {
  const text = fs.readFileSync(path.resolve(root, file), 'utf8'), tree = parse(file, text), result = new Map();
  for (const statement of tree.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) if (declaration.initializer && ts.isIdentifier(declaration.name)) result.set(declaration.name.text, { node: unwrap(declaration.initializer), tree, text });
  }
  return result;
}
export function valueAt(catalog, key) {
  const normalized = key.replace(/^([^:]+):/, '$1.');
  return normalized.split('.').reduce((value, part) => value?.[part], catalog) ?? catalog[normalized];
}
export function callsIn(file) {
  const text = fs.readFileSync(path.resolve(repo, file), 'utf8'), tree = parse(file, text), calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 't') || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'))) {
      const second = node.arguments[1], third = node.arguments[2];
      const options = second && ts.isObjectLiteralExpression(second) ? second : third && ts.isObjectLiteralExpression(third) ? third : null;
      const properties = new Map(options?.properties.filter(part => ts.isPropertyAssignment(part) || ts.isShorthandPropertyAssignment(part)).map(part => [part.name.getText(tree).replace(/^['"]|['"]$/g, ''), ts.isPropertyAssignment(part) ? part.initializer : part.name]) ?? []);
      const fallback = second && ts.isStringLiteralLike(second) ? second : properties.get('defaultValue');
      calls.push({ file, tree, node, keyNode: node.arguments[0], key: node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null, fallbackNode: fallback, fallback: fallback && ts.isStringLiteralLike(fallback) ? fallback.text : null, options, properties, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return calls;
}
export function sourceFiles() {
  return execFileSync('rg', ['--files', 'src', '-g', '*.ts', '-g', '*.tsx', '-g', '!*.test.*', '-g', '!*.spec.*'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean).map(file => 'web/' + file.replaceAll('\\', '/')).filter(file => !file.includes('/src/test/') && !file.endsWith('/test-setup.ts'));
}
export function insert(catalog, key, value) {
  const parts = key.split('.'); let target = catalog;
  for (const part of parts.slice(0, -1)) {
    if (target[part] !== undefined && (typeof target[part] !== 'object' || target[part] === null)) throw new Error('Scalar ancestor: ' + key);
    target = target[part] ??= {};
  }
  if (target[parts.at(-1)] !== undefined && target[parts.at(-1)] !== value) throw new Error('Conflicting value: ' + key);
  target[parts.at(-1)] = value;
}
export function allCatalogCalls() { return sourceFiles().flatMap(callsIn); }
export function repairMissing(catalog, calls) {
  const grouped = Map.groupBy(calls.filter(call => call.key && ![call.key, call.key + '_one', call.key + '_other', call.key + '_zero'].some(key => typeof valueAt(catalog, key) === 'string')), call => call.key);
  const added = [], unresolved = [];
  for (const [key, uses] of grouped) {
    const values = new Set(uses.map(call => call.fallback));
    if (values.size !== 1 || values.has(null) || uses.some(call => call.properties.has('count')) || [...values][0].includes('{{count}}')) {
      unresolved.push({ key, reason: 'Requires plural forms, a missing default, or conflicting source defaults', uses: uses.map(call => ({ file: call.file, line: call.line, fallback: call.fallback })) });
      continue;
    }
    try { insert(catalog, key.replace(/^([^:]+):/, '$1.'), [...values][0]); added.push({ key, value: [...values][0], uses: uses.length }); }
    catch (error) { unresolved.push({ key, reason: error.message }); }
  }
  return { added, unresolved };
}
function run() {
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  const calls = allCatalogCalls();
  if (process.argv.includes('--repair-missing')) {
    const result = repairMissing(catalog, calls);
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
    console.log(JSON.stringify(result));
  }
  const missing = [], fallback = [], dynamic = [];
  for (const call of calls) {
    const row = { file: call.file, line: call.line, key: call.key, fallback: call.fallback };
    if (!call.key) { dynamic.push({ ...row, expression: call.keyNode?.getText(call.tree) }); continue; }
    const values = [valueAt(catalog, call.key), ...(['_one', '_other', '_zero'].map(suffix => valueAt(catalog, call.key + suffix)))].filter(value => typeof value === 'string');
    if (!values.length) missing.push(row);
    else if (call.fallback !== null && !values.includes(call.fallback)) fallback.push({ ...row, expected: values[0] });
  }
  const report = { files: sourceFiles().length, calls: calls.length, missing, fallback, dynamic };
  const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice(9);
  if (reportPath) fs.writeFileSync(path.resolve(reportPath), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ files: report.files, calls: report.calls, missing: missing.length, fallback: fallback.length, dynamic: dynamic.length }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
