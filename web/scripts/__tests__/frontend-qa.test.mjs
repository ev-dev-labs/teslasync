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
  applicationModeMatches, captureFullPage, sanitizedBrowserFailure,
} from '../frontend-qa.mjs';
import { EXTREME_VALUES, EXTREME_TEXT, EXTREME_CASES, QA_READINESS_CASES, createExtremeRows } from '../../e2e/fixtures/frontend-modernization.ts';

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
