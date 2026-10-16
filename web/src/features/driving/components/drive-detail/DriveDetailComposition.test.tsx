import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DriveDetail } from '@/types/driving';
import type { ChartDataPoint } from './types';
import { driveFixture, pointFixture, statsFixture } from './detailTestFixtures';

const state = vi.hoisted(() => ({
  drive: null as DriveDetail | null, error: null as Error | null, chartData: [] as ChartDataPoint[],
}));
vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : opts;
      const text = typeof fallback === 'string' ? fallback
        : typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(options?.[token] ?? token));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingStats: () => ({ data: undefined }),
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useFsdInsightsForDrive: () => ({ data: { drive_analytics: { contributing_drives: null } } }),
}));
vi.mock('@/components/motion', async () => ({
  ...await vi.importActual<typeof import('@/components/motion')>('@/components/motion'),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null }, exportPNG: vi.fn(), exportSVG: vi.fn(),
    copyToClipboard: vi.fn(), exporting: false,
  }),
}));
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({ data: [], isPending: false, isLoading: false, isFetching: false, isError: false, error: null, fetchStatus: 'idle', dataUpdatedAt: 0, refetch: vi.fn() }),
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));
vi.mock('../ShareDriveDialog', () => ({
  ShareDriveDialog: ({ open, driveId, onClose }: { open: boolean; driveId: string; onClose: () => void }) =>
    open ? <div role="dialog" aria-label="Share drive">{driveId}<span onClick={onClose} data-testid="close-share" /></div> : null,
}));
vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof import('./index')>('./index');
  const placeholder = () => <div data-testid="evidence-leaf" />;
  return {
    ...actual,
    useDriveDetailData: () => ({
      drive: state.drive, vehicle: null, isLoading: false,
      driveQuery: { data: state.drive ?? undefined, error: state.error, isError: !!state.error, isSuccess: !state.error, dataUpdatedAt: 1000 },
      stats: state.drive ? statsFixture() : null, chartData: state.chartData, routeSource: [], trail: [],
      startPos: undefined, endPos: undefined, centerPos: [0, 0], speedSegments: [], speedHistData: [],
    }),
    RouteMapSection: placeholder, DrivePhysicsDebriefPanel: placeholder,
    SupervisedDrivingPanel: placeholder, DriveLedgerCompactPanel: placeholder,
    GearTheaterPanel: placeholder, SilentCounterPanel: placeholder, RoadAnomalyPanel: placeholder, WhyEndedPanel: placeholder,
  };
});
import DriveDetailPage from '../../pages/DriveDetailPage';

function show(id = '412') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/drives/${id}`]}>
        <Routes><Route path="/drives/:id" element={<DriveDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.drive = driveFixture();
  state.error = null;
  state.chartData = [
    pointFixture({ time: '10:00', power: 20, idealRange: 300, ratedRange: 280, estRange: 260, usableSoc: 79 }),
    pointFixture({ time: '10:30', speed: 108, battery: 70, power: -10, idealRange: 250, ratedRange: 240, estRange: 230, usableSoc: 69 }),
  ];
  window.localStorage.clear();
});

describe('Continuous drive report with real summary, journey, energy, cost and chart panels', () => {
  it.each(['recorded', 'missing'] as const)('keeps the entire %s story visible with direct section links, not hidden tabs', (record) => {
    if (record === 'missing') {
      state.drive = null;
      state.chartData = [];
    }
    const { container } = show();
    for (const role of ['tab', 'tablist', 'tabpanel']) {
      expect(screen.queryByRole(role, { hidden: true })).toBeNull();
    }
    const navigation = screen.getByRole('navigation', { name: 'Drive report sections' });
    expect(within(navigation).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '#overview');
    expect(within(navigation).getByRole('link', { name: 'Energy and cost' })).toHaveAttribute('href', '#energy');
    // Journey and route anchors live inside the Overview hero for a recorded drive.
    for (const id of [
      ...(record === 'recorded' ? ['journey', 'route'] : []), 'overview', 'energy-evidence', 'cost-estimate',
      'fsd-evidence', 'silent-counter', 'telemetry', 'battery-trace', 'speed-distribution',
      'power-trace', 'elevation-trace', 'temperature-trace', 'tire-trace', 'physics', 'physics-ledger',
      'gear-theater', 'road-analysis', 'why-ended',
    ]) {
      expect(container.querySelector(`#${id}`)).toBeVisible();
    }
    expect(screen.getAllByTestId('drive-detail-summary')).toHaveLength(1);
    if (record === 'recorded') {
      for (const heading of [
        'Drive overview', 'SOC % over time', 'Speed histogram (km/h)',
        'Power profile', 'Elevation profile', 'Temperatures', 'Tire pressure during drive',
      ]) {
        expect(screen.getByRole('heading', { name: heading })).toBeVisible();
      }
      const sampleEvidence = within(screen.getByRole('table', { name: /Sample statistics/ }));
      for (const series of ['Range (ideal)', 'Range (rated)', 'Range (est.)', 'Usable SOC']) {
        expect(sampleEvidence.getByRole('rowheader', { name: series })).toBeVisible();
      }
    }
    if (record === 'recorded') {
      const route = screen.getByTestId('drive-detail-route');
      expect(screen.getByTestId('drive-detail-summary')).toContainElement(route);
    }
    expect(container.querySelector('#energy-evidence')!.compareDocumentPosition(screen.getByTestId('drive-detail-evidence')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('owns each aggregate fact once and replaces repeated blocks with separate source drilldowns', () => {
    show();
    expect(screen.getAllByTestId('drive-detail-summary')).toHaveLength(1);
    expect(within(screen.getByTestId('drive-detail-summary')).getByRole('group', { name: 'Energy and cost' })).toBeInTheDocument();
    expect(screen.getByTestId('drive-detail-route')).toHaveAttribute('id', 'route');
    expect(screen.getByTestId('drive-detail-evidence').querySelector('#telemetry')).not.toBeNull();
    // Distance and duration are the journey leg's values (labelled for assistive tech).
    expect(within(screen.getByTestId('journey-sequence')).getAllByText(/^Distance/)).toHaveLength(1);
    expect(within(screen.getByTestId('journey-sequence')).getAllByText(/^Duration/)).toHaveLength(1);
    for (const label of ['Average speed', 'Maximum speed', 'Consumption', 'Energy consumed', 'Energy recovered', 'Trip cost']) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
    expect(screen.queryByText('Net consumption')).toBeNull();
    expect(screen.queryByText('Net Consumption')).toBeNull();
    // The Overview's energy-source note lives in its details drawer, not on the card face.
    expect(screen.getAllByText(/Persisted drive aggregate/)).toHaveLength(2);
    fireEvent.click(within(screen.getByTestId('drive-canonical-summary')).getByRole('button', { name: 'Details' }));
    expect(within(screen.getByRole('dialog')).getByText('Persisted drive aggregate')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Drive timeline' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Energy and range evidence' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Cost and savings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Home → Office' })).toBeInTheDocument();
  });

  it('retains section anchors, source panels and actions when a refresh fails', () => {
    state.error = new Error('refresh failed');
    const { container } = show('987');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByTestId('drive-canonical-summary')).toBeInTheDocument();
    for (const id of ['journey', 'overview', 'route', 'telemetry', 'energy', 'supervised', 'physics', 'diagnostics']) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(screen.getByRole('link', { name: 'Replay' })).toHaveAttribute('href', '/drives/987/replay');
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('987');
    fireEvent.click(screen.getByTestId('close-share'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps missing source values as unknown while zero SOC and energy stay valid', () => {
    state.drive = driveFixture({ energyUsedWh: 0, regenEnergyWh: null, avgPowerW: null, startBatteryPct: 0, endBatteryPct: null });
    Object.assign(state.drive, { telemetry: null, positions: null });
    show();
    expect(screen.getByText('Battery 0.00%')).toBeInTheDocument();
    expect(screen.getByText('Battery —')).toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
    expect(screen.getByTestId('drive-cost-estimate')).toBeInTheDocument();
    expect(screen.getByTestId('drive-energy-evidence')).toBeInTheDocument();
  });

  it('shows one missing-record notice, individual section placeholders and independent evidence', () => {
    state.drive = null;
    show();
    expect(screen.getAllByText(/This drive could not be found/)).toHaveLength(1);
    // The Overview placeholder covers the merged journey and route hero.
    expect(screen.getByText('No Overview data is available for this drive.')).toBeInTheDocument();
    expect(screen.queryByTestId('drive-detail-route')).toBeNull();
    for (const testId of ['drive-detail-summary', 'drive-detail-evidence']) {
      expect(screen.getAllByTestId(testId)).toHaveLength(1);
    }
    expect(screen.getAllByTestId('evidence-leaf').length).toBeGreaterThan(2);
  });
});
