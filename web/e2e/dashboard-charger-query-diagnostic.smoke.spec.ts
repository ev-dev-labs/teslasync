import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { prepareCatalogueState } from './dashboardCatalogueStateHarness';
import { assertMockApiComplete, waitForHarnessReady } from './mockApi';
import { attachDiagnostics, monitorPage } from './qualityAssertions';
import { positionCataloguePanel } from './dashboardCatalogueCapture';

test('isolated heading-descendant read-only chart/detail QueryObserver chain and exact keys', async ({ page }) => {
  test.setTimeout(90_000);
  const mocks = await prepareCatalogueState(page, [
    'charge-status', 'charge-status-live', 'charge-history', 'charge-session-chart',
    'charge-cost-tracker', 'charging-session-detail',
  ], 390, 'light');
  const runtime = monitorPage(page);
  const wire: Array<{ url: string; body: unknown }> = [];
  const errors: string[] = [];
  const pending = new Set<Promise<void>>();
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (!['/api/v1/charging', '/api/v1/charging-sessions', '/api/v1/charging/701'].includes(path)) return;
    const task = (async () => {
      if (!response.ok()) throw new Error(`Diagnostic source HTTP ${response.status()}: ${response.url()}`);
      wire.push({ url: response.url(), body: await response.json() });
    })().catch((error: unknown) => { errors.push(error instanceof Error ? error.message : String(error)); });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  });
  try {
    await page.goto('/');
    await waitForHarnessReady(page, mocks);
    const evidence = [];
    for (const id of ['charge-session-chart', 'charging-session-detail']) {
      const panel = page.locator(`[data-widget-id="state-${id}"] > .widget-panel`);
      await positionCataloguePanel(panel);
      const semanticHeadings = panel.getByRole('heading', {
        name: id === 'charge-session-chart' ? 'Charge sessions' : 'Charge session detail', exact: true,
      });
      if (id === 'charge-session-chart') {
        await expect(semanticHeadings).toHaveCount(2);
        await expect(semanticHeadings.and(panel.locator('h3.sr-only'))).toHaveCount(1);
      }
      const heading = semanticHeadings.and(panel.locator('h3:not(.sr-only)'));
      await expect(heading).toHaveCount(1);
      await expect(heading).toBeVisible();
      evidence.push({ widgetId: id, component: await heading.evaluate((element, expectedWidgetId) => {
        const object = (value: unknown): value is Record<string, unknown> =>
          value !== null && typeof value === 'object' && !Array.isArray(value);
        const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
        if (!key) throw new Error('No native source-component fiber');
        const boundary = element.closest('[data-widget-id]');
        if (!boundary || boundary.getAttribute('data-widget-id') !== expectedWidgetId) {
          throw new Error('Diagnostic heading belongs to a different widget boundary');
        }
        let fiber: unknown = Reflect.get(element, key);
        const candidates = [];
        let boundaryReached = false;
        for (let depth = 0; object(fiber) && depth < 80; depth++, fiber = fiber.return) {
          if (fiber.stateNode === boundary) {
            boundaryReached = true;
            break;
          }
          const props = fiber.memoizedProps;
          {
            const hooks = [];
            let hook: unknown = fiber.memoizedState;
            const seen = new Set<unknown>();
            for (let index = 0; object(hook); index++, hook = hook.next) {
              if (seen.has(hook)) throw new Error('Source component hook chain contains a cycle');
              seen.add(hook);
              const state = hook.memoizedState;
              if (!object(state)) {
                hooks.push({ index, shape: Array.isArray(state) ? 'array' : typeof state,
                  length: Array.isArray(state) ? state.length : null });
                continue;
              }
              const getQuery = state.getCurrentQuery;
              const getResult = state.getCurrentResult;
              const publicObserver = typeof getQuery === 'function' && typeof getResult === 'function';
              const currentQuery: unknown = publicObserver ? getQuery.call(state) : null;
              const currentResult: unknown = publicObserver ? getResult.call(state) : null;
              hooks.push({
                index, ownKeys: Object.keys(state).slice(0, 24), publicObserver,
                queryKey: object(currentQuery) ? currentQuery.queryKey : null,
                queryHash: object(currentQuery) ? currentQuery.queryHash : null,
                status: object(currentResult) ? currentResult.status : null,
                data: object(currentResult) ? currentResult.data : null,
              });
            }
            candidates.push({
              depth, fiberTag: fiber.tag,
              propKeys: object(props) ? Object.keys(props) : [],
              vehicleIdPresent: object(props) && Object.prototype.hasOwnProperty.call(props, 'vehicleId'),
              vehicleIdType: object(props) ? typeof props.vehicleId : 'no-props',
              vehicleId: object(props) ? props.vehicleId ?? null : null,
              size: object(props) ? props.size ?? null : null, hooks, hookChainComplete: true,
            });
          }
        }
        if (!boundaryReached) throw new Error('Diagnostic did not reach the same widget boundary');
        const barPayloads = [...boundary.querySelectorAll('.recharts-bar-rectangle .recharts-rectangle')].map(node => {
          const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
          let current: unknown = key ? Reflect.get(node, key) : null;
          for (let depth = 0; object(current) && depth < 30; depth++, current = current.return) {
            const props = current.memoizedProps;
            if (object(props) && object(props.payload)) {
              return { depth, dataKey: props.dataKey, payload: props.payload, value: props.value };
            }
          }
          return null;
        });
        return { startingTag: element.tagName, heading: element.textContent,
          closestWidgetId: boundary.getAttribute('data-widget-id'), boundaryReached, candidates, barPayloads };
      }, `state-${id}`) });
    }
    await Promise.all([...pending]);
    const path = test.info().outputPath('source-component-query-observer-diagnostic.json');
    await writeFile(path, JSON.stringify({
      mode: 'DIAGNOSTIC_ONLY_ZERO_ACCEPTANCE_CREDIT', baseURL: process.env.E2E_BASE_URL,
      exactSourceKeys: {
        chart: ['charging', 7, 'session-chart-10'],
        detailList: ['charging-sessions', 'vehicle', '7'],
        detail: ['charging-session', 701],
      },
      evidence, wire, errors, noCacheSearch: true, noPublicObserverMutation: true,
    }, null, 2));
    await test.info().attach('source-component-query-observer-diagnostic.json', { path, contentType: 'application/json' });
    expect(errors).toEqual([]);
    await assertMockApiComplete(page, mocks);
  } finally {
    await attachDiagnostics(test.info(), runtime);
  }
});
