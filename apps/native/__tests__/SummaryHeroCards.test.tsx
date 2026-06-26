import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// useSettings is a TanStack Query hook (needs a QueryClient at runtime); mock it
// so formatCurrency resolves deterministically with no provider/network.
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => ({data: {currency_symbol: '$', decimal_precision: 2}}),
}));

import {
  SummaryHeroCards,
  type DigestMetrics,
  type FunFact,
} from '../src/web-parity/features/analytics/components/weekly-digest/SummaryHeroCards';

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
    totalDistance: 1234.5,
    prevDistance: 1000,
    totalDrives: 8,
    prevDriveCount: 5,
    energyUsed: 45.6,
    prevEnergy: 40,
    chargingCost: 12.5,
    prevChargingCost: 10,
    co2Saved: 3.2,
    prevCo2: 3,
    avgEfficiency: 0,
    prevAvgEfficiency: 0,
    totalDuration: 0,
    topDrive: undefined,
    chargeEnergyAdded: 0,
    prevChargeEnergy: 0,
    avgChargeRate: 0,
    chargingSessionCount: 0,
    batteryStart: 0,
    batteryEnd: 0,
    alertsByType: {},
    alertTotal: 0,
    ...overrides,
  };
}

const FUN_FACT: FunFact = {from: 'Paris', to: 'Lyon', times: '5'};

describe('SummaryHeroCards', () => {
  it('renders the heading and all five base highlight cards', async () => {
    const tree = render(
      <SummaryHeroCards metrics={makeMetrics()} funFact={undefined} />,
    );
    await flush();

    const text = flatten(tree.toJSON());

    // Panel heading.
    expect(text).toContain('Week Summary');

    // Total Distance card (km unit, locale-separated value).
    expect(text).toContain('Total Distance');
    expect(text).toContain('1,234.5 km');

    // Total Drives card (integer value).
    expect(text).toContain('Total Drives');
    expect(text).toContain('8');

    // Energy Used card (kWh unit).
    expect(text).toContain('Energy Used');
    expect(text).toContain('45.6 kWh');

    // Charging Cost card (currency from settings).
    expect(text).toContain('Charging Cost');
    expect(text).toContain('$12.50');

    // CO₂ Saved card (kg unit).
    expect(text).toContain('CO₂ Saved');
    expect(text).toContain('3.2 kg');

    // No Fun Fact tile when funFact is undefined.
    expect(text).not.toContain('Fun Fact');

    unmount(tree);
  });

  it('renders the optional Fun Fact tile with an interpolated subtitle', async () => {
    const tree = render(
      <SummaryHeroCards metrics={makeMetrics()} funFact={FUN_FACT} />,
    );
    await flush();

    const text = flatten(tree.toJSON());

    expect(text).toContain('Fun Fact');
    expect(text).toContain('5×');
    // {{times}}/{{from}}/{{to}} interpolation in the English fallback.
    expect(text).toContain('≈ 5× Paris → Lyon');

    unmount(tree);
  });

  it('shows an upward trend on distance growth and respects inverted cost trends', async () => {
    const tree = render(
      <SummaryHeroCards
        metrics={makeMetrics({
          totalDistance: 1200,
          prevDistance: 1000,
          chargingCost: 15,
          prevChargingCost: 10,
        })}
        funFact={undefined}
      />,
    );
    await flush();

    const text = flatten(tree.toJSON());

    // Distance up 20% -> "+20.0%" with the up glyph.
    expect(text).toContain('+20.0%');
    expect(text).toContain('▲');
    // Charging cost up 50% but invertPositive -> negative -> down glyph present.
    expect(text).toContain('▼');

    unmount(tree);
  });
});
