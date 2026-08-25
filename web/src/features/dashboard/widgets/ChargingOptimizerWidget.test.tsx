/**
 * ChargingOptimizerWidget — behaviour, responsive-branch + hardening coverage.
 *
 * The widget is the dashboard's smart-charging tile. Its surface under test:
 *
 *   1. Responsive layout branches keyed off `size.cols`:
 *        - compact (cols ≤ 1) → a title-less shell with the optimal-start
 *          headline, a "SOC {pct}%" caption, and a savings badge (only when
 *          the projected monthly savings are positive).
 *        - standard (2–3 cols) → a titled shell + a 3-up metric grid
 *          (Optimal start / Target SOC / Savings) + a peak-usage line whose
 *          badge flips between "Optimized" and "Can improve" at the 30% peak
 *          threshold + a recommendation tip-card list.
 *        - wide (cols ≥ 4) → everything in standard PLUS the 24h rate-timeline
 *          image (peak / off-peak / standard cells) with a Zap glyph on the
 *          optimal-start hour.
 *   2. `formatHour` labelling, including the hardening that normalises
 *      malformed hours (NaN / negative / 24+) into a valid 0–23 clock label
 *      instead of "NaN PM".
 *   3. Loading / error / empty branches (never a blank panel). The error
 *      branch surfaces the shared QueryError panel — a fetch failure must be
 *      distinguishable from genuinely-empty data.
 *   4. Freshness-control refresh → refetch.
 *   5. Null-safety of a malformed / partial payload: a missing schedule /
 *      cost block, a non-array recommendations field, non-array peak/off-peak
 *      hour lists, and a null recommendation entry must all degrade cleanly
 *      (em-dash placeholders, empty timeline cells) without crashing.
 *   6. Vehicle selection: an explicit `vehicleId` wins, otherwise the first
 *      vehicle from `useVehicles` is used, otherwise the hook is disabled
 *      (called with null).
 *
 * Strategy (mirrors AnalyticsSummaryWidget.test.tsx / BatteryDegradationTrendWidget.test.tsx):
 *   - The data hook + useVehicles are mocked with hoisted vi.fn()s so the
 *     network is never touched and every render is deterministic. The widget
 *     keeps the REAL number formatter, so the displayed values are genuinely
 *     exercised.
 *   - react-i18next resolves the developer fallback string (interpolating
 *     `{{vars}}`), so assertions read the English defaults.
 *   - matchMedia is shimmed to report `prefers-reduced-motion: reduce`, which
 *     settles framer-motion (read by the freshness chip) deterministically.
 *   - Renders are wrapped in <MemoryRouter> because the error branch mounts
 *     <QueryError>, which calls `useNavigate`.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * dashboard tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion (useReducedMotion, read by the
// freshness chip) reads it at module load. Report reduced motion so the
// freshness dot settles deterministically.
vi.hoisted(() => {
  if (typeof window !== 'undefined') {
    window.matchMedia = ((query: string) => ({
      matches: /prefers-reduced-motion/.test(query),
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

const { optimizerMock, vehiclesMock } = vi.hoisted(() => ({
  optimizerMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useCharging', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useCharging')>('@/api/hooks/useCharging');
  return { ...actual, useChargingOptimizer: (...args: unknown[]) => optimizerMock(...args) };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>('@/api/hooks/useVehicles');
  return { ...actual, useVehicles: () => vehiclesMock() };
});

import ChargingOptimizerWidget from './ChargingOptimizerWidget';
import type { WidgetSize } from './types';
import type { ChargingOptimizerData } from '@/types/charging';

/* ── Fixtures ─────────────────────────────────────────────────────── */

// Round numbers so the formatting maths is exact and the strings are stable
// regardless of the (test-default) global precision/locale.
const SCHED = {
  most_common_start_hour: 2, // → "2 AM"
  most_common_day: 'Sunday',
  avg_sessions_per_week: 4,
  home_charging_pct: 90,
  avg_charge_to_pct: 80, // → "80%"
};

const COST = {
  peak_hours: [18, 19, 20], // → "6 PM — Peak"
  offpeak_hours: [1, 2, 3], // → "2 AM — Off-peak"
  peak_cost_per_kwh: 0.35,
  offpeak_cost_per_kwh: 0.12,
  sessions_during_peak_pct: 15, // < 30 → "Optimized"
  potential_monthly_savings: 45, // → "$45"
};

const RECS = [
  {
    type: 'shift_offpeak',
    priority: 'high' as const,
    title: 'Shift to off-peak',
    detail: 'Move charging to overnight',
  },
];

const DATA: ChargingOptimizerData = {
  current_schedule: SCHED,
  cost_analysis: COST,
  battery_health_score: 95,
  recommendations: RECS,
  weekly_heatmap: [],
};

function makeData(overrides: Record<string, unknown> = {}): ChargingOptimizerData {
  return { ...DATA, ...overrides } as unknown as ChargingOptimizerData;
}

interface FakeQuery {
  data?: unknown;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <ChargingOptimizerWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  optimizerMock.mockReset();
  vehiclesMock.mockReset();
  optimizerMock.mockReturnValue(makeQuery({ data: DATA }));
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('ChargingOptimizerWidget', () => {
  it('compact layout shows the optimal-start headline, SOC caption + savings badge', () => {
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('2 AM')).toBeInTheDocument();
    expect(screen.getByText('SOC 80%')).toBeInTheDocument();
    expect(screen.getByText('$45/mo')).toBeInTheDocument();

    // Compact is title-less and never renders the standard metric grid.
    expect(screen.queryByText('Charging Optimizer')).not.toBeInTheDocument();
    expect(screen.queryByText('Optimal start')).not.toBeInTheDocument();
  });

  it('compact layout hides the savings badge when there is no projected saving', () => {
    optimizerMock.mockReturnValue(
      makeQuery({ data: makeData({ cost_analysis: { ...COST, potential_monthly_savings: 0 } }) }),
    );
    renderWidget({ cols: 1, rows: 1 });

    // Headline + caption still render; the $0 badge must not appear.
    expect(screen.getByText('2 AM')).toBeInTheDocument();
    expect(screen.getByText('SOC 80%')).toBeInTheDocument();
    expect(screen.queryByText('$0/mo')).not.toBeInTheDocument();
  });

  it('compact layout shows the empty state when there is no data', () => {
    optimizerMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget({ cols: 1, rows: 1 });

    expect(screen.getByText('No optimizer data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('2 AM')).not.toBeInTheDocument();
  });

  it('standard layout renders the titled shell, 3 metric cards + the "Optimized" badge', () => {
    renderWidget();

    // Titled shell — no gutted panel.
    expect(screen.getByText('Charging Optimizer')).toBeInTheDocument();

    for (const label of ['Optimal start', 'Target SOC', 'Savings/mo']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Metric values: real formatter output.
    expect(screen.getByText('2 AM')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('$45')).toBeInTheDocument();

    // Peak-usage line + optimized badge (15% < 30%).
    expect(screen.getByText('Peak charging: 15%')).toBeInTheDocument();
    expect(screen.getByText('Optimized')).toBeInTheDocument();

    // The 24h timeline belongs to the wide layout only.
    expect(screen.queryByRole('img', { name: '24h Rate Timeline' })).not.toBeInTheDocument();
  });

  it('flips the schedule badge to "Can improve" once peak usage crosses 30%', () => {
    optimizerMock.mockReturnValue(
      makeQuery({ data: makeData({ cost_analysis: { ...COST, sessions_during_peak_pct: 40 } }) }),
    );
    renderWidget();

    expect(screen.getByText('Peak charging: 40%')).toBeInTheDocument();
    expect(screen.getByText('Can improve')).toBeInTheDocument();
    expect(screen.queryByText('Optimized')).not.toBeInTheDocument();
  });

  it('renders each recommendation as a tip card with its priority badge', () => {
    renderWidget();

    expect(screen.getByText('Shift to off-peak')).toBeInTheDocument();
    expect(screen.getByText('Move charging to overnight')).toBeInTheDocument();
    // impact 'high' resolves to the translated priority label.
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('shows the "No recommendations" empty tip state while keeping the metric grid', () => {
    optimizerMock.mockReturnValue(makeQuery({ data: makeData({ recommendations: [] }) }));
    renderWidget();

    expect(screen.getByText('No recommendations')).toBeInTheDocument();
    // The metrics still render alongside the empty tip list.
    expect(screen.getByText('Optimal start')).toBeInTheDocument();
    expect(screen.getByText('2 AM')).toBeInTheDocument();
  });

  it('wide layout renders the 24h rate-timeline image with peak / off-peak / standard cells', () => {
    renderWidget({ cols: 4, rows: 2 });

    // The timeline is exposed as a single labelled image (a11y).
    expect(screen.getByRole('img', { name: '24h Rate Timeline' })).toBeInTheDocument();

    // Cells carry a title tooltip classifying each hour.
    expect(screen.getByTitle('6 PM — Peak')).toBeInTheDocument();
    expect(screen.getByTitle('2 AM — Off-peak')).toBeInTheDocument();
    expect(screen.getByTitle('10 AM — Standard')).toBeInTheDocument();

    // Standard content still renders in the wide layout.
    expect(screen.getByText('Optimal start')).toBeInTheDocument();
  });

  it('marks only the optimal-start hour cell with a Zap glyph', () => {
    renderWidget({ cols: 4, rows: 2 });

    // The optimal-start hour (2) is off-peak in the fixture and carries the marker.
    const startCell = screen.getByTitle('2 AM — Off-peak');
    expect(startCell.querySelector('svg')).toBeInTheDocument();

    // A non-optimal hour has no marker svg inside it.
    const otherCell = screen.getByTitle('10 AM — Standard');
    expect(otherCell.querySelector('svg')).toBeNull();
  });

  it('normalizes malformed start hours to a valid clock label (formatHour hardening)', () => {
    const cases: Array<[number, string]> = [
      [Number.NaN, '12 AM'],
      [25, '1 AM'],
      [-1, '11 PM'],
      [24, '12 AM'],
    ];
    for (const [hour, label] of cases) {
      optimizerMock.mockReturnValue(
        makeQuery({ data: makeData({ current_schedule: { ...SCHED, most_common_start_hour: hour } }) }),
      );
      const { unmount } = renderWidget();
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it('renders a skeleton placeholder while the optimizer query is loading', () => {
    optimizerMock.mockReturnValue(makeQuery({ isLoading: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget();

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    // No content while loading.
    expect(screen.queryByText('Charging Optimizer')).not.toBeInTheDocument();
    expect(screen.queryByText('Optimal start')).not.toBeInTheDocument();
  });

  it('surfaces the error panel (not the empty state) when the query fails', () => {
    optimizerMock.mockReturnValue(
      makeQuery({ error: new Error('boom'), isError: true, dataUpdatedAt: 0 }),
    );
    renderWidget();

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The misleading "no data" empty state must NOT appear on error.
    expect(screen.queryByText('No optimizer data')).not.toBeInTheDocument();
    expect(screen.queryByText('Charging Optimizer')).not.toBeInTheDocument();
    // The error branch replaces the header, so there is no refresh control.
    expect(screen.queryByRole('button', { name: /^Refresh/i })).not.toBeInTheDocument();
  });

  it('shows the no-data empty state (standard) while keeping the titled shell', () => {
    optimizerMock.mockReturnValue(makeQuery({ data: undefined }));
    renderWidget();

    expect(screen.getByText('Charging Optimizer')).toBeInTheDocument();
    expect(screen.getByText('No optimizer data')).toBeInTheDocument();
    expect(screen.queryByText('Optimal start')).not.toBeInTheDocument();
  });

  it('refreshes the optimizer when the freshness control is activated', () => {
    const q = makeQuery({ data: DATA });
    optimizerMock.mockReturnValue(q);
    renderWidget();

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    expect(q.refetch).not.toHaveBeenCalled();
    fireEvent.click(refresh);
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('is null-safe: a partial payload (no schedule/cost, null rec) degrades without crashing', () => {
    // Backend contract says every field is present, but the widget must not
    // assume it — a schedule/cost-less payload with a null recommendation
    // entry must render em-dash placeholders instead of throwing.
    optimizerMock.mockReturnValue(
      makeQuery({
        data: {
          recommendations: [
            null,
            { priority: 'medium', title: 'Valid tip', detail: 'Still shown' },
          ],
        } as unknown as ChargingOptimizerData,
      }),
    );

    expect(() => renderWidget()).not.toThrow();

    // Missing schedule → hour 0 → "12 AM"; missing SOC → "0%"; missing cost → "$0".
    expect(screen.getByText('12 AM')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('$0')).toBeInTheDocument();
    // Peak 0% → still "Optimized".
    expect(screen.getByText('Optimized')).toBeInTheDocument();

    // The valid recommendation survives; the null entry collapses to two
    // em-dash placeholders (title + description) without a badge.
    expect(screen.getByText('Valid tip')).toBeInTheDocument();
    expect(screen.getByText('Still shown')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('is null-safe: non-array cost hours + recommendations do not crash the wide timeline', () => {
    optimizerMock.mockReturnValue(
      makeQuery({
        data: {
          current_schedule: SCHED,
          cost_analysis: {
            ...COST,
            peak_hours: null,
            offpeak_hours: undefined,
          },
          recommendations: 'not-an-array',
        } as unknown as ChargingOptimizerData,
      }),
    );

    expect(() => renderWidget({ cols: 4, rows: 2 })).not.toThrow();

    // The timeline still renders; with no peak/off-peak lists every hour is
    // classified "Standard".
    expect(screen.getByRole('img', { name: '24h Rate Timeline' })).toBeInTheDocument();
    expect(screen.getByTitle('6 PM — Standard')).toBeInTheDocument();
    // A non-array recommendations field coerces to an empty tip list.
    expect(screen.getByText('No recommendations')).toBeInTheDocument();
  });

  it('falls back to the first vehicle when no vehicleId prop is supplied', () => {
    renderWidget();
    expect(optimizerMock).toHaveBeenCalledWith('7');
  });

  it('uses the explicit vehicleId prop over the vehicle list', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(optimizerMock).toHaveBeenCalledWith('42');
  });

  it('disables the query (null) when no vehicle can be resolved', () => {
    vehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(optimizerMock).toHaveBeenCalledWith(null);
  });
});
