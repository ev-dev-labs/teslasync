import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {ChargingBreakdownSlide} from '../src/web-parity/features/analytics/components/review/ChargingBreakdownSlide';
import type {YearReview} from '../src/web-parity/api/types';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {});
}

function unmount(tree: Renderer): void {
  ReactTestRenderer.act(() => {
    tree.unmount();
  });
}

// Flattens every rendered host node into one string so we can assert on the
// visible copy regardless of how the children are split across Text fragments.
function flatten(node: unknown): string {
  if (node == null || node === false) {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flatten).join('');
  }
  const children = (node as {children?: unknown}).children;
  return children ? flatten(children) : '';
}

function makeYearReview(overrides: Partial<YearReview> = {}): YearReview {
  return {
    year: 2025,
    vehicle: {id: 1, display_name: 'My Tesla', model: 'Model 3'},
    total_drives: 320,
    total_distance_km: 12000,
    total_energy_kwh: 2400,
    total_charge_sessions: 42,
    total_driving_minutes: 18000,
    total_charging_cost: 540,
    gas_savings: 1800,
    co2_offset_kg: 950,
    longest_drive: null,
    shortest_drive: null,
    most_efficient_drive: null,
    least_efficient_drive: null,
    fastest_speed_kmh: 165,
    coldest_drive_temp_c: -8,
    hottest_drive_temp_c: 39,
    monthly_stats: [],
    most_active_day_of_week: 'Friday',
    most_active_hour: 17,
    avg_drives_per_week: 6,
    avg_distance_per_drive_km: 37.5,
    avg_efficiency_wh_km: 158,
    supercharger_pct: 55,
    dc_fast_pct: 30,
    ac_other_pct: 0,
    avg_charge_start_soc: 60,
    comparisons: [],
    ...overrides,
  };
}

describe('ChargingBreakdownSlide', () => {
  it('renders the session count, average plug-in copy, and emoji', async () => {
    const tree = render(
      <ChargingBreakdownSlide data={makeYearReview()} />,
    );
    await flush();

    const text = flatten(tree.toJSON());
    expect(text).toContain('🔌');
    expect(text).toContain('42 charge sessions');
    expect(text).toContain('Average plug-in at 60% battery');

    unmount(tree);
  });

  it('lists each non-zero charging source with its rounded percentage', async () => {
    const tree = render(
      <ChargingBreakdownSlide
        data={makeYearReview({
          supercharger_pct: 55,
          dc_fast_pct: 30,
          ac_other_pct: 0,
        })}
      />,
    );
    await flush();

    const text = flatten(tree.toJSON());
    expect(text).toContain('Supercharger (55%)');
    expect(text).toContain('DC Fast (30%)');
    // ac_other_pct is 0, so the AC / Other source is filtered out entirely.
    expect(text).not.toContain('AC / Other');

    unmount(tree);
  });

  it('rounds the average start SOC to a whole percentage', async () => {
    const tree = render(
      <ChargingBreakdownSlide
        data={makeYearReview({avg_charge_start_soc: 47.6})}
      />,
    );
    await flush();

    expect(flatten(tree.toJSON())).toContain('Average plug-in at 48% battery');

    unmount(tree);
  });
});
