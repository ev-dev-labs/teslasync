import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// useSettings is a TanStack Query hook (needs a QueryClient at runtime); mock it
// so formatCurrency resolves deterministically with no provider/network.
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => ({data: {currency_symbol: '$', decimal_precision: 2}}),
}));

import {
  ChargingSection,
  type DigestMetrics,
  type DailyEnergyEntry,
} from '../src/web-parity/features/analytics/components/weekly-digest/ChargingSection';

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

function makeMetrics(overrides: Partial<DigestMetrics> = {}): DigestMetrics {
  return {
    totalDistance: 0,
    prevDistance: 0,
    totalDrives: 0,
    prevDriveCount: 0,
    energyUsed: 0,
    prevEnergy: 0,
    chargingCost: 42.5,
    prevChargingCost: 0,
    co2Saved: 0,
    prevCo2: 0,
    avgEfficiency: 0,
    prevAvgEfficiency: 0,
    totalDuration: 0,
    topDrive: undefined,
    chargeEnergyAdded: 123.4,
    prevChargeEnergy: 100,
    avgChargeRate: 11.2,
    chargingSessionCount: 8,
    batteryStart: 0,
    batteryEnd: 0,
    alertsByType: {},
    alertTotal: 0,
    ...overrides,
  };
}

const DAILY: DailyEnergyEntry[] = [
  {day: 'Mon', energy: 10},
  {day: 'Tue', energy: 5},
];

describe('ChargingSection', () => {
  it('renders the title, daily energy bars, stat tiles, and a positive badge', async () => {
    const tree = render(
      <ChargingSection metrics={makeMetrics()} dailyEnergyData={DAILY} />,
    );
    await flush();

    const text = flatten(tree.toJSON());

    // Section title + chart label.
    expect(text).toContain('Charging');
    expect(text).toContain('Daily Energy Added (kWh)');

    // Daily energy bars: per-day labels and 1-decimal values.
    expect(text).toContain('Mon');
    expect(text).toContain('Tue');
    expect(text).toContain('10.0');
    expect(text).toContain('5.0');

    // Four MiniStat tiles.
    expect(text).toContain('Sessions');
    expect(text).toContain('8');
    expect(text).toContain('Total Energy Added');
    expect(text).toContain('123.4 kWh');
    expect(text).toContain('Avg Charge Rate');
    expect(text).toContain('11.2 kW');
    expect(text).toContain('Total Cost');
    expect(text).toContain('$42.50');

    // Week-over-week badge: 123.4 >= 100 -> +23.4%.
    expect(text).toContain('Energy vs. Last Week');
    expect(text).toContain('23.4%');

    unmount(tree);
  });

  it('shows an em-dash badge when there is no previous-week energy', async () => {
    const tree = render(
      <ChargingSection
        metrics={makeMetrics({prevChargeEnergy: 0})}
        dailyEnergyData={DAILY}
      />,
    );
    await flush();

    const text = flatten(tree.toJSON());
    expect(text).toContain('Energy vs. Last Week');
    expect(text).toContain('—');

    unmount(tree);
  });

  it('renders an empty-state message when there is no daily energy data', async () => {
    const tree = render(
      <ChargingSection metrics={makeMetrics()} dailyEnergyData={[]} />,
    );
    await flush();

    const text = flatten(tree.toJSON());
    expect(text).toContain('Daily Energy Added (kWh)');
    expect(text).toContain('No charging data');

    unmount(tree);
  });
});
