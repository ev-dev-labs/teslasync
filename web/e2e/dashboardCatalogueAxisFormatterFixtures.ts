import type { Page } from '@playwright/test';
import type { AppSettings } from '../src/api/types';
import type { CostBreakdown } from '../src/types/analytics';
import type { TeslaEnergyLiveStatus } from '../src/types/energy';
import { catalogueCostBreakdown, catalogueLiveStatus } from './dashboardWidgetFixtures';
import { fulfillApiFixture, mockAppSettings, type MockApiController } from './mockApi';

export type AxisFormatterScenario = 'signed-grouped-eight' | 'group-boundary-nice-domain';

export async function installAxisFormatterSources(
  page: Page, mocks: MockApiController, scenario: AxisFormatterScenario,
  locale: 'en-US' | 'de-DE', theme: 'light' | 'dark',
) {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 3_600_000).toISOString();
  const samples = scenario === 'signed-grouped-eight'
    ? [-1234.56789123, 1100.12345678]
    : [-0.00000001, 999.99999999];
  const settings: typeof mockAppSettings & Pick<AppSettings, 'decimal_precision' | 'locale' | 'mode'> = {
    ...mockAppSettings, decimal_precision: 8, locale, mode: theme,
  };
  const history = samples.map((value, index) => ({
    ...catalogueLiveStatus(now), id: index + 1,
    timestamp: index === 0 ? earlier : now,
    solar_power: Math.max(-value, 0) * 1000, battery_power: 0,
    grid_power: value * 1000, load_power: Math.max(value, 0) * 1000,
  })) satisfies TeslaEnergyLiveStatus[];
  const total = samples.reduce((sum, value) => sum + value, 0);
  const cost: CostBreakdown = {
    ...catalogueCostBreakdown(now, earlier),
    total_charging_cost: total, equivalent_gas_cost: 300,
    total_savings: 300 - total, monthly_savings: (300 - total) / samples.length,
    cost_per_km_ev: total / 1000, months_of_ownership: samples.length,
    monthly_breakdown: samples.map((value, index) => ({
      month: `2026-0${index + 8}`, ev_cost: value, equiv_gas_cost: 150,
      savings: 150 - value,
      cumulative_savings: samples.slice(0, index + 1).reduce((sum, amount) => sum + 150 - amount, 0),
      energy_wh: 260_000,
    })),
  };
  for (const [path, json] of [
    ['/settings', settings],
    ['/analytics/tco', cost],
    ['/tesla/energy-sites/42/live-status/history', history],
  ] as const) {
    await page.route(url => url.pathname === `/api/v1${path}`, route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillApiFixture(route, mocks, { json });
    });
  }
  return { scenario, locale, precision: 8, displaySamples: samples, cost, history };
}
