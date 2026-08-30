/**
 * TripDrivesTable — behavioural coverage for the Trip Detail "Drives in this
 * trip" band.
 *
 * The file exports a single component (`TripDrivesTable`) that wraps the shared
 * `DataTable` with drive-specific columns, functional header sorting, and its
 * own loading / error / empty states. These tests drive it entirely through its
 * public prop surface and assert real, observable behaviour:
 *
 *   • every column renders — the RouteDisplay line (from/to, round trip, and the
 *     "no location data" fallback), the short start date, the distance / energy
 *     cells, and the rounded duration (with the null/zero "—" guard);
 *   • the SI cutover contract: the component hands the RAW SI values
 *     (`distance_m` in metres, `energy_used_wh` in watt-hours) straight to the
 *     `useUnits` formatters at the display boundary — never a pre-converted
 *     number, and `null` passes straight through;
 *   • functional sorting — each sortable column re-orders the rows with a
 *     field-correct accessor, the active header toggles asc/desc, `aria-sort`
 *     lands on the active column, and a corrupt timestamp coerces to "oldest"
 *     instead of corrupting the order (the NaN-comparator guard);
 *   • the three render states are mutually exclusive, and error takes strict
 *     priority over the loading skeleton; and
 *   • null / undefined inputs never crash (defensive null-safety) and icon-only
 *     controls stay accessible.
 *
 * `react-i18next` is mocked to echo each `t(key, fallback, opts)` fallback and
 * interpolate `{{var}}` placeholders so assertions read against the English
 * copy. `useUnits` is mocked with spy formatters that emit distinctive
 * `dist:<n>` / `energy:<n>` strings, which lets a single query both locate a
 * cell and read row order. `useOnlineStatus` is pinned online so the error
 * branch renders QueryError's network `role="alert"` with an enabled Retry. The
 * component is prop-driven — no network is touched. A `<MemoryRouter>` wraps
 * every render because QueryError calls `useNavigate`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ComponentProps } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tmpl: string, vars?: Record<string, unknown>) =>
    vars ? tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')) : tmpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (
        key: string,
        fallback?: string | Record<string, unknown>,
        opts?: Record<string, unknown>,
      ) => (typeof fallback === 'string' ? interpolate(fallback, opts) : interpolate(key, fallback)),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

// Spy formatters at the display boundary. The distinctive `dist:<n>` /
// `energy:<n>` output makes each cell both findable and order-readable, and the
// spies let us assert the SI value the component forwarded (never a converted
// one). `v ?? 0` mirrors how the real SI formatters treat a null.
const unitMocks = vi.hoisted(() => ({
  formatDistance: vi.fn((v?: number | null) => `dist:${v ?? 0}`),
  formatEnergy: vi.fn((v?: number | null) => `energy:${v ?? 0}`),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: unitMocks.formatDistance,
    formatEnergy: unitMocks.formatEnergy,
  }),
}));

import { TripDrivesTable } from './TripDrivesTable';
import type { TripDetail, TripDriveSummary } from '@/api/types';

type Props = ComponentProps<typeof TripDrivesTable>;

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeDrive(overrides: Partial<TripDriveSummary> = {}): TripDriveSummary {
  return {
    id: 1,
    started_at: '2026-03-01T12:00:00Z',
    ended_at: '2026-03-01T12:30:00Z',
    distance_m: 0,
    energy_used_wh: 0,
    duration_s: 0,
    start_place: null,
    end_place: null,
    ...overrides,
  };
}

function makeTrip(drives: TripDriveSummary[]): TripDetail {
  return {
    id: 1,
    vehicle_id: 7,
    name: 'Weekend loop',
    start_date: '2026-03-01',
    end_date: '2026-03-20',
    started_at: '2026-03-01T12:00:00Z',
    ended_at: '2026-03-20T18:00:00Z',
    total_distance_m: 18000,
    total_energy_wh: 31000,
    total_duration_s: 5400,
    total_cost: 12.5,
    drive_count: drives.length,
    charge_count: 0,
    created_at: '2026-03-01T00:00:00Z',
    energy_used_wh: 31000,
    drives,
  };
}

// A: point-to-point, 30-min drive. B: single-ended (null end_place),
// 1-hour drive. C: round trip (start === end), no recorded duration.
const driveA = makeDrive({
  id: 1,
  started_at: '2026-03-01T12:00:00Z',
  distance_m: 5000,
  energy_used_wh: 8000,
  duration_s: 1800,
  start_place: 'Alpha',
  end_place: 'Beta',
});
const driveB = makeDrive({
  id: 2,
  started_at: '2026-03-10T12:00:00Z',
  distance_m: 1000,
  energy_used_wh: 20000,
  duration_s: 3600,
  start_place: 'Gamma',
  end_place: null,
});
const driveC = makeDrive({
  id: 3,
  started_at: '2026-03-20T12:00:00Z',
  distance_m: 12000,
  energy_used_wh: 3000,
  duration_s: null,
  start_place: 'Delta',
  end_place: 'Delta',
});

function renderTable(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    trip: makeTrip([driveA, driveB, driveC]),
    isLoading: false,
    isError: false,
    error: null,
    onRetry,
    ...overrides,
  };
  const view = render(
    <MemoryRouter>
      <TripDrivesTable {...props} />
    </MemoryRouter>,
  );
  return { onRetry, ...view };
}

// Distance cells are the only elements whose text starts with `dist:`, so their
// document order is the row order — a stable probe for the current sort.
const distanceOrder = () => screen.getAllByText(/^dist:/).map((el) => el.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

// ── Data rendering ──────────────────────────────────────────────────────────
describe('TripDrivesTable — data rendering', () => {
  it('renders the panel title and one row per drive', () => {
    renderTable();
    expect(screen.getByText('Drives in this trip')).toBeInTheDocument();
    // A header row + three data rows.
    expect(screen.getAllByRole('row')).toHaveLength(4);
    expect(distanceOrder()).toEqual(['dist:5000', 'dist:1000', 'dist:12000']);
  });

  it('forwards RAW SI values (metres, watt-hours) to the display-boundary formatters', () => {
    renderTable();
    // distance_m / energy_used_wh are handed over untouched — no pre-conversion.
    expect(unitMocks.formatDistance).toHaveBeenCalledWith(5000);
    expect(unitMocks.formatDistance).toHaveBeenCalledWith(12000);
    expect(unitMocks.formatEnergy).toHaveBeenCalledWith(8000);
    expect(unitMocks.formatEnergy).toHaveBeenCalledWith(20000);
    // The formatted output actually reaches the DOM.
    expect(screen.getByText('energy:8000')).toBeInTheDocument();
  });

  it('renders the rounded duration and the "—" guard for a null duration', () => {
    renderTable();
    expect(screen.getByText('30m')).toBeInTheDocument(); // driveA: 1800s
    expect(screen.getByText('1h')).toBeInTheDocument(); // driveB: 3600s
    expect(screen.getByText('—')).toBeInTheDocument(); // driveC: null → guarded
  });

  it('renders the RouteDisplay variants: from→to, single-ended, and round trip', () => {
    renderTable();
    expect(screen.getByText(/Alpha/)).toBeInTheDocument(); // "Alpha → Beta"
    expect(screen.getByText(/No location data/)).toBeInTheDocument(); // driveB null end
    expect(screen.getByText(/round trip/)).toBeInTheDocument(); // driveC start === end
  });
});

// ── Sorting ─────────────────────────────────────────────────────────────────
describe('TripDrivesTable — functional column sorting', () => {
  it('leaves rows in API order until a header is clicked', () => {
    renderTable();
    expect(distanceOrder()).toEqual(['dist:5000', 'dist:1000', 'dist:12000']);
    // Sortable columns advertise `aria-sort="none"` until one becomes the
    // active sort key; no column claims ascending/descending yet.
    expect(
      document.querySelector('th[aria-sort="ascending"], th[aria-sort="descending"]'),
    ).toBeNull();
  });

  it('sorts by distance descending then ascending on repeat clicks', () => {
    const { container } = renderTable();
    const distanceHeader = () => screen.getByRole('button', { name: 'Distance' });
    fireEvent.click(distanceHeader()); // first click → desc
    expect(distanceOrder()).toEqual(['dist:12000', 'dist:5000', 'dist:1000']);
    const sortedTh = container.querySelector('th[aria-sort="descending"]');
    expect(sortedTh).toHaveAttribute('aria-sort', 'descending');
    expect(sortedTh?.textContent).toContain('Distance');
    fireEvent.click(distanceHeader()); // second click → asc
    expect(distanceOrder()).toEqual(['dist:1000', 'dist:5000', 'dist:12000']);
  });

  it('sorts by energy using the watt-hour accessor', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Energy' })); // desc: 20000,8000,3000
    // → driveB (1000), driveA (5000), driveC (12000)
    expect(distanceOrder()).toEqual(['dist:1000', 'dist:5000', 'dist:12000']);
  });

  it('sorts by start timestamp (newest first on the first click)', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Started' })); // desc by epoch
    // 2026-03-20 (C), 2026-03-10 (B), 2026-03-01 (A)
    expect(distanceOrder()).toEqual(['dist:12000', 'dist:1000', 'dist:5000']);
  });

  it('sorts by duration, treating a null duration as zero', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Duration' })); // desc: 3600,1800,0
    // driveB (1000), driveA (5000), driveC (null→0, 12000)
    expect(distanceOrder()).toEqual(['dist:1000', 'dist:5000', 'dist:12000']);
  });

  it('coerces a corrupt started_at to "oldest" instead of corrupting the order', () => {
    // Input order [corrupt, valid]. A NaN comparator return would leave the
    // order untouched; the `Number.isFinite` guard coerces the bad timestamp to
    // 0 so a desc sort floats the valid (positive-epoch) row to the top.
    const corrupt = makeDrive({ id: 20, started_at: 'not-a-real-date', distance_m: 200 });
    const valid = makeDrive({ id: 21, started_at: '2026-05-01T12:00:00Z', distance_m: 100 });
    renderTable({ trip: makeTrip([corrupt, valid]) });
    expect(distanceOrder()).toEqual(['dist:200', 'dist:100']); // API order
    fireEvent.click(screen.getByRole('button', { name: 'Started' })); // desc
    expect(distanceOrder()).toEqual(['dist:100', 'dist:200']); // valid first, corrupt (0) last
  });
});

// ── Render states ─────────────────────────────────────────────────────────
describe('TripDrivesTable — render states', () => {
  it('shows the skeleton (and no table) while loading with no trip yet', () => {
    const { container } = renderTable({ trip: undefined, isLoading: true });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // Panel title is always present, even mid-load.
    expect(screen.getByText('Drives in this trip')).toBeInTheDocument();
  });

  it('renders a QueryError with a working Retry (and no table) on failure', () => {
    const { onRetry } = renderTable({ trip: undefined, isError: true, error: new Error('boom') });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('gives error strict priority over the loading skeleton', () => {
    const { container } = renderTable({
      trip: undefined,
      isError: true,
      isLoading: true,
      error: new Error('boom'),
    });
    // Error wins — no skeleton, no table.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the empty-state message when the trip has no drives', () => {
    renderTable({ trip: makeTrip([]) });
    expect(screen.getByText('No drives recorded for this trip')).toBeInTheDocument();
    expect(screen.queryByText(/^dist:/)).not.toBeInTheDocument();
  });
});

// ── Null-safety & accessibility ─────────────────────────────────────────────
describe('TripDrivesTable — null-safety & a11y', () => {
  it('exposes exactly the sortable columns as keyboard-operable buttons', () => {
    renderTable();
    for (const header of ['Started', 'Distance', 'Energy', 'Duration']) {
      expect(screen.getByRole('button', { name: header })).toBeInTheDocument();
    }
    // The Route column is intentionally non-sortable — no header button.
    expect(screen.queryByRole('button', { name: 'Route' })).not.toBeInTheDocument();
  });

  it('renders a fully-null drive without crashing, forwarding null to the formatter', () => {
    const sparse = makeDrive({
      id: 9,
      started_at: '2026-03-01T12:00:00Z',
      distance_m: null,
      energy_used_wh: null,
      duration_s: null,
      start_place: null,
      end_place: null,
    });
    expect(() => renderTable({ trip: makeTrip([sparse]) })).not.toThrow();
    // The component does not pre-guard the numeric — null reaches the formatter.
    expect(unitMocks.formatDistance).toHaveBeenCalledWith(null);
    expect(screen.getByText('dist:0')).toBeInTheDocument();
    expect(screen.getByText('energy:0')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument(); // duration guard
    expect(screen.getByText(/No location data/)).toBeInTheDocument(); // route fallback
  });

  it('degrades an undefined trip (not loading, not error) to the empty state', () => {
    expect(() => renderTable({ trip: undefined })).not.toThrow();
    expect(screen.getByText('No drives recorded for this trip')).toBeInTheDocument();
    expect(screen.getByText('Drives in this trip')).toBeInTheDocument();
  });

  it('marks the decorative panel icon as aria-hidden', () => {
    const { container } = renderTable();
    const icon = container.querySelector('svg[aria-hidden="true"]');
    expect(icon).not.toBeNull();
  });
});
