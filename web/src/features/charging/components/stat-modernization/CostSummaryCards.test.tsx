import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { DEFAULT_GAS_PRICE } from '../cost-analysis/constants';
import { coreStats } from './fixtures.test-utils';
import { CostSummaryCards } from './CostSummaryCards';

const state = vi.hoisted(() => ({ gasUnit: 'gallon' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string; unit?: string }) =>
      typeof fallback === 'string' ? fallback
        : (fallback?.defaultValue ?? key).replace('{{unit}}', fallback?.unit ?? ''),
  }),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { gas_unit: state.gasUnit } }),
}));
vi.mock('./useStatFormatting', () => ({
  useStatFormatting: () => ({
    preferences: {},
    text: (id: string, raw: number | null | undefined) =>
      raw == null ? 'missing' : `${id === 'currency' ? '$' : ''}${raw}`,
  }),
}));
vi.mock('../operationalbrief-all/ChargingSummaryBrief', () => ({
  ChargingSummaryBrief: ({ metrics }: { metrics: readonly StatMetric[] }) => (
    <dl>
      {metrics.map(metric => (
        <div key={metric.label}>
          <dt>{metric.label}</dt>
          <dd>{String(metric.rawValue)} {metric.context}</dd>
        </div>
      ))}
    </dl>
  ),
}));
vi.mock('@/components/feedback', () => ({
  QueryError: () => null,
  EmptyState: () => null,
}));

afterEach(() => {
  cleanup();
  state.gasUnit = 'gallon';
});

const period = { kind: 'unknown', label: 'Selected range', reason: 'Selected rows only' } as const;
const props = { coreStats, gasPrice: DEFAULT_GAS_PRICE, distanceUnit: 'mi', isMiles: true, period };

describe('CostSummaryCards gasoline model basis', () => {
  it.each(['gallon', 'liter'])('keeps the default raw assumption per US gallon with %s preferences', gasUnit => {
    state.gasUnit = gasUnit;
    const before = { ...coreStats };
    render(<CostSummaryCards {...props} />);

    expect(screen.getByText(`${coreStats.savings} vs $${DEFAULT_GAS_PRICE}/gal`)).toBeInTheDocument();
    expect(screen.getByText(`${coreStats.totalEnergy * 1000} ${coreStats.gallonsEquiv} gal equiv`)).toBeInTheDocument();
    expect(screen.getAllByRole('term')).toHaveLength(6);
    expect(screen.getByText(`${coreStats.totalCost} ${coreStats.count} sessions`)).toBeInTheDocument();
    expect(screen.getByText(`${coreStats.avgCostPerKwh} blended rate`)).toBeInTheDocument();
    expect(screen.getByText(`${coreStats.costPerDist} per mi`)).toBeInTheDocument();
    expect(screen.getByText(`${coreStats.savingsPercent} vs gasoline`)).toBeInTheDocument();
    expect(coreStats).toEqual(before);
    expect(DEFAULT_GAS_PRICE).toBe(3.5);
  });

  it('does not convert or reset an edited assumption when volume preferences change', () => {
    const { rerender } = render(<CostSummaryCards {...props} gasPrice={7.125} />);
    expect(screen.getByText(`${coreStats.savings} vs $7.125/gal`)).toBeInTheDocument();

    state.gasUnit = 'liter';
    rerender(<CostSummaryCards {...props} gasPrice={7.125} isMiles={false} distanceUnit="km" />);

    expect(screen.getByText(`${coreStats.savings} vs $7.125/gal`)).toBeInTheDocument();
    expect(screen.getByText('Cost Per km')).toBeInTheDocument();
    expect(screen.getByText(`${coreStats.costPerDist} per km`)).toBeInTheDocument();
    expect(screen.queryByText(/\/L/)).not.toBeInTheDocument();
  });
});
