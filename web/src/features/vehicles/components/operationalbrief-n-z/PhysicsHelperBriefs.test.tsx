import type { ComponentType } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExclusiveReport } from '@/types/teslaPhysics';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { formatDateTime } from '@/lib/dateFormat';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { PhysicsPageShell, usePhysicsPage, type PhysicsPage, type PhysicsSlug } from '../tesla-physics/PhysicsPageShell';
import { PhysicsInvestigation } from '../tesla-physics/PhysicsInvestigation';
import PhysicsClocksSection from '../tesla-physics/PhysicsClocksSection';
import PhysicsLifeTapeSection from '../tesla-physics/PhysicsLifeTapeSection';
import PhysicsContradictionsSection from '../tesla-physics/PhysicsContradictionsSection';
import PhysicsMetersSection from '../tesla-physics/PhysicsMetersSection';
import PhysicsUnknownSection from '../tesla-physics/PhysicsUnknownSection';
import PhysicsCarKeptLivingSection from '../tesla-physics/PhysicsCarKeptLivingSection';
import PhysicsLogbookSection from '../tesla-physics/PhysicsLogbookSection';
import PhysicsFirmwareEpochsSection from '../tesla-physics/PhysicsFirmwareEpochsSection';
import PhysicsChargePortSection from '../tesla-physics/PhysicsChargePortSection';
import PhysicsBlackBoxSection from '../tesla-physics/PhysicsBlackBoxSection';
import PhysicsDictionarySection from '../tesla-physics/PhysicsDictionarySection';
import PhysicsVaultSection from '../tesla-physics/PhysicsVaultSection';
import PhysicsModesSection from '../tesla-physics/PhysicsModesSection';
import PhysicsNervousSystemSection from '../tesla-physics/PhysicsNervousSystemSection';
import PhysicsRangeSection from '../tesla-physics/PhysicsRangeSection';
import { RawRows } from '../tesla-physics/Evidence';

const source = vi.hoisted((): { report: Partial<ExclusiveReport> | undefined; error: Error | null; loading: boolean; paused: boolean; refetch: ReturnType<typeof vi.fn> } => ({
  report: undefined,
  error: null,
  loading: false,
  paused: false,
  refetch: vi.fn(),
}));
const datePreferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC', distance: 'km' }));
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => datePreferences.tz,
}));
vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...original, useSettings: () => {
    return { locale: datePreferences.locale, decimals: 2, density: 'comfortable', rangeType: 'rated', settings: {
      unit_of_temp: 'C', unit_of_pressure: 'bar', decimal_precision: 2, currency_symbol: '$',
      locale: datePreferences.locale, tz_display_default: 'user', timezone_user: datePreferences.tz, unit_of_length: datePreferences.distance,
    } };
  } };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useTeslaExclusive: () => ({
    data: source.report, error: source.error, isError: source.error != null,
    isLoading: source.loading, isPending: source.loading, isFetching: source.loading && !source.paused,
    isSuccess: source.report != null, fetchStatus: source.paused ? 'paused' : source.loading ? 'fetching' : 'idle', dataUpdatedAt: 1790812800000,
    refetch: source.refetch,
  }),
}));

const start = '2026-10-01T00:00:00Z';
const end = '2026-10-01T01:00:00Z';
const boundedReport: Partial<ExclusiveReport> = {
  vehicle_id: 7,
  evidence: {
    requested_from: start, requested_to: end, first_recorded_at: start, last_recorded_at: end,
    history_rows: 0, black_box_rows: 0, history_truncated: false, black_box_truncated: false,
    drive_sessions_truncated: false, charge_sessions_truncated: false,
    history_available: true, black_box_available: true,
  },
};

function Harness({ Component }: { Component: ComponentType<{ physics: PhysicsPage }> }) {
  const physics = usePhysicsPage();
  return <Component physics={physics} />;
}

function renderSection(Component: ComponentType<{ physics: PhysicsPage }>) {
  return render(<MemoryRouter><Harness Component={Component} /></MemoryRouter>);
}

function metric(briefId: string, metricId: string) {
  const found = screen.getByTestId(briefId).querySelector(`[data-operational-metric="${metricId}"]`);
  if (!found) throw new Error(`Missing metric ${briefId}/${metricId}`);
  return found;
}

function faceValue(briefId: string, metricId: string) {
  const value = metric(briefId, metricId).querySelector('[data-operational-value]');
  if (!value) throw new Error(`Missing face value ${briefId}/${metricId}`);
  return value;
}

function drawerGroup(briefId: string, label: string) {
  fireEvent.click(within(screen.getByTestId(briefId)).getByRole('button', { name: 'Review details' }));
  const drawer = screen.getByRole('dialog');
  return { drawer, group: within(drawer).getByRole('group', { name: label }) };
}

function closeDrawer(drawer: HTMLElement) {
  fireEvent.keyDown(drawer, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

beforeEach(() => {
  Object.assign(datePreferences, { locale: 'en-US', tz: 'UTC', distance: 'km' });
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  source.report = boundedReport;
  source.error = null;
  source.loading = false;
  source.paused = false;
  source.refetch.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

function ShellHarness({ slug }: { slug?: PhysicsSlug }) {
  const physics = usePhysicsPage(slug);
  return <PhysicsPageShell physics={physics} navigation={<span>Investigation navigation</span>}>
    <span>Independent overview</span>
    {slug ? <PhysicsInvestigation slug={slug} physics={physics} /> : <PhysicsLifeTapeSection physics={physics} />}
  </PhysicsPageShell>;
}

describe('Tesla physics shell source lifecycle', () => {
  it('replaces only the missing active investigation and retains independent overview and source boundaries', () => {
    render(<MemoryRouter><ShellHarness slug="life-tape" /></MemoryRouter>);
    expect(screen.getByText('This evidence slice was not returned. No measurement is inferred from its absence.')).toBeInTheDocument();
    expect(screen.getByText('Independent overview')).toBeInTheDocument();
    expect(screen.getByText('Investigation navigation')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence boundaries' })).toBeInTheDocument();
    expect(metric('physics-evidence-boundaries', 'history')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-evidence-boundaries', 'history')).toHaveTextContent('0');
    expect(screen.queryByTestId('physics-life-summary')).toBeNull();
  });

  it('keeps navigation and evidence-shaped loading without inferred readings or vehicle-selection feedback', () => {
    source.report = undefined;
    source.loading = true;
    render(<MemoryRouter><ShellHarness /></MemoryRouter>);
    expect(screen.getByRole('status', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: 'Evidence boundaries' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where to start' })).toBeInTheDocument();
    expect(screen.getByText('Investigation navigation')).toBeInTheDocument();
    expect(screen.queryByText('Select a vehicle to load Tesla physics.')).toBeNull();
    expect(screen.queryByTestId('physics-life-summary')).toBeNull();
  });

  it('treats an initial pause as neutral unresolved source rather than loading, empty success or offline failure', () => {
    source.report = undefined;
    source.loading = true;
    source.paused = true;
    render(<MemoryRouter><ShellHarness /></MemoryRouter>);
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading…' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/offline|Select a vehicle to load Tesla physics/)).toBeNull();
    expect(screen.queryByTestId('physics-life-summary')).toBeNull();
  });

  it('retries fatal loads and recovers to successful zero evidence and empty intervals', () => {
    source.report = undefined;
    source.error = new Error('Initial report failed');
    const view = render(<MemoryRouter><ShellHarness /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(source.refetch).toHaveBeenCalledTimes(1);
    source.error = null;
    source.report = { ...boundedReport, life_tape: {
      vehicle_id: 7, from: start, to: end, segments: [], honesty: 'Returned intervals only.',
    } };
    view.rerender(<MemoryRouter><ShellHarness /></MemoryRouter>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(metric('physics-evidence-boundaries', 'history')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-evidence-boundaries', 'history')).toHaveTextContent('0');
    expect(faceValue('physics-life-summary', 'segments')).toHaveTextContent('0');
    const recovered = drawerGroup('physics-life-summary', 'Classified intervals');
    expect(recovered.group).toHaveTextContent('0 classified intervals');
    closeDrawer(recovered.drawer);
    expect(screen.queryByRole('status', { name: 'Loading…' })).toBeNull();
  });

  it('retains readings during refresh failure and in-flight recovery, then clears the warning', () => {
    source.report = { ...boundedReport, life_tape: {
      vehicle_id: 7, from: start, to: end, segments: [], honesty: 'Returned intervals only.',
    } };
    const view = render(<MemoryRouter><ShellHarness /></MemoryRouter>);
    source.error = new Error('Refresh report failed');
    view.rerender(<MemoryRouter><ShellHarness /></MemoryRouter>);
    assertOperationalBriefDisclosure(screen.getByTestId('physics-life-summary'), 'Retained after refresh failure');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(source.refetch).toHaveBeenCalledTimes(1);
    source.loading = true;
    view.rerender(<MemoryRouter><ShellHarness /></MemoryRouter>);
    expect(faceValue('physics-life-summary', 'segments')).toHaveTextContent('0');
    expect(screen.queryByRole('status', { name: 'Loading…' })).toBeNull();
    source.error = null;
    source.loading = false;
    view.rerender(<MemoryRouter><ShellHarness /></MemoryRouter>);
    assertOperationalBriefDisclosure(screen.getByTestId('physics-life-summary'), 'Retained after refresh failure', { absent: true });
    expect(faceValue('physics-life-summary', 'segments')).toHaveTextContent('0');
  });
});

describe('Tesla physics nested summary adoption', () => {
  it('keeps every raw field accessible through the existing row expansion', async () => {
    const user = userEvent.setup();
    render(<RawRows title="Evidence" tableId="test:physics-raw-details" t={(_key, fallback) => fallback}
      rows={[{ id: 'sample', visible: 'Returned value', hidden: 'Full evidence' }]}
      keyExtractor={row => row.id} mobileColumns={['visible']}
      columns={[
        { key: 'visible', header: 'Visible field', render: row => row.visible },
        { key: 'hidden', header: 'Additional field', render: row => row.hidden, defaultVisible: false },
      ]} />);
    await user.click(screen.getByRole('button', { name: /Inspect raw evidence/ }));
    const expand = screen.getByRole('button', { name: /Expand row/ });
    expand.focus();
    await user.keyboard('{Enter}');
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Additional field', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('Full evidence', { selector: 'dd' })).toBeInTheDocument();
    await user.keyboard(' ');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Full evidence', { selector: 'dd' })).toBeNull();
  });

  it('opens all six clock fields by keyboard on narrow containers and preserves desktop cells', async () => {
    const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.push({ element, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
    const resize = (width: number) => act(() => observers.forEach(({ element, callback }) => callback(
      [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
    )));
    const row = { event_time: start, ingest_time: null, display_time: end, gap_s: 0, unknown: true };
    source.report = { ...boundedReport, clocks: { vehicle_id: 7, latest: row, samples: [row], honesty: 'Returned clocks only.' } };
    const user = userEvent.setup();
    renderSection(PhysicsClocksSection);
    resize(375);
    expect(document.querySelector('[data-mobile-table]')).not.toBeNull();
    const quickView = screen.getByRole('button', { name: 'Quick view' });
    quickView.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    for (const label of ['Event time', 'Ingest time', 'Stored ingest lag', 'Elapsed since prior event', 'Display time', 'Unknown flag']) {
      expect(within(dialog).getByText(label, { selector: 'dt' })).toBeInTheDocument();
    }
    expect(within(dialog).getAllByText('unknown', { selector: 'dd' })).toHaveLength(2);
    expect(within(dialog).getByText(/^0(?:\.0+)? s$/, { selector: 'dd' })).toBeInTheDocument();
    expect(within(dialog).getByText('Yes', { selector: 'dd' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(quickView).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /Inspect raw evidence/ }));
    resize(375);
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Quick view' })[1]);
    expect(within(screen.getByRole('dialog')).getByText('Unknown flag', { selector: 'dt' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    resize(1280);
    expect(document.querySelector('[data-mobile-table]')).toBeNull();
    expect(screen.getAllByRole('columnheader', { name: 'Ingest time' })).toHaveLength(2);
    expect(screen.getAllByRole('columnheader', { name: 'Display time' })).toHaveLength(2);
  });

  it('updates range efficiency and caption with distance, locale and precision without changing source readings', () => {
    const range = {
      vehicle_id: 7, rated_range_m: 400000, est_range_m: 360000, ideal_range_m: 450000,
      energy_remaining_wh: 62000, recent_wh_per_km: 187.4568, disagree: true,
      true_range_m: null, honesty: 'Never pick a true range.',
    };
    source.report = { ...boundedReport, range };
    const view = renderSection(PhysicsRangeSection);
    expect(metric('physics-range-summary', 'recent-efficiency')).toHaveTextContent('187.46 Wh/km');
    expect(screen.getByText('No true range. Recent Wh/km: 187.46')).toBeInTheDocument();
    Object.assign(datePreferences, { distance: 'mi' });
    view.rerender(<MemoryRouter><Harness Component={PhysicsRangeSection} /></MemoryRouter>);
    expect(metric('physics-range-summary', 'recent-efficiency')).toHaveTextContent('301.68 Wh/mi');
    expect(screen.getByText('No true range. Recent Wh/mi: 301.68')).toBeInTheDocument();
    act(() => { setGlobalLocale('de-DE'); setGlobalPrecision(1); });
    view.rerender(<MemoryRouter><Harness Component={PhysicsRangeSection} /></MemoryRouter>);
    expect(metric('physics-range-summary', 'recent-efficiency')).toHaveTextContent('301,7 Wh/mi');
    expect(screen.getByText('No true range. Recent Wh/mi: 301,7')).toBeInTheDocument();
    expect(range.recent_wh_per_km).toBe(187.4568);
    expect(range.rated_range_m).toBe(400000);
    expect(range.energy_remaining_wh).toBe(62000);
    expect(range.true_range_m).toBeNull();
  });

  it.each([null, 0])('keeps missing versus zero range efficiency explicit in mile captions (%s)', (recent) => {
    datePreferences.distance = 'mi';
    source.report = { ...boundedReport, range: {
      vehicle_id: 7, rated_range_m: 400000, est_range_m: 360000, ideal_range_m: 450000,
      energy_remaining_wh: 62000, recent_wh_per_km: recent, disagree: true,
      true_range_m: null, honesty: 'Never pick a true range.',
    } };
    renderSection(PhysicsRangeSection);
    if (recent == null) assertOperationalMetricUnavailable(screen.getByTestId('physics-range-summary'), 'Recent Wh/mi');
    else expect(metric('physics-range-summary', 'recent-efficiency')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByText(`No true range. Recent Wh/mi: ${recent == null ? 'unknown' : '0.00'}`)).toBeInTheDocument();
  });

  it.each([
    [null, 'missing'], [undefined, 'missing'], [NaN, 'invalid'],
    [Infinity, 'invalid'], [-Infinity, 'invalid'],
  ] as const)('excludes unavailable range estimates (%s) without inventing equality', (rated, _state) => {
    const range = {
      vehicle_id: 7, rated_range_m: rated ?? null, est_range_m: 0, ideal_range_m: null,
      energy_remaining_wh: null, recent_wh_per_km: null, disagree: false,
      true_range_m: null, honesty: 'Returned estimates only.',
    };
    Object.assign(range, { rated_range_m: rated });
    source.report = { ...boundedReport, range };
    renderSection(PhysicsRangeSection);
    assertOperationalMetricUnavailable(screen.getByTestId('physics-range-summary'), 'Rated');
    expect(metric('physics-range-summary', 'typical')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-range-summary', 'known')).toHaveTextContent('1');
    assertOperationalMetricUnavailable(screen.getByTestId('physics-range-summary'), 'Estimate spread');
    assertOperationalMetricUnavailable(screen.getByTestId('physics-range-summary'), 'Spread versus rated');
    expect(screen.getByText(/At least two estimates are needed/)).toBeInTheDocument();
    expect(screen.queryByText(/are equal in the returned estimates|is higher in the returned estimates/)).toBeNull();
  });

  it.each([
    [0, 0, 'Rated and Typical are equal in the returned estimates', 'unknown'],
    [1000.25, 1000.25, 'Rated and Typical are equal in the returned estimates', '0.00%'],
    [-1000.25, -1000.25, 'Rated and Typical are equal in the returned estimates', 'unknown'],
    [1000.25, 1000.125, 'Rated is higher in the returned estimates', '0.01%'],
    [1000.125, 1000.25, 'Typical is higher in the returned estimates', '0.01%'],
    [-1000.25, -1000.125, 'Typical is higher in the returned estimates', 'unknown'],
    [0, -0.125, 'Rated is higher in the returned estimates', 'unknown'],
  ])('compares raw signed and fractional ranges (%s, %s)', (rated, typical, direction, relative) => {
    const range = {
      vehicle_id: 7, rated_range_m: rated, est_range_m: typical, ideal_range_m: null,
      energy_remaining_wh: null, recent_wh_per_km: null, disagree: rated !== typical,
      true_range_m: null, honesty: 'Returned estimates only.',
    };
    source.report = { ...boundedReport, range };
    renderSection(PhysicsRangeSection);
    expect(screen.getByText(direction)).toBeInTheDocument();
    expect(screen.getByText(`Difference relative to Rated: ${relative}`)).toBeInTheDocument();
    expect(metric('physics-range-summary', 'rated')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-range-summary', 'spread')).toHaveAttribute('data-value-state', 'value');
    if (rated === typical) expect(screen.queryByText(/is higher in the returned estimates/)).toBeNull();
    else expect(screen.queryByText(/are equal in the returned estimates/)).toBeNull();
    expect(range.rated_range_m).toBe(rated);
    expect(range.est_range_m).toBe(typical);
    expect(range.true_range_m).toBeNull();
  });

  it('updates clock seconds, signed durations, scope and freshness with display preferences', () => {
    const event = '2026-10-01T00:00:17Z';
    const ingest = '2026-10-01T00:00:15.5Z';
    source.report = { ...boundedReport, clocks: {
      vehicle_id: 7, latest: { event_time: event, ingest_time: ingest, display_time: end, gap_s: 1234.5, unknown: false },
      samples: [{ event_time: event, ingest_time: ingest, display_time: end, gap_s: 1234.5, unknown: false }],
      honesty: 'Paired readings only.',
    } };
    const view = renderSection(PhysicsClocksSection);
    const clockLabel = (value: string) => formatDateTime(value, {
      locale: datePreferences.locale, tz: datePreferences.tz, clock: { second: '2-digit' },
    });
    expect(screen.getByRole('cell', { name: clockLabel(event) })).toBeInTheDocument();
    Object.assign(datePreferences, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    act(() => { setGlobalLocale('de-DE'); setGlobalPrecision(1); });
    view.rerender(<MemoryRouter><Harness Component={PhysicsClocksSection} /></MemoryRouter>);
    expect(screen.getByRole('cell', { name: clockLabel(event) })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: clockLabel(ingest) })).toBeInTheDocument();
    expect(metric('physics-clocks-summary', 'event')).toHaveTextContent(clockLabel(event));
    expect(metric('physics-clocks-summary', 'median-lag')).toHaveTextContent('-1,5 s');
    expect(metric('physics-clocks-summary', 'max-gap')).toHaveTextContent('1.234,5 s');
    expect(screen.getByRole('cell', { name: '1.234,5 s' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('physics-clocks-summary')).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    const opts = { locale: datePreferences.locale, tz: datePreferences.tz };
    expect(within(drawer).getAllByText(`Requested: ${formatDateTime(start, opts)} → ${formatDateTime(end, opts)}`).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(`Report received ${formatDateTime(new Date(1790812800000), opts)}`).length).toBeGreaterThan(0);
  });

  const sections = [
    ['clocks', PhysicsClocksSection], ['life', PhysicsLifeTapeSection],
    ['contradictions', PhysicsContradictionsSection], ['meters', PhysicsMetersSection],
    ['unknown', PhysicsUnknownSection], ['living', PhysicsCarKeptLivingSection],
    ['logbook', PhysicsLogbookSection], ['epochs', PhysicsFirmwareEpochsSection],
    ['port', PhysicsChargePortSection], ['black-box', PhysicsBlackBoxSection],
    ['dictionary', PhysicsDictionarySection], ['vault', PhysicsVaultSection],
    ['modes', PhysicsModesSection], ['nerves', PhysicsNervousSystemSection],
    ['range', PhysicsRangeSection],
  ] satisfies ReadonlyArray<readonly [string, ComponentType<{ physics: PhysicsPage }>]>;

  it.each(sections)('%s mounts the actual compact brief without inferring a missing slice as measured zero', (_name, Component) => {
    const { container } = renderSection(Component);
    const brief = container.querySelector('[data-operational-brief]');
    if (!brief) throw new Error('Missing physics evidence brief');
    expect(brief.querySelector('[data-value-state="missing"]')).toBeNull();
    assertOperationalBriefDisclosure(brief, 'Partial source coverage');
    expect(screen.getAllByRole('button', { name: 'Review details' }).length).toBeGreaterThan(0);
  });

  it('keeps signed paired clock lag, zero intervals, raw rows and exact count denominators in Review details', () => {
    source.report = { ...boundedReport, clocks: {
      vehicle_id: 7, latest: null, honesty: 'Paired readings only.',
      samples: [
        { event_time: start, ingest_time: '2026-09-30T23:59:58Z', display_time: end, gap_s: 0, unknown: false },
        { event_time: end, ingest_time: null, display_time: end, gap_s: null, unknown: true },
      ],
    } };
    renderSection(PhysicsClocksSection);
    expect(metric('physics-clocks-summary', 'median-lag')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-clocks-summary', 'median-lag')).toHaveTextContent('-2');
    expect(metric('physics-clocks-summary', 'paired')).toHaveTextContent('1/2');
    expect(metric('physics-clocks-summary', 'max-gap')).toHaveTextContent('0');
    expect(screen.getByLabelText('Filter event intervals')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('physics-clocks-summary')).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Stored ingest timestamps: 1 / 2')).toBeInTheDocument();
    expect(within(drawer).getByText('Known event intervals: 1 / 2')).toBeInTheDocument();
    const drawerHeader = drawer.querySelector('[data-drawer-header]');
    if (!drawerHeader) throw new Error('Missing physics evidence drawer header');
    expect(within(drawerHeader).getByText(/Requested:/)).toBeInTheDocument();
  });

  it('preserves false versus unknown mode fields and independent cross-check populations', () => {
    source.report = { ...boundedReport, modes: {
      vehicle_id: 7, valet: false, service: null, transport: true,
      allowed: ['Observed only.'], forbidden: ['No historical assignment.'], honesty: 'Mode snapshot.',
    }, meters: { vehicle_id: 7, odometer_m: 0, driving_distance_m: null, fsd_distance_m: null, resets: [], honesty: 'Counters only.' } };
    renderSection(PhysicsModesSection);
    expect(metric('physics-modes-summary', 'valet')).toHaveTextContent('No');
    assertOperationalMetricUnavailable(screen.getByTestId('physics-modes-summary'), 'Service');
    expect(metric('physics-modes-summary', 'transport')).toHaveTextContent('Yes');
    expect(metric('physics-modes-summary', 'drops')).toHaveAttribute('data-value-state', 'value');
    assertOperationalMetricUnavailable(screen.getByTestId('physics-modes-crosscheck'), 'Observed firmware epochs');
    expect(screen.getByText('Observed only.')).toBeInTheDocument();
    expect(screen.getByText('No historical assignment.')).toBeInTheDocument();
  });

  it('distinguishes combined contradiction filter misses from returned zero and restores matching episodes', () => {
    source.report = { ...boundedReport, contradictions: {
      vehicle_id: 7, honesty: 'Returned episodes only.',
      findings: [
        { at: start, kind: 'park_speed', detail: 'Known park conflict', unknown: false, observations: 3 },
        { at: end, kind: 'unplugged_latched', detail: 'Unknown latch conflict', unknown: true },
      ],
    } };
    renderSection(PhysicsContradictionsSection);
    fireEvent.change(screen.getByLabelText('Filter by finding'), { target: { value: 'park_speed' } });
    fireEvent.change(screen.getByLabelText('Filter by uncertainty'), { target: { value: 'unknown' } });
    expect(screen.getByText('No findings match this filter.')).toBeInTheDocument();
    expect(screen.queryByText('No contradictions in the returned window. Complete still latched is expected.')).toBeNull();
    expect(metric('physics-contradictions-summary', 'episodes')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Inspect all 2 returned episodes' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by uncertainty'), { target: { value: 'known' } });
    expect(screen.queryByText('No findings match this filter.')).toBeNull();
    expect(screen.getByRole('cell', { name: 'Known park conflict' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by finding'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by uncertainty'), { target: { value: 'all' } });
    expect(screen.getByRole('cell', { name: 'Unknown latch conflict' })).toBeInTheDocument();
  });

  it('retains the returned-zero contradiction message even when an uncertainty filter is selected', () => {
    source.report = { ...boundedReport, contradictions: {
      vehicle_id: 7, findings: [], honesty: 'Returned episodes only.',
    } };
    renderSection(PhysicsContradictionsSection);
    fireEvent.change(screen.getByLabelText('Filter by uncertainty'), { target: { value: 'unknown' } });
    expect(screen.getByText('No contradictions in the returned window. Complete still latched is expected.')).toBeInTheDocument();
    expect(screen.queryByText('No findings match this filter.')).toBeNull();
    expect(metric('physics-contradictions-summary', 'episodes')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-contradictions-summary', 'episodes')).toHaveTextContent('0');
  });

  it('retains successful empty interval counts and the original interpolated captions without reusing them as labels', () => {
    source.report = { ...boundedReport, life_tape: {
      vehicle_id: 7, from: start, to: end, segments: [], honesty: 'Returned intervals only.',
    } };
    renderSection(PhysicsLifeTapeSection);
    expect(metric('physics-life-summary', 'segments')).toHaveAttribute('data-value-state', 'value');
    expect(faceValue('physics-life-summary', 'segments')).toHaveTextContent('0');
    assertOperationalMetricUnavailable(screen.getByTestId('physics-life-summary'), 'Unclassified time');
    expect(screen.getByLabelText('Filter by state')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('physics-life-summary')).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('0 classified intervals')).toBeInTheDocument();
  });

  it('does not turn a retained report into loading or remove its measurements after refresh failure', () => {
    source.report = { ...boundedReport, charge_port_court: {
      vehicle_id: 7, honesty: 'One returned sample.',
      evidence: [{ at: start, door_open: false, pack_current_a: -1.25, charge_state: 'Charging' }],
    } };
    source.error = new Error('refresh failed');
    renderSection(PhysicsChargePortSection);
    assertOperationalBriefDisclosure(screen.getByTestId('physics-port-summary'), 'Retained after refresh failure');
    expect(metric('physics-port-summary', 'current')).toHaveTextContent('-1.25 A');
    expect(metric('physics-port-transitions', 'disconnected')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByLabelText('Filter charge-port samples by state')).toBeInTheDocument();
  });

  it('distinguishes unavailable initial measurements from loading and retains all summary shells', () => {
    source.report = undefined;
    source.loading = true;
    renderSection(PhysicsCarKeptLivingSection);
    expect(screen.getByTestId('physics-living-summary')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('physics-living-ingestion')).toHaveAttribute('aria-busy', 'true');
    expect(metric('physics-living-summary', 'queued')).toHaveAttribute('data-value-state', 'missing');
  });
});
