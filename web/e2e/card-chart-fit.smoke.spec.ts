import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { installCardLayoutFixtures } from './cardLayoutFixtures';
import { auditCardGeometry, measureCardGeometry } from './cardLayoutGeometry';
import { seedBrowserState, waitForHarnessReady } from './mockApi';

for (const width of [390, 1280]) {
  for (const theme of ['dark', 'light'] as const) {
    test(`recorded drive chart bounds at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await seedBrowserState(page, theme, '/drives/412');
      const { mockApi, networkEscapes } = await installCardLayoutFixtures(page, theme);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.goto('/drives/412', { waitUntil: 'domcontentloaded' });
      await waitForHarnessReady(page, mockApi);
      await page.locator('#power-trace').scrollIntoViewIfNeeded();
      await waitForHarnessReady(page, mockApi);
      const elevationHeading = page.getByRole('heading', { name: 'Elevation profile', exact: true });
      await elevationHeading.scrollIntoViewIfNeeded();
      await waitForHarnessReady(page, mockApi);
      const legendGaps = await elevationHeading.evaluate(heading => {
        const card = heading.closest('[data-card]');
        if (!card) throw new Error('Elevation card is missing');
        return Array.from(card.querySelectorAll('.recharts-legend-item')).map(item => {
          const marker = item.querySelector('svg');
          const label = item.querySelector('.recharts-legend-item-text');
          if (!marker || !label) return { label: item.textContent, gap: null };
          const text = document.createTreeWalker(label, NodeFilter.SHOW_TEXT, {
            acceptNode: node => node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
          }).nextNode();
          if (!text) return { label: label.textContent, gap: null };
          const range = document.createRange();
          range.selectNodeContents(text);
          return {
            label: label.textContent,
            gap: range.getBoundingClientRect().left - marker.getBoundingClientRect().right,
          };
        });
      });
      const geometry = await measureCardGeometry(page);
      const violations = auditCardGeometry(geometry).filter(hit => hit.kind === 'chart-fit');
      const styles = await page.evaluate(() => Array.from(document.querySelectorAll('[data-chart-viewport]')).map(viewport => {
        const chain = [];
        for (let element: Element | null = viewport; element && !element.matches('main'); element = element.parentElement) {
          const css = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          chain.push({
            tag: element.tagName, id: element.id, classes: element.getAttribute('class'),
            layout: element.getAttribute('data-card-layout'), slot: element.getAttribute('data-card-slot'),
            box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            display: css.display, rows: css.gridTemplateRows, height: css.height,
            minHeight: css.minHeight, maxHeight: css.maxHeight, flex: css.flex,
            contain: css.contain, overflowY: css.overflowY,
            containerType: css.containerType,
          });
        }

        return chain;
      }));
      const artifacts = process.env.CHART_FIT_ARTIFACT_DIR ?? testInfo.outputDir;
      await mkdir(artifacts, { recursive: true });
      await writeFile(`${artifacts}/chart-fit-${width}-${theme}.json`,
        JSON.stringify({ width, theme, geometry, violations, legendGaps, styles, errors, networkEscapes, unmatchedMocks: [...mockApi.unmatched] }, null, 2));
      expect(errors).toEqual([]);
      expect(networkEscapes).toEqual([]);
      expect([...mockApi.unmatched]).toEqual([]);
      expect(geometry.flatMap(card => card.charts ?? []).filter(chart => chart.surfaces.length).length).toBeGreaterThan(2);
      expect(styles.flat().filter(node => node.layout === 'surface')
        .every(node => node.containerType === 'normal' && node.rows.startsWith('subgrid'))).toBe(true);
      expect(violations).toEqual([]);
      expect(legendGaps.length).toBeGreaterThanOrEqual(2);
      expect(legendGaps.filter(item => item.gap === null || item.gap < -4 || item.gap > 20)).toEqual([]);
    });
  }
}

test('a fluid embedded chart shares its host allocation with the existing heading', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBrowserState(page, 'dark', '/security-access');
  const { mockApi, networkEscapes } = await installCardLayoutFixtures(page, 'dark');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('/security-access', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);
  const geometry = await measureCardGeometry(page);
  const violations = auditCardGeometry(geometry).filter(hit => hit.kind === 'chart-fit');
  const artifacts = process.env.CHART_FIT_ARTIFACT_DIR ?? testInfo.outputDir;
  await mkdir(artifacts, { recursive: true });
  await writeFile(`${artifacts}/chart-fit-security-access-dark.json`,
    JSON.stringify({ geometry, violations, errors, networkEscapes, unmatchedMocks: [...mockApi.unmatched] }, null, 2));
  expect(geometry.flatMap(card => card.charts ?? [])).not.toHaveLength(0);
  expect(errors).toEqual([]);
  expect(networkEscapes).toEqual([]);
  expect([...mockApi.unmatched]).toEqual([]);
  expect(violations).toEqual([]);
});

test('shared chart bounds and header actions survive fullscreen and restoration', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await seedBrowserState(page, 'dark', '/analytics');
  const { mockApi, networkEscapes } = await installCardLayoutFixtures(page, 'dark');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
  await waitForHarnessReady(page, mockApi);
  const figure = page.getByRole('figure', { name: 'Distance by vehicle', exact: true });
  await figure.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
  await expect(page.locator('figure:fullscreen')).toBeVisible();
  await waitForHarnessReady(page, mockApi);
  const fullscreen = await measureCardGeometry(page);
  await expect(figure.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
  await figure.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(page.locator(':fullscreen')).toHaveCount(0);
  await waitForHarnessReady(page, mockApi);
  const restored = await measureCardGeometry(page);
  await expect(figure.getByRole('button', { name: 'Enter fullscreen', exact: true })).toBeVisible();
  const violations = [...auditCardGeometry(fullscreen), ...auditCardGeometry(restored)].filter(hit => hit.kind === 'chart-fit');
  const artifacts = process.env.CHART_FIT_ARTIFACT_DIR ?? testInfo.outputDir;
  await mkdir(artifacts, { recursive: true });
  await writeFile(`${artifacts}/chart-fit-fullscreen.json`,
    JSON.stringify({ fullscreen, restored, violations, errors, networkEscapes, unmatchedMocks: [...mockApi.unmatched] }, null, 2));
  expect(errors).toEqual([]);
  expect(networkEscapes).toEqual([]);
  expect([...mockApi.unmatched]).toEqual([]);
  expect(violations).toEqual([]);
});
