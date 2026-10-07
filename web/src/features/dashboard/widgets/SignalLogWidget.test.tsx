/**
 * SignalLogWidget — behaviour + hardening coverage.
 *
 * The widget streams the latest `signal_log` observations for the first (or
 * explicitly selected) vehicle into a WidgetShell. At 2×N it renders a
 * pausable most-recent-first event feed (one row per observation: a
 * source badge, the signal name, its formatted value, and a relative time).
 * At 1×N it collapses to a compact "signals/sec" hero summed from the
 * fleet-wide MQTT status. Every data hook (`useSignalObservations`,
 * `useMQTTStatus`, `useVehicles`) is mocked so the network is never touched.
 *
 * It exposes a default component plus two pure helpers
 * (`formatSignalValue`, `deriveSignalRate`).
 *
 * Facets covered:
 *   - formatSignalValue: finite-numeric (incl. 0) → string; the NaN/Infinity
 *     hardening (non-finite numerics collapse to "—" instead of leaking
 *     "NaN"/"Infinity"); non-empty text vs empty-string placeholder; the
 *     bool → "true"/"false" branch; and the all-null placeholder.
 *   - deriveSignalRate: camelCase-over-snake_case precedence, `safeNumber`
 *     coercion of junk/missing rates (no NaN poisoning), and null-safety for
 *     undefined/null/empty fleets.
 *   - standard (2×N): title, list semantics, per-source badge labels
 *     (MQTT/API/Cache), formatted values, most-recent-first ordering, the
 *     i18n'd source labels + the null-source "Cache" default + unknown-source
 *     passthrough.
 *   - pause/resume: activating Pause freezes the feed against fresh data and
 *     flips the control's accessible name to Resume; resuming re-attaches the
 *     live stream (a11y — icon-only control exposed by aria-label).
 *   - empty / loading / error states (EmptyState role="status", Skeleton,
 *     and the non-blocking error branch that still renders stale rows).
 *   - compact (1×N): the signals/sec hero from the summed rate, its null-safe
 *     zero, and the withheld feed + pause control.
 *   - refresh: the accessible freshness control refetches.
 *   - vehicle-id resolution: explicit prop, first-vehicle fallback, and the
 *     disabled (id 0) query when no vehicle exists — always with the limit 20.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SignalObservation } from '@/types/signals';
import type { VehicleTelemetry } from '@/types/telemetry';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string | Record<string, unknown>) =>
      typeof def === 'string' ? def : _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Data hooks, driven per test. ──
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalObservations: vi.fn(),
  useMQTTStatus: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));

import { useSignalObservations, useMQTTStatus } from '@/api/hooks/useTelemetry';
import { useVehicles } from '@/api/hooks/useVehicles';
import SignalLogWidget, {
  formatSignalValue,
  deriveSignalRate,
} from './SignalLogWidget';

const mockObs = useSignalObservations as unknown as ReturnType<typeof vi.fn>;
const mockMqtt = useMQTTStatus as unknown as ReturnType<typeof vi.fn>;
const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;

const MIN = 60_000;

/** ISO string `ms` milliseconds in the past (drives the relative-time feed). */
function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeObs(over: Partial<SignalObservation> = {}): SignalObservation {
  return {
    vehicle_id: 1,
    ts: isoAgo(MIN),
    signal_name: 'signal',
    value_numeric: null,
    value_text: null,
    value_bool: null,
    source: 'fleet_telemetry',
    ...over,
  };
}

const COMPACT = { cols: 1, rows: 2 };
const STANDARD = { cols: 2, rows: 2 };

function setup(
  opts: {
     
    obs?: any;
     
    mqtt?: any;
     
    vehicles?: any;
  } = {},
) {
  mockObs.mockReturnValue(opts.obs ?? makeQuery({ data: [] }));
  mockMqtt.mockReturnValue(opts.mqtt ?? makeQuery({ data: undefined }));
  mockVehicles.mockReturnValue(opts.vehicles ?? { data: [{ id: 1 }] });
}

function renderWidget(size: { cols: number; rows: number }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <SignalLogWidget vehicleId={vehicleId} size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Force reduced-motion so WidgetBigNumber's AnimatedNumber lands on its
  // target synchronously (no rAF tween) — otherwise the compact hero renders
  // its initial 0 and the assertion would race the animation.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

describe('formatSignalValue', () => {
  it('renders a finite numeric value (including 0) as its string', () => {
    expect(formatSignalValue(makeObs({ value_numeric: 42 }))).toBe('42');
    expect(formatSignalValue(makeObs({ value_numeric: 0 }))).toBe('0');
    expect(formatSignalValue(makeObs({ value_numeric: -3.5 }))).toBe('-3.5');
  });

  it('rejects non-finite numerics and falls through to the "—" placeholder', () => {
    // Regression: the pre-hardening `!= null` guard let NaN / Infinity reach
    // String() and leaked "NaN" / "Infinity" into the feed subtitle.
    expect(formatSignalValue(makeObs({ value_numeric: NaN }))).toBe('—');
    expect(formatSignalValue(makeObs({ value_numeric: Infinity }))).toBe('—');
    expect(formatSignalValue(makeObs({ value_numeric: -Infinity }))).toBe('—');
  });

  it('renders non-empty text and collapses empty text to the placeholder', () => {
    expect(
      formatSignalValue(makeObs({ value_numeric: null, value_text: 'Charging' })),
    ).toBe('Charging');
    expect(
      formatSignalValue(makeObs({ value_numeric: null, value_text: '' })),
    ).toBe('—');
  });

  it('renders booleans as "true" / "false"', () => {
    expect(
      formatSignalValue(makeObs({ value_numeric: null, value_bool: true })),
    ).toBe('true');
    expect(
      formatSignalValue(makeObs({ value_numeric: null, value_bool: false })),
    ).toBe('false');
  });

  it('returns the em-dash placeholder when every value is null', () => {
    expect(
      formatSignalValue(
        makeObs({ value_numeric: null, value_text: null, value_bool: null }),
      ),
    ).toBe('—');
  });
});

describe('deriveSignalRate', () => {
  it('sums camelCase + snake_case rates and coerces junk / missing to 0', () => {
    const rate = deriveSignalRate([
      { signalsPerSecond: 5 },
      { signals_per_second: 7 },
      { signalsPerSecond: 'oops' },
      {},
    ] as unknown as VehicleTelemetry[]);
    // 5 + 7 + safeNumber('oops')=0 + safeNumber(undefined)=0 → 12, never NaN.
    expect(rate).toBe(12);
    expect(Number.isNaN(rate)).toBe(false);
  });

  it('prefers the camelCase field over the snake_case alias', () => {
    expect(
      deriveSignalRate([
        { signalsPerSecond: 3, signals_per_second: 99 },
      ] as unknown as VehicleTelemetry[]),
    ).toBe(3);
  });

  it('is null-safe for undefined, null, and empty fleets', () => {
    expect(deriveSignalRate(undefined)).toBe(0);
    expect(deriveSignalRate(null)).toBe(0);
    expect(deriveSignalRate([])).toBe(0);
  });
});

describe('SignalLogWidget — standard layout (2×2)', () => {
  it('renders the title and one labelled row per observation with its value + source badge', () => {
    setup({
      obs: makeQuery({
        data: [
          makeObs({ signal_name: 'vehicle_speed', value_numeric: 42, source: 'fleet_telemetry', ts: isoAgo(1 * MIN) }),
          makeObs({ signal_name: 'charge_state', value_numeric: null, value_text: 'Charging', source: 'fleet_api', ts: isoAgo(5 * MIN) }),
          makeObs({ signal_name: 'sentry_mode', value_numeric: null, value_bool: true, source: 'backfill', ts: isoAgo(10 * MIN) }),
        ],
      }),
    });
    renderWidget(STANDARD);

    expect(screen.getByText('Signal Log')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: /event feed/i });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    // Signal names + formatted values.
    expect(screen.getByText('vehicle_speed')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('charge_state')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.getByText('sentry_mode')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();

    // Source → badge label mapping.
    expect(screen.getByText('MQTT')).toBeInTheDocument();
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByText('Cache')).toBeInTheDocument();
  });

  it('orders rows most-recent first regardless of input order', () => {
    setup({
      obs: makeQuery({
        data: [
          makeObs({ signal_name: 'older', ts: isoAgo(30 * MIN) }),
          makeObs({ signal_name: 'newest', ts: isoAgo(1 * MIN) }),
          makeObs({ signal_name: 'middle', ts: isoAgo(10 * MIN) }),
        ],
      }),
    });
    renderWidget(STANDARD);

    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('newest');
    expect(rows[1]).toHaveTextContent('middle');
    expect(rows[2]).toHaveTextContent('older');
  });

  it('defaults a null source to the "Cache" badge and passes an unknown source through', () => {
    setup({
      obs: makeQuery({
        data: [
          makeObs({ signal_name: 'no_source', source: undefined as unknown as SignalObservation['source'], ts: isoAgo(1 * MIN) }),
          makeObs({ signal_name: 'weird_source', source: 'satellite' as unknown as SignalObservation['source'], ts: isoAgo(2 * MIN) }),
        ],
      }),
    });
    renderWidget(STANDARD);

    // Null source falls back to backfill → "Cache".
    expect(screen.getByText('Cache')).toBeInTheDocument();
    // Unknown source label passes through verbatim (no crash, no blank badge).
    expect(screen.getByText('satellite')).toBeInTheDocument();
  });

  it('shows the empty state (role="status") when there are no observations', () => {
    setup({ obs: makeQuery({ data: [] }) });
    renderWidget(STANDARD);

    expect(screen.getByText('No signal updates yet')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The header survives; the feed list is replaced, not rendered blank.
    expect(screen.getByText('Signal Log')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton and withholds the header + feed while loading', () => {
    setup({ obs: makeQuery({ isLoading: true, data: undefined }) });
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Signal Log')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('keeps rendering stale rows when the query reports a background error (non-blocking)', () => {
    // The widget forwards isError only to the freshness indicator — it never
    // blanks the panel, so the last-good rows stay visible.
    setup({
      obs: makeQuery({
        isError: true,
        error: new Error('boom'),
        data: [makeObs({ signal_name: 'last_good', value_numeric: 7, ts: isoAgo(1 * MIN) })],
      }),
    });
    renderWidget(STANDARD);

    expect(screen.getByText('last_good')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});

describe('SignalLogWidget — pause / resume', () => {
  it('freezes the feed while paused and re-attaches the live stream on resume', () => {
    const first = makeQuery({
      data: [makeObs({ signal_name: 'signal_a', ts: isoAgo(1 * MIN) })],
    });
    setup({ obs: first });
    const { rerender } = renderWidget(STANDARD);

    expect(screen.getByText('signal_a')).toBeInTheDocument();

    // Pause — the icon-only control is exposed via its aria-label.
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();

    // Fresh data lands while paused → the display stays frozen on signal_a.
    mockObs.mockReturnValue(
      makeQuery({ data: [makeObs({ signal_name: 'signal_b', ts: isoAgo(30_000) })] }),
    );
    rerender(
      <MemoryRouter>
        <SignalLogWidget size={STANDARD} />
      </MemoryRouter>,
    );
    expect(screen.getByText('signal_a')).toBeInTheDocument();
    expect(screen.queryByText('signal_b')).not.toBeInTheDocument();

    // Resume → the live stream (signal_b) replaces the frozen snapshot.
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByText('signal_b')).toBeInTheDocument();
    expect(screen.queryByText('signal_a')).not.toBeInTheDocument();
  });

  it('refetches when the accessible freshness control is activated', () => {
    const refetch = vi.fn();
    setup({ obs: makeQuery({ data: [makeObs()], refetch }) });
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('SignalLogWidget — compact layout (1×N)', () => {
  it('renders the signals/sec hero from the summed fleet rate and withholds the feed + pause', () => {
    setup({
      obs: makeQuery({ data: [] }),
      mqtt: makeQuery({
        data: { vehicles: [{ signalsPerSecond: 5 }, { signals_per_second: 7 }] },
      }),
    });
    renderWidget(COMPACT);

    expect(screen.getByText('signals/sec')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // Compact omits the event feed and the pause control.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
  });

  it('renders a zero hero when the MQTT status is unavailable (null-safe)', () => {
    setup({ obs: makeQuery({ data: [] }), mqtt: makeQuery({ data: undefined }) });
    renderWidget(COMPACT);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('signals/sec')).toBeInTheDocument();
  });
});

describe('SignalLogWidget — vehicle-id resolution', () => {
  it('passes the explicit vehicleId prop to the observations query with limit 20', () => {
    setup({ vehicles: { data: [{ id: 1 }] } });
    renderWidget(STANDARD, 7);

    expect(mockObs).toHaveBeenCalledWith(7, { limit: 20 });
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    setup({ vehicles: { data: [{ id: 3 }, { id: 9 }] } });
    renderWidget(STANDARD);

    expect(mockObs).toHaveBeenCalledWith(3, { limit: 20 });
  });

  it('keys the query on 0 (disabled) when there is no vehicle to resolve', () => {
    setup({ vehicles: { data: [] }, obs: makeQuery({ data: [] }) });
    renderWidget(STANDARD);

    expect(mockObs).toHaveBeenCalledWith(0, { limit: 20 });
    // With no vehicle and no data the widget degrades to the empty state.
    expect(screen.getByText('No signal updates yet')).toBeInTheDocument();
  });
});
