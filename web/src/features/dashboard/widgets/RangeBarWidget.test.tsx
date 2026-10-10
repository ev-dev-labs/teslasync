/**
 * RangeBarWidget — behavioural, branch, unit-conversion, null-safety and a11y
 * coverage for the dashboard "Range" widget.
 *
 * The widget resolves a vehicle (from the `vehicleId` prop, else the first
 * vehicle, else id `0`), reads its `useVehicleState` snapshot, and renders one
 * of two layouts driven by `size`:
 *   • compact (cols === 1 && rows === 1): a single big primary-range figure with
 *     a "<unit> rated" (or "<unit> ideal") caption and no title;
 *   • full (anything larger): a primary range and a secondary range measurement
 *     plus an EPA-variance readout when BOTH ranges are known.
 *
 * What this file pins:
 *   - the SI-floor CONTRACT: `state.rated_range` / `state.ideal_range` arrive in
 *     METERS and are converted to the user's display unit exactly once — the
 *     both measurements are in the display unit, without an invented relative
 *     gauge ceiling; the km branch converts differently from the mi branch;
 *   - the LOADING fix — a hardening pin so the widget shows a skeleton while the
 *     *vehicle list itself* loads (previously `loading` only watched the state
 *     query, so at id 0 the disabled state query is not "loading" and the widget
 *     flashed the "No range data" empty state before any vehicle resolved);
 *   - the EMPTY state (never a blank panel) for an unresolved snapshot, a
 *     null `rated_range`/`ideal_range`; real zero readings stay visible;
 *   - the EPA VARIANCE branch — the sign ("+"/"") and the null-guard that hides
 *     the readout when either side is unknown (no divide-by-zero, no "±0%");
 *   - the COMPACT primary-range fallback fix — prefer the rated figure, but fall
 *     back to the ideal range (and relabel "ideal") when rated is 0, so a vehicle
 *     reporting only an ideal range never surfaces a misleading "0 rated";
 *   - the VEHICLE-ID RESOLUTION ladder (prop → first → 0) and the hook contract;
 *   - the REFRESH wiring (accessible chip → the memoised `refetch` callback) and
 *     the title heading (present in full, absent in compact).
 *
 * Strategy: `@/api/hooks/useVehicles` is the network boundary and is fully
 * controllable via hoisted mocks. The old `MetricBar` has a prop-recording
 * spy to ensure it is not used for an arbitrary largest-relative indicator.
 * SI→display derivation is asserted through visible values. `useUnits` is mocked
 * so the distance preference is deterministic. `react-i18next` echoes each
 * `t(key, fallback)` fallback (interpolating `{{var}}`) so assertions read
 * against English copy. `DataFreshness`'s display hooks are stubbed so the
 * freshness/refresh chip renders without a Settings provider. A `<MemoryRouter>`
 * wraps every render because `EmptyState` reaches for `<Link>`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { Vehicle, VehicleState } from '@/api/types';
import type { WidgetSize } from './types';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { vehiclesMock, stateMock, unitsMock, metricBarSpy, capturedBrief } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  stateMock: vi.fn(),
  unitsMock: vi.fn(),
  metricBarSpy: vi.fn(),
  capturedBrief: { metrics: [] as OperationalBriefProps['metrics'] },
}));

vi.mock('@/components/data-display', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return {
    ...actual,
    OperationalBrief: (props: OperationalBriefProps) => {
      capturedBrief.metrics = props.metrics;
      return <actual.OperationalBrief {...props} />;
    },
  };
});

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
  useVehicleState: (...args: unknown[]) => stateMock(...args),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

interface MetricBarProps {
  value: number;
  max: number;
  color: string;
  label: string;
  sublabel?: string;
}

// MetricBar — a prop-recording stub. Records the derived (already display-unit)
// value/max/color/label/sublabel and mirrors the label + sublabel into the DOM,
// so both the numeric derivation and the rendered copy are assertable without
// the animated framer-motion bar.
vi.mock('@/components/data-display/MetricBar', () => ({
  MetricBar: (props: MetricBarProps) => {
    metricBarSpy(props);
    return (
      <div
        data-testid={`metricbar-${props.label}`}
        data-value={String(props.value)}
        data-max={String(props.max)}
        data-color={props.color}
      >
        <span>{props.label}</span>
        <span>{props.sublabel}</span>
      </div>
    );
  },
}));

// i18n → echo the developer fallback, interpolating `{{var}}` placeholders.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interp = (tpl: string, opts?: Record<string, unknown>) =>
    opts ? tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : '')) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) =>
        typeof fallback === 'string' ? interp(fallback, opts) : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// DataFreshness display hooks — stubbed so the freshness chip renders without a
// Settings/QueryClient provider.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import RangeBarWidget from './RangeBarWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';
/** 1 mile in metres — kept local so the "meters not miles" pins are self-checking. */
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
/** Convenience: express a mile/km distance as the SI metres the API actually returns. */
const mi = (n: number) => n * METERS_PER_MILE;
const km = (n: number) => n * METERS_PER_KM;

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7,
    vehicle_id: 7,
    vin: '5YJ3E1EA7KF000007',
    display_name: 'Model 3',
    state: 'online',
    healthy: true,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Vehicle;
}

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 7,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 60,
    rated_range: mi(300),
    ideal_range: mi(350),
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
  } as VehicleState;
}

interface StateOverrides {
  state?: VehicleState;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  error?: unknown;
  fetchStatus?: 'idle' | 'fetching' | 'paused';
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setVehicles(list: Vehicle[] | undefined, isLoading = false) {
  vehiclesMock.mockReturnValue({ data: list, isLoading });
}

function setUnits(distance: 'mi' | 'km' = 'mi') {
  unitsMock.mockReturnValue({ unitPrefs: { distance } });
}

function setState(over: StateOverrides = {}) {
  const q = {
    data: over.state !== undefined ? { state: over.state, live: false } : undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  stateMock.mockReturnValue(q);
  return q;
}

function renderWidget(size: WidgetSize = FULL, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <RangeBarWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedBrief.metrics = [];
  setVehicles([makeVehicle()]);
  setUnits('mi');
  setState({ state: makeState() });
});

describe('RangeBarWidget — actual source comparison brief', () => {
  it('distinguishes a measured secondary zero from a missing range without changing the primary', () => {
    setState({ state: makeState({ rated_range: mi(300), ideal_range: 0 }), dataUpdatedAt: Date.now() });
    const first = renderWidget(FULL);
    const brief = screen.getByTestId('dashboard-range-comparison-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(within(brief).getByText('Source available')).toBeInTheDocument();
    expect(within(brief).getByText('0.00 mi')).toBeInTheDocument();
    expect(capturedBrief.metrics).toEqual([
      expect.objectContaining({ key: 'range-secondary-distance', rawValue: 0, valueState: 'value' }),
    ]);
    expect(screen.getByText('300.00')).toBeInTheDocument();
    expect(within(brief).queryByText('EPA variance')).toBeNull();
    first.unmount();

    setState({
      state: makeState({ rated_range: mi(300), ideal_range: undefined as unknown as number }),
      dataUpdatedAt: Date.now(),
    });
    renderWidget(FULL);
    const missing = screen.getByTestId('dashboard-range-comparison-brief');
    expect(within(missing).getByText('Ideal range')).toBeInTheDocument();
    expect(within(missing).getByText('—')).toBeInTheDocument();
    expect(capturedBrief.metrics[0]).toMatchObject({ rawValue: undefined, valueState: 'missing' });
    expect(screen.getByText('300.00')).toBeInTheDocument();
    expect(within(missing).queryByText('EPA variance')).toBeNull();
  });

  it('retains unrounded original meters rather than recovering raw distance from a converted string', () => {
    const rated = 100_001;
    const ideal = 123_456.789;
    setState({ state: makeState({ rated_range: rated, ideal_range: ideal }) });
    renderWidget(FULL);
    const brief = screen.getByTestId('dashboard-range-comparison-brief');
    expect(within(brief).getByText('76.71 mi')).toBeInTheDocument();
    expect(capturedBrief.metrics[0]).toMatchObject({ rawValue: ideal, valueState: 'value' });
    expect(capturedBrief.metrics[1]).toMatchObject({ rawValue: ((ideal - rated) / rated) * 100 });
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Secondary vehicle range reading in source meters, distinct from the preferred primary range.')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/Vehicle 7 · range snapshot/).length).toBeGreaterThan(0);
  });

  it.each([
    { ideal: 110_000, raw: 10, display: '+10.00%' },
    { ideal: 90_000, raw: -10, display: '-10.00%' },
    { ideal: 100_000, raw: 0, display: '+0.00%' },
  ])('retains the signed $display variance and its independent percent operand', ({ ideal, raw, display }) => {
    setState({ state: makeState({ rated_range: 100_000, ideal_range: ideal }) });
    renderWidget(FULL);
    const brief = screen.getByTestId('dashboard-range-comparison-brief');
    expect(within(brief).getByText(display)).toBeInTheDocument();
    expect(capturedBrief.metrics[1]).toMatchObject({
      key: 'range-epa-variance', rawValue: raw, valueState: 'value',
    });
  });

  it('preserves the full-layout ideal primary fallback while the brief retains the original rated zero', () => {
    setState({ state: makeState({ rated_range: 0, ideal_range: mi(280) }) });
    renderWidget(FULL);
    expect(screen.getByText('280.00')).toBeInTheDocument();
    const brief = screen.getByTestId('dashboard-range-comparison-brief');
    expect(within(brief).getByText('Rated range')).toBeInTheDocument();
    expect(within(brief).getByText('0.00 mi')).toBeInTheDocument();
    expect(capturedBrief.metrics).toEqual([
      expect.objectContaining({ rawValue: 0, valueState: 'value' }),
    ]);
    expect(screen.queryByText('EPA variance')).toBeNull();
  });

  it('preserves the unknown-rated primary fallback without inventing a rated measurement', () => {
    setState({ state: makeState({ rated_range: null as unknown as number, ideal_range: km(400) }) });
    setUnits('km');
    renderWidget(FULL);
    expect(screen.getByText('400.00')).toBeInTheDocument();
    const brief = screen.getByTestId('dashboard-range-comparison-brief');
    expect(within(brief).getByText('Rated range')).toBeInTheDocument();
    expect(within(brief).getByText('—')).toBeInTheDocument();
    expect(capturedBrief.metrics[0]).toMatchObject({ rawValue: null, valueState: 'missing' });
    expect(screen.queryByText('EPA variance')).toBeNull();
  });

  it('uses retained source trust during a failed refresh and preserves the shell retry action', () => {
    const q = setState({ state: makeState(), isError: true, error: new Error('refresh failed') });
    renderWidget(FULL);
    const brief = screen.getByTestId('dashboard-range-comparison-brief');
    expect(within(brief).getByText('Retained readings')).toBeInTheDocument();
    expect(within(brief).getByText('350.00 mi')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Refresh/i })[0]);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps compact primary fallback and suppresses only the originally noncompact comparison band', () => {
    setState({ state: makeState({ rated_range: 0, ideal_range: mi(280) }) });
    renderWidget(COMPACT);
    expect(screen.getByText('280.00')).toBeInTheDocument();
    expect(screen.getByText('Ideal range')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-range-comparison-brief')).toBeNull();
    expect(capturedBrief.metrics).toHaveLength(0);
    expect(screen.queryByText('EPA variance')).toBeNull();
  });
});

// ── Loading & empty states ────────────────────────────────────────────────────

describe('RangeBarWidget — loading & empty states', () => {
  it('shows an initial error without presenting it as an empty range', () => {
    setState({ state: undefined, isError: true, error: new Error('offline') });
    renderWidget();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No range data')).toBeNull();
  });

  it('retains both range readings and variance on a cached refresh failure', () => {
    setState({ state: makeState(), isError: true, error: new Error('transient') });
    renderWidget();
    expect(screen.getByText('300.00')).toBeInTheDocument();
    expect(screen.getByText('350.00 mi')).toBeInTheDocument();
    expect(screen.getByText('+16.67%')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('renders only a skeleton (no bars, no empty state) while the vehicle state loads', () => {
    setState({ isLoading: true, state: undefined });
    const { container } = renderWidget(FULL);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(metricBarSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('No range data')).toBeNull();
  });

  it('folds the vehicle-list load into the skeleton (no empty-state flash before a vehicle resolves)', () => {
    // Bug pin: at id 0 the state query is disabled and therefore not "loading",
    // so without folding in `vehiclesLoading` the widget flashes "No range data".
    setVehicles(undefined, true);
    setState({ state: undefined });
    const { container } = renderWidget(FULL);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('No range data')).toBeNull();
    expect(metricBarSpy).not.toHaveBeenCalled();
  });

  it('shows the "No range data" empty state (not bars) when the snapshot has not resolved', () => {
    setState({ state: undefined });
    renderWidget(FULL);

    expect(screen.getByText('No range data')).toBeInTheDocument();
    expect(metricBarSpy).not.toHaveBeenCalled();
  });

  it('keeps genuine zero ranges visible rather than reporting missing data', () => {
    setState({ state: makeState({ rated_range: 0, ideal_range: 0 }) });
    renderWidget(FULL);

    expect(screen.queryByText('No range data')).toBeNull();
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getByText('0.00 mi')).toBeInTheDocument();
    expect(metricBarSpy).not.toHaveBeenCalled();
  });

  it('renders range measurements without inventing a largest-relative gauge ceiling', () => {
    setState({ state: makeState() });
    renderWidget(FULL);

    expect(screen.getByText('Rated range')).toBeInTheDocument();
    expect(screen.queryByText('No range data')).toBeNull();
    expect(metricBarSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('meter')).toBeNull();
  });
});

// ── Full layout: SI→display conversion ────────────────────────────────────────

describe('RangeBarWidget — full layout unit conversion', () => {
  it('converts SI metres to miles for both range readings exactly once', () => {
    setUnits('mi');
    setState({ state: makeState({ rated_range: mi(300), ideal_range: mi(350) }) });
    renderWidget(FULL);

    expect(screen.getByText('300.00')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByText('350.00 mi')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('converts to kilometres (a different divisor) when the distance preference is km', () => {
    setUnits('km');
    setState({ state: makeState({ rated_range: km(400), ideal_range: km(360) }) });
    renderWidget(FULL);

    expect(screen.getByText('400.00')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.getByText('360.00 km')).toBeInTheDocument();
  });
});

// ── EPA variance branch ───────────────────────────────────────────────────────

describe('RangeBarWidget — EPA variance', () => {
  it('shows a "+"-signed variance when ideal exceeds rated', () => {
    setState({ state: makeState({ rated_range: mi(300), ideal_range: mi(350) }) });
    renderWidget(FULL);

    // (350 - 300) / 300 = +16.66…% → "+16.7%"
    expect(screen.getByText('EPA variance')).toBeInTheDocument();
    expect(screen.getByText('+16.67%')).toBeInTheDocument();
  });

  it('shows a negative (unsigned "-") variance when ideal is below rated', () => {
    setUnits('km');
    setState({ state: makeState({ rated_range: km(400), ideal_range: km(360) }) });
    renderWidget(FULL);

    // (360 - 400) / 400 = -10% → "-10.0%"
    expect(screen.getByText('-10.00%')).toBeInTheDocument();
  });

  it('hides the variance readout when the ideal range is unknown (no divide-by-zero)', () => {
    setState({ state: makeState({ rated_range: mi(300), ideal_range: 0 }) });
    renderWidget(FULL);

    expect(screen.getByText('Rated range')).toBeInTheDocument();
    expect(screen.queryByText('EPA variance')).toBeNull();
  });

  it('hides the variance readout when the rated range is unknown', () => {
    setState({ state: makeState({ rated_range: 0, ideal_range: mi(300) }) });
    renderWidget(FULL);

    expect(screen.getByText('Ideal range')).toBeInTheDocument();
    expect(screen.queryByText('EPA variance')).toBeNull();
  });
});

// ── Compact layout ────────────────────────────────────────────────────────────

describe('RangeBarWidget — compact layout', () => {
  it('renders the rated figure and a "<unit> rated" caption without a title or bars', () => {
    setState({ state: makeState({ rated_range: mi(300), ideal_range: mi(350) }) });
    renderWidget(COMPACT);

    expect(screen.getByText('300.00')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByText('Rated range')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(metricBarSpy).not.toHaveBeenCalled();
  });

  it('falls back to the ideal range (and relabels "ideal") when rated is 0', () => {
    // Fix pin: a compact widget must never headline a misleading "0" when an
    // ideal range is available.
    setState({ state: makeState({ rated_range: 0, ideal_range: mi(280) }) });
    renderWidget(COMPACT);

    expect(screen.getByText('280.00')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByText('Ideal range')).toBeInTheDocument();
    expect(screen.queryByText('Rated range')).toBeNull();
  });
});

// ── Vehicle-id resolution & hook contract ─────────────────────────────────────

describe('RangeBarWidget — vehicle resolution & hook contract', () => {
  it('resolves the explicit vehicleId prop', () => {
    setVehicles([makeVehicle({ id: 7 }), makeVehicle({ id: 9, vehicle_id: 9 })]);
    renderWidget(FULL, 9);

    expect(stateMock).toHaveBeenCalledWith(9);
  });

  it('falls back to the first vehicle id when no vehicleId prop is provided', () => {
    setVehicles([makeVehicle({ id: 42, vehicle_id: 42 })]);
    renderWidget(FULL, undefined);

    expect(stateMock).toHaveBeenCalledWith(42);
  });

  it('subscribes with id 0 (query disabled) when no vehicles are available', () => {
    setVehicles([]);
    setState({ state: undefined });
    renderWidget(FULL, undefined);

    expect(stateMock).toHaveBeenCalledWith(0);
  });
});

// ── Null safety ───────────────────────────────────────────────────────────────

describe('RangeBarWidget — null safety', () => {
  it('keeps null/undefined ranges unknown and preserves both measurement sections', () => {
    setState({
      state: makeState({
        rated_range: undefined as unknown as number,
        ideal_range: undefined as unknown as number,
      }),
    });
    renderWidget(FULL);

    expect(screen.getByText('No range data')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('0')).toBeNull();
    expect(metricBarSpy).not.toHaveBeenCalled();
  });
});

// ── Interactions & accessibility ──────────────────────────────────────────────

describe('RangeBarWidget — interactions & a11y', () => {
  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setState({ state: makeState() });
    renderWidget(FULL);

    const refresh = screen.getAllByRole('button', { name: /^Refresh/i })[0];
    fireEvent.click(refresh);

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('exposes the widget title as a heading in the full layout', () => {
    renderWidget(FULL);

    expect(screen.getByRole('heading', { name: 'Range' })).toBeInTheDocument();
  });
});
