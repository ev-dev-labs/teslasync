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

// Cheap literal pre-filter so the 30s CI budget isn't spent TS-parsing files
// that cannot contain a finding. Every real JSX `<Tag` occurrence contains
// its `<Tag` literal, so substring counting can only OVER-count (comments,
// strings, member expressions) — never under-count. A skipped file provably
// lacks the minimum tag combination for every finding kind:
//   nestedSurfaces: 2+ surface elements (node + ancestor)
//   nestedBriefs:   1+ surface element + 1+ *Brief element
//   duplicateTitles: 1+ heading element + 1+ card/brief element
function countLiteral(source, needle) {
  let count = 0;
  let at = -1;
  while ((at = source.indexOf(needle, at + 1)) >= 0) count++;
  return count;
}

function canContainFinding(source) {
  let surfaces = 0;
  for (const tag of surfaceTags) surfaces += countLiteral(source, `<${tag}`);
  // Mirrors `tag === 'OperationalBrief' || tag.endsWith('Brief')`, including
  // member expressions (`<Foo.Brief>`); the lookahead keeps `<Briefly>`-style
  // prefixes out while over-counting stays safe.
  const briefs = (source.match(/<[^\s/>]*Brief(?=[\s/>])/g) || []).length;
  let headings = 0;
  for (const tag of headingTags) headings += countLiteral(source, `<${tag}`);
  return surfaces >= 2 || (surfaces >= 1 && briefs >= 1) || (headings >= 1 && surfaces + briefs >= 1);
}

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

  let parsed = 0;
  for (const file of collectFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!canContainFinding(source)) continue;
    parsed++;
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

  // Fail loudly rather than vacuously pass if the pre-filter ever excludes
  // the whole tree (a filter bug must not read as a clean audit).
  if (parsed === 0) throw new Error('nested-surfaces audit parsed zero files');
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
