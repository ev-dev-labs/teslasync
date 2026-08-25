/**
 * SignalLogViewerPage — behaviour + hardening coverage.
 *
 * The page owns the Signal Log query cockpit: it reads the selected vehicle
 * (`useSelectedVehicle`) + available signal catalog (`useSignals`), tracks the
 * user-chosen signals (URL `?signals=`) and date range (URL `?from/&to=`), and
 * ONLY fetches when the user clicks "Query" — fanning one `request()` per
 * selected signal through the mocked `@/api/client` seam, then adapting +
 * sorting the batch (newest-first) into the KPI band, chart, breakdown and
 * paginated history table.
 *
 * We drive the page through fully-controlled seams:
 *   - `useSelectedVehicle` — vehicle scope + fleet (so the no-vehicle empty
 *     state and the cockpit branch can each be exercised).
 *   - `useSignals` — available-signal catalog + its error path.
 *   - `@/api/client` `request` — the network boundary (never real network).
 *   - URL query params seed `signals` / `from` / `to` deterministically so we
 *     never wrestle the ComboboxMulti / RangePicker internals.
 *
 * Facets covered: no-vehicle empty state, idle (pre-query) zero/empty states,
 * the Query gate (disabled without signals), the full query flow (request
 * contract — path, snake-ish params, NO `/api/v1` double-prefix, wired abort
 * signal — plus derived KPI counts and newest-first row ordering), signal-name
 * URL-encoding (hardening), per-page → `limit` wiring, the catalog error
 * banner, and local pagination.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { SelectedVehicleResult } from '@/hooks/useSelectedVehicle';
import type { Vehicle } from '@/types/vehicle';
import type { SignalHistoryResp, SignalHistoryPoint } from '@/api/types';

// ── i18n stub: return the fallback string, interpolating {{var}} tokens so
// assertions can target the rendered English copy. Keys without a string
// fallback fall through to the key itself (matches the table's `t('Signal')`
// convention).
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

// framer-motion: render eagerly, strip animation-only props so <FadeIn> shows
// its children synchronously in jsdom.
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              ['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'variants'].includes(k)
            )
              continue;
            safe[k] = v;
          }
          return <div {...safe}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

vi.mock('@/api/hooks/useTelemetry', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useTelemetry')>();
  return { ...actual, useSignals: vi.fn() };
});

vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshnessAuto>) reads it.
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
import { useSignals } from '@/api/hooks/useTelemetry';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { ToastProvider } from '@/components/feedback/Toast';
import SignalLogViewerPage from './SignalLogViewerPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;
const mockSignals = vi.mocked(useSignals);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

// ── Builders ──────────────────────────────────────────────────────────────
function veh(id: number): Vehicle {
  return { id, vehicle_id: id, display_name: `Vehicle ${id}`, vin: `VIN${id}` } as unknown as Vehicle;
}

function makeSelected(vehicleId: number | null, vehicles: Vehicle[]): SelectedVehicleResult {
  return { vehicleId, vehicle: null, vehicles, setVehicleId: vi.fn() };
}

function pt(ts: string, value: SignalHistoryPoint['value']): SignalHistoryPoint {
  return { ts, kind: typeof value === 'number' ? 'ValueKindDouble' : 'ValueKindString', value };
}

function resp(signal: string, data: SignalHistoryPoint[]): SignalHistoryResp {
  return { vehicle_id: 7, signal, count: data.length, data };
}

function signalsResult(over: Record<string, unknown> = {}): any {
  return { data: ['speed', 'soc', 'gear'], error: null, isLoading: false, ...over };
}

// Seed vehicle + signals + a fixed range so `canQuery` depends solely on the
// selected-signal count. `?signals=` and `?from/&to=` fully control the cockpit.
function renderPage(search = '') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/telemetry/signal-log${search}`]}>
        <ToastProvider>
          <SignalLogViewerPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const RANGE = 'from=2026-07-01&to=2026-07-01';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockSelectedVehicle.mockReturnValue(makeSelected(7, [veh(7)]));
  mockSignals.mockReturnValue(signalsResult());
});

describe('SignalLogViewerPage', () => {
  it('shows the pick-a-vehicle empty state (and no query cockpit) when no vehicle is selected', () => {
    mockSelectedVehicle.mockReturnValue(makeSelected(null, []));

    renderPage();

    // Page shell title still renders via usePageTitle + PageContainer heading.
    expect(document.title).toContain('Signal Log Viewer');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Signal Log Viewer');

    // The no-vehicle branch renders the guidance empty state...
    expect(screen.getByText('Select a vehicle to begin')).toBeInTheDocument();
    expect(
      screen.getByText('Pick a vehicle from the picker above to query its signal history.'),
    ).toBeInTheDocument();

    // ...and NOT the query cockpit (no Query button, no KPI band).
    expect(screen.queryByRole('button', { name: 'Query' })).toBeNull();
    expect(screen.queryByText('Total Records')).toBeNull();
    // Empty fleet ⇒ the header VehicleSelect renders nothing.
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
  });

  it('renders the cockpit with a disabled Query gate and honest zero/empty states before any query', () => {
    // No `?signals=` ⇒ zero selected signals ⇒ canQuery is false.
    renderPage(`?${RANGE}`);

    const queryBtn = screen.getByRole('button', { name: 'Query' });
    expect(queryBtn).toBeDisabled();

    // KPI band shows honest zeros (not skeletons — the query is disabled).
    const totalCard = screen.getByText('Total Records').closest('div') as HTMLElement;
    expect(within(totalCard).getByText('0')).toBeInTheDocument();

    // Breakdown + history each own their pre-query empty state (never a blank panel).
    expect(
      screen.getByText('Run a query to see the value-type breakdown.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No signal data matches the selected signals and time range.')).toBeInTheDocument();

    // No fetch was triggered.
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('fetches per selected signal on Query — contract-correct URL, wired abort signal, and newest-first rows', async () => {
    mockedRequest.mockImplementation(async (url: string) => {
      if (url.includes('/speed/history')) {
        return resp('speed', [
          pt('2026-07-01T10:00:00Z', 55),
          pt('2026-07-01T10:01:00Z', 60),
        ]);
      }
      if (url.includes('/soc/history')) {
        return resp('soc', [
          pt('2026-07-01T10:02:00Z', 80),
          pt('2026-07-01T09:59:00Z', 'charging'),
        ]);
      }
      return resp('', []);
    });

    renderPage(`?signals=speed,soc&${RANGE}`);

    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    // One request per selected signal.
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));

    // Request contract: `/signals/{id}/{signal}/history` with snake-ish params,
    // limit = perPage(50) × 10, NO `/api/v1` double-prefix, and the TanStack
    // abort signal threaded through so route changes cancel in-flight fetches.
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringMatching(/^\/signals\/7\/speed\/history\?from=.+&to=.+&limit=500$/),
      expect.objectContaining({ signal: expect.anything() }),
    );
    const urls = mockedRequest.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes('/signals/7/soc/history'))).toBe(true);
    expect(urls.every((u) => !u.includes('/api/v1'))).toBe(true);

    // Results render: the string value only exists in the history table.
    // Wait for 'charging' to appear, then locate the table containing it
    // (avoids ambiguity with ChartContainer's sr-only a11y fallback table).
    await waitFor(() => expect(screen.getByText('charging')).toBeInTheDocument());
    const allTables = screen.getAllByRole('table');
    const table = allTables.find((t) => within(t).queryByText('charging')) ?? allTables[allTables.length - 1];

    // KPI counters: 4 rows total, 3 numeric, 1 text, across 2 signals. Scope to
    // the KPI region — "Signals" also labels the (hidden) cockpit combobox.
    const kpi = screen.getByRole('region', { name: 'Query summary' });
    const totalCard = within(kpi).getByText('Total Records').closest('div') as HTMLElement;
    expect(within(totalCard).getByText('4')).toBeInTheDocument();
    const numericCard = within(kpi).getByText('Numeric Points').closest('div') as HTMLElement;
    expect(within(numericCard).getByText('3')).toBeInTheDocument();
    const textCard = within(kpi).getByText('Text Points').closest('div') as HTMLElement;
    expect(within(textCard).getByText('1')).toBeInTheDocument();
    const signalsCard = within(kpi).getByText('Signals').closest('div') as HTMLElement;
    expect(within(signalsCard).getByText('2 with data')).toBeInTheDocument();

    // Rows are sorted newest-first: soc=80 @10:02 leads, 'charging' @09:59 trails.
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('soc');
    expect(rows[1]).toHaveTextContent('80');
    expect(rows[rows.length - 1]).toHaveTextContent('charging');
  });

  it('URL-encodes the signal-name path segment so exotic names produce a valid request', async () => {
    mockedRequest.mockResolvedValue(resp('Foo Bar', []));

    // `?signals=Foo%20Bar` decodes to the single signal "Foo Bar".
    renderPage(`?signals=Foo%20Bar&${RANGE}`);

    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    const url = mockedRequest.mock.calls[0][0] as string;
    // The space is percent-encoded in the path — never sent raw.
    expect(url).toContain('/signals/7/Foo%20Bar/history');
    expect(url).not.toContain('Foo Bar');
  });

  it('threads the Per Page selection into the fetch limit (perPage × 10) and resets to page 1', async () => {
    mockedRequest.mockResolvedValue(resp('speed', [pt('2026-07-01T10:00:00Z', 12)]));

    renderPage(`?signals=speed&${RANGE}`);

    // Default 50 → limit 500; bump to 100 → limit 1000.
    fireEvent.change(screen.getByLabelText('Per Page'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    expect(mockedRequest.mock.calls[0][0]).toContain('limit=1000');
    expect(mockedRequest.mock.calls[0][0]).not.toContain('limit=500');
  });

  it('surfaces the catalog error in a danger banner without crashing the cockpit', () => {
    mockSignals.mockReturnValue(
      signalsResult({ data: undefined, error: new Error('boom-signals-500') }),
    );

    renderPage(`?${RANGE}`);

    const banner = screen.getByText(/Failed to load data/);
    expect(banner).toHaveTextContent('boom-signals-500');
    // The cockpit still renders alongside the banner.
    expect(screen.getByRole('button', { name: 'Query' })).toBeInTheDocument();
  });

  it('paginates the fetched batch locally — advancing pages via the history controls', async () => {
    // 30 string rows, 25 per page ⇒ 2 pages of local slicing.
    const points: SignalHistoryPoint[] = Array.from({ length: 30 }, (_, i) =>
      pt(`2026-07-01T${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`, `v-${i}`),
    );
    mockedRequest.mockResolvedValue(resp('speed', points));

    renderPage(`?signals=speed&${RANGE}`);

    fireEvent.change(screen.getByLabelText('Per Page'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));
    // limit reflects perPage 25 × 10.
    expect(mockedRequest.mock.calls[0][0]).toContain('limit=250');

    // Pagination indicator: page 1 of 2 (ceil(30 / 25)).
    await screen.findByText('1 / 2');
    const nextBtn = screen.getByRole('button', { name: 'Next page' });
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);

    // Advanced to the final page; Next is now disabled.
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});
