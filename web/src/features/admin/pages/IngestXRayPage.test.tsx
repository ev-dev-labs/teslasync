/**
 * IngestXRayPage — behaviour + contract tests.
 *
 * The page is the per-vehicle telemetry diagnostic cockpit. These tests
 * exercise the real page against the real `useIngestXRay` hook (only the
 * network `request()` and the vehicle list are mocked), so they cover the
 * end-to-end wiring an operator actually depends on:
 *
 *  1. Before a vehicle is picked the query stays disabled (no request), the
 *     "select a vehicle" banner shows, and the KPI band reads em-dashes — not
 *     a fabricated "0" — so the numbers never lie.
 *  2. Picking a vehicle fires the X-Ray query at the exact backend path with
 *     snake_case params and no `/api/v1` prefix, then renders KPIs + chart +
 *     field table + top-fields.
 *  3. A first-load failure surfaces the error state in every data section
 *     while the KPI band still shows dashes (no fake 0).
 *  4. A *transient* refetch failure (after data has landed once) must NOT blank
 *     the populated panels — the last-good data stays on screen. This is the
 *     regression guard for the `showError = isError && data === undefined` fix.
 *  5. Changing the window selector refetches with the new `window` param.
 *  6. The refresh control is disabled until a vehicle is picked, then triggers
 *     a manual refetch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ── i18n stub: return the fallback string with {{var}} interpolation ──────────
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
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
  };
});

// ── framer-motion: strip animation props so FadeIn/motion render synchronously ─
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({
          children,
          ...rest
        }: { children?: ReactNode } & Record<string, unknown>) => {
          const safeRest: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              k === 'animate' ||
              k === 'initial' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover' ||
              k === 'whileTap' ||
              k === 'whileInView' ||
              k === 'viewport' ||
              k === 'variants'
            )
              continue;
            safeRest[k] = v;
          }
          return <div {...(safeRest as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── Vehicle list: two vehicles, statically returned ───────────────────────────
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: [
      { id: 1, display_name: 'Falcon', vin: 'TESLA0000000001' },
      { id: 2, display_name: 'Hawk', vin: 'TESLA0000000002' },
    ],
    isLoading: false,
  }),
}));

// ── Network client: route ingest-xray calls to a dedicated `xrayFn` the tests
// drive, and return `[]` for everything else. ChartContainer transitively
// fetches `/annotations` on mount, so a naive catch-all mock that returned the
// X-Ray object would feed a non-array to the annotations `.map` and crash the
// chart section — routing keeps the two concerns cleanly separated.
const { xrayFn } = vi.hoisted(() => ({ xrayFn: vi.fn() }));
vi.mock('@/api/client', () => ({
  request: vi.fn((url: string, opts?: unknown) => {
    if (typeof url === 'string' && url.includes('/system/ingest-xray/')) {
      return xrayFn(url, opts);
    }
    // Annotations + any other chart-side GET — always an array.
    return Promise.resolve([]);
  }),
  // QueryError (rendered on the error branch) imports isApiError; stub it so
  // the module is complete and QueryError falls to its generic network branch.
  isApiError: () => false,
}));

import { request } from '@/api/client';
import type { IngestXRayResponse } from '@/types/admin-diagnostics';
import { ToastProvider } from '@/components/feedback/Toast';
import IngestXRayPage from './IngestXRayPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const DASH = '—';

function makeXRay(
  overrides: Partial<IngestXRayResponse> = {},
): IngestXRayResponse {
  return {
    vehicle_id: 1,
    window: '1h',
    bucket: '1m',
    generated_at: '2026-07-03T22:00:00.000Z',
    total_samples: 4096,
    unique_fields: 2,
    fields: [
      {
        field: 'VehicleSpeed',
        sample_count: 900,
        last_seen_at: '2026-07-03T21:59:00.000Z',
        value_kind: 6,
      },
      {
        field: 'BatteryLevel',
        sample_count: 300,
        last_seen_at: '2026-07-03T21:58:00.000Z',
        value_kind: 3,
      },
    ],
    buckets: [
      { bucket_start: '2026-07-03T21:57:00.000Z', count: 5 },
      { bucket_start: '2026-07-03T21:58:00.000Z', count: 12 },
      { bucket_start: '2026-07-03T21:59:00.000Z', count: 7 },
    ],
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({
    // retryDelay:0 keeps the hook's hardcoded `retry: 1` instant so error
    // tests don't spend a real backoff second.
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <IngestXRayPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function pickVehicle(value = '1') {
  fireEvent.change(screen.getByLabelText('Vehicle'), { target: { value } });
}

beforeEach(() => {
  // Keep the routing implementation on `request`, just clear its call log;
  // reset the xray behaviour so each test starts from a clean slate.
  mockedRequest.mockClear();
  xrayFn.mockReset();
});

describe('IngestXRayPage', () => {
  it('keeps the query disabled and shows dashes (not a fake 0) before a vehicle is picked', () => {
    renderPage();

    // Query is gated on a selected vehicle → the X-Ray endpoint must not fire.
    expect(xrayFn).not.toHaveBeenCalled();

    // The "select a vehicle" CTA banner is visible.
    expect(screen.getByText('Select a vehicle')).toBeInTheDocument();

    // The toolbar renders the vehicle picker + a disabled refresh control.
    expect(screen.getByLabelText('Vehicle')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Refresh ingest X-Ray' }),
    ).toBeDisabled();

    // The four numeric KPIs (samples / fields / peak / avg) read em-dash so a
    // "no vehicle" state never renders as a real 0.
    expect(screen.getAllByText(DASH).length).toBeGreaterThanOrEqual(4);
  });

  it('fires the X-Ray query at the exact backend path and renders KPIs, chart, table + top-fields', async () => {
    xrayFn.mockResolvedValue(makeXRay());

    renderPage();
    pickVehicle('1');

    await waitFor(() => expect(xrayFn).toHaveBeenCalled());

    // Hook URL contract: no /api/v1 prefix, snake_case params in insertion
    // order (window, bucket, limit), vehicle id in the path.
    expect(mockedRequest).toHaveBeenCalledWith(
      '/system/ingest-xray/1?window=1h&bucket=1m&limit=100',
      expect.anything(),
    );

    // KPI band shows the formatted total (4096 → "4,096"), not a dash.
    await waitFor(() => expect(screen.getByText('4,096')).toBeInTheDocument());

    // Hero chart + field sections render from the same payload.
    expect(screen.getByText('Samples per bucket')).toBeInTheDocument();
    expect(screen.getAllByText('VehicleSpeed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('BatteryLevel').length).toBeGreaterThanOrEqual(1);
  });

  it('surfaces the error state on a first-load failure while the KPI band still shows dashes', async () => {
    xrayFn.mockRejectedValue(new Error('pipeline down'));

    renderPage();
    pickVehicle('1');

    // The generic-network QueryError copy appears in the data sections
    // (chart / top-fields / table each render it).
    await waitFor(() =>
      expect(
        screen.getAllByText("Can't reach server").length,
      ).toBeGreaterThanOrEqual(1),
    );
    // …with a working Retry affordance.
    expect(
      screen.getAllByRole('button', { name: 'Retry' }).length,
    ).toBeGreaterThanOrEqual(1);

    // No data ever landed → KPI band must still read dashes, not "0".
    expect(screen.getAllByText(DASH).length).toBeGreaterThanOrEqual(4);
  });

  it('does NOT blank populated panels when a later poll fails (keeps last-good data)', async () => {
    // First fetch succeeds; every subsequent fetch (the manual refresh below)
    // rejects. TanStack Query retains `data` across the failure, so the fix
    // (`showError = isError && data === undefined`) must keep the panels shown.
    xrayFn.mockResolvedValueOnce(makeXRay());
    xrayFn.mockRejectedValue(new Error('transient blip'));

    renderPage();
    pickVehicle('1');

    await waitFor(() =>
      expect(screen.getAllByText('VehicleSpeed').length).toBeGreaterThanOrEqual(1),
    );

    const callsBefore = xrayFn.mock.calls.length;
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh ingest X-Ray' }),
    );

    // The refresh triggered at least one more X-Ray request (attempt + retry).
    await waitFor(() =>
      expect(xrayFn.mock.calls.length).toBeGreaterThan(callsBefore),
    );

    // The failed poll must not blank the table nor swap it for the error panel:
    // last-good data stays and no error copy appears.
    expect(screen.getAllByText('VehicleSpeed').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Can't reach server")).toBeNull();
    // KPI band still shows the last-good total, not a dash.
    expect(screen.getByText('4,096')).toBeInTheDocument();
  });

  it('refetches with the new window when the window selector changes', async () => {
    xrayFn.mockResolvedValue(makeXRay());

    renderPage();
    pickVehicle('1');

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/system/ingest-xray/1?window=1h&bucket=1m&limit=100',
        expect.anything(),
      ),
    );

    fireEvent.change(screen.getByLabelText('Window'), {
      target: { value: '24h' },
    });

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        expect.stringContaining('window=24h'),
        expect.anything(),
      ),
    );
  });

  it('enables the refresh control once a vehicle is picked and triggers a manual refetch', async () => {
    xrayFn.mockResolvedValue(makeXRay());

    renderPage();

    const refreshBtn = screen.getByRole('button', {
      name: 'Refresh ingest X-Ray',
    });
    expect(refreshBtn).toBeDisabled();

    pickVehicle('1');
    await waitFor(() => expect(xrayFn).toHaveBeenCalled());
    await waitFor(() => expect(refreshBtn).not.toBeDisabled());

    const callsBefore = xrayFn.mock.calls.length;
    fireEvent.click(refreshBtn);

    await waitFor(() =>
      expect(xrayFn.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
});
