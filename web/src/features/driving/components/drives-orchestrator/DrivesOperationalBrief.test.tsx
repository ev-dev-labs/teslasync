import { createInstance } from 'i18next';
import { MemoryRouter, type NavigateOptions, type To } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { computePeriodStats } from '@/lib/drivesAggregation';
import type { Drive } from '@/types/driving';
import { DrivesOperationalBrief } from './DrivesOperationalBrief';

const english = createInstance();
type Props = Parameters<typeof DrivesOperationalBrief>[0];
const completed: Drive = {
  id: 190, vehicleId: 7, startTs: '2026-10-13T10:00:00Z',
  endTs: '2026-10-13T10:20:00Z', durationS: 1200, distanceM: 10_000,
  startAddress: 'Origin', endAddress: 'Destination',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: 80, endBatteryPct: 75, energyUsedWh: 3000,
  regenEnergyWh: null, avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
  outsideTempAvgC: null, insideTempAvgC: null, score: null,
  endedStatus: 'completed', createdAt: '', updatedAt: '',
};
const ongoing: Drive = {
  ...completed, id: 191, startTs: '2026-10-13T11:00:00Z', endTs: null,
  durationS: 300, distanceM: 2000, energyUsedWh: null,
  endAddress: null, endBatteryPct: null, endedStatus: null, live: true,
};
const activity = [completed, ongoing];

beforeAll(async () => { await english.init({ lng: 'en', resources: {} }); });
afterEach(cleanup);

function mount(drives: Drive[] = activity, overrides: Partial<Props> = {}) {
  const currentStats = computePeriodStats(drives);
  const props: Props = {
    // Exercise the existing fallback with a real typed translator, not a catalog copy.
    t: english.getFixedT('en'), isDrivesLoading: false, hasDrivePayload: true,
    drivesState: deriveDataState({ data: drives, isSuccess: true }, { provenance: 'historical' }),
    refetchDrives: vi.fn<Props['refetchDrives']>(), currentStats,
    anomalyDrives: [completed],
    missingEfficiencyCount: currentStats.count - currentStats.efficiencyMeasuredCount,
    narrative: {
      whatChanged: 'Two activities include an ongoing drive.',
      whyItMatters: 'Missing energy must not remove activity.',
      confidence: { label: 'not_scored', score: null, basis: [] },
      likelyCause: null, recommendedResponse: 'Review measured drive evidence.',
      limitations: ['Ongoing activity has no measured energy.'],
      evidence: [], provenance: [{ source: 'Drive history' }],
    },
    datePresetLabel: 'Today', startDate: '2026-10-13', endDate: '2026-10-13',
    fmtCompact: vi.fn<Props['fmtCompact']>(value => String(value)),
    distanceUnit: 'km', distMi: 12, efficiencyUnit: 'Wh/km',
    avgEffDisp: currentStats.avgEfficiencyWhKm,
    fmtInt: vi.fn<Props['fmtInt']>(value => typeof value === 'number' ? String(Math.round(value)) : '—'),
    efficiencyMovementValue: '8% higher', efficiencyMovementTone: 'warning',
    routeContextCount: 1,
    driveAttention: [
      { key: 'drive-anomalies', title: '1 energy-intensity exception',
        description: 'Review measured high-energy drives against route evidence.', tone: 'warning' },
      { key: 'drive-energy-coverage', title: '1 drive excluded from efficiency',
        description: 'Activity remains visible without measured energy.', tone: 'info' },
    ],
    navigate: vi.fn<(to: To | number, options?: NavigateOptions) => void>(), ...overrides,
  };
  return { props, ...render(<MemoryRouter><DrivesOperationalBrief {...props} /></MemoryRouter>) };
}

function metric(key: string) {
  const item = within(screen.getByTestId('drives-operational-brief'))
    .getAllByRole('listitem').find(element => element.getAttribute('data-operational-metric') === key);
  if (!item) throw new Error(`Missing operational metric: ${key}`);
  return item;
}

function value(key: string) {
  return metric(key).querySelector('[data-operational-value]');
}

describe('DrivesOperationalBrief count caption regression', () => {
  it('counts completed drive 190 and ongoing drive 191 with inclusive caption and unchanged brief actions', async () => {
    const { props } = mount();
    expect(props.drivesState.data?.map(drive => [drive.id, drive.endTs])).toEqual([
      [190, '2026-10-13T10:20:00Z'], [191, null],
    ]);
    expect(props.currentStats.count).toBe(2);
    expect(value('drives')).toHaveTextContent(/^2$/);
    expect(metric('drives')).toHaveTextContent('Drives in the selected analysis window, including ongoing activity.');
    expect(screen.queryByText('Completed drives in the selected analysis window.')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('drives-operational-brief')).getAllByRole('listitem')).toHaveLength(6);
    expect(value('distance')).toHaveTextContent(/^12$/);
    expect(metric('distance')).toHaveTextContent('Distance (km)');
    expect(value('efficiency')).toHaveTextContent(/^300$/);
    expect(metric('efficiency')).toHaveTextContent('Energy intensity (Wh/km)');
    expect(metric('efficiency')).toHaveTextContent('1 of 2 drives have measured energy and sufficient distance.');
    expect(value('movement')).toHaveTextContent(/^8% higher$/);
    expect(value('exceptions')).toHaveTextContent(/^1$/);
    expect(value('route-context')).toHaveTextContent(/^50%$/);
    expect(metric('route-context')).toHaveTextContent('1 of 2 drives include both origin and destination evidence.');
    expect(screen.getByText('Review recommended')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Historical')).toBeInTheDocument();
    expect(screen.getByText('1 energy-intensity exception')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare drives' }));
    expect(props.navigate).toHaveBeenCalledExactlyOnceWith('/drive-compare');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Activity, efficiency, and exceptions in context details',
    });
    const caption = within(dialog).getByText('Drives in the selected analysis window, including ongoing activity.');
    expect(caption.parentElement).toHaveTextContent('Drives2');
    expect(within(dialog).getByTestId('operational-narrative')).toHaveTextContent('Two activities include an ongoing drive.');
    expect(within(dialog).getByTestId('operational-narrative')).toHaveTextContent('Ongoing activity has no measured energy.');
    expect(within(dialog).getByText('1 drive excluded from efficiency')).toBeInTheDocument();
    expect(within(dialog).getByTestId('operational-narrative')).toHaveTextContent('Drive history');
    expect(props.refetchDrives).not.toHaveBeenCalled();
  });

  it('preserves measured empty count zero rather than unknown or unavailable', () => {
    mount([], {
      anomalyDrives: [], distMi: 0, routeContextCount: 0, driveAttention: [],
      efficiencyMovementValue: 'No baseline', efficiencyMovementTone: 'neutral',
    });
    expect(value('drives')).toHaveTextContent(/^0$/);
    expect(metric('drives')).toHaveTextContent('Drives in the selected analysis window, including ongoing activity.');
    expect(value('distance')).toHaveTextContent(/^0$/);
    expect(value('exceptions')).toHaveTextContent(/^0$/);
    expect(value('efficiency')).toHaveTextContent(/^—$/);
    expect(metric('efficiency')).toHaveTextContent('0 of 0 drives have measured energy and sufficient distance.');
    expect(value('route-context')).toHaveTextContent(/^—$/);
    expect(screen.getByText('Awaiting data')).toBeInTheDocument();
    expect(screen.queryByText('Drive history is unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compare drives' })).toBeEnabled();
  });

  it('keeps formatted measured efficiency zero distinct from missing efficiency', () => {
    const { props } = mount([{ ...completed, energyUsedWh: 2 }], {
      anomalyDrives: [], distMi: 10, driveAttention: [],
      efficiencyMovementValue: 'Stable', efficiencyMovementTone: 'neutral',
    });
    expect(props.currentStats.avgEfficiencyWhKm).toBe(0.2);
    expect(props.fmtInt).toHaveBeenCalledWith(0.2);
    expect(value('efficiency')).toHaveTextContent(/^0$/);
    expect(metric('efficiency')).toHaveTextContent('1 of 1 drives have measured energy and sufficient distance.');
    expect(value('drives')).toHaveTextContent(/^1$/);
    expect(value('route-context')).toHaveTextContent(/^100%$/);
    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('preserves mixed activity count two when energy evidence is unknown', () => {
    const { props } = mount([{ ...completed, energyUsedWh: null }, ongoing], { anomalyDrives: [] });
    expect(props.currentStats.avgEfficiencyWhKm).toBeNull();
    expect(value('drives')).toHaveTextContent(/^2$/);
    expect(metric('drives')).toHaveTextContent('Drives in the selected analysis window, including ongoing activity.');
    expect(value('efficiency')).toHaveTextContent(/^—$/);
    expect(metric('efficiency')).toHaveTextContent('0 of 2 drives have measured energy and sufficient distance.');
    expect(props.fmtInt).not.toHaveBeenCalledWith(null);
    expect(value('exceptions')).toHaveTextContent(/^0$/);
    expect(screen.getByText('Review recommended')).toBeInTheDocument();
  });

  it('keeps initial loading source shaped without publishing count or caption', () => {
    mount(activity, {
      isDrivesLoading: true, hasDrivePayload: false,
      drivesState: deriveDataState<Drive[]>({ isPending: true }),
    });
    const loading = screen.getByRole('status', { name: 'Loading Drive history' });
    expect(loading.querySelector('[aria-hidden="true"]')).toHaveClass('h-32');
    expect(screen.getByRole('heading')).toHaveTextContent('Activity, efficiency, and exceptions in context');
    expect(screen.queryByTestId('drives-operational-brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Drives in the selected analysis window, including ongoing activity.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compare drives' })).not.toBeInTheDocument();
  });

  it('keeps unavailable payload distinct from measured zero and retries the original source', () => {
    const { props } = mount([], {
      hasDrivePayload: false, drivesState: deriveDataState<Drive[]>({}),
    });
    expect(screen.getByText('Drive history is unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('drives-operational-brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Awaiting data')).not.toBeInTheDocument();
    expect(screen.queryByText('Drives in the selected analysis window, including ongoing activity.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.refetchDrives).toHaveBeenCalledExactlyOnceWith();
    expect(props.navigate).not.toHaveBeenCalled();
  });

  it('keeps fatal initial failure source local with retry and no fabricated count', () => {
    const { props } = mount([], {
      hasDrivePayload: false,
      drivesState: deriveDataState<Drive[]>({ error: new Error('History failed'), isError: true }),
    });
    expect(screen.getByText('Drive history could not be loaded')).toBeInTheDocument();
    expect(screen.queryByTestId('drives-operational-brief')).not.toBeInTheDocument();
    expect(screen.queryByText('Awaiting data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(props.refetchDrives).toHaveBeenCalledExactlyOnceWith();
  });

  it('retains count two inclusive caption and compare action after a refresh failure', () => {
    const { props } = mount(activity, {
      drivesState: deriveDataState({ data: activity, error: new Error('Refresh failed'), isError: true },
        { provenance: 'historical' }),
    });
    expect(props.drivesState.fatalError).toBeNull();
    expect(props.drivesState.refreshError?.message).toBe('Refresh failed');
    expect(props.drivesState.status).toBe('stale');
    expect(props.drivesState.data).toBe(activity);
    expect(value('drives')).toHaveTextContent(/^2$/);
    expect(metric('drives')).toHaveTextContent('Drives in the selected analysis window, including ongoing activity.');
    expect(value('efficiency')).toHaveTextContent(/^300$/);
    expect(screen.getByText('Historical')).toBeInTheDocument();
    expect(screen.queryByText('Drive history could not be loaded')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare drives' }));
    expect(props.navigate).toHaveBeenCalledExactlyOnceWith('/drive-compare');
  });
});
