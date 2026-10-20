import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyBindings, sharedLoaderSpecifiers } from '@/__tests__/lazyRoutes.parse';
import type { ExclusiveReport } from '@/types/teslaPhysics';
import { formatDateTime } from '@/lib/dateFormat';
import { features } from '../components/tesla-physics/PhysicsPageShell';
import TeslaPhysicsPage from './TeslaPhysicsPage';

const datePreferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC' }));
vi.mock('@/lib/timezone', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => datePreferences.tz,
}));
vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...original, useSettings: () => {
    return { locale: datePreferences.locale, decimals: 2, density: 'comfortable', rangeType: 'rated', settings: {
      unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar', decimal_precision: 2, currency_symbol: '$',
      locale: datePreferences.locale, tz_display_default: 'user', timezone_user: datePreferences.tz,
    } };
  } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      const count = values?.count
      const plural = count === 1 ? values?.defaultValue_one : values?.defaultValue_other
      const template = typeof plural === 'string' ? plural : fallback
      return Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), template)
    },
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', precision: 2, locale: 'en-US' },
  formatDistance: (meters: number) => `${(meters / 1000).toFixed(1)} km`,
  formatEnergy: (wh: number) => `${(wh / 1000).toFixed(1)} kWh`,
}) }));
vi.mock('@/components/forms', () => ({ VehicleSelect: () => <div data-testid="vehicle-select" /> }));

const start = '2026-03-01T11:00:00Z';
const end = '2026-03-01T12:00:00Z';
const queryState = vi.hoisted(() => ({ error: null as Error | null, missing: false, loading: false, paused: false }));
const report: ExclusiveReport = {
  vehicle_id: 7,
  evidence: {
    requested_from: '2026-02-15T12:00:00Z', requested_to: end,
    first_recorded_at: start, last_recorded_at: end,
    history_rows: 100, black_box_rows: 0,
    history_truncated: true, black_box_truncated: false,
    drive_sessions_truncated: true, charge_sessions_truncated: false,
    history_available: true, black_box_available: false,
  },
  clocks: {
    vehicle_id: 7, latest: { event_time: start, ingest_time: null, display_time: end, gap_s: 600, unknown: true },
    samples: Array.from({ length: 30 }, (_, index) => ({
      event_time: `2026-03-01T11:${String(index).padStart(2, '0')}:00Z`, ingest_time: null,
      display_time: end, gap_s: 60, unknown: false,
    })), honesty: 'Clock readings are bounded; ingest may be unknown.',
  },
  life_tape: {
    vehicle_id: 7, from: start, to: end,
    segments: [
      { state: 'neutral_rolling', started_at: start, ended_at: '2026-03-01T11:05:00Z', duration_s: 300 },
      { state: 'charging', started_at: '2026-03-01T11:05:00Z', ended_at: '2026-03-01T11:10:00Z', duration_s: 300 },
    ], honesty: 'Neutral is not Park.',
  },
  contradictions: {
    vehicle_id: 7, findings: Array.from({ length: 80 }, (_, index) => ({
      at: `2026-03-01T11:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
      kind: 'park_speed', detail: 'P with speed', unknown: false,
    })), honesty: 'Review conflicts against raw frames.',
  },
  meters: {
    vehicle_id: 7, odometer_m: 9000000, driving_distance_m: 12000, fsd_distance_m: null,
    resets: [{ at: start, meter: 'FSD', from_m: 2000, to_m: 100, cause: 'near firmware', unknown: true }],
    honesty: 'Counter drops are not proof of a physical failure.',
  },
  unknown_os: { vehicle_id: 7, window_hours: 14, sample_hours: null, unknown_hours: null, budgets: [{ kind: 'fsd', hours: 14, unknown: true }], honesty: 'Unknown is not zero.' },
  car_kept_living: {
    vehicle_id: 7, last_telemetry_at: start, mqtt_connected: null, queued_count: null,
    replay_preserves_event_time: true, never_received_gap_s: null, notes: ['Queue depth unknown.'], honesty: 'Never received is unknowable.',
  },
  logbook: {
    vehicle_id: 7, entries: [
      { word: 'Park', at: start, ended_at: null, kind: 'gear', id: 0 },
      { word: 'Drive', at: end, ended_at: null, kind: 'drive', id: 42 },
    ], honesty: 'First gear reading is an observation, not a transition.',
  },
  firmware_epochs: { vehicle_id: 7, epochs: [{ version: '2026.20.3', started_at: start, ended_at: null, fsd_meter_start_m: null, fsd_meter_end_m: null, complete_to_unplug_s: null, honesty: 'Not causal.' }], honesty: 'Observed firmware only.' },
  charge_port_court: { vehicle_id: 7, evidence: [{ at: start, gear: 'P', firmware: '2026.20.3', latch: 'Engaged', charge_state: 'Complete', scheduled_mode: 'OffPeak', door_open: true, pack_current_a: 12.5 }], honesty: 'Complete is not unplugged.' },
  black_box: { vehicle_id: 7, trigger: 'unplug', from: start, to: end, frames: [], honesty: 'Latest selected trigger only.' },
  dictionary: { vehicle_id: 7, typical_complete_unplug_s: null, park_confirm_dwell_s: 30, complete_without_schedule: null, honesty: 'Missing stays unknown.' },
  vault: {
    vehicle_id: 7, certificate: {
      vehicle_id: 7, issued_at: end, from: start, to: end, rules: 'Park ends drives.', drives: [{ kind: 'drive', id: 42, started_at: start, ended_at: end, end_rule: 'Park' }],
      charges: [], integrity_sha256: 'abc', hmac_sha256: null, honesty: 'Hashed returned boundaries only.',
    }, unknown_hours: null, firmware_versions: ['2026.20.3'], etiquette_dwells_s: [45, 120], honesty: 'Not a lifetime archive.',
  },
  modes: { vehicle_id: 7, valet: false, service: false, transport: null, allowed: ['Park is observed.'], forbidden: ['Transport is unknown.'], honesty: 'Do not infer tow.' },
  nervous_system: { vehicle_id: 7, nerves: [{ field: 'FSD', status: 'silent', detail: 'No recent sample.' }], honesty: 'Silence is not zero.' },
  range: { vehicle_id: 7, rated_range_m: 400000, est_range_m: 360000, ideal_range_m: 450000, energy_remaining_wh: 62000, recent_wh_per_km: null, disagree: true, true_range_m: null, honesty: 'Never pick a true range.' },
};

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useTeslaExclusive: () => ({
    data: queryState.missing ? undefined : report, error: queryState.error, isError: queryState.error != null,
    isPending: queryState.loading, isLoading: queryState.loading,
    isFetching: queryState.loading && !queryState.paused, isSuccess: !queryState.missing,
    fetchStatus: queryState.paused ? 'paused' : queryState.loading ? 'fetching' : 'idle',
    dataUpdatedAt: Date.now(), refetch: vi.fn(),
  }),
}));

function LocationLabel() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.hash}</span>;
}
const slugs = features.map(({ slug }) => slug);

async function renderAt(path = '/tesla-physics') {
  const view = render(<MemoryRouter initialEntries={[path]}><LocationLabel /><Routes>
    <Route path="/tesla-physics" element={<TeslaPhysicsPage />} />
    {slugs.map((slug) => <Route key={slug} path={`/tesla-physics/${slug}`} element={<TeslaPhysicsPage />} />)}
  </Routes></MemoryRouter>);
  const feature = features.find(({ slug }) => path === `/tesla-physics/${slug}`);
  if (feature) {
    if (report[feature.slice]) await within(view.container).findByRole('heading', { name: feature.title });
    else await within(view.container).findByText('This evidence slice was not returned. No measurement is inferred from its absence.');
  }
  return view;
}

function reviewOverview() {
  const brief = screen.getByTestId('tesla-physics-evidence-summary');
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  return within(screen.getByRole('dialog'));
}

function reviewBrief(testId: string) {
  const brief = screen.getByTestId(testId);
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  return within(screen.getAllByRole('dialog').at(-1)!);
}

describe('Tesla Physics consolidated workbench', () => {
  // Warm the 15 lazy section chunks once: first navigation to a section pays a
  // dynamic-import cost that can exceed the 1s findBy timeout under full-suite
  // load, flaking whichever test touches a section first. Warming moves that
  // cost out of every timed path without touching any assertion.
  beforeAll(async () => {
    const sectionLoaders = import.meta.glob('../components/tesla-physics/Physics*Section.tsx');
    expect(Object.keys(sectionLoaders)).toHaveLength(features.length);
    await Promise.all(Object.values(sectionLoaders).map((load) => load()));
  });
  beforeEach(() => {
    Object.assign(datePreferences, { locale: 'en-US', tz: 'UTC' });
    Object.assign(queryState, { error: null, missing: false, loading: false, paused: false });
  });

  it('shows source-shaped loading on the mounted workbench and keeps investigation navigation', async () => {
    Object.assign(queryState, { missing: true, loading: true });
    await renderAt();
    expect(screen.getByRole('status', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading', { name: 'Evidence boundaries' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Where to start' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Three clocks' })).toHaveAttribute('href', '/tesla-physics/clocks');
    expect(screen.queryByTestId('tesla-physics-evidence-summary')).toBeNull();
    expect(screen.queryByText('Select a vehicle to load Tesla physics.')).toBeNull();
  });

  it('recovers an initial paused workbench without asserting offline or inventing an empty report', async () => {
    Object.assign(queryState, { missing: true, loading: true, paused: true });
    const view = await renderAt();
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading…' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('tesla-physics-evidence-summary')).toBeNull();
    Object.assign(queryState, { missing: false, loading: false, paused: false });
    view.rerender(<MemoryRouter><TeslaPhysicsPage /></MemoryRouter>);
    expect(screen.queryByText('Refresh paused')).toBeNull();
    expect(screen.getByTestId('tesla-physics-evidence-summary')).toBeInTheDocument();
  });

  it.each([
    ['history-unavailable', 'history_available', false],
    ['black-box-unavailable', 'black_box_available', false],
    ['history-capped', 'history_truncated', true],
    ['black-box-capped', 'black_box_truncated', true],
    ['drives-capped', 'drive_sessions_truncated', true],
    ['charges-capped', 'charge_sessions_truncated', true],
  ] as const)('qualifies returned overview evidence as partial for %s', async (_case, flag, value) => {
    const saved = report.evidence;
    if (!saved) throw new Error('Evidence fixture must be present');
    report.evidence = {
      ...saved,
      history_available: true, black_box_available: true,
      history_truncated: false, black_box_truncated: false,
      drive_sessions_truncated: false, charge_sessions_truncated: false,
      [flag]: value,
    };
    try {
      await renderAt();
      const brief = screen.getByTestId('tesla-physics-evidence-summary');
      expect(reviewOverview().getByText('Partial source coverage')).toBeInTheDocument();
      expect(reviewOverview().queryByText('Source returned')).toBeNull();
      expect(brief.querySelector('[data-operational-metric="episodes"]')).toHaveAttribute('data-value-state', 'value');
      expect(screen.getByRole('link', { name: 'Three clocks' })).toHaveAttribute('href', '/tesla-physics/clocks');
    } finally { report.evidence = saved; }
  });

  it('keeps overview coverage partial when evidence metadata is absent', async () => {
    const saved = report.evidence;
    report.evidence = undefined;
    try {
      await renderAt();
      const brief = screen.getByTestId('tesla-physics-evidence-summary');
      expect(reviewOverview().getByText('Partial source coverage')).toBeInTheDocument();
      expect(brief.querySelector('[data-operational-metric="coverage"]')).toBeNull();
      expect(reviewOverview().getByText(/\d+ empty fields? (?:are|is) hidden\./)).toBeInTheDocument();
      expect(brief.querySelector('[data-operational-metric="episodes"]')).toHaveAttribute('data-value-state', 'value');
    } finally { report.evidence = saved; }
  });

  it('keeps independent overview readings and source boundaries when the active investigation slice is absent', async () => {
    const saved = report.life_tape;
    // Partial reports can omit a slice despite the complete-report API type.
    Reflect.deleteProperty(report, 'life_tape');
    try {
      await renderAt('/tesla-physics/life-tape');
      expect(screen.getByText('This evidence slice was not returned. No measurement is inferred from its absence.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Evidence at a glance' })).toBeInTheDocument();
      const brief = screen.getByTestId('tesla-physics-evidence-summary');
      expect(brief.querySelector('[data-operational-metric="episodes"]')).toHaveAttribute('data-value-state', 'value');
      expect(brief.querySelector('[data-operational-metric="episodes"]')).toHaveTextContent('80');
      expect(screen.getByRole('heading', { name: 'Evidence boundaries' })).toBeInTheDocument();
      expect(screen.getByText('History row cap reached')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Life tape' })).toHaveAttribute('aria-current', 'page');
      expect(screen.queryByTestId('physics-life-summary')).toBeNull();
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getByText('Returned episodes')).toBeInTheDocument();
    } finally { report.life_tape = saved; }
  });

  it('keeps the returned-source label when all evidence sources are available and uncapped', async () => {
    const saved = report.evidence;
    if (!saved) throw new Error('Evidence fixture must be present');
    report.evidence = {
      ...saved,
      history_available: true, black_box_available: true,
      history_truncated: false, black_box_truncated: false,
      drive_sessions_truncated: false, charge_sessions_truncated: false,
    };
    try {
      await renderAt();
      expect(reviewOverview().getByText('Source returned')).toBeInTheDocument();
      expect(reviewOverview().queryByText('Partial source coverage')).toBeNull();
    } finally { report.evidence = saved; }
  });

  it('retains refresh-failure trust and readings instead of replacing them with partial coverage', async () => {
    queryState.error = new Error('Read-only fixture refresh failed');
    try {
      await renderAt();
      const brief = screen.getByTestId('tesla-physics-evidence-summary');
      expect(reviewOverview().getByText('Retained after refresh failure')).toBeInTheDocument();
      expect(reviewOverview().queryByText('Partial source coverage')).toBeNull();
      expect(brief.querySelector('[data-operational-metric="episodes"]')).toHaveAttribute('data-value-state', 'value');
      expect(screen.getByText('History row cap reached')).toBeInTheDocument();
    } finally { queryState.error = null; }
  });

  it('reviews the actual returned-evidence brief while keeping absent coverage separate from real zero findings', async () => {
    await renderAt();
    const brief = screen.getByTestId('tesla-physics-evidence-summary');
    expect(brief.querySelector('[data-operational-metric="coverage"]')).toBeNull();
    expect(brief.querySelector('[data-operational-metric="episodes"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/\d+ empty fields? (?:are|is) hidden\./)).toBeInTheDocument();
    expect(within(drawer).getByText('Exclusive history is bounded to at most 14 days', { selector: '[data-drawer-header] span' })).toBeInTheDocument();
    expect(within(drawer).getByText('Returned episodes')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/not proof that nothing happened outside/).length).toBeGreaterThan(0);
  });

  it('hub exposes source caps and all fifteen deep links in grouped navigation', async () => {
    await renderAt();
    expect(screen.getByText('History row cap reached')).toBeInTheDocument();
    expect(screen.getByText('Drive session cap reached')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Time & coverage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Motion & states' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Charging & range' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Integrity & firmware' })).toBeInTheDocument();
    for (const slug of slugs) expect(document.querySelector(`a[href="/tesla-physics/${slug}"]`)).not.toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Three clocks' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/tesla-physics/clocks');
    expect(screen.getByRole('link', { name: 'Three clocks' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: 'Three clocks' })).toBeInTheDocument();
    expect(screen.getAllByText('Evidence boundaries')).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: 'Mode laws' }));
    expect(await screen.findByRole('heading', { name: 'Mode laws' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Three clocks' })).toBeNull();
    expect(screen.getAllByText('Evidence boundaries')).toHaveLength(1);
  });

  it('analyzes clock lags and gaps instead of rendering repeated timestamps by default', async () => {
    await renderAt('/tesla-physics/clocks');
    const details = reviewBrief('physics-clocks-summary');
    expect(details.getByText('Stored ingest timestamps: 0 / 30')).toBeInTheDocument();
    expect(details.getByText('Intervals over five minutes')).toBeInTheDocument();
    expect(details.getByText('At most 60 s: 30')).toBeInTheDocument();
    fireEvent.click(details.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.getByText('Latest six returned samples (second precision)')).toBeInTheDocument();
    expect(screen.queryByText('Showing 1–25 of 30')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect raw evidence: Three clocks (30 rows)' }));
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();
  });

  it('formats mounted evidence boundaries and clock rows in the selected locale and timezone without dropping seconds', async () => {
    Object.assign(datePreferences, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    await renderAt('/tesla-physics/clocks');
    const opts = { locale: datePreferences.locale, tz: datePreferences.tz };
    const evidence = report.evidence;
    if (!evidence) throw new Error('Evidence fixture must be present');
    expect(screen.getAllByText(`Requested: ${formatDateTime(evidence.requested_from, opts)} → ${formatDateTime(evidence.requested_to, opts)}`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`Recorded: ${formatDateTime(start, opts)} → ${formatDateTime(end, opts)}`).length).toBeGreaterThan(0);
    const sample = report.clocks.samples[29];
    expect(screen.getByRole('cell', { name: formatDateTime(sample.event_time, {
      ...opts, clock: { second: '2-digit' },
    }) })).toBeInTheDocument();
    expect(screen.getAllByRole('cell', { name: formatDateTime(end, {
      ...opts, clock: { second: '2-digit' },
    }) }).length).toBe(6);
  });

  it('calculates lag only from paired event/ingest timestamps and keeps missing timestamps unknown', async () => {
    const old = report.clocks.samples;
    report.clocks.samples = [
      { event_time: start, ingest_time: '2026-03-01T11:00:10Z', display_time: end, gap_s: null, unknown: false },
      { event_time: '2026-03-01T11:10:00Z', ingest_time: null, display_time: end, gap_s: 600, unknown: true },
    ];
    try {
      await renderAt('/tesla-physics/clocks');
      const details = reviewBrief('physics-clocks-summary');
      expect(details.getByText('Stored ingest timestamps: 1 / 2')).toBeInTheDocument();
      expect(details.getByText('Known event intervals: 1 / 2')).toBeInTheDocument();
      expect(details.getByText('Over 5 min: 1')).toBeInTheDocument();
      fireEvent.click(details.getAllByRole('button', { name: 'Close' }).at(-1)!);
      expect(screen.getByText('Intervals over five minutes')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Filter event intervals'), { target: { value: 'over300' } });
      expect(screen.getByRole('button', { name: 'Inspect raw evidence: Three clocks (1 rows)' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Inspect raw evidence: Three clocks (1 rows)' }));
      expect(screen.getAllByRole('cell').some((cell) => cell.textContent?.includes(':10:00'))).toBe(true);
    } finally { report.clocks.samples = old; }
  });

  it('reads backend episodes with observation count and window', async () => {
    const old = report.contradictions.findings;
    report.contradictions.findings = [{ at: start, last_at: end, observations: 265, kind: 'unplugged_latched', detail: 'Unplugged while latched', unknown: false }];
    try {
      await renderAt('/tesla-physics/contradictions');
      const details = reviewBrief('physics-contradictions-summary');
      expect(screen.getByRole('cell', { name: '265' })).toBeInTheDocument();
      expect(details.getByText('unplugged_latched: 1 episodes / 265 readings')).toBeInTheDocument();
      expect(screen.getByText(/Nearest port sample within two minutes:/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect all 1 returned episodes' })).toBeInTheDocument();
      expect(screen.getAllByText(/backend groups consecutive matching findings/).length).toBeGreaterThan(0);
      fireEvent.change(screen.getByLabelText('Filter by uncertainty'), { target: { value: 'unknown' } });
      expect(screen.getByText('No findings match this filter.')).toBeInTheDocument();
      expect(screen.queryByText('No contradictions in the returned window. Complete still latched is expected.')).toBeNull();
      expect(screen.getByRole('button', { name: 'Inspect all 1 returned episodes' })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Filter by uncertainty'), { target: { value: 'all' } });
      expect(screen.queryByText('No findings match this filter.')).toBeNull();
      expect(screen.getByRole('cell', { name: '265' })).toBeInTheDocument();
    } finally { report.contradictions.findings = old; }
  });

  it('filters life states and retains meter nulls', async () => {
    await renderAt('/tesla-physics/life-tape');
    const details = reviewBrief('physics-life-summary');
    expect(details.getByText('Sum of classified intervals / returned window: 16.67%')).toBeInTheDocument();
    fireEvent.click(details.getAllByRole('button', { name: 'Close' }).at(-1)!);
    expect(screen.getByText(/Longest returned interval: neutral_rolling for 300\.00 s/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by state'), { target: { value: 'charging' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inspect raw evidence: Life tape (1 rows)' }));
    expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('neutral_rolling'))).toBe(false);
  });

  it('shows meter context and quantified drops without filling null FSD', async () => {
    await renderAt('/tesla-physics/meters');
    const details = reviewBrief('physics-meters-summary');
    expect(details.queryByText('FSD trip meter')).toBeNull();
    expect(details.getByText('Largest measured drop: 1.9 km')).toBeInTheDocument();
    expect(screen.queryByText('0.0 km')).toBeNull();
  });

  it('keeps counter and firmware context when no resets were returned', async () => {
    const old = report.meters.resets;
    report.meters.resets = [];
    try {
      await renderAt('/tesla-physics/meters');
      const details = reviewBrief('physics-meters-summary');
      expect(screen.getByText(/No meter drops were returned in this bounded window/)).toBeInTheDocument();
      expect(screen.getByText(/Firmware 2026.20.3 observed/)).toBeInTheDocument();
      expect(screen.getByText('Latest mode context: valet No, service No, transport unknown')).toBeInTheDocument();
      expect(details.getAllByText(/does not measure engaged FSD driving/).length).toBeGreaterThan(0);
    } finally { report.meters.resets = old; }
  });

  it('distinguishes sampled hours and overlapping signal budgets', async () => {
    await renderAt('/tesla-physics/unknown');
    const details = reviewBrief('physics-unknown-summary');
    expect(details.queryByText('Accepted telemetry: unknown')).toBeNull();
    expect(screen.getByText('fsd')).toBeInTheDocument();
    expect(details.getByText('Unknown-flagged signal budgets: 1 / 1')).toBeInTheDocument();
    expect(details.getAllByText(/never add them together/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Check event and ingest intervals/ })).toHaveAttribute('href', '/tesla-physics/clocks');
  });

  it('derives coverage shares only when the requested window is valid', async () => {
    const old = report.unknown_os.sample_hours;
    report.unknown_os.sample_hours = 7;
    try {
      await renderAt('/tesla-physics/unknown');
      const details = reviewBrief('physics-unknown-summary');
      expect(details.getByText('Accepted telemetry: 50.00%')).toBeInTheDocument();
      expect(screen.getByText('100.00% of requested window')).toBeInTheDocument();
    } finally { report.unknown_os.sample_hours = old; }
  });

  it('only links positive-ID drive and charge logbook boundaries', async () => {
    await renderAt('/tesla-physics/logbook');
    expect(screen.getByText('First recorded gear: Park · first charge state: unknown')).toBeInTheDocument();
    expect(screen.getByText('Last recorded gear: Park · last charge state: unknown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Drive →' })).toHaveAttribute('href', '/drives/42');
    expect(screen.getByText('Park')).not.toHaveAttribute('href');
    fireEvent.change(screen.getByLabelText('Filter narrative by evidence kind'), { target: { value: 'gear' } });
    expect(screen.getByRole('button', { name: 'Inspect raw evidence: Tesla-language logbook (1 rows)' })).toBeInTheDocument();
  });

  it.each([
    ['/tesla-physics/car-kept-living', 'Queue depth unknown.', 'physics-living-summary'],
    ['/tesla-physics/firmware-epochs', 'FSD counter: unknown → unknown · complete → unplug: unknown', 'physics-epochs-summary'],
    ['/tesla-physics/dictionary', 'Returned etiquette dwell observations: 2', 'physics-dictionary-summary'],
    ['/tesla-physics/modes', 'Returned counter drops for comparison: 1', 'physics-modes-summary'],
    ['/tesla-physics/nervous-system', 'No recent sample.', 'physics-nerves-summary'],
  ])('%s exposes its own returned evidence rather than a generic panel', async (path, evidence, testId) => {
    await renderAt(path);
    if (path === '/tesla-physics/car-kept-living' || path === '/tesla-physics/firmware-epochs' || path === '/tesla-physics/nervous-system') {
      expect(screen.getByText(evidence)).toBeInTheDocument();
    } else {
      expect(reviewBrief(testId).getByText(evidence)).toBeInTheDocument();
    }
  });

  it('shows port gear/firmware and Black Box source limitations', async () => {
    await renderAt('/tesla-physics/charge-port');
    expect(screen.getByText('Latest gear P · firmware 2026.20.3 · latch Engaged · schedule OffPeak')).toBeInTheDocument();
    await renderAt('/tesla-physics/black-box');
    expect(screen.getAllByText('Black-box source unavailable: an empty frame list cannot exclude an event').length).toBeGreaterThan(0);
  });

  it('distinguishes observed port transitions from the first returned state and filters raw rows', async () => {
    const saved = report.charge_port_court.evidence;
    report.charge_port_court.evidence = [...saved, {
      at: end, gear: 'P', firmware: '2026.20.3', latch: 'Open', charge_state: 'Disconnected',
      scheduled_mode: 'OffPeak', door_open: true, pack_current_a: 0,
    }];
    try {
      await renderAt('/tesla-physics/charge-port');
      const details = reviewBrief('physics-port-transitions');
      expect(details.getByText('Observed charge-state changes: 1')).toBeInTheDocument();
      expect(details.getByText('Disconnected readings: 1')).toBeInTheDocument();
      fireEvent.click(details.getAllByRole('button', { name: 'Close' }).at(-1)!);
      fireEvent.change(screen.getByLabelText('Filter charge-port samples by state'), { target: { value: 'Disconnected' } });
      expect(screen.getByRole('button', { name: 'Inspect raw evidence: Charge-port court (1 rows)' })).toBeInTheDocument();
    } finally { report.charge_port_court.evidence = saved; }
  });

  it('counts Black Box changes after the first frame, retaining gear and firmware context', async () => {
    const saved = report.black_box.frames;
    report.black_box.frames = [
      { ...report.charge_port_court.evidence[0], charge_state: 'Complete' },
      { ...report.charge_port_court.evidence[0], at: end, charge_state: 'Disconnected', latch: 'Open' },
    ];
    try {
      await renderAt('/tesla-physics/black-box');
      const details = reviewBrief('physics-black-box-changes');
      expect(details.getByText('1 observed state, latch or gear changes after the first frame')).toBeInTheDocument();
      expect(details.getByText('Recorded gears: P')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect raw evidence: Black box 90s (2 rows)' })).toBeInTheDocument();
    } finally { report.black_box.frames = saved; }
  });

  it('shows firmware counter bounds, filters observed versions, and never calls it engagement', async () => {
    const saved = report.firmware_epochs.epochs;
    report.firmware_epochs.epochs = [{ ...saved[0], fsd_meter_start_m: 2000, fsd_meter_end_m: 100 }];
    try {
      await renderAt('/tesla-physics/firmware-epochs');
      expect(reviewBrief('physics-epochs-summary').getByText('Epochs with lower final FSD counter: 1')).toBeInTheDocument();
      expect(screen.getByText(/Latest epoch with two FSD counter bounds/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Filter observed firmware version'), { target: { value: '2026.20.3' } });
      expect(screen.getByRole('button', { name: 'Inspect raw evidence: Firmware epochs (1 rows)' })).toBeInTheDocument();
    } finally { report.firmware_epochs.epochs = saved; }
  });

  it('compares only usable Dictionary dwells and handles a missing Vault source', async () => {
    await renderAt('/tesla-physics/dictionary');
    expect(screen.getByText('At most one minute')).toBeInTheDocument();
    expect(reviewBrief('physics-dictionary-summary').getByText('Returned dwell median: 82.50 s')).toBeInTheDocument();
    const saved = report.vault;
    try {
      Object.assign(report, { vault: null });
      await renderAt('/tesla-physics/dictionary');
      expect(screen.getByText(/Vault etiquette observations were not returned/)).toBeInTheDocument();
    } finally { report.vault = saved; }
  });

  it('cross-checks Mode Laws and Nervous System against their separately returned sources', async () => {
    await renderAt('/tesla-physics/modes');
    expect(reviewBrief('physics-modes-crosscheck').getByText('Meter drops with unknown cause: 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Inspect before\/after meter evidence/ })).toHaveAttribute('href', '/tesla-physics/meters');
    await renderAt('/tesla-physics/nervous-system');
    expect(screen.getByText('FSD: silent now; 14.00 h unknown in returned budget')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter returned signals by status'), { target: { value: 'silent' } });
    expect(screen.getByRole('button', { name: 'Inspect raw evidence: Nervous system (1 rows)' })).toBeInTheDocument();
  });

  it('keeps Car Kept Living lag unknown without a paired ingest reading', async () => {
    await renderAt('/tesla-physics/car-kept-living');
    expect(screen.queryByText('Latest paired ingest lag')).toBeNull();
    expect(screen.getByText('Bounded history: 100 rows; available: Yes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Inspect unknown-hour budgets/ })).toHaveAttribute('href', '/tesla-physics/unknown');
  });

  it('keeps Vault HMAC status, cap warnings, and drive links', async () => {
    await renderAt('/tesla-physics/vault');
    expect(screen.getByText('Hash only: not an authenticated signature')).toBeInTheDocument();
    expect(screen.getByText('Drive session cap reached: drive boundaries are partial')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect raw evidence: Drive boundaries (1 rows)' }));
    expect(screen.getByRole('link', { name: '42 →' })).toHaveAttribute('href', '/drives/42');
  });

  it('compares range estimates without asserting true range', async () => {
    await renderAt('/tesla-physics/range');
    expect(reviewBrief('physics-range-summary').getByText('Estimate spread: 90.0 km')).toBeInTheDocument();
    expect(screen.getByText('Rated vs Typical: 40.0 km apart')).toBeInTheDocument();
    expect(screen.getByText('Difference relative to Rated: 10.00%')).toBeInTheDocument();
    expect(screen.getByText(/No true range/)).toBeInTheDocument();
  });

  it('renders populated recent efficiency consistently in the range brief and caption without deriving true range', async () => {
    const saved = report.range;
    report.range = { ...saved, recent_wh_per_km: 187.4568 };
    try {
      await renderAt('/tesla-physics/range');
      const brief = screen.getByTestId('physics-range-summary');
      expect(brief.querySelector('[data-operational-metric="recent-efficiency"]')).toHaveTextContent('187.46 Wh/km');
      expect(screen.getByText('No true range. Recent Wh/km: 187.46')).toBeInTheDocument();
      expect(screen.getByText('Rated vs Typical: 40.0 km apart')).toBeInTheDocument();
      expect(report.range.recent_wh_per_km).toBe(187.4568);
      expect(report.range.true_range_m).toBeNull();
    } finally { report.range = saved; }
  });

  it.each([0, 1000.25, -1000.25])('states equality for identical returned range estimates (%s)', async (value) => {
    const saved = report.range;
    report.range = { ...saved, rated_range_m: value, est_range_m: value, ideal_range_m: null, disagree: false };
    try {
      await renderAt('/tesla-physics/range');
      expect(screen.getByText('Rated and Typical are equal in the returned estimates')).toBeInTheDocument();
      expect(screen.queryByText(/is higher in the returned estimates/)).toBeNull();
      expect(screen.getByText('Rated vs Typical: 0.0 km apart')).toBeInTheDocument();
      expect(screen.getByText(`Difference relative to Rated: ${value > 0 ? '0.00%' : 'unknown'}`)).toBeInTheDocument();
      expect(report.range.rated_range_m).toBe(value);
      expect(report.range.est_range_m).toBe(value);
    } finally { report.range = saved; }
  });

  it('keeps a fractional nonzero difference directional even when displayed distances round to equality', async () => {
    const saved = report.range;
    report.range = { ...saved, rated_range_m: 1000.125, est_range_m: 1000.25, ideal_range_m: null };
    try {
      await renderAt('/tesla-physics/range');
      expect(screen.getByText('Rated vs Typical: 0.0 km apart')).toBeInTheDocument();
      expect(screen.getByText('Typical is higher in the returned estimates')).toBeInTheDocument();
      expect(screen.queryByText(/are equal in the returned estimates/)).toBeNull();
      expect(screen.getByText('Difference relative to Rated: 0.01%')).toBeInTheDocument();
      expect(report.range.rated_range_m).toBe(1000.125);
      expect(report.range.est_range_m).toBe(1000.25);
    } finally { report.range = saved; }
  });

  it('does not turn an empty Life Tape into a measured zero-duration state', async () => {
    const saved = report.life_tape.segments;
    report.life_tape.segments = [];
    try {
      await renderAt('/tesla-physics/life-tape');
      expect(screen.getByText('No classified intervals returned. The report cannot reconstruct a state chronology for this window.')).toBeInTheDocument();
      expect(screen.queryByText('Returned interval duration')).toBeNull();
    } finally { report.life_tape.segments = saved; }
  });

  it('keeps mode state unknown if no fields are observed and names absent meter context', async () => {
    const modes = report.modes;
    const meters = report.meters;
    try {
      Object.assign(report, { modes: { ...modes, valet: null, service: null, transport: null }, meters: null });
      await renderAt('/tesla-physics/modes');
      expect(screen.queryByText('Observed active modes')).toBeNull();
      expect(screen.getByText(/Meter evidence was not returned/)).toBeInTheDocument();
    } finally { report.modes = modes; report.meters = meters; }
  });

  it('keeps missing range comparisons unknown when only one estimate is returned', async () => {
    const saved = report.range;
    report.range = { ...saved, est_range_m: null, ideal_range_m: null };
    try {
      await renderAt('/tesla-physics/range');
      expect(screen.getByText(/At least two estimates are needed for a comparison/)).toBeInTheDocument();
      expect(screen.queryByText('Estimate spread')).toBeNull();
    } finally { report.range = saved; }
  });

  it.each([null, NaN, Infinity, -Infinity] as const)('excludes a missing or invalid rated estimate (%s) while comparing measured zeros', async (rated) => {
    const saved = report.range;
    report.range = { ...saved, rated_range_m: rated, est_range_m: 0, ideal_range_m: 0, disagree: false };
    try {
      await renderAt('/tesla-physics/range');
      const brief = screen.getByTestId('physics-range-summary');
      expect(brief.querySelector('[data-operational-metric="rated"]')).toBeNull();
      expect(brief.querySelector('[data-operational-metric="typical"]')).toHaveAttribute('data-value-state', 'value');
      expect(brief.querySelector('[data-operational-metric="ideal"]')).toHaveAttribute('data-value-state', 'value');
      expect(screen.getByText('Typical and Ideal are equal in the returned estimates')).toBeInTheDocument();
      expect(screen.getByText('Typical vs Ideal: 0.0 km apart')).toBeInTheDocument();
      expect(screen.getByText('Difference relative to Typical: unknown')).toBeInTheDocument();
      expect(screen.queryByText('Spread versus rated')).toBeNull();
      expect(screen.queryByText(/Rated vs|is higher in the returned estimates/)).toBeNull();
      expect(report.range.rated_range_m).toBe(rated);
      expect(report.range.est_range_m).toBe(0);
      expect(report.range.ideal_range_m).toBe(0);
    } finally { report.range = saved; }
  });

  it.each([
    ['clocks', 'clocks'], ['unknown', 'unknown_os'], ['car-kept-living', 'car_kept_living'],
    ['life-tape', 'life_tape'], ['contradictions', 'contradictions'], ['meters', 'meters'],
    ['logbook', 'logbook'], ['nervous-system', 'nervous_system'], ['modes', 'modes'],
    ['charge-port', 'charge_port_court'], ['black-box', 'black_box'], ['dictionary', 'dictionary'],
    ['range', 'range'], ['firmware-epochs', 'firmware_epochs'], ['vault', 'vault'],
  ] as const)('%s retains its own panel when source slice is null', async (slug, slice) => {
    const saved = report[slice];
    try {
      Object.assign(report, { [slice]: null });
      await renderAt(`/tesla-physics/${slug}`);
      expect(screen.getByText('This evidence slice was not returned. No measurement is inferred from its absence.')).toBeInTheDocument();
    } finally { Object.assign(report, { [slice]: saved }); }
  });

  it('honestly handles absent source metadata', async () => {
    const saved = report.evidence;
    try {
      report.evidence = undefined;
      await renderAt();
      expect(screen.getByText('Evidence coverage metadata was not returned; counts cannot establish completeness.')).toBeInTheDocument();
    } finally { report.evidence = saved; }
  });

  it('routes all deep links through one lazy workbench and splits fifteen evidence sections', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const prefetch = readFileSync('src/lib/routePrefetch.ts', 'utf8');
    const loaderSource = readFileSync('src/lib/routeLoaders.ts', 'utf8');
    const sections = readFileSync('src/features/vehicles/components/tesla-physics/PhysicsInvestigation.tsx', 'utf8');
    expect(lazyBindings(app, { './lib/routeLoaders': loaderSource })).toContainEqual({
      name: 'TeslaPhysics', specifier: './features/vehicles/pages/TeslaPhysicsPage',
    });
    expect(sharedLoaderSpecifiers(loaderSource).get('TeslaPhysics'))
      .toBe('../features/vehicles/pages/TeslaPhysicsPage');
    const aliases = new Set(['/tesla-physics', ...slugs.map(slug => `/tesla-physics/${slug}`)]);
    expect(aliases.size).toBe(16);
    const prefetchSource = ts.createSourceFile('routePrefetch.ts', prefetch, ts.ScriptTarget.Latest, true);
    const prefetchBindings = new Map<string, string>();
    let sharedNamespace = false;
    for (const statement of prefetchSource.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.moduleSpecifier.text === './routeLoaders') {
        const clause = statement.importClause;
        sharedNamespace = Boolean(clause && !clause.isTypeOnly && clause.namedBindings
          && ts.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === 'routeLoaders');
      }
    }
    expect(sharedNamespace).toBe(true);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && aliases.has(node.name.text)) {
        const loader = node.initializer;
        if (!ts.isPropertyAccessExpression(loader) || !ts.isIdentifier(loader.expression)) {
          throw new Error(`Physics prefetch alias ${node.name.text} is not a shared loader reference`);
        }
        expect(loader.expression.text).toBe('routeLoaders');
        expect(prefetchBindings.has(node.name.text)).toBe(false);
        prefetchBindings.set(node.name.text, loader.name.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(prefetchSource);
    expect(prefetchBindings.get('/tesla-physics')).toBe('TeslaPhysics');
    for (const slug of slugs) {
      expect(app).toMatch(new RegExp(`path="tesla-physics/${slug}" element=\\{<SafeRoute name="[^"]+"><TeslaPhysics />`));
      expect(prefetchBindings.get(`/tesla-physics/${slug}`)).toBe('TeslaPhysics');
    }
    expect(sections.match(/lazy\(\(\) => import\('\.\/Physics\w+Section'\)\)/g)).toHaveLength(slugs.length);
    expect(app).toContain('path="tesla-physics/ledger"');
    expect(app).toContain('path="tesla-only/*" element={<LegacyTeslaPhysicsRedirect />}');
  });
});
