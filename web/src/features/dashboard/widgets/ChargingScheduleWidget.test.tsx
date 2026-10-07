/**
 * ChargingScheduleWidget — behaviour, branch, null-safety and a11y coverage for
 * the dashboard's scheduled-charging widget.
 *
 * What this file pins:
 *   - the three exported pure helpers:
 *       · `parseScheduleSignals` — extraction of mode / pending / start /
 *         departure / charge-limit out of the raw live-signal map, incl. the
 *         null-safety guards this elevation added (blank/whitespace strings and
 *         non-finite charge limits collapse to null, `pending` accepts the
 *         boolean `true` AND the string `'true'`, a `0%` limit is preserved);
 *       · `modeLabel` — the i18n mode label incl. the unknown-mode passthrough
 *         and the null → "Unknown" fallback;
 *       · `modeBadgeVariant` — the success / neutral / warning tiering;
 *   - the widget's data-source resolution (explicit `vehicleId` prop vs. the
 *     first fleet vehicle vs. an empty fleet → id 0 so the live query stays
 *     disabled), and that the live-signals query is wired to
 *     `/signals/{id}/live` with the `?? {}` fallback;
 *   - every render state fanned out by `WidgetShell` — loading skeleton, the
 *     error affordance (red freshness dot + working Refresh control), and the
 *     empty state (never a blank panel);
 *   - the populated full-size body — the mode badge, the pending badge, the
 *     visual timeline (start / departure / target-limit rows with formatted
 *     times), the "no scheduled times" fallback, and the tall detail row
 *     (current level + charging status, incl. the missing-level → 0 guard);
 *   - the compact (1×1) variant — the charge-limit hero, the "—" unknown-limit
 *     guard, and its own empty state;
 *   - a11y — the decorative icons are hidden from the a11y tree and the refresh
 *     affordance exposes an accessible name.
 *
 * Strategy: the two vehicle hooks (`useVehicles`, `useVehicleState`), the
 * inline TanStack `useQuery`, the API `request` client and the date formatter
 * are all mocked so no network is touched and every query state is controllable
 * per-test. i18n is a passthrough that honours the English default and
 * interpolates `{{var}}` tokens so the visible copy is deterministic and real.
 * The date formatter is a deterministic `time:<value>` stub so timeline times
 * assert as stable strings independent of the host locale / timezone. The
 * widget is rendered inside a MemoryRouter because the shared feedback
 * components it composes may reach for router context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { VehicleState } from '@/api/types';
import ChargingScheduleWidget, {
  parseScheduleSignals,
  modeLabel,
  modeBadgeVariant,
} from './ChargingScheduleWidget';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default and interpolates {{var}} tokens
// so any count-bearing copy is asserted as a real string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useVehiclesMock, useVehicleStateMock, useQueryMock, requestMock, formatTimeMock } =
  vi.hoisted(() => ({
    useVehiclesMock: vi.fn(),
    useVehicleStateMock: vi.fn(),
    useQueryMock: vi.fn(),
    requestMock: vi.fn(),
    formatTimeMock: vi.fn(),
  }));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: (options: unknown) => useQueryMock(options) };
});

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
  useVehicleState: (id: number) => useVehicleStateMock(id),
}));

vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => formatTimeMock(value) }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

type LiveSignals = Record<string, { value: unknown; timestamp: string }>;

/** Wrap a raw value as the `{ value, timestamp }` envelope the API returns. */
function sig(value: unknown): { value: unknown; timestamp: string } {
  return { value, timestamp: '2024-01-01T00:00:00Z' };
}

interface SignalsQueryResult {
  data: LiveSignals | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeSignalsResult(over: Partial<SignalsQueryResult> = {}): SignalsQueryResult {
  return {
    data: {},
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 64,
    rated_range: 0,
    ideal_range: 0,
    odometer: 0,
    inside_temp: 0,
    outside_temp: 0,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '',
    ...over,
  };
}

interface StateResult {
  data: { state?: VehicleState; live: boolean } | undefined;
  isLoading: boolean;
}

function makeStateResult(over: Partial<StateResult> = {}): StateResult {
  return { data: { state: makeState(), live: true }, isLoading: false, ...over };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <ChargingScheduleWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

/** Options object the widget passed to the mocked `useQuery` on last render. */
interface CapturedQuery {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
  enabled: boolean;
  staleTime: number;
}
function lastQueryOptions(): CapturedQuery {
  return useQueryMock.mock.calls.at(-1)?.[0] as CapturedQuery;
}

beforeEach(() => {
  useVehiclesMock.mockReset();
  useVehicleStateMock.mockReset();
  useQueryMock.mockReset();
  requestMock.mockReset();
  formatTimeMock.mockReset();

  useVehiclesMock.mockReturnValue({ data: [] });
  useVehicleStateMock.mockReturnValue(makeStateResult());
  useQueryMock.mockReturnValue(makeSignalsResult());
  requestMock.mockResolvedValue({ signals: {} });
  // Deterministic, locale-independent time formatting for timeline assertions.
  formatTimeMock.mockImplementation((value: unknown) => `time:${String(value)}`);
});

// ── Pure helper: parseScheduleSignals ────────────────────────────────────────

describe('parseScheduleSignals', () => {
  it('extracts every field from a well-formed signal map', () => {
    const signals: LiveSignals = {
      ScheduledChargingMode: sig('StartAt'),
      ScheduledChargingPending: sig(true),
      ScheduledChargingStartTime: sig('2024-01-01T08:00:00Z'),
      ScheduledDepartureTime: sig('2024-01-01T09:30:00Z'),
      ChargeLimitSoc: sig(80),
    };

    expect(parseScheduleSignals(signals)).toEqual({
      mode: 'StartAt',
      pending: true,
      startTime: '2024-01-01T08:00:00Z',
      departureTime: '2024-01-01T09:30:00Z',
      chargeLimit: 80,
    });
  });

  it('defaults everything to null / false for an empty map', () => {
    expect(parseScheduleSignals({})).toEqual({
      mode: null,
      pending: false,
      startTime: null,
      departureTime: null,
      chargeLimit: null,
    });
  });

  it('reads `pending` from the boolean true AND the string "true", nothing else', () => {
    expect(parseScheduleSignals({ ScheduledChargingPending: sig(true) }).pending).toBe(true);
    expect(parseScheduleSignals({ ScheduledChargingPending: sig('true') }).pending).toBe(true);
    expect(parseScheduleSignals({ ScheduledChargingPending: sig('yes') }).pending).toBe(false);
    expect(parseScheduleSignals({ ScheduledChargingPending: sig(1) }).pending).toBe(false);
  });

  it('coerces non-string mode and non-number charge limit to null', () => {
    const result = parseScheduleSignals({
      ScheduledChargingMode: sig(42),
      ChargeLimitSoc: sig('80'),
    });
    expect(result.mode).toBeNull();
    expect(result.chargeLimit).toBeNull();
  });

  it('collapses blank / whitespace-only strings to null (no empty badge)', () => {
    const result = parseScheduleSignals({
      ScheduledChargingMode: sig('   '),
      ScheduledChargingStartTime: sig(''),
      ScheduledDepartureTime: sig('\t\n'),
    });
    expect(result.mode).toBeNull();
    expect(result.startTime).toBeNull();
    expect(result.departureTime).toBeNull();
  });

  it('trims surrounding whitespace on otherwise valid strings', () => {
    const result = parseScheduleSignals({
      ScheduledChargingMode: sig('  StartAt  '),
      ScheduledChargingStartTime: sig(' 2024-01-01T08:00:00Z '),
    });
    expect(result.mode).toBe('StartAt');
    expect(result.startTime).toBe('2024-01-01T08:00:00Z');
  });

  it('preserves a 0% charge limit but rejects a non-finite one', () => {
    expect(parseScheduleSignals({ ChargeLimitSoc: sig(0) }).chargeLimit).toBe(0);
    expect(parseScheduleSignals({ ChargeLimitSoc: sig(NaN) }).chargeLimit).toBeNull();
    expect(parseScheduleSignals({ ChargeLimitSoc: sig(Infinity) }).chargeLimit).toBeNull();
  });
});

// ── Pure helper: modeLabel ───────────────────────────────────────────────────

describe('modeLabel', () => {
  const tt = (_key: string, fallback: string) => fallback;

  it('maps the known modes to their English labels', () => {
    expect(modeLabel('StartAt', tt)).toBe('Start At');
    expect(modeLabel('DepartBy', tt)).toBe('Depart By');
    expect(modeLabel('Off', tt)).toBe('Off');
  });

  it('passes an unknown non-null mode through verbatim', () => {
    expect(modeLabel('Custom', tt)).toBe('Custom');
  });

  it('falls back to "Unknown" for a null mode', () => {
    expect(modeLabel(null, tt)).toBe('Unknown');
  });
});

// ── Pure helper: modeBadgeVariant ────────────────────────────────────────────

describe('modeBadgeVariant', () => {
  it('marks the active scheduling modes as success', () => {
    expect(modeBadgeVariant('StartAt')).toBe('success');
    expect(modeBadgeVariant('DepartBy')).toBe('success');
  });

  it('marks the Off mode as neutral', () => {
    expect(modeBadgeVariant('Off')).toBe('neutral');
  });

  it('marks null / unknown modes as warning', () => {
    expect(modeBadgeVariant(null)).toBe('warning');
    expect(modeBadgeVariant('Custom')).toBe('warning');
  });
});

// ── Data-source resolution + query wiring ────────────────────────────────────

describe('ChargingScheduleWidget — vehicle resolution', () => {
  it('reads state for the explicit vehicleId prop and enables the live query', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 99 }] });
    renderWidget({ cols: 2, rows: 2 }, 42);

    expect(useVehicleStateMock).toHaveBeenCalledWith(42);
    const opts = lastQueryOptions();
    expect(opts.enabled).toBe(true);
    expect(opts.queryKey).toEqual(['signals', 42, 'live-schedule']);
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget();
    expect(useVehicleStateMock).toHaveBeenCalledWith(7);
    expect(lastQueryOptions().queryKey).toEqual(['signals', 7, 'live-schedule']);
  });

  it('falls back to id 0 with the live query disabled when the fleet is empty', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(useVehicleStateMock).toHaveBeenCalledWith(0);
    expect(lastQueryOptions().enabled).toBe(false);
  });

  it('wires the live query to /signals/{id}/live and unwraps `signals` (with a `{}` fallback)', async () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 5 }] });
    renderWidget();
    const { queryFn } = lastQueryOptions();

    requestMock.mockResolvedValueOnce({ signals: { ChargeLimitSoc: sig(90) } });
    await expect(queryFn()).resolves.toEqual({ ChargeLimitSoc: sig(90) });
    expect(requestMock).toHaveBeenCalledWith('/signals/5/live');

    requestMock.mockResolvedValueOnce({});
    await expect(queryFn()).resolves.toEqual({});
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('ChargingScheduleWidget — states', () => {
  it('renders a loading skeleton while the signals query is pending', () => {
    useQueryMock.mockReturnValue(makeSignalsResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No schedule data')).toBeNull();
    expect(screen.queryByText('Charging Schedule')).toBeNull();
  });

  it('also shows the skeleton while the vehicle-state query is pending', () => {
    useVehicleStateMock.mockReturnValue(makeStateResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the empty state (never a blank panel) when there is no schedule data', () => {
    useQueryMock.mockReturnValue(makeSignalsResult({ data: {} }));
    renderWidget();
    expect(screen.getByText('No schedule data')).toBeInTheDocument();
    // The panel shell + title still render around the empty state.
    expect(screen.getByText('Charging Schedule')).toBeInTheDocument();
  });

  it('surfaces an error affordance (red freshness dot + Refresh) on failure', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({ isError: true, dataUpdatedAt: 0, data: undefined }),
    );
    const { container } = renderWidget();
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    // No data yet → an empty panel, never a blank one.
    expect(screen.getByText('No schedule data')).toBeInTheDocument();
  });

  it('refetches the live signals when the freshness control is activated', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue(
      makeSignalsResult({ data: { ChargeLimitSoc: sig(70) }, refetch }),
    );
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Populated full-size body ─────────────────────────────────────────────────

describe('ChargingScheduleWidget — populated (full size)', () => {
  it('renders the mode badge label and hides the pending badge when not pending', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({ data: { ScheduledChargingMode: sig('StartAt') } }),
    );
    renderWidget({ cols: 2, rows: 1 });
    expect(screen.getByText('Start At')).toBeInTheDocument();
    expect(screen.queryByText('Pending')).toBeNull();
    // No scheduled times were provided → the timeline placeholder shows.
    expect(screen.getByText('No scheduled times set')).toBeInTheDocument();
  });

  it('shows the pending badge next to the mode when a schedule is pending', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({
        data: { ScheduledChargingMode: sig('StartAt'), ScheduledChargingPending: sig(true) },
      }),
    );
    renderWidget({ cols: 2, rows: 1 });
    // startTime is absent → the ONLY "Pending" is the mode-area badge.
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders the full timeline (start, departure, target limit) with formatted times', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({
        data: {
          ScheduledChargingMode: sig('StartAt'),
          ScheduledChargingStartTime: sig('08:00'),
          ScheduledDepartureTime: sig('09:30'),
          ChargeLimitSoc: sig(80),
        },
      }),
    );
    renderWidget({ cols: 2, rows: 1 });

    expect(screen.getByText('Start Charging')).toBeInTheDocument();
    expect(screen.getByText('Departure')).toBeInTheDocument();
    expect(screen.getByText('Target Limit')).toBeInTheDocument();

    // Times pass through the (mocked) formatter; the limit renders as a %.
    expect(screen.getByText('time:08:00')).toBeInTheDocument();
    expect(screen.getByText('time:09:30')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(formatTimeMock).toHaveBeenCalledWith('08:00');
    expect(formatTimeMock).toHaveBeenCalledWith('09:30');
  });

  it('annotates the start row with a "Pending" subtitle when pending + start time exist', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({
        data: {
          ScheduledChargingMode: sig('StartAt'),
          ScheduledChargingPending: sig(true),
          ScheduledChargingStartTime: sig('08:00'),
        },
      }),
    );
    renderWidget({ cols: 2, rows: 1 });
    // Two "Pending" strings now: the mode-area badge AND the timeline subtitle.
    expect(screen.getAllByText('Pending')).toHaveLength(2);
  });

  it('shows the "no scheduled times" placeholder when a mode exists but no times do', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({ data: { ScheduledChargingMode: sig('Off') } }),
    );
    renderWidget({ cols: 2, rows: 1 });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText('No scheduled times set')).toBeInTheDocument();
    expect(screen.queryByText('Target Limit')).toBeNull();
  });

  it('renders the tall detail row with the current level and charging status', () => {
    useVehicleStateMock.mockReturnValue(
      makeStateResult({ data: { state: makeState({ battery_level: 55, is_charging: true }), live: true } }),
    );
    useQueryMock.mockReturnValue(
      makeSignalsResult({ data: { ScheduledChargingMode: sig('StartAt') } }),
    );
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Current Level')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
  });

  it('reads "Not Charging" and floors a missing battery level to 0% in the tall row', () => {
    useVehicleStateMock.mockReturnValue(
      makeStateResult({
        data: {
          state: makeState({ battery_level: undefined as unknown as number, is_charging: false }),
          live: true,
        },
      }),
    );
    useQueryMock.mockReturnValue(
      makeSignalsResult({ data: { ScheduledChargingMode: sig('StartAt') } }),
    );
    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Not Charging')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText('NaN%')).toBeNull();
  });

  it('omits the tall detail row when no vehicle snapshot has landed', () => {
    useVehicleStateMock.mockReturnValue(makeStateResult({ data: { state: undefined, live: false } }));
    useQueryMock.mockReturnValue(
      makeSignalsResult({ data: { ScheduledChargingMode: sig('StartAt') } }),
    );
    renderWidget({ cols: 2, rows: 2 });
    // Primary content still renders; the supplementary detail row does not.
    expect(screen.getByText('Start At')).toBeInTheDocument();
    expect(screen.queryByText('Current Level')).toBeNull();
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('ChargingScheduleWidget — compact', () => {
  it('renders the charge-limit hero and its label', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({ data: { ChargeLimitSoc: sig(85) } }),
    );
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('Charge Limit')).toBeInTheDocument();
    // Compact drops the header title + timeline.
    expect(screen.queryByText('Charging Schedule')).toBeNull();
    expect(screen.queryByText('Target Limit')).toBeNull();
  });

  it('shows an em-dash when there is schedule data but no charge limit', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({ data: { ScheduledChargingMode: sig('Off') } }),
    );
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Charge Limit')).toBeInTheDocument();
  });

  it('renders the empty state in compact mode when there is no data', () => {
    useQueryMock.mockReturnValue(makeSignalsResult({ data: {} }));
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('No schedule data')).toBeInTheDocument();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('ChargingScheduleWidget — accessibility', () => {
  it('hides the decorative icons from the a11y tree and names the refresh control', () => {
    useQueryMock.mockReturnValue(
      makeSignalsResult({
        data: {
          ScheduledChargingMode: sig('StartAt'),
          ScheduledChargingStartTime: sig('08:00'),
          ScheduledDepartureTime: sig('09:30'),
          ChargeLimitSoc: sig(80),
        },
      }),
    );
    const { container } = renderWidget({ cols: 2, rows: 1 });

    // Header Calendar + the three timeline icons are all aria-hidden.
    expect(
      container.querySelectorAll('svg[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      screen.getByRole('button', { name: /refresh/i }),
    ).toHaveAttribute('aria-label', expect.stringMatching(/^Refresh/));
  });
});
