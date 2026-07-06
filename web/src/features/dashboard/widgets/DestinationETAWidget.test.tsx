/**
 * DestinationETAWidget tests.
 *
 * The widget projects the vehicle's latest location snapshot into either a
 * navigation ETA or a "where is it parked" presence badge. Its behaviour
 * surface — the thing under test:
 *
 *   1. Two responsive layouts driven by `size.cols`:
 *        - compact (cols <= 1): a title-less shell showing EITHER the ETA big
 *          number (navigating) or the presence emoji + Badge (parked) or an
 *          EmptyState (no data).
 *        - standard (cols >= 2): a titled "Destination ETA" shell with the full
 *          navigating layout (destination, ETA countdown, converted remaining
 *          distance, progress bar) or the presence badge + "No active
 *          navigation" line.
 *   2. The presence classification (`locationBadge`), exercised through the four
 *      rendered variants: home 🏠, work 🏢, favorite ⭐, else 📍.
 *   3. Unit conversion at the display boundary: `miles_to_arrival` is stored in
 *      SI **metres** (the backend normalises the fixed-mile wire field to
 *      metres), so `convertDistanceFromSI(metres, pref)` yields the user's
 *      distance preference — 16093.44 m → "10.0" mi / "16.1" km.
 *   4. ETA formatting: >= 1h renders "1h 30m"; < 1h renders "45m" (no hour
 *      segment). `minutes_to_arrival` is `UnitKindNone` (plain minutes).
 *   5. The four query states every data source must handle: loading (skeleton),
 *      initial error (QueryError panel, only when there is no cached snapshot),
 *      empty (EmptyState — never a blank panel), and data.
 *   6. Null-safety: a partial snapshot degrades every numeric to 0 / "0.0"
 *      rather than throwing.
 *   7. Vehicle resolution: an explicit `vehicleId` wins, else the first vehicle;
 *      a missing vehicle disables the query with id 0.
 *   8. The freshness control: clicking refetches, but only when a fetch is not
 *      already in flight.
 *   9. Graceful degradation (the hardened bug): a transient background-refetch
 *      error MUST NOT blank out otherwise-valid cached data — the widget keeps
 *      rendering and surfaces the failure through the freshness indicator's
 *      error state instead of the full-panel QueryError.
 *
 * `@/api/hooks/useVehicles` and `@/hooks/useUnits` are mocked so the network is
 * never touched and every query state / unit preference is driven
 * deterministically. `react-i18next` is stubbed with a passthrough
 * `t(key, default)` so assertions read the English defaults. The shared
 * WidgetShell / DataFreshness / Badge / EmptyState / WidgetBigNumber primitives
 * and the real `convertDistanceFromSI` all run for real, so assertions exercise
 * the true rendered DOM. `<MemoryRouter>` wraps every render because the error
 * branch's <QueryError> uses `useNavigate`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { LocationSnapshot } from '@/api/types';
import DestinationETAWidget from './DestinationETAWidget';

// jsdom lacks matchMedia; AnimatedNumber (ETA countdown) and DataFreshness read
// it during render. Report reduced-motion = true so AnimatedNumber skips its
// rAF tween and lands on the target value synchronously — making the ETA
// number deterministic under `render`. All other media queries report false.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
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

const { useVehiclesMock, useLocationSnapshotLatestMock, useUnitsMock } = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useLocationSnapshotLatestMock: vi.fn(),
  useUnitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
  useLocationSnapshotLatest: (vehicleId: number) => useLocationSnapshotLatestMock(vehicleId),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => useUnitsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function makeUnits(distance: 'mi' | 'km' = 'mi') {
  return { unitPrefs: { distance } };
}

function makeSnapshot(overrides: Partial<LocationSnapshot> = {}): LocationSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as LocationSnapshot;
}

interface SnapshotQuery {
  data: LocationSnapshot | null | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<SnapshotQuery> = {}): SnapshotQuery {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(
  size: { cols: number; rows: number } = { cols: 2, rows: 2 },
  vehicleId?: number,
) {
  return render(
    <MemoryRouter>
      <DestinationETAWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so a test that forgets to seed a hook still renders a
  // populated widget rather than crashing on a destructure of `undefined`.
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useUnitsMock.mockReturnValue(makeUnits('mi'));
  useLocationSnapshotLatestMock.mockReturnValue(makeQuery());
});

afterEach(() => {
  cleanup();
});

describe('DestinationETAWidget — presence badge (standard, not navigating)', () => {
  const badgeCases = [
    { flag: { located_at_home: true }, emoji: '🏠', label: 'Home' },
    { flag: { located_at_work: true }, emoji: '🏢', label: 'Work' },
    { flag: { located_at_favorite: true }, emoji: '⭐', label: 'Favorite' },
    { flag: {}, emoji: '📍', label: 'Other' },
  ] as const;

  it.each(badgeCases)(
    'classifies a parked vehicle as "$label" with an accessible $emoji emoji',
    ({ flag, emoji, label }) => {
      useLocationSnapshotLatestMock.mockReturnValue(makeQuery({ data: makeSnapshot(flag) }));

      renderWidget({ cols: 2, rows: 2 });

      expect(screen.getByText('Destination ETA')).toBeInTheDocument();
      expect(screen.getByText('No active navigation')).toBeInTheDocument();
      // The emoji is exposed to assistive tech via role=img + aria-label…
      expect(screen.getByRole('img', { name: label })).toHaveTextContent(emoji);
      // …and the human-readable label is rendered in the Badge.
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );
});

describe('DestinationETAWidget — navigating layout (standard)', () => {
  it('renders destination, ETA minutes, SI→mi distance, and an accessible progress bar', () => {
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({
        data: makeSnapshot({
          destination_name: 'Tesla Supercharger',
          miles_to_arrival: 16093.44, // 10 mi expressed in SI metres
          minutes_to_arrival: 90,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Destination ETA')).toBeInTheDocument();
    expect(screen.getByText('Tesla Supercharger')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument(); // AnimatedNumber minutes
    expect(screen.getByText('1h 30m')).toBeInTheDocument(); // etaDisplay
    expect(screen.getByText('10.0')).toBeInTheDocument(); // 16093.44 m → 10.0 mi
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByText('Remaining')).toBeInTheDocument();

    const progressbar = screen.getByRole('progressbar', { name: 'Trip progress' });
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
  });

  it('converts the remaining distance to the user\'s km preference', () => {
    useUnitsMock.mockReturnValue(makeUnits('km'));
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({
        data: makeSnapshot({
          destination_name: 'Ocean Beach',
          miles_to_arrival: 16093.44, // → 16.09344 km
          minutes_to_arrival: 90,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('16.1')).toBeInTheDocument();
    expect(screen.getByText('km')).toBeInTheDocument();
    // The mi label must NOT appear once the preference is km.
    expect(screen.queryByText('mi')).not.toBeInTheDocument();
  });

  it('formats an under-one-hour ETA without an hour segment', () => {
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({
        data: makeSnapshot({
          destination_name: 'Corner Cafe',
          miles_to_arrival: 3218.688, // → 2.0 mi
          minutes_to_arrival: 45,
        }),
      }),
    );

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('45m')).toBeInTheDocument();
    expect(screen.queryByText('0h 45m')).not.toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
  });
});

describe('DestinationETAWidget — compact layout', () => {
  it('renders the ETA big number with a "min" unit and no section title', () => {
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({
        data: makeSnapshot({
          destination_name: 'Depot',
          miles_to_arrival: 16093.44,
          minutes_to_arrival: 45,
        }),
      }),
    );

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('min')).toBeInTheDocument();
    expect(screen.getByText('ETA')).toBeInTheDocument();
    // Compact mode drops the header title.
    expect(screen.queryByText('Destination ETA')).not.toBeInTheDocument();
  });

  it('renders the presence badge (accessible emoji) with no section title when parked', () => {
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({ data: makeSnapshot({ located_at_work: true }) }),
    );

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByRole('img', { name: 'Work' })).toHaveTextContent('🏢');
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.queryByText('Destination ETA')).not.toBeInTheDocument();
  });

  it('shows an EmptyState (never a blank panel) when there is no snapshot', () => {
    useLocationSnapshotLatestMock.mockReturnValue(makeQuery({ data: null }));

    renderWidget({ cols: 1, rows: 2 });

    expect(screen.getByText('No location data')).toBeInTheDocument();
    expect(screen.queryByText('Destination ETA')).not.toBeInTheDocument();
  });
});

describe('DestinationETAWidget — query states', () => {
  it('renders a skeleton while loading with no title or empty message', () => {
    useLocationSnapshotLatestMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));

    const { container } = renderWidget({ cols: 2, rows: 2 });

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Destination ETA')).not.toBeInTheDocument();
    expect(screen.queryByText('No location data')).not.toBeInTheDocument();
  });

  it('renders the QueryError panel on an initial load failure (no cached snapshot)', () => {
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, data: undefined }),
    );

    renderWidget({ cols: 2, rows: 2 });

    // Generic (non-HTTP) error → network/unknown branch of <QueryError>.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Destination ETA')).not.toBeInTheDocument();
  });

  it('renders the titled shell with an EmptyState placeholder when snapshot is absent', () => {
    useLocationSnapshotLatestMock.mockReturnValue(makeQuery({ data: undefined }));

    renderWidget({ cols: 2, rows: 2 });

    expect(screen.getByText('Destination ETA')).toBeInTheDocument();
    expect(screen.getByText('No location data')).toBeInTheDocument();
  });

  it('degrades a partial navigating snapshot to zeros without throwing (null-safety)', () => {
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({ data: makeSnapshot({ destination_name: 'Home Depot' }) }),
    );

    expect(() => renderWidget({ cols: 2, rows: 2 })).not.toThrow();
    expect(screen.getByText('Home Depot')).toBeInTheDocument();
    expect(screen.getByText('0.0')).toBeInTheDocument(); // missing miles_to_arrival → 0
  });
});

describe('DestinationETAWidget — vehicle resolution', () => {
  it('resolves the first vehicle id when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useLocationSnapshotLatestMock).toHaveBeenCalledWith(42);
  });

  it('prefers an explicit vehicleId prop over the first vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 42 }] });

    renderWidget({ cols: 2, rows: 2 }, 7);

    expect(useLocationSnapshotLatestMock).toHaveBeenCalledWith(7);
  });

  it('falls back to id 0 (query disabled) when there is no vehicle', () => {
    useVehiclesMock.mockReturnValue({ data: [] });

    renderWidget({ cols: 2, rows: 2 });

    expect(useLocationSnapshotLatestMock).toHaveBeenCalledWith(0);
  });
});

describe('DestinationETAWidget — freshness interaction', () => {
  it('refetches when the accessible refresh control is clicked', () => {
    const refetch = vi.fn();
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({ data: makeSnapshot({ located_at_home: true }), refetch, isFetching: false }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not refetch while a fetch is already in flight', () => {
    const refetch = vi.fn();
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({ data: makeSnapshot({ located_at_home: true }), refetch, isFetching: true }),
    );

    renderWidget({ cols: 2, rows: 2 });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).not.toHaveBeenCalled();
  });
});

describe('DestinationETAWidget — graceful degradation on transient error', () => {
  it('keeps rendering cached data and flags the freshness dot instead of blanking out', () => {
    useLocationSnapshotLatestMock.mockReturnValue(
      makeQuery({
        data: makeSnapshot({
          destination_name: 'Supercharger',
          miles_to_arrival: 16093.44,
          minutes_to_arrival: 90,
        }),
        error: new Error('transient'),
        isError: true,
        isFetching: false,
      }),
    );

    const { container } = renderWidget({ cols: 2, rows: 2 });

    // Data is still on screen …
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    // … the full-panel error is NOT shown …
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    // … and the freshness indicator is in its error state (red dot).
    expect(container.querySelector('.bg-red-400')).toBeTruthy();
  });
});
