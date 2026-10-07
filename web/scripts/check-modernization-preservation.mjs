#!/usr/bin/env node
/**
 * Explicit, bounded SOURCE preservation gate; not a runtime/data-loss guarantee.
 * capture --root <repo> --scope <json-array-of-paths> --out <baseline.json> [--catalogs <pinned-inputs.json>]
 * check --root <repo> --baseline <baseline.json> [--report <report.json>]
 * Exit 0: scoped identities match; 1: regression/input/parser failure;
 * 2: scoped identities match but unresolved source evidence requires review.
 * Baselines must be reviewed/frozen, never regenerated to conceal a regression.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

export const VERSION = 3;
export const LIMITATIONS = [
  'SOURCE evidence only; no mount, auth, runtime reachability, data fidelity, backend route, or responsive proof.',
  'Only explicitly scoped files are parsed. Resolved out-of-scope imports are existence evidence, not transitive coverage.',
  'Feature JSX occurrence counts are lexical multisets, not rendered counts. Route declarations retain lexical order.',
  'Metric signatures preserve label keys, value-source atoms and stable IDs, not calculations, periods, formatting accuracy or approved glossary semantics.',
  'Named imported hook/request aliases retain logical symbol, module provenance, local name, arguments and type arguments. Namespace/default/indirect aliases and unrecognized API/hook helpers require review; no binding/dataflow proof is claimed.',
  'Component extraction/moves, changed API type syntax and metric representation migrations require explicit review, not auto-normalization.',
  'Dynamic expressions and spreads are retained as unresolved evidence; no inferred backend or runtime capability.',
  'Preference checks cover recognized identifiers/props/storage calls, not arbitrary persistence APIs or server migrations.',
];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const json = file => JSON.parse(decode(readFileSync(file)));
const sorted = values => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));

export function sourcePath(root, file) {
  if (typeof file !== 'string' || !file || isAbsolute(file) || /^[A-Za-z]:/.test(file)) {
    throw new Error(`Expected repository-relative source path: ${JSON.stringify(file)}`);
  }
  const absolute = resolve(root, ...file.split(/[\\/]/));
  const rel = relative(root, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Source path escapes repository: ${file}`);
  }
  if (!/\.(tsx?|jsx?)$/.test(file)) throw new Error(`Unsupported source extension: ${file}`);
  return absolute;
}

export async function loadTools(root) {
  const require = createRequire(join(resolve(root), 'web', 'package.json'));
  const ts = require('typescript');
  const prior = await import(pathToFileURL(join(resolve(root), 'web', 'scripts', 'i18n-source-graph.mjs')).href);
  return { ts, ...prior };
}

export function extractEvidence(text, file, tools) {
  const { ts } = tools;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) {
    throw new Error(`${file}: parser failure: ${source.parseDiagnostics.map(d =>
      ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`);
  }
  const shape = node => node ? [
    ts.SyntaxKind[node.kind],
    ts.isIdentifier(node) || ts.isLiteralExpression(node) ? node.text : null,
    node.questionToken ? '?' : null,
    node.dotDotDotToken ? '...' : null,
    node.operatorToken ? ts.SyntaxKind[node.operatorToken.kind] : null,
    node.modifiers?.map(m => ts.SyntaxKind[m.kind]) ?? [],
    node.getChildren(source).filter(n => n.kind !== ts.SyntaxKind.SyntaxList)
      .map(n => n.kind >= ts.SyntaxKind.FirstToken && n.kind <= ts.SyntaxKind.LastToken
        ? [ts.SyntaxKind[n.kind], ts.isIdentifier(n) || ts.isLiteralExpression(n) ? n.text : null]
        : shape(n)),
    // SyntaxList children carry arguments, members and object properties.
    node.getChildren(source).filter(n => n.kind === ts.SyntaxKind.SyntaxList)
      .map(n => n.getChildren(source).map(shape)),
  ] : null;
  const position = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const owner = node => {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
      if (ts.isVariableDeclaration(p)) return p.name.getText(source);
    }
    return '<module>';
  };
  const result = { routes: [], components: [], hooks: [], api: [], metrics: [], persistence: [], exports: [], imports: [], dynamicImports: [], unknowns: [], locations: [] };
  const unknown = (node, reason) => result.unknowns.push({ file, line: position(node), reason, expression: node.getText(source) });
  const importBindings = new Map();
  const addImport = (specifier, node, kind) => {
    if (ts.isStringLiteral(specifier)) result.imports.push({ specifier: specifier.text, kind });
    else unknown(node, 'Nonliteral module import');
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause?.name) importBindings.set(clause.name.text, { specifier: statement.moduleSpecifier.text, imported: 'default' });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const binding of clause.namedBindings.elements) {
          if (!binding.isTypeOnly) importBindings.set(binding.name.text, { specifier: statement.moduleSpecifier.text, imported: (binding.propertyName ?? binding.name).text });
        }
      }
    }
  }
  // Reuse the existing auditor's runtime/type-only import classification.
  for (const specifier of tools.runtimeModuleSpecifiers(text, file)) result.imports.push({ specifier, kind: 'static' });
  const attrValue = attr => {
    if (!attr.initializer) return null;
    return ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : attr.initializer;
  };
  const atoms = node => {
    const values = [];
    const visit = n => {
      if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
        if (!(ts.isCallExpression(n.parent) && n.parent.expression === n)) values.push(shape(n));
        return;
      }
      if (ts.isIdentifier(n)) {
        if (!(ts.isCallExpression(n.parent) && n.parent.expression === n)
          && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) values.push(['identifier', n.text]);
        return;
      }
      if (ts.isNumericLiteral(n)) values.push(['number', n.text]);
      ts.forEachChild(n, visit);
    };
    if (node) visit(node);
    return sorted(values);
  };
  const labelIdentity = node => {
    if (node && ts.isCallExpression(node) && node.expression.getText(source) === 't'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) return ['i18n', node.arguments[0].text];
    return shape(node);
  };
  const persistentName = /^(?:id|tableId|widgetId|metricId|persistKey|storageKey|preferenceKey|legendKey|layoutId)$/i;
  const visit = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attrs = new Map();
      for (const attr of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(attr)) {
          if (tag === 'Route' || /Metric|Stat|DataTable|Widget/.test(tag)) unknown(attr, `Spread on protected ${tag} props`);
          continue;
        }
        attrs.set(attr.name.getText(source), attrValue(attr));
        if (persistentName.test(attr.name.getText(source))) {
          result.persistence.push({ owner: owner(node), name: attr.name.getText(source), value: shape(attrValue(attr)) });
          if (!attrValue(attr) || !ts.isStringLiteral(attrValue(attr))) unknown(attr, 'Dynamic persistent JSX identity');
        }
      }
      if (tag === 'Route') {
        const paths = [];
        const ownPath = attrs.get('path');
        if (ownPath && ts.isStringLiteral(ownPath)) paths.unshift(ownPath.text);
        for (let p = node.parent; p; p = p.parent) {
          if (!ts.isJsxElement(p) || p.openingElement === node || p.openingElement.tagName.getText(source) !== 'Route') continue;
          const parentPath = p.openingElement.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(source) === 'path');
          const value = parentPath && attrValue(parentPath);
          if (value && ts.isStringLiteral(value)) paths.unshift(value.text);
        }
        let pattern = '';
        for (const path of paths) pattern = path.startsWith('/') ? path : `${pattern.replace(/\/$/, '')}/${path}`;
        pattern = pattern || '/';
        const components = [];
        const collectTags = n => {
          if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) components.push(n.tagName.getText(source));
          ts.forEachChild(n, collectTags);
        };
        if (attrs.get('element')) collectTags(attrs.get('element'));
        result.routes.push({ pattern, components, props: [...attrs].map(([name, value]) => [name, shape(value)]) });
        result.locations.push({ category: 'routes', pattern, components, line: position(node) });
        if (attrs.has('path') && !ts.isStringLiteral(attrs.get('path'))) unknown(node, 'Dynamic route path');
      }
      const specifier = importBindings.get(tag.split('.')[0])?.specifier;
      if (specifier && (specifier.includes('/features/') || specifier.includes('/vehicles/') || specifier.startsWith('.'))) {
        result.components.push({ owner: owner(node), tag, specifier });
      }
      if (/^(?:MetricCard|MetricBar|StatCard|InlineMetric|MetricValue|StatStrip|StatGroup)$/.test(tag)) {
        const label = attrs.get('label') ?? attrs.get('metricId');
        const value = attrs.get('value') ?? attrs.get('metrics') ?? attrs.get('items');
        result.metrics.push({
          owner: owner(node), label: labelIdentity(label), source: atoms(value),
          ids: [...attrs].filter(([name]) => persistentName.test(name)).map(([name, v]) => [name, shape(v)]),
        });
        result.locations.push({ category: 'metrics', owner: owner(node), label: labelIdentity(label), line: position(node) });
        if (!label || !value || atoms(value).length === 0) unknown(node, 'Metric label/value source unresolved (child or indirect presentation)');
        if (value && ts.isIdentifier(value)) unknown(node, 'Indirect metric source; declaration/dataflow not proven');
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addImport(node.arguments[0], node, 'dynamic-literal');
        result.dynamicImports.push({ owner: owner(node), source: shape(node.arguments[0]) });
      }
      const binding = ts.isIdentifier(node.expression) ? importBindings.get(callee) : null;
      const logicalCallee = binding && binding.imported !== 'default' ? binding.imported : callee;
      const fromApiOrHook = binding && /(?:^|[/\\])(?:api|hooks)(?:[/\\]|$)|(?:^|[/\\])client$/.test(binding.specifier);
      if (binding?.imported === 'default' && fromApiOrHook) {
        unknown(node, 'Default API/hook import call; logical symbol and query coverage unresolved');
      } else if (/^(?:use[A-Z]\w*|request|fetch)$/.test(logicalCallee)) {
        const record = {
          owner: owner(node), callee: logicalCallee,
          ...(binding ? { localCallee: callee, importedFrom: binding.specifier } : {}),
          args: node.arguments.map(shape), typeArgs: node.typeArguments?.map(shape) ?? [],
        };
        // Presentation-only hooks do not participate in API/query identity.
        if (/^(?:request|fetch)$/.test(logicalCallee)) result.api.push(record);
        else if (!/^(?:useMemo|useCallback|useEffect|useState|useRef|useTranslation|usePageTitle|useFormatting|useUnits|useNumberFormatting|useMotionPreference|useTheme)$/.test(logicalCallee)) result.hooks.push(record);
        if (/^(?:request|fetch)$/.test(logicalCallee) && node.arguments[0] && !ts.isStringLiteral(node.arguments[0])) {
          unknown(node, 'Computed API URL retained structurally; backend match unresolved');
        }
      } else if (fromApiOrHook) {
        unknown(node, 'Unrecognized imported API/hook helper; query coverage not proven');
      }
      if (/(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)$/.test(callee)
        || /(?:Storage|Preference).*(?:get|set)|^(?:readPreference|writePreference)$/.test(callee)) {
        result.persistence.push({ owner: owner(node), callee, key: shape(node.arguments[0]) });
        if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) unknown(node, 'Computed storage/preference key');
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
      && /(?:STORAGE_KEY|PERSIST_KEY|PREFERENCE_KEY|TABLE_ID|WIDGET_ID|LAYOUT_ID|PREFERENCES_VERSION)$|^PRODUCT_(?:PERSONAS|LANDING_PAGES)$/.test(node.name.text)) {
      result.persistence.push({ owner: owner(node), name: node.name.text, value: shape(node.initializer) });
    }
    if (ts.isPropertyAssignment(node) && persistentName.test(node.name.getText(source).replace(/^['"]|['"]$/g, ''))) {
      result.persistence.push({ owner: owner(node), name: node.name.getText(source), value: shape(node.initializer) });
      if (!ts.isStringLiteral(node.initializer) && !ts.isNumericLiteral(node.initializer)) unknown(node, 'Computed object identity');
    }
    if ((file.replaceAll('\\', '/').includes('/api/') || /(?:preferences|settings)/i.test(file))
      && (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node))) {
      result.api.push({ declaration: node.name.text, shape: shape(node) });
    }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name
      && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      result.exports.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const key of Object.keys(result)) if (!['routes', 'unknowns', 'locations'].includes(key)) sorted(result[key]);
  return result;
}

export function reconcileCatalogs(catalogs, baseline, tools, read = readFileSync) {
  if (!Array.isArray(catalogs) || catalogs.length === 0) throw new Error('Catalog inputs must be a nonempty pinned input list.');
  const inputs = [], diagnostics = [], probes = [];
  const scoped = new Map(baseline.files.map(file => [file.path, file]));
  for (const input of catalogs) {
    if (!input || typeof input.path !== 'string' || typeof input.kind !== 'string' || !/^[a-fA-F0-9]{64}$/.test(input.sha256 ?? '')) {
      throw new Error('Each catalog input needs path, kind and exact SHA256.');
    }
    const bytes = read(input.path);
    const actualHash = sha256(bytes);
    if (actualHash !== input.sha256.toLowerCase()) throw new Error(`Frozen catalog hash mismatch: ${input.path}; retain original and investigate drift.`);
    const document = JSON.parse(decode(bytes));
    inputs.push({ ...input, sha256: actualHash });
    if (input.kind === 'routes') {
      if (!Array.isArray(document.declarations)) throw new Error('Invalid route catalog declarations.');
      if (document.declarations.some(r => !r || ['id', 'source_file', 'route_pattern', 'component'].some(k => typeof r[k] !== 'string'))) throw new Error('Invalid canonical route record.');
      const rows = document.declarations.filter(r => scoped.has(r.source_file));
      for (const row of rows) {
        const file = scoped.get(row.source_file);
        const matches = file.evidence.locations.filter(r => r.category === 'routes' && r.pattern === row.route_pattern);
        const originalCount = rows.filter(r => r.source_file === row.source_file && r.route_pattern === row.route_pattern).length;
        const targetPresent = row.component === 'UNKNOWN' || matches.some(m => m.components.includes(row.component));
        probes.push({ kind: 'route', frozenId: row.id, source: row.source_file, originalLine: row.source_line, currentLines: matches.map(r => r.line), originalCount, currentCount: matches.length, originalComponent: row.component, targetStatus: row.component === 'UNKNOWN' ? 'UNRESOLVED_ORIGINAL' : targetPresent ? 'lexical-tag-present' : 'MISSING_OR_CHANGED', status: matches.length === originalCount && targetPresent ? 'pattern-multiplicity-and-known-tag-present' : 'MISSING_DUPLICATE_OR_CHANGED' });
        if (matches.length !== originalCount || !targetPresent) diagnostics.push({ file: row.source_file, category: 'canonical-route', identity: row.id, reason: `Frozen route pattern multiplicity or component differs: ${row.route_pattern}` });
      }
    } else if (input.kind === 'metrics') {
      if (!Array.isArray(document.source_occurrences)) throw new Error('Invalid metric source catalog.');
      if (document.source_occurrences.some(r => !r || ['id', 'file', 'owner'].some(k => typeof r[k] !== 'string'))) throw new Error('Invalid canonical metric record.');
      const groups = new Map();
      for (const row of document.source_occurrences.filter(r => scoped.has(r.file))) {
        const props = row.existing_props ?? {};
        const label = props.label ?? row.label_expression;
        const value = props.value ?? row.raw_or_formatted_value_expression;
        if (!label || label === 'UNKNOWN' || !value || value === 'UNKNOWN') {
          probes.push({ kind: 'metric', frozenId: row.id, source: row.file, originalLine: row.line, status: 'UNRESOLVED_ORIGINAL' });
          continue;
        }
        const synthetic = extractEvidence(`const fixture = <MetricCard label={${label}} value={${value}} />;`, 'catalog-probe.tsx', tools).metrics[0];
        const identity = { owner: row.owner, label: synthetic.label, source: synthetic.source };
        const key = JSON.stringify([row.file, identity]);
        if (!groups.has(key)) groups.set(key, { file: row.file, identity, rows: [] });
        groups.get(key).rows.push(row);
      }
      for (const group of groups.values()) {
        const file = scoped.get(group.file);
        const matches = file.evidence.metrics.filter(m => JSON.stringify({ owner: m.owner, label: m.label, source: m.source }) === JSON.stringify(group.identity));
        const currentLines = file.evidence.locations.filter(l => l.category === 'metrics' && l.owner === group.identity.owner && JSON.stringify(l.label) === JSON.stringify(group.identity.label)).map(l => l.line);
        probes.push({ kind: 'metric', source: group.file, frozenIds: group.rows.map(r => r.id), originalLines: group.rows.map(r => r.line), currentLines, beforeCount: group.rows.length, currentCount: matches.length, identity: group.identity, status: matches.length === group.rows.length ? 'source-identity-multiset-present' : 'MISSING_DUPLICATE_OR_CHANGED' });
        if (matches.length !== group.rows.length) diagnostics.push({ file: group.file, category: 'canonical-metric', identity: group.identity, beforeCount: group.rows.length, afterCount: matches.length, reason: 'Frozen original metric source multiplicity differs; coordinate/catalog drift requires disposition.' });
      }
    } else if (input.kind === 'pages') {
      if (!Array.isArray(document.pages)) throw new Error('Invalid page manifest.');
      if (document.pages.some(r => !r || ['page_id', 'source_file', 'default_render_owner'].some(k => typeof r[k] !== 'string'))) throw new Error('Invalid canonical page record.');
      for (const row of document.pages.filter(r => scoped.has(r.source_file))) {
        const present = scoped.get(row.source_file).evidence.exports.includes(row.default_render_owner);
        probes.push({ kind: 'page-owner', frozenId: row.page_id, source: row.source_file, symbol: row.default_render_owner, status: present ? 'export-present-only' : 'MISSING_OR_INDIRECT_EXPORT' });
        if (!present) diagnostics.push({ file: row.source_file, category: 'canonical-component', identity: row.page_id, reason: 'Canonical exported page owner absent or indirect; review required.' });
      }
    } else if (!['layout', 'mobile', 'hooks', 'crosswalk', 'snapshot', 'mobile-routes', 'jsx'].includes(input.kind)) {
      throw new Error(`Unsupported catalog kind: ${input.kind}`);
    }
  }
  const unknowns = probes.filter(p => p.status === 'UNRESOLVED_ORIGINAL' || p.targetStatus === 'UNRESOLVED_ORIGINAL');
  return { scope: 'Only route pattern multiplicity/known lexical component tags, exported scoped page owners and original explicit metric source multisets probed. Other inputs hashed as citations; layout/mobile semantic/runtime joins remain unresolved.', inputs, probes, diagnostics, unknowns };
}

export async function capture(root, files, tools = null) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 40) throw new Error('Scope must contain 1–40 explicit source paths.');
  tools ??= await loadTools(root);
  const seen = new Set();
  const records = [];
  for (const file of files) {
    const absolute = sourcePath(root, file);
    if (seen.has(absolute.toLowerCase())) throw new Error(`Duplicate scope path: ${file}`);
    seen.add(absolute.toLowerCase());
    const bytes = readFileSync(absolute);
    const evidence = extractEvidence(decode(bytes), file, tools);
    records.push({ path: file, sha256: sha256(bytes), bytes: bytes.toString('base64'), evidence });
  }
  const dependencies = [];
  for (const record of records) {
    for (const entry of record.evidence.imports) {
      if (!entry.specifier.startsWith('.') && !entry.specifier.startsWith('@/')) continue;
      const target = tools.resolveSourceImport(join(resolve(root), 'web', 'src'), sourcePath(root, record.path), entry.specifier);
      const identity = target ? relative(resolve(root), target).split(sep).join('\\') : null;
      dependencies.push({ from: record.path, specifier: entry.specifier, target: identity, scoped: identity ? files.includes(identity) : false });
      if (!target) record.evidence.unknowns.push({ file: record.path, line: null, reason: 'Unresolved local module import', expression: entry.specifier });
    }
  }
  // Detect overlapping live writers during this bounded read; never mutate them.
  for (const record of records) {
    if (sha256(readFileSync(sourcePath(root, record.path))) !== record.sha256) {
      throw new Error(`Concurrent source drift while capturing ${record.path}; retry in a coordinated window.`);
    }
  }
  return { version: VERSION, scope: 'bounded-source-only', limitations: LIMITATIONS, files: records, dependencies: sorted(dependencies) };
}

export async function validateBaseline(baseline, tools) {
  if (baseline?.version !== VERSION || baseline.scope !== 'bounded-source-only'
    || !Array.isArray(baseline.files) || !Array.isArray(baseline.dependencies)) throw new Error('Invalid/unsupported baseline schema.');
  if (!baseline.files.length || baseline.files.length > 40) throw new Error('Invalid baseline scope size.');
  for (const record of baseline.files) {
    if (typeof record.bytes !== 'string' || typeof record.sha256 !== 'string') throw new Error(`Invalid baseline bytes: ${record.path}`);
    const bytes = Buffer.from(record.bytes, 'base64');
    if (bytes.toString('base64') !== record.bytes || sha256(bytes) !== record.sha256) throw new Error(`Baseline byte/hash mismatch: ${record.path}`);
    const parsed = extractEvidence(decode(bytes), record.path, tools);
    // Resolution unknowns depend on filesystem state; all original parsed unknowns remain exact.
    const authored = { ...record.evidence, unknowns: record.evidence?.unknowns?.filter(u => u.reason !== 'Unresolved local module import') };
    if (JSON.stringify(parsed) !== JSON.stringify(authored)) throw new Error(`Baseline evidence/bytes mismatch: ${record.path}`);
  }
}

export function compare(baseline, current) {
  const diagnostics = [...(current.catalogEvidence?.diagnostics ?? [])];
  const drift = [];
  const categories = ['routes', 'components', 'hooks', 'api', 'metrics', 'persistence', 'exports', 'dynamicImports'];
  for (const before of baseline.files) {
    const after = current.files.find(f => f.path === before.path);
    if (!after) { diagnostics.push({ file: before.path, category: 'source', reason: 'Missing scoped source file' }); continue; }
    if (before.sha256 !== after.sha256) drift.push({ file: before.path, before: before.sha256, after: after.sha256 });
    for (const category of categories) {
      if (JSON.stringify(before.evidence[category]) === JSON.stringify(after.evidence[category])) continue;
      const count = items => {
        const map = new Map();
        for (const item of items) { const key = JSON.stringify(item); map.set(key, (map.get(key) ?? 0) + 1); }
        return map;
      };
      const original = count(before.evidence[category]), next = count(after.evidence[category]);
      for (const key of new Set([...original.keys(), ...next.keys()])) {
        if (original.get(key) !== next.get(key)) diagnostics.push({
          file: before.path, category, identity: JSON.parse(key),
          beforeCount: original.get(key) ?? 0, afterCount: next.get(key) ?? 0,
          reason: 'Protected identity multiplicity changed; restore or obtain a scoped reviewed migration.',
        });
      }
      if (category === 'routes' && diagnostics.every(d => d.file !== before.path || d.category !== category)) {
        diagnostics.push({ file: before.path, category, reason: 'Route declaration order changed; review original order.' });
      }
    }
  }
  for (const edge of baseline.dependencies) {
    if (!edge.target) continue;
    if (!current.dependencies.some(d => d.from === edge.from && d.specifier === edge.specifier && d.target === edge.target)) {
      diagnostics.push({ file: edge.from, category: 'reachability', reason: 'Resolved local dependency removed/changed/missing', identity: edge });
    }
  }
  const unknowns = [...current.files.flatMap(f => f.evidence.unknowns), ...(current.catalogEvidence?.unknowns ?? [])];
  const originalUnknowns = baseline.files.flatMap(f => f.evidence.unknowns);
  return {
    version: VERSION, scope: 'bounded-source-only',
    status: diagnostics.length ? 'SOURCE_REGRESSION' : unknowns.length || originalUnknowns.length ? 'SOURCE_MATCH_WITH_UNRESOLVED' : 'SOURCE_MATCH',
    exitCode: diagnostics.length ? 1 : unknowns.length || originalUnknowns.length ? 2 : 0,
    sourceHashes: current.files.map(f => ({ path: f.path, sha256: f.sha256 })),
    sourceDrift: drift, diagnostics, unknowns, originalUnknowns, catalogEvidence: current.catalogEvidence ?? null, limitations: LIMITATIONS,
  };
}

export async function run(argv) {
  const [command, ...args] = argv;
  if (!['capture', 'check'].includes(command)) throw new Error('Usage: capture --root ROOT --scope JSON --out BASELINE | check --root ROOT --baseline BASELINE [--report JSON]');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--root', '--scope', '--out', '--baseline', '--report', '--catalogs'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) {
      throw new Error(`Invalid/duplicate option or missing value: ${key}`);
    }
    options[key] = args[i + 1];
  }
  if (!options['--root']) throw new Error('Missing --root repository path.');
  const allowed = command === 'capture' ? ['--root', '--scope', '--out', '--catalogs'] : ['--root', '--baseline', '--report'];
  if (Object.keys(options).some(k => !allowed.includes(k))) throw new Error(`Option not valid for ${command}`);
  const root = resolve(options['--root']);
  const tools = await loadTools(root);
  if (command === 'capture') {
    if (!options['--scope'] || !options['--out']) throw new Error('capture requires --scope and --out.');
    if (existsSync(options['--out'])) throw new Error('Refusing to overwrite baseline; use a new path and retain the frozen original.');
    const baseline = await capture(root, json(options['--scope']), tools);
    if (options['--catalogs']) baseline.catalogEvidence = reconcileCatalogs(json(options['--catalogs']), baseline, tools);
    writeFileSync(options['--out'], JSON.stringify(baseline, null, 2) + '\n', { flag: 'wx' });
    console.log(`Captured exact UTF-8 bytes and structured SOURCE evidence: ${baseline.files.length} files; ${baseline.files.flatMap(f => f.evidence.unknowns).length} unresolved cases. Review/freeze required.`);
    return 0;
  }
  if (!options['--baseline']) throw new Error('check requires --baseline.');
  if (options['--report'] && existsSync(options['--report'])) throw new Error('Refusing to overwrite report output; use a new path and retain all frozen/proof/source files.');
  const baseline = json(options['--baseline']);
  await validateBaseline(baseline, tools);
  for (const record of baseline.files) sourcePath(root, record.path);
  const current = await capture(root, baseline.files.map(f => f.path), tools);
  if (baseline.catalogEvidence) current.catalogEvidence = reconcileCatalogs(baseline.catalogEvidence.inputs, current, tools);
  const report = compare(baseline, current);
  if (options['--report']) {
    // Exclusive creation also closes the preflight race and filesystem case aliases.
    writeFileSync(options['--report'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(`${report.status}: ${current.files.length} scoped files; ${report.diagnostics.length} identity diagnostics; ${report.unknowns.length} unresolved cases; ${report.sourceDrift.length} byte drifts.`);
  for (const diagnostic of report.diagnostics) console.error(JSON.stringify(diagnostic));
  if (report.unknowns.length) console.error('Unresolved source evidence blocks acceptance (exit 2). Inspect report. Do not infer runtime/data-loss coverage.');
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(`modernization-preservation: ${error.message}`);
    process.exitCode = 1;
  });
}
