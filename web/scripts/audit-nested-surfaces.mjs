import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const SOURCE_ROOT = path.resolve('src');
const surfaceTags = new Set([
  'Card', 'GlassPanel', 'LayoutCard', 'Panel', 'SectionCard', 'SectionSurface',
  'WidgetShell',
]);
const cardTags = new Set([...surfaceTags, 'OperationalBrief']);
const knownEmbeddedWrappers = new Set([
  'ChargingSummaryBrief', 'DashboardSourceBrief', 'FleetOperationsBrief', 'SourceAvailabilityBrief',
]);
const headingTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'Heading', 'PanelTitle', 'PageTitle']);

function collectFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(file, files);
    else if (file.endsWith('.tsx')) files.push(file);
  }
  return files;
}

function jsxTag(node) {
  return node.tagName.getText();
}

function embeddedAttribute(opening, sourceFile) {
  return opening.attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute)) return false;
    const name = attribute.name.getText(sourceFile);
    const value = attribute.initializer?.getText(sourceFile) ?? '';
    if (name === 'variant') return /["']embedded["']/.test(value);
    if (name === 'embedded') return value === '' || value === 'true';
    return false;
  });
}

function titleIdentity(node, sourceFile) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isJsxExpression(node) && node.expression) {
    const expression = node.expression;
    if (ts.isStringLiteral(expression)) return expression.text;
    if (ts.isCallExpression(expression) && expression.arguments.length) {
      const first = expression.arguments[0];
      if (ts.isStringLiteral(first)) return `i18n:${first.text}`;
    }
  }
  return null;
}

function openingTitle(opening, sourceFile) {
  const title = opening.attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'title');
  return title?.initializer ? titleIdentity(title.initializer, sourceFile) : null;
}

function headingIdentity(element, sourceFile) {
  let text = '';
  for (const child of element.children ?? []) {
    if (ts.isJsxText(child)) text += child.text.trim();
    else if (ts.isJsxExpression(child) && child.expression) {
      const identity = titleIdentity(child, sourceFile);
      if (identity) text += identity;
    }
  }
  return text || null;
}

export function analyzeNestedSurfaces(root = SOURCE_ROOT) {
  const nestedBriefs = [];
  const nestedSurfaces = [];
  const duplicateTitles = [];

  for (const file of collectFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const relativeFile = path.relative(process.cwd(), file).replaceAll(path.sep, '/');

    function visit(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = jsxTag(opening);
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        let parent = node.parent;
        const ancestors = [];
        while (parent) {
          if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) {
            const parentOpening = ts.isJsxElement(parent) ? parent.openingElement : parent;
            if (surfaceTags.has(jsxTag(parentOpening))) ancestors.push(jsxTag(parentOpening));
          }
          parent = parent.parent;
        }

        const isBrief = tag === 'OperationalBrief' || tag.endsWith('Brief');
        if (surfaceTags.has(tag) && ancestors.length && !embeddedAttribute(opening, sourceFile)) {
          nestedSurfaces.push({ file: relativeFile, line: position, tag, ancestors: ancestors.reverse() });
        }
        if (isBrief && ancestors.length && !embeddedAttribute(opening, sourceFile)
            && !knownEmbeddedWrappers.has(tag)) {
          nestedBriefs.push({ file: relativeFile, line: position, tag, ancestors: ancestors.reverse() });
        }

        if (ts.isJsxElement(node)) {
          const directHeadings = node.children.flatMap((child) => {
            if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) return [];
            const childOpening = ts.isJsxElement(child) ? child.openingElement : child;
            return headingTags.has(jsxTag(childOpening)) ? [headingIdentity(child, sourceFile)].filter(Boolean) : [];
          });
          const nestedCardTitles = [];
          function findTitles(child) {
            if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
              const childOpening = ts.isJsxElement(child) ? child.openingElement : child;
              const hiddenHeading = childOpening.attributes.properties.some((attribute) =>
                ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'hideHeading'
                  && (!attribute.initializer || attribute.initializer.getText(sourceFile) === 'true'));
              if (hiddenHeading) return;
              if (cardTags.has(jsxTag(childOpening)) || jsxTag(childOpening).endsWith('Brief')) {
                const identity = openingTitle(childOpening, sourceFile);
                if (identity) nestedCardTitles.push(identity);
              }
            }
            ts.forEachChild(child, findTitles);
          }
          for (const child of node.children) findTitles(child);
          for (const heading of directHeadings) {
            for (const title of nestedCardTitles) {
              if (heading === title || heading === title.replace(/^i18n:/, '')) {
                duplicateTitles.push({ file: relativeFile, line: position, title: heading });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  return { nestedBriefs, nestedSurfaces, duplicateTitles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { nestedBriefs, nestedSurfaces, duplicateTitles } = analyzeNestedSurfaces();
  for (const item of nestedSurfaces) console.error(`${item.file}:${item.line} <${item.tag}> inside ${item.ancestors.join(' > ')}`);
  for (const item of nestedBriefs) console.error(`${item.file}:${item.line} <${item.tag}> inside ${item.ancestors.join(' > ')}`);
  for (const item of duplicateTitles) console.error(`${item.file}:${item.line} repeated title: ${item.title}`);
  console.log(`[nested-surfaces] standalone nested briefs: ${nestedBriefs.length}; nested bordered surfaces: ${nestedSurfaces.length}; duplicate heading/title pairs: ${duplicateTitles.length}`);
  if (nestedBriefs.length || nestedSurfaces.length || duplicateTitles.length) process.exitCode = 1;
}
