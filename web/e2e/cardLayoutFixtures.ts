import type { Page } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import { fulfillApiFixture, installApiMocks } from './mockApi';
import { installDriveDetailMocks } from './driveDetailFixtures';
import { installDashboardWidgetSources } from './dashboardWidgetFixtures';
import { catalogueAnalyticsSources, installCatalogueRoutes } from './dashboardCatalogueRemainingSources';
import { cardLayoutContractPaths, resolveCardLayoutContractSource } from './cardLayoutContractSources';
import { actionsFixtureState, installActionsFixtures } from './operationalbrief-contracts/actions.fixtures';
import { expectedVerifyBody, resaleCertificate } from './operationalbrief-contracts/specialized-resale.supported.fixtures';

const syntheticPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');

/** Reuse reviewed domain fixtures; do not make a missing API look like a successful empty response. */
export async function installCardLayoutFixtures(page: Page, theme: 'dark' | 'light') {
  const networkEscapes: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['http:', 'https:'].includes(url.protocol)
      || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return route.fallback();
    networkEscapes.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  const mockApi = await installApiMocks(page, 'populated', theme);
  if (!mockApi) throw new Error('Card layout evidence requires E2E_MOCKS=1');
  await installDashboardWidgetSources(page, mockApi);
  await installCatalogueRoutes(page, mockApi, catalogueAnalyticsSources('2026-08-26T16:00:00.000Z'));
  await installDriveDetailMocks(page, theme, mockApi);
  await installActionsFixtures(page, mockApi, actionsFixtureState());
  await page.route(url => url.pathname === '/api/v1/public/battery-certificate/verify', route => {
    if (route.request().method() !== 'POST'
      || !isDeepStrictEqual(route.request().postDataJSON(), expectedVerifyBody(resaleCertificate))) {
      return route.fallback();
    }
    return fulfillApiFixture(route, mockApi, { json: { valid: true, certificate: resaleCertificate.certificate } });
  });
  for (const pathname of cardLayoutContractPaths) {
    await page.route(url => url.pathname === `/api/v1${pathname}`, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const json = resolveCardLayoutContractSource(new URL(route.request().url()));
      if (pathname === '/system/openapi' && typeof json === 'string') {
        return fulfillApiFixture(route, mockApi, { body: json, contentType: 'application/yaml' });
      }
      return json === undefined ? route.fallback() : fulfillApiFixture(route, mockApi, { json });
    });
  }
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({
    contentType: 'image/png',
    body: syntheticPixel,
  }));
  await page.route('https://static-assets.tesla.com/configurator/compositor**', route => route.fulfill({
    contentType: 'image/png',
    body: syntheticPixel,
  }));
  return { mockApi, networkEscapes };
}
