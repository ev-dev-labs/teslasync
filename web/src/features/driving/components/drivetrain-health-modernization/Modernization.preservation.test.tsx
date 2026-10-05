/**
 * AUTHORED NOT RUN. Fake source/presenter inputs, real shared chart frames,
 * error recovery, stats and mobile table pipeline. Runtime/visual acceptance
 * belongs to the parent's serialized validation window.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DataStateSource } from '@/api/dataState';
import { deriveDataState } from '@/api/dataState';
import type { DrivetrainHealthData, Drive, DrivingStats } from '@/types/driving';
import type { MotorSnapshot } from '@/api/types';
import { getFormatterPreferences, setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';
import DrivetrainHealthPage from '../../pages/DrivetrainHealthPage';
import { SourceBoundary } from './SourceBoundary';
import { RecommendationsPanel } from './RecommendationsPanel';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Button, Text } from '@/components/ui';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { healthFixture, statsFixture, driveFixture, motorFixture } from './fixtures';

const sources = vi.hoisted(() => ({
  health: {} as DataStateSource<DrivetrainHealthData>,
  drives: {} as DataStateSource<Drive[]>,
  stats: {} as DataStateSource<DrivingStats>,
  latest: {} as DataStateSource<MotorSnapshot | null>,
  history: {} as DataStateSource<MotorSnapshot[]>,
  vehicleId: 7 as number | undefined,
  range: { start: '2026-09-01', end: '2026-09-30' },
  temperature: 'C',
  distance: 'km',
  precision: 2,
  connected: false,
  isolation: 0,
  healthCall: vi.fn(),
  drivesCall: vi.fn(),
  statsCall: vi.fn(),
  latestCall: vi.fn(),
  historyCall: vi.fn(),
  retry: vi.fn(),
}));

vi.mock('@/api/hooks/useDriving', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useDriving')>('@/api/hooks/useDriving'),
  useDrivetrainHealth: (...args: unknown[]) => { sources.healthCall(...args); return sources.health; },
  useDrives: (...args: unknown[]) => { sources.drivesCall(...args); return sources.drives; },
  useDrivingStats: (...args: unknown[]) => { sources.statsCall(...args); return sources.stats; },
}));
vi.mock('@/api/hooks/useVehicles', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles'),
  useMotorLatest: (...args: unknown[]) => { sources.latestCall(...args); return sources.latest; },
  useMotorHistory: (...args: unknown[]) => { sources.historyCall(...args); return sources.history; },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: sources.vehicleId }) }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => sources.range }));
vi.mock('@/hooks/useVehicleLive', () => ({
  useVehicleLive: () => ({ state: { isolationResistance: sources.isolation }, connected: sources.connected }),
}));
vi.mock('@/hooks/useSettings', async () => ({
  ...await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings'),
  useSettings: () => ({
    settings: {
      unit_of_temp: sources.temperature,
      unit_of_length: sources.distance,
      decimal_precision: sources.precision,
      locale: 'en-US',
      currency_symbol: '$',
      chart_palette: 'cb_safe',
    },
    settingsUnavailable: false,
  }),
}));
vi.mock('@/hooks/useOperationalMode', async () => ({
  ...await vi.importActual<typeof import('@/hooks/useOperationalMode')>('@/hooks/useOperationalMode'),
  useOperationalMode: () => ({ isReadOnly: false, mode: 'live' }),
}));
vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(/{{(\w+)}}/g,
        (_match, name: string) => String(options?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Typed PARTIAL mock: keep motion, AnimatePresence, RouteTransition and every
// other barrel export available to the REAL chart/error/table implementation.
vi.mock('@/components/motion', async () => {
  const actual = await vi.importActual<typeof import('@/components/motion')>('@/components/motion');
  return {
    ...actual,
    FadeIn: ({ children, className }: ComponentProps<typeof actual.FadeIn>) => <div className={className}>{children}</div>,
    StaggerContainer: ({ children, className }: ComponentProps<typeof actual.StaggerContainer>) => <div className={className}>{children}</div>,
    StaggerItem: ({ children, className }: ComponentProps<typeof actual.StaggerItem>) => <div className={className}>{children}</div>,
  };
});

function ready<T>(data: T): DataStateSource<T> {
  return { data, isSuccess: true, isPending: false, isLoading: false, isFetching: false, fetchStatus: 'idle', dataUpdatedAt: 1_790_000_000_000, refetch: sources.retry };
}

let client: QueryClient;
const previousPreferences = getFormatterPreferences();
function Providers({ children }: { children: ReactNode }) {
  // RTL preserves this wrapper on EVERY rerender: real error useNavigate,
  // chart legend URL state and the table's routing context remain valid.
  return <MemoryRouter initialEntries={['/drivetrain-health']}>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </MemoryRouter>;
}

/** Fake presenter isolates the REAL URL preference hook from chart dimensions. */
function LegendProbe() {
  const hidden = useHiddenSeries('drivetrain-power-output');
  const location = useLocation();
  return <div>
    <Button onClick={() => hidden.toggle('powerMin')}>Fixture toggle regen</Button>
    <Text as="p">{hidden.isHidden('powerMin') ? 'Fixture hidden' : 'Fixture visible'}</Text>
    <Text as="p">{location.search}</Text>
  </div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(375);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sources.vehicleId = 7;
  sources.temperature = 'C';
  sources.distance = 'km';
  sources.precision = 2;
  sources.connected = false;
  sources.isolation = 0;
  sources.health = ready(healthFixture);
  sources.drives = ready([driveFixture(), driveFixture({ id: 2, startTs: '2026-09-02T12:00:00', avgPowerW: 2000 })]);
  sources.stats = ready(statsFixture);
  sources.latest = ready(motorFixture());
  sources.history = ready([motorFixture(), motorFixture({ id: 2, ts: '2026-09-01T12:01:00', torque_nm_front: null })]);
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});
afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
  setGlobalPrecision(previousPreferences.precision);
  setGlobalLocale(previousPreferences.locale);
});

describe('drivetrain live modernization preservation (authored)', () => {
  it('renders every original section plus complete record details with unchanged query calls', () => {
    const { container } = render(<DrivetrainHealthPage />, { wrapper: Providers });
    for (const label of ['Health Score', 'Motor Details', 'Drive Statistics', 'Temperature Gauges',
      'Thermal Load Indicators', 'Live Motor Status', 'Stator Temperature History', 'Motor Torque',
      'Temperature Trend', 'Power Output History', 'Temperature Details', 'Power Summary', 'Health Recommendations']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    expect(container.querySelectorAll('[data-recommendation]')).toHaveLength(7);
    expect(sources.healthCall).toHaveBeenCalledWith('7');
    expect(sources.drivesCall).toHaveBeenCalledWith('7');
    expect(sources.statsCall).toHaveBeenCalledWith('7');
    expect(sources.latestCall).toHaveBeenCalledWith(7, 5000);
    expect(sources.historyCall).toHaveBeenCalledWith(7, 200);
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(screen.getAllByText('Front Motor RPM').length).toBeGreaterThan(0);
    expect(screen.getAllByText('HV Isolation').length).toBeGreaterThan(0);
  });

  it('retains independent chart/table/stat neighbors when health fails without data', () => {
    sources.health = { error: new Error('health failed'), isError: true, refetch: sources.retry };
    const { container, rerender } = render(<DrivetrainHealthPage />, { wrapper: Providers });
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    expect(screen.getAllByText('Drive Statistics').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(sources.retry).toHaveBeenCalled();
    sources.health = ready(healthFixture);
    rerender(<DrivetrainHealthPage />);
    expect(screen.getAllByText('Drivetrain running warm').length).toBeGreaterThan(0);
  });

  it.each(['health', 'drives', 'stats', 'latest', 'history'] as const)(
    'keeps permanent shells and independent neighbors for a fatal %s source',
    source => {
      sources[source] = { error: new Error(`${source} failed`), isError: true, refetch: sources.retry };
      const { container } = render(<DrivetrainHealthPage />, { wrapper: Providers });
      expect(container.querySelectorAll('[data-card-grid]').length).toBeGreaterThan(0);
      expect(container.querySelectorAll('figure')).toHaveLength(4);
      expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Health methodology and source limits').length).toBeGreaterThan(0);
    },
  );

  it('keeps retained data on refresh failure and recovery through a router-wrapped rerender', () => {
    const { rerender, container } = render(<DrivetrainHealthPage />, { wrapper: Providers });
    sources.health = { ...sources.health, error: new Error('refresh failed'), isError: true };
    sources.history = { ...sources.history, error: new Error('history failed'), isError: true };
    rerender(<DrivetrainHealthPage />);
    expect(screen.getAllByTestId('stale-refresh-warning').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('figure')).toHaveLength(4);
    expect(screen.getAllByText('Warm').length).toBeGreaterThan(0);
    sources.health = ready(healthFixture);
    sources.history = ready([motorFixture(), motorFixture()]);
    rerender(<DrivetrainHealthPage />);
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
  });

  it('updates real SI formatters, stat preferences and record details on C/km to F/mi rerender', () => {
    const { rerender, container } = render(<DrivetrainHealthPage />, { wrapper: Providers });
    const before = container.textContent ?? '';
    expect(before).toContain('°C');
    sources.temperature = 'F';
    sources.distance = 'mi';
    sources.precision = 1;
    rerender(<DrivetrainHealthPage />);
    const after = container.textContent ?? '';
    expect(after).toContain('°F');
    expect(after).toContain('mi');
    expect(after).not.toEqual(before);
    expect(after).not.toContain('NaN');
    expect(after).not.toContain('Infinity');
  });

  it('keeps every motor field available through the real mobile quick-view details', () => {
    render(<DrivetrainHealthPage />, { wrapper: Providers });
    const motorTable = screen.getByLabelText('Motor history records');
    fireEvent.click(within(motorTable).getAllByRole('button', { name: 'Quick view' })[0]);
    const dialog = screen.getByRole('dialog');
    for (const label of ['Time', 'Stator', 'Rear-Left', 'Rear-Right', 'Torque (Nm)',
      'Direct power signal (not supplied)', 'Axle speed (RPM)']) {
      expect(within(dialog).getAllByText(label).length).toBeGreaterThan(0);
    }
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('preserves genuine zero values without manufacturing missing readings', () => {
    const { container } = render(<DrivetrainHealthPage />, { wrapper: Providers });
    const powerValues = Array.from(container.querySelectorAll('[data-metric="power"][data-state="value"]'));
    expect(powerValues.some(node => (node.textContent ?? '').includes('0.00'))).toBe(true);
    const missingTemperatures = container.querySelectorAll('[data-metric="temperature"][data-state="missing"]');
    expect(missingTemperatures.length).toBeGreaterThan(0);
  });

  it('keeps the original URL legend key and hidden flag across presenter rerenders', () => {
    const { rerender } = render(<LegendProbe />, { wrapper: Providers });
    fireEvent.click(screen.getByRole('button', { name: 'Fixture toggle regen' }));
    expect(screen.getByText('Fixture hidden')).toBeTruthy();
    expect(screen.getByText('?hidden_drivetrain-power-output=powerMin')).toBeTruthy();
    rerender(<LegendProbe />);
    expect(screen.getByText('Fixture hidden')).toBeTruthy();
  });

  it('does not call missing health good, fabricate regen, or label a connection active', () => {
    sources.health = ready({ ...healthFixture, frontMotorTempC: null, rearMotorTempC: null, inverterTempC: null });
    sources.latest = ready(null);
    sources.drives = ready([driveFixture({ avgPowerW: null }), driveFixture({ avgPowerW: null })]);
    sources.history = ready([]);
    const { container } = render(<DrivetrainHealthPage />, { wrapper: Providers });
    expect(screen.queryByText('Drivetrain healthy')).toBeNull();
    expect(screen.queryByText('Real-time telemetry active')).toBeNull();
    expect(screen.getByText('No temperature evidence for an active health assessment')).toBeTruthy();
    expect(container.querySelectorAll('[data-recommendation]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-state="missing"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('figure')).toHaveLength(4);
  });

  it.each(['good', 'warning', 'critical'] as const)('preserves %s recommendation content/priority policy', status => {
    const { container } = render(<RecommendationsPanel status={status} />, { wrapper: Providers });
    expect(container.querySelectorAll('[data-recommendation]')).toHaveLength(status === 'critical' ? 9 : status === 'warning' ? 7 : 4);
    if (status === 'critical') expect(screen.getAllByText('Urgent recommendation:')).toHaveLength(2);
  });

  it('uses the real error provider path inside a permanent shell and restores retained content', () => {
    const fatal = deriveDataState({ error: new Error('source failed'), refetch: sources.retry });
    const { rerender } = render(<LayoutCard title="Fixture source">
      <SourceBoundary state={fatal} label="Fixture source" empty={false} emptyMessage="Fixture empty">
        <span>Retained neighbor</span>
      </SourceBoundary>
    </LayoutCard>, { wrapper: Providers });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const retained = deriveDataState({ data: { value: 0 }, error: new Error('refresh failed'), refetch: sources.retry });
    rerender(<LayoutCard title="Fixture source">
      <SourceBoundary state={retained} label="Fixture source" empty={false} emptyMessage="Fixture empty">
        <span>Retained neighbor</span>
      </SourceBoundary>
    </LayoutCard>);
    expect(screen.getByText('Retained neighbor')).toBeTruthy();
    expect(screen.getByTestId('stale-refresh-warning')).toBeTruthy();
  });
});
