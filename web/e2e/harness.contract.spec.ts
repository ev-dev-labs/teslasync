import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AXE_DEBT_BY_ROUTE } from './axeBaseline';
import { isSensitiveRun, resolveStorageState } from './configEnv';
import { isSsePath, resolveApiFixture } from './mockApi';
import {
  QUALITY_ROUTES,
} from './routeRegistry';

test('declared route scenarios are unique', () => {
  const keys = QUALITY_ROUTES.flatMap((route) =>
    route.scenarios.map((scenario) => `${route.name}:${scenario}`));
  expect(new Set(keys).size).toBe(keys.length);
});

test('optional storage state is omitted cleanly and validates explicit paths', () => {
  expect(resolveStorageState({})).toBeUndefined();
  expect(resolveStorageState({ E2E_STORAGE_STATE: '   ' })).toBeUndefined();
  expect(resolveStorageState({ E2E_STORAGE_STATE: 'state.json' }, () => true)).toBe('state.json');
  expect(() => resolveStorageState({ E2E_STORAGE_STATE: 'missing.json' }, () => false))
    .toThrow('E2E_STORAGE_STATE does not exist: missing.json');
  expect(isSensitiveRun({ E2E_SENSITIVE: '1' })).toBe(true);
  expect(isSensitiveRun({})).toBe(false);
});

test('SSE paths are separate from JSON fixtures', () => {
  expect(isSsePath('/events')).toBe(true);
  expect(isSsePath('/signals/7/stream?fields=VehicleSpeed')).toBe(true);
  expect(resolveApiFixture('/events', 'GET', 'populated').matched).toBe(false);
  expect(resolveApiFixture('/signals/7/stream?fields=VehicleSpeed', 'GET', 'populated').matched)
    .toBe(false);
});

test('theme fixture honors the requested project theme', () => {
  expect(resolveApiFixture('/settings', 'GET', 'populated', 'dark').body).toMatchObject({ mode: 'dark' });
  expect(resolveApiFixture('/settings', 'GET', 'populated', 'light').body).toMatchObject({ mode: 'light' });
});

test('browser globals are not monkeypatched by state seeding', () => {
  const source = readFileSync(resolve(process.cwd(), 'e2e', 'mockApi.ts'), 'utf8');
  expect(source).not.toContain("Object.defineProperty(window, 'Date'");
  expect(source).not.toContain("Object.defineProperty(window, 'EventSource'");
  expect(source).not.toContain('HarnessEventSource');
});

test('Date semantics contract uses the standard hermetic API lifecycle', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'e2e', 'date.contract.smoke.spec.ts'),
    'utf8',
  );
  expect(source).toContain('installApiMocks');
  expect(source).toContain('waitForHarnessReady');
  expect(source).toContain('assertMockApiComplete');
  expect(source.indexOf('await installApiMocks')).toBeLessThan(source.indexOf('page.goto'));
  expect(source.indexOf('page.goto')).toBeLessThan(source.indexOf('await waitForHarnessReady'));
  const tryIndex = source.indexOf('try {', source.indexOf('await waitForHarnessReady'));
  const assertionCatchIndex = source.indexOf('} catch (error)', tryIndex);
  const assertionIndex = source.indexOf('page.evaluate', tryIndex);
  const completionIndex = source.indexOf('await assertMockApiComplete', assertionCatchIndex);
  expect(tryIndex).toBeGreaterThan(source.indexOf('await waitForHarnessReady'));
  expect(assertionIndex).toBeGreaterThan(tryIndex);
  expect(assertionIndex).toBeLessThan(assertionCatchIndex);
  expect(completionIndex).toBeGreaterThan(assertionCatchIndex);
  expect(source).not.toContain('} finally {');
  expect(source).toContain('new AggregateError(');
});

test('RUM transport remains enabled while E2E captures only reviewed beacon endpoints', () => {
  const vitalsReporter = readFileSync(
    resolve(process.cwd(), 'src', 'lib', 'webVitalsReporter.ts'),
    'utf8',
  );
  const errorReporter = readFileSync(
    resolve(process.cwd(), 'src', 'lib', 'errorReporter.ts'),
    'utf8',
  );
  const mockApi = readFileSync(resolve(process.cwd(), 'e2e', 'mockApi.ts'), 'utf8');
  expect(vitalsReporter).toContain("const ENDPOINT = '/api/v1/web-vitals'");
  expect(vitalsReporter).toContain('navigator.sendBeacon(ENDPOINT, blob)');
  expect(errorReporter).toContain("const ENDPOINT = '/api/v1/web-errors'");
  expect(errorReporter).toContain('fetch(ENDPOINT');
  expect(mockApi).toContain("Object.defineProperty(navigator, 'sendBeacon'");
  expect(mockApi).toContain("'/api/v1/web-vitals', '/api/v1/web-errors'");
  expect(mockApi).toContain("page.on('request'");
  expect(mockApi).not.toContain("performance.getEntriesByType('resource')");
  expect(mockApi).toContain("'API requests escaped or were blocked by Playwright routing'");
});

test('mocked browser runs cannot bypass API fixtures through the service worker', () => {
  const config = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
  const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
  expect(config).toContain("const mocksEnabled = process.env.E2E_MOCKS !== '0'");
  expect(config).toContain("serviceWorkers: mocksEnabled ? 'block' : 'allow'");
  expect(viteConfig).toContain("process.env.npm_lifecycle_event === 'e2e:build'");
  expect(viteConfig).toContain("process.env.E2E_MOCKS !== '0'");
  expect(viteConfig).toContain('disable: mockedE2eBuild');
});

test('catch-all API fixture rejects unknown paths', () => {
  expect(resolveApiFixture('/definitely-unmatched', 'GET', 'populated').matched).toBe(false);
  expect(resolveApiFixture('/definitely-unmatched', 'POST', 'populated').matched).toBe(false);
  expect(resolveApiFixture('/vehicles', 'GET', 'populated').matched).toBe(true);
});

test('axe debt registry remains zero', () => {
  expect(Object.keys(AXE_DEBT_BY_ROUTE)).toEqual([]);
  for (const routeDebt of Object.values(AXE_DEBT_BY_ROUTE)) {
    for (const debt of routeDebt) {
      expect(debt.rule).toBeTruthy();
      expect(debt.owner).toBeTruthy();
      expect(debt.tracking).toBeTruthy();
      expect(debt.targets.length).toBeGreaterThan(0);
      expect(new Set(debt.targets).size).toBe(debt.targets.length);
    }
  }
});

test('authenticated smoke records only sanitized aggregate status', () => {
  const workflow = readFileSync(resolve(process.cwd(), '..', '.github', 'workflows', 'frontend-quality.yml'), 'utf8');
  const productionJob = workflow.split('  authenticated-production-smoke:')[1];
  expect(productionJob).toContain("E2E_SENSITIVE: '1'");
  expect(productionJob).toContain('authenticated-smoke-status.json');
  expect(productionJob).toContain('rm -rf test-results playwright-report blob-report');
  expect(productionJob).not.toContain('web/test-results/');
  expect(productionJob).not.toContain('web/playwright-report/');
});

test('CI builds once per browser job and reuses one preview', () => {
  const workflow = readFileSync(resolve(process.cwd(), '..', '.github', 'workflows', 'frontend-quality.yml'), 'utf8');
  const job = (name: string, next?: string) => {
    const start = workflow.split(`  ${name}:`)[1];
    return next ? start.split(`  ${next}:`)[0] : start;
  };
  const count = (source: string, value: string) => source.split(value).length - 1;
  const contract = job('contract', 'chromium-quality');
  const chromium = job('chromium-quality', 'cross-browser');
  const crossBrowser = job('cross-browser', 'visual');
  const visual = job('visual', 'authenticated-production-smoke');
  const authenticated = job('authenticated-production-smoke');

  expect(count(contract, 'npm run e2e:build')).toBe(0);
  expect(count(chromium, 'npm run e2e:build')).toBe(1);
  expect(count(crossBrowser, 'npm run e2e:build')).toBe(1);
  expect(count(visual, 'npm run e2e:build')).toBe(1);
  expect(count(authenticated, 'npm run e2e:build')).toBe(0);
  expect(chromium).toContain('npm run e2e:quality:run');
  expect(chromium).toContain('npm run e2e:performance:run');
  expect(chromium).toContain('npm run e2e:a11y:run');
  expect(crossBrowser).toContain('E2E_SKIP_WEBSERVER=1');
  expect(visual).toContain("npm run e2e:visual:run");
  expect(workflow).not.toContain('npm run e2e:quality\n');
  expect(workflow).not.toContain('npm run e2e:visual\n');
});

test('local suite wrapper separates build time from preview readiness', () => {
  const config = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
  expect(config).not.toMatch(/webServer:[\s\S]*command:.*e2e:build/);
  expect(config).toContain("command: 'npm run preview");
  expect(config).toContain('timeout: 120_000');
  const wrapper = readFileSync(resolve(process.cwd(), 'scripts', 'run-e2e-suite.mjs'), 'utf8');
  expect(wrapper).toContain("runNpm(['run', 'e2e:build'])");
  expect(wrapper).toContain("E2E_SKIP_WEBSERVER: '1'");
  expect(wrapper).toContain("preview.kill('SIGTERM')");
  expect(wrapper).toContain('ECONNREFUSED|proxy error|http proxy error');
});

test('docs screenshots and visual baseline updates are separate commands', () => {
  const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), '..', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  expect(rootPackage.scripts.screenshots).toBe('node scripts/screenshots.js');
  expect(rootPackage.scripts['e2e:update-baselines']).toContain('e2e:update-visual');
  const wrapper = readFileSync(resolve(process.cwd(), '..', 'scripts', 'screenshots.js'), 'utf8');
  expect(wrapper).toContain('screenshots:docs');
  expect(wrapper).not.toContain('e2e:update-visual');
});

test('docs screenshot destinations and deployment URLs are portable', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'scripts', 'capture-docs-screenshots.mjs'),
    'utf8',
  );

  expect(source).toContain('process.env.E2E_BASE_URL');
  expect(source).toContain('process.env.DOCS_SCREENSHOT_DIR');
  expect(source).toContain('process.env.E2E_STORAGE_STATE');
  expect(source).toContain("resolve(scriptDirectory, '..', '..')");
  expect(source).toContain('resolve(outputDirectory, `${route.name}.png`)');
  expect(source).not.toMatch(/['"][A-Za-z]:[\\/]/);
  expect(source).not.toMatch(/['"]\/(?:home|Users)\//);
});
