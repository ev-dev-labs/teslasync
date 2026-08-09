/**
 * SummaryHeroCards — the Weekly Digest KPI hero band.
 *
 * SummaryHeroCards exports a single prop-driven component. It renders a
 * state-invariant chrome (a labelled `<section>` landmark + an <h2> "Week
 * Summary" title) and, beneath it, one of three mutually-exclusive states with
 * a strict precedence: error > loading > data (the source's `isError ? … :
 * isLoading ? … : …` ternary).
 *
 * The behaviours this suite pins (never a smoke render, never real network):
 *
 *   1. State-invariant chrome — the "Week Summary" heading + its labelled
 *      region render in EVERY state because the header lives outside the state
 *      switch. Only the loading state marks the region `aria-busy` (the a11y
 *      hardening added alongside this suite) so assistive tech announces the
 *      six placeholder tiles as "busy" instead of silent empty panels.
 *   2. State precedence — error pre-empts loading (error wins even mid-retry
 *      when both flags are set), and both pre-empt the populated grid.
 *   3. data → the five always-on KPI cards (distance / drives / energy / cost /
 *      CO₂) each render their i18n label, unit-suffixed value (or currency via
 *      the injected `formatCurrency`) and a directional trend chip. The trend's
 *      sign, colour and glyph come from `trendFor`, including the inverted
 *      semantics for energy + cost (an increase is styled as *bad*).
 *   4. Fun-fact card — the optional sixth tile only mounts when a `funFact`
 *      prop is supplied, and its subtitle interpolates from → to → times.
 *   5. loading → exactly six Skeleton tiles, no KPI labels leak through, no
 *      error affordance, and the region is `aria-busy`.
 *   6. error → a retriable QueryError (role=alert) whose Retry invokes
 *      `onRetry`; no KPI cards render behind it.
 *   7. Null-safety — every optional metric field coalesces to 0 (the `?? 0`
 *      guards) so a sparse metrics object renders zeroed tiles instead of
 *      throwing on `undefined`.
 *
 * Follows the repo convention (see AlertsSection.test.tsx / DrivingTab): the
 * react-i18next `t()` is stubbed to echo the English fallback (and honour
 * {{interpolation}}) so assertions read real copy; `useFormatting` is a thin
 * double so the currency boundary is deterministic; and a MemoryRouter wraps
 * every render because the error branch's <QueryError> reaches for
 * `useNavigate`. Everything else — GlassPanel, HighlightCard, Skeleton,
 * QueryError, the real numberFormat + helpers — renders for real.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { ApiError } from '@/lib/resilience';
import { SummaryHeroCards } from './SummaryHeroCards';
import type { DigestMetrics, FunFact } from './types';

// Echo the English fallback (2nd arg) and honour {{name}} interpolation from
// the options bag (3rd arg) so asserted copy is decoupled from the locale
// bundle. QueryError shares this stub via the same module graph.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return key;
      return opts
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_m: string, name: string) => String(opts[name] ?? ''))
        : fallback;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// SummaryHeroCards only consumes `formatCurrency`; a deterministic double keeps
// the currency boundary independent of the settings context + network.
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals?: number) =>
      `$${(Number.isFinite(amount) ? amount : 0).toFixed(decimals ?? 2)}`,
  }),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const baseMetrics: DigestMetrics = {
  totalDistanceM: 0,
  prevDistanceM: 0,
  totalDrives: 0,
  prevDriveCount: 0,
  energyUsedWh: 0,
  prevEnergyWh: 0,
  chargingCost: 0,
  prevChargingCost: 0,
  co2Saved: 0,
  prevCo2: 0,
  avgEfficiencyWhPerM: 0,
  prevAvgEfficiencyWhPerM: 0,
  totalDurationS: 0,
  topDrive: undefined,
  chargeEnergyAddedWh: 0,
  prevChargeEnergyWh: 0,
  avgChargePowerW: 0,
  chargingSessionCount: 0,
  batteryStart: 0,
  batteryEnd: 0,
  alertsByType: {},
  alertTotal: 0,
};

function makeMetrics(overrides: Partial<DigestMetrics> = {}): DigestMetrics {
  return { ...baseMetrics, ...overrides };
}

/**
 * A populated week with a deliberately distinct trend per card so each
 * direction / colour / glyph is observable:
 *   - distance 100 → 120  = +20.0% up   (good → emerald / TrendingUp)
 *   - drives   10  → 8     = -20.0% down (bad  → rose    / TrendingDown)
 *   - energy   100 → 200   = +100.0% up  but INVERTED   → rose / TrendingDown
 *   - cost     12.5 → 12.5 = flat "0%"   inverted-flat  → emerald / TrendingUp
 *   - CO₂      40  → 42    = +5.0% up    (good → emerald / TrendingUp)
 */
function populatedMetrics(): DigestMetrics {
  return makeMetrics({
    totalDistanceM: 120_000,
    prevDistanceM: 100_000,
    totalDrives: 8,
    prevDriveCount: 10,
    energyUsedWh: 200_000,
    prevEnergyWh: 100_000,
    chargingCost: 12.5,
    prevChargingCost: 12.5,
    co2Saved: 42,
    prevCo2: 40,
  });
}

const funFact: FunFact = { from: 'LA', to: 'San Francisco', times: '1.2' };

type CardsProps = ComponentProps<typeof SummaryHeroCards>;

function renderCards(overrides: Partial<CardsProps> = {}) {
  const props: CardsProps = {
    metrics: populatedMetrics(),
    funFact: undefined,
    isLoading: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <SummaryHeroCards {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

/** The labelled section landmark (accessible name from aria-label). */
const region = () => screen.getByRole('region', { name: 'Week Summary' });

/** Resolve a KPI tile by any text it contains (label or value). */
function cardContaining(text: string | RegExp): HTMLElement {
  const el = screen.getByText(text).closest('[data-print-card]');
  if (!el) throw new Error(`no KPI card contains "${String(text)}"`);
  return el as HTMLElement;
}

// ── 1. State-invariant chrome ────────────────────────────────────────────────

describe('SummaryHeroCards — state-invariant chrome', () => {
  it('renders the "Week Summary" heading + labelled region in every state', () => {
    const cases: Array<Partial<CardsProps>> = [
      { isLoading: true }, // loading
      { isError: true, error: new ApiError('boom', 500) }, // error
      {}, // data
    ];

    for (const override of cases) {
      const { unmount } = renderCards(override);
      expect(region()).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Week Summary' })).toBeInTheDocument();
      unmount();
    }
  });

  it('marks the region aria-busy only while loading', () => {
    const { unmount } = renderCards({ isLoading: true });
    expect(region()).toHaveAttribute('aria-busy', 'true');
    unmount();

    renderCards(); // data branch
    expect(region()).not.toHaveAttribute('aria-busy');
  });
});

// ── 2. State precedence ──────────────────────────────────────────────────────

describe('SummaryHeroCards — state precedence', () => {
  it('prioritises the error branch over loading when both flags are set', () => {
    const { container } = renderCards({
      isLoading: true,
      isError: true,
      error: new ApiError('still broken', 500),
    });

    // Error wins: the retriable alert shows and the skeletons do not.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText('Total Distance')).toBeNull();
  });
});

// ── 3. Populated (data) branch ───────────────────────────────────────────────

describe('SummaryHeroCards — populated KPI grid', () => {
  it('renders the five always-on KPI cards with formatted, unit-suffixed values', () => {
    renderCards();

    expect(within(cardContaining('Total Distance')).getByText('120.0 km')).toBeInTheDocument();
    expect(within(cardContaining('Total Drives')).getByText('8')).toBeInTheDocument();
    expect(within(cardContaining('Energy Used')).getByText('200.0 kWh')).toBeInTheDocument();
    // Currency comes from the injected formatCurrency double (2 decimals).
    expect(within(cardContaining('Charging Cost')).getByText('$12.50')).toBeInTheDocument();
    expect(within(cardContaining(/Saved/)).getByText('42.0 kg')).toBeInTheDocument();
  });

  it('shows a positive (emerald / TrendingUp) trend for an increased distance', () => {
    renderCards();
    const trend = within(cardContaining('Total Distance')).getByText('+20.0%');

    expect(trend.className).toContain('text-emerald-300');
    expect(trend.querySelector('svg')?.getAttribute('class')).toContain('trending-up');
  });

  it('shows a negative (rose / TrendingDown) trend for a decreased drive count', () => {
    renderCards();
    const trend = within(cardContaining('Total Drives')).getByText('-20.0%');

    expect(trend.className).toContain('text-rose-300');
    expect(trend.querySelector('svg')?.getAttribute('class')).toContain('trending-down');
  });

  it('inverts trend polarity for energy — an increase is styled as bad', () => {
    renderCards();
    // The magnitude still reads "+100.0%" (up), but the invertPositive flag
    // flips the semantic to negative → rose colour + TrendingDown glyph.
    const trend = within(cardContaining('Energy Used')).getByText('+100.0%');

    expect(trend.className).toContain('text-rose-300');
    expect(trend.className).not.toContain('text-emerald-300');
    expect(trend.querySelector('svg')?.getAttribute('class')).toContain('trending-down');
  });

  it('renders a flat "0%" trend (positive) when a value is unchanged', () => {
    renderCards();
    const trend = within(cardContaining('Charging Cost')).getByText('0%');

    expect(trend.className).toContain('text-emerald-300');
    expect(trend.querySelector('svg')?.getAttribute('class')).toContain('trending-up');
  });

  it('omits the optional Fun Fact card when no funFact is supplied', () => {
    const { container } = renderCards({ funFact: undefined });

    expect(screen.queryByText('Fun Fact')).toBeNull();
    // Five KPI tiles, no sixth.
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(5);
  });
});

// ── 4. Fun-fact card ─────────────────────────────────────────────────────────

describe('SummaryHeroCards — fun fact card', () => {
  it('mounts a sixth card with an interpolated subtitle when funFact is provided', () => {
    const { container } = renderCards({ funFact });

    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(6);

    const card = cardContaining('Fun Fact');
    // value = `${times}×`, subtitle = "≈ {{times}}× {{from}} → {{to}}" interpolated.
    expect(card.textContent).toContain('1.2');
    expect(card.textContent).toContain('LA');
    expect(card.textContent).toContain('San Francisco');
  });
});

// ── 5. Loading branch ────────────────────────────────────────────────────────

describe('SummaryHeroCards — loading', () => {
  it('renders exactly six skeleton tiles and withholds KPI labels + errors', () => {
    const { container } = renderCards({ isLoading: true });

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6);
    expect(screen.queryByText('Total Distance')).toBeNull();
    expect(screen.queryByText('Energy Used')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ── 6. Error branch ──────────────────────────────────────────────────────────

describe('SummaryHeroCards — error', () => {
  it('surfaces a retriable error and invokes onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    renderCards({ isError: true, error: new ApiError('kaboom', 500), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // No KPI cards render behind the error affordance.
    expect(screen.queryByText('Total Distance')).toBeNull();
  });
});

// ── 7. Null-safety hardening ─────────────────────────────────────────────────

describe('SummaryHeroCards — null-safety hardening', () => {
  it('coalesces undefined metric fields to 0 instead of throwing', () => {
    const sparse = {
      ...baseMetrics,
      totalDistanceM: undefined,
      totalDrives: undefined,
      energyUsedWh: undefined,
      chargingCost: undefined,
      co2Saved: undefined,
      prevDistanceM: undefined,
      prevDriveCount: undefined,
      prevEnergyWh: undefined,
      prevChargingCost: undefined,
      prevCo2: undefined,
    } as unknown as DigestMetrics;

    renderCards({ metrics: sparse });

    expect(within(cardContaining('Total Distance')).getByText('0.0 km')).toBeInTheDocument();
    expect(within(cardContaining('Energy Used')).getByText('0.0 kWh')).toBeInTheDocument();
    // formatCurrency double coalesces a non-finite amount to $0.00.
    expect(within(cardContaining('Charging Cost')).getByText('$0.00')).toBeInTheDocument();
    expect(within(cardContaining(/Saved/)).getByText('0.0 kg')).toBeInTheDocument();
  });
});
