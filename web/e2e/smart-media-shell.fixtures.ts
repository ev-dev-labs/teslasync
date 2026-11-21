import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { DEFAULT_PINNED_NAV_PATHS } from '../src/lib/navPins';
import { fulfillApiFixture, installApiMocks, seedBrowserState } from './mockApi';

export async function installSyntheticMediaShell(page: Page, subject: string, route: string, now: string,
  variant: { width: number; height: number; theme: 'light' | 'dark'; pack: string }) {
  await page.setViewportSize({ width: variant.width, height: variant.height });
  await page.clock.setFixedTime(new Date(now));
  await seedBrowserState(page, variant.theme, route);
  const api = await installApiMocks(page, 'populated', variant.theme);
  if (!api) throw new Error('Missing isolated API fixtures');
  api.navPins = [...DEFAULT_PINNED_NAV_PATHS, '@navigation-initialized'].map((path, index) => ({
    id: index + 1, item_type: 'navigation', item_id: path, position: index, pinned_at: now,
  }));
  await page.route('**/api/v1/system/auth-mode', intercepted => fulfillApiFixture(intercepted, api, {
    json: { mode: 'forward_auth', subject_header: 'X-Test-Subject', subject },
  }));
  await page.route(url => url.pathname === '/api/v1/settings/widget-design-pack' && !url.search, intercepted => {
    if (intercepted.request().method() !== 'GET') return intercepted.fallback();
    return fulfillApiFixture(intercepted, api, {
      json: { scope: createHash('sha256').update(`forward_auth:${subject}`).digest('hex'), pack_id: variant.pack, app_wide: true },
    });
  });
  await page.route(url => ['/api/v1/media', '/api/v1/media/latest'].includes(url.pathname), intercepted => {
    if (intercepted.request().method() !== 'GET') return intercepted.fallback();
    const { pathname, searchParams } = new URL(intercepted.request().url());
    expect(searchParams.get('vehicle_id')).toBe('7');
    return fulfillApiFixture(intercepted, api, { json: pathname.endsWith('/latest') ? null : [] });
  });
  return api;
}
