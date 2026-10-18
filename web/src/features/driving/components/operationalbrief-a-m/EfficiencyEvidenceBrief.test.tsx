import type { ComponentProps } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { DrivingStats } from '@/types/driving';
import { buildEfficiencyModel } from '../efficiency-modernization/model';
import { fakeStats, fakeUnits } from '../efficiency-modernization/fixtures';
import { EfficiencyEvidenceBrief } from './EfficiencyEvidenceBrief';
import type { DrivingSummaryBrief } from './DrivingSummaryBrief';

const summary = vi.hoisted(() => vi.fn());
vi.mock('./DrivingSummaryBrief', () => ({
  DrivingSummaryBrief: (props: ComponentProps<typeof DrivingSummaryBrief>) => {
    summary(props);
    return null;
  },
}));
vi.mock('../efficiency-modernization/EfficiencySource', () => ({
  EfficiencySource: () => null,
}));
vi.mock('@/components/ui', () => ({
  Text: () => null,
  GlossaryTerm: () => null,
}));
vi.mock('@/components/feedback', () => ({
  ActionableEmptyState: () => null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: String, fmtInt: String }),
}));

afterEach(() => {
  cleanup();
  summary.mockClear();
});

const units = fakeUnits();
const model = buildEfficiencyModel([], units.unitPrefs);
function brief(query: DataStateSource<DrivingStats>, kind: 'kpis' | 'insights', malformed = false) {
  return <EfficiencyEvidenceBrief kind={kind} stats={query.data} units={units} model={model}
    source={{ state: deriveDataState(query), loading: Boolean(query.isLoading), malformed }} />;
}
function current(): ComponentProps<typeof DrivingSummaryBrief> {
  return summary.mock.calls.at(-1)![0];
}

describe.each(['kpis', 'insights'] as const)('EfficiencyEvidenceBrief %s source status', kind => {
  it('distinguishes active loading, prerequisites and paused initial loads without inventing errors or zeros', () => {
    const view = render(brief({ isLoading: true, fetchStatus: 'fetching' }, kind));
    expect(current()).toMatchObject({ statusLabel: 'Loading source', loading: true, error: null, retained: false });
    expect(current().metrics.every(metric => metric.rawValue == null)).toBe(true);

    view.rerender(brief({ fetchStatus: 'idle' }, kind));
    expect(current()).toMatchObject({ statusLabel: 'Awaiting evidence', loading: false, error: null, retained: false });

    view.rerender(brief({ fetchStatus: 'paused', isLoading: true }, kind));
    expect(current()).toMatchObject({ statusLabel: 'Source paused', loading: false, error: null, retained: false });
    expect(current().metrics.every(metric => metric.rawValue == null)).toBe(true);
  });

  it('treats a successful empty aggregate and measured zero as returned evidence', () => {
    const view = render(brief({ data: {} as DrivingStats, isSuccess: true }, kind));
    expect(current()).toMatchObject({ statusLabel: 'Returned evidence', loading: false, error: null, retained: false });
    expect(current().metrics.every(metric => metric.rawValue == null)).toBe(true);

    view.rerender(brief({ data: fakeStats({ totalDrives: 0, totalDistanceKm: 0,
      avgEfficiencyWhKm: 0, avgSpeedKmh: 0, topSpeedKmh: 0, co2SavedKg: 0,
      regenEnergyWh: 0, regenRatio: 0 }), isSuccess: true }, kind));
    expect(current().statusLabel).toBe('Returned evidence');
    const distance = current().metrics.find(metric => metric.occurrenceId === (kind === 'kpis' ? 'totalDistanceKm' : 'dist'));
    expect(distance?.rawValue).toBe(0);
    expect(current().metrics.find(metric => metric.occurrenceId === 'costPerKm' || metric.occurrenceId === 'cost')?.rawValue).toBeNull();
  });

  it('keeps measurements and retry on refresh failure and pause, then clears retained status on recovery', () => {
    const data = fakeStats();
    const refetch = vi.fn();
    const view = render(brief({ data, isSuccess: true, refetch }, kind));
    const metrics = current().metrics.map(metric => metric.rawValue);
    view.rerender(brief({ data, error: new Error('refresh failed'), refetch }, kind));
    expect(current()).toMatchObject({ statusLabel: 'Retained source', loading: false, error: null, retained: true });
    expect(current().metrics.map(metric => metric.rawValue)).toEqual(metrics);
    current().onRetry();
    expect(refetch).toHaveBeenCalledOnce();

    view.rerender(brief({ data, fetchStatus: 'paused', refetch }, kind));
    expect(current()).toMatchObject({ statusLabel: 'Refresh paused', error: null, retained: true });
    expect(current().metrics.map(metric => metric.rawValue)).toEqual(metrics);

    view.rerender(brief({ data, isSuccess: true, fetchStatus: 'idle', refetch }, kind));
    expect(current()).toMatchObject({ statusLabel: 'Returned evidence', error: null, retained: false });
    expect(current().metrics.map(metric => metric.rawValue)).toEqual(metrics);
  });

  it('preserves actual initial failure and malformed-source status', () => {
    const error = new Error('initial failure');
    const view = render(brief({ error }, kind));
    expect(current()).toMatchObject({ statusLabel: 'Source unavailable', error, retained: false });
    view.rerender(brief({ data: fakeStats(), isSuccess: true }, kind, true));
    expect(current().statusLabel).toBe('Source unavailable');
  });
});
