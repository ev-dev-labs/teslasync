/**
 * Conservative migration of repeated card-face status/placeholder assertions.
 * Dry-run by default. --write applies edits; --failures limits the input files
 * to a retained triage index. --report writes the complete review inventory.
 * --missing-metrics migrates only placeholder checks using proven DOM value readers.
 * Never edits known values, test names/counts, fixtures, or assertions in waitFor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const helper = 'assertOperationalBriefDisclosure';
const moduleName = '@/test/operationalBriefAssertions';
const statuses = new Set([
  'Retained evidence', 'Returned evidence', 'Loading source', 'Source unavailable',
  'Evidence unresolved', 'Retained source evidence', 'Available source readings',
  'Loading source evidence', 'Source readings unavailable', 'Retained source data',
  'Returned source data', 'Loading source data', 'Source data unavailable',
  'Retained statistics', 'Returned statistics', 'Loading statistics',
  'Statistics unavailable', 'Refresh paused', 'Refreshing',
  'Source available', 'Source data available', 'Independent sources incomplete', 'Retained source',
]);
const contexts = new Set([
  'Observed history window',
  'Built-in, admin-editable static 24-hour model',
]);

const callNamed = (node, name) => ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) && node.expression.text === name;

function unsafeAncestor(node) {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (callNamed(ancestor, 'waitFor') || callNamed(ancestor, 'waitForElementToBeRemoved')) return true;
  }
  return false;
}

function hasNonRenderingBriefDouble(tree) {
  let found = false;
  function inspect(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(tree) === 'vi' && node.expression.name.text === 'mock' &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('@/components/data-display')) {
      function checkMock(child) {
        if (ts.isPropertyAssignment(child) && child.name.getText(tree) === 'OperationalBrief') {
          // A wrapper that forwards into the real brief still exercises the drawer.
          // A prop-capture stub must retain its own original contract assertions.
          if (!/<(?:[A-Za-z_$][\w$]*\.)?OperationalBrief\b/.test(child.initializer.getText(tree))) found = true;
        }
        ts.forEachChild(child, checkMock);
      }
      ts.forEachChild(node, checkMock);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(tree);
  return found;
}

export function migrateBriefDisclosureTests(source, filename = 'example.test.tsx', options = {}) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nonRenderingBriefDouble = hasNonRenderingBriefDouble(tree);
  const edits = [];
  const deferred = [];
  function visit(node) {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      ts.forEachChild(node, visit);
      return;
    }
    const matcher = node.expression.name.text;
    if (!['toBeInTheDocument', 'toHaveTextContent', 'toBeGreaterThan'].includes(matcher)) {
      ts.forEachChild(node, visit);
      return;
    }
    let expectation = node.expression.expression;
    const absent = ts.isPropertyAccessExpression(expectation) && expectation.name.text === 'not';
    if (absent) expectation = expectation.expression;
    if (!callNamed(expectation, 'expect') || expectation.arguments.length !== 1) return;
    let argument = expectation.arguments[0];
    let scope;
    let text;
    const contains = matcher === 'toHaveTextContent';
    const allMatches = matcher === 'toBeGreaterThan';
    if (allMatches) {
      if (absent || !node.arguments[0] || !ts.isNumericLiteral(node.arguments[0]) || node.arguments[0].text !== '0' ||
        !ts.isPropertyAccessExpression(argument) || argument.name.text !== 'length') return;
      argument = argument.expression;
    }
    if (contains) {
      scope = argument;
      text = node.arguments[0];
    } else if (ts.isCallExpression(argument) && ts.isPropertyAccessExpression(argument.expression) &&
      (allMatches ? ['getAllByText'] : ['getByText', 'queryByText']).includes(argument.expression.name.text) &&
      callNamed(argument.expression.expression, 'within')) {
      scope = argument.expression.expression.arguments[0];
      text = argument.arguments[0];
      // Query options can change exactness or the selected element. Review them manually.
      if (argument.arguments.length !== 1) return;
    }
    if (!scope || !text || !ts.isStringLiteral(text)) return;
    const context = options.contexts && contexts.has(text.text);
    if (!statuses.has(text.text) && !context) return;
    const scopeText = scope.getText(tree);
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    const original = node.getText(tree);
    let reason;
    if (nonRenderingBriefDouble) reason = 'Non-rendering OperationalBrief mock: preserve the wrapper prop contract';
    else if (unsafeAncestor(node)) reason = 'Polling assertion: migrate the wait and interaction together';
    else if (text.text === 'Refresh paused' || text.text === 'Refreshing') reason = 'Shared source-state label: confirm which panel owns the assertion';
    else if (/dialog|drawer|notice|warning|status\b/i.test(scopeText)) reason = 'Existing dialog or source-notice scope: inspect manually';
    else if (/getByText|queryByText|findByText/.test(scopeText)) reason = 'Text node is not a proven evidence-card scope';
    else if (!/brief|band|strip|summary|kpi/i.test(scopeText)) reason = 'Scope is not identified as an evidence card: inspect manually';
    if (reason) deferred.push({ line, original, reason });
    else {
      const flags = [absent ? 'absent: true' : '', contains ? 'contains: true' : '',
        allMatches ? 'allMatches: true' : '', context ? "region: 'drawer'" : ''].filter(Boolean);
      const replacement = `${helper}(${scopeText}, ${text.getText(tree)}${flags.length ? `, { ${flags.join(', ')} }` : ''})`;
      edits.push({ start: node.getStart(tree), end: node.end, line, original, replacement });
    }
  }
  visit(tree);
  let output = source;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  if (edits.length && !source.includes(`from '${moduleName}'`)) {
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    // Keep any file-level docblock or Vitest directives ahead of imports.
    const firstImport = tree.statements.find(ts.isImportDeclaration);
    const at = firstImport ? firstImport.getStart(tree) : 0;
    output = output.slice(0, at) + `import { ${helper} } from '${moduleName}';${newline}` + output.slice(at);
  } else if (edits.length) {
    const existing = tree.statements.find(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === moduleName);
    const bindings = existing?.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings) && !bindings.elements.some(element => element.name.text === helper)) {
      output = output.slice(0, bindings.getStart(tree) + 1) + ` ${helper},` + output.slice(bindings.getStart(tree) + 1);
    }
  }
  return { output, edits, deferred };
}

export function migrateMissingMetricTests(source, filename = 'example.test.tsx') {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const readers = new Map();
  const ambiguousReaders = new Set();
  function findReaders(node) {
    const declaration = ts.isFunctionDeclaration(node) ? node
      : ts.isVariableDeclaration(node) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : null;
    const name = ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) ? node.name : null;
    if (declaration?.body && name && ts.isIdentifier(name) && [1, 2].includes(declaration.parameters.length)) {
      const parameters = declaration.parameters.map(parameter => parameter.name.getText(tree));
      const [scope, label] = parameters.length === 2 ? parameters : [null, parameters[0]];
      let fixedScope;
      let conflictingScope = false;
      let canonicalTile = false;
      let canonicalValue = false;
      let labelledScope = false;
      function inspect(part) {
        if (ts.isCallExpression(part) && ts.isPropertyAccessExpression(part.expression)) {
          const selector = part.arguments[0];
          if (['closest', 'querySelector'].includes(part.expression.name.text) && selector && ts.isStringLiteral(selector)) {
            canonicalTile ||= selector.text === '[data-operational-metric]';
            canonicalValue ||= selector.text === '[data-operational-value]';
          }
          if (part.expression.name.text === 'getByText' && part.arguments[0]?.getText(tree) === label &&
            callNamed(part.expression.expression, 'within') &&
            part.expression.expression.arguments.length === 1) {
            const root = part.expression.expression.arguments[0];
            if (scope && root.getText(tree) === scope) labelledScope = true;
            if (!scope) {
              // Only a direct, label-independent DOM scope can move to the call site.
              // Local aliases and arbitrary global text readers require manual review.
              const rootText = root.getText(tree);
              const directScope = callNamed(root, 'kpiRegion') || callNamed(root, 'statsRegion') ||
                (ts.isCallExpression(root) && ts.isPropertyAccessExpression(root.expression) &&
                  root.expression.expression.getText(tree) === 'screen' && root.expression.name.text === 'getByRole');
              let dependsOnLabel = false;
              function inspectDependency(child) {
                if (ts.isIdentifier(child) && child.text === label) dependsOnLabel = true;
                ts.forEachChild(child, inspectDependency);
              }
              inspectDependency(root);
              if (directScope && !dependsOnLabel) {
                conflictingScope ||= Boolean(fixedScope && fixedScope !== rootText);
                fixedScope = rootText;
                labelledScope = true;
              }
            }
          }
        }
        ts.forEachChild(part, inspect);
      }
      inspect(declaration.body);
      if (canonicalTile && canonicalValue && labelledScope && !conflictingScope) {
        if (readers.has(name.text)) ambiguousReaders.add(name.text);
        readers.set(name.text, { arguments: parameters.length, fixedScope });
      }
    }
    ts.forEachChild(node, findReaders);
  }
  findReaders(tree);
  const edits = [];
  const deferred = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      ['toBe', 'toEqual', 'toContain'].includes(node.expression.name.text) &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === '—' &&
      callNamed(node.expression.expression, 'expect')) {
      const argument = node.expression.expression.arguments[0];
      if (argument && ts.isCallExpression(argument) && ts.isIdentifier(argument.expression) &&
        readers.has(argument.expression.text) && !ambiguousReaders.has(argument.expression.text) &&
        argument.arguments.length === readers.get(argument.expression.text).arguments &&
        ts.isStringLiteral(argument.arguments.at(-1))) {
        const reader = readers.get(argument.expression.text);
        const scope = reader.fixedScope ?? argument.arguments[0].getText(tree);
        const label = argument.arguments.at(-1).getText(tree);
        const original = node.getText(tree);
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        if (hasNonRenderingBriefDouble(tree) || unsafeAncestor(node)) {
          deferred.push({ line, original, reason: 'Mocked renderer or polling assertion: inspect manually' });
        } else {
          edits.push({ start: node.getStart(tree), end: node.end, line, original,
            replacement: `assertOperationalMetricUnavailable(${scope}, ${label})` });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  let output = source;
  for (const edit of edits.toSorted((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  if (edits.length) {
    const existing = tree.statements.find(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === moduleName);
    if (existing?.importClause?.namedBindings && ts.isNamedImports(existing.importClause.namedBindings)) {
      const bindings = existing.importClause.namedBindings;
      if (!bindings.elements.some(element => element.name.text === 'assertOperationalMetricUnavailable')) {
        output = output.slice(0, bindings.getStart(tree) + 1) + ' assertOperationalMetricUnavailable,' + output.slice(bindings.getStart(tree) + 1);
      }
    } else {
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      const firstImport = tree.statements.find(ts.isImportDeclaration);
      const at = firstImport ? firstImport.getStart(tree) : 0;
      output = output.slice(0, at) + `import { assertOperationalMetricUnavailable } from '${moduleName}';${newline}` + output.slice(at);
    }
  }
  return { output, edits, deferred };
}

function allTests(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? allTests(full) : /\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function main() {
  const args = process.argv.slice(2);
  const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const failures = value('--failures');
  const files = failures
    ? [...new Set(JSON.parse(fs.readFileSync(path.resolve(failures), 'utf8')).map(row => path.resolve(root, row.file)))].sort()
    : allTests(path.join(root, 'src')).sort();
  const inventory = [];
  for (const file of files) {
    const migrate = args.includes('--missing-metrics') ? migrateMissingMetricTests : migrateBriefDisclosureTests;
    const result = migrate(fs.readFileSync(file, 'utf8'), file, { contexts: args.includes('--contexts') });
    if (!result.edits.length && !result.deferred.length) continue;
    inventory.push({ file: path.relative(root, file).replaceAll('\\', '/'), edits: result.edits, deferred: result.deferred });
    if (args.includes('--write') && result.edits.length) fs.writeFileSync(file, result.output);
  }
  const summary = {
    mode: args.includes('--write') ? 'write' : 'dry-run',
    files: inventory.filter(row => row.edits.length).length,
    assertions: inventory.reduce((sum, row) => sum + row.edits.length, 0),
    deferred: inventory.reduce((sum, row) => sum + row.deferred.length, 0),
  };
  const report = value('--report');
  if (report) fs.writeFileSync(path.resolve(report), JSON.stringify({ summary, inventory }, null, 2) + '\n');
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
