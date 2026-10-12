#!/usr/bin/env node
import { readFile, readdir, mkdir, lstat } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const CAPTURE_WIDTHS = Object.freeze([375, 768, 1440, 1920]);
export const OVERFLOW_WIDTHS = Object.freeze([320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const captureProofs = new WeakMap();
const owners = new Set([
  'src/index.css', 'tailwind.config.js', 'src/lib/tokens.ts', 'src/lib/colors.ts',
  'src/components/ui/ThemeProvider.tsx', 'src/components/ui/themePresets.ts',
  'src/hooks/useChartPalette.ts',
]);
const systemColors = new Set([
  'canvas', 'canvastext', 'linktext', 'visitedtext', 'activetext',
  'buttonface', 'buttontext', 'buttonborder', 'field', 'fieldtext',
  'highlight', 'highlighttext', 'selecteditem', 'selecteditemtext',
  'mark', 'marktext', 'graytext', 'accentcolor', 'accentcolortext',
]);
const help = `DEV/QA only; no server startup, mocks, baseline replacement or mutation actions.
From repository root:
  node web\\scripts\\frontend-qa.mjs capture --route /battery
  node web\\scripts\\frontend-qa.mjs overflow [--route /battery] [--route-map <json>]
  node web\\scripts\\frontend-qa.mjs scan [--path src/features/battery]
  node web\\scripts\\frontend-qa.mjs routes
Browser commands require Node >=26 and an already running E2E_BASE_URL.
Reuse E2E_STORAGE_STATE, E2E_SENSITIVE and playwright.config.ts defaults.
Capture writes qa-screenshots/<run>/<route>-<width>-<theme>.png at the repository root.
--theme dark|light; --ready <route-specific visible selector> (default main).
Application mode is seeded and synchronized through existing browser preferences.
Mounted root mode must match; captures include the full page, not only the viewport.
Fixed-height main scroll regions also get numbered section captures; no server writes.
Real DOM sections verify contiguous versioned content anchors and a settled terminal bottom.
Scroll-position extent changes are reconciled within three attempts and 100 total section captures.
Route map JSON: {"/drives/:id": "/drives/<real-authorized-id>"}.
Unresolved parameter routes are BLOCKED, never invented IDs or silently skipped.
Exit 0: bounded checks passed; 1: findings/failures; 2: blocked/invalid input.
Scan is static candidate evidence, not visual/contrast/application acceptance.
Token-owner exemptions remain visible; token references require owner review.
Proven canonical useTheme themeId comparisons remain visible as persisted-identity review.
This source proof does not allow decorative neon classes/styles or imply browser acceptance.`;

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  if (!['help', '--help', 'capture', 'overflow', 'scan', 'routes'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    if (!['--route', '--route-map', '--theme', '--ready', '--path'].includes(flag) ||
        !rest[index + 1] || rest[index + 1].startsWith('--') || options[flag.slice(2)] !== undefined) {
      throw new Error(`Invalid or repeated option: ${flag}`);
    }
    options[flag.slice(2)] = rest[index + 1];
  }
  const allowed = {
    capture: ['route', 'theme', 'ready'],
    overflow: ['route', 'route-map', 'theme', 'ready'],
    scan: ['path'], routes: [], help: [], '--help': [],
  }[command];
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) throw new Error(`--${key} is not valid for ${command}`);
  }
  if (options.theme && !['dark', 'light'].includes(options.theme)) throw new Error('Theme must be dark or light');
  if (command === 'capture' && !options.route) throw new Error('capture requires --route');
  return { command, options };
}

export function parseRegistry(source) {
  const tree = ts.createSourceFile('routeRegistry.ts', source, ts.ScriptTarget.Latest, true);
  const routes = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'ROUTE_REGISTRY') {
      let initializer = node.initializer;
      while (initializer && (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer))) {
        initializer = initializer.expression;
      }
      if (!initializer || !ts.isArrayLiteralExpression(initializer)) {
        throw new Error('Unsupported production ROUTE_REGISTRY initializer');
      }
      for (const entry of initializer.elements) {
        if (!ts.isObjectLiteralExpression(entry)) throw new Error('Unsupported registry entry');
        const field = entry.properties.find((prop) => ts.isPropertyAssignment(prop) && prop.name.getText(tree) === 'path');
        if (!field || !ts.isStringLiteral(field.initializer)) throw new Error('Registry path must be a literal');
        routes.push(field.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!routes.length || new Set(routes).size !== routes.length) throw new Error('Empty or duplicate production route registry');
  return routes;
}

export function planRoutes(registry, routeMap = {}, requested) {
  if (!routeMap || Array.isArray(routeMap) || typeof routeMap !== 'object') throw new Error('Route map must be an object');
  const matches = (template, concrete) => {
    const expected = template.split('/');
    const actual = concrete.split('/');
    return expected.length === actual.length && expected.every((part, index) =>
      part.startsWith(':') ? Boolean(actual[index]) : part === actual[index]);
  };
  for (const [template, concrete] of Object.entries(routeMap)) {
    if (!registry.includes(template) || typeof concrete !== 'string' || !safeRoute(concrete) || !matches(template, concrete)) {
      throw new Error(`Invalid concrete route mapping for ${template}`);
    }
  }
  if (requested && (!safeRoute(requested) || !registry.some((template) => matches(template, requested)))) {
    throw new Error('Requested route is not a concrete production registry path');
  }
  const templates = requested ? [registry.find((template) => template === requested) ?? registry.find((template) => matches(template, requested))] : registry;
  return templates.map((template) => {
    const route = requested ?? routeMap[template] ?? template;
    return { template, route, blocked: /[:*]/.test(route) ? 'Needs an authorized concrete route mapping' : undefined };
  });
}

function safeRoute(route) {
  return /^\/(?!\/)/.test(route) && !/[?#\\:\s*]/.test(route) && !route.split('/').includes('..');
}

export function classifyPage({ requestedURL, finalURL, status, visible, text, authVisible, failureVisible, busy, emptyView }) {
  const requested = new URL(requestedURL);
  const final = new URL(finalURL);
  if (final.origin !== requested.origin || /\/(?:auth|login|signin|sign-in|oauth|outpost)(?:\/|$)/i.test(final.pathname) || authVisible) {
    return { status: 'BLOCKED', reason: 'Authentication boundary/redirect; no capture or overflow pass' };
  }
  if (final.pathname.replace(/\/$/, '') !== requested.pathname.replace(/\/$/, '')) {
    return { status: 'BLOCKED', reason: 'Route redirected; validate destination separately' };
  }
  if (!status || status >= 400 || !visible || !text?.trim() || failureVisible || busy || emptyView || /^(?:loading|no data available|nothing to show)[.!…\s]*$/i.test(text.trim())) {
    return { status: 'BLOCKED', reason: 'Route is empty, not ready, unavailable or failed' };
  }
  return { status: 'READY' };
}

export function checkOverflow(geometry) {
  return ['root', 'body'].some((key) => geometry[key].scrollWidth > geometry[key].clientWidth + 1);
}

export function isPageBusy(indicators) {
  return indicators.some(({ busy, role, valueNow, label, loading }) =>
    busy === 'true' || loading ||
    (['status', 'progressbar'].includes(role) && /\b(?:loading|fetching|please wait)\b/i.test(label ?? '')) ||
    (role === 'progressbar' && (valueNow == null || valueNow === '')));
}

export function inspectIndicators(nodes) {
  return nodes.filter((node) => node.getClientRects().length > 0 && !node.closest('[hidden], [aria-hidden="true"]'))
    .map((node) => ({
      busy: node.getAttribute('aria-busy'), role: node.getAttribute('role'),
      valueNow: node.getAttribute('aria-valuenow'),
      label: node.getAttribute('aria-label') ?? node.textContent,
      loading: Boolean(node.querySelector('.spinner-bolt-glow, .spinner-bolt-draw')) ||
        node.getAttribute('data-testid') === 'top-progress',
    }));
}

// These functions run inside the isolated context, never change server settings,
// and use ThemeProvider's existing persisted mode and cross-tab subscription.
export function seedApplicationMode({ origin, mode }) {
  if (location.origin === origin) localStorage.setItem('teslasync-mode', mode);
}

export function synchronizeApplicationMode(mode) {
  localStorage.setItem('teslasync-mode', mode);
  window.dispatchEvent(new StorageEvent('storage', {
    key: '__teslasync_bus_qa_mode',
    newValue: JSON.stringify({
      _from: 'frontend-qa-isolated-context', _ts: Date.now(),
      msg: { type: 'theme.changed', themeId: localStorage.getItem('teslasync-theme') ?? 'neon-cyan', modeId: mode },
    }),
  }));
}

export function mountedApplicationMode() {
  const root = document.documentElement;
  return {
    saved: localStorage.getItem('teslasync-mode'),
    scheme: root.style.colorScheme,
    dark: root.classList.contains('dark'),
    light: root.classList.contains('light-mode'),
  };
}

export function applicationModeMatches(mode, actual) {
  return actual.saved === mode && actual.scheme === mode &&
    actual.dark === (mode === 'dark') && actual.light === (mode === 'light');
}

async function captureAnchoredMain(page, handle, path, beforeCapture) {
  const observe = (target) => handle.evaluate(async (state, target) => {
    const element = state.root;
    const snapshot = () => {
      const bounds = element.getBoundingClientRect();
      const top = bounds.top + element.clientTop;
      const bottom = top + element.clientHeight;
      const overlaps = (a, b) => a.left < b.right && a.right > b.left;
      const occluders = [...document.querySelectorAll('*')].flatMap((node) => {
        const style = getComputedStyle(node);
        if (!['sticky', 'fixed'].includes(style.position) || style.visibility === 'hidden') return [];
        const rect = node.getBoundingClientRect();
        return rect.height > 0 && rect.width > 0 && overlaps(rect, bounds) && rect.bottom > top && rect.top < bottom
          ? [{ node, rect }] : [];
      });
      let clipTop = top;
      let clipBottom = bottom;
      for (const { rect } of occluders) {
        if (rect.top <= top + 1) clipTop = Math.max(clipTop, rect.bottom);
        if (rect.bottom >= bottom - 1) clipBottom = Math.min(clipBottom, rect.top);
      }
      // Leaf-local intervals survive an in-flow insertion before the content.
      // Identity/version changes instead invalidate that content's old evidence.
      const nodes = [...element.querySelectorAll('*')].flatMap((node) => {
        if (node.children.length && ![...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim())) return [];
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        if (rect.height <= 0 || rect.width <= 0 || !overlaps(rect, bounds) ||
            style.visibility !== 'visible' || style.display === 'none') return [];
        const value = node.textContent + ('value' in node ? node.value : '');
        let identity = state.ids.get(node);
        if (!identity) {
          identity = { id: state.next++, version: 0, value, height: rect.height, width: rect.width };
          state.ids.set(node, identity);
        } else if (identity.value !== value || Math.abs(identity.height - rect.height) > 1 || Math.abs(identity.width - rect.width) > 1) {
          Object.assign(identity, { version: identity.version + 1, value, height: rect.height, width: rect.width });
        }
        let visible = [[Math.max(0, top - rect.top), Math.min(rect.height, bottom - rect.top)]]
          .filter(([start, end]) => end > start);
        for (const { node: cover, rect: mask } of occluders) {
          if (cover.contains(node) || !overlaps(mask, rect)) continue;
          visible = visible.flatMap(([start, end]) => {
            const a = Math.max(start, mask.top - rect.top);
            const b = Math.min(end, mask.bottom - rect.top);
            return b <= a ? [[start, end]] : [[start, a], [b, end]].filter(([a, b]) => b > a);
          });
        }
        return [{ id: identity.id, version: identity.version, height: rect.height, width: rect.width,
          y: rect.top - top + element.scrollTop, visible }];
      });
      return { height: element.clientHeight, total: element.scrollHeight, top: element.scrollTop,
        usable: clipBottom - clipTop, inset: clipTop - top, nodes };
    };
    const same = (a, b) => a.height === b.height && a.total === b.total && Math.abs(a.top - b.top) <= 1 &&
      JSON.stringify(a.nodes) === JSON.stringify(b.nodes);
    if (target === null) return snapshot();
    let previous;
    let stable = 0;
    for (let sample = 0; sample < 12; sample += 1) {
      element.scrollTop = Math.min(target, Math.max(0, element.scrollHeight - element.clientHeight));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const current = snapshot();
      if (current.height <= 0 || Math.ceil(current.total / current.height) > 100) {
        throw new Error('Scroll-section coverage exceeds bounded capture limits');
      }
      const expected = Math.min(target, Math.max(0, current.total - current.height));
      if (Math.abs(current.top - expected) > 1) stable = 0;
      else stable = previous && same(previous, current) ? stable + 1 : 1;
      if (stable === 3) return current;
      previous = current;
    }
    throw new Error('Scroll-section geometry did not settle within bounded capture limits');
  }, target);
  const same = (a, b) => a.height === b.height && a.total === b.total && Math.abs(a.top - b.top) <= 1 &&
    JSON.stringify(a.nodes) === JSON.stringify(b.nodes);
  const coverage = new Map();
  const key = (node) => `${node.id}:${node.version}`;
  const record = (current) => {
    for (const node of current.nodes) {
      const intervals = [...(coverage.get(key(node)) ?? []), ...node.visible].sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const [start, end] of intervals) {
        const last = merged.at(-1);
        if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
      }
      coverage.set(key(node), merged);
    }
  };
  const gap = (current) => {
    for (const node of current.nodes) {
      let end = 0;
      for (const [start, bottom] of coverage.get(key(node)) ?? []) {
        if (start > end + 1) break;
        end = Math.max(end, bottom);
      }
      if (end < node.height - 1) return { node, start: end };
    }
  };
  const sections = [];
  let target = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    while (sections.length < 100) {
      const current = await observe(target);
      if (!current.nodes.length || current.usable <= 0) throw new Error('Content-anchored scroll coverage incomplete');
      await beforeCapture();
      const expected = { ...current, top: Math.min(target, Math.max(0, current.total - current.height)) };
      const before = await observe(null);
      if (!same(before, expected)) { target = 0; break; }
      const index = sections.length + 1;
      sections.push({ index, height: current.height, total: current.total, top: current.top,
        usable: current.usable, visibleAnchors: current.nodes.filter((node) => node.visible.length).length });
      await page.screenshot({ path: path.replace(/\.png$/, `-section-${index}.png`), fullPage: true });
      const after = await observe(null);
      if (!same(before, after)) { target = 0; break; }
      record(after);
      // Extents can differ by scroll position; reconcile uncovered content,
      // not the presence of a globally constant scrollHeight.
      if (Math.abs(after.top - (after.total - after.height)) <= 1 || after.total <= after.height) {
        const terminal = await observe(after.top);
        if (!same(after, terminal)) { target = 0; break; }
        const missing = gap(terminal);
        if (!missing) return { method: 'content-anchored', attempts: attempt + 1, sections,
          anchors: terminal.nodes.length, coveredAnchors: terminal.nodes.length,
          terminal: { height: terminal.height, total: terminal.total, top: terminal.top } };
        target = Math.max(0, missing.node.y + missing.start - terminal.inset);
        break;
      }
      target = after.top + after.usable;
    }
    if (sections.length >= 100) throw new Error('Scroll-section coverage exceeds bounded capture limits');
  }
  throw new Error('Content-anchored scroll coverage incomplete after bounded reconciliation');
}

export async function captureFullPage(page, path, beforeCapture = async () => {}) {
  captureProofs.delete(page);
  await beforeCapture();
  await page.screenshot({ path, fullPage: true });
  // The real Layout owns a fixed-height, independently scrolling main.
  // fullPage alone cannot expose its lower sections; retain tiled evidence too.
  const main = page.locator('main').first();
  if (!await main.count()) return;
  const geometry = await main.evaluate((element) => ({
    height: element.clientHeight, total: element.scrollHeight, original: element.scrollTop,
  }));
  if (geometry.total <= geometry.height) return;
  if (geometry.height <= 0 || Math.ceil(geometry.total / geometry.height) > 100) {
    throw new Error('Scroll-section coverage exceeds bounded capture limits');
  }
  const measure = () => main.evaluate((element) => ({
    height: element.clientHeight, total: element.scrollHeight, top: element.scrollTop,
  }));
  // Require three matching samples within twelve double-RAF turns. Re-clamp
  // against the live extent so a finite layout/anchoring change can settle.
  const settle = (offset) => main.evaluate(async (element, target) => {
    let previous;
    let stable = 0;
    for (let sample = 0; sample < 12; sample += 1) {
      element.scrollTop = Math.min(target, Math.max(0, element.scrollHeight - element.clientHeight));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const current = { height: element.clientHeight, total: element.scrollHeight, top: element.scrollTop };
      if (current.height <= 0 || Math.ceil(current.total / current.height) > 100) {
        throw new Error('Scroll-section coverage exceeds bounded capture limits');
      }
      const expected = Math.min(target, Math.max(0, current.total - current.height));
      if (Math.abs(current.top - expected) > 1) stable = 0;
      else stable = previous?.height === current.height && previous.total === current.total &&
        Math.abs(previous.top - current.top) <= 1 ? stable + 1 : 1;
      if (stable === 3) return current;
      previous = current;
    }
    throw new Error('Scroll-section geometry did not settle within bounded capture limits');
  }, offset);
  const matches = (actual, expected) => actual.height === expected.height && actual.total === expected.total &&
    Math.abs(actual.top - expected.top) <= 1;
  let captures = 0;
  const anchors = typeof main.evaluateHandle === 'function'
    ? await main.evaluateHandle((root) => ({ root, ids: new WeakMap(), next: 1 })) : undefined;
  try {
    if (anchors) {
      captureProofs.set(page, await captureAnchoredMain(page, anchors, path, beforeCapture));
      return;
    }
    // A changed extent invalidates earlier tiles, not just the bottom target.
    // Attempt at most three full passes, with at most 100 section captures.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const extent = await settle(0);
      let changed = false;
      let last;
      for (let offset = 0, index = 0; offset < extent.total; offset += extent.height, index += 1) {
        const current = index === 0 ? extent : await settle(offset);
        if (current.height !== extent.height || current.total !== extent.total) { changed = true; break; }
        const expected = { ...extent, top: Math.min(offset, Math.max(0, extent.total - extent.height)) };
        await beforeCapture();
        if (!matches(await measure(), expected)) { changed = true; break; }
        if (captures >= 100) throw new Error('Scroll-section coverage exceeds bounded capture limits');
        captures += 1;
        await page.screenshot({ path: path.replace(/\.png$/, `-section-${index + 1}.png`), fullPage: true });
        if (!matches(await measure(), expected)) { changed = true; break; }
        last = expected;
      }
      if (!changed && last && matches(await settle(last.top), last)) return;
    }
    throw new Error('Scroll-section extent remained unstable; all-sections coverage unverified');
  } finally {
    try { await main.evaluate((element, original) => { element.scrollTop = original; }, geometry.original); }
    finally { await anchors?.dispose(); }
  }
}

export function sanitizedBrowserFailure(error, step) {
  const type = ['Error', 'TimeoutError', 'TypeError', 'RangeError', 'SyntaxError'].includes(error?.name)
    ? error.name : 'Error';
  const message = typeof error?.message === 'string' ? error.message : '';
  // Allowlist diagnostics rather than redacting arbitrary strings: URLs, selectors,
  // IDs, page text, credentials and call logs must never enter the receipt.
  const network = message.match(/\bnet::(ERR_(?:CONNECTION_REFUSED|CONNECTION_RESET|NAME_NOT_RESOLVED|TIMED_OUT|ABORTED|FAILED|CERT_AUTHORITY_INVALID))\b/)?.[1];
  const detail = network ?? (type === 'TimeoutError' || /\btimeout\b/i.test(message)
    ? 'timeout' : /(?:browser|context|page).*(?:closed|crashed)/i.test(message)
      ? 'browser target closed or crashed' : 'operation failed; private details omitted');
  const safeStep = ['setup', 'viewport', 'navigation', 'readiness', 'theme-settings', 'theme-sync', 'classification', 'geometry', 'screenshot'].includes(step)
    ? step : 'browser-operation';
  return { type, step: safeStep, detail };
}

function isForcedColorsReview(text, index, match) {
  const color = match.match(/^(?:bg|text|border(?:-[trblxyse])?|outline|ring(?:-offset)?|decoration|fill|stroke|caret|accent|divide(?:-[xy])?)-\[([a-z]+)\]$/i)?.[1];
  if (!color || !systemColors.has(color.toLowerCase())) return false;
  const end = index + match.length;
  if (end < text.length && !/[\s"'`]/.test(text[end])) return false;
  // Only top-level variant separators count; selector/value colons do not.
  const brackets = [];
  const variants = [];
  let start = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const char = text[cursor];
    if (char === '\\') return false;
    if (char === '[' || char === '(') brackets.push(char);
    else if (char === ']' || char === ')') {
      if (brackets.pop() !== (char === ']' ? '[' : '(')) return false;
    } else if (!brackets.length) {
      if (/[\s"'`]/.test(char)) { start = cursor + 1; variants.length = 0; }
      else if (char === ':') { variants.push(text.slice(start, cursor)); start = cursor + 1; }
    }
  }
  return brackets.length === 0 && variants.every(Boolean) &&
    variants.includes('forced-colors') && ['', '!'].includes(text.slice(start, index));
}

function persistedThemeIdentityLiterals(tree) {
  const canonicalImports = new Set();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== '@/components/ui/ThemeProvider' ||
        !statement.importClause || statement.importClause.isTypeOnly ||
        !statement.importClause.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const binding of statement.importClause.namedBindings.elements) {
      if (!binding.isTypeOnly && (binding.propertyName ?? binding.name).text === 'useTheme') canonicalImports.add(binding);
    }
  }
  const literals = new Set();
  if (!canonicalImports.size || tree.parseDiagnostics.length) return literals;
  // Bind just this AST, without resolving imports, reading other files or compiling the app.
  const program = ts.createProgram([tree.fileName], { noResolve: true, noLib: true }, {
    getSourceFile: (name) => name === tree.fileName ? tree : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '',
    getDirectories: () => [], fileExists: (name) => name === tree.fileName,
    readFile: () => undefined, getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
  });
  const checker = program.getTypeChecker();
  if (tree.bindDiagnostics?.length) return literals;
  const symbolAt = (node) => checker.getSymbolAtLocation(node);
  const written = new Set();
  function markWritten(node) {
    if (ts.isShorthandPropertyAssignment(node)) written.add(checker.getShorthandAssignmentValueSymbol(node));
    if (ts.isIdentifier(node)) written.add(symbolAt(node));
    ts.forEachChild(node, markWritten);
  }
  function collectWrites(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) markWritten(node.left);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) markWritten(node.operand);
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) markWritten(node.initializer);
    ts.forEachChild(node, collectWrites);
  }
  collectWrites(tree);
  const enclosing = (node, predicate) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (predicate(parent)) return parent;
    return undefined;
  };
  function proven(identifier, comparison) {
    const symbol = symbolAt(identifier);
    if (!symbol || written.has(symbol) || symbol.declarations?.length !== 1) return false;
    const binding = symbol.declarations[0];
    if (!ts.isBindingElement(binding) || !ts.isIdentifier(binding.name) ||
        binding.initializer || binding.dotDotDotToken ||
        !ts.isIdentifier(binding.propertyName ?? binding.name) ||
        (binding.propertyName ?? binding.name).text !== 'themeId' ||
        !ts.isObjectBindingPattern(binding.parent)) return false;
    const declaration = binding.parent.parent;
    if (!ts.isVariableDeclaration(declaration) || declaration.name !== binding.parent ||
        !ts.isVariableDeclarationList(declaration.parent) ||
        !(declaration.parent.flags & ts.NodeFlags.Const) ||
        !ts.isVariableStatement(declaration.parent.parent)) return false;
    const scope = declaration.parent.parent.parent;
    const fn = enclosing(declaration, ts.isFunctionLike);
    if (!ts.isBlock(scope) || !fn || enclosing(comparison, ts.isFunctionLike) !== fn ||
        enclosing(comparison, ts.isBlock) !== scope || declaration.end >= comparison.getStart(tree)) return false;
    // Presentation attributes and template substitutions are not identity-only contexts.
    if (enclosing(comparison, (node) => ts.isJsxAttribute(node) ||
        ts.isPropertyAssignment(node) || ts.isTemplateExpression(node))) return false;
    const call = declaration.initializer;
    if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) ||
        call.arguments.length || call.typeArguments?.length || call.questionDotToken) return false;
    const hook = symbolAt(call.expression);
    return Boolean(hook && !written.has(hook) && hook.declarations?.length === 1 &&
      canonicalImports.has(hook.declarations[0]));
  }
  function visit(node) {
    if (ts.isBinaryExpression(node) &&
        [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
      for (const [literal, identifier] of [[node.left, node.right], [node.right, node.left]]) {
        if (ts.isStringLiteral(literal) && literal.text === 'neon-cyan' &&
            ts.isIdentifier(identifier) && proven(identifier, node)) literals.add(literal);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return literals;
}

export function scanSource(source, file) {
  const normalized = file.replaceAll('\\', '/');
  const findings = [];
  const patterns = [
    ['hardcoded-color', /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\brgba?\([^)]*\)/gi, 'Use existing semantic/theme/chart color roles; preserve actual logos/media.'],
    ['arbitrary-tailwind', /\b(?:[a-z][\w-]*-)?[a-z][\w-]*-\[[^\]\r\n]+\]/gi, 'Use existing spacing/type/shape tokens; review genuine computed/container exceptions.'],
    ['glow-neon', /\b(?:[\w-]*(?:neon|glow)[\w-]*|drop-shadow-\[[^\]]+\])/gi, 'Remove decorative glow/neon; retain persisted IDs only at their owners.'],
  ];
  function add(rule, match, offset, action, forcedColorsReview = false, persistedIdentityReview = false) {
    const before = source.slice(0, offset);
    const line = before.split('\n').length;
    const column = offset - before.lastIndexOf('\n');
    const tokenReference = rule === 'arbitrary-tailwind' && /(?:var\(--|--[\w-]+)/.test(match);
    const classification = owners.has(normalized) && rule !== 'nonstandard-icon-import'
      ? 'token-owner-exemption' : tokenReference ? 'token-reference-review'
        : forcedColorsReview ? 'forced-colors-accessibility-review'
          : persistedIdentityReview ? 'persisted-theme-identity-review' : 'candidate-violation';
    if (classification === 'forced-colors-accessibility-review') {
      action = 'Retain standard forced-colors system color; review MDC-041 focus, borders and selected states in OS high contrast. Static evidence is not accessibility acceptance.';
    }
    if (classification === 'persisted-theme-identity-review') {
      action = 'Preserve the saved neon-cyan theme ID (MDC-010/044): canonical ThemeProvider useTheme, immutable themeId binding and strict comparison proven in the same lexical scope. Review identity only; decorative neon CSS remains prohibited. Not browser/page acceptance.';
    }
    findings.push({ file, line, column, rule, match, classification, action });
  }
  const inspect = (text, offset, persistedIdentityReview = false) => {
    for (const [rule, pattern, action] of patterns) {
      for (const match of text.matchAll(pattern)) {
        add(rule, match[0], offset + match.index, action,
          rule === 'arbitrary-tailwind' && isForcedColorsReview(text, match.index, match[0]),
          rule === 'glow-neon' && match[0] === 'neon-cyan' && persistedIdentityReview);
      }
    }
  };
  if (/\.(?:css|scss)$/.test(file)) {
    const masked = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, ' '));
    inspect(masked, 0);
  } else {
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const persistedIdentities = persistedThemeIdentityLiterals(tree);
    function visit(node) {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        inspect(node.getText(tree), node.getStart(tree), persistedIdentities.has(node));
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const module = node.moduleSpecifier.text;
        if (/^(?:react-icons(?:\/|$)|@(?:heroicons|tabler|phosphor-icons|fortawesome|ant-design|iconify)\/|phosphor-react$|@mui\/icons-material|(?:lucide|feather|iconoir)-react$)/.test(module) && module !== 'lucide-react') {
          add('nonstandard-icon-import', module, node.moduleSpecifier.getStart(tree), 'Use canonical Lucide concepts through existing Icon; do not add another icon family.');
        }
        if (module === 'lucide-react' && ts.isImportDeclaration(node) && node.importClause &&
            !node.importClause.isTypeOnly && node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) {
          add('nonstandard-icon-import', node.getText(tree), node.getStart(tree), 'Use route-local named Lucide imports; avoid eager namespace registry imports.');
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return findings;
}

async function scanTree(start) {
  const findings = [];
  const excluded = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = resolve(path, entry.name);
      const file = relative(webRoot, absolute);
      if (entry.isSymbolicLink()) { excluded.push({ file, reason: 'symlink not followed' }); continue; }
      if (entry.isDirectory()) {
        if (/^(?:node_modules|__tests__|test|i18n|developer-reference)$/.test(entry.name)) {
          excluded.push({ file, reason: 'dependency, catalog or DEV/QA owner' });
        } else await walk(absolute);
      } else if (/\.(?:tsx?|jsx?|css|scss)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
        findings.push(...scanSource(await readFile(absolute, 'utf8'), file));
      }
    }
  }
  const entry = await lstat(start);
  if (entry.isSymbolicLink()) throw new Error('Scan scope cannot be a symlink');
  if (entry.isDirectory()) await walk(start);
  else if (/\.(?:tsx?|jsx?|css|scss)$/.test(start)) {
    findings.push(...scanSource(await readFile(start, 'utf8'), relative(webRoot, start)));
  } else throw new Error('Scan scope must be a source file or directory');
  return { findings, excluded };
}

export function selectChromiumSmokeUse(config) {
  if (!Array.isArray(config?.config?.projects)) {
    throw new Error('BLOCKED: installed Playwright public project configuration is unavailable');
  }
  const use = config.config.projects.find((project) => project.name === 'chromium-smoke')?.use;
  if (!use) throw new Error('BLOCKED: existing chromium-smoke project is unavailable');
  return use;
}

async function browserChecks(command, options, plans) {
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('BLOCKED: browser gates require package-supported Node >=26');
  if (!process.env.E2E_BASE_URL) throw new Error('BLOCKED: set E2E_BASE_URL for an already running authorized application');
  if (process.env.E2E_MOCKS && process.env.E2E_MOCKS !== '0') throw new Error('BLOCKED: browser route QA cannot use mocks');
  if (command === 'capture' && process.env.E2E_SENSITIVE === '1') throw new Error('BLOCKED: existing E2E_SENSITIVE safeguard disables screenshots');
  // Reuse the installed Playwright config loader rather than a second TS/config framework.
  // Its compilation cache is an explicitly ignored QA artifact, never a system temp path.
  process.env.PWTEST_CACHE_DIR = resolve(webRoot, '..', 'qa-screenshots', '.playwright-cache');
  const common = await import('playwright/lib/common');
  const configLoader = common.configLoader ?? common.default?.configLoader;
  if (!configLoader?.loadConfigFromFile) throw new Error('BLOCKED: installed Playwright config loader adapter is unavailable');
  const config = await configLoader.loadConfigFromFile(resolve(webRoot, 'playwright.config.ts'));
  const use = selectChromiumSmokeUse(config);
  const { chromium, expect } = await import('@playwright/test');
  const runDirectory = resolve(webRoot, '..', 'qa-screenshots', new Date().toISOString().replaceAll(':', '-') + `-${process.pid}`);
  const mode = options.theme ?? use.colorScheme;
  if (!['dark', 'light'].includes(mode)) throw new Error('BLOCKED: browser application mode must be dark or light');
  const browser = await chromium.launch({ headless: true });
  let context;
  const results = [];
  try {
    context = await browser.newContext({
      baseURL: use.baseURL, storageState: use.storageState, locale: use.locale,
      timezoneId: use.timezoneId, serviceWorkers: 'block',
      colorScheme: mode, reducedMotion: 'reduce',
    });
    await context.addInitScript(seedApplicationMode, { origin: new URL(use.baseURL).origin, mode });
    for (const plan of plans) {
      if (plan.blocked) { results.push({ route: plan.template, status: 'BLOCKED', reason: plan.blocked }); continue; }
      for (const width of command === 'capture' ? CAPTURE_WIDTHS : OVERFLOW_WIDTHS) {
        const page = await context.newPage();
        const failures = [];
        const result = { route: plan.template, width, theme: mode, status: 'BLOCKED' };
        let step = 'setup';
        page.on('pageerror', () => failures.push('uncaught page error'));
        page.on('response', (response) => {
          if (response.status() >= 400 && ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(response.request().resourceType())) failures.push(`failed resource ${response.status()}`);
        });
        // No interactions; prevent accidental source-driven API writes during navigation.
        await page.route('**/*', (route) => {
          if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
            failures.push('non-read request blocked'); return route.abort();
          }
          return route.continue();
        });
        try {
          step = 'viewport';
          await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
          // ThemeProvider's initial settings read can override local storage.
          // Wait for that real response, then use its read-only cross-tab sync.
          const settings = page.waitForResponse((response) =>
            new URL(response.url()).pathname === '/api/v1/settings' && response.request().method() === 'GET',
          { timeout: use.navigationTimeout ?? 20000 }).then(async (response) => {
            await response.finished();
            return true;
          }, () => false);
          step = 'navigation';
          const response = await page.goto(plan.route, { waitUntil: 'domcontentloaded', timeout: use.navigationTimeout ?? 20000 });
          step = 'readiness';
          const ready = page.locator(options.ready ?? 'main').first();
          await ready.waitFor({ state: 'visible', timeout: use.actionTimeout ?? 8000 });
          step = 'theme-settings';
          if (!await settings) {
            result.reason = 'Application theme settings did not settle; mode unverified';
            continue;
          }
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
          });
          step = 'theme-sync';
          await page.evaluate(synchronizeApplicationMode, mode);
          await page.waitForFunction(({ savedMode }) => {
            const root = document.documentElement;
            return localStorage.getItem('teslasync-mode') === savedMode &&
              root.style.colorScheme === savedMode &&
              root.classList.contains('dark') === (savedMode === 'dark') &&
              root.classList.contains('light-mode') === (savedMode === 'light');
          }, { savedMode: mode }, { timeout: use.actionTimeout ?? 8000 });
          if (!applicationModeMatches(mode, await page.evaluate(mountedApplicationMode))) {
            result.reason = 'Mounted application mode mismatch; no capture or overflow pass';
            continue;
          }
          step = 'readiness';
          await expect.poll(async () => isPageBusy(await page
            .locator('[aria-busy="true"], [role="status"], [role="progressbar"]')
            .evaluateAll(inspectIndicators)), { timeout: use.navigationTimeout ?? 20000 }).toBe(false);
          step = 'classification';
          const indicators = await page.locator('[aria-busy="true"], [role="status"], [role="progressbar"]').evaluateAll(inspectIndicators);
          const state = classifyPage({
            requestedURL: new URL(plan.route, use.baseURL).href, finalURL: page.url(),
            status: response?.status(), visible: await ready.isVisible(), text: await ready.innerText(),
            authVisible: await page.locator('input[type="password"]:visible, form[action*="login"]:visible').count() > 0,
            failureVisible: await page.getByText(/page failed to load|page not found|authentication required|sign in to continue/i).count() > 0,
            busy: isPageBusy(indicators),
            emptyView: await ready.evaluate((element) => {
              const emptyStatuses = [...element.querySelectorAll('[role="status"]')]
                .filter((node) => node.getClientRects().length > 0 && !node.closest('[hidden], [aria-hidden="true"]'));
              if (!emptyStatuses.length) return false;
              const clone = element.cloneNode(true);
              clone.querySelectorAll('[role="status"], h1, h2, h3, button, a, [hidden], [aria-hidden="true"]').forEach((node) => node.remove());
              return !clone.textContent?.trim();
            }),
          });
          if (state.status !== 'READY') { Object.assign(result, state); continue; }
          step = 'geometry';
          result.geometry = await page.evaluate(() => Object.fromEntries(['root', 'body'].map((key) => {
            const element = key === 'root' ? document.documentElement : document.body;
            return [key, { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }];
          })));
          if (checkOverflow(result.geometry)) failures.push('horizontal overflow');
          if (command === 'capture') {
            step = 'screenshot';
            await mkdir(runDirectory, { recursive: true });
            const name = plan.template === '/' ? 'dashboard' : plan.template.slice(1).replace(/[^a-zA-Z0-9_-]/g, '-');
            const destination = resolve(runDirectory, `${name}-${width}-${options.theme ?? use.colorScheme}.png`);
            if (!applicationModeMatches(mode, await page.evaluate(mountedApplicationMode))) {
              result.reason = 'Mounted application mode changed before capture';
              continue;
            }
            await captureFullPage(page, destination, async () => {
              if (!applicationModeMatches(mode, await page.evaluate(mountedApplicationMode))) {
                throw new Error('Application mode changed during section capture');
              }
              if (isPageBusy(await page.locator('[aria-busy="true"], [role="status"], [role="progressbar"]').evaluateAll(inspectIndicators))) {
                throw new Error('Application became busy during section capture');
              }
            });
            if (captureProofs.has(page)) result.captureProof = captureProofs.get(page);
          }
          result.status = 'PASSED';
        } catch (error) {
          Object.assign(result, { status: 'BLOCKED',
            reason: step === 'theme-sync' ? 'Mounted application mode mismatch or synchronization failure' : 'Navigation/readiness/browser failure; no screenshot or overflow pass',
            failure: sanitizedBrowserFailure(error, step) });
        } finally {
          await page.close();
          if (failures.length) {
            result.reasons = [...new Set(failures)];
            if (result.status === 'PASSED') result.status = 'FAILED';
          }
          results.push(result);
        }
      }
    }
  } finally { try { await context?.close(); } finally { await browser.close(); } }
  return results;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === 'help' || command === '--help') { console.log(help); return 0; }
  if (command === 'scan') {
    const start = resolve(webRoot, options.path ?? 'src');
    const within = relative(resolve(webRoot, 'src'), start);
    if (within.startsWith('..') || within.includes(`..${sep}`)) throw new Error('Scan scope must be inside web/src');
    const report = await scanTree(start);
    const counts = Object.fromEntries(['candidate-violation', 'token-reference-review', 'token-owner-exemption', 'forced-colors-accessibility-review'].map((key) =>
      [key, report.findings.filter((finding) => finding.classification === key).length]));
    const identityReviews = report.findings.filter((finding) => finding.classification === 'persisted-theme-identity-review').length;
    // Preserve the existing count shape for reports without this new review category.
    if (identityReviews) counts['persisted-theme-identity-review'] = identityReviews;
    console.log(JSON.stringify({ evidence: 'static candidates only; no visual acceptance', counts, ...report }, null, 2));
    return counts['candidate-violation'] ? 1 : 0;
  }
  const registry = parseRegistry(await readFile(resolve(webRoot, 'src', 'lib', 'routeRegistry.ts'), 'utf8'));
  const routeMap = options['route-map'] ? JSON.parse(await readFile(resolve(options['route-map']), 'utf8')) : {};
  const plans = planRoutes(registry, routeMap, options.route);
  if (command === 'routes') { console.log(JSON.stringify({ source: 'web/src/lib/routeRegistry.ts', plans }, null, 2)); return 0; }
  const results = await browserChecks(command, options, plans);
  console.log(JSON.stringify({ evidence: 'bounded route geometry/capture only; not application acceptance', results }, null, 2));
  return results.some((result) => result.status === 'BLOCKED') ? 2 : results.some((result) => result.status === 'FAILED') ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message); process.exitCode = 2;
  });
}
