import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import {
  forwardLocalApiFixture, fulfillApiFixture, installApiMocks, seedBrowserState, waitForHarnessReady,
} from './mockApi';

export const sharedPlanningStart = '2030-01-21T12:00:00Z';
export const sharedPlanningLayouts = [
  { width: 1440, height: 900, theme: 'light', pack: 'v6' },
  { width: 390, height: 844, theme: 'dark', pack: 'blueprint' },
] as const;

const settings = '/settings/smart-charging';
const endpoint = '/api/v1/smart-charging';

export async function openSharedPlanning(
  page: Page, subject: string, layout: typeof sharedPlanningLayouts[number], kind: 'chargers' | 'trips',
) {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await page.clock.setFixedTime(new Date(sharedPlanningStart));
  await seedBrowserState(page, layout.theme, settings);
  const api = await installApiMocks(page, 'populated', layout.theme);
  if (!api) throw new Error('Missing isolated API fixtures');
  await page.route('**/api/v1/system/auth-mode', route => fulfillApiFixture(route, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject, capabilities: {} },
  }));
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillApiFixture(route, api, {
      json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: layout.pack, app_wide: true },
    });
  });
  await page.route(url => url.pathname === '/api/v1/vehicles', route => fulfillApiFixture(route, api, {
    json: [
      { id: 7, display_name: 'Synthetic plugged EV' },
      { id: 8, display_name: 'Synthetic arriving EV' },
      ...(kind === 'trips' ? [{ id: 9, display_name: 'Synthetic uncleared EV' }] : []),
    ],
  }));
  await page.route(url => url.pathname === '/api/v1/geofences', route => fulfillApiFixture(route, api, {
    json: [{ id: 9, name: 'Synthetic charging place', updated_at: sharedPlanningStart, enabled: true, is_charging_location: true }],
  }));
  await page.route(url => url.pathname === '/api/v1/smart-delivery/devices', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillApiFixture(route, api, { json: { data: { available: false, public_key: '', devices: [] } } });
  });
  await page.route(url => url.pathname === `${endpoint}/shared-${kind === 'chargers' ? 'trips' : 'chargers'}`, route => fulfillApiFixture(route, api, {
    json: { data: { can_manage: false, owned: [], invitations: [] } },
  }));
  const real = `${endpoint}/shared-${kind}`;
  await page.route(url => url.pathname === real || url.pathname.startsWith(`${real}/`), async route => {
    const headers = await route.request().allHeaders();
    expect(headers['x-teslasync-expected-principal']).toBe(`subject:${subject}`);
    await forwardLocalApiFixture(route, api, { ...headers, 'x-test-subject': subject });
  });
  await page.goto(settings);
  await waitForHarnessReady(page, api);
  return api;
}
