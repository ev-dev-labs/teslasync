#!/usr/bin/env node

// Precise guards for the shared-pattern adoption plan. This module exposes
// source scanners for hermetic tests and a repository CLI for package scripts.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import ts from 'typescript';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC_ROOT = join(PACKAGE_ROOT, 'src');

function posixPath(path) {
  return path.split(sep).join('/');
}

function walk(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '__tests__', '__mocks__', 'test', 'tests', 'e2e'].includes(entry.name)) {
        files.push(...walk(file));
      }
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith('.d.ts')) {
      continue;
    }
    files.push(file);
  }
  return files;
}

function createSource(rel, source) {
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, kind);
  return sf;
}

function lineFor(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function finding(rule, rel, sf, node, fix) {
  return {
    rule,
    file: rel,
    line: lineFor(sf, node),
    fix,
  };
}

const INCOMPLETE_BETA_NAMES = new Set([
  'lnGamma',
  'betacf',
  'betaContinuedFraction',
  'regularizedIncompleteBeta',
  'betaQuantile',
]);

export function scanIncompleteBetaGuard(source, { rel = 'src/lib/example.ts' } = {}) {
  const sf = createSource(rel, source);
  const findings = [];
  const visit = (node) => {
    let name = null;
    if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) name = node.name.text;
    if (name && INCOMPLETE_BETA_NAMES.has(name) && !rel.endsWith('/src/lib/statistics.ts')) {
      findings.push(finding(
        'SP-1',
        rel,
        sf,
        node,
        'Use src/lib/statistics.ts regularizedIncompleteBeta(x, a, b) and betaQuantile(p, a, b).',
      ));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

const CHARGER_ADOPTERS = new Map([
  ['src/features/charging/lib/chargeInterruption.ts', 'groupSiteKey'],
  ['src/features/charging/lib/chargerHealth.ts', 'siteKeyOf'],
  ['src/features/charging/lib/chargerResilience.ts', 'resolveResilienceSite'],
]);

export function scanChargerIdentityGuard(source, { rel = 'src/features/charging/lib/example.ts' } = {}) {
  const sf = createSource(rel, source);
  const findings = [];
  const expectedName = CHARGER_ADOPTERS.get(rel);
  if (!expectedName) return findings;

  const importsCanonical = /from ['"](?:@\/features\/charging\/lib\/siteIdentity|\.\.?\/siteIdentity)['"]/u.test(source)
    && /\bnormalizePlaceGeoSite\b/u.test(source);
  const callsCanonical = /\bnormalizePlaceGeoSite\s*\(/u.test(source);
  if (!importsCanonical || !callsCanonical) {
    const node = sf.statements[0] ?? sf;
    findings.push(finding(
      'SP-2',
      rel,
      sf,
      node,
      `Adopt normalizePlaceGeoSite in ${expectedName}(); keep resilience-only fallback policy local.`,
    ));
  }

  const visit = (node) => {
    let name = null;
    if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) name = node.name.text;
    if (name === expectedName && !callsCanonical) {
      findings.push(finding(
        'SP-2',
        rel,
        sf,
        node,
        'This site resolver must delegate place/geo identity to normalizePlaceGeoSite.',
      ));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

export function scanIconAdoptionGuard(source, { rel = 'src/features/example/Page.tsx' } = {}) {
  const sf = createSource(rel, source);
  const findings = [];
  const isFeatureScope = /^src\/(?:features|pages)\//u.test(rel);
  if (!isFeatureScope) return findings;

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === 'lucide-react') {
      findings.push(finding(
        'SP-10',
        rel,
        sf,
        node,
        'Import icons through src/lib/icons.ts (Icons.<concept>) or a shared UI export.',
      ));
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (
        /(?:icon\s*map|iconmap|icons|iconmap)/iu.test(name.replace(/[_-]/gu, ' '))
        && ts.isObjectLiteralExpression(node.initializer)
      ) {
        findings.push(finding(
          'SP-10',
          rel,
          sf,
          node,
          'Register missing concepts in src/lib/icons.ts and route feature icon keys through Icons.',
        ));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

export function scanTimezoneGuard(source, { rel = 'src/features/example/example.ts' } = {}) {
  const sf = createSource(rel, source);
  const findings = [];
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node)) {
      const member = node.name.text;
      if (
        member === 'getTimezoneOffset'
        || member === 'setHours'
        || member === 'setMinutes'
        || member === 'setSeconds'
        || member === 'setMilliseconds'
        || member === 'setUTCDate'
        || member === 'setUTCFullYear'
        || member === 'setUTCHours'
        || member === 'setUTCMinutes'
        || member === 'setUTCSeconds'
        || member === 'setUTCMilliseconds'
        || member === 'toLocaleString'
        || member === 'toLocaleDateString'
        || member === 'toLocaleTimeString'
      ) {
        const isNewDateLocale = member.startsWith('toLocale')
          && ts.isCallExpression(node.parent)
          && ts.isNewExpression(node.expression);
        if (
          member !== 'getTimezoneOffset'
          && !member.startsWith('set')
          && !member.startsWith('toLocale')
        ) {
          // Reserved for future member-specific narrowing.
        }
        if (
          member.startsWith('set')
          || member === 'getTimezoneOffset'
          || member === 'toLocaleString'
          || member === 'toLocaleDateString'
          || member === 'toLocaleTimeString'
          || isNewDateLocale
        ) {
          findings.push(finding(
            'SP-11',
            rel,
            sf,
            node,
            member.startsWith('toLocale')
              ? 'Use src/lib/dateFormat.ts, dateConvert.ts, or useDateFormat at the render boundary.'
              : 'Use src/lib/dateConvert.ts/dateRange.ts; do not perform inline timezone arithmetic.',
          ));
        }
      }
      if (member === 'UTC' && ts.isIdentifier(node.expression) && node.expression.text === 'Date') {
        findings.push(finding(
          'SP-11',
          rel,
          sf,
          node,
          'Use dateRange.ts or dateConvert.ts for UTC/calendar boundaries.',
        ));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

const UNIT_FACTORS = new Map([
  ['1609.344', 'meters per mile'],
  ['1_609_344', 'meters per mile'],
  ['1.609344', 'kilometers per mile'],
  ['0.621371', 'miles per kilometer'],
  ['0.621371192237334', 'miles per kilometer'],
  ['0.06894757', 'bar per psi'],
  ['14.5037738', 'psi per bar'],
  ['0.000145037738', 'psi per pascal'],
  ['1000_000', 'watts per megawatt'],
]);

export function scanUnitFactorGuard(source, { rel = 'src/features/example/example.ts' } = {}) {
  const sf = createSource(rel, source);
  const findings = [];
  const canonicalUnitFiles = new Set([
    'src/lib/unitConversion.ts',
    'src/lib/unitConversion.test.ts',
  ]);
  if (canonicalUnitFiles.has(rel) || /\.(test|spec)\.(ts|tsx)$/.test(rel) || rel.includes('/__tests__/')) {
    return findings;
  }

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (/^(?:.*(?:distance|speed|energy|power|pressure|temperature|temp|efficiency).*?(?:mi|mph|kwh|kw|psi|f))$/iu.test(node.name.text)) {
        findings.push(finding(
          'SP-12',
          rel,
          sf,
          node,
          'Do not introduce unit-suffixed local values; use SI names and convert at the display boundary.',
        ));
      }
    }
    if (ts.isNumericLiteral(node)) {
      const raw = node.getText(sf);
      const factor = UNIT_FACTORS.has(raw) ? UNIT_FACTORS.get(raw) : null;
      const parent = node.parent;
      const unitScalingExpression = parent && ts.isBinaryExpression(parent)
        && (parent.operatorToken.kind === ts.SyntaxKind.PlusToken
          || parent.operatorToken.kind === ts.SyntaxKind.MinusToken)
        ? false
        : parent && ts.isBinaryExpression(parent)
          && (parent.operatorToken.kind === ts.SyntaxKind.AsteriskToken
            || parent.operatorToken.kind === ts.SyntaxKind.SlashToken);
      const scalingFactor = raw === '1000' || raw === '1_000' ? 'SI scale factor (1000)' : null;
      if (factor || (unitScalingExpression && scalingFactor)) {
        const description = factor ?? scalingFactor;
        findings.push(finding(
          'SP-12',
          rel,
          sf,
          node,
          `Do not inline the ${description} factor; use src/lib/unitConversion.ts or src/hooks/useUnits.ts.`,
        ));
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const member = node.name.text;
      if (/^(distance_mi|distanceMi|avg_speed_mph|avgSpeedMph|max_speed_mph|maxSpeedMph|energy_used_kwh|energyUsedKwh|regen_kwh|regenKwh)$/u.test(member)) {
        findings.push(finding(
          'SP-12',
          rel,
          sf,
          node,
          'Read SI fields from canonical API types; convert only at the display/API boundary.',
        ));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

const RAW_HTML_TAGS = new Set([
  'button',
  'input',
  'textarea',
  'select',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
]);
const DIRECT_LIBRARIES = new Set(['recharts', 'react-leaflet', 'framer-motion']);

export function scanUiAdoptionGuard(source, { rel = 'src/features/example/Page.tsx' } = {}) {
  const sf = createSource(rel, source);
  const findings = [];
  const isFeatureScope = /^src\/(?:features|pages)\//u.test(rel);
  const isHookScope = /^src\/(?:api\/hooks|api)\//u.test(rel);

  const visit = (node) => {
    if (isFeatureScope && ts.isJsxAttribute(node) && node.name.text === 'style' && node.initializer
      && ts.isJsxExpression(node.initializer) && node.initializer.expression
      && ts.isObjectLiteralExpression(node.initializer.expression)) {
      for (const property of node.initializer.expression.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.initializer)) continue;
        const value = property.initializer.text;
        if (/var\(--[^)]+\)/u.test(value)) {
          findings.push(finding(
            'SP-13',
            rel,
            sf,
            property,
            'Replace static CSS-variable inline style with a Tailwind class; no exception marker bypasses this guard.',
          ));
        }
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      if (isFeatureScope && DIRECT_LIBRARIES.has(from)) {
        const barrel = from === 'recharts'
          ? '@/components/charts'
          : from === 'react-leaflet'
            ? '@/components/maps'
            : '@/components/motion';
        findings.push(finding(
          'SP-13',
          rel,
          sf,
          node,
          `Import ${from} through ${barrel}.`,
        ));
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : '';
      if (RAW_HTML_TAGS.has(tag.toLowerCase()) && tag === tag.toLowerCase() && isFeatureScope) {
        const replacement = ({
          button: 'Button/IconButton',
          input: 'Input',
          textarea: 'Textarea',
          select: 'Select',
          table: 'DataTable',
          thead: 'DataTable',
          tbody: 'DataTable',
          tfoot: 'DataTable',
          tr: 'DataTable',
          th: 'DataTable',
          td: 'DataTable',
        })[tag.toLowerCase()];
        findings.push(finding(
          'SP-13',
          rel,
          sf,
          node,
          `Use the shared ${replacement} primitive instead of raw <${tag}>.`,
        ));
      }
    }

    if (ts.isStringLiteral(node) && node.text.includes('/api/v1/')) {
      if (isFeatureScope || isHookScope) {
        findings.push(finding(
          'SP-13',
          rel,
          sf,
          node,
          'request() already adds /api/v1; hooks must use a route such as /vehicles.',
        ));
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isNavigate = ts.isIdentifier(callee)
        ? callee.text === 'navigate'
        : ts.isPropertyAccessExpression(callee) && callee.name.text === 'navigate';
      if (
        isNavigate
        && node.arguments[0]
        && ts.isStringLiteral(node.arguments[0])
        && /^\/(?:[^/]|\s)/u.test(node.arguments[0].text)
        && !node.arguments[0].text.startsWith('/api')
      ) {
        findings.push(finding(
          'SP-13',
          rel,
          sf,
          node.arguments[0],
          'Use the typed route registry/route helper instead of a hardcoded navigate string.',
        ));
      }
    }
    if (ts.isJsxAttribute(node) && (node.name.text === 'to' || node.name.text === 'href')) {
      const parentTag = node.parent?.parent?.tagName;
      const tag = ts.isIdentifier(parentTag) ? parentTag.text : '';
      if (['Link', 'NavLink', 'PrefetchLink', 'a'].includes(tag)
        && node.initializer && ts.isStringLiteral(node.initializer)) {
        findings.push(finding(
          'SP-13',
          rel,
          sf,
          node.initializer,
          'Use a typed route registry entry or route helper instead of a hardcoded route.',
        ));
      }
    }

    let localStorageAccess = ts.isIdentifier(node) && node.text === 'localStorage';
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'localStorage') {
      localStorageAccess = true;
    }
    if (localStorageAccess) {
      const inSharedStorage = rel.startsWith('src/lib/');
      if (!inSharedStorage && (isFeatureScope || rel.startsWith('src/hooks/'))) {
        const parent = node.parent;
        const declarationLike = ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.name.text === node.text
          || ts.isImportSpecifier(parent)
          || ts.isPropertyAccessExpression(parent) && parent.name === node;
        if (!declarationLike) {
          findings.push(finding(
            'SP-13',
            rel,
            sf,
            node,
            'Use a typed shared storage primitive from src/lib instead of feature-local localStorage access.',
          ));
        }
      }
    }
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && /^(getItem|setItem|removeItem|clear)$/u.test(node.expression.name.text)
      && (
        node.expression.expression.getText(sf) === 'localStorage'
        || node.expression.expression.getText(sf) === 'window.localStorage'
      )
    ) {
      const inSharedStorage = rel.startsWith('src/lib/');
      if (!inSharedStorage && (isFeatureScope || rel.startsWith('src/hooks/'))) {
        findings.push(finding(
          'SP-13',
          rel,
          sf,
          node,
          'Use a typed shared storage primitive from src/lib instead of feature-local localStorage access.',
        ));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

export function _scanSourceForTest(source, { rel = 'src/features/example/Page.tsx', guards = ['all'] } = {}) {
  const selected = new Set(guards.includes('all') ? ['SP-1', 'SP-2', 'SP-10', 'SP-11', 'SP-12', 'SP-13'] : guards);
  const scanners = [
    ['SP-1', scanIncompleteBetaGuard],
    ['SP-2', scanChargerIdentityGuard],
    ['SP-10', scanIconAdoptionGuard],
    ['SP-11', scanTimezoneGuard],
    ['SP-12', scanUnitFactorGuard],
    ['SP-13', scanUiAdoptionGuard],
  ];
  return scanners.flatMap(([rule, scan]) => selected.has(rule) ? scan(source, { rel }) : []);
}

function scanRepository() {
  const findings = [];
  for (const file of walk(SRC_ROOT)) {
    const rel = posixPath(relative(PACKAGE_ROOT, file));
    const source = readFileSync(file, 'utf8');
    findings.push(..._scanSourceForTest(source, { rel }));
  }
  return findings;
}

function main() {
  const guardArg = process.argv.find((arg) => arg.startsWith('--guard='));
  const guard = guardArg ? guardArg.slice('--guard='.length) : 'all';
  const guardMap = {
    all: ['SP-1', 'SP-2', 'SP-10', 'SP-11', 'SP-12', 'SP-13'],
    statistics: ['SP-1'],
    'incomplete-beta': ['SP-1'],
    charger: ['SP-2'],
    'charger-identity': ['SP-2'],
    icons: ['SP-10'],
    'lucide-icons': ['SP-10'],
    timezone: ['SP-11'],
    units: ['SP-12'],
    'unit-factors': ['SP-12'],
    ui: ['SP-13'],
    'ui-adoption': ['SP-13'],
  };
  const guards = guardMap[guard] ?? ['SP-1', 'SP-2', 'SP-10', 'SP-11', 'SP-12', 'SP-13'];
  const findings = scanRepository().filter((finding) => guards.includes(finding.rule));

  if (process.argv.includes('--report') || process.argv.includes('--json')) {
    console.log(JSON.stringify(findings, null, 2));
  } else if (findings.length === 0) {
    console.log(`[shared-pattern-guards:${guard}] OK — no findings`);
  } else {
    console.error(`[shared-pattern-guards:${guard}] VIOLATIONS:`);
    for (const finding of findings) {
      console.error(`  - ${finding.file}:${finding.line} ${finding.rule} ${finding.fix}`);
    }
  }
  if (findings.length > 0) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
