/**
 * DriveScoreGaugeWidget — behaviour, hardening & a11y contract.
 *
 * The widget resolves a vehicle (explicit prop → first vehicle → none), reads a
 * single `useDriveScore` result, and fans it into three responsive layouts
 * (compact 1×1 gauge-only / standard gauge + stat row / tall gauge + stats +
 * sub-score bars) plus one pure export (`scoreColor`). This suite drives every
 * export:
 *
 *   - `scoreColor` is unit-tested across all four tiers, at each threshold
 *     boundary, and for the non-finite (`NaN`) hardening path;
 *   - the component is exercised through its accessible surface for vehicle
 *     resolution (prop wins over the vehicle list; the list supplies the
 *     fallback; no vehicle → `undefined` so the query stays disabled), the
 *     loading / error paths, the populated standard + tall + compact layouts,
 *     the freshness refresh interaction, and — most importantly — the
 *     zero-drives regression: `/drives/score` answers 200 with an all-zero
 *     object (grade "F", total_drives 0) for a vehicle that has never driven,
 *     so a plain truthiness check would render a misleading "0 / F" gauge; the
 *     widget must instead surface the "No score yet" empty state.
 *
 * `useDriveScore` + `useVehicles` are mocked at the hook boundary so no network
 * is touched. `react-i18next` is stubbed to echo the English fallback and
 * interpolate `{{var}}` tokens. `@testing-library/user-event` is not installed
 * in this repo (see the sibling BackupMonitorWidget / ChargeSessionChartWidget
 * suites), so the one interaction goes through `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any interpolated copy renders as real text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two data sources become controllable vi.fns.
vi.mock('@/api/hooks/useDriving', () => ({
  useDriveScore: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
}));

import DriveScoreGaugeWidget, { scoreColor } from './DriveScoreGaugeWidget';
import { useDriveScore } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { DriveScore } from '@/types/driving';
import type { WidgetSize } from './types';

const mockUseDriveScore = vi.mocked(useDriveScore);
const mockUseVehicles = vi.mocked(useVehicles);

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via <DataFreshness>
// inside <WidgetShell>, and <MetricBar>/<LinearGauge> motion) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

/** A fully-populated score (total_drives > 0 → the gauge renders). */
function makeScore(over: Partial<DriveScore> = {}): DriveScore {
  return {
    overall: 87,
    efficiency: 90,
    smoothness: 82,
    speedDiscipline: 75,
    grade: 'B',
    totalDrives: 12,
    trend: 'up',
    ...over,
  };
}

function renderWidget(size: WidgetSize, vehicleId?: number) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DriveScoreGaugeWidget size={size} vehicleId={vehicleId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 2, rows: 1 }; // not compact, not tall
const TALL: WidgetSize = { cols: 2, rows: 2 }; // not compact, tall (sub-score bars)

beforeEach(() => {
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as any);
  mockUseDriveScore.mockReturnValue(qr({ data: undefined }));
});

// ── Pure helper: scoreColor ────────────────────────────────────────────────

describe('scoreColor', () => {
  it('maps the excellent / good tiers at and above their lower bounds', () => {
    expect(scoreColor(100)).toBe('#10b981'); // excellent
    expect(scoreColor(80)).toBe('#10b981'); // boundary → excellent
    expect(scoreColor(79.9)).toBe('#22d3ee'); // just below → good
    expect(scoreColor(60)).toBe('#22d3ee'); // boundary → good
  });

  it('maps the fair / poor tiers and treats non-finite scores as poor', () => {
    expect(scoreColor(59)).toBe('#f59e0b'); // fair
    expect(scoreColor(40)).toBe('#f59e0b'); // boundary → fair
    expect(scoreColor(39)).toBe('#ef4444'); // poor
    expect(scoreColor(0)).toBe('#ef4444'); // poor
    expect(scoreColor(Number.NaN)).toBe('#ef4444'); // NaN comparisons false → poor
  });
});

// ── Vehicle resolution ─────────────────────────────────────────────────────

describe('DriveScoreGaugeWidget vehicle resolution', () => {
  it('prefers the explicit vehicleId prop over the vehicle list', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as any);
    renderWidget(STANDARD, 42);

    expect(mockUseDriveScore).toHaveBeenCalledWith('42');
    expect(mockUseDriveScore).not.toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle when no prop is given, else queries undefined', () => {
    // First vehicle supplies the id.
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as any);
    const { unmount } = renderWidget(STANDARD);
    expect(mockUseDriveScore).toHaveBeenCalledWith('7');
    unmount();

    // No vehicle at all → undefined arg keeps the query disabled.
    vi.clearAllMocks();
    mockUseVehicles.mockReturnValue({ data: [] } as any);
    mockUseDriveScore.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);
    expect(mockUseDriveScore).toHaveBeenCalledWith(undefined);
  });
});

// ── States: loading / error ────────────────────────────────────────────────

describe('DriveScoreGaugeWidget states', () => {
  it('renders a loading skeleton (no title, no empty copy) while fetching', () => {
    mockUseDriveScore.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(TALL);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Drive Score')).toBeNull();
    expect(screen.queryByText('No score yet')).toBeNull();
  });

  it('surfaces a QueryError (never a blank panel) when the score request fails', () => {
    mockUseDriveScore.mockReturnValue(
      qr({ isError: true, error: new Error('boom'), data: undefined }),
    );
    renderWidget(TALL);

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Drive Score')).toBeNull();
  });
});

// ── Regression: zero-drives object must show the empty state ────────────────

describe('DriveScoreGaugeWidget empty (no scored drives)', () => {
  it('shows "No score yet" instead of a misleading 0 / F gauge for total_drives === 0', () => {
    // The real backend shape for a vehicle that has never driven.
    mockUseDriveScore.mockReturnValue(
      qr({
        data: makeScore({
          overall: 0,
          efficiency: 0,
          smoothness: 0,
          speedDiscipline: 0,
          grade: 'F',
          totalDrives: 0,
          trend: 'flat',
        }),
      }),
    );
    renderWidget(TALL);

    const empty = screen.getByText('No score yet');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();

    // The gauge / grade "F" and the sub-score stats must NOT render.
    expect(screen.queryByText('F')).toBeNull();
    expect(screen.queryByText('Efficiency')).toBeNull();
  });

  it('renders the gauge (not the empty state) as soon as there is one scored drive', () => {
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore({ totalDrives: 1 }) }));
    renderWidget(STANDARD);

    expect(screen.queryByText('No score yet')).toBeNull();
    expect(screen.getByText('87')).toBeInTheDocument(); // gauge value
    expect(screen.getByText('B')).toBeInTheDocument(); // gauge grade label
  });
});

// ── Standard layout (gauge + stat row, no sub-score bars) ───────────────────

describe('DriveScoreGaugeWidget standard layout', () => {
  it('renders the title, gauge value, grade and the three summary stats once each', () => {
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore() }));
    renderWidget(STANDARD);

    expect(screen.getByText('Drive Score')).toBeInTheDocument(); // header title
    expect(screen.getByText('87')).toBeInTheDocument(); // gauge overall
    expect(screen.getByText('B')).toBeInTheDocument(); // gauge grade label

    // Stat labels + values are present.
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Smoothness')).toBeInTheDocument();
    expect(screen.getByText('Speed Discipline')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();

    // Non-tall → no MetricBar, so each label appears exactly once (stats only).
    expect(screen.getAllByText('Efficiency')).toHaveLength(1);
  });
});

// ── Tall layout (gauge + stats + sub-score MetricBars) ──────────────────────

describe('DriveScoreGaugeWidget tall layout', () => {
  it('adds the per-metric sub-score bars, so each metric label appears twice', () => {
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore() }));
    renderWidget(TALL);

    // Once in the stat row, once as a MetricBar label.
    expect(screen.getAllByText('Efficiency')).toHaveLength(2);
    expect(screen.getAllByText('Smoothness')).toHaveLength(2);
    expect(screen.getAllByText('Speed Discipline')).toHaveLength(2);

    // The bar sublabel echoes the value alongside the stat value → two "90"s.
    expect(screen.getAllByText('90')).toHaveLength(2);
    expect(screen.getByText('87')).toBeInTheDocument(); // gauge overall stays singular
  });
});

// ── Compact layout (gauge only) ─────────────────────────────────────────────

describe('DriveScoreGaugeWidget compact layout', () => {
  it('drops the title and stat row, showing only the gauge value + grade', () => {
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore() }));
    renderWidget(COMPACT);

    // The compact 1×1 gauge keeps the score + grade but nothing else.
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();

    expect(screen.queryByText('Drive Score')).toBeNull(); // title hidden
    expect(screen.queryByText('Efficiency')).toBeNull(); // stats hidden
    expect(screen.queryByText('90')).toBeNull(); // stat value hidden
  });
});

// ── Refresh interaction ─────────────────────────────────────────────────────

describe('DriveScoreGaugeWidget refresh', () => {
  it('invokes refetch when the freshness refresh control is activated', () => {
    const refetch = vi.fn();
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore(), refetch }));
    renderWidget(STANDARD);

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
