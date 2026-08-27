#!/usr/bin/env node
/**
 * Chart platform safety gate.
 *
 * This intentionally complements the feature adoption/a11y gates rather than
 * replacing them: it protects the shared layer that every chart relies on.
 * Run with `node scripts/audit-chart-safety.mjs`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const scriptPath = fileURLToPath(import.meta.url);
const webRoot = resolve(dirname(scriptPath), '..');
const chartsRoot = join(webRoot, 'src', 'components', 'charts');
const featuresRoot = join(webRoot, 'src', 'features');
const isMain = Boolean(
  !new URL(import.meta.url).search
  && process.argv[1]
  && resolve(process.argv[1]) === scriptPath,
);

/** `connectNulls` is true when JSX uses shorthand or explicitly sets true. */
/**
 * Return positions of JSX `connectNulls` attributes that are shorthand or
 * literal `true`. TypeScript's TSX parser keeps strings, template literals,
 * comments, and JSX text out of the attribute list, avoiding false positives
 * from prose and URLs while preserving the original source offsets.
 */
export function findUnsafeConnectNulls(source, fileName = 'chart.tsx') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  const positions = [];
  const visit = (node) => {
    const attributes = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)
      ? node.attributes.properties
      : null;
    if (attributes) {
      for (const attribute of attributes) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.text !== 'connectNulls') continue;
        const initializer = attribute.initializer;
        const isLiteralTrue = initializer != null && ts.isJsxExpression(initializer)
          && initializer.expression?.kind === ts.SyntaxKind.TrueKeyword;
        if (!initializer || isLiteralTrue) positions.push(attribute.getStart(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return positions;
}

/** Parser diagnostics with original source positions for actionable audit failures. */
export function chartParseDiagnostics(source, fileName = 'chart.tsx') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  return sourceFile.parseDiagnostics.map((diagnostic) => ({
    position: diagnostic.start ?? 0,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
  }));
}

if (isMain && process.env.CHART_AUDIT_SELF_TEST === '1') {
  const fixtures = [
    ['<Area connectNulls />', true],
    ['<Area connectNulls stroke="#0ff" />', true],
    ['<Area connectNulls {...props} />', true],
    ['<Area connectNulls {condition && <X />} />', true],
    ['<Area\n  dataKey="speed"\n  connectNulls\n  stroke="#0ff"\n/>', true],
    ['<Line connectNulls={true} />', true],
    ['<Line connectNulls={false} />', false],
    ['// <Area connectNulls />', false],
    ['/* <Area connectNulls /> */', false],
  ];
  for (const [source, expected] of fixtures) {
    if ((findUnsafeConnectNulls(source).length > 0) !== expected) {
      throw new Error(`connectNulls audit fixture failed: ${source}`);
    }
  }
  const diagnosticFixture = [
    '/* generated chart wrapper',
    ' * with a long header',
    ' */',
    '// another header comment',
    '',
    'const chart = (',
    '  <Area',
    '    dataKey="speed"',
    '    connectNulls',
    '    stroke="#0ff"',
    '  />',
    ');',
  ].join('\n');
  const [position] = findUnsafeConnectNulls(diagnosticFixture);
  if (position == null || lineOf(diagnosticFixture, position) !== 9) {
    throw new Error('connectNulls audit diagnostic fixture did not retain source line 9');
  }
  const parserFixtures = [
    ["<Line label='https://docs.example' connectNulls />", true],
    ["const prose = 'connectNulls is permitted';", false],
    ['<p>connectNulls is permitted</p>', false],
    ["const code = 'connectNulls={true}';", false],
  ];
  for (const [source, expected] of parserFixtures) {
    if ((findUnsafeConnectNulls(source).length > 0) !== expected) {
      throw new Error(`connectNulls parser fixture failed: ${source}`);
    }
  }
  for (const source of ['const x = `unterminated;', '/* unterminated']) {
    if (chartParseDiagnostics(source).length === 0) {
      throw new Error(`chart parser fixture did not report malformed source: ${source}`);
    }
    for (const source of [
      'const identity = <T>(value: T) => value;',
      'const asserted = value as number;',
    ]) {
      if (chartParseDiagnostics(source, 'fixture.ts').length > 0) {
        throw new Error(`TypeScript parser fixture reported bogus diagnostics: ${source}`);
      }
    }
  }
  const importProbe = await import(
    `${new URL('./audit-chart-safety.mjs', import.meta.url).href}?probe=${Date.now()}`
  );
  if (typeof importProbe.findUnsafeConnectNulls !== 'function') {
    throw new Error('chart audit import-side-effect probe could not access exported helper');
  }
  console.log('[audit:chart-safety] connectNulls fixtures OK');
}

function walk(root, predicate) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full, predicate));
    else if (predicate(full)) files.push(full);
  }
  return files;
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function main() {
  const failures = [];
  const chartFiles = walk(chartsRoot, (file) => file.endsWith('.ts') || file.endsWith('.tsx'));
  for (const file of chartFiles) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const source = readFileSync(file, 'utf8');
    for (const diagnostic of chartParseDiagnostics(source, file)) {
      failures.push(
        `${relative(webRoot, file)}:${lineOf(source, diagnostic.position)} parse error: ${diagnostic.message}`,
      );
    }
    for (const position of findUnsafeConnectNulls(source, file)) {
      failures.push(
        `${relative(webRoot, file)}:${lineOf(source, position)} connects missing samples; use connectNulls={false}`,
      );
    }
  }

  const container = readFileSync(join(chartsRoot, 'ChartContainer.tsx'), 'utf8');
  for (const marker of [
  'data-chart-viewport="bounded"',
  'overflow-hidden',
  'max-w-full',
  '[contain:layout_size]',
  'data-chart-state=',
  'data-chart-freshness=',
  ]) {
    if (!container.includes(marker)) {
      failures.push(`ChartContainer.tsx is missing required bounded-geometry/metadata marker: ${marker}`);
    }
  }

  const exportHook = readFileSync(join(webRoot, 'src', 'hooks', 'useChartExport.ts'), 'utf8');
  for (const marker of [
  "import('html2canvas-pro')",
  'captureBackground',
  'ignoreElements:',
  'data-html2canvas-ignore',
  ]) {
    if (!exportHook.includes(marker)) {
      failures.push(`useChartExport.ts is missing required export safety marker: ${marker}`);
    }
  }

  const featureFiles = walk(featuresRoot, (file) => file.endsWith('.tsx'));
  for (const file of featureFiles) {
    const source = readFileSync(file, 'utf8');
    for (const diagnostic of chartParseDiagnostics(source, file)) {
      failures.push(
        `${relative(webRoot, file)}:${lineOf(source, diagnostic.position)} parse error: ${diagnostic.message}`,
      );
    }
    for (const position of findUnsafeConnectNulls(source, file)) {
      failures.push(
        `${relative(webRoot, file)}:${lineOf(source, position)} connects missing samples; use connectNulls={false}`,
      );
    }
    const directImport = /from\s+['"]recharts['"]/.exec(source);
    if (directImport) {
      failures.push(
        `${relative(webRoot, file)}:${lineOf(source, directImport.index)} imports recharts directly; use @/components/charts`,
      );
    }
  }

  if (failures.length) {
    console.error(`[audit:chart-safety] FAIL (${failures.length})`);
    failures.forEach((failure) => console.error(`  ✗ ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    `[audit:chart-safety] OK — ${chartFiles.length} shared chart files checked; ` +
    `${featureFiles.length} feature files checked for direct Recharts imports.`,
  );
}

if (isMain) main();
