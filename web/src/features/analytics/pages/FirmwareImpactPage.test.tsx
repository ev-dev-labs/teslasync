import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { Drive } from '@/types/driving';
import type { SoftwareUpdate } from '@/types/vehicle-systems';
import type { PageLayout, CardGridItem } from '@/components/layout';
import type { FirmwareImpactChart, FirmwareImpactDetails } from '../components/firmware-impact-modernization';
import type { FirmwareBrief } from '../components/operationalbrief-a-m/FirmwareBrief';
import { subscribeAnnouncer, __resetAnnouncerForTests, type AnnouncerPriority } from '@/hooks/useAnnouncer';
import { __resetStatusAnnouncerForTests } from '@/hooks/useStatusAnnouncer';
import { __resetAnnouncePolicyForTests } from '@/lib/announcePolicy';
import FirmwareImpactPage from './FirmwareImpactPage';

const source = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  drives: {} as DataStateSource<Drive[]>,
  updates: {} as DataStateSource<SoftwareUpdate[]>,
  drivesHook: vi.fn(),
  updatesHook: vi.fn(),
  page: vi.fn<(props: ComponentProps<typeof PageLayout>) => void>(),
  chart: vi.fn<(props: ComponentProps<typeof FirmwareImpactChart>) => void>(),
  details: vi.fn<(props: ComponentProps<typeof FirmwareImpactDetails>) => void>(),
  brief: vi.fn<(props: ComponentProps<typeof FirmwareBrief>) => void>(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? '')),
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: source.vehicleId }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (vehicleId?: string) => {
    source.drivesHook(vehicleId);
    return source.drives;
  },
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({
  useSoftwareUpdates: (vehicleId: string) => {
    source.updatesHook(vehicleId);
    return source.updates;
  },
}));
vi.mock('@/components/layout', () => ({
  PageLayout: (props: ComponentProps<typeof PageLayout>) => {
    source.page(props);
    return <div data-testid="page">{props.children}</div>;
  },
  CardGrid: ({ items }: { items: CardGridItem[] }) =>
    <div>{items.map(item => <div key={item.id}>{item.content}</div>)}</div>,
  Section: ({ id, title, children }: { id: string; title: string; children: ReactNode }) =>
    <section id={id}><h2>{title}</h2>{children}</section>,
}));
vi.mock('@/components/ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) =>
    <div data-testid="no-vehicle">{pageTitle}</div>,
}));
vi.mock('../components/firmware-impact-modernization', async () => {
  const { firmwareImpactState } = await import('../components/firmware-impact-modernization/firmwareImpactState');
  return {
    firmwareImpactState,
    FirmwareImpactSlot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    FirmwareImpactChart: (props: ComponentProps<typeof FirmwareImpactChart>) => {
      source.chart(props);
      return <div data-testid="chart" />;
    },
    FirmwareImpactDetails: (props: ComponentProps<typeof FirmwareImpactDetails>) => {
      source.details(props);
      return <div data-testid="details" />;
    },
  };
});
vi.mock('../components/operationalbrief-a-m/FirmwareBrief', () => ({
  FirmwareBrief: (props: ComponentProps<typeof FirmwareBrief>) => {
    source.brief(props);
    return <button type="button" onClick={props.onRetry} aria-label="Retry histories" />;
  },
}));

const install: SoftwareUpdate = {
  id: 'test-install', vehicleId: '4', version: '2026.20',
  status: 'installed', installedAt: '2026-06-15T00:00:00Z',
  scheduledAt: null, createdAt: '2026-06-15T00:00:00Z',
};

function drive(id: number, startTs: string, energyUsedWh: number): Drive {
  return {
    id, vehicleId: 4, startTs, endTs: null, durationS: 900, distanceM: 10000,
    startAddress: null, endAddress: null, startLat: null, startLon: null,
    endLat: null, endLon: null, startBatteryPct: null, endBatteryPct: null,
    energyUsedWh, regenEnergyWh: null, avgSpeedMps: null, maxSpeedMps: null,
    avgPowerW: null, outsideTempAvgC: null, insideTempAvgC: null,
    score: null, endedStatus: null, createdAt: startTs, updatedAt: startTs,
  };
}

let spoken: Array<{ message: string; priority: AnnouncerPriority }>;
let unsubscribe: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  __resetStatusAnnouncerForTests();
  __resetAnnouncerForTests();
  __resetAnnouncePolicyForTests();
  spoken = [];
  unsubscribe = subscribeAnnouncer((message, priority) => {
    spoken.push({ message: message.replace(/\u200B+$/, ''), priority });
  });
  source.vehicleId = 4;
  source.drives = { isLoading: true, isPending: true, isFetching: true, refetch: vi.fn() };
  source.updates = { isLoading: true, isPending: true, isFetching: true, refetch: vi.fn() };
});
afterEach(() => {
  cleanup();
  unsubscribe();
  __resetStatusAnnouncerForTests();
});

function expectSections() {
  expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent))
    .toEqual(['Comparison overview', 'Observed consumption differences', 'Per-version evidence']);
  expect(document.querySelectorAll('section').length).toBe(3);
}

describe('FirmwareImpactPage governed comparison announcements and preservation', () => {
  it('waits for both histories before announcing once without replacing the three shells', () => {
    const view = render(<FirmwareImpactPage />);
    expectSections();
    expect(spoken).toEqual([]);
    expect(source.chart.mock.lastCall?.[0].state.loading).toBe(true);
    source.drives = { data: [], isSuccess: true };
    view.rerender(<FirmwareImpactPage />);
    expect(spoken).toEqual([]);
    source.updates = { data: [install], isSuccess: true };
    view.rerender(<FirmwareImpactPage />);
    expectSections();
    expect(spoken).toEqual([{ message: 'Firmware impact loaded, 1 items', priority: 'polite' }]);
    expect(source.page.mock.lastCall?.[0]).toMatchObject({ announce: false, busy: false });
    expect(source.page.mock.lastCall?.[0].loading).toBeUndefined();
    expect(source.page.mock.lastCall?.[0].error).toBeUndefined();
    view.rerender(<FirmwareImpactPage />);
    expect(spoken).toHaveLength(1);
  });

  it('announces an authoritative empty comparison result rather than inventing measurements', () => {
    const view = render(<FirmwareImpactPage />);
    source.drives = { data: [] };
    source.updates = { data: [] };
    view.rerender(<FirmwareImpactPage />);
    expectSections();
    expect(spoken).toEqual([{ message: 'No Firmware impact to show', priority: 'polite' }]);
    expect(source.brief.mock.lastCall?.[0]).toMatchObject({
      best: null, worst: null, summary: { impacts: [], skipped: 0, significantCount: 0 },
      state: { hasInputs: true, loading: false },
    });
  });

  it('announces a missing-source failure and retains independent recovery and section shells', () => {
    const retryDrives = source.drives.refetch;
    const retryUpdates = source.updates.refetch;
    const view = render(<FirmwareImpactPage />);
    const failure = new Error('drive history unavailable');
    source.drives = { error: failure, isError: true, refetch: retryDrives };
    source.updates = { data: [install], refetch: retryUpdates };
    view.rerender(<FirmwareImpactPage />);
    expectSections();
    expect(spoken).toEqual([{ message: 'Could not refresh Firmware impact', priority: 'assertive' }]);
    expect(source.chart.mock.lastCall?.[0].state.fatalError).toBe(failure);
    expect(source.page.mock.lastCall?.[0].dataSources?.map(item => item.id))
      .toEqual(['drive-history', 'software-updates']);
    expect(source.page.mock.lastCall?.[0].error).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry histories' }));
    expect(retryDrives).toHaveBeenCalledTimes(1);
    expect(retryUpdates).toHaveBeenCalledTimes(1);
  });

  it('keeps retained comparisons on a failed refresh without repeating a load announcement', () => {
    source.drives = { data: [] };
    source.updates = { data: [install] };
    const view = render(<FirmwareImpactPage />);
    const original = source.details.mock.lastCall?.[0].summary;
    source.drives = { data: [], error: new Error('refresh unavailable'), isError: true };
    view.rerender(<FirmwareImpactPage />);
    expectSections();
    expect(source.details.mock.lastCall?.[0].summary).toEqual(original);
    expect(source.chart.mock.lastCall?.[0].state).toMatchObject({
      hasInputs: true, retained: true, fatalError: null, loading: false,
    });
    expect(spoken).toEqual([]);
  });

  it('keeps paused evidence without fabricating a failure or announcing fresh success', () => {
    source.drives = { data: [], fetchStatus: 'paused' };
    source.updates = { data: [install] };
    render(<FirmwareImpactPage />);
    expectSections();
    expect(source.brief.mock.lastCall?.[0].state).toMatchObject({
      retained: true, fatalError: null,
      drives: { isRefreshBlocked: true, refreshError: null, provenance: 'historical' },
    });
    expect(spoken).toEqual([]);
  });

  it('preserves raw SI samples, all evidence rows, signed plot data and exact export scope', () => {
    const drives = [
      ...[1900, 1950, 2000, 2050, 2100].map((energy, index) =>
        drive(index, `2026-06-${String(8 + index).padStart(2, '0')}T00:00:00Z`, energy)),
      ...[1400, 1450, 1500, 1550, 1600].map((energy, index) =>
        drive(index + 5, `2026-06-${String(16 + index).padStart(2, '0')}T00:00:00Z`, energy)),
    ];
    const updates = [install, { ...install, id: 'thin-install', version: '2026.22', installedAt: '2026-07-01T00:00:00Z' }];
    const before = JSON.stringify({ drives, updates });
    source.drives = { data: drives };
    source.updates = { data: updates };
    render(<FirmwareImpactPage />);
    expectSections();
    expect(source.drivesHook).toHaveBeenCalledWith('4');
    expect(source.updatesHook).toHaveBeenCalledWith('4');
    const evidence = source.details.mock.lastCall?.[0].summary;
    expect(evidence?.impacts.map(impact => [impact.version, impact.verdict]))
      .toEqual([['2026.22', 'insufficient'], ['2026.20', 'better']]);
    expect(evidence?.impacts[1]).toMatchObject({
      before: { n: 5, meanWhPerKm: 200, totalDistanceM: 50000 },
      after: { n: 5, meanWhPerKm: 150, totalDistanceM: 50000 },
      deltaWhPerKm: -50, deltaShare: -0.25,
    });
    expect(source.chart.mock.lastCall?.[0].chartData).toEqual([
      { version: '2026.20', delta: -50, share: -25, p: 0, verdict: 'better' },
    ]);
    expect(source.chart.mock.lastCall?.[0].exportData).toEqual([
      { version: '2026.20', delta: -50, share: -25, p: 0, verdict: 'better' },
    ]);
    expect(source.brief.mock.lastCall?.[0]).toMatchObject({
      best: { version: '2026.20', deltaWhPerKm: -50 }, worst: null,
    });
    expect(screen.getByText(/Statistical significance and effect size do not prove/)).toBeInTheDocument();
    expect(JSON.stringify({ drives, updates })).toBe(before);
  });

  it('keeps the no-vehicle prerequisite and does not announce disabled histories', () => {
    source.vehicleId = null;
    const view = render(<FirmwareImpactPage />);
    source.drives = { data: [] };
    source.updates = { data: [] };
    view.rerender(<FirmwareImpactPage />);
    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Firmware impact');
    expect(screen.queryByTestId('page')).not.toBeInTheDocument();
    expect(source.drivesHook).toHaveBeenCalledWith(undefined);
    expect(source.updatesHook).toHaveBeenCalledWith('');
    expect(spoken).toEqual([]);
  });
});
