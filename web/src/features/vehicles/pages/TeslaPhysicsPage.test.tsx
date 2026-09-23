import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ExclusiveReport } from '@/types/teslaPhysics';
import TeslaPhysicsPage from './TeslaPhysicsPage';
import PhysicsClocksPage from './PhysicsClocksPage';
import PhysicsLifeTapePage from './PhysicsLifeTapePage';
import PhysicsContradictionsPage from './PhysicsContradictionsPage';
import PhysicsMetersPage from './PhysicsMetersPage';
import PhysicsUnknownPage from './PhysicsUnknownPage';
import PhysicsCarKeptLivingPage from './PhysicsCarKeptLivingPage';
import PhysicsLogbookPage from './PhysicsLogbookPage';
import PhysicsFirmwareEpochsPage from './PhysicsFirmwareEpochsPage';
import PhysicsChargePortPage from './PhysicsChargePortPage';
import PhysicsBlackBoxPage from './PhysicsBlackBoxPage';
import PhysicsDictionaryPage from './PhysicsDictionaryPage';
import PhysicsVaultPage from './PhysicsVaultPage';
import PhysicsModesPage from './PhysicsModesPage';
import PhysicsNervousSystemPage from './PhysicsNervousSystemPage';
import PhysicsRangePage from './PhysicsRangePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), fallback),
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  formatDistance: (meters: number) => `${(meters / 1000).toFixed(1)} km`,
  formatEnergy: (wh: number) => `${(wh / 1000).toFixed(1)} kWh`,
}) }));
vi.mock('@/components/forms', () => ({ VehicleSelect: () => <div data-testid="vehicle-select" /> }));

const start = '2026-03-01T11:00:00Z';
const end = '2026-03-01T12:00:00Z';
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
    data: report, error: null, isError: false, isPending: false, isLoading: false,
    isFetching: false, isSuccess: true, fetchStatus: 'idle', dataUpdatedAt: Date.now(), refetch: vi.fn(),
  }),
}));

function LocationLabel() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.hash}</span>;
}
const pages = {
  clocks: PhysicsClocksPage, 'life-tape': PhysicsLifeTapePage, contradictions: PhysicsContradictionsPage,
  meters: PhysicsMetersPage, unknown: PhysicsUnknownPage, 'car-kept-living': PhysicsCarKeptLivingPage,
  logbook: PhysicsLogbookPage, 'firmware-epochs': PhysicsFirmwareEpochsPage, 'charge-port': PhysicsChargePortPage,
  'black-box': PhysicsBlackBoxPage, dictionary: PhysicsDictionaryPage, vault: PhysicsVaultPage,
  modes: PhysicsModesPage, 'nervous-system': PhysicsNervousSystemPage, range: PhysicsRangePage,
};

function renderAt(path = '/tesla-physics') {
  return render(<MemoryRouter initialEntries={[path]}><LocationLabel /><Routes>
    <Route path="/tesla-physics" element={<TeslaPhysicsPage />} />
    {Object.entries(pages).map(([slug, Page]) => <Route key={slug} path={`/tesla-physics/${slug}`} element={<Page />} />)}
  </Routes></MemoryRouter>);
}

describe('Tesla Physics independent investigation pages', () => {
  it('hub exposes source caps and all fifteen direct routes', () => {
    renderAt();
    expect(screen.getByText('History row cap reached')).toBeInTheDocument();
    expect(screen.getByText('Drive session cap reached')).toBeInTheDocument();
    for (const slug of Object.keys(pages)) expect(document.querySelector(`a[href="/tesla-physics/${slug}"]`)).not.toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Three Clocks →' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/tesla-physics/clocks');
  });

  it('analyzes clock lags and gaps instead of rendering repeated timestamps by default', () => {
    renderAt('/tesla-physics/clocks');
    expect(screen.getByText('Stored ingest timestamps: 0 / 30')).toBeInTheDocument();
    expect(screen.getByText('Intervals over five minutes')).toBeInTheDocument();
    expect(screen.getByText('At most 60 s: 30')).toBeInTheDocument();
    expect(screen.getByText('Latest six returned samples (second precision)')).toBeInTheDocument();
    expect(screen.queryByText('Showing 1–25 of 30')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect raw evidence: Three Clocks (30 rows)' }));
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();
  });

  it('calculates lag only from paired event/ingest timestamps and keeps missing timestamps unknown', () => {
    const old = report.clocks.samples;
    report.clocks.samples = [
      { event_time: start, ingest_time: '2026-03-01T11:00:10Z', display_time: end, gap_s: null, unknown: false },
      { event_time: '2026-03-01T11:10:00Z', ingest_time: null, display_time: end, gap_s: 600, unknown: true },
    ];
    try {
      renderAt('/tesla-physics/clocks');
      expect(screen.getByText('Stored ingest timestamps: 1 / 2')).toBeInTheDocument();
      expect(screen.getByText('Known event intervals: 1 / 2')).toBeInTheDocument();
      expect(screen.getByText('Intervals over five minutes')).toBeInTheDocument();
      expect(screen.getByText('Over 5 min: 1')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Filter event intervals'), { target: { value: 'over300' } });
      expect(screen.getByRole('button', { name: 'Inspect raw evidence: Three Clocks (1 rows)' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Inspect raw evidence: Three Clocks (1 rows)' }));
      expect(screen.getAllByRole('cell').some((cell) => cell.textContent?.includes(':10:00'))).toBe(true);
    } finally { report.clocks.samples = old; }
  });

  it('reads backend episodes with observation count and window', () => {
    const old = report.contradictions.findings;
    report.contradictions.findings = [{ at: start, last_at: end, observations: 265, kind: 'unplugged_latched', detail: 'Unplugged while latched', unknown: false }];
    try {
      renderAt('/tesla-physics/contradictions');
      expect(screen.getByRole('cell', { name: '265' })).toBeInTheDocument();
      expect(screen.getByText('unplugged_latched: 1 episodes / 265 readings')).toBeInTheDocument();
      expect(screen.getByText(/Nearest port sample within two minutes:/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect all 1 returned episodes' })).toBeInTheDocument();
      expect(screen.getByText(/backend groups consecutive matching findings/)).toBeInTheDocument();
    } finally { report.contradictions.findings = old; }
  });

  it('filters life states and retains meter nulls', () => {
    renderAt('/tesla-physics/life-tape');
    expect(screen.getByText('Sum of classified intervals / returned window: 16.7%')).toBeInTheDocument();
    expect(screen.getByText(/Longest returned interval: neutral_rolling for 300 s/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter by state'), { target: { value: 'charging' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inspect raw evidence: Life Tape (1 rows)' }));
    expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('neutral_rolling'))).toBe(false);
  });

  it('shows meter context and quantified drops without filling null FSD', () => {
    renderAt('/tesla-physics/meters');
    expect(screen.getByText('FSD trip meter')).toBeInTheDocument();
    expect(screen.getByText('Largest measured drop: 1.9 km')).toBeInTheDocument();
    expect(screen.queryByText('0.0 km')).toBeNull();
  });

  it('keeps counter and firmware context when no resets were returned', () => {
    const old = report.meters.resets;
    report.meters.resets = [];
    try {
      renderAt('/tesla-physics/meters');
      expect(screen.getByText(/No meter drops were returned in this bounded window/)).toBeInTheDocument();
      expect(screen.getByText(/Firmware 2026.20.3 observed/)).toBeInTheDocument();
      expect(screen.getByText('Latest mode context: Valet No, Service No, Transport unknown')).toBeInTheDocument();
      expect(screen.getByText(/does not measure engaged FSD driving/)).toBeInTheDocument();
    } finally { report.meters.resets = old; }
  });

  it('distinguishes sampled hours and overlapping signal budgets', () => {
    renderAt('/tesla-physics/unknown');
    expect(screen.getByText('Accepted telemetry: unknown')).toBeInTheDocument();
    expect(screen.getByText('fsd')).toBeInTheDocument();
    expect(screen.getByText('Unknown-flagged signal budgets: 1 / 1')).toBeInTheDocument();
    expect(screen.getByText(/never add them together/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Check event and ingest intervals/ })).toHaveAttribute('href', '/tesla-physics/clocks');
  });

  it('derives coverage shares only when the requested window is valid', () => {
    const old = report.unknown_os.sample_hours;
    report.unknown_os.sample_hours = 7;
    try {
      renderAt('/tesla-physics/unknown');
      expect(screen.getByText('Accepted telemetry: 50.0%')).toBeInTheDocument();
      expect(screen.getByText('100.0% of requested window')).toBeInTheDocument();
    } finally { report.unknown_os.sample_hours = old; }
  });

  it('only links positive-ID drive and charge logbook boundaries', () => {
    renderAt('/tesla-physics/logbook');
    expect(screen.getByText('First recorded gear: Park · first charge state: unknown')).toBeInTheDocument();
    expect(screen.getByText('Last recorded gear: Park · last charge state: unknown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Drive →' })).toHaveAttribute('href', '/drives/42');
    expect(screen.getByText('Park')).not.toHaveAttribute('href');
    fireEvent.change(screen.getByLabelText('Filter narrative by evidence kind'), { target: { value: 'gear' } });
    expect(screen.getByRole('button', { name: 'Inspect raw evidence: Tesla-Language Logbook (1 rows)' })).toBeInTheDocument();
  });

  it.each([
    ['/tesla-physics/car-kept-living', 'Queue depth unknown.'],
    ['/tesla-physics/firmware-epochs', 'FSD counter: unknown → unknown · Complete → unplug: unknown'],
    ['/tesla-physics/dictionary', 'Returned etiquette dwell observations: 2'],
    ['/tesla-physics/modes', 'Returned counter drops for comparison: 1'],
    ['/tesla-physics/nervous-system', 'No recent sample.'],
  ])('%s exposes its own returned evidence rather than a generic panel', (path, evidence) => {
    renderAt(path);
    expect(screen.getByText(evidence)).toBeInTheDocument();
  });

  it('shows port gear/firmware and Black Box source limitations', () => {
    renderAt('/tesla-physics/charge-port');
    expect(screen.getByText('Latest gear P · firmware 2026.20.3 · latch Engaged · schedule OffPeak')).toBeInTheDocument();
    renderAt('/tesla-physics/black-box');
    expect(screen.getAllByText('Black-box source unavailable: an empty frame list cannot exclude an event').length).toBeGreaterThan(0);
  });

  it('distinguishes observed port transitions from the first returned state and filters raw rows', () => {
    const saved = report.charge_port_court.evidence;
    report.charge_port_court.evidence = [...saved, {
      at: end, gear: 'P', firmware: '2026.20.3', latch: 'Open', charge_state: 'Disconnected',
      scheduled_mode: 'OffPeak', door_open: true, pack_current_a: 0,
    }];
    try {
      renderAt('/tesla-physics/charge-port');
      expect(screen.getByText('Observed charge-state changes: 1')).toBeInTheDocument();
      expect(screen.getByText('Disconnected readings: 1')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Filter charge-port samples by state'), { target: { value: 'Disconnected' } });
      expect(screen.getByRole('button', { name: 'Inspect raw evidence: Charge-Port Court (1 rows)' })).toBeInTheDocument();
    } finally { report.charge_port_court.evidence = saved; }
  });

  it('counts Black Box changes after the first frame, retaining gear and firmware context', () => {
    const saved = report.black_box.frames;
    report.black_box.frames = [
      { ...report.charge_port_court.evidence[0], charge_state: 'Complete' },
      { ...report.charge_port_court.evidence[0], at: end, charge_state: 'Disconnected', latch: 'Open' },
    ];
    try {
      renderAt('/tesla-physics/black-box');
      expect(screen.getByText('1 observed state, latch or gear changes after the first frame')).toBeInTheDocument();
      expect(screen.getByText('Recorded gears: P')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Inspect raw evidence: Black Box 90s (2 rows)' })).toBeInTheDocument();
    } finally { report.black_box.frames = saved; }
  });

  it('shows firmware counter bounds, filters observed versions, and never calls it engagement', () => {
    const saved = report.firmware_epochs.epochs;
    report.firmware_epochs.epochs = [{ ...saved[0], fsd_meter_start_m: 2000, fsd_meter_end_m: 100 }];
    try {
      renderAt('/tesla-physics/firmware-epochs');
      expect(screen.getByText('Epochs with lower final FSD counter: 1')).toBeInTheDocument();
      expect(screen.getByText(/Latest epoch with two FSD counter bounds/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Filter observed firmware version'), { target: { value: '2026.20.3' } });
      expect(screen.getByRole('button', { name: 'Inspect raw evidence: Firmware Epochs (1 rows)' })).toBeInTheDocument();
    } finally { report.firmware_epochs.epochs = saved; }
  });

  it('compares only usable Dictionary dwells and handles a missing Vault source', () => {
    renderAt('/tesla-physics/dictionary');
    expect(screen.getByText('At most one minute')).toBeInTheDocument();
    expect(screen.getByText('Returned dwell median: 83 s')).toBeInTheDocument();
    const saved = report.vault;
    try {
      Object.assign(report, { vault: null });
      renderAt('/tesla-physics/dictionary');
      expect(screen.getByText(/Vault etiquette observations were not returned/)).toBeInTheDocument();
    } finally { report.vault = saved; }
  });

  it('cross-checks Mode Laws and Nervous System against their separately returned sources', () => {
    renderAt('/tesla-physics/modes');
    expect(screen.getByText('Meter drops with unknown cause: 1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Inspect before\/after meter evidence/ })).toHaveAttribute('href', '/tesla-physics/meters');
    renderAt('/tesla-physics/nervous-system');
    expect(screen.getByText('Non-alive fields with a same-named Unknown OS budget: 1 / 1')).toBeInTheDocument();
    expect(screen.getByText('FSD: silent now; 14.0 h unknown in returned budget')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter returned signals by status'), { target: { value: 'silent' } });
    expect(screen.getByRole('button', { name: 'Inspect raw evidence: Nervous System (1 rows)' })).toBeInTheDocument();
  });

  it('keeps Car Kept Living lag unknown without a paired ingest reading', () => {
    renderAt('/tesla-physics/car-kept-living');
    expect(screen.getByText('Latest paired ingest lag')).toBeInTheDocument();
    expect(screen.getByText('Bounded history: 100 rows; available: Yes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Inspect unknown-hour budgets/ })).toHaveAttribute('href', '/tesla-physics/unknown');
  });

  it('keeps Vault HMAC status, cap warnings, and drive links', () => {
    renderAt('/tesla-physics/vault');
    expect(screen.getByText('Hash only: not an authenticated signature')).toBeInTheDocument();
    expect(screen.getByText('Drive session cap reached: drive boundaries are partial')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect raw evidence: Drive boundaries (1 rows)' }));
    expect(screen.getByRole('link', { name: '42 →' })).toHaveAttribute('href', '/drives/42');
  });

  it('compares range estimates without asserting true range', () => {
    renderAt('/tesla-physics/range');
    expect(screen.getByText('Estimate spread: 90.0 km')).toBeInTheDocument();
    expect(screen.getByText('Rated vs Typical: 40.0 km apart')).toBeInTheDocument();
    expect(screen.getByText('Difference relative to Rated: 10.0%')).toBeInTheDocument();
    expect(screen.getByText(/No true range/)).toBeInTheDocument();
  });

  it('does not turn an empty Life Tape into a measured zero-duration state', () => {
    const saved = report.life_tape.segments;
    report.life_tape.segments = [];
    try {
      renderAt('/tesla-physics/life-tape');
      expect(screen.getByText('No classified intervals returned. The report cannot reconstruct a state chronology for this window.')).toBeInTheDocument();
      expect(screen.getByText('Returned interval duration')).toBeInTheDocument();
      expect(screen.getByText('Sum of classified intervals / returned window: unknown')).toBeInTheDocument();
    } finally { report.life_tape.segments = saved; }
  });

  it('keeps mode state unknown if no fields are observed and names absent meter context', () => {
    const modes = report.modes;
    const meters = report.meters;
    try {
      Object.assign(report, { modes: { ...modes, valet: null, service: null, transport: null }, meters: null });
      renderAt('/tesla-physics/modes');
      expect(screen.getByText('Observed active modes: unknown')).toBeInTheDocument();
      expect(screen.getByText(/Meter evidence was not returned/)).toBeInTheDocument();
    } finally { report.modes = modes; report.meters = meters; }
  });

  it('keeps missing range comparisons unknown when only one estimate is returned', () => {
    const saved = report.range;
    report.range = { ...saved, est_range_m: null, ideal_range_m: null };
    try {
      renderAt('/tesla-physics/range');
      expect(screen.getByText(/At least two estimates are needed for a comparison/)).toBeInTheDocument();
      expect(screen.getByText('Estimate spread: unknown')).toBeInTheDocument();
    } finally { report.range = saved; }
  });

  it.each([
    ['clocks', 'clocks'], ['unknown', 'unknown_os'], ['car-kept-living', 'car_kept_living'],
    ['life-tape', 'life_tape'], ['contradictions', 'contradictions'], ['meters', 'meters'],
    ['logbook', 'logbook'], ['nervous-system', 'nervous_system'], ['modes', 'modes'],
    ['charge-port', 'charge_port_court'], ['black-box', 'black_box'], ['dictionary', 'dictionary'],
    ['range', 'range'], ['firmware-epochs', 'firmware_epochs'], ['vault', 'vault'],
  ] as const)('%s retains its own panel when source slice is null', (slug, slice) => {
    const saved = report[slice];
    try {
      Object.assign(report, { [slice]: null });
      renderAt(`/tesla-physics/${slug}`);
      expect(screen.getByText('This evidence slice was not returned. No measurement is inferred from its absence.')).toBeInTheDocument();
    } finally { Object.assign(report, { [slice]: saved }); }
  });

  it('honestly handles absent source metadata', () => {
    const saved = report.evidence;
    try {
      report.evidence = undefined;
      renderAt();
      expect(screen.getByText('Evidence coverage metadata was not returned; counts cannot establish completeness.')).toBeInTheDocument();
    } finally { report.evidence = saved; }
  });

  it('lazy-loads every page and matches route prefetch chunks', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const prefetch = readFileSync('src/lib/routePrefetch.ts', 'utf8');
    expect(app).toContain("const TeslaPhysics = lazy(() => import('./features/vehicles/pages/TeslaPhysicsPage'))");
    expect(prefetch).toContain("'/tesla-physics': () => import('../features/vehicles/pages/TeslaPhysicsPage')");
    for (const slug of Object.keys(pages)) {
      expect(app).toContain(`path="tesla-physics/${slug}" element={<SafeRoute`);
      expect(prefetch).toContain(`'/tesla-physics/${slug}': () => import('../features/vehicles/pages/Physics`);
    }
    expect(app).toContain('path="tesla-physics/ledger"');
    expect(app).toContain('path="tesla-only/*" element={<LegacyTeslaPhysicsRedirect />}');
  });
});
