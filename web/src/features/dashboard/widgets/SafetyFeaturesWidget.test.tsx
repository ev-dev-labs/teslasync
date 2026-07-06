/**
 * SafetyFeaturesWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of SafetyFeaturesWidget.tsx:
 *   - `boolStatus` — the plain enabled/disabled bool → StatusCell.status map
 *     (all three branches: null → unknown, true → ok, false → inactive);
 *   - `invertedBoolStatus` — the "…_off" flag classifier where `true` means the
 *     feature is DISABLED (the semantics are inverted vs `boolStatus`);
 *   - `safetyEnumStatus` — the `unknown`-tolerant enum classifier that must never
 *     crash on a stray boolean/number and correctly reads the off/none/0 forms
 *     as inactive; and
 *   - `buildCells` — the eight-cell descriptor builder, asserted across the
 *     all-active, all-off and unknown payload shapes so every label/status/value
 *     branch it composes is pinned; and
 *   - the default widget component across every render state and layout variant
 *     (compact / medium / wide), the vehicle-id resolution wiring, plus the
 *     loading / error / empty / null-data branches and the manual-refresh
 *     interaction.
 *
 * Strategy (mirrors the repo convention, e.g. BatteryCellsWidget.test.tsx and
 * DriveScoreWidget.test.tsx):
 *   - The two data hooks (`useSafety`, `useVehicles`) are replaced with hoisted
 *     `vi.fn()` doubles so the network is never touched and each render is
 *     deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback string (and
 *     interpolate `{{vars}}`) so assertions read the real English copy — the
 *     widget calls `useTranslation('dashboard')`, so the stub ignores the
 *     namespace argument.
 *   - The global test-setup already mocks `useSettings` (km / °C) and
 *     `useTimezone` (UTC), which the transitive <DataFreshness> header needs.
 *   - `matchMedia` is stubbed before any import runs because <DataFreshness>'s
 *     `useMotionPreference` (rendered transitively by <WidgetShell>) touches it
 *     on first paint and jsdom does not provide it.
 *   - Renders are wrapped in <MemoryRouter> because <QueryError> (shown on the
 *     error branch) calls `useNavigate`.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice
 * tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// jsdom lacks matchMedia; <DataFreshness>'s useMotionPreference reads it on
// first paint. Install a no-op (reduced-motion = false) BEFORE any import.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// react-i18next passthrough — resolve the fallback (2nd arg) and interpolate
// `{{vars}}` from the options object so assertions read production copy. The
// widget passes a namespace ('dashboard') that the stub simply ignores.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
}));

// Hoisted hook doubles — the network boundary. Never hit real endpoints.
const { safetyMock, vehiclesMock } = vi.hoisted(() => ({
  safetyMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicleSystems', () => ({ useSafety: safetyMock }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));

import SafetyFeaturesWidget, {
  boolStatus,
  invertedBoolStatus,
  safetyEnumStatus,
  buildCells,
} from './SafetyFeaturesWidget';
import type { StatusCell } from './shared';
import type { WidgetSize } from './types';
import type { SafetySnapshot } from '@/types/vehicle-systems';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_MEDIUM: WidgetSize = { cols: 2, rows: 3 };
const SIZE_WIDE: WidgetSize = { cols: 4, rows: 3 };

// A translator that resolves the developer fallback, matching how the mocked
// react-i18next `t` behaves — used to exercise `buildCells` directly.
const tt = (_key: string, def: string): string => def;

/** Every feature enabled / active — the happy path. */
function makeActiveSnapshot(overrides: Partial<SafetySnapshot> = {}): SafetySnapshot {
  return {
    automatic_blind_spot_camera: true, //          ok / Enabled
    automatic_emergency_braking_off: false, //      ok / Enabled (not "off")
    blind_spot_collision_warning: true, //          ok / Enabled
    cruise_follow_distance: 'FollowDistance3', //   ok / "3"
    emergency_lane_departure_avoidance: true, //    ok / Enabled
    forward_collision_warning: 'ForwardCollisionSensitivityAverage', // ok / Average
    lane_departure_avoidance: 'LaneAssistLevelWarning', //             ok / Warning
    speed_limit_warning: 'SpeedAssistLevelChime', //                   ok / Chime
    ...overrides,
  };
}

/** A mixed payload: some off, some disabled, some entirely unknown (null). */
function makeMixedSnapshot(): SafetySnapshot {
  return {
    automatic_blind_spot_camera: null, //           unknown / —
    automatic_emergency_braking_off: true, //        inactive / Disabled ("off" flag set)
    blind_spot_collision_warning: false, //          inactive / Disabled
    cruise_follow_distance: null, //                 unknown / —
    emergency_lane_departure_avoidance: false, //    inactive / Disabled
    forward_collision_warning: false, //             inactive / Off (bare boolean)
    lane_departure_avoidance: 'LaneAssistLevelNone', // inactive / None
    speed_limit_warning: 'SpeedAssistLevelNone', //    inactive / Off (None → Off special-case)
  };
}

function byId(cells: StatusCell[], id: string): StatusCell {
  const cell = cells.find((c) => c.id === id);
  if (!cell) throw new Error(`no cell with id "${id}"`);
  return cell;
}

interface QueryOverrides {
  isLoading?: boolean;
  error?: unknown;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeQuery(data?: SafetySnapshot, over: QueryOverrides = {}) {
  return {
    data,
    isLoading: false,
    error: null as unknown,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  safetyMock.mockReset();
  vehiclesMock.mockReset();
  // Sensible defaults; individual tests override as needed.
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  safetyMock.mockReturnValue(makeQuery(makeActiveSnapshot()));
});

// ── boolStatus (pure) ────────────────────────────────────────────────────────
describe('boolStatus', () => {
  it('maps a plain enabled flag: null → unknown, true → ok, false → inactive', () => {
    expect(boolStatus(null)).toBe('unknown');
    expect(boolStatus(undefined)).toBe('unknown');
    expect(boolStatus(true)).toBe('ok');
    expect(boolStatus(false)).toBe('inactive');
  });
});

// ── invertedBoolStatus (pure) ────────────────────────────────────────────────
describe('invertedBoolStatus', () => {
  it('inverts an "…_off" flag: true (disabled) → inactive, false → ok', () => {
    expect(invertedBoolStatus(null)).toBe('unknown');
    expect(invertedBoolStatus(undefined)).toBe('unknown');
    // The field is an OFF flag, so `true` means the feature is disabled.
    expect(invertedBoolStatus(true)).toBe('inactive');
    expect(invertedBoolStatus(false)).toBe('ok');
  });
});

// ── safetyEnumStatus (pure) ──────────────────────────────────────────────────
describe('safetyEnumStatus', () => {
  it('classifies nullish and active enum forms', () => {
    expect(safetyEnumStatus(null, 'forward_collision_warning')).toBe('unknown');
    expect(safetyEnumStatus(undefined, 'forward_collision_warning')).toBe('unknown');
    expect(
      safetyEnumStatus('ForwardCollisionSensitivityAverage', 'forward_collision_warning'),
    ).toBe('ok');
    // A follow-distance level of 3 is an active setting.
    expect(safetyEnumStatus('FollowDistance3', 'cruise_follow_distance')).toBe('ok');
  });

  it('reads off / none / 0 and stray boolean·number values as inactive without crashing', () => {
    // Bare booleans/numbers arrive for legacy signal_log rows — must not throw.
    expect(safetyEnumStatus(false, 'forward_collision_warning')).toBe('inactive');
    expect(safetyEnumStatus(true, 'lane_departure_avoidance')).toBe('ok');
    expect(safetyEnumStatus(0, 'cruise_follow_distance')).toBe('inactive');
    expect(safetyEnumStatus(3, 'cruise_follow_distance')).toBe('ok');
    expect(safetyEnumStatus('SpeedAssistLevelNone', 'speed_limit_warning')).toBe('inactive');
  });
});

// ── buildCells (pure) ────────────────────────────────────────────────────────
describe('buildCells', () => {
  it('emits the eight safety cells in a stable order with translated labels', () => {
    const cells = buildCells(makeActiveSnapshot(), tt);
    expect(cells).toHaveLength(8);
    expect(cells.map((c) => c.id)).toEqual([
      'fcw', 'aeb', 'lda', 'elda', 'bsc', 'bscw', 'slw', 'cfd',
    ]);
    expect(byId(cells, 'fcw').label).toBe('Forward Collision Warning');
    expect(byId(cells, 'cfd').label).toBe('Cruise Follow Distance');
  });

  it('maps an all-active payload to ok statuses with prefix-stripped values', () => {
    const cells = buildCells(makeActiveSnapshot(), tt);
    expect(byId(cells, 'fcw')).toMatchObject({ status: 'ok', value: 'Average' });
    expect(byId(cells, 'lda')).toMatchObject({ status: 'ok', value: 'Warning' });
    expect(byId(cells, 'slw')).toMatchObject({ status: 'ok', value: 'Chime' });
    expect(byId(cells, 'cfd')).toMatchObject({ status: 'ok', value: '3' });
    // The AEB "off" flag is false ⇒ feature is enabled.
    expect(byId(cells, 'aeb')).toMatchObject({ status: 'ok', value: 'Enabled' });
    expect(byId(cells, 'elda')).toMatchObject({ status: 'ok', value: 'Enabled' });
  });

  it('maps off / disabled / unknown payloads to inactive·unknown with the right copy', () => {
    const cells = buildCells(makeMixedSnapshot(), tt);
    // AEB off-flag set ⇒ disabled.
    expect(byId(cells, 'aeb')).toMatchObject({ status: 'inactive', value: 'Disabled' });
    // Plain bool false enabled-flags ⇒ disabled.
    expect(byId(cells, 'bscw')).toMatchObject({ status: 'inactive', value: 'Disabled' });
    expect(byId(cells, 'elda')).toMatchObject({ status: 'inactive', value: 'Disabled' });
    // Null fields ⇒ unknown with an em-dash placeholder (never a blank/crash).
    expect(byId(cells, 'bsc')).toMatchObject({ status: 'unknown', value: '—' });
    expect(byId(cells, 'cfd')).toMatchObject({ status: 'unknown', value: '—' });
    // Bare boolean false and the "None" enum both read as off.
    expect(byId(cells, 'fcw')).toMatchObject({ status: 'inactive', value: 'Off' });
    expect(byId(cells, 'slw')).toMatchObject({ status: 'inactive', value: 'Off' });
    expect(byId(cells, 'lda')).toMatchObject({ status: 'inactive', value: 'None' });
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('SafetyFeaturesWidget', () => {
  it('renders the title, labels and per-feature values in the medium grid', () => {
    renderWidget(<SafetyFeaturesWidget size={SIZE_MEDIUM} />);

    // Title header (visible above compact).
    expect(screen.getByText('Safety Features')).toBeInTheDocument();

    // A representative set of unique labels.
    expect(screen.getByText('Forward Collision Warning')).toBeInTheDocument();
    expect(screen.getByText('Auto Emergency Braking')).toBeInTheDocument();
    expect(screen.getByText('Cruise Follow Distance')).toBeInTheDocument();

    // Unique prefix-stripped enum values.
    expect(screen.getByText('Average')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Chime')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    // The four bool-derived "Enabled" chips (aeb, elda, bsc, bscw).
    expect(screen.getAllByText('Enabled')).toHaveLength(4);

    // Not the empty state.
    expect(screen.queryByText('No safety data')).not.toBeInTheDocument();
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget(<SafetyFeaturesWidget size={SIZE_MEDIUM} />);
    expect(safetyMock).toHaveBeenCalledWith('42');
  });

  it('uses the explicit vehicleId prop when provided', () => {
    renderWidget(<SafetyFeaturesWidget vehicleId={7} size={SIZE_MEDIUM} />);
    expect(safetyMock).toHaveBeenCalledWith('7');
  });

  it('passes an empty id (disabling the query) and shows the empty state with no vehicles', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    safetyMock.mockReturnValue(makeQuery(undefined));

    renderWidget(<SafetyFeaturesWidget size={SIZE_MEDIUM} />);

    expect(safetyMock).toHaveBeenCalledWith('');
    expect(screen.getByText('No safety data')).toBeInTheDocument();
  });

  it('shows the active-feature count and hides the title + grid in compact layout', () => {
    // All eight features active ⇒ activeCount 8.
    renderWidget(<SafetyFeaturesWidget size={SIZE_COMPACT} />);

    // 1×1 widget: the title chrome is suppressed by design.
    expect(screen.queryByText('Safety Features')).not.toBeInTheDocument();
    // The compact hero shows the count + label...
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('Active Features')).toBeInTheDocument();
    // ...and omits the per-feature grid entirely.
    expect(screen.queryByText('Forward Collision Warning')).not.toBeInTheDocument();
  });

  it('always renders every feature cell — inactive and unknown included — never hiding a section', () => {
    safetyMock.mockReturnValue(makeQuery(makeMixedSnapshot()));

    renderWidget(<SafetyFeaturesWidget size={SIZE_WIDE} />);

    // The section shell + labels always show, regardless of feature state.
    expect(screen.getByText('Speed Limit Warning')).toBeInTheDocument();
    expect(screen.getByText('Blind Spot Camera')).toBeInTheDocument();
    // Disabled (aeb, bscw, elda), unknown (bsc, cfd) and off (fcw, slw) all render.
    expect(screen.getAllByText('Disabled')).toHaveLength(3);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getAllByText('Off')).toHaveLength(2);
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders the empty state (and no grid) when data is null', () => {
    safetyMock.mockReturnValue(makeQuery(undefined));

    renderWidget(<SafetyFeaturesWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No safety data')).toBeInTheDocument();
    expect(screen.queryByText('Forward Collision Warning')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton without any content while fetching the first time', () => {
    safetyMock.mockReturnValue(makeQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<SafetyFeaturesWidget size={SIZE_MEDIUM} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Safety Features')).not.toBeInTheDocument();
    expect(screen.queryByText('No safety data')).not.toBeInTheDocument();
  });

  it('surfaces an error state instead of the panel body when the query fails', () => {
    safetyMock.mockReturnValue(
      makeQuery(undefined, { error: new Error('boom'), isError: true }),
    );

    renderWidget(<SafetyFeaturesWidget size={SIZE_MEDIUM} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Forward Collision Warning')).not.toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    safetyMock.mockReturnValue(
      makeQuery(makeActiveSnapshot(), { refetch, isFetching: false }),
    );

    renderWidget(<SafetyFeaturesWidget size={SIZE_MEDIUM} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
