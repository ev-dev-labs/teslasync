import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import {
  CAPTURE_WIDTHS, OVERFLOW_WIDTHS, parseArgs, parseRegistry, planRoutes,
  classifyPage, checkOverflow, scanSource,
  isPageBusy, seedApplicationMode, synchronizeApplicationMode, mountedApplicationMode,
  applicationModeMatches, captureFullPage, sanitizedBrowserFailure, selectChromiumSmokeUse,
} from '../frontend-qa.mjs';
import { EXTREME_VALUES, EXTREME_TEXT, EXTREME_CASES, QA_READINESS_CASES, createExtremeRows } from '../../e2e/fixtures/frontend-modernization.ts';

test('actual installed Playwright loader selects public chromium-smoke use and fails closed when unavailable', async () => {
  const previousCache = process.env.PWTEST_CACHE_DIR;
  process.env.PWTEST_CACHE_DIR = fileURLToPath(new URL('../../../qa-screenshots/.playwright-cache', import.meta.url));
  try {
    const common = await import('playwright/lib/common');
    const { loadConfigFromFile } = common.configLoader;
    const config = await loadConfigFromFile(fileURLToPath(new URL('../../playwright.config.ts', import.meta.url)));
    assert.equal(Object.hasOwn(config, 'fullConfig'), false);
    const publicConfig = config.config;
    const projects = publicConfig.projects;
    const smoke = projects.find((project) => project.name === 'chromium-smoke');
    assert.ok(smoke);
    const use = selectChromiumSmokeUse(config);
    assert.strictEqual(use, smoke.use);
    assert.equal(use.baseURL, process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173');
    assert.equal(use.colorScheme, 'dark');
    assert.equal(use.locale, 'en-US');
    assert.equal(use.timezoneId, 'UTC');
    assert.equal(use.actionTimeout, 8000);
    assert.equal(use.navigationTimeout, 20000);
    try {
      config.config = undefined;
      assert.throws(() => selectChromiumSmokeUse(config), /BLOCKED: installed Playwright public project configuration is unavailable/);
      config.config = publicConfig;
      publicConfig.projects = undefined;
      assert.throws(() => selectChromiumSmokeUse(config), /BLOCKED: installed Playwright public project configuration is unavailable/);
      publicConfig.projects = projects.filter((project) => project !== smoke);
      assert.throws(() => selectChromiumSmokeUse(config), /BLOCKED: existing chromium-smoke project is unavailable/);
      publicConfig.projects = projects;
      smoke.use = undefined;
      assert.throws(() => selectChromiumSmokeUse(config), /BLOCKED: existing chromium-smoke project is unavailable/);
    } finally {
      config.config = publicConfig;
      publicConfig.projects = projects;
      smoke.use = use;
    }
    assert.strictEqual(selectChromiumSmokeUse(config), use);
  } finally {
    if (previousCache === undefined) delete process.env.PWTEST_CACHE_DIR;
    else process.env.PWTEST_CACHE_DIR = previousCache;
  }
});

test('application preference seed is origin-isolated and root verification rejects media-only and backend overrides', () => {
  const saved = new Map([['teslasync-mode', 'oled'], ['teslasync-theme', 'matrix-green']]);
  const classes = new Set(['dark']);
  const root = { style: { colorScheme: 'dark' }, classList: { contains: (name) => classes.has(name) } };
  const sandbox = {
    location: { origin: 'http://localhost:4173' },
    localStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    document: { documentElement: root }, Date,
    StorageEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    window: { dispatchEvent: (event) => {
      assert.equal(event.type, 'storage');
      assert.equal(event.key, '__teslasync_bus_qa_mode');
      const { msg } = JSON.parse(event.newValue);
      assert.equal(msg.type, 'theme.changed');
      assert.equal(msg.themeId, 'matrix-green');
      root.style.colorScheme = msg.modeId;
      classes.clear();
      classes.add(msg.modeId === 'dark' ? 'dark' : 'light-mode');
    } },
  };
  const seed = (origin, mode) => runInNewContext(`(${seedApplicationMode})(${JSON.stringify({ origin, mode })})`, sandbox);
  seed('https://auth.example', 'light');
  assert.equal(saved.get('teslasync-mode'), 'oled');
  seed(sandbox.location.origin, 'light');
  const actual = () => runInNewContext(`(${mountedApplicationMode})()`, sandbox);
  assert.equal(applicationModeMatches('light', actual()), false);
  saved.set('teslasync-mode', 'dark'); // Real settings bootstrap can override the seed.
  for (const mode of ['light', 'dark']) {
    runInNewContext(`(${synchronizeApplicationMode})('${mode}')`, sandbox);
    assert.equal(applicationModeMatches(mode, actual()), true);
    assert.equal(applicationModeMatches(mode === 'dark' ? 'light' : 'dark', actual()), false);
  }
  classes.add('light-mode');
  assert.equal(applicationModeMatches('dark', actual()), false);
});

test('measured and zero gauges do not block readiness; genuine loading still blocks', () => {
  const { measuredGauge, zeroGauge, settledStatus, ...loading } = QA_READINESS_CASES;
  assert.equal(isPageBusy([measuredGauge, zeroGauge, settledStatus]), false);
  for (const indicator of Object.values(loading)) assert.equal(isPageBusy([measuredGauge, indicator]), true);
  assert.equal(isPageBusy([{ ...measuredGauge, busy: 'true' }]), true);
});

test('capture requests all page sections, never viewport-only evidence', async () => {
  let captured;
  await captureFullPage({
    screenshot: async (options) => { captured = options; },
    locator: () => ({ first: () => ({ count: async () => 0 }) }),
  }, 'qa-screenshots\\synthetic.png');
  assert.deepEqual(captured, { path: 'qa-screenshots\\synthetic.png', fullPage: true });
});

test('fixed-height application main gets all-section evidence and its scroll position is restored', async () => {
  const element = { clientHeight: 900, scrollHeight: 2500, scrollTop: 300 };
  const screenshots = [];
  const main = {
    count: async () => 1,
    evaluate: async (fn, argument) => {
      const sandbox = { element, argument, requestAnimationFrame: (done) => done() };
      return runInNewContext(`(${fn})(element, argument)`, sandbox);
    },
  };
  await captureFullPage({
    screenshot: async (options) => screenshots.push({ ...options, top: element.scrollTop }),
    locator: () => ({ first: () => main }),
  }, 'synthetic.png');
  assert.deepEqual(screenshots.map(({ top }) => top), [300, 0, 900, 1600]);
  assert.ok(screenshots.every(({ fullPage }) => fullPage));
  assert.equal(screenshots.at(-1).path, 'synthetic-section-3.png');
  assert.equal(element.scrollTop, 300);
});

test('section capture failure restores scroll without claiming complete evidence', async () => {
  const element = { clientHeight: 900, scrollHeight: 2500, scrollTop: 300 };
  const main = {
    count: async () => 1,
    evaluate: async (fn, argument) => runInNewContext(`(${fn})(element, argument)`, {
      element, argument, requestAnimationFrame: (done) => done(),
    }),
  };
  let captures = 0;
  await assert.rejects(captureFullPage({
    screenshot: async () => { if (++captures === 2) throw new Error('Synthetic screenshot failure'); },
    locator: () => ({ first: () => main }),
  }, 'synthetic.png'), /Synthetic screenshot failure/);
  assert.equal(element.scrollTop, 300);
});

test('browser failures preserve allowlisted type, step and network context without private strings', () => {
  const privateText = 'https://user:password@example.com/drives/5YJ3E1EA7KF123456?token=secret&address=private';
  const timeout = Object.assign(new Error(`Timeout navigating ${privateText}`), { name: 'TimeoutError' });
  assert.deepEqual(sanitizedBrowserFailure(timeout, 'navigation'), { type: 'TimeoutError', step: 'navigation', detail: 'timeout' });
  const network = sanitizedBrowserFailure(new Error(`page.goto: net::ERR_CONNECTION_REFUSED at ${privateText}`), 'navigation');
  assert.equal(network.detail, 'ERR_CONNECTION_REFUSED');
  assert.equal(sanitizedBrowserFailure(new TypeError(privateText), 'readiness').type, 'TypeError');
  const unknown = sanitizedBrowserFailure({ name: privateText, message: privateText }, privateText);
  assert.deepEqual(unknown, { type: 'Error', step: 'browser-operation', detail: 'operation failed; private details omitted' });
  assert.doesNotMatch(JSON.stringify([network, unknown]), /password|secret|5YJ3E1EA7KF123456|address=private/);
});

test('capture and overflow matrices exactly match the assigned contract', () => {
  assert.deepEqual(CAPTURE_WIDTHS, [375, 768, 1440, 1920]);
  assert.deepEqual(OVERFLOW_WIDTHS, [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560]);
});

test('CLI rejects unknown, repeated, mismatched and incomplete arguments', () => {
  assert.deepEqual(parseArgs(['capture', '--route', '/battery']), { command: 'capture', options: { route: '/battery' } });
  for (const args of [
    ['unknown'], ['capture'], ['capture', '--route'], ['scan', '--route', '/'],
    ['capture', '--route', '/', '--route', '/battery'], ['overflow', '--theme', 'invalid'],
  ]) assert.throws(() => parseArgs(args));
});

test('production registry is actual source; unresolved detail routes are blocked', async () => {
  const source = await readFile(new URL('../../src/lib/routeRegistry.ts', import.meta.url), 'utf8');
  const routes = parseRegistry(source);
  assert.ok(routes.length > 100);
  assert.ok(routes.includes('/drives/:id'));
  assert.equal(planRoutes(routes).length, routes.length);
  assert.ok(planRoutes(routes).find((entry) => entry.template === '/drives/:id').blocked);
  assert.deepEqual(planRoutes(routes, { '/drives/:id': '/drives/123' }, '/drives/123'), [
    { template: '/drives/:id', route: '/drives/123', blocked: undefined },
  ]);
  for (const route of ['//evil.example', '/not-a-real-route', '/drives/../commands', '/drives/1?token=x']) {
    assert.throws(() => planRoutes(routes, {}, route));
  }
  assert.throws(() => planRoutes(routes, { '/drives/:id': '/commands' }));
  assert.throws(() => parseRegistry('const ROUTE_REGISTRY = [];'));
  assert.throws(() => parseRegistry('const ROUTE_REGISTRY = [{path:"/"},{path:"/"}];'));
  assert.throws(() => parseRegistry('const ROUTE_REGISTRY = makeRegistry();'));
});

test('auth redirects, empty routes, loading and errors can never pass', () => {
  const good = {
    requestedURL: 'http://localhost:4173/battery', finalURL: 'http://localhost:4173/battery',
    status: 200, visible: true, text: 'Battery health', authVisible: false, failureVisible: false, busy: false,
  };
  assert.equal(classifyPage(good).status, 'READY');
  for (const patch of [
    { finalURL: 'https://auth.example/login' }, { finalURL: 'http://localhost:4173/login' },
    { finalURL: 'http://localhost:4173/' }, { authVisible: true }, { text: ' \n' },
    { visible: false }, { status: 401 }, { status: null }, { failureVisible: true }, { busy: true },
    { emptyView: true }, { text: 'Loading…' }, { text: 'No data available' },
  ]) assert.equal(classifyPage({ ...good, ...patch }).status, 'BLOCKED');
});

test('overflow follows existing root/body one-pixel tolerance', () => {
  const geometry = { root: { clientWidth: 375, scrollWidth: 376 }, body: { clientWidth: 375, scrollWidth: 375 } };
  assert.equal(checkOverflow(geometry), false);
  assert.equal(checkOverflow({ ...geometry, body: { clientWidth: 375, scrollWidth: 377 } }), true);
});

test('source scanner gives exact locations, owner classifications and actionable remediation', () => {
  const source = '// "#abcdef" is not code\nconst color = "#abc";\nconst classes = "p-[13px] text-neon-cyan bg-[var(--surface-1)]";';
  const findings = scanSource(source, 'src/features/example.tsx');
  assert.equal(findings.find((finding) => finding.rule === 'hardcoded-color').line, 2);
  assert.equal(findings.find((finding) => finding.rule === 'hardcoded-color').column, 16);
  assert.equal(findings.filter((finding) => finding.rule === 'hardcoded-color').length, 1);
  assert.ok(findings.every((finding) => finding.action && finding.file && finding.column));
  assert.ok(findings.some((finding) => finding.classification === 'token-reference-review'));
  const owners = scanSource(source, 'src\\lib\\tokens.ts');
  assert.ok(owners.every((finding) => finding.classification === 'token-owner-exemption'));
  const css = scanSource('/* #fff */\nbody { color: rgb(1, 2, 3); background: #11223344; }', 'src/style.css');
  assert.equal(css.length, 2);
  assert.ok(css.every((finding) => finding.line === 2));
});

test('scanner supports multiline literals and rejects alternate/eager icon families, not local Lucide', () => {
  const source = `import { Car } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { HiCar } from '@heroicons/react/24/outline';
import * as Icons from 'lucide-react';
const styles = \`p-[13px]
text-glow bg-[rgba(0,0,0,0.5)]\`;`;
  const findings = scanSource(source, 'src/features/example.tsx');
  assert.equal(findings.filter((finding) => finding.rule === 'nonstandard-icon-import').length, 2);
  assert.equal(findings.find((finding) => finding.rule === 'hardcoded-color').line, 6);
});

test('fixtures preserve zero, null, undefined, valid negatives, huge numbers and independent many-row datasets', () => {
  for (const value of [0, 1, 999999, null, undefined, -1]) assert.ok(EXTREME_VALUES.includes(value));
  assert.ok(EXTREME_TEXT.vehicleName.length > 200);
  assert.equal(EXTREME_CASES.empty.length, 0);
  assert.equal(EXTREME_CASES.single.length, 1);
  const rows = createExtremeRows();
  assert.equal(rows.length, 1000);
  assert.equal(new Set(rows.map((row) => row.id)).size, 1000);
  assert.ok(rows.some((row) => row.value === null));
  assert.notEqual(createExtremeRows(1)[0], createExtremeRows(1)[0]);
  for (const count of [-1, 1.5, 10001, Infinity]) assert.throws(() => createExtremeRows(count));
});

test('CLI help works without browser startup; invalid invocation exits nonzero', () => {
  const cli = new URL('../frontend-qa.mjs', import.meta.url);
  const help = spawnSync(process.execPath, [fileURLToPath(cli), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /E2E_SENSITIVE/);
  const invalid = spawnSync(process.execPath, [fileURLToPath(cli), 'capture'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /requires --route/);
});

test('browser CLI retains sensitive, unmocked and explicit-runtime guards without launching a browser', () => {
  const cli = fileURLToPath(new URL('../frontend-qa.mjs', import.meta.url));
  for (const { command, env, reason } of [
    { command: 'capture', env: { E2E_BASE_URL: '', E2E_MOCKS: '0', E2E_SENSITIVE: '0' }, reason: /set E2E_BASE_URL/ },
    { command: 'capture', env: { E2E_BASE_URL: 'http://127.0.0.1:4173', E2E_MOCKS: '0', E2E_SENSITIVE: '1' }, reason: /E2E_SENSITIVE safeguard disables screenshots/ },
    { command: 'overflow', env: { E2E_BASE_URL: 'http://127.0.0.1:4173', E2E_MOCKS: '1', E2E_SENSITIVE: '0' }, reason: /cannot use mocks/ },
  ]) {
    const result = spawnSync(process.execPath, [cli, command, '--route', '/battery'], {
      encoding: 'utf8', env: { ...process.env, ...env },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, reason);
  }
});

function browserFixtureCLI(command, fixture = {}) {
  // Replace browser transport only; real public polling, classification, scroll
  // coverage, request blocking and CLI exit reporting stay in the actual helper.
  const browserModule = `
    import { expect } from ${JSON.stringify(import.meta.resolve('@playwright/test'))};
    import { runInNewContext } from 'node:vm';
    export { expect };
    const fixture = ${JSON.stringify(fixture)};
    const probe = { pages: [], writesBlocked: 0, readsContinued: 0, contextClosed: false, browserClosed: false };
    function newPage() {
      const info = { busyReads: 0, geometryReads: 0, screenshots: [], closed: false };
      probe.pages.push(info);
      const handlers = {};
      const saved = new Map();
      const classes = new Set();
      const root = { style: {}, classList: { contains: (name) => classes.has(name) } };
      const main = { clientHeight: 900, scrollHeight: 2500, scrollTop: 100 };
      const sandbox = {
        document: { documentElement: root, body: {}, fonts: { ready: Promise.resolve() } },
        localStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
        requestAnimationFrame: (done) => done(), Date,
        StorageEvent: class { constructor(type, options) { Object.assign(this, options); } },
        window: { dispatchEvent: (event) => {
          const mode = JSON.parse(event.newValue).msg.modeId;
          root.style.colorScheme = mode;
          classes.clear();
          classes.add(mode === 'dark' ? 'dark' : 'light-mode');
        } },
      };
      const run = (fn, argument, element) => runInNewContext(
        '(' + fn.toString() + ')(argument)', { ...sandbox, argument, element });
      let routeHandler;
      let modeReads = 0;
      const ready = {
        first() { return this; }, count: async () => 1,
        waitFor: async () => {}, isVisible: async () => true,
        innerText: async () => fixture.emptyText ? ' ' : 'Application settings',
        evaluate: async (fn, argument) => run(fn, argument ?? {
          ...main, querySelectorAll: () => fixture.emptyView ? [{
            getClientRects: () => [{}], closest: () => null,
          }] : [],
          cloneNode: () => ({ textContent: '', querySelectorAll: () => [] }),
        }),
      };
      const scroll = {
        first() { return this; }, count: async () => 1,
        evaluate: async (fn, argument) => runInNewContext(
          '(' + fn.toString() + ')(element, argument)', { ...sandbox, element: main, argument }),
      };
      return {
        on: (name, handler) => { handlers[name] = handler; },
        route: async (_pattern, handler) => { routeHandler = handler; },
        setViewportSize: async ({ width, height }) => {
          info.width = width;
          main.clientHeight = height;
          for (const element of [root, sandbox.document.body]) {
            element.clientWidth = width;
            element.scrollWidth = width + (fixture.overflow ? 2 : 0);
          }
        },
        waitForResponse: async () => ({ finished: async () => {} }),
        goto: async () => {
          for (const method of fixture.write ? ['GET', 'POST'] : ['GET']) {
            await routeHandler({
              request: () => ({ method: () => method }),
              abort: async () => { probe.writesBlocked += 1; },
              continue: async () => { probe.readsContinued += 1; },
            });
          }
          for (const status of fixture.resources ?? []) handlers.response({
            status: () => status, request: () => ({ resourceType: () => 'fetch' }),
          });
          if (fixture.pageError) handlers.pageerror(new Error('Synthetic page error'));
          return { status: () => 200 };
        },
        url: () => fixture.auth ? 'http://127.0.0.1:4173/login'
          : fixture.redirect ? 'http://127.0.0.1:4173/' : 'http://127.0.0.1:4173/settings',
        locator: (selector) => selector.startsWith('[aria-busy') ? {
          evaluateAll: async (inspect) => {
            info.busyReads += 1;
            const busy = fixture.permanentBusy || info.busyReads <= (fixture.transientReads ?? 0) ||
              (fixture.busyDuringCapture && info.busyReads >= 3);
            return inspect([{
              getClientRects: () => [{}], closest: () => null, querySelector: () => null,
              getAttribute: (name) => ({
                role: 'status', 'aria-label': busy ? 'Loading' : 'Live data',
                'aria-busy': busy ? 'true' : 'false',
              })[name] ?? null,
            }]);
          },
        } : selector.startsWith('input') ? { count: async () => fixture.authVisible ? 1 : 0 }
          : selector === 'main' ? { ...ready, first: () => scroll } : ready,
        getByText: () => ({ count: async () => fixture.failedView ? 1 : 0 }),
        evaluate: async (fn, argument) => {
          if (fn.name === 'mountedApplicationMode' && ++modeReads >= 2 && fixture.themeBeforeCapture) {
            root.style.colorScheme = 'light';
          }
          if (fn.toString().includes('Object.fromEntries')) info.geometryReads += 1;
          return run(fn, argument);
        },
        waitForFunction: async (fn, argument) => {
          if (fixture.themeMismatch || !run(fn, argument)) {
            throw Object.assign(new Error('Synthetic theme timeout'), { name: 'TimeoutError' });
          }
        },
        screenshot: async ({ path, fullPage }) => {
          if (fixture.captureError && info.screenshots.length === 1) throw new Error('Synthetic capture failure');
          info.screenshots.push({ path, fullPage, top: main.scrollTop });
        },
        close: async () => { info.closed = true; info.restoredTop = main.scrollTop; },
      };
    }
    export const chromium = { launch: async () => ({
      newContext: async () => ({
        addInitScript: async () => {}, newPage: async () => newPage(),
        close: async () => { probe.contextClosed = true; },
      }),
      close: async () => {
        probe.browserClosed = true;
        console.error('BROWSER_FIXTURE_PROBE ' + JSON.stringify(probe));
      },
    }) };
  `;
  const commonModule = `export const configLoader = { loadConfigFromFile: async () => ({
    config: { projects: [{ name: 'chromium-smoke', use: {
      baseURL: 'http://127.0.0.1:4173', colorScheme: 'dark',
      actionTimeout: 80, navigationTimeout: 250,
    } }] },
  }) };`;
  const preload = `
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const modules = ${JSON.stringify({ '@playwright/test': browserModule, 'playwright/lib/common': commonModule })};
    registerHooks({
      resolve(specifier, context, next) {
        return Object.hasOwn(modules, specifier)
          ? { url: 'data:text/javascript,' + encodeURIComponent(modules[specifier]), shortCircuit: true }
          : next(specifier, context);
      },
    });
    const fs = process.getBuiltinModule('fs/promises');
    const mkdir = fs.mkdir;
    fs.mkdir = async (path, ...args) => String(path).includes('qa-screenshots') ? undefined : mkdir(path, ...args);
    syncBuiltinESMExports();
  `;
  const result = spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('../frontend-qa.mjs', import.meta.url)),
    command, '--route', '/settings', '--theme', 'dark', '--ready', '[data-qa-ready]',
  ], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, E2E_BASE_URL: 'http://127.0.0.1:4173', E2E_MOCKS: '0', E2E_SENSITIVE: '0' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  const marker = result.stderr.split('\n').find((line) => line.startsWith('BROWSER_FIXTURE_PROBE '));
  assert.ok(marker, result.stderr);
  return { ...result, report: JSON.parse(result.stdout), probe: JSON.parse(marker.slice('BROWSER_FIXTURE_PROBE '.length)) };
}

test('transient mounted loading settles through public polling before readiness and geometry can pass', () => {
  const { status, report, probe } = browserFixtureCLI('overflow', { transientReads: 1 });
  assert.equal(status, 0);
  assert.deepEqual(report.results.map(({ width }) => width), OVERFLOW_WIDTHS);
  assert.ok(report.results.every((result) => result.status === 'PASSED' && !result.reasons && result.geometry));
  assert.ok(probe.pages.every((page) => page.busyReads >= 3 && page.geometryReads === 1 && page.closed));
  assert.equal(probe.readsContinued, OVERFLOW_WIDTHS.length);
  assert.equal(probe.contextClosed, true);
  assert.equal(probe.browserClosed, true);
});

test('permanent mounted loading times out BLOCKED with retained findings and no geometry or captures', () => {
  const { status, report, probe } = browserFixtureCLI('capture', { permanentBusy: true, resources: [503], write: true });
  assert.equal(status, 2);
  assert.deepEqual(report.results.map(({ width }) => width), CAPTURE_WIDTHS);
  for (const result of report.results) {
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.failure.step, 'readiness');
    assert.equal(result.failure.detail, 'timeout');
    assert.deepEqual(result.reasons, ['non-read request blocked', 'failed resource 503']);
    assert.equal(result.geometry, undefined);
  }
  assert.ok(probe.pages.every((page) => page.busyReads >= 2 && !page.geometryReads && !page.screenshots.length && page.closed));
  assert.equal(probe.writesBlocked, CAPTURE_WIDTHS.length);
  assert.equal(probe.browserClosed, true);
});

test('settled capture retains FAILED resource write page-error and overflow findings alongside all-scroll evidence', () => {
  const { status, report, probe } = browserFixtureCLI('capture', {
    resources: [501, 503, 404, 501], write: true, pageError: true, overflow: true,
  });
  assert.equal(status, 1);
  assert.deepEqual(report.results.map(({ width }) => width), CAPTURE_WIDTHS);
  for (const result of report.results) {
    assert.equal(result.status, 'FAILED');
    assert.deepEqual(result.reasons, [
      'non-read request blocked', 'failed resource 501', 'failed resource 503',
      'failed resource 404', 'uncaught page error', 'horizontal overflow',
    ]);
    assert.deepEqual(result.geometry, {
      root: { clientWidth: result.width, scrollWidth: result.width + 2 },
      body: { clientWidth: result.width, scrollWidth: result.width + 2 },
    });
  }
  for (const page of probe.pages) {
    assert.equal(page.screenshots.length, 4);
    assert.ok(page.screenshots.every(({ fullPage }) => fullPage));
    assert.match(page.screenshots.at(-1).path, /settings-\d+-dark-section-3\.png$/);
    assert.deepEqual(page.screenshots.map(({ top }) => top), [
      100, 0, page.width < 768 ? 844 : 900, page.width < 768 ? 1656 : 1600,
    ]);
    assert.equal(page.restoredTop, 100);
    assert.equal(page.closed, true);
  }
  assert.equal(probe.writesBlocked, CAPTURE_WIDTHS.length);
  assert.equal(probe.readsContinued, CAPTURE_WIDTHS.length);
});

test('settled overflow records real geometry despite resource findings and never falsely passes', () => {
  for (const fixture of [{ resources: [501, 503, 404], write: true }, { overflow: true }]) {
    const { status, report, probe } = browserFixtureCLI('overflow', fixture);
    assert.equal(status, 1);
    assert.deepEqual(report.results.map(({ width }) => width), OVERFLOW_WIDTHS);
    assert.ok(report.results.every((result) => result.status === 'FAILED' && result.geometry));
    assert.ok(probe.pages.every((page) => page.geometryReads === 1 && !page.screenshots.length));
    if (fixture.overflow) assert.ok(report.results.every(({ reasons }) => reasons.includes('horizontal overflow')));
    else assert.ok(report.results.every(({ reasons }) => reasons.includes('failed resource 404') && reasons.includes('non-read request blocked')));
  }
});

test('blocked auth redirect theme empty and failed views never receive diagnostic geometry or captures', () => {
  for (const fixture of [
    { auth: true }, { authVisible: true }, { redirect: true }, { themeMismatch: true },
    { emptyText: true }, { emptyView: true }, { failedView: true },
  ]) {
    const { status, report, probe } = browserFixtureCLI('capture', { ...fixture, resources: [501] });
    assert.equal(status, 2);
    assert.equal(report.results.length, CAPTURE_WIDTHS.length);
    assert.ok(report.results.every((result) => result.status === 'BLOCKED' &&
      result.reasons.includes('failed resource 501') && !result.geometry));
    assert.ok(probe.pages.every((page) => !page.geometryReads && !page.screenshots.length && page.closed));
  }
});

test('capture failures retain geometry and findings without claiming complete evidence or losing scroll restoration', () => {
  const { status, report, probe } = browserFixtureCLI('capture', { resources: [503], captureError: true, overflow: true });
  assert.equal(status, 2);
  for (const result of report.results) {
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.failure.step, 'screenshot');
    assert.deepEqual(result.reasons, ['failed resource 503', 'horizontal overflow']);
    assert.ok(result.geometry);
  }
  assert.ok(probe.pages.every((page) => page.screenshots.length === 1 && page.restoredTop === 100 && page.closed));
});

test('mounted theme and busy guards still block capture after settled classification with resource findings', () => {
  for (const fixture of [{ themeBeforeCapture: true }, { busyDuringCapture: true }]) {
    const { status, report, probe } = browserFixtureCLI('capture', { ...fixture, resources: [404] });
    assert.equal(status, 2);
    assert.ok(report.results.every((result) => result.status === 'BLOCKED' &&
      result.geometry && result.reasons.includes('failed resource 404')));
    assert.ok(probe.pages.every((page) => !page.screenshots.length && page.restoredTop === 100 && page.closed));
  }
});

const forcedColorsClasses = [
  'forced-colors:border-[CanvasText]', 'forced-colors:bg-[Canvas]',
  'forced-colors:text-[CanvasText]', 'forced-colors:border-[ButtonBorder]',
  'forced-colors:bg-[Highlight]', 'forced-colors:text-[HighlightText]',
];
const classificationFixture = (classes) => `const classes = ${JSON.stringify(classes.join(' '))};`;

test('MDC-041 required utilities preserve every finding, location and review action', () => {
  const source = classificationFixture(forcedColorsClasses);
  const findings = scanSource(source, 'src/components/ui/example.tsx');
  assert.equal(findings.length, forcedColorsClasses.length);
  for (const [index, finding] of findings.entries()) {
    assert.equal(finding.rule, 'arbitrary-tailwind');
    assert.equal(finding.match, forcedColorsClasses[index].split(':').at(-1));
    assert.equal(finding.classification, 'forced-colors-accessibility-review');
    assert.match(finding.action, /MDC-041/);
    assert.match(finding.action, /not accessibility acceptance/);
    assert.equal(finding.line, 1);
    assert.equal(source.slice(finding.column - 1, finding.column - 1 + finding.match.length), finding.match);
  }
});

test('real variant chains support system colors without treating selector colons as variants', () => {
  const classes = [
    'forced-colors:hover:bg-[Highlight]',
    'md:forced-colors:focus-visible:!outline-[Highlight]',
    "forced-colors:[&:not([data-state='closed'])]:text-[ButtonText]",
    '[&:hover]:forced-colors:border-[ButtonBorder]',
    'forced-colors:bg-[canvas]',
    'forced-colors:bg-[Field]', 'forced-colors:text-[FieldText]',
    'forced-colors:bg-[ButtonFace]',
  ];
  // Use a real template literal so selector quotes are not JSON escapes.
  const findings = scanSource(`const classes = \`${classes.join(' ')}\`;`, 'src/example.tsx');
  assert.equal(findings.length, classes.length);
  assert.ok(findings.every(({ classification }) => classification === 'forced-colors-accessibility-review'));
});

const negativeClasses = [
  'text-[CanvasText]', 'hover:bg-[Canvas]', 'not-forced-colors:text-[CanvasText]',
  'fake-forced-colors:bg-[Canvas]', '[forced-colors]:text-[CanvasText]',
  '[&:forced-colors]:text-[CanvasText]',
  "[&:not([data-mode='forced-colors'])]:text-[CanvasText]",
  'forced-colors::text-[CanvasText]', 'forced-colors:text-[CanvasText]/50',
  'forced-colors:text-[ImaginaryColor]', 'forced-colors:w-[Canvas]',
  'forced-colors:p-[13px]', 'forced-colors:bg-[#abcdef]',
  'forced-colors:bg-[rgb(1,2,3)]', 'forced-colors:shadow-[Highlight]',
  'forced-colors:text-glow', 'forced-colors:min-h-[calc(100vh-2rem)]',
  'forced-colors:max-w-[90vw]',
];

test('classification cannot leak across strings, utilities, selectors, templates or comments', () => {
  for (const classes of negativeClasses) {
    const findings = scanSource(`const classes = \`${classes}\`;`, 'src/example.tsx');
    assert.ok(findings.length > 0, classes);
    assert.ok(findings.every(({ classification }) => classification === 'candidate-violation'), classes);
  }
  for (const source of [
    'const classes = "forced-colors:bg-[Canvas] text-[CanvasText]";',
    'const variant = "forced-colors:"; const classes = "text-[CanvasText]";',
    '// forced-colors:\nconst classes = "text-[CanvasText]";',
    'const classes = `forced-colors:${variant}text-[CanvasText]`;',
    'const classes = `forced-colors: bg-[Canvas]`;',
  ]) {
    assert.equal(scanSource(source, 'src/example.tsx').filter(({ classification }) => classification === 'candidate-violation').length, 1, source);
  }
});

test('forced-colors review keeps token/owner precedence and independent icon findings', () => {
  const source = classificationFixture([...forcedColorsClasses, 'forced-colors:bg-[var(--surface-1)]']) +
    "\nimport { Car } from '@heroicons/react/24/outline';";
  const normal = scanSource(source, 'src/example.tsx');
  assert.equal(normal.filter(({ classification }) => classification === 'token-reference-review').length, 1);
  assert.equal(normal.filter(({ classification }) => classification === 'forced-colors-accessibility-review').length, 6);
  for (const file of ['src/example.tsx', 'src\\lib\\tokens.ts']) {
    const findings = scanSource(source, file);
    assert.equal(findings.find(({ rule }) => rule === 'nonstandard-icon-import').classification, 'candidate-violation');
    if (file.includes('tokens')) assert.equal(findings.filter(({ classification }) => classification === 'token-owner-exemption').length, 7);
  }
});

function scanFixtureCLI(source) {
  // In-memory source at one virtual scan path: never create/change UI fixtures.
  const path = fileURLToPath(new URL('../../src/__qa_classification_virtual__.tsx', import.meta.url));
  const preload = `
    import { syncBuiltinESMExports } from 'node:module';
    const fs = process.getBuiltinModule('fs/promises');
    const path = ${JSON.stringify(path)};
    const source = ${JSON.stringify(source)};
    const readFile = fs.readFile;
    const lstat = fs.lstat;
    fs.readFile = async (file, ...args) => file === path ? source : readFile(file, ...args);
    fs.lstat = async (file, ...args) => file === path
      ? { isSymbolicLink: () => false, isDirectory: () => false } : lstat(file, ...args);
    syncBuiltinESMExports();
  `;
  return spawnSync(process.execPath, [
    '--import', `data:text/javascript,${encodeURIComponent(preload)}`,
    fileURLToPath(new URL('../frontend-qa.mjs', import.meta.url)),
    'scan', '--path', path,
  ], { encoding: 'utf8' });
}

test('actual scan CLI retains review counts and exits nonzero for every negative fixture', () => {
  const positive = scanFixtureCLI(classificationFixture(forcedColorsClasses));
  assert.equal(positive.status, 0, positive.stderr);
  const report = JSON.parse(positive.stdout);
  assert.equal(report.findings.length, 6);
  assert.deepEqual(report.counts, {
    'candidate-violation': 0, 'token-reference-review': 0,
    'token-owner-exemption': 0, 'forced-colors-accessibility-review': 6,
  });
  for (const source of [
    ...negativeClasses.map((classes) => `const classes = \`${classes}\`;`),
    "import { Car } from '@heroicons/react/24/outline';",
  ]) {
    const result = scanFixtureCLI(source + '\n' + classificationFixture(forcedColorsClasses));
    assert.equal(result.status, 1, result.stderr);
    const negative = JSON.parse(result.stdout);
    assert.ok(negative.counts['candidate-violation'] > 0, source);
    assert.equal(negative.counts['forced-colors-accessibility-review'], 6, source);
    assert.equal(negative.findings.length, Object.values(negative.counts).reduce((sum, count) => sum + count, 0));
  }
  const negative = scanFixtureCLI(classificationFixture([...forcedColorsClasses, 'text-[CanvasText]', 'forced-colors:p-[13px]']));
  console.log('NEGATIVE FIXTURE CLI RAW OUTPUT:\n' + negative.stdout + '\nSTDERR:\n' + negative.stderr + '\nEXIT ' + negative.status);
});

const canonicalThemeImport = "import { useTheme } from '@/components/ui/ThemeProvider';";
const themeIdentityFixture = (body, imports = canonicalThemeImport, parameters = '') =>
  `${imports}\nfunction ThemeFirstRunBanner(${parameters}) {\n${body}\n}`;

test('canonical immutable themeId comparisons retain visible persisted identity review and exact source locations', () => {
  for (const source of [
    themeIdentityFixture("const { themeId } = useTheme();\nif (themeId !== 'neon-cyan') return null;"),
    themeIdentityFixture("const { themeId } = useTheme();\nreturn themeId === 'neon-cyan';"),
    themeIdentityFixture("const { themeId } = useTheme();\nreturn 'neon-cyan' !== themeId;"),
    themeIdentityFixture("const { themeId: savedTheme } = readTheme();\nif ('neon-cyan' === savedTheme) return null;",
      "import { useTheme as readTheme } from '@/components/ui/ThemeProvider';"),
    `${canonicalThemeImport}\nconst Banner = () => {\nconst { themeId } = useTheme();\nif (themeId !== 'neon-cyan') return null;\n};`,
    `${canonicalThemeImport}\nfunction Banner() {\n{ const { themeId } = useTheme();\nif (themeId !== 'neon-cyan') return null; }\n}`,
  ]) {
    const findings = scanSource(source, 'src/features/independent/page.tsx');
    assert.equal(findings.length, 1, source);
    const [finding] = findings;
    assert.equal(finding.rule, 'glow-neon');
    assert.equal(finding.match, 'neon-cyan');
    assert.equal(finding.classification, 'persisted-theme-identity-review');
    assert.match(finding.action, /canonical ThemeProvider useTheme/);
    assert.match(finding.action, /Preserve the saved neon-cyan theme ID/);
    assert.match(finding.action, /Not browser\/page acceptance/);
    const lines = source.split('\n');
    assert.equal(lines[finding.line - 1].slice(finding.column - 1, finding.column - 1 + finding.match.length), finding.match);
  }
});

test('identity proof never permits decorative class, style, template or arbitrary neon literals', () => {
  const sources = [
    'const classes = "text-neon-cyan";',
    'const styles = { color: "neon-cyan" };',
    'const text = `neon-cyan`;',
    'const arbitrary = "neon-cyan";',
    '<div className="neon-cyan" style={{ color: "neon-cyan" }} />;',
    themeIdentityFixture('const { themeId } = useTheme();\nreturn <div className={themeId === "neon-cyan"} />;'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn <div style={{ color: themeId === "neon-cyan" }} />;'),
    themeIdentityFixture('const { themeId } = useTheme();\nconst style = { color: themeId === "neon-cyan" };'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn `${themeId === "neon-cyan"}`;'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId === `neon-cyan`;'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId === "text-neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId === "glow-neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId === "neon-cyan text-neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId.includes("neon-cyan");'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId == "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId != "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId === ("neon-cyan");'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId === "neon-\\u0063yan";'),
    'body { color: neon-cyan; }',
  ];
  for (const source of sources) {
    const findings = scanSource(source, source.startsWith('body') ? 'src/example.css' : 'src/example.tsx');
    assert.ok(findings.length > 0, source);
    assert.ok(findings.every(({ classification }) => classification === 'candidate-violation'), source);
  }
  const mixed = scanSource(themeIdentityFixture(
    'const { themeId } = useTheme();\nif (themeId !== "neon-cyan") return null;\nreturn <div className="text-neon-cyan" style={{ color: "neon-cyan" }}>neon-cyan</div>;'),
  'src/example.tsx');
  assert.equal(mixed.filter(({ classification }) => classification === 'persisted-theme-identity-review').length, 1);
  assert.equal(mixed.filter(({ classification }) => classification === 'candidate-violation').length, 2);
});

test('foreign, type-only, default, namespace, wrapper and locally shadowed hooks never prove canonical provenance', () => {
  const comparison = 'const { themeId } = useTheme();\nif (themeId !== "neon-cyan") return null;';
  const sources = [
    themeIdentityFixture(comparison, "import { useTheme } from '@/hooks/useTheme';"),
    themeIdentityFixture(comparison, "import { useTheme } from '@/components/ui';"),
    themeIdentityFixture(comparison, "import { useTheme } from 'foreign-theme';"),
    themeIdentityFixture(comparison, "import useTheme from '@/components/ui/ThemeProvider';"),
    themeIdentityFixture(comparison, "import type { useTheme } from '@/components/ui/ThemeProvider';"),
    themeIdentityFixture(comparison, "import { type useTheme } from '@/components/ui/ThemeProvider';"),
    themeIdentityFixture(comparison, ''),
    themeIdentityFixture(comparison, 'function useTheme() { return externalTheme; }'),
    themeIdentityFixture(comparison, canonicalThemeImport, 'useTheme'),
    themeIdentityFixture(`const useTheme = foreignTheme;\n${comparison}`),
    themeIdentityFixture(`function useTheme() { return externalTheme; }\n${comparison}`),
    themeIdentityFixture(`${comparison}\nconst useTheme = foreignTheme;`),
    themeIdentityFixture(`{ const useTheme = foreignTheme;\n${comparison}\n}`),
    `${canonicalThemeImport}\nfunction outer(useTheme) { function inner() { ${comparison} } }`,
    `${canonicalThemeImport}\nfunction outer() { const useTheme = foreignTheme; return () => { ${comparison} }; }`,
    themeIdentityFixture('const { themeId } = Theme.useTheme();\nreturn themeId === "neon-cyan";',
      "import * as Theme from '@/components/ui/ThemeProvider';"),
    themeIdentityFixture('const readTheme = useTheme;\nconst { themeId } = readTheme();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme(externalTheme);\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme?.();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme<ForeignTheme>();\nreturn themeId === "neon-cyan";'),
    `${canonicalThemeImport}\nimport { useTheme } from 'foreign-theme';\nfunction Banner() { ${comparison} }`,
  ];
  for (const source of sources) {
    const findings = scanSource(source, 'src/example.tsx');
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].classification, 'candidate-violation', source);
  }
});

test('shadowed identity parameters, nested scopes and unknown destructuring flows remain strict candidates', () => {
  const sources = [
    themeIdentityFixture('const { themeId: savedTheme } = useTheme();\nreturn themeId === "neon-cyan";', canonicalThemeImport, 'themeId'),
    themeIdentityFixture('const { themeId } = useTheme();\nfunction inner(themeId) { return themeId === "neon-cyan"; }'),
    themeIdentityFixture('const { themeId } = useTheme();\nconst inner = (themeId) => themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\n{ const themeId = externalTheme;\nif (themeId !== "neon-cyan") return null; }'),
    themeIdentityFixture('const { themeId } = useTheme();\nfunction inner() { return themeId === "neon-cyan"; }'),
    themeIdentityFixture('const { themeId } = useTheme();\n{ if (themeId !== "neon-cyan") return null; }'),
    `${canonicalThemeImport}\nconst { themeId } = useTheme();\nfunction Banner() { return themeId === "neon-cyan"; }`,
    themeIdentityFixture('if (themeId !== "neon-cyan") return null;\nconst { themeId } = useTheme();'),
    themeIdentityFixture('const themeId = externalTheme;\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const themeId = useTheme().themeId;\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const theme = useTheme();\nconst { themeId } = theme;\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = externalTheme;\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = fake(useTheme());\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = flag ? useTheme() : externalTheme;\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme() as ForeignTheme;\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = { ...useTheme() };\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId = externalTheme } = useTheme();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { "themeId": themeId } = useTheme();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { [field]: themeId } = useTheme();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { nested: { themeId } } = useTheme();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const [themeId] = useTheme();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nconst savedTheme = themeId;\nreturn savedTheme === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nconst { themeId } = externalTheme;\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn (themeId as string) === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn external.themeId === "neon-cyan";'),
    themeIdentityFixture('const { themeId } = useTheme();\nreturn themeId === "neon-cyan";\nconst broken = ;'),
  ];
  for (const source of sources) {
    const findings = scanSource(source, 'src/example.tsx');
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].classification, 'candidate-violation', source);
  }
});

test('binding and hook reassignment before, after or inside closures invalidates persisted identity proof', () => {
  const sources = [
    themeIdentityFixture('let { themeId } = useTheme();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('var { themeId } = useTheme();\nreturn themeId === "neon-cyan";'),
    themeIdentityFixture('let themeId;\n({ themeId } = useTheme());\nreturn themeId === "neon-cyan";'),
    ...[
      'themeId = externalTheme;', 'themeId += externalTheme;', 'themeId ??= externalTheme;',
      'themeId ||= externalTheme;', 'themeId &&= externalTheme;', 'themeId++;', '--themeId;',
      '({ themeId } = externalTheme);', '({ value: themeId } = externalTheme);',
      '[themeId] = externalTheme;',
      'function mutate() { themeId = externalTheme; }',
      'for (themeId of externalThemes) {}', 'for (themeId in externalThemes) {}',
      'useTheme = foreignTheme;',
      'function replaceHook() { useTheme = foreignTheme; }',
    ].flatMap((mutation) => [
      themeIdentityFixture(`const { themeId } = useTheme();\n${mutation}\nreturn themeId === "neon-cyan";`),
      themeIdentityFixture(`const { themeId } = useTheme();\nif (themeId !== "neon-cyan") return null;\n${mutation}`),
    ]),
    themeIdentityFixture('const { themeId: savedTheme } = readTheme();\nsavedTheme = externalTheme;\nreturn savedTheme === "neon-cyan";',
      "import { useTheme as readTheme } from '@/components/ui/ThemeProvider';"),
    themeIdentityFixture('const { themeId } = readTheme();\nreadTheme = foreignTheme;\nreturn themeId === "neon-cyan";',
      "import { useTheme as readTheme } from '@/components/ui/ThemeProvider';"),
  ];
  for (const source of sources) {
    const findings = scanSource(source, 'src/example.tsx');
    assert.equal(findings.length, 1, source);
    assert.equal(findings[0].classification, 'candidate-violation', source);
  }
  const independent = scanSource(themeIdentityFixture(
    'const { themeId } = useTheme();\nfunction unrelated(themeId, useTheme) { themeId = externalTheme; useTheme = foreignTheme; }\nreturn themeId === "neon-cyan";'),
  'src/example.tsx');
  assert.equal(independent[0].classification, 'persisted-theme-identity-review');
});

test('persisted identity reviews keep token-owner precedence and all existing scan CLI count and exit semantics', () => {
  const identity = themeIdentityFixture('const { themeId } = useTheme();\nif (themeId !== "neon-cyan") return null;');
  const owner = scanSource(identity, 'src\\lib\\tokens.ts');
  assert.equal(owner.length, 1);
  assert.equal(owner[0].classification, 'token-owner-exemption');
  const positive = scanFixtureCLI(identity);
  assert.equal(positive.status, 0, positive.stderr);
  const report = JSON.parse(positive.stdout);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].classification, 'persisted-theme-identity-review');
  assert.deepEqual(report.counts, {
    'candidate-violation': 0, 'token-reference-review': 0,
    'token-owner-exemption': 0, 'forced-colors-accessibility-review': 0,
    'persisted-theme-identity-review': 1,
  });
  const negativeSources = [
    'const decorativeClasses = "text-neon-cyan";',
    'const style = { color: "neon-cyan" };',
    'const label = `neon-cyan`;',
    themeIdentityFixture('const { themeId } = fakeTheme();\nreturn themeId === "neon-cyan";',
      "import { useTheme as fakeTheme } from 'foreign-theme';"),
    themeIdentityFixture('const { themeId: savedTheme } = useTheme();\nreturn themeId === "neon-cyan";',
      '', 'themeId'),
    'const geometryClasses = "z-[9990] xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]";',
    "import { Car } from '@heroicons/react/24/outline';",
  ];
  for (const source of negativeSources) {
    const negative = source.replace('ThemeFirstRunBanner', 'ForeignThemeBanner');
    const result = scanFixtureCLI(`${identity}\n${negative}\n${classificationFixture(forcedColorsClasses)}\nconst tokens = "bg-[var(--surface-1)]";`);
    assert.equal(result.status, 1, result.stderr);
    const mixed = JSON.parse(result.stdout);
    assert.ok(mixed.counts['candidate-violation'] > 0, source);
    assert.equal(mixed.counts['persisted-theme-identity-review'], 1, source);
    assert.equal(mixed.counts['forced-colors-accessibility-review'], 6, source);
    assert.equal(mixed.counts['token-reference-review'], 1, source);
    assert.equal(mixed.findings.length, Object.values(mixed.counts).reduce((sum, count) => sum + count, 0));
  }
  console.log('PERSISTED IDENTITY CLI RAW OUTPUT:\n' + positive.stdout + '\nSTDERR:\n' + positive.stderr + '\nEXIT ' + positive.status);
});
