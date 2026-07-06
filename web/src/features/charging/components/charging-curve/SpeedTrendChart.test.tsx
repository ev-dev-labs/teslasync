/**
 * SpeedTrendChart — monthly DC-vs-AC charge-rate trend contract.
 *
 * The chart is a Recharts `<LineChart>` inside a `<ResponsiveContainer>`, which
 * gets a 0×0 box in jsdom and never paints its inner SVG. So — like the sibling
 * CostByVehicleChart / ChartContainer.a11y suites — these tests assert against
 * the always-present pieces the component owns:
 *   - the ChartContainer shell (labelled heading, subtitle, `role="img"` region),
 *   - the visually-hidden accessible fallback `<table>` that ChartContainer
 *     renders from the `data`/`dataColumns` props (this is where the whole
 *     aggregation is observable: month bucketing, ascending sort, W→kW
 *     conversion, DC/AC classification, averaging + 0.1 rounding, and the
 *     zero-fill for a month that has no sessions of one kind),
 *   - the empty branch (the hardening: `sessions` null / undefined / [] must show
 *     an EmptyState, never a blank panel — and never throw on `.length`), and
 *   - the legend, whose swatches must follow the active `useChartPalette()` colour
 *     (the bug fix: they were hardcoded neon `bg-[#00f0ff]` / `bg-emerald-500`
 *     while the Lines used `palette[0]`/`palette[1]`, so the legend lied for the
 *     default colour-blind-safe palette).
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` returns the English default.
 * `useChartPalette` is pinned to a known rgb palette so the legend-colour
 * assertions are exact. `useChartExport` + `useAnnotations` (reached through the
 * real ChartContainer) are stubbed to no-ops so nothing touches html2canvas or
 * the network.
 */
import { type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { PALETTE } = vi.hoisted(() => ({
  // rgb() strings so `element.style.backgroundColor` round-trips verbatim in
  // jsdom (a hex would be normalised and make the assertion brittle).
  PALETTE: ['rgb(0, 114, 178)', 'rgb(230, 159, 0)', 'rgb(0, 158, 115)'],
}));

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => PALETTE,
}));

// The real ChartContainer reaches for these; keep them off the network / canvas.
vi.mock('@/hooks/useChartExport', () => ({
  useChartExport: () => ({
    chartRef: { current: null },
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    copyToClipboard: vi.fn(async () => 'copied' as const),
    exporting: false,
  }),
}));

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotationsAsData: () => ({ annotations: [], isLoading: false }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}));

import SpeedTrendChart from './SpeedTrendChart';
import type { ChargingSession } from '@/api/types';

function makeSession(overrides: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2026-01-10T10:00:00Z',
    ended_at: '2026-01-10T11:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: 1_000_000,
    end_odometer_m: 1_050_000,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 42_500,
    peak_power_w: 150_000,
    avg_power_w: 90_000,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: '2026-01-10T10:00:00Z',
    duration_min: 60,
    ...overrides,
  };
}

function renderChart(sessions: ChargingSession[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SpeedTrendChart sessions={sessions} />
    </QueryClientProvider>,
  );
}

const ARIA_LABEL = 'Monthly average DC and AC charging speed line chart';

/** Read the visually-hidden fallback table as an array of data-row cell arrays. */
function readTableRows(): string[][] {
  const table = screen.getByRole('table');
  const rows = within(table).getAllByRole('row');
  // rows[0] is the <thead> header row; the rest are data rows.
  return rows
    .slice(1)
    .map((r) => within(r).getAllByRole('cell').map((c) => c.textContent ?? ''));
}

describe('SpeedTrendChart — panel shell + a11y', () => {
  it('renders the ChartContainer figure with its title, subtitle and img region', () => {
    renderChart([makeSession()]);

    const figure = screen.getByRole('figure', { name: /Charging Speed Trend/ });
    expect(figure.tagName).toBe('FIGURE');
    expect(
      screen.getByRole('heading', { name: 'Charging Speed Trend' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Monthly average DC vs AC charge rate'),
    ).toBeInTheDocument();
    expect(
      within(figure).getByRole('img', { name: ARIA_LABEL }),
    ).toBeInTheDocument();
  });
});

describe('SpeedTrendChart — monthly aggregation (via accessible fallback table)', () => {
  it('buckets by month, sorts ascending, classifies DC vs AC and converts W→kW', () => {
    // Deliberately out of chronological order to prove the ascending sort.
    const sessions = [
      // March: one high-peak session with no charger_type → DC by the 20 kW rule.
      makeSession({ started_at: '2026-03-15T09:00:00Z', charger_type: null, peak_power_w: 100_000 }),
      // January: two DC sessions (Tesla + CCS) → avg (150 + 120) / 2 = 135 kW.
      makeSession({ started_at: '2026-01-10T10:00:00Z', charger_type: 'Tesla', peak_power_w: 150_000 }),
      makeSession({ started_at: '2026-01-20T10:00:00Z', charger_type: 'CCS', peak_power_w: 120_000 }),
      // January: one AC session (null charger, 7 kW < 20 kW threshold) → avg 7 kW.
      makeSession({ started_at: '2026-01-25T10:00:00Z', charger_type: null, peak_power_w: 7_000 }),
    ];

    renderChart(sessions);

    // Column headers come straight from `dataColumns`.
    const table = screen.getByRole('table');
    expect(
      within(table).getAllByRole('columnheader').map((h) => h.textContent),
    ).toEqual(['Month', 'DC Avg kW', 'AC Avg kW']);

    const rows = readTableRows();
    // Two month buckets, January before March.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(['2026-01', '135', '7']);
    // March has no AC session → the AC average zero-fills rather than dropping the row.
    expect(rows[1]).toEqual(['2026-03', '100', '0']);
  });

  it('averages within a month and rounds the kW to one decimal place', () => {
    const sessions = [
      makeSession({ started_at: '2026-02-01T10:00:00Z', charger_type: 'Tesla', peak_power_w: 150_000 }),
      makeSession({ started_at: '2026-02-02T10:00:00Z', charger_type: 'Tesla', peak_power_w: 145_000 }),
    ];

    renderChart(sessions);

    // (150 + 145) / 2 = 147.5 kW, printed with the single-decimal rounding.
    const rows = readTableRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(['2026-02', '147.5', '0']);
  });

  it('coerces a null peak_power_w to 0 kW instead of crashing (null safety)', () => {
    const sessions = [
      // DC by charger_type, but peak power is unknown → contributes 0 kW.
      makeSession({ started_at: '2026-04-01T10:00:00Z', charger_type: 'Tesla', peak_power_w: null }),
    ];

    renderChart(sessions);

    const rows = readTableRows();
    expect(rows[0]).toEqual(['2026-04', '0', '0']);
  });
});

describe('SpeedTrendChart — empty / null-safety', () => {
  it('shows an EmptyState (never a blank panel) for an empty session list', () => {
    renderChart([]);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();
    // The empty branch renders no fallback data table and no legend.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('DC Fast')).toBeNull();
  });

  it('treats an undefined sessions prop as empty without throwing on .length', () => {
    renderChart(undefined as unknown as ChargingSession[]);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('SpeedTrendChart — legend follows the active chart palette', () => {
  it('paints each legend swatch with the palette colour, not a hardcoded neon value', () => {
    renderChart([makeSession()]);

    const dcLabel = screen.getByText('DC Fast');
    const acLabel = screen.getByText('AC / Home');
    expect(dcLabel).toBeInTheDocument();
    expect(acLabel).toBeInTheDocument();

    // The decorative swatch is the element immediately preceding each label.
    const dcSwatch = dcLabel.previousElementSibling as HTMLElement;
    const acSwatch = acLabel.previousElementSibling as HTMLElement;

    expect(dcSwatch.tagName).toBe('SPAN');
    // Decorative — hidden from assistive tech because the text label carries the meaning.
    expect(dcSwatch.getAttribute('aria-hidden')).toBe('true');
    expect(acSwatch.getAttribute('aria-hidden')).toBe('true');

    // The swatch colour matches the series colour (palette[0]/palette[1]).
    expect(dcSwatch.style.backgroundColor).toBe(PALETTE[0]);
    expect(acSwatch.style.backgroundColor).toBe(PALETTE[1]);
    // And crucially it is NOT the old hardcoded neon cyan the legend used to show.
    expect(dcSwatch.style.backgroundColor).not.toBe('rgb(0, 240, 255)');
  });
});
