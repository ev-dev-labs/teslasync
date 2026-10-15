import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RegenEfficiencyData } from '@/types/driving';
import { buildRegenEfficiencyModel } from '../../lib/regenEfficiency';
import type { DrivingSummaryBrief } from './DrivingSummaryBrief';
import { RegenOverviewBrief } from './RegenOverviewBrief';

const brief = vi.hoisted(() => vi.fn());
vi.mock('./DrivingSummaryBrief', () => ({
  DrivingSummaryBrief: (props: ComponentProps<typeof DrivingSummaryBrief>) => {
    brief(props);
    return <div data-testid="overview-brief" data-unavailable={props.unavailable}
      data-source-status={props.sourceStatus} />;
  },
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatEnergy: (value: number) => `${value} Wh` }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtPercent: (value: number) => `${value}%` }),
}));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  LinearGauge: ({ value }: { value: number }) => <div data-testid="recovery-gauge">{value}</div>,
}));

const aggregate: RegenEfficiencyData = {
  vehicleId: 7, totalRegenWh: 200, totalDriveWh: 1000, regenRatio: 20,
  freeCharges: 0.01, monthlyAvgRegen: 200, monthlySummary: [], drives: [],
  batteryCapacityWh: 75000, capacitySource: 'vin_estimate',
};
const model = {
  ...buildRegenEfficiencyModel([], 1000),
  totalMeasuredRegenWh: 200,
  totalMeasuredDriveEnergyWh: 1000,
  energyWeightedRatioPct: 20,
  ratioStatistics: { minPct: 20, maxPct: 20, medianPct: 20, q1Pct: 20, q3Pct: 20 },
  accounting: {
    ...buildRegenEfficiencyModel([], 1000).accounting,
    observedCount: 1, eligibleCount: 1, excludedCount: 0,
  },
};
const resolved = { isResolved: true, isLoading: false, error: null, onRetry: vi.fn() };
type Props = ComponentProps<typeof RegenOverviewBrief>;
function show(overrides: Partial<Props> = {}) {
  render(<RegenOverviewBrief aggregate={aggregate} model={model}
    aggregateState={resolved} detailState={resolved} scope="Selected window" retained={false}
    {...overrides} />, { wrapper: MemoryRouter });
  return brief.mock.lastCall![0] as ComponentProps<typeof DrivingSummaryBrief>;
}
function raw(props: ComponentProps<typeof DrivingSummaryBrief>, occurrenceId: string) {
  return props.metrics.find(metric => metric.occurrenceId === occurrenceId)?.rawValue;
}

describe('RegenOverviewBrief source readiness', () => {
  it('preserves populated aggregate, capacity and independent detailed evidence', () => {
    const props = show();
    expect(props.unavailable).toBe(false);
    expect(props.sourceStatus).toBeUndefined();
    expect(raw(props, 'regen-capacity-basis')).toBe(75000);
    expect(raw(props, 'regen-capacity-source')).toBe('VIN-based estimate');
    expect(raw(props, 'regen-sample-recovered')).toBe(200);
    expect(raw(props, 'regen-sample-denominator')).toBe(1000);
    expect(raw(props, 'regen-sample-weighted')).toBe(20);
    expect(screen.getByTestId('recovery-gauge')).toHaveTextContent('20');
  });

  it('marks a resolved missing aggregate partially available without hiding detail', () => {
    const props = show({ aggregate: undefined });
    expect(props.unavailable).toBe(true);
    expect(props.sourceStatus).toBe('Independent sources partly available');
    expect(raw(props, 'regen-capacity-basis')).toBeNull();
    expect(raw(props, 'regen-sample-recovered')).toBe(200);
    expect(screen.getByText('No aggregate recovery response is available for this window.')).toBeInTheDocument();
  });

  it('marks contradictory zero totals unavailable but preserves capacity and detail', () => {
    const props = show({ aggregate: { ...aggregate, totalRegenWh: 0, totalDriveWh: 0, regenRatio: 0 } });
    expect(props.unavailable).toBe(true);
    expect(props.sourceStatus).toBe('Independent sources partly available');
    expect(raw(props, 'regen-capacity-basis')).toBe(75000);
    expect(raw(props, 'regen-capacity-source')).toBe('VIN-based estimate');
    expect(raw(props, 'regen-sample-weighted')).toBe(20);
    expect(screen.getByText('Aggregate totals unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-gauge')).not.toBeInTheDocument();
  });

  it.each([
    { totalDriveWh: 0, regenRatio: 0 },
    { totalDriveWh: Number.NaN, regenRatio: 20 },
    { totalDriveWh: 1000, regenRatio: Number.NaN },
  ])('aligns unavailable denominator or ratio with the body: %j', fields => {
    const props = show({ aggregate: { ...aggregate, ...fields } });
    expect(props.unavailable).toBe(true);
    expect(props.sourceStatus).toBe('Independent sources partly available');
    expect(raw(props, 'regen-capacity-basis')).toBe(75000);
    expect(screen.queryByTestId('recovery-gauge')).not.toBeInTheDocument();
  });

  it.each([
    { ...resolved, isResolved: false },
    { ...resolved, isLoading: true },
    { ...resolved, error: new Error('detail unavailable') },
  ])('does not use unavailable detailed data to contradict the aggregate: %j', detailState => {
    const props = show({
      aggregate: { ...aggregate, totalRegenWh: 0, totalDriveWh: 0, regenRatio: 0 },
      detailState,
    });
    expect(props.unavailable).toBe(true);
    expect(raw(props, 'regen-sample-recovered')).toBeNull();
    expect(screen.queryByText('Aggregate totals unavailable')).not.toBeInTheDocument();
    expect(screen.getByText('The complete aggregate contains no drive-energy denominator for this window.')).toBeInTheDocument();
  });

  it('does not present unresolved aggregate values as ready', () => {
    const props = show({ aggregateState: { ...resolved, isResolved: false } });
    expect(props.unavailable).toBe(true);
    expect(raw(props, 'regen-capacity-basis')).toBeNull();
    expect(screen.queryByTestId('recovery-gauge')).not.toBeInTheDocument();
  });

  it('preserves a measured zero recovery share with a positive denominator', () => {
    const props = show({ aggregate: { ...aggregate, totalRegenWh: 0, regenRatio: 0 } });
    expect(props.unavailable).toBe(false);
    expect(screen.getByTestId('recovery-gauge')).toHaveTextContent('0');
  });
});
