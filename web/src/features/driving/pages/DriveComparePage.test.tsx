import type { ChangeEvent, ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';

import type { DriveDetail } from '@/types/driving';
import { formatDateShort, formatDateTime, formatTime } from '@/lib/dateFormat';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { DriveIdentityCard } from '../components/drive-compare/DriveIdentityCard';
import { AdvantageBreakdown } from '../components/drive-compare/AdvantageBreakdown';
import { HeadToHeadGrid } from '../components/drive-compare/HeadToHeadGrid';
import { compareDrives, summarizeComparison } from '../lib/driveCompare';

const {
  pageTitleMock,
  selectedVehicleMock,
  useDriveMock,
  useDrivesMock,
  settingsMock,
  timezoneMock,
  formatDistanceMock,
} = vi.hoisted(() => ({
  pageTitleMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  useDriveMock: vi.fn(),
  useDrivesMock: vi.fn(),
  settingsMock: vi.fn(),
  timezoneMock: vi.fn(),
  formatDistanceMock: (value: number) => `${value} m`,
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => settingsMock(),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => timezoneMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (...args: unknown[]) => useDrivesMock(...args),
  useDrive: (...args: unknown[]) => useDriveMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: formatDistanceMock,
    formatDuration: (value: number) => `${value} s`,
    formatTemperature: (value: number) => `${value} C`,
    formatEnergy: (value: number) => `${value} Wh`,
    formatSpeed: (value: number) => `${value} m/s`,
    unitPrefs: { distance: 'km' },
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/ui', () => ({
  GlassPanel: ({ children, ...props }: { children: ReactNode }) => <section {...props}>{children}</section>,
  Badge: ({ children, className }: { children: ReactNode; className?: string }) => <span className={className}>{children}</span>,
  MetricLabel: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  MetricValue: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  PanelTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Text: ({ children, className }: { children: ReactNode; className?: string }) => <span className={className}>{children}</span>,
  HelpTooltip: () => null,
  Select: ({
    'aria-label': ariaLabel,
    label,
    value,
    onChange,
    options,
    hint,
  }: {
    'aria-label': string;
    label?: string;
    value: string;
    onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
    options: Array<{ value: string; label: string; disabled?: boolean }>;
    hint?: string;
  }) => (
    <div>
      <label>
        {label}
        <select aria-label={ariaLabel} value={value} onChange={onChange}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
          ))}
        </select>
      </label>
      {hint && <p>{hint}</p>}
    </div>
  ),
}));

vi.mock('@/components/layout', () => ({
  PageLayout: ({
    title,
    subtitle,
    contextActions,
    children,
  }: {
    title: string;
    subtitle: string;
    contextActions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {contextActions}
      {children}
    </main>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

vi.mock('../components/drive-compare', () => {
  type State = { isLoading: boolean; error: unknown; emptyMessage: string | null };
  const status = (state: State) =>
    state.error ? 'error' : state.isLoading ? 'loading' : state.emptyMessage ?? 'ready';
  return {
    ComparisonVerdict: ({ state }: { state: State }) => (
      <section data-testid="compare-verdict">{status(state)}</section>
    ),
    AdvantageBreakdown: ({ state }: { state: State }) => (
      <section data-testid="compare-breakdown">{status(state)}</section>
    ),
    DriveIdentityCard: ({ side, state }: { side: string; state: State }) => (
      <section data-testid={`compare-identity-${side}`}>{status(state)}</section>
    ),
    SpeedComparisonChart: ({ state }: { state: State }) => (
      <section data-testid="compare-speed">{status(state)}</section>
    ),
    BatteryComparisonChart: ({ state }: { state: State }) => (
      <section data-testid="compare-battery">{status(state)}</section>
    ),
    HeadToHeadGrid: ({ state }: { state: State }) => (
      <section data-testid="compare-grid">{status(state)}</section>
    ),
  };
});

vi.mock('../components/operationalbrief-a-m/CompareVerdictBrief', async () => ({
  CompareVerdictBrief: (await import('../components/drive-compare')).ComparisonVerdict,
}));

import DriveComparePage from './DriveComparePage';

function LocationEvidence() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPage(initialEntry = '/drive-compare') {
  const workspace = () => (
    <MemoryRouter initialEntries={[initialEntry]}>
      <DriveComparePage />
      <LocationEvidence />
    </MemoryRouter>,
  );
  const result = render(workspace());
  return { ...result, rerenderPage: () => result.rerender(workspace()) };
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function detail(id: number): DriveDetail {
  return {
    id,
    vehicleId: 42,
    startTs: `2026-08-0${id}T08:00:00Z`,
    endTs: `2026-08-0${id}T08:30:00Z`,
    durationS: 1_800,
    distanceM: id * 10_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2_000,
    regenEnergyWh: 400,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: 20,
    insideTempAvgC: null,
    score: 80,
    endedStatus: 'completed',
    createdAt: '',
    updatedAt: '',
    telemetry: [],
    positions: [],
  };
}

const driveA = detail(1);
const driveB = detail(2);
const SECTION_IDS = [
  'compare-verdict',
  'compare-breakdown',
  'compare-identity-a',
  'compare-identity-b',
  'compare-speed',
  'compare-battery',
  'compare-grid',
];

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  settingsMock.mockReturnValue({ settings: { tz_display_default: 'user' }, locale: 'en-US' });
  timezoneMock.mockReturnValue('UTC');
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query({ data: [driveA, driveB] }));
  useDriveMock.mockImplementation((id: string) =>
    query({ data: id === '1' ? driveA : driveB }));
});

describe('DriveComparePage', () => {
  it('keeps every identity field and the complete route readable without a disclosure', () => {
    const drive = {
      ...driveA,
      startAddress: 'A very long starting address with complete building and street information',
      endAddress: 'A very long destination address with complete building and street information',
    };
    render(<DriveIdentityCard side="a" drive={drive} state={{
      isLoading: false, error: null, emptyMessage: null, onRetry: vi.fn(),
    }} />);
    const card = screen.getByTestId('drive-compare-identity-a');
    for (const [label, value] of [
      ['Distance', '10000 m'],
      ['Duration', '1800 s'],
      ['Battery', '80.00% → 70.00%'],
      ['Conditions', '20 C · Completed'],
    ]) {
      const field = within(card).getByText(label).parentElement;
      expect(field).toHaveTextContent(value);
      expect(within(field!).getByText(value)).toHaveClass('whitespace-normal', 'break-words');
      expect(field?.parentElement).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
    }
    const route = within(card).getByText(`${drive.startAddress} → ${drive.endAddress}`);
    expect(route.parentElement).toHaveClass('[&>span]:whitespace-normal', '[&>span]:overflow-visible');
    expect(card.querySelector('button, [role="button"]')).toBeNull();
  });

  it('wraps complete advantage explanations and keeps winner, tie and unavailable outcomes', () => {
    const rows = compareDrives(driveA, { ...driveB, score: null });
    render(<AdvantageBreakdown rows={rows} summary={summarizeComparison(rows)} state={{
      isLoading: false, error: null, emptyMessage: null, onRetry: vi.fn(),
    }} />);
    const panel = screen.getByTestId('drive-compare-breakdown');
    for (const explanation of [
      '100.00 Wh/km edge',
      'No measurable edge',
      'Needs valid data from both drives',
      'Regen is scored only on trips of at least 1 km; total energy and battery drop never award a winner.',
    ]) {
      expect(within(panel).getByText(explanation)).toHaveClass('whitespace-normal', 'break-words');
    }
    for (const outcome of ['Drive B', 'Even', 'Not comparable']) {
      const badge = within(panel).getByText(outcome);
      expect(badge).toHaveClass('max-w-full', 'whitespace-normal', 'break-words');
      expect(badge.parentElement).toHaveClass('flex-col', 'sm:flex-row', 'sm:flex-wrap');
    }
    expect(panel).toHaveTextContent('2 of 3 fair metrics have data on both drives.');
    expect(panel.querySelector('button, [role="button"]')).toBeNull();
  });

  it.each([
    { name: 'missing endpoints', start: undefined, end: null, expected: '— → —' },
    { name: 'invalid endpoints', start: NaN, end: Infinity, expected: '— → —' },
    { name: 'invalid start with measured zero', start: -Infinity, end: 0, expected: '— → 0.00%' },
    { name: 'invalid end with measured zero', start: 0, end: NaN, expected: '0.00% → —' },
    { name: 'missing start with known end', start: null, end: 70.5, expected: '— → 70.50%' },
    { name: 'measured zero with missing end', start: 0, end: undefined, expected: '0.00% → —' },
    { name: 'both measured zero endpoints', start: 0, end: 0, expected: '0.00% → 0.00%' },
    { name: 'signed fractional endpoints', start: -1.25, end: 2.75, expected: '-1.25% → 2.75%' },
    { name: 'decreasing fractional endpoints', start: 80.125, end: 70.625, expected: '80.13% → 70.63%' },
  ])('preserves battery endpoint identity and direction for $name', ({ start, end, expected }) => {
    const drive = { ...driveA };
    Reflect.set(drive, 'startBatteryPct', start);
    Reflect.set(drive, 'endBatteryPct', end);
    render(<DriveIdentityCard side="a" drive={drive} state={{
      isLoading: false, error: null, emptyMessage: null, onRetry: vi.fn(),
    }} />);

    const battery = within(screen.getByTestId('drive-compare-identity-a')).getByText('Battery').parentElement;
    expect(battery).toHaveTextContent(expected);
    expect(drive.startBatteryPct).toBe(start);
    expect(drive.endBatteryPct).toBe(end);
  });

  it('updates both battery endpoints with number formatting preferences without changing source measurements', () => {
    const drive = { ...driveB, startBatteryPct: 80.125, endBatteryPct: -0.625 };
    render(<DriveIdentityCard side="b" drive={drive} state={{
      isLoading: false, error: null, emptyMessage: null, onRetry: vi.fn(),
    }} />);
    const battery = within(screen.getByTestId('drive-compare-identity-b')).getByText('Battery').parentElement;
    expect(battery).toHaveTextContent('80.13% → -0.63%');

    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(3);
    });
    expect(battery).toHaveTextContent('80,125% → -0,625%');
    expect(drive.startBatteryPct).toBe(80.125);
    expect(drive.endBatteryPct).toBe(-0.625);
  });

  it('refreshes memoized option dates on locale and timezone changes without changing either selection or timestamps', () => {
    const lateDrive = { ...driveA, startTs: '2026-08-01T00:30:00Z' };
    useDrivesMock.mockReturnValue(query({ data: [lateDrive, driveB] }));
    const { rerenderPage } = renderPage('/drive-compare?drive_a=2&drive_b=1&origin=history');
    const expectDates = (locale: string, tz: string) => {
      for (const label of ['Choose drive A', 'Choose drive B']) {
        const selector = screen.getByRole('combobox', { name: label });
        expect(within(selector).getByRole('option', {
          name: `${formatDateShort(lateDrive.startTs, { locale, tz })} · 10000 m`,
        })).toHaveValue('1');
      }
      expect(screen.getByLabelText('Choose drive A')).toHaveValue('2');
      expect(screen.getByLabelText('Choose drive B')).toHaveValue('1');
      expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=2&drive_b=1&origin=history');
    };
    expectDates('en-US', 'UTC');
    timezoneMock.mockReturnValue('America/Los_Angeles');
    rerenderPage();
    expectDates('en-US', 'America/Los_Angeles');
    settingsMock.mockReturnValue({ settings: { tz_display_default: 'user' }, locale: 'de-DE' });
    rerenderPage();
    expectDates('de-DE', 'America/Los_Angeles');
    expect(lateDrive.startTs).toBe('2026-08-01T00:30:00Z');
    expect(driveB.startTs).toBe('2026-08-02T08:00:00Z');
  });

  it('updates populated identity dates, end times and head-to-head headers with display preferences', () => {
    const earlyDrive = { ...driveA, startTs: '2026-08-01T00:30:00Z', endTs: '2026-08-01T01:00:00Z' };
    const state = { isLoading: false, error: null, emptyMessage: null, onRetry: vi.fn() };
    const workspace = () => (
      <>
        <DriveIdentityCard side="a" drive={earlyDrive} state={state} />
        <DriveIdentityCard side="b" drive={driveB} state={state} />
        <HeadToHeadGrid rows={compareDrives(earlyDrive, driveB)} startA={earlyDrive.startTs} startB={driveB.startTs} state={state} />
      </>
    );
    const { rerender } = render(workspace());
    const expectDates = (locale: string, tz: string) => {
      const opts = { locale, tz };
      for (const [side, drive] of [['a', earlyDrive], ['b', driveB]] as const) {
        expect(screen.getByTestId(`drive-compare-identity-${side}`)).toHaveTextContent(
          `${formatDateTime(drive.startTs, opts)} – ${formatTime(drive.endTs, opts)}`,
        );
        expect(screen.getByTestId('drive-compare-grid')).toHaveTextContent(formatDateShort(drive.startTs, opts));
      }
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getAllByRole('rowheader')).toHaveLength(10);
    };
    expectDates('en-US', 'UTC');
    timezoneMock.mockReturnValue('America/Los_Angeles');
    rerender(workspace());
    expectDates('en-US', 'America/Los_Angeles');
    settingsMock.mockReturnValue({ settings: { tz_display_default: 'user' }, locale: 'de-DE' });
    rerender(workspace());
    expectDates('de-DE', 'America/Los_Angeles');
    expect(earlyDrive.startTs).toBe('2026-08-01T00:30:00Z');
    expect(earlyDrive.endTs).toBe('2026-08-01T01:00:00Z');
  });

  it('retains requested IDs while history loads and resolves them without substitution', () => {
    useDrivesMock.mockReturnValue(query());
    useDriveMock.mockImplementation((id: string) =>
      query({ data: id === '1' ? driveA : id === '2' ? driveB : undefined }));
    const { rerenderPage } = renderPage('/drive-compare?drive_a=2&drive_b=1&origin=history');

    expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=2&drive_b=1&origin=history');
    expect(screen.getByLabelText('Choose drive A')).toHaveValue('2');
    expect(screen.getByLabelText('Choose drive B')).toHaveValue('1');
    expect(useDriveMock.mock.calls.every(([id]) => id === '')).toBe(true);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('loading');

    useDrivesMock.mockReturnValue(query({ data: [driveA, driveB] }));
    rerenderPage();

    expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=2&drive_b=1&origin=history');
    expect(useDriveMock).toHaveBeenCalledWith('2');
    expect(useDriveMock).toHaveBeenCalledWith('1');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
  });

  it.each(['drive_a', 'drive_b'] as const)(
    'explains an unavailable %s and replaces it only on deliberate selection',
    (key) => {
      renderPage(`/drive-compare?drive_a=${key === 'drive_a' ? '999' : '1'}&drive_b=${key === 'drive_b' ? '999' : '2'}&origin=history`);
      const selector = screen.getByLabelText(key === 'drive_a' ? 'Choose drive A' : 'Choose drive B');
      expect(selector).toHaveValue('999');
      expect(screen.getByTestId('location')).toHaveTextContent(`${key}=999`);
      expect(useDriveMock).not.toHaveBeenCalledWith('999');
      expect(screen.getByTestId('compare-grid')).toHaveTextContent(
        "The requested drive is unavailable in this vehicle's loaded history window. Choose a drive to replace it.",
      );
      expect(screen.getByTestId(key === 'drive_a' ? 'compare-identity-b' : 'compare-identity-a')).toHaveTextContent('ready');

      fireEvent.change(selector, { target: { value: key === 'drive_a' ? '1' : '2' } });
      expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=1&drive_b=2&origin=history');
      for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    },
  );

  it('defaults only the absent selection and retains it if the history window changes', () => {
    const { rerenderPage } = renderPage('/drive-compare?drive_a=999&origin=history');
    expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=999&origin=history&drive_b=1');
    expect(useDriveMock).not.toHaveBeenCalledWith('999');

    useDrivesMock.mockReturnValue(query({ data: [driveB] }));
    useDriveMock.mockClear();
    rerenderPage();
    expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=999&origin=history&drive_b=1');
    expect(screen.getByLabelText('Choose drive B')).toHaveValue('1');
    expect(useDriveMock.mock.calls.every(([id]) => id === '')).toBe(true);
  });

  it('retains unavailable selections when history is empty, without fetching arbitrary identities', () => {
    useDrivesMock.mockReturnValue(query({ data: [] }));
    renderPage('/drive-compare?drive_a=999&drive_b=998');
    expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=999&drive_b=998');
    expect(screen.getByLabelText('Choose drive A')).toHaveValue('999');
    expect(screen.getByLabelText('Choose drive B')).toHaveValue('998');
    expect(useDriveMock.mock.calls.every(([id]) => id === '')).toBe(true);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('unavailable');
  });

  it('shows distinct visible labels in a bounded stacked mobile selector layout', () => {
    renderPage('/drive-compare?drive_a=2&drive_b=1');

    const labelA = screen.getByText('Choose drive A', { selector: 'label' });
    const labelB = screen.getByText('Choose drive B', { selector: 'label' });
    expect(labelA).toContainElement(screen.getByRole('combobox', { name: 'Choose drive A' }));
    expect(labelB).toContainElement(screen.getByRole('combobox', { name: 'Choose drive B' }));
    expect(labelA.parentElement?.parentElement).toHaveClass(
      'grid', 'w-full', 'min-w-0', 'max-w-full', 'grid-cols-1', 'sm:grid-cols-2',
    );
    expect(screen.getByLabelText('Choose drive A')).toHaveValue('2');
    expect(screen.getByLabelText('Choose drive B')).toHaveValue('1');
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
  });

  it('keeps independent selections, unrelated deep-link state and raw SI option values', () => {
    renderPage('/drive-compare?drive_a=2&drive_b=1&origin=history');

    expect(screen.getAllByRole('option', { name: /20000 m$/ })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Choose drive A'), { target: { value: '1' } });
    expect(screen.getByLabelText('Choose drive B')).toHaveValue('1');
    expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=1&drive_b=1&origin=history');
    fireEvent.change(screen.getByLabelText('Choose drive B'), { target: { value: '2' } });
    expect(screen.getByLabelText('Choose drive A')).toHaveValue('1');
    expect(screen.getByTestId('location')).toHaveTextContent('?drive_a=1&drive_b=2&origin=history');
    expect(useDrivesMock).toHaveBeenCalledWith('42', { limit: 1000 });
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(driveA.distanceM).toBe(10_000);
    expect(driveB.distanceM).toBe(20_000);
  });

  it('retains both identities and the complete comparison when all three sources fail to refresh', () => {
    useDrivesMock.mockReturnValue(query({
      data: [driveA, driveB], isError: true, error: new Error('list refresh failed'),
    }));
    useDriveMock.mockImplementation((id: string) => query({
      data: id === '1' ? driveA : driveB,
      isError: true,
      error: new Error(`${id} refresh failed`),
    }));
    renderPage('/drive-compare?drive_a=2&drive_b=1');
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByLabelText('Choose drive A')).toHaveValue('2');
    expect(screen.getByLabelText('Choose drive B')).toHaveValue('1');
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(3);
  });

  it('keeps a retained A identity usable while B fails initially', () => {
    useDriveMock.mockImplementation((id: string) =>
      id === '1' ? query({ data: driveA, isError: true, error: new Error('A refresh failed') })
        : query({ isError: true, error: new Error('B initial failed') }));
    renderPage();
    expect(screen.getByTestId('compare-identity-a')).toHaveTextContent('ready');
    expect(screen.getByTestId('compare-identity-b')).toHaveTextContent('error');
    expect(screen.getByTestId('compare-grid')).toHaveTextContent('error');
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
  });

  it('mounts the complete workspace and requests the API maximum history', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Drive Compare' })).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', { limit: 1000 });
    expect(useDriveMock).toHaveBeenCalledWith('1');
    expect(useDriveMock).toHaveBeenCalledWith('2');
  });

  it('initializes both detail queries from list preselection parameters', () => {
    renderPage('/drive-compare?drive_a=2&drive_b=1');

    expect(useDriveMock).toHaveBeenCalledWith('2');
    expect(useDriveMock).toHaveBeenCalledWith('1');
    expect(screen.getByLabelText('Choose drive A')).toHaveValue('2');
    expect(screen.getByLabelText('Choose drive B')).toHaveValue('1');
  });

  it('surfaces a detail-query error instead of leaving comparison sections loading', () => {
    useDriveMock.mockImplementation((id: string) =>
      id === '1'
        ? query({ isError: true, error: new Error('detail failed') })
        : query({ data: driveB }));

    renderPage();

    expect(screen.getByTestId('compare-identity-a')).toHaveTextContent('error');
    expect(screen.getByTestId('compare-identity-b')).toHaveTextContent('ready');
    for (const id of ['compare-verdict', 'compare-breakdown', 'compare-speed', 'compare-battery', 'compare-grid']) {
      expect(screen.getByTestId(id)).toHaveTextContent('error');
      expect(screen.getByTestId(id)).not.toHaveTextContent('loading');
    }
  });

  it('keeps every section mounted with clear recovery copy for the same drive', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Choose drive B'), { target: { value: '1' } });

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(
        'Pick two different drives with the A and B selectors above to continue.',
      );
    }
  });

  it('threads a list-query error to every mounted section', () => {
    useDrivesMock.mockReturnValue(query({ isError: true, error: new Error('list failed') }));
    useDriveMock.mockReturnValue(query());

    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('error');
    }
  });

  it('preserves the no-vehicle recovery state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });

    renderPage();

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Drive Compare');
    expect(screen.queryByTestId('compare-verdict')).not.toBeInTheDocument();
  });
});
