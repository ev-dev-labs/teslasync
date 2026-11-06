#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import ts from 'typescript';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex < 0 ? fileURLToPath(new URL('..', import.meta.url)) : process.argv[rootIndex + 1];
const sourceRoot = join(root, 'src');
const tokenModules = new Set([
  'src/components/ui/ThemeProvider.tsx',
  'src/components/ui/themePresets.ts',
  'src/features/dashboard/lib/dashboardTokens.ts',
  'src/lib/colors.ts',
  'src/lib/themeDefaults.ts',
  'src/lib/tokens.ts',
  'src/lib/vehicleColors.ts',
]);
const utility = /\b(?:bg|text|ring|shadow|border(?:-[trblxyse])?|outline|accent|fill|stroke|decoration|caret|divide|from|via|to)-(?:neon-(?:cyan|blue)|(?:cyan|sky|blue|teal|indigo)-\d{2,3})\b/g;
const color = /#[\da-f]{3,8}\b|rgba?\(\s*\d+(?:\.\d+)?%?(?:\s*,\s*|\s+)\d+(?:\.\d+)?%?(?:\s*,\s*|\s+)\d+(?:\.\d+)?%?(?:[^)]*)\)/gi;

function isAccentLike(value) {
  let channels;
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex.slice(0, 3)].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return false;
    channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  } else {
    const values = value.match(/\d+(?:\.\d+)?%?/g);
    if (!values || values.length < 3) return false;
    channels = values.slice(0, 3).map((channel) =>
      Number.parseFloat(channel) / (channel.endsWith('%') ? 100 : 255));
  }
  const [r, g, b] = channels;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (max < 0.35 || delta < 0.2 || delta / max < 0.25) return false;
  const hue = max === r ? 60 * (((g - b) / delta) % 6)
    : max === g ? 60 * ((b - r) / delta + 2)
      : 60 * ((r - g) / delta + 4);
  const normalized = (hue + 360) % 360;
  return normalized >= 170 && normalized <= 240;
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'tests' && entry.name !== 'test') files.push(...walk(path));
    } else if (/\.(?:tsx?|css)$/.test(entry.name)
      && !/\.(?:test|spec|stories|story|d)\.[cm]?tsx?$/.test(entry.name)
      && entry.name !== 'test-setup.ts') {
      files.push(path);
    }
  }
  return files;
}

function isTranslationText(node) {
  const parent = node.parent;
  return ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 't';
}

function auditTypeScript(path, text, findings) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (source.parseDiagnostics.length) throw new Error(`${path}: cannot parse TypeScript`);
  const add = (node, kind, value) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    findings.push(`${path}:${line}: ${kind}: ${value}`);
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const match of node.text.matchAll(utility)) add(node, 'fixed color utility', match[0]);
      for (const match of node.text.matchAll(color)) {
        if (isAccentLike(match[0]) && (!isTranslationText(node) || node.text.trim() === match[0])) {
          add(node, 'fixed accent color', match[0]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function auditCss(path, text, findings) {
  const css = postcss.parse(text, { from: path });
  css.walkRules((rule) => {
    for (const match of rule.selector.matchAll(utility)) {
      findings.push(`${path}:${rule.source.start.line}: fixed color utility: ${match[0]}`);
    }
    rule.walkDecls((declaration) => {
      if (path === 'src/index.css' && declaration.prop.startsWith('--')
        && /^:root(?:[.[][\w-]+(?:=[\w-]+)?\]?)?$/.test(rule.selector.trim())) return;
      for (const match of declaration.value.matchAll(color)) {
        if (isAccentLike(match[0])) {
          findings.push(`${path}:${declaration.source.start.line}: fixed accent color: ${match[0]}`);
        }
      }
    });
  });
}

function auditHtml(path, text, findings) {
  for (const match of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    auditCss(path, match[1], findings);
  }
  for (const match of text.matchAll(/\b(?:class|style|fill|stroke|color)\s*=\s*["']([^"']*)["']/gi)) {
    const line = text.slice(0, match.index).split('\n').length;
    for (const utilityMatch of match[1].matchAll(utility)) {
      findings.push(`${path}:${line}: fixed color utility: ${utilityMatch[0]}`);
    }
    for (const colorMatch of match[1].matchAll(color)) {
      if (isAccentLike(colorMatch[0])) findings.push(`${path}:${line}: fixed accent color: ${colorMatch[0]}`);
    }
  }
}

try {
  const findings = [];
  for (const file of walk(sourceRoot)) {
    const path = relative(root, file).split(sep).join('/');
    if (tokenModules.has(path)) continue;
    const text = readFileSync(file, 'utf8');
    if (file.endsWith('.css')) auditCss(path, text, findings);
    else auditTypeScript(path, text, findings);
  }
  const html = join(root, 'index.html');
  if (existsSync(html)) auditHtml('index.html', readFileSync(html, 'utf8'), findings);
  if (findings.length) {
    for (const finding of findings) console.error(finding);
    console.error(`Accent audit failed: ${findings.length} fixed color use(s).`);
    process.exitCode = 1;
  } else {
    console.log('Accent audit passed: no fixed accent utilities or color literals.');
  }
} catch (error) {
  console.error(`Accent audit could not run: ${error.message}`);
  process.exitCode = 1;
}
