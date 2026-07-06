/**
 * YearChargingBreakdown — behaviour, branch, a11y + null-safety coverage.
 *
 * The component is a pure presentational leaf: it takes a fully-loaded
 * `YearReview` and renders a donut of the connector-type split
 * (Supercharger / DC Fast / AC-Other) inside a shared <ChartContainer>,
 * plus a colour-swatch legend. Its interesting behaviour lives entirely in
 * the `slices` derivation:
 *
 *   - connectors with a zero (or nullish) share are filtered OUT;
 *   - each surviving connector keeps a STABLE colour regardless of which
 *     other connectors are present (the regression these tests pin);
 *   - when nothing has a positive share the container shows its empty state
 *     and the legend/chart body are not rendered;
 *   - the subtitle interpolates a locale-formatted session count and a
 *     rounded average start-SOC, both null-safe.
 *
 * Strategy: no network is touched — the component takes its data as a prop.
 * <ChartContainer> transitively pulls in react-query (annotation hooks) and
 * react-router (<EmptyState>'s <Link>), so the tree is wrapped in
 * QueryClientProvider + MemoryRouter. Only `react-i18next` is mocked so
 * `t(key, fallback)` / `t(key, { defaultValue, ...vars })` render the English
 * fallback deterministically (including {{var}} interpolation).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { YearReview } from '@/api/types';

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

// i18n → return the developer fallback string, interpolating {{vars}} so the
// subtitle/labels read as real English instead of raw keys. Handles all three
// call shapes the component + ChartContainer use:
//   t(key, 'fallback'), t(key, 'fallback', { vars }), t(key, { defaultValue, ...vars }).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ChartContainer wires up chart annotations unconditionally (the hooks must be
// called even when `annotations` is unset). We never pass `annotations`, so the
// results are unused — stub the hooks to no-ops so the tree doesn't demand a
// ToastProvider / live query, mirroring the shared ChartContainer test.
vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [] }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

import { YearChargingBreakdown } from './YearChargingBreakdown';

// A full, zeroed YearReview so each test overrides only the fields it cares
// about — the component only reads the four charging fields + the two
// summary fields, but the prop type demands the whole shape.
function makeReview(over: Partial<YearReview> = {}): YearReview {
  return {
    year: 2024,
    vehicle: { id: 1, display_name: 'Model 3', model: 'model3' },
    total_drives: 0,
    total_distance_km: 0,
    total_energy_kwh: 0,
    total_charge_sessions: 0,
    total_driving_minutes: 0,
    total_charging_cost: 0,
    gas_savings: 0,
    co2_offset_kg: 0,
    longest_drive: null,
    shortest_drive: null,
    most_efficient_drive: null,
    least_efficient_drive: null,
    fastest_speed_kmh: 0,
    coldest_drive_temp_c: 0,
    hottest_drive_temp_c: 0,
    monthly_stats: [],
    most_active_day_of_week: '',
    most_active_hour: 0,
    avg_drives_per_week: 0,
    avg_distance_per_drive_km: 0,
    avg_efficiency_wh_km: 0,
    supercharger_pct: 0,
    dc_fast_pct: 0,
    ac_other_pct: 0,
    avg_charge_start_soc: 0,
    comparisons: [],
    ...over,
  };
}

function renderBreakdown(data: YearReview) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YearChargingBreakdown data={data} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function legendItems(): HTMLElement[] {
  return within(screen.getByRole('list')).queryAllByRole('listitem');
}

function swatchColorFor(name: string): string {
  const li = legendItems().find((el) => (el.textContent ?? '').includes(name));
  if (!li) throw new Error(`no legend item for "${name}"`);
  const swatch = li.querySelector('[aria-hidden="true"]');
  if (!(swatch instanceof HTMLElement)) throw new Error(`no colour swatch for "${name}"`);
  return swatch.style.backgroundColor;
}

describe('YearChargingBreakdown — populated', () => {
  it('renders the title, interpolated summary subtitle, and one legend row per connector', () => {
    renderBreakdown(
      makeReview({
        supercharger_pct: 50,
        dc_fast_pct: 30,
        ac_other_pct: 20,
        total_charge_sessions: 1284,
        avg_charge_start_soc: 42.4,
      }),
    );

    // Title is the ChartContainer heading (h3).
    expect(screen.getByRole('heading', { level: 3, name: 'Charging mix' })).toBeInTheDocument();

    // Subtitle: fmtInt groups the session count and the SOC is rounded.
    expect(
      screen.getByText('1,284 sessions · avg plug-in at 42%'),
    ).toBeInTheDocument();

    // Exactly three legend rows, labelled + percentage-suffixed, scoped to the
    // legend list (the same labels also appear in the a11y fallback table).
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Supercharger')).toBeInTheDocument();
    expect(within(list).getByText('DC Fast')).toBeInTheDocument();
    expect(within(list).getByText('AC / Other')).toBeInTheDocument();
    expect(within(list).getByText('50%')).toBeInTheDocument();
    expect(within(list).getByText('30%')).toBeInTheDocument();
    expect(within(list).getByText('20%')).toBeInTheDocument();
  });

  it('exposes the chart body under the donut aria-label', () => {
    renderBreakdown(makeReview({ supercharger_pct: 60, dc_fast_pct: 40 }));
    expect(
      screen.getByRole('img', { name: 'Donut chart of charging mix by connector type' }),
    ).toBeInTheDocument();
  });

  it('renders the screen-reader fallback table with connector + share columns', () => {
    renderBreakdown(makeReview({ supercharger_pct: 70, dc_fast_pct: 30 }));

    // ChartContainer builds a visually-hidden <table> from data + dataColumns.
    expect(screen.getByText('Charging mix — data table')).toBeInTheDocument();
    expect(screen.getByText('Connector')).toBeInTheDocument();
    expect(screen.getByText('Share (%)')).toBeInTheDocument();

    // The connector label appears in BOTH the legend and the fallback table.
    expect(screen.getAllByText('Supercharger')).toHaveLength(2);
  });
});

describe('YearChargingBreakdown — slice filtering + colour stability', () => {
  it('drops connectors with zero share', () => {
    renderBreakdown(makeReview({ supercharger_pct: 0, dc_fast_pct: 60, ac_other_pct: 40 }));

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).queryByText('Supercharger')).toBeNull();
    expect(within(list).getByText('DC Fast')).toBeInTheDocument();
    expect(within(list).getByText('AC / Other')).toBeInTheDocument();
  });

  it('keeps each connector on a stable colour when a slice is filtered out (regression)', () => {
    // Full split: three distinct swatch colours.
    const full = renderBreakdown(makeReview({ supercharger_pct: 50, dc_fast_pct: 30, ac_other_pct: 20 }));
    const fullColours = legendItems().map((li) => {
      const swatch = li.querySelector('[aria-hidden="true"]') as HTMLElement;
      return swatch.style.backgroundColor;
    });
    expect(new Set(fullColours).size).toBe(3);
    const dcColourWhenFull = swatchColorFor('DC Fast');
    full.unmount();

    // Drop the Supercharger slice: DC Fast must NOT inherit Supercharger's
    // colour — it keeps the exact same swatch it had in the full split.
    renderBreakdown(makeReview({ supercharger_pct: 0, dc_fast_pct: 60, ac_other_pct: 40 }));
    expect(legendItems()).toHaveLength(2);
    expect(swatchColorFor('DC Fast')).toBe(dcColourWhenFull);
  });
});

describe('YearChargingBreakdown — empty state', () => {
  it('shows the empty placeholder and no legend/chart body when every share is zero', () => {
    renderBreakdown(makeReview()); // all connector percentages default to 0

    // Container renders its empty state instead of the donut + legend.
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('Supercharger')).toBeNull();

    // The title + accessible chart frame stay mounted (never a blank panel).
    expect(screen.getByRole('heading', { level: 3, name: 'Charging mix' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Donut chart of charging mix by connector type' }),
    ).toBeInTheDocument();
  });
});

describe('YearChargingBreakdown — null safety + rounding', () => {
  it('treats missing percentages and totals as zero without crashing', () => {
    const sparse = {
      ...makeReview({ dc_fast_pct: 100 }),
      supercharger_pct: undefined,
      ac_other_pct: undefined,
      total_charge_sessions: undefined,
      avg_charge_start_soc: undefined,
    } as unknown as YearReview;

    renderBreakdown(sparse);

    // Nullish shares collapse to 0 and are filtered out → a single slice.
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('DC Fast')).toBeInTheDocument();
    expect(within(list).getByText('100%')).toBeInTheDocument();

    // Nullish summary fields render as a clean "0 sessions ... 0%".
    expect(screen.getByText('0 sessions · avg plug-in at 0%')).toBeInTheDocument();
  });

  it('rounds fractional connector shares in the legend', () => {
    renderBreakdown(makeReview({ supercharger_pct: 33.4, dc_fast_pct: 66.6, ac_other_pct: 0 }));

    const list = screen.getByRole('list');
    expect(within(list).getByText('33%')).toBeInTheDocument();
    expect(within(list).getByText('67%')).toBeInTheDocument();
    expect(within(list).queryByText('AC / Other')).toBeNull();
  });
});
