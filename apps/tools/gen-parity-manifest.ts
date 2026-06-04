/**
 * P1/S0-0001 — Parity manifest generator.
 *
 * Statically scans `web/src` (the canonical web specification) and emits
 * `apps/parity/parity-manifest.json` — one record per parity unit (route,
 * page, panel, chart, map, api, string-group) conforming to
 * `apps/parity/manifest.schema.json`. Parity becomes data, not opinion.
 *
 * Parsing is done with the TypeScript compiler API (AST), never regex over
 * source structure. The web toolchain already vendors `typescript` and `ajv`
 * under `web/node_modules`; we load them from there via createRequire so this
 * tool needs no node_modules of its own.
 *
 * Usage:
 *   npx tsx apps/tools/gen-parity-manifest.ts            # write manifest
 *   npx tsx apps/tools/gen-parity-manifest.ts --check    # drift check (CI)
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ── locate repo root and load vendored deps from web/node_modules ──────────
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const webDir = path.join(repoRoot, 'web');
const webRequire = createRequire(path.join(webDir, 'package.json'));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ts: typeof import('typescript') = webRequire('typescript');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv: any = webRequire('ajv');

const SRC = path.join(webDir, 'src');
const ROUTER_FILE = path.join(SRC, 'App.tsx');
const FEATURES_DIR = path.join(SRC, 'features');
const HOOKS_DIR = path.join(SRC, 'api', 'hooks');
const SCHEMA_FILE = path.join(repoRoot, 'apps', 'parity', 'manifest.schema.json');
const OUT_FILE = path.join(repoRoot, 'apps', 'parity', 'parity-manifest.json');

// ── renderable component allowlists (deliberate, distinctive names) ────────
const PANEL_COMPONENTS = new Set([
  'GlassPanel', 'ChartContainer', 'Card', 'StatCard', 'MetricCard',
]);
const CHART_COMPONENTS = new Set([
  'ChartContainer', 'RadialGauge', 'Sparkline', 'MiniChart', 'SmallMultiplesChart',
  'AreaChartWrapper', 'ElevationProfile', 'MetricSwitcherChart', 'SmallMultiples',
  'AreaChart', 'LineChart', 'BarChart', 'PieChart', 'ComposedChart',
  'ScatterChart', 'RadarChart', 'RadialBarChart', 'FunnelChart', 'Treemap',
]);
const MAP_COMPONENTS = new Set([
  'MapContainer', 'MapLayerSwitcher', 'MapTileLayer', 'AnimatedMarker',
  'MarkerCluster', 'GeofenceDrawer', 'RoutePlayback', 'Polyline', 'Marker',
  'Popup', 'CircleMarker', 'Circle', 'Rectangle', 'FeatureGroup',
]);

type StateName = 'loading' | 'empty' | 'error' | 'success';

interface Unit {
  id: string;
  kind: string;
  title: string;
  sourceFiles: string[];
  route?: string;
  dataSources?: string[];
  panels?: string[];
  charts?: string[];
  maps?: string[];
  states?: StateName[];
  strings?: string[];
  requiredCount: number;
  notes?: string;
}

// ── tiny utilities ─────────────────────────────────────────────────────────
function rel(abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join('/');
}

function slugify(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';
}

function listPageFiles(): string[] {
  const out: string[] = [];
  if (!fs.existsSync(FEATURES_DIR)) return out;
  for (const area of fs.readdirSync(FEATURES_DIR)) {
    const pagesDir = path.join(FEATURES_DIR, area, 'pages');
    if (!fs.existsSync(pagesDir) || !fs.statSync(pagesDir).isDirectory()) continue;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (entry.endsWith('.tsx') && !/\.(test|spec|stories)\.tsx$/.test(entry)) out.push(full);
      }
    };
    walk(pagesDir);
  }
  return out.sort();
}

function parse(file: string): import('typescript').SourceFile {
  const text = fs.readFileSync(file, 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

// ── JSX helpers ─────────────────────────────────────────────────────────────
function jsxTagName(node: import('typescript').Node): string | null {
  let name: import('typescript').JsxTagNameExpression | undefined;
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    name = node.tagName;
  } else return null;
  return tagNameToString(name);
}

function tagNameToString(name: import('typescript').JsxTagNameExpression): string {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isPropertyAccessExpression(name)) return name.name.text; // e.g. Motion.div -> div
  return name.getText();
}

function getAttrStringValue(
  el: import('typescript').JsxOpeningElement | import('typescript').JsxSelfClosingElement,
  attr: string,
): string | null {
  for (const p of el.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== attr) continue;
    const init = p.initializer;
    if (!init) return null;
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isStringLiteral(e)) return e.text;
      // title={t('key','default')} — prefer the default, fall back to key
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 't') {
        const args = e.arguments;
        if (args.length >= 2 && ts.isStringLiteral(args[1])) return args[1].text;
        if (args.length >= 1 && ts.isStringLiteral(args[0])) return args[0].text;
      }
    }
  }
  return null;
}

// ── hook endpoint resolver ───────────────────────────────────────────────────
interface HookInfo {
  endpoints: string[]; // e.g. "GET /charging/{id}"
  params: string[];
}

/** Reconstruct a request() path from a string/template argument, query stripped. */
function extractRequestPath(arg: import('typescript').Expression): { path: string; params: string[] } | null {
  let raw: string | null = null;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    raw = arg.text;
  } else if (ts.isTemplateExpression(arg)) {
    let s = arg.head.text;
    for (const span of arg.templateSpans) {
      const expr = span.expression.getText().trim();
      s += `{${expr}}`;
      s += span.literal.text;
    }
    raw = s;
  }
  if (raw == null) return null;
  if (!raw.startsWith('/')) return null; // not an endpoint path
  const qIdx = raw.indexOf('?');
  const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
  const params: string[] = [];
  if (qIdx >= 0) {
    const query = raw.slice(qIdx + 1);
    for (const m of query.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)=/g)) params.push(m[1]);
  }
  return { path: pathPart, params };
}

/** Detect HTTP method from the request() options argument; default GET. */
function extractMethod(call: import('typescript').CallExpression): string {
  if (call.arguments.length < 2) return 'GET';
  const opt = call.arguments[1];
  if (ts.isObjectLiteralExpression(opt)) {
    for (const p of opt.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText() === 'method' && ts.isStringLiteral(p.initializer)) {
        return p.initializer.text.toUpperCase();
      }
    }
  }
  return 'GET';
}

/** Build a map of exported hook/function name -> resolved endpoint info. */
function buildHookMap(): Map<string, HookInfo> {
  const map = new Map<string, HookInfo>();
  if (!fs.existsSync(HOOKS_DIR)) return map;
  for (const entry of fs.readdirSync(HOOKS_DIR)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    const sf = parse(path.join(HOOKS_DIR, entry));

    const record = (name: string, node: import('typescript').Node) => {
      const info: HookInfo = { endpoints: [], params: [] };
      const seen = new Set<string>();
      const visit = (n: import('typescript').Node) => {
        if (
          ts.isCallExpression(n) &&
          ts.isIdentifier(n.expression) &&
          n.expression.text === 'request' &&
          n.arguments.length >= 1
        ) {
          const got = extractRequestPath(n.arguments[0]);
          if (got) {
            const method = extractMethod(n);
            const ep = `${method} ${got.path}`;
            if (!seen.has(ep)) {
              seen.add(ep);
              info.endpoints.push(ep);
            }
            for (const pr of got.params) if (!info.params.includes(pr)) info.params.push(pr);
          }
        }
        // also pick up params declared via URLSearchParams .set('name', …)
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === 'set' &&
          n.arguments.length >= 1 &&
          ts.isStringLiteral(n.arguments[0])
        ) {
          const pr = n.arguments[0].text;
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pr) && !info.params.includes(pr)) info.params.push(pr);
        }
        ts.forEachChild(n, visit);
      };
      visit(node);
      if (info.endpoints.length > 0) map.set(name, info);
    };

    const visitTop = (n: import('typescript').Node) => {
      if (ts.isFunctionDeclaration(n) && n.name && hasExport(n)) {
        record(n.name.text, n);
      } else if (ts.isVariableStatement(n) && hasExport(n)) {
        for (const d of n.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer) record(d.name.text, d.initializer);
        }
      }
      ts.forEachChild(n, visitTop);
    };
    visitTop(sf);
  }
  return map;
}

function hasExport(node: import('typescript').Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

// ── router parsing: lazy(import) map + <Route> tree ─────────────────────────
interface RouteEntry {
  routePath: string;
  componentId: string;
}

function parseRouter(): { lazyMap: Map<string, string>; routes: RouteEntry[] } {
  const lazyMap = new Map<string, string>(); // identifier -> abs page file
  const routes: RouteEntry[] = [];
  if (!fs.existsSync(ROUTER_FILE)) return { lazyMap, routes };
  const sf = parse(ROUTER_FILE);

  // 1) const X = lazy(() => import('./features/.../FooPage'))
  const collectLazy = (n: import('typescript').Node) => {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      ts.isIdentifier(n.initializer.expression) &&
      n.initializer.expression.text === 'lazy'
    ) {
      const importPath = findImportSpecifier(n.initializer);
      if (importPath) {
        const abs = resolveImport(importPath, ROUTER_FILE);
        if (abs) lazyMap.set(n.name.text, abs);
      }
    }
    ts.forEachChild(n, collectLazy);
  };
  collectLazy(sf);

  // 2) <Route path="…"> tree (relative paths joined through nesting)
  const walkRoutes = (n: import('typescript').Node, prefix: string) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const open = ts.isJsxElement(n) ? n.openingElement : n;
      if (jsxTagName(open) === 'Route') {
        const rawPath = getAttrStringValue(open, 'path');
        const isIndex = open.attributes.properties.some(
          (p) => ts.isJsxAttribute(p) && p.name.getText() === 'index',
        );
        const segment = isIndex ? '' : rawPath ?? '';
        const full = joinRoute(prefix, segment);
        const compId = findRouteComponent(open, lazyMap);
        if (compId) routes.push({ routePath: full, componentId: compId });
        // recurse into children with the accumulated prefix
        if (ts.isJsxElement(n)) {
          for (const c of n.children) walkRoutes(c, full);
        }
        return;
      }
    }
    ts.forEachChild(n, (c) => walkRoutes(c, prefix));
  };
  walkRoutes(sf, '');

  return { lazyMap, routes };
}

function joinRoute(prefix: string, seg: string): string {
  if (seg.startsWith('/')) return seg === '/' ? '/' : seg.replace(/\/+$/, '');
  const base = prefix === '' ? '/' : prefix;
  if (seg === '') return base;
  return (base === '/' ? '' : base) + '/' + seg;
}

function findImportSpecifier(call: import('typescript').CallExpression): string | null {
  let found: string | null = null;
  const visit = (n: import('typescript').Node) => {
    if (
      ts.isCallExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ImportKeyword &&
      n.arguments.length >= 1 &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      found = n.arguments[0].text;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(call);
  return found;
}

/** Find the page component identifier referenced inside a <Route> element. */
function findRouteComponent(
  routeOpen: import('typescript').JsxOpeningElement | import('typescript').JsxSelfClosingElement,
  lazyMap: Map<string, string>,
): string | null {
  let found: string | null = null;
  for (const p of routeOpen.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText() !== 'element') continue;
    const init = p.initializer;
    if (init && ts.isJsxExpression(init) && init.expression) {
      const visit = (n: import('typescript').Node) => {
        if (found) return;
        const tag = jsxTagName(n);
        if (tag && lazyMap.has(tag)) {
          found = tag;
          return;
        }
        ts.forEachChild(n, visit);
      };
      visit(init.expression);
    }
  }
  return found;
}

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2));
  else return null;
  const candidates = [base, base + '.tsx', base + '.ts', path.join(base, 'index.tsx'), path.join(base, 'index.ts')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// ── page scanning ───────────────────────────────────────────────────────────
interface PageScan {
  panels: { label: string; component: string }[];
  charts: string[];
  maps: string[];
  hookCalls: string[];
  strings: string[];
  states: StateName[];
}

function scanPage(file: string): PageScan {
  const sf = parse(file);
  const text = sf.getFullText();

  // imported hook names (from any module path containing api/hooks)
  const hookImports = new Set<string>();
  const collectImports = (n: import('typescript').Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const mod = n.moduleSpecifier.text;
      if (/api\/hooks\//.test(mod)) {
        const nb = n.importClause?.namedBindings;
        if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) hookImports.add(el.name.text);
        }
      }
    }
    ts.forEachChild(n, collectImports);
  };
  collectImports(sf);

  const panels: { label: string; component: string }[] = [];
  const charts: string[] = [];
  const maps: string[] = [];
  const hookCallSet = new Set<string>();
  const stringSet = new Set<string>();

  const visit = (n: import('typescript').Node) => {
    // JSX usages
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = jsxTagName(n)!;
      if (PANEL_COMPONENTS.has(tag)) {
        const titleAttr =
          getAttrStringValue(n, 'title') ??
          getAttrStringValue(n, 'label') ??
          getAttrStringValue(n, 'heading');
        panels.push({ label: titleAttr ?? `${tag}${panels.length + 1}`, component: tag });
      }
      if (CHART_COMPONENTS.has(tag)) charts.push(tag);
      if (MAP_COMPONENTS.has(tag)) maps.push(tag);
    }
    // hook calls: useFoo(...)
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && hookImports.has(n.expression.text)) {
      hookCallSet.add(n.expression.text);
    }
    // i18n: t('key', 'default')
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 't' &&
      n.arguments.length >= 1 &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      stringSet.add(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  // de-dupe panel labels for stable ids
  const seenLabel = new Map<string, number>();
  for (const p of panels) {
    const base = slugify(p.label);
    const count = seenLabel.get(base) ?? 0;
    seenLabel.set(base, count + 1);
    p.label = count === 0 ? base : `${base}-${count + 1}`;
  }

  const states: StateName[] = [];
  const has = (re: RegExp) => re.test(text);
  if (has(/\b(isLoading|isPending|isFetching|LoadingSkeleton|<Skeleton|<Spinner|loading=)/)) states.push('loading');
  if (has(/\b(EmptyState|isEmpty|noData|\?\?\s*\[\]|length\s*===\s*0)/)) states.push('empty');
  if (has(/\b(isError|ErrorDisplay|QueryError|ErrorState|AlertBanner|error=)/)) states.push('error');
  if (hookCallSet.size > 0 || panels.length > 0) states.push('success');

  return {
    panels,
    charts,
    maps,
    hookCalls: [...hookCallSet].sort(),
    strings: [...stringSet].sort(),
    states,
  };
}

// ── build manifest ───────────────────────────────────────────────────────────
function pageKeyFor(file: string): { area: string; name: string; key: string } {
  const r = rel(file); // web/src/features/<area>/pages/<Name>.tsx
  const m = r.match(/features\/([^/]+)\/pages\/(.+)\.tsx$/);
  const area = m ? m[1] : 'unknown';
  let name = m ? m[2].split('/').pop()! : path.basename(file, '.tsx');
  name = name.replace(/Page$/, '');
  return { area, name, key: `${area}/${name}` };
}

function build(): Unit[] {
  const hookMap = buildHookMap();
  const { lazyMap, routes } = parseRouter();

  // component identifier -> list of route paths
  const routesByComponent = new Map<string, string[]>();
  for (const r of routes) {
    const file = lazyMap.get(r.componentId);
    if (!file) continue;
    const arr = routesByComponent.get(r.componentId) ?? [];
    arr.push(r.routePath);
    routesByComponent.set(r.componentId, arr);
  }
  // page file -> route paths (a component id maps to one file)
  const routesByFile = new Map<string, string[]>();
  for (const [compId, file] of lazyMap) {
    const rp = routesByComponent.get(compId);
    if (rp && rp.length) {
      const existing = routesByFile.get(file) ?? [];
      routesByFile.set(file, [...existing, ...rp]);
    }
  }

  const units: Unit[] = [];
  const pageFiles = listPageFiles();

  for (const file of pageFiles) {
    const { area, key } = pageKeyFor(file);
    const scan = scanPage(file);
    const routePaths = (routesByFile.get(file) ?? []).filter((v, i, a) => a.indexOf(v) === i).sort();
    const primaryRoute = routePaths[0];
    const srcRel = rel(file);

    const panelLabels = scan.panels.map((p) => p.label);
    const dataSources: string[] = [];
    for (const hook of scan.hookCalls) {
      const info = hookMap.get(hook);
      if (info) {
        const eps = info.endpoints.join(', ');
        const ps = info.params.length ? ` [${info.params.join(', ')}]` : '';
        dataSources.push(`${hook} → ${eps}${ps}`);
      } else {
        dataSources.push(hook);
      }
    }

    const requiredCount =
      panelLabels.length + scan.charts.length + scan.maps.length + scan.states.length + scan.strings.length;

    // page unit
    units.push({
      id: `page:${key}`,
      kind: 'page',
      title: pageKeyFor(file).name,
      sourceFiles: [srcRel],
      route: primaryRoute,
      dataSources: dataSources.length ? dataSources : undefined,
      panels: panelLabels.length ? panelLabels : undefined,
      charts: scan.charts.length ? scan.charts : undefined,
      maps: scan.maps.length ? scan.maps : undefined,
      states: scan.states.length ? scan.states : undefined,
      strings: scan.strings.length ? scan.strings : undefined,
      requiredCount,
      notes: routePaths.length > 1 ? `routes: ${routePaths.join(', ')}` : undefined,
    });

    // route units (one per mounted path)
    for (const rp of routePaths) {
      units.push({
        id: `route:${rp}`,
        kind: 'route',
        title: rp,
        sourceFiles: [rel(ROUTER_FILE), srcRel],
        route: rp,
        requiredCount: 1,
      });
    }

    // panel units
    for (const p of scan.panels) {
      units.push({
        id: `panel:${key}#${p.label}`,
        kind: 'panel',
        title: p.label,
        sourceFiles: [srcRel],
        route: primaryRoute,
        notes: `component: ${p.component}`,
        requiredCount: 1,
      });
    }

    // chart units (numbered per page for stable ids)
    scan.charts.forEach((c, i) => {
      units.push({
        id: `chart:${key}#${slugify(c)}-${i + 1}`,
        kind: 'chart',
        title: c,
        sourceFiles: [srcRel],
        route: primaryRoute,
        charts: [c],
        requiredCount: 1,
      });
    });

    // map units
    scan.maps.forEach((mp, i) => {
      units.push({
        id: `map:${key}#${slugify(mp)}-${i + 1}`,
        kind: 'map',
        title: mp,
        sourceFiles: [srcRel],
        route: primaryRoute,
        maps: [mp],
        requiredCount: 1,
      });
    });

    // api units
    for (const hook of scan.hookCalls) {
      const info = hookMap.get(hook);
      units.push({
        id: `api:${key}#${hook}`,
        kind: 'api',
        title: hook,
        sourceFiles: [srcRel],
        route: primaryRoute,
        dataSources: info ? [`${info.endpoints.join(', ')}${info.params.length ? ` [${info.params.join(', ')}]` : ''}`] : [hook],
        requiredCount: 1,
      });
    }

    // string-group unit
    if (scan.strings.length) {
      units.push({
        id: `string-group:${key}`,
        kind: 'string-group',
        title: `${pageKeyFor(file).name} strings`,
        sourceFiles: [srcRel],
        route: primaryRoute,
        strings: scan.strings,
        requiredCount: scan.strings.length,
      });
    }
  }

  // stable, deterministic ordering
  units.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return units;
}

// strip undefined keys for compact, stable JSON
function clean(units: Unit[]): unknown[] {
  return units.map((u) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(u)) {
      if (v === undefined) continue;
      o[k] = v;
    }
    return o;
  });
}

function validate(units: unknown[]): string[] {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const v = ajv.compile(schema);
  const errors: string[] = [];
  units.forEach((u, i) => {
    if (!v(u)) {
      errors.push(`unit[${i}] ${(u as { id?: string }).id ?? ''}: ${ajv.errorsText(v.errors)}`);
    }
  });
  return errors;
}

function serialize(units: unknown[]): string {
  return JSON.stringify(units, null, 2) + '\n';
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  const check = process.argv.includes('--check');
  const units = clean(build());

  const errors = validate(units);
  if (errors.length) {
    console.error('[FAIL] manifest does not validate against manifest.schema.json:');
    for (const e of errors.slice(0, 20)) console.error('  - ' + e);
    process.exit(2);
  }

  const json = serialize(units);

  if (check) {
    if (!fs.existsSync(OUT_FILE)) {
      console.error('[DRIFT] parity-manifest.json missing — run the generator');
      process.exit(1);
    }
    const current = fs.readFileSync(OUT_FILE, 'utf8');
    if (current !== json) {
      console.error('[DRIFT] parity-manifest.json is out of date — regenerate it');
      process.exit(1);
    }
    console.log(`[OK] manifest up to date (${units.length} units)`);
    return;
  }

  fs.writeFileSync(OUT_FILE, json, 'utf8');
  const pages = units.filter((u) => (u as Unit).kind === 'page').length;
  console.log(`[OK] wrote ${rel(OUT_FILE)} — ${units.length} units (${pages} pages)`);
}

main();
