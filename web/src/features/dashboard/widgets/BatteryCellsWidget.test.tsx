/**
 * BatteryCellsWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of BatteryCellsWidget.tsx:
 *   - `cellStatus` — the pure deviation-classifier (all four branches +
 *     the non-finite guard), and
 *   - the default widget component across every render state and layout
 *     variant (compact / medium / wide), plus loading / error / empty /
 *     null-data branches and the manual-refresh interaction.
 *
 * Strategy (mirrors the repo convention, e.g. RecentlyViewedWidget.test.tsx
 * and BatteryHealthPage.test.tsx):
 *   - The two data hooks (`useBatteryCells`, `useVehicles`) are replaced with
 *     hoisted `vi.fn()` doubles so the network is never touched and each
 *     render is deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback string and
 *     interpolate `{{vars}}`, so assertions read the real English copy.
 *   - The global test-setup already mocks `useSettings` (km / °C) and
 *     `useTimezone` (UTC), which the transitive <DataFreshness> header needs.
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

// jsdom lacks matchMedia; framer-motion (read transitively by
// useMotionPreference inside <DataFreshness>) touches it on first paint.
// Install a no-op before any import runs.
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
// `{{vars}}` from the options object so assertions read production copy.
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
const { batteryCellsMock, vehiclesMock } = vi.hoisted(() => ({
  batteryCellsMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useEnergy', () => ({ useBatteryCells: batteryCellsMock }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));

import BatteryCellsWidget, { cellStatus } from './BatteryCellsWidget';
import type { BatteryCellSummary } from '@/types/energy';
import type { WidgetSize } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_MEDIUM: WidgetSize = { cols: 2, rows: 3 };
const SIZE_WIDE: WidgetSize = { cols: 4, rows: 3 };

function makeSummary(overrides: Partial<BatteryCellSummary> = {}): BatteryCellSummary {
  return {
    total_cells: 3,
    avg_voltage: 3.7,
    min_voltage: 3.695,
    max_voltage: 3.712,
    voltage_spread: 0.017,
    avg_temperature: 24.5,
    min_temperature: 23.1,
    max_temperature: 26.0,
    temp_spread: 2.9,
    cells: [
      { cell_id: 1, module: 1, voltage: 3.701, temperature: 24.0 }, // ~1 mV → ok
      { cell_id: 2, module: 1, voltage: 3.71, temperature: 25.0 }, // ~10 mV → warning
      { cell_id: 3, module: 2, voltage: 3.68, temperature: 26.0 }, // ~20 mV → error
    ],
    ...overrides,
  };
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

function makeQuery(data?: BatteryCellSummary, over: QueryOverrides = {}) {
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
  batteryCellsMock.mockReset();
  vehiclesMock.mockReset();
  // Sensible defaults; individual tests override as needed.
  vehiclesMock.mockReturnValue({ data: [{ id: 42 }] });
  batteryCellsMock.mockReturnValue(makeQuery(makeSummary()));
});

// ── cellStatus (pure) ────────────────────────────────────────────────────────
describe('cellStatus', () => {
  it('classifies by absolute deviation from the average voltage', () => {
    expect(cellStatus(3.7, 3.7)).toBe('ok'); // 0 mV
    expect(cellStatus(3.703, 3.7)).toBe('ok'); // ~3 mV
    expect(cellStatus(3.71, 3.7)).toBe('warning'); // ~10 mV
    expect(cellStatus(3.69, 3.7)).toBe('warning'); // ~10 mV (below avg)
    expect(cellStatus(3.72, 3.7)).toBe('error'); // ~20 mV
    expect(cellStatus(3.66, 3.7)).toBe('error'); // ~40 mV
  });

  it('returns "unknown" for missing or non-finite readings', () => {
    expect(cellStatus(null, 3.7)).toBe('unknown');
    expect(cellStatus(Number.NaN, 3.7)).toBe('unknown');
    expect(cellStatus(Number.POSITIVE_INFINITY, 3.7)).toBe('unknown');
    expect(cellStatus(Number.NEGATIVE_INFINITY, 3.7)).toBe('unknown');
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('BatteryCellsWidget', () => {
  it('renders cells and the min/max/avg/spread summary at medium size', () => {
    renderWidget(<BatteryCellsWidget size={SIZE_MEDIUM} />);

    // Title header (visible above compact).
    expect(screen.getByText('Battery Cells')).toBeInTheDocument();

    // Compact cell labels + per-cell voltage values.
    expect(screen.getByText('C1')).toBeInTheDocument();
    expect(screen.getByText('C2')).toBeInTheDocument();
    expect(screen.getByText('C3')).toBeInTheDocument();
    expect(screen.getByText('3.701 V')).toBeInTheDocument();

    // Summary tiles (label + formatted value).
    expect(screen.getByText('Min V')).toBeInTheDocument();
    expect(screen.getByText('3.695 V')).toBeInTheDocument();
    expect(screen.getByText('Max V')).toBeInTheDocument();
    expect(screen.getByText('3.712 V')).toBeInTheDocument();
    expect(screen.getByText('Avg V')).toBeInTheDocument();
    expect(screen.getByText('3.700 V')).toBeInTheDocument();
    expect(screen.getByText('Spread')).toBeInTheDocument();
    expect(screen.getByText('17.0 mV')).toBeInTheDocument();

    // The temperature summary is a wide-only row — absent here.
    expect(screen.queryByText('Min Temp')).not.toBeInTheDocument();
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget(<BatteryCellsWidget size={SIZE_MEDIUM} />);
    expect(batteryCellsMock).toHaveBeenCalledWith('42');
  });

  it('uses the explicit vehicleId prop when provided', () => {
    renderWidget(<BatteryCellsWidget vehicleId={7} size={SIZE_MEDIUM} />);
    expect(batteryCellsMock).toHaveBeenCalledWith('7');
  });

  it('passes null to the query and shows the empty state when there are no vehicles', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    batteryCellsMock.mockReturnValue(makeQuery(undefined));

    renderWidget(<BatteryCellsWidget size={SIZE_MEDIUM} />);

    expect(batteryCellsMock).toHaveBeenCalledWith(null);
    expect(screen.getByText('No battery cell data')).toBeInTheDocument();
  });

  it('renders rich labels, per-cell temperature and the temp summary at wide size', () => {
    renderWidget(<BatteryCellsWidget size={SIZE_WIDE} />);

    // Wide labels include module + a combined voltage/temperature value.
    expect(screen.getByText('Cell 1 · M1')).toBeInTheDocument();
    expect(screen.getByText('3.701 V / 24.0°')).toBeInTheDocument();

    // Wide-only temperature summary row.
    expect(screen.getByText('Min Temp')).toBeInTheDocument();
    expect(screen.getByText('23.1°')).toBeInTheDocument();
    expect(screen.getByText('Avg Temp')).toBeInTheDocument();
    expect(screen.getByText('24.5°')).toBeInTheDocument();
    expect(screen.getByText('Max Temp')).toBeInTheDocument();
    expect(screen.getByText('26.0°')).toBeInTheDocument();
  });

  it('hides the title and per-cell values in compact layout', () => {
    renderWidget(<BatteryCellsWidget size={SIZE_COMPACT} />);

    // 1×1 widget: the title chrome is suppressed by design.
    expect(screen.queryByText('Battery Cells')).not.toBeInTheDocument();
    // Labels still render...
    expect(screen.getByText('C1')).toBeInTheDocument();
    // ...but the compact grid omits the per-cell voltage value.
    expect(screen.queryByText('3.701 V')).not.toBeInTheDocument();
  });

  it('shows the "no cell data" grid placeholder while still rendering the summary when cells are empty', () => {
    batteryCellsMock.mockReturnValue(makeQuery(makeSummary({ cells: [] })));

    renderWidget(<BatteryCellsWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No cell data')).toBeInTheDocument();
    // Section is never hidden — the summary tiles still show.
    expect(screen.getByText('Min V')).toBeInTheDocument();
  });

  it('renders the empty state (and no summary) when data is null', () => {
    batteryCellsMock.mockReturnValue(makeQuery(undefined));

    renderWidget(<BatteryCellsWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No battery cell data')).toBeInTheDocument();
    expect(screen.queryByText('Min V')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton without any content while fetching the first time', () => {
    batteryCellsMock.mockReturnValue(makeQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<BatteryCellsWidget size={SIZE_MEDIUM} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Min V')).not.toBeInTheDocument();
    expect(screen.queryByText('No battery cell data')).not.toBeInTheDocument();
  });

  it('surfaces an error state instead of the panel body when the query fails', () => {
    batteryCellsMock.mockReturnValue(
      makeQuery(undefined, { error: new Error('boom'), isError: true }),
    );

    renderWidget(<BatteryCellsWidget size={SIZE_MEDIUM} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Min V')).not.toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    batteryCellsMock.mockReturnValue(
      makeQuery(makeSummary(), { refetch, isFetching: false }),
    );

    renderWidget(<BatteryCellsWidget size={SIZE_MEDIUM} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
