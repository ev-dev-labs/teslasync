/**
 * BatteryHealthSection — behaviour, branch, computation, a11y + null-safety.
 *
 * The section is a presentational leaf inside the weekly-digest bento. It takes
 * a fully-aggregated `DigestMetrics` plus the charging domain's query state and
 * renders one of four mutually-exclusive bodies under a persistent panel title:
 *
 *   isLoading            → <Skeleton>          (nothing else leaks through)
 *   isError              → <QueryError>        (retry wired to onRetry)
 *   chargingSessionCount → <EmptyState>        (no charge sessions this week)
 *     <= 0
 *   otherwise            → two <BatteryPill>s (avg SoC at charge start / end,
 *                          rounded) + three <MiniStat>s (avg charge gain %,
 *                          session count, estimated range added in km).
 *
 * The branch order is asserted directly (loading beats error beats empty), the
 * derived numbers are pinned (gain = end − start on RAW values; range = energy
 * × 5.5; pills round; counts run through fmtInt), and every optional field is
 * exercised nullish to prove the `?? 0` guards hold.
 *
 * Strategy: the component takes its data as props, so no network is touched.
 * <QueryError> reaches for useNavigate + useOnlineStatus, so the tree is wrapped
 * in QueryClientProvider + MemoryRouter (mirrors the sibling section tests).
 * Only `react-i18next` is mocked so `t(key, 'fallback')` renders deterministic
 * English. The global test-setup already stubs useSettings, so fmtNumber uses
 * the en-US locale at the precision each call passes explicitly.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; install a benign stub before any module that might
// read it at import time evaluates (defensive — shared UI pulls it in).
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

// i18n → return the developer fallback string, interpolating {{vars}} so any
// error/empty copy reads as real English instead of a raw key.
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

import { BatteryHealthSection } from './BatteryHealthSection';
import type { DigestMetrics } from './types';
import { ApiError } from '@/lib/resilience';

// A fully-zeroed DigestMetrics so each test overrides only the fields the
// battery section actually reads (chargingSessionCount, batteryStart,
// batteryEnd, chargeEnergyAdded) — the prop type demands the whole shape.
function makeMetrics(over: Partial<DigestMetrics> = {}): DigestMetrics {
  return {
    totalDistance: 0,
    prevDistance: 0,
    totalDrives: 0,
    prevDriveCount: 0,
    energyUsed: 0,
    prevEnergy: 0,
    chargingCost: 0,
    prevChargingCost: 0,
    co2Saved: 0,
    prevCo2: 0,
    avgEfficiency: 0,
    prevAvgEfficiency: 0,
    totalDuration: 0,
    topDrive: undefined,
    chargeEnergyAdded: 0,
    prevChargeEnergy: 0,
    avgChargeRate: 0,
    chargingSessionCount: 0,
    batteryStart: 0,
    batteryEnd: 0,
    alertsByType: {},
    alertTotal: 0,
    ...over,
  };
}

interface RenderOverrides {
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderSection(metrics: DigestMetrics, over: RenderOverrides = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BatteryHealthSection metrics={metrics} {...over} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function title(): HTMLElement {
  return screen.getByRole('heading', { level: 3, name: 'Battery Health' });
}

describe('BatteryHealthSection — populated', () => {
  it('renders the panel title as an h3 whose accessible name excludes the decorative icon', () => {
    renderSection(makeMetrics({ chargingSessionCount: 12, batteryStart: 20, batteryEnd: 80 }));

    // PanelTitle → <h3>; the Battery glyph is aria-hidden so the a11y name is
    // exactly the copy, not "battery Battery Health".
    const heading = title();
    expect(heading.tagName).toBe('H3');
    expect(heading).toHaveAccessibleName('Battery Health');
  });

  it('renders both battery pills with their labels and rounded SoC values', () => {
    renderSection(
      makeMetrics({ chargingSessionCount: 12, batteryStart: 20, batteryEnd: 80, chargeEnergyAdded: 40 }),
    );

    expect(screen.getByText('Avg Battery at Charge Start')).toBeInTheDocument();
    expect(screen.getByText('Avg Battery at Charge End')).toBeInTheDocument();
    // BatteryPill renders `${fmtInt(level)}%` — level is Math.round(metric).
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('derives the three mini-stats: gain = end − start, fmtInt session count, range = energy × 5.5 km', () => {
    renderSection(
      makeMetrics({ chargingSessionCount: 12, batteryStart: 20, batteryEnd: 80, chargeEnergyAdded: 40 }),
    );

    // Avg Charge Gain: fmtNumber(80 - 20, 1) → "60.0%".
    expect(screen.getByText('60.0%')).toBeInTheDocument();
    // Charge Sessions: fmtInt(12) → "12".
    expect(screen.getByText('12')).toBeInTheDocument();
    // Est. Range Added: fmtNumber(40 * 5.5, 0) km → "220 km".
    expect(screen.getByText('220 km')).toBeInTheDocument();

    // Every stat/pill label is present exactly once.
    expect(screen.getByText('Avg Charge Gain')).toBeInTheDocument();
    expect(screen.getByText('Charge Sessions')).toBeInTheDocument();
    expect(screen.getByText('Est. Range Added')).toBeInTheDocument();
  });

  it('does not render the loading / error / empty bodies when data is present', () => {
    const { container } = renderSection(
      makeMetrics({ chargingSessionCount: 3, batteryStart: 50, batteryEnd: 70, chargeEnergyAdded: 10 }),
    );

    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText('Server error')).toBeNull();
    expect(
      screen.queryByText('No battery data is available for this week.'),
    ).toBeNull();
  });
});

describe('BatteryHealthSection — computation & rounding', () => {
  it('rounds each pill independently but computes the gain from the RAW (unrounded) values', () => {
    // start 54.6 → pill 55%, end 90.4 → pill 90%; gain uses raw 90.4 − 54.6.
    renderSection(
      makeMetrics({ chargingSessionCount: 4, batteryStart: 54.6, batteryEnd: 90.4, chargeEnergyAdded: 0 }),
    );

    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    // fmtNumber(90.4 - 54.6, 1) === "35.8%", NOT the rounded 90 − 55 = 35.
    expect(screen.getByText('35.8%')).toBeInTheDocument();
  });

  it('scales estimated range linearly with charge energy (× 5.5 km per unit)', () => {
    renderSection(
      makeMetrics({ chargingSessionCount: 1, batteryStart: 10, batteryEnd: 20, chargeEnergyAdded: 100 }),
    );
    // 100 × 5.5 = 550, rounded to 0 dp.
    expect(screen.getByText('550 km')).toBeInTheDocument();
  });

  it('groups a large session count through fmtInt (locale thousands separator)', () => {
    renderSection(makeMetrics({ chargingSessionCount: 1234, batteryStart: 30, batteryEnd: 60 }));
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });
});

describe('BatteryHealthSection — loading', () => {
  it('shows a skeleton and no populated content while loading, but keeps the title mounted', () => {
    const { container } = renderSection(
      makeMetrics({ chargingSessionCount: 12, batteryStart: 20, batteryEnd: 80 }),
      { isLoading: true },
    );

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(title()).toBeInTheDocument();
    // No pill / stat values leak through the skeleton.
    expect(screen.queryByText('20%')).toBeNull();
    expect(screen.queryByText('Avg Charge Gain')).toBeNull();
  });

  it('gives loading precedence over an error (skeleton wins, no QueryError)', () => {
    const { container } = renderSection(makeMetrics({ chargingSessionCount: 12 }), {
      isLoading: true,
      isError: true,
      error: new ApiError('boom', 500),
    });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Server error')).toBeNull();
  });
});

describe('BatteryHealthSection — error + retry', () => {
  it('surfaces a retryable 5xx error and wires the Retry button to onRetry', () => {
    const onRetry = vi.fn();
    renderSection(makeMetrics({ chargingSessionCount: 12, batteryStart: 20, batteryEnd: 80 }), {
      isError: true,
      error: new ApiError('charging feed exploded', 500),
      onRetry,
    });

    // QueryError branches on ApiError.status → the 5xx "Server error" copy.
    expect(screen.getByText('Server error')).toBeInTheDocument();
    // The populated body is replaced, never rendered alongside the error.
    expect(screen.queryByText('Avg Charge Gain')).toBeNull();

    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the panel title mounted through the error branch (never a blank panel)', () => {
    renderSection(makeMetrics({ chargingSessionCount: 12 }), {
      isError: true,
      error: new ApiError('down', 503),
    });
    expect(title()).toBeInTheDocument();
  });
});

describe('BatteryHealthSection — empty state', () => {
  it('renders the empty placeholder (with status role) when there are no charge sessions', () => {
    renderSection(makeMetrics({ chargingSessionCount: 0, batteryStart: 40, batteryEnd: 60 }));

    const empty = screen.getByRole('status');
    expect(
      within(empty).getByText('No battery data is available for this week.'),
    ).toBeInTheDocument();

    // Title stays; the pills/stats that would otherwise render are absent.
    expect(title()).toBeInTheDocument();
    expect(screen.queryByText('Avg Battery at Charge Start')).toBeNull();
    expect(screen.queryByText('Est. Range Added')).toBeNull();
  });

  it('treats a nullish session count as empty via the `?? 0` guard', () => {
    const sparse = makeMetrics();
    // Force the field undefined to exercise `(metrics.chargingSessionCount ?? 0) > 0`.
    (sparse as { chargingSessionCount?: number }).chargingSessionCount = undefined;

    renderSection(sparse);

    expect(
      screen.getByText('No battery data is available for this week.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Avg Charge Gain')).toBeNull();
  });
});

describe('BatteryHealthSection — null safety', () => {
  it('renders zeroed pills/stats without crashing when the numeric fields are undefined', () => {
    // hasData is true (5 sessions) but every value the body reads is nullish.
    const sparse = makeMetrics({ chargingSessionCount: 5 });
    const holes = sparse as Record<string, unknown>;
    holes.batteryStart = undefined;
    holes.batteryEnd = undefined;
    holes.chargeEnergyAdded = undefined;

    renderSection(sparse);

    // Both pills collapse to "0%" (Math.round(0)), so there are two of them.
    expect(screen.getAllByText('0%')).toHaveLength(2);
    // Gain fmtNumber(0 - 0, 1) → "0.0%"; range fmtNumber(0 * 5.5, 0) → "0 km".
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText('0 km')).toBeInTheDocument();
    // Session count still renders from the present field.
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
