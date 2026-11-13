import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';

import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { StatPeriod } from '@/lib/metric-reference';
import type { WeeklyDigestMetrics } from '../weekly-digest/useWeeklyDigest';
import { ChargingPanel } from './ChargingPanel';
import { DrivingPanel } from './DrivingPanel';

function rules(name: string) {
  const result: Rule[] = [];
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', name), 'utf8'))
    .walkRules(rule => { result.push(rule); });
  return result;
}
const baseRules = rules('base.css');
const feedbackRules = rules('feedback.css');
function consumes(node: Element, sheet: readonly Rule[], contract: string, property: string) {
  return sheet.some(rule => rule.nodes.some(item => item.type === 'decl' && item.prop === property)
    && rule.selectors.some(selector => selector.includes(contract) && node.matches(selector)));
}
const period: StatPeriod = {
  kind: 'analysis', label: 'Sep 28 – Oct 4', start: '2026-09-28T00:00:00Z',
  endExclusive: '2026-10-05T00:00:00Z', timezone: 'UTC',
  completeness: 'unknown', provenance: 'Available history',
};
function metrics(overrides: Partial<WeeklyDigestMetrics> = {}): WeeklyDigestMetrics {
  return {
    totalDistanceM: 20_000, prevDistanceM: 10_000, totalDrives: 2, prevDriveCount: 1,
    energyUsedWh: 4000, prevEnergyWh: 5000, chargingCost: 12, prevChargingCost: 15,
    co2Saved: 3, prevCo2: 2, avgEfficiencyWhPerM: 0.2, prevAvgEfficiencyWhPerM: 0.25,
    totalDurationS: 3600, chargeEnergyAddedWh: 6000, prevChargeEnergyWh: 3000,
    avgChargePowerW: 7000, chargingSessionCount: 2, batteryStart: 20, batteryEnd: 80,
    alertsByType: {}, alertTotal: 0,
    topDrive: { id: 1, startTs: '2026-09-29T12:00:00Z', distanceM: 10_000, durationS: 1800, energyUsedWh: 1500 },
    ...overrides,
  };
}
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(children, {
    wrapper: ({ children: content }: { children: ReactNode }) =>
      <MemoryRouter><QueryClientProvider client={client}>{content}</QueryClientProvider></MemoryRouter>,
  });
}
function comparison() {
  return screen.getByText('Energy vs. last week').closest('[data-app-card-kind="record"]')!;
}

describe('analytics-late-01 weekly-digest footers (source-only, real shared renderers)', () => {
  it.each(PACK_IDS)('%s binds both independent footers without absorbing plots or changing measurements', pack => {
    const data = metrics();
    const original = JSON.stringify(data);
    const { container } = mount(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <DrivingPanel metrics={data} period={period} dailyDistanceData={[]} />
      <ChargingPanel metrics={data} period={period} dailyEnergyData={[]} />
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const topDrive = screen.getByText('Top drive').closest('[data-app-card-kind="record"]')!;
      const energy = comparison();
      for (const record of [topDrive, energy]) {
        expect(record).toHaveAttribute('data-surface-variant', 'standalone');
        expect(consumes(record, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
        expect(consumes(record, feedbackRules, `[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`, 'display')).toBe(true);
        const header = record.querySelector(':scope > [data-app-part~="record-header"]')!;
        expect(header).not.toBeEmptyDOMElement();
        expect(consumes(header, feedbackRules, `[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`, 'display')).toBe(true);
        expect(record.querySelector('[data-app-part~="chart-plot"]')).toBeNull();
      }
      const body = topDrive.querySelector(':scope > [data-app-part~="record-body"]')!;
      expect(consumes(body, feedbackRules, '[data-app-card-kind="record"]', 'max-inline-size')).toBe(true);
      const facts = body.querySelectorAll('[data-stat]');
      expect(facts).toHaveLength(4);
      expect([...facts].map(fact => fact.querySelector('[data-stat-label]')?.textContent))
        .toEqual(['Date', 'Distance', 'Duration', 'Efficiency']);
      expect(facts[1]).toHaveTextContent('10.00 km');
      expect(facts[2]).toHaveTextContent('0.50 h');
      expect(facts[3]).toHaveTextContent('150.00 Wh/km');
      expect(within(energy).getByText('100.00%')).toHaveAttribute('data-app-variant', 'success');
      expect(screen.getAllByRole('heading', { name: /Daily (distance|energy added)/ })).toHaveLength(2);
      expect(screen.getByText('No driving distance data is available for this week.')).toBeInTheDocument();
      expect(screen.getByText('No charging energy data is available for this week.')).toBeInTheDocument();
      expect(JSON.stringify(data)).toBe(original);
    } finally { release(); }
  });

  it('keeps the empty top-drive record and its real navigation while each chart fails independently', () => {
    const driveRetry = vi.fn();
    const chargingRetry = vi.fn();
    mount(<>
      <DrivingPanel metrics={metrics({ topDrive: undefined })} period={period} dailyDistanceData={[]}
        isError error={new Error('Driving history unavailable')} onRetry={driveRetry} />
      <ChargingPanel metrics={metrics()} period={period} dailyEnergyData={[]}
        isError error={new Error('Charging history unavailable')} onRetry={chargingRetry} />
    </>);
    const message = screen.getByText('No top drive is available for this week yet.');
    const emptyRecord = message.closest('[data-app-card-kind="record"]')!;
    expect(emptyRecord.querySelector(':scope > [data-app-part~="record-body"]')).toContainElement(message);
    expect(within(emptyRecord).getByRole('link', { name: 'View drives' })).toHaveAttribute('href', '/drives');
    expect(screen.getAllByRole('button', { name: /retry/i })).toHaveLength(2);
    const retries = screen.getAllByRole('button', { name: /retry/i });
    fireEvent.click(retries[0]);
    expect(driveRetry).toHaveBeenCalledOnce();
    expect(chargingRetry).not.toHaveBeenCalled();
    fireEvent.click(retries[1]);
    expect(chargingRetry).toHaveBeenCalledOnce();
    expect(comparison()).toHaveTextContent('100.00%');
  });

  it.each([
    [0, 3000, '-100.00%', 'warning'],
    [3000, 3000, '0.00%', 'success'],
    [0, 0, '—', 'success'],
    [null, 3000, '—', 'neutral'],
    [6000, null, '—', 'neutral'],
  ] as const)('preserves the source comparison for current=%s and previous=%s', (current, previous, reading, variant) => {
    mount(<ChargingPanel metrics={metrics({ chargeEnergyAddedWh: current, prevChargeEnergyWh: previous })}
      period={period} dailyEnergyData={[]} isLoading />);
    const record = comparison();
    expect(within(record).getByText(reading)).toHaveAttribute('data-app-variant', variant);
    expect(record.querySelector('[data-app-part~="record-header"]')).toHaveTextContent('Energy vs. last week');
    expect(screen.getAllByText('Total energy added').length).toBeGreaterThan(0);
  });

  it('keeps zero duration/distance and missing efficiency distinct without adding gauges', () => {
    mount(<DrivingPanel metrics={metrics({
      topDrive: { id: 1, startTs: '2026-09-29T12:00:00Z', distanceM: 0, durationS: 0, energyUsedWh: null },
    })} period={period} dailyDistanceData={[]} isLoading />);
    const record = screen.getByText('Top drive').closest('[data-app-card-kind="record"]')!;
    const facts = record.querySelectorAll('[data-stat]');
    expect(facts[1]).toHaveAttribute('data-state', 'value');
    expect(facts[1]).toHaveTextContent('0.00 km');
    expect(facts[2]).toHaveAttribute('data-state', 'value');
    expect(facts[2]).toHaveTextContent('0.00 h');
    expect(facts[3]).toHaveAttribute('data-state', 'missing');
    expect(facts[3]).toHaveTextContent('—');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('preserves the real chart fallback tables with the original converted samples and all footer facts', () => {
    const distance = [{ day: 'Mon', distanceM: 20_000 }, { day: 'Tue', distanceM: 0 }];
    const energy = [{ day: 'Mon', energyWh: 6000 }, { day: 'Tue', energyWh: 0 }];
    const original = JSON.stringify({ distance, energy });
    mount(<>
      <DrivingPanel metrics={metrics()} period={period} dailyDistanceData={distance} />
      <ChargingPanel metrics={metrics()} period={period} dailyEnergyData={energy} />
    </>);
    const distanceTable = screen.getByRole('table', { name: 'Daily distance — data table' });
    const energyTable = screen.getByRole('table', { name: 'Daily energy added — data table' });
    expect(within(distanceTable).getByRole('columnheader', { name: 'Daily distance (km)' })).toBeInTheDocument();
    expect(within(distanceTable).getAllByRole('row').map(row => row.textContent)).toEqual([
      'DayDaily distance (km)', 'Mon20', 'Tue0',
    ]);
    expect(within(energyTable).getAllByRole('row').map(row => row.textContent)).toEqual([
      'DayDaily energy added (kWh)', 'Mon6', 'Tue0',
    ]);
    expect(screen.getByText('Top drive')).toBeInTheDocument();
    expect(comparison()).toHaveTextContent('100.00%');
    expect(JSON.stringify({ distance, energy })).toBe(original);
  });
});
