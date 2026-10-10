#!/usr/bin/env node
// Shared chart-frame adoption audit.
//
// Every ResponsiveContainer in feature code must be nested inside
// a shared frame or an adapter proven to forward its children into one.
// ChartContainer, AnalyticsChartPanel, and EmbeddedChart are the roots. The JSX
// AST is inspected per ResponsiveContainer, so a compliant chart elsewhere in
// the same file cannot conceal a raw chart island and strings/comments cannot
// spoof frame adoption.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveSourceImport } from './i18n-source-graph.mjs';

const ROOT = path.resolve(process.cwd(), 'src', 'features');

export function createFrameResolver(sourceRoot) {
  const sources = new Map();
  const verified = new Map();
  const checking = new Set();
  const roots = new Set([
    `${path.join(sourceRoot, 'components', 'charts', 'ChartContainer.tsx')}#ChartContainer`,
    `${path.join(sourceRoot, 'components', 'charts', 'EmbeddedChart.tsx')}#EmbeddedChart`,
    `${path.join(sourceRoot, 'features', 'analytics', 'components', 'analytics', 'AnalyticsChartPanel.tsx')}#AnalyticsChartPanel`,
  ]);
  const sourceOf = file => {
    if (!sources.has(file)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      if (source.parseDiagnostics.length) throw new Error(`Cannot parse chart frame dependency: ${file}`);
      sources.set(file, source);
    }
    return sources.get(file);
  };
  const resolveBinding = (file, name, seen = new Set()) => {
    const key = `${file}#${name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const source = sourceOf(file);
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
        return { file, name, declaration: statement };
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name && roots.has(key)) {
            return { file, name, declaration };
          }
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name
            && declaration.initializer
            && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
            return { file, name, declaration: declaration.initializer };
          }
        }
      }
      if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) {
        const bindings = statement.importClause?.namedBindings;
        const binding = bindings && ts.isNamedImports(bindings)
          ? bindings.elements.find(element => !element.isTypeOnly && element.name.text === name)
          : null;
        if (binding) {
          const target = resolveSourceImport(sourceRoot, file, statement.moduleSpecifier.text);
          return target ? resolveBinding(target, binding.propertyName?.text ?? name, seen) : null;
        }
      }
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
        const bindings = statement.exportClause;
        const binding = bindings && ts.isNamedExports(bindings)
          ? bindings.elements.find(element => !element.isTypeOnly && element.name.text === name)
          : null;
        if (binding || !bindings) {
          const target = statement.moduleSpecifier
            ? resolveSourceImport(sourceRoot, file, statement.moduleSpecifier.text) : file;
          if (target) {
            const found = resolveBinding(target, binding?.propertyName?.text ?? name, new Set(seen));
            if (found) return found;
          }
        }
      }
    }
    return null;
  };
  const isFrame = (file, name) => {
    const binding = resolveBinding(file, name);
    if (!binding) return false;
    const key = `${binding.file}#${binding.name}`;
    if (roots.has(key)) return true;
    if (verified.has(key)) return verified.get(key);
    if (checking.has(key)) return false;
    checking.add(key);
    const parameter = binding.declaration.parameters[0]?.name;
    let childrenName;
    let propsName;
    if (parameter && ts.isIdentifier(parameter)) propsName = parameter.text;
    if (parameter && ts.isObjectBindingPattern(parameter)) {
      const child = parameter.elements.find(element =>
        !element.dotDotDotToken && (element.propertyName ?? element.name).getText() === 'children');
      if (child && ts.isIdentifier(child.name)) childrenName = child.name.text;
      if (!child) {
        const rest = parameter.elements.find(element => element.dotDotDotToken);
        if (rest && ts.isIdentifier(rest.name)) propsName = rest.name.text;
      }
    }
    const carriesChildren = node => !!node && (
      (childrenName && ts.isIdentifier(node) && node.text === childrenName)
      || (propsName && ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === propsName && node.name.text === 'children')
    );
    const beneathFrame = node => {
      for (let parent = node.parent; parent && parent !== binding.declaration; parent = parent.parent) {
        if (ts.isJsxElement(parent) && isFrame(binding.file, tagName(parent.openingElement))) return true;
      }
      return false;
    };
    let forwarded = false;
    let unsafe = false;
    const visit = node => {
      if (node !== binding.declaration.body && ts.isFunctionLike(node)) return;
      if (ts.isJsxExpression(node) && carriesChildren(node.expression)) {
        const attribute = node.parent;
        const opening = ts.isJsxAttribute(attribute) ? attribute.parent.parent : null;
        const framed = opening
          ? attribute.name.getText() === 'children' && isFrame(binding.file, tagName(opening))
          : beneathFrame(node);
        forwarded ||= framed;
        unsafe ||= !framed;
      }
      if (ts.isJsxSpreadAttribute(node) && propsName
        && ts.isIdentifier(node.expression) && node.expression.text === propsName) {
        const framed = isFrame(binding.file, tagName(node.parent.parent));
        forwarded ||= framed;
        unsafe ||= !framed;
      }
      ts.forEachChild(node, visit);
    };
    if (binding.declaration.body) visit(binding.declaration.body);
    const result = forwarded && !unsafe;
    checking.delete(key);
    verified.set(key, result);
    return result;
  };
  return isFrame;
}

function walk(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const name of entries) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') {
        files.push(...walk(full));
      }
      continue;
    }

    if (
      stat.isFile()
      && full.endsWith('.tsx')
      && !full.endsWith('.test.tsx')
    ) {
      files.push(full);
    }
  }

  return files;
}

function tagName(node) {
  return node.tagName.getText();
}

function hasFrameAncestor(node, file, isFrame) {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      ts.isJsxElement(ancestor)
      && isFrame(file, tagName(ancestor.openingElement))
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
}

export function auditFile(file, isFrame = createFrameResolver(path.resolve(process.cwd(), 'src'))) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('<ResponsiveContainer')) {
    return { responsive: 0, framed: 0, offenders: [] };
  }

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const offenders = [];
  let responsive = 0;
  let framed = 0;

  function visit(node) {
    const openingElement = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;

    if (openingElement && tagName(openingElement) === 'ResponsiveContainer') {
      responsive += 1;
      if (hasFrameAncestor(node, file, isFrame)) {
        framed += 1;
      } else {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        offenders.push({
          line: line + 1,
          reason:
            'ResponsiveContainer is not nested inside a shared chart frame or a verified child-forwarding adapter',
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { responsive, framed, offenders };
}

export function runAudit(root = ROOT) {
  const isFrame = createFrameResolver(path.dirname(root));
  const offenders = [];
  let responsiveCount = 0;
  let framedCount = 0;
  let filesWithCharts = 0;

  for (const file of walk(root)) {
    const result = auditFile(file, isFrame);
    if (result.responsive > 0) filesWithCharts += 1;
    responsiveCount += result.responsive;
    framedCount += result.framed;

    const relative = path.relative(process.cwd(), file).replace(/\\/g, '/');
    for (const offender of result.offenders) {
      offenders.push(`${relative}:${offender.line} — ${offender.reason}`);
    }
  }

  console.log(
    `[audit:chart-frame] files: ${filesWithCharts}, ResponsiveContainer: ${responsiveCount}, framed: ${framedCount}, raw: ${offenders.length}`,
  );

  if (offenders.length > 0) {
    console.error(
      '\n[audit:chart-frame] ERROR — raw feature charts bypass the production chart contract:',
    );
    for (const offender of offenders) console.error(`  · ${offender}`);
    console.error(
      '\nWrap each chart in ChartContainer, AnalyticsChartPanel, or EmbeddedChart. '
        + 'Use EmbeddedChart when an existing GlassPanel or widget already owns the visual surface.',
    );
    return 1;
  }

  console.log(
    'OK — every feature ResponsiveContainer is nested inside a shared chart frame or a verified adapter',
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (runAudit() !== 0) process.exitCode = 1;
}
