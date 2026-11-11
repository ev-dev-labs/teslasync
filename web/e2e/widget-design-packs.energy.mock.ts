import type { Page } from '@playwright/test';
import type { EnergyFlowSnapshot } from '../src/api/hooks/useEnergy';
import type { EnergyStats } from '../src/types/energy';
import { fulfillApiFixture, type MockApiController } from './mockApi';

// Copied from energy-flow-adoption-browser-qa.json. Only vehicle_id is rebound
// from its example vehicle 1 to the existing isolated review fleet's vehicle 7.
// No completeness/freshness/partial fields are added to either wire payload.
export const energyReviewPath = '/energy-flow?from=2025-03-01&to=2025-03-07';
export const energyReviewBounds = {
  start: '2025-03-01T00:00:00.000Z', end: '2025-03-08T00:00:00.000Z',
} as const;
export const energyReviewStats: EnergyStats = {
  vehicle_id: 7, period_days: 7,
  total_energy_used_wh: 30000, total_energy_charged_wh: 30000, total_wh: 30000,
  total_cost: 25, total_distance_m: 80000, avg_efficiency_wh_per_m: 0.375,
  co2_saved_kg: 12.3,
  daily_breakdown: [
    { date: '2025-03-05', energy_wh: 20000, cost: 15, distance_m: 50000, efficiency_wh_per_m: 0.4 },
    { date: '2025-03-06', energy_wh: 10000, cost: 10, distance_m: 30000, efficiency_wh_per_m: 1 / 3 },
  ],
};
export const energyReviewFlow: EnergyFlowSnapshot = {
  dc_charging_power_w: 11000, ac_charging_power_w: 0, energy_remaining: 62.5,
  pack_voltage: 400, pack_current: 27.5, soc: 82, charge_state: 'Charging',
};
export const unknownEnergyFlow: EnergyFlowSnapshot = {
  dc_charging_power_w: null, ac_charging_power_w: null, energy_remaining: null,
  pack_voltage: null, pack_current: null, soc: null, charge_state: null,
};

type Endpoint = 'history' | 'flow';
type ReadPlan =
  | { kind: 'success'; body: EnergyStats | EnergyFlowSnapshot }
  | { kind: 'error' }
  | { kind: 'held'; body: EnergyStats | EnergyFlowSnapshot; ready: Promise<void> };

export type EnergyReviewSources = Awaited<ReturnType<typeof installEnergyReviewSources>>;

/** Network fixtures only: real hooks/cache/trust classifiers own every state. */
export async function installEnergyReviewSources(page: Page, mocks: MockApiController) {
  let active = false;
  const plans: Record<Endpoint, ReadPlan> = {
    history: { kind: 'success', body: energyReviewStats },
    flow: { kind: 'success', body: energyReviewFlow },
  };
  const reads: Array<{ endpoint: Endpoint; kind: ReadPlan['kind'] }> = [];
  const releases = new Set<() => void>();
  const reset = (endpoint: Endpoint) => {
    plans[endpoint] = {
      kind: 'success', body: endpoint === 'history' ? energyReviewStats : energyReviewFlow,
    };
  };
  page.once('close', () => { for (const release of releases) release(); });
  for (const endpoint of ['history', 'flow'] as const) {
    const path = `/api/v1/vehicles/7/energy${endpoint === 'flow' ? '/flow' : ''}`;
    await page.route(url => url.pathname === path, async route => {
      if (!active) return route.fallback();
      const request = route.request();
      const url = new URL(request.url());
      const params = [...url.searchParams.entries()];
      const valid = request.method() === 'GET' && (endpoint === 'flow'
        ? params.length === 0
        : params.length === 2 && Object.entries(energyReviewBounds)
          .every(([key, value]) => url.searchParams.get(key) === value));
      if (!valid) {
        // Do not fall through to older broad catalogue fixtures: that would
        // silently accept a broken hook URL, write, or lost half-open bound.
        mocks.unmatched.add(`${request.method()} ${path}?<invalid-energy-review-query>`);
        return fulfillApiFixture(route, mocks, {
          status: 599, json: { error: 'Unexpected energy review request' },
        });
      }
      const plan = plans[endpoint];
      reads.push({ endpoint, kind: plan.kind });
      if (plan.kind === 'held') {
        mocks.pending += 1;
        mocks.lastActivityAt = Date.now();
        try { await plan.ready; } finally {
          mocks.pending -= 1;
          mocks.lastActivityAt = Date.now();
        }
      }
      return fulfillApiFixture(route, mocks, plan.kind === 'error'
        ? { status: 500, json: { error: endpoint === 'flow'
          ? 'failed to read energy flow state' : 'failed to get energy stats' } }
        : { json: plan.body });
    });
  }
  return {
    reads,
    setActive(value: boolean) { active = value; },
    setFlow(body: EnergyFlowSnapshot) { plans.flow = { kind: 'success', body }; },
    setHistory(body: EnergyStats) { plans.history = { kind: 'success', body }; },
    fail(endpoint: Endpoint) { plans[endpoint] = { kind: 'error' }; },
    reset,
    hold(endpoint: Endpoint) {
      let resolve: () => void = () => {};
      const ready = new Promise<void>(done => { resolve = done; });
      const release = () => { releases.delete(release); reset(endpoint); resolve(); };
      releases.add(release);
      plans[endpoint] = {
        kind: 'held', ready, body: endpoint === 'history' ? energyReviewStats : energyReviewFlow,
      };
      return release;
    },
  };
}
