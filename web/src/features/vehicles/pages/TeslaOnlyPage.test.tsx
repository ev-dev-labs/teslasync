import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ExclusiveReport } from '@/types/teslaPhysics';
import { formatDateTime } from '@/lib/dateFormat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (meters: number) => `${(meters / 1000).toFixed(1)} km`,
    formatEnergy: (wh: number) => `${(wh / 1000).toFixed(1)} kWh`,
  }),
}));
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

const report: ExclusiveReport = {
  vehicle_id: 7,
  clocks: {
    vehicle_id: 7,
    latest: {
      event_time: '2026-03-01T11:50:00Z',
      ingest_time: null,
      display_time: '2026-03-01T12:00:00Z',
      gap_s: 600,
      unknown: true,
    },
    samples: [],
    honesty: 'signal_log time is vehicle event time. Ingest time is unknown unless the envelope stored it. Display time is now. Gaps stay gaps.',
  },
  life_tape: {
    vehicle_id: 7,
    from: '2026-03-01T11:00:00Z',
    to: '2026-03-01T12:00:00Z',
    segments: [{ state: 'neutral_rolling', started_at: '2026-03-01T11:00:00Z', ended_at: '2026-03-01T11:05:00Z', duration_s: 300 }],
    honesty: 'Every second is Confirmed Park, Neutral rolling, Drive, Reverse, plugged-not-charging, Charging, Complete-still-plugged, Unplugged, or Unknown. This is not a GPS trip list.',
  },
  contradictions: {
    vehicle_id: 7,
    findings: [],
    honesty: 'MQTT/live physics vs Tesla charge/gear language. Complete still latched is expected. Gear=P with speed is a contradiction. Neutral is rolling, not parked.',
  },
  meters: {
    vehicle_id: 7,
    odometer_m: 9000000,
    driving_distance_m: 12000,
    fsd_distance_m: null,
    resets: [],
    honesty: 'Odometer, MilesSinceReset, and SelfDrivingMilesSinceReset are trip meters. A drop is a reset or a gap. Null is not zero.',
  },
  unknown_os: {
    vehicle_id: 7,
    window_hours: 14,
    sample_hours: null,
    unknown_hours: null,
    budgets: [{ kind: 'fsd', hours: 14, unknown: true }],
    honesty: 'Unknown hours are a budget, never a measured zero. Missing Park, Charge, FSD, or motion stays unknown.',
  },
  car_kept_living: {
    vehicle_id: 7,
    last_telemetry_at: '2026-03-01T11:50:00Z',
    mqtt_connected: null,
    queued_count: null,
    replay_preserves_event_time: true,
    never_received_gap_s: null,
    notes: ['Queue depth is unknown unless the broker reports it.'],
    honesty: 'After carbon or MQTT loss: what may have queued, what replays with original event time, and what the car did that we never received. Queue depth is unknown unless the broker reports it.',
  },
  logbook: {
    vehicle_id: 7,
    entries: [{ word: 'Neutral', at: '2026-03-01T11:00:00Z', ended_at: '2026-03-01T11:05:00Z', kind: 'gear', id: 1 }],
    honesty: 'Sessions are narrated as Park, Drive, Reverse, Neutral, Charging, Stopped, Complete, Disconnected — Tesla words, not GPS trips.',
  },
  firmware_epochs: {
    vehicle_id: 7,
    epochs: [{ version: '2026.20.3', started_at: '2026-02-01T00:00:00Z', ended_at: null, fsd_meter_start_m: null, fsd_meter_end_m: null, complete_to_unplug_s: null, honesty: 'Each software version is a physics baseline for this VIN. Changes are correlation, not proof that FSD got better.' }],
    honesty: 'Each software version is a physics baseline for this VIN. Changes are correlation, not proof that FSD got better.',
  },
  charge_port_court: {
    vehicle_id: 7,
    evidence: [{ at: '2026-03-01T11:40:00Z', latch: 'Engaged', door_open: true, pack_current_a: 0, charge_state: 'Complete' }],
    honesty: 'Latch, door, pack current, ChargeState, and schedule are one evidence chain. Complete-to-unplug is etiquette, not a Tesla penalty score.',
  },
  black_box: {
    vehicle_id: 7,
    trigger: 'unplug',
    from: '2026-03-01T11:48:30Z',
    to: '2026-03-01T11:50:00Z',
    frames: [],
    honesty: 'High-resolution samples in the 90 seconds before confirmed Park, unplug, or a telemetry gap. Tesla will not give you this black box.',
  },
  dictionary: {
    vehicle_id: 7,
    typical_complete_unplug_s: null,
    park_confirm_dwell_s: 30,
    complete_without_schedule: null,
    honesty: 'Priors for this car only: Complete-to-unplug, Park confirm dwell, and Complete without a schedule. Missing evidence stays unknown.',
  },
  vault: {
    vehicle_id: 7,
    certificate: {
      vehicle_id: 7,
      issued_at: '2026-03-01T12:00:00Z',
      from: '2026-02-15T12:00:00Z',
      to: '2026-03-01T12:00:00Z',
      rules: 'Park ends drives. Disconnected ends charges.',
      drives: [],
      charges: [],
      integrity_sha256: 'abc',
      hmac_sha256: null,
      honesty: 'Hashed export of session boundaries.',
    },
    unknown_hours: null,
    firmware_versions: ['2026.20.3'],
    etiquette_dwells_s: [],
    honesty: 'Signed session boundaries plus unknown hours, firmware epochs, and Supercharger etiquette. Not a legal instrument unless HMAC is configured.',
  },
  modes: {
    vehicle_id: 7,
    valet: false,
    service: false,
    transport: null,
    allowed: [],
    forbidden: ['Unknown mode is unknown. Transport is unknown without a Tesla field.'],
    honesty: 'Valet, Service, and Transport change what TeslaSync may infer. Service-mode amnesia. Neutral tow is not Park. Unknown mode is unknown.',
  },
  nervous_system: {
    vehicle_id: 7,
    nerves: [{ field: 'SelfDrivingMilesSinceReset', status: 'silent', detail: 'No FSD trip-meter sample in the window.' }],
    honesty: 'BMS, Gear, latch, and trip meters are alive, silent, or contradicting. Silence is not a zero.',
  },
  range: {
    vehicle_id: 7,
    rated_range_m: 400000,
    est_range_m: 360000,
    ideal_range_m: 450000,
    energy_remaining_wh: 62000,
    recent_wh_per_km: null,
    disagree: true,
    true_range_m: null,
    honesty: 'Rated, typical, ideal, and energy remaining can disagree. This panel never picks a true range.',
  },
};

function queryStub<T>(data: T) {
  return {
    data,
    error: null,
    isError: false,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    fetchStatus: 'idle' as const,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  };
}

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useTeslaExclusive: () => queryStub(report),
}));

import TeslaOnlyPage from './TeslaOnlyPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TeslaOnlyPage />
    </MemoryRouter>,
  );
}

describe('TeslaOnlyPage', () => {
  it('renders the physics hub as feature cards without inventing zeros', () => {
    renderAt('/tesla-only');
    expect(screen.getByText('Tesla Physics')).toBeInTheDocument();
    expect(screen.getByText('Three Clocks')).toBeInTheDocument();
    expect(screen.getByText('Life Tape')).toBeInTheDocument();
    expect(screen.getByText('Range Disagreement')).toBeInTheDocument();
    expect(screen.queryByText('0.0 km')).toBeNull();
    expect(screen.queryByText(/FSD is on/i)).toBeNull();
    expect(screen.getByText('Where to start')).toBeInTheDocument();
    expect(screen.getByText('Inspect missing coverage')).toBeInTheDocument();
    expect(screen.getByText('Sampled window')).toBeInTheDocument();
  });

  it('shows observed port current and schedule alongside charge state', () => {
    const original = report.charge_port_court.evidence;
    report.charge_port_court.evidence = [{
      at: '2026-03-01T11:40:00Z', latch: 'Engaged', door_open: true,
      pack_current_a: 12.5, charge_state: 'Charging', scheduled_mode: 'OffPeak',
    }];
    try {
      renderAt('/tesla-only/charge-port');
      expect(screen.getByText('12.5 A')).toBeInTheDocument();
      expect(screen.getByText('OffPeak')).toBeInTheDocument();
      expect(screen.getByText('Continue the investigation')).toBeInTheDocument();
    } finally {
      report.charge_port_court.evidence = original;
    }
  });

  it('does not convert null report slices into fabricated findings', () => {
    const original = report.contradictions.findings;
    report.contradictions.findings = null as unknown as ExclusiveReport['contradictions']['findings'];
    try {
      renderAt('/tesla-only/contradictions');
      expect(screen.getByText(/No contradictions in the window/)).toBeInTheDocument();
    } finally {
      report.contradictions.findings = original;
    }
  });

  it('distinguishes a bare hash from an authenticated vault', () => {
    renderAt('/tesla-only/vault');
    expect(screen.getByText('Hash only: not an authenticated signature')).toBeInTheDocument();
    expect(screen.getByText(/Certificate window:/)).toBeInTheDocument();
  });

  it('shows available range spread without claiming true range', () => {
    renderAt('/tesla-only/range');
    expect(screen.getByText('Estimate spread: 90.0 km')).toBeInTheDocument();
    expect(screen.getByText('Estimates differ')).toBeInTheDocument();
  });

  it('links logbook sessions to their recorded drive', () => {
    const original = report.logbook.entries;
    report.logbook.entries = [{
      word: 'Drive', at: '2026-03-01T11:00:00Z', ended_at: null, kind: 'drive', id: 42,
    }];
    try {
      renderAt('/tesla-only/logbook');
      expect(screen.getByRole('link', { name: 'Drive →' })).toHaveAttribute('href', '/drives/42');
    } finally {
      report.logbook.entries = original;
    }
  });

  it('filters life tape by observed state without dropping the other evidence', () => {
    const original = report.life_tape.segments;
    report.life_tape.segments = [
      ...original,
      { state: 'charging', started_at: '2026-03-01T11:05:00Z', ended_at: '2026-03-01T11:10:00Z', duration_s: 300 },
    ];
    try {
      renderAt('/tesla-only/life-tape');
      fireEvent.change(screen.getByLabelText('Filter by state'), { target: { value: 'charging' } });
      expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('charging'))).toBe(true);
      expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('neutral_rolling'))).toBe(false);
      fireEvent.change(screen.getByLabelText('Filter by state'), { target: { value: '' } });
      expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('neutral_rolling'))).toBe(true);
    } finally {
      report.life_tape.segments = original;
    }
  });

  it('keeps ingest time unknown on the clocks page', () => {
    renderAt('/tesla-only/clocks');
    expect(screen.getAllByText(/Ingest time is unknown/).length).toBeGreaterThan(0);
  });

  it('shows stored ingest time on the clocks page', () => {
    const originalLatest = report.clocks.latest;
    const originalSamples = report.clocks.samples;
    report.clocks.latest = {
      event_time: '2026-03-01T11:50:00Z',
      ingest_time: '2026-03-01T11:50:02Z',
      display_time: '2026-03-01T12:00:00Z',
      gap_s: 600,
      unknown: false,
    };
    report.clocks.samples = [report.clocks.latest];
    try {
      renderAt('/tesla-only/clocks');
      expect(screen.getAllByText(formatDateTime('2026-03-01T11:50:02Z')).length).toBeGreaterThan(0);
    } finally {
      report.clocks.latest = originalLatest;
      report.clocks.samples = originalSamples;
    }
  });

  it('keeps Neutral rolling on the life tape', () => {
    renderAt('/tesla-only/life-tape');
    expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('neutral_rolling'))).toBe(true);
    expect(screen.getByText('5.0 min')).toBeInTheDocument();
  });

  it('keeps MQTT unknown instead of inventing a disconnect', () => {
    renderAt('/tesla-only/car-kept-living');
    expect(screen.getByText('MQTT state unknown')).toBeInTheDocument();
    expect(screen.queryByText('MQTT not connected')).toBeNull();
  });

  it('keeps FSD trip meters unknown instead of zero', () => {
    renderAt('/tesla-only/meters');
    expect(screen.getByText('FSD trip meter')).toBeInTheDocument();
    expect(screen.queryByText('0.0 km')).toBeNull();
  });

  it('keeps Complete still latched as expected, not a contradiction', () => {
    renderAt('/tesla-only/contradictions');
    expect(screen.getAllByText(/Complete still latched is expected/).length).toBeGreaterThan(0);
  });

  it('keeps Transport unknown on mode laws', () => {
    renderAt('/tesla-only/modes');
    expect(screen.getByText(/Transport is unknown without a Tesla field/)).toBeInTheDocument();
  });

  it('paginates life tape instead of dropping older segments', () => {
    const original = report.life_tape.segments;
    report.life_tape.segments = Array.from({ length: 30 }, (_, i) => ({
      state: `seg-${i}`,
      started_at: `2026-03-01T10:${String(i).padStart(2, '0')}:00Z`,
      ended_at: `2026-03-01T10:${String(i).padStart(2, '0')}:30Z`,
      duration_s: 30,
    }));
    try {
      renderAt('/tesla-only/life-tape');
      expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();
      expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('seg-29'))).toBe(true);
      expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('seg-0'))).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(screen.getAllByRole('row').some((row) => row.textContent?.includes('seg-0'))).toBe(true);
      expect(screen.getByText('Showing 26–30 of 30')).toBeInTheDocument();
    } finally {
      report.life_tape.segments = original;
    }
  });

  it('paginates the Tesla-language logbook instead of keeping only the last 40 entries', () => {
    const original = report.logbook.entries;
    report.logbook.entries = Array.from({ length: 40 }, (_, i) => ({
      word: i === 0 ? 'Park' : i === 39 ? 'Drive' : 'Neutral',
      at: `2026-03-01T11:${String(i).padStart(2, '0')}:00Z`,
      ended_at: null,
      kind: 'gear',
      id: i + 1,
    }));
    try {
      renderAt('/tesla-only/logbook');
      expect(screen.getByText('Showing 1–25 of 40')).toBeInTheDocument();
      expect(screen.getByText('Drive')).toBeInTheDocument();
      expect(screen.queryByText('Park')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(screen.getByText('Park')).toBeInTheDocument();
      expect(screen.getByText('Showing 26–40 of 40')).toBeInTheDocument();
    } finally {
      report.logbook.entries = original;
    }
  });

  it('does not claim FSD engagement on the range page', () => {
    renderAt('/tesla-only/range');
    expect(screen.getAllByText('Range Disagreement').length).toBeGreaterThan(0);
    expect(screen.queryByText(/FSD is on/i)).toBeNull();
    expect(screen.getByText(/No true range/)).toBeInTheDocument();
    expect(screen.queryByText('true_range must stay empty')).toBeNull();
    expect(screen.getAllByText(/never picks a true range/).length).toBeGreaterThan(0);
  });
});
