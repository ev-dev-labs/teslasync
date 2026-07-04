/**
 * AnomalyDashboardPage contract + hardening tests.
 *
 * AnomalyDashboardPage is the vehicle-scoped anomaly-detection dashboard. It
 * reads the active vehicle from `useSelectedVehicle`, threads it into
 * `useAnomalies(id)`, and fans the single query result out into four surfaces:
 *   1. a KPI band (signals monitored + 7d/24h anomaly counts + health-category
 *      count) that ALWAYS renders — even with no vehicle or on error — so a
 *      panel never blanks;
 *   2. two opt-in AI narration cards (threaded the numeric vehicle id, or
 *      `undefined` when no vehicle is selected);
 *   3. an "overview bento" with a most-frequent-signal bar chart (top-10,
 *      sorted by descending count) + a system-health side panel; and
 *   4. a full-width anomaly timeline.
 *
 * Every data surface owns its own loading / error / empty branch, and the empty
 * copy is context-sensitive (a "select a vehicle" prompt when nothing is scoped
 * vs. a "nothing detected yet" prompt when a vehicle is scoped but has no data).
 *
 * The real `useAnomalies` hook runs against a real QueryClient with the network
 * seam (`@/api/client` `request`) mocked, so the SI endpoint contract
 * (snake_case `vehicle_id`, no `/api/v1` double-prefix, `days` window) is
 * exercised end-to-end. `useSelectedVehicle` is mocked to pin the active
 * vehicle deterministically. The bar chart is mocked with a data-capturing stub
 * (recharts renders nothing meaningful in jsdom) so the top-10/sort derive can
 * be asserted precisely; the timeline/health cards and the two AI surfaces are
 * mocked with prop-capturing stubs so the page's OWN data-threading is under
 * test rather than child internals.
 *
 * Nothing touches the real network.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: return the fallback string, interpolating {{var}} tokens from the
// options object so assertions can target the rendered English copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Network seam — the real useAnomalies hook resolves through this.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Vehicle scope — pinned per test so no vehicles query fires.
vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// Charts — capture the frequency data the page derives; keep every other export
// (CHART_COLORS, ChartTooltip, axes) real. ResponsiveContainer is stubbed to a
// passthrough because recharts refuses to render children at 0×0 in jsdom, and
// BarChart drops its axis children so no recharts code runs.
vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    BarChart: ({ data }: { data: Array<{ signal: string; count: number }> }) => (
      <div data-testid="freq-bar-chart" data-rows={data.length}>
        {data.map((d) => (
          <span key={d.signal} data-testid="freq-row" data-signal={d.signal} data-count={d.count} />
        ))}
      </div>
    ),
  };
});

// Timeline + health cards — prop-capturing stubs echo the threaded row so the
// page's mapping (one card per anomaly / per health category) is assertable.
vi.mock('../components/anomaly-dashboard', () => ({
  AnomalyTimelineCard: ({ anomaly }: { anomaly: { signal: string; severity: string; message: string } }) => (
    <li data-testid="anomaly-card">{`${anomaly.signal}|${anomaly.severity}|${anomaly.message}`}</li>
  ),
  SystemHealthCard: ({ category, status }: { category: string; status: string }) => (
    <li data-testid="health-card">{`${category}:${status}`}</li>
  ),
}));

// AI surfaces — capture the vehicleId the page threads (numeric id, or the
// string 'undefined' when no vehicle is selected).
vi.mock('@/components/ai/AIAnomalyExplanations', () => ({
  AIAnomalyExplanations: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-explanations" data-vehicle-id={String(vehicleId)} />
  ),
}));
vi.mock('@/components/ai/AILearnedAnomalyBaselines', () => ({
  AILearnedAnomalyBaselines: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-baselines" data-vehicle-id={String(vehicleId)} />
  ),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
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

import { request } from '@/api/client';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import type { AnomalyData, AnomalyEntry } from '@/api/hooks/useAnomalies';
import type { Vehicle } from '@/types/vehicle';
import AnomalyDashboardPage from './AnomalyDashboardPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

/** Pin the active vehicle (and fleet, for the header picker). */
function selectVehicle(vehicleId: number | null, vehicles: Array<Partial<Vehicle>> = []) {
  mockSelectedVehicle.mockReturnValue({
    vehicleId,
    vehicle: null,
    vehicles: vehicles as unknown as Vehicle[],
    setVehicleId: vi.fn(),
  });
}

function makeAnomaly(over: Partial<AnomalyEntry> = {}): AnomalyEntry {
  return {
    signal: 'battery_voltage',
    type: 'z_score',
    severity: 'info',
    value: 400,
    baseline: 398,
    z_score: 2.1,
    detected_at: '2025-03-05T10:00:00Z',
    message: 'default anomaly',
    ...over,
  };
}

function makeData(over: Partial<AnomalyData> = {}): AnomalyData {
  return {
    anomalies: [
      makeAnomaly({ signal: 'brake_fluid', severity: 'critical', message: 'Brake anomaly A' }),
      makeAnomaly({ signal: 'brake_fluid', severity: 'warning', message: 'Brake anomaly B' }),
      makeAnomaly({ signal: 'battery_voltage', severity: 'info', message: 'Battery drift' }),
    ],
    health_summary: { battery: 'critical', tires: 'normal', motors: 'warning' },
    signals_monitored: 42,
    anomalies_last_7d: 5,
    anomalies_last_24h: 2,
    ...over,
  };
}

/** 12 distinct signals with strictly descending frequency (sig1→12 … sig12→1). */
function manySignals(): AnomalyEntry[] {
  const out: AnomalyEntry[] = [];
  for (let i = 1; i <= 12; i++) {
    const count = 13 - i;
    for (let j = 0; j < count; j++) out.push(makeAnomaly({ signal: `sig${i}` }));
  }
  return out;
}

function anomaliesPaths(): string[] {
  return mockedRequest.mock.calls
    .map((c) => c[0] as string)
    .filter((p) => typeof p === 'string' && p.startsWith('/analytics/anomalies'));
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AnomalyDashboardPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockSelectedVehicle.mockReset();
  // Default: a single-vehicle fleet with vehicle 7 selected. No-vehicle tests
  // override this.
  selectVehicle(7, [{ id: 7, display_name: 'Model 3', vin: 'VIN7' }]);
});

describe('AnomalyDashboardPage', () => {
  it('renders the shell — heading, subtitle, three labelled regions, and the page title — and issues no request when no vehicle is scoped', () => {
    selectVehicle(null, []);

    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Anomaly Detection' })).toBeInTheDocument();
    expect(
      screen.getByText('Automatic health monitoring and signal anomaly detection'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'AI insights' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Anomaly overview' })).toBeInTheDocument();
    expect(document.title).toContain('Anomaly Detection');
    // useAnomalies(null) is disabled — the network seam is never touched.
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('with no vehicle: every data section shows the "select a vehicle" prompt, no chart/cards render, and the AI surfaces receive an undefined vehicle id', () => {
    selectVehicle(null, []);

    renderPage();

    // Frequency, health, and timeline each surface the same scoped prompt.
    expect(
      screen.getAllByText('Select a vehicle to view its anomaly analysis.'),
    ).toHaveLength(3);
    expect(screen.queryByTestId('freq-bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('anomaly-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('health-card')).not.toBeInTheDocument();

    // KPI band never blanks — it renders its labels even with nothing scoped.
    const kpi = screen.getByRole('region', { name: 'Summary metrics' });
    expect(within(kpi).getByText('Signals Monitored')).toBeInTheDocument();

    // `selectedId ?? undefined` is threaded to both AI cards.
    expect(screen.getByTestId('ai-explanations')).toHaveAttribute('data-vehicle-id', 'undefined');
    expect(screen.getByTestId('ai-baselines')).toHaveAttribute('data-vehicle-id', 'undefined');
  });

  it('with a vehicle + a pending query: shows the stat-grid skeleton, no empty/chart content, and fires the request', async () => {
    mockedRequest.mockImplementation(() => new Promise(() => {})); // never resolves

    renderPage();

    expect(screen.getByTestId('stat-grid-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('freq-bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('anomaly-card')).not.toBeInTheDocument();
    // No empty state leaks in while loading.
    expect(
      screen.queryByText('No anomalies detected — all systems normal.'),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(mockedRequest).toHaveBeenCalled());
  });

  it('with resolved data: threads KPI counts, the frequency chart, the health + timeline cards, and the numeric vehicle id to the AI surfaces', async () => {
    mockedRequest.mockImplementation(() => Promise.resolve(makeData()));

    renderPage();

    // KPI band — scoped to the region so the numbers can't collide with the
    // header freshness chip.
    const kpi = screen.getByRole('region', { name: 'Summary metrics' });
    expect(await within(kpi).findByText('42')).toBeInTheDocument(); // signals_monitored
    expect(within(kpi).getByText('Signals Monitored')).toBeInTheDocument();
    expect(within(kpi).getByText('5')).toBeInTheDocument(); // anomalies_last_7d
    expect(within(kpi).getByText('3')).toBeInTheDocument(); // 3 health categories

    // Frequency chart — 3 anomalies over 2 distinct signals => brake_fluid(2) first.
    expect(
      screen.getByRole('img', { name: 'Bar chart of the most frequently anomalous signals' }),
    ).toBeInTheDocument();
    const bar = screen.getByTestId('freq-bar-chart');
    expect(bar).toHaveAttribute('data-rows', '2');
    const rows = within(bar).getAllByTestId('freq-row');
    expect(rows[0]).toHaveAttribute('data-signal', 'brake_fluid');
    expect(rows[0]).toHaveAttribute('data-count', '2');

    // System health — one row per category.
    expect(screen.getAllByTestId('health-card')).toHaveLength(3);
    expect(screen.getByText('battery:critical')).toBeInTheDocument();
    expect(screen.getByText('motors:warning')).toBeInTheDocument();

    // Timeline — one card per anomaly, with the threaded row echoed back.
    expect(screen.getAllByTestId('anomaly-card')).toHaveLength(3);
    expect(screen.getByText('brake_fluid|critical|Brake anomaly A')).toBeInTheDocument();
    expect(screen.getByText('battery_voltage|info|Battery drift')).toBeInTheDocument();

    // AI cards receive the numeric id.
    expect(screen.getByTestId('ai-explanations')).toHaveAttribute('data-vehicle-id', '7');
    expect(screen.getByTestId('ai-baselines')).toHaveAttribute('data-vehicle-id', '7');
  });

  it('derives the frequency chart as the top-10 signals sorted by descending count', async () => {
    mockedRequest.mockImplementation(() =>
      Promise.resolve(makeData({ anomalies: manySignals(), health_summary: {} })),
    );

    renderPage();

    const bar = await screen.findByTestId('freq-bar-chart');
    expect(bar).toHaveAttribute('data-rows', '10'); // sliced to the top 10 of 12

    const rows = within(bar).getAllByTestId('freq-row');
    expect(rows).toHaveLength(10);

    const counts = rows.map((r) => Number(r.getAttribute('data-count')));
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThan(counts[i - 1]); // strictly descending
    }
    expect(rows[0]).toHaveAttribute('data-signal', 'sig1');
    expect(rows[0]).toHaveAttribute('data-count', '12');

    // The two least-frequent signals are dropped by the top-10 slice.
    const signals = rows.map((r) => r.getAttribute('data-signal'));
    expect(signals).not.toContain('sig11');
    expect(signals).not.toContain('sig12');
  });

  it('with a scoped vehicle but empty results: each section shows its own contextual "nothing yet" copy (not the select-a-vehicle prompt)', async () => {
    mockedRequest.mockImplementation(() =>
      Promise.resolve(
        makeData({
          anomalies: [],
          health_summary: {},
          signals_monitored: 0,
          anomalies_last_7d: 0,
          anomalies_last_24h: 0,
        }),
      ),
    );

    renderPage();

    expect(
      await screen.findByText('Anomaly frequency data will appear after detection runs.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Health data will appear once telemetry is available.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No anomalies detected — all systems normal.'),
    ).toBeInTheDocument();

    expect(screen.queryByTestId('freq-bar-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('anomaly-card')).not.toBeInTheDocument();
    // A scoped-but-empty vehicle must NOT reuse the no-vehicle prompt.
    expect(
      screen.queryByText('Select a vehicle to view its anomaly analysis.'),
    ).not.toBeInTheDocument();
  });

  it('on query failure: shows a retryable error in all three data sections, keeps the KPI band, and refetches when Retry is clicked', async () => {
    mockedRequest.mockRejectedValue(new Error('anomalies upstream down'));

    renderPage();

    // Every data section renders the network-error panel.
    const errors = await screen.findAllByText("Can't reach server");
    expect(errors).toHaveLength(3);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(3);

    // KPI band still present — the page never blanks on error.
    expect(screen.getByRole('region', { name: 'Summary metrics' })).toBeInTheDocument();

    // Single fetch so far (retry disabled); the shared handleRetry re-fetches.
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    fireEvent.click(retries[0]);
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
  });

  it('requests the SI anomalies endpoint with a snake_case vehicle_id, no /api/v1 prefix, and a days window', async () => {
    mockedRequest.mockImplementation(() => Promise.resolve(makeData()));

    renderPage();

    await waitFor(() => expect(anomaliesPaths().length).toBeGreaterThan(0));
    const path = anomaliesPaths()[0];
    expect(path.startsWith('/analytics/anomalies')).toBe(true);
    expect(path).toContain('vehicle_id=7'); // snake_case
    expect(path).toContain('days=7');
    expect(path).not.toContain('/api/v1'); // request() adds the prefix itself
    expect(path).not.toContain('vehicleId='); // never camelCase
  });

  it('is accessible: labelled landmark regions, a named vehicle picker, and a described chart region', async () => {
    mockedRequest.mockImplementation(() => Promise.resolve(makeData()));

    renderPage();

    expect(screen.getByRole('region', { name: 'Summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'AI insights' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Anomaly overview' })).toBeInTheDocument();
    // Header picker exposes an accessible name (fleet has ≥1 vehicle).
    expect(screen.getByLabelText('Select vehicle')).toBeInTheDocument();
    // The bar chart is announced as a described image, not raw SVG.
    expect(
      await screen.findByRole('img', { name: 'Bar chart of the most frequently anomalous signals' }),
    ).toBeInTheDocument();
  });
});
