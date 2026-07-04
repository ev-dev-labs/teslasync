/**
 * SignalExplorerPage — behaviour + regression suite.
 *
 * The page is the default (and only) export. These tests exercise its
 * orchestration across the deterministic surfaces (KPI band, controls,
 * results bento) and the historical vs. live modes, and they pin two real
 * bugs the page previously carried:
 *
 *   1. Changing the "Per Page" size fired two single-key URL setters back to
 *      back (`setPerPage` then `setPage`). Under react-router v6 the second
 *      navigate(replace) reads the SAME pre-handler searchParams snapshot and
 *      discards the first — so the size change was silently dropped and the
 *      dropdown appeared to do nothing. Fixed with an atomic `useUrlBatch`.
 *
 *   2. `handleApplyAiDraft` fired up to FOUR setters in one handler
 *      (signals + range preset + size + page), so applying an AI draft landed
 *      only the last one. Now batched — every field lands together.
 *
 * Network is mocked at the `request` boundary; the live SSE hook is mocked at
 * `useRealtimeEvents`; framer-motion and i18n are stubbed for determinism.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type { SignalHistoryResp } from '@/api/types';

// ── Shared mutable state driving the mocks (hoisted so factories see it). ──
const h = vi.hoisted(() => ({
  vehicleId: 1 as number | null,
  connected: false,
  signalsData: ['battery_level', 'speed', 'inside_temp'] as string[],
  signalsError: null as unknown,
  onVehicleUpdate: null as ((data: unknown) => void) | null,
}));

// Preserve every real export from the client; only intercept `request` so no
// test ever hits the network but transitive consumers keep working.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn() };
});

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => ({
    data: h.signalsData,
    error: h.signalsError,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: h.vehicleId != null ? { id: h.vehicleId, display_name: 'Test Car' } : null,
    vehicles: h.vehicleId != null ? [{ id: h.vehicleId, display_name: 'Test Car' }] : [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: (opts?: { onVehicleUpdate?: (data: unknown) => void }) => {
    h.onVehicleUpdate = opts?.onVehicleUpdate ?? null;
    return {
      connected: h.connected,
      state: h.connected ? 'connected' : 'reconnecting',
      diagnostics: {},
    };
  },
}));

// Replace the gated AI section with a tiny harness that invokes the page's
// `onApply` with a fixed draft — lets us exercise handleApplyAiDraft without
// standing up the SSE stream. The real gating/streaming is covered by the
// sibling AI contract tests.
vi.mock('@/components/ai/AISignalExplorerNlFilter', () => ({
  AISignalExplorerNlFilter: ({
    onApply,
  }: {
    vehicleId: number;
    onApply: (draft: {
      vehicle_id: number;
      signals: string[];
      range_preset: string;
      per_page: number;
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-ai-apply"
      onClick={() =>
        onApply({
          vehicle_id: 1,
          signals: ['inside_temp', 'speed'],
          range_preset: '7d',
          per_page: 100,
        })
      }
    >
      apply-ai
    </button>
  ),
}));

// Deterministic FadeIn/motion — render children eagerly, no IntersectionObserver
// dance or async animation frames.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        (props: Record<string, unknown>) => {
          const { children } = props as { children?: React.ReactNode };
          return <div>{children}</div>;
        },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

// i18n: return the developer default string (with {{interpolation}}) or the key.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/\{\{(\w+)\}\}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') {
            const dv = o.defaultValue;
            return dv.replace(/\{\{(\w+)\}\}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import SignalExplorerPage from './SignalExplorerPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function makeHistoryResp(signal: string, values: number[]): SignalHistoryResp {
  return {
    vehicle_id: 1,
    signal,
    count: values.length,
    data: values.map((v, i) => ({
      ts: `2026-07-04T10:0${i}:00.000Z`,
      kind: 'ValueKindDouble',
      value: v,
    })),
  };
}

function renderPage(entries: string[] = ['/signals/explorer']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={entries}>
        <SignalExplorerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.vehicleId = 1;
  h.connected = false;
  h.signalsData = ['battery_level', 'speed', 'inside_temp'];
  h.signalsError = null;
  h.onVehicleUpdate = null;
  window.localStorage.clear();
  mockedRequest.mockReset();
  mockedRequest.mockResolvedValue(makeHistoryResp('', []));
});

describe('SignalExplorerPage', () => {
  it('shows the no-vehicle empty state and hides the exploration UI when no vehicle is selected', () => {
    h.vehicleId = null;

    renderPage();

    // The page shell (title) still renders...
    expect(screen.getByRole('heading', { name: 'Signal Explorer' })).toBeInTheDocument();
    // ...but the body is the "pick a vehicle" prompt, not the KPI/results UI.
    expect(screen.getByText('Select a vehicle to begin')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Exploration summary' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Pick signals and click Explore')).not.toBeInTheDocument();
    // No signals catalog fetch is meaningful without a vehicle.
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('renders the KPI band and idle guidance when a vehicle is selected but no query has run', () => {
    renderPage();

    // KPI landmark + the "no signals yet" counter.
    expect(
      screen.getByRole('region', { name: 'Exploration summary' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText('Records')).toBeInTheDocument();
    // Deterministic guidance before Explore, and Explore is disabled with no
    // signals selected.
    expect(screen.getByText('Pick signals and click Explore')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explore' })).toBeDisabled();
    // No historical query fired.
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('surfaces a non-blocking error banner when the signals catalog fails to load', () => {
    h.signalsError = new Error('catalog boom');

    renderPage();

    // Banner shows the message...
    expect(screen.getByText(/catalog boom/)).toBeInTheDocument();
    // ...and the rest of the page is still usable (error is additive, not a
    // full-page replacement).
    expect(
      screen.getByRole('region', { name: 'Exploration summary' }),
    ).toBeInTheDocument();
  });

  it('runs a historical query on Explore, requesting SI history per signal with the correct URL contract', async () => {
    mockedRequest.mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/battery_level/')) {
        return Promise.resolve(makeHistoryResp('battery_level', [80.1, 80.2]));
      }
      if (p.includes('/speed/')) {
        return Promise.resolve(makeHistoryResp('speed', [55.5]));
      }
      return Promise.resolve(makeHistoryResp('', []));
    });

    renderPage(['/signals/explorer?signals=battery_level,speed']);

    // Nothing fetched until the user explicitly clicks Explore.
    expect(mockedRequest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Explore' }));

    // A request is issued per selected signal.
    await waitFor(() => {
      const calls = mockedRequest.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('/battery_level/'))).toBe(true);
      expect(calls.some((u) => u.includes('/speed/'))).toBe(true);
    });

    const batteryUrl = String(
      mockedRequest.mock.calls.find((c) => String(c[0]).includes('/battery_level/'))![0],
    );
    // Correct vehicle id, snake_case params, default page-size * 10 limit,
    // and NO `/api/v1` double-prefix / camelCase params.
    expect(batteryUrl).toContain('/signals/1/battery_level/history?');
    expect(batteryUrl).toContain('from=');
    expect(batteryUrl).toContain('to=');
    expect(batteryUrl).toContain('limit=250');
    expect(batteryUrl).not.toContain('/api/v1');
    expect(batteryUrl).not.toContain('vehicleId=');

    // The history rows and per-signal stats render from the fetched data.
    await waitFor(() => {
      expect(screen.getAllByText('80.1').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('80.15')).toBeInTheDocument(); // battery avg

    // Historical mode uses the "Records" KPI, not the live "Live Events" one.
    expect(screen.getByText('Records')).toBeInTheDocument();
    expect(screen.queryByText('Live Events')).not.toBeInTheDocument();
  });

  it('applies a changed page size atomically so the query limit reflects it (regression)', async () => {
    mockedRequest.mockImplementation((path: string) => {
      const p = String(path);
      if (p.includes('/battery_level/')) {
        return Promise.resolve(makeHistoryResp('battery_level', [12]));
      }
      return Promise.resolve(makeHistoryResp('', []));
    });

    renderPage(['/signals/explorer?signals=battery_level']);

    const perPage = screen.getByLabelText('Per Page') as HTMLSelectElement;
    fireEvent.change(perPage, { target: { value: '100' } });

    // Before the fix the second (page) setter clobbered the size setter, so
    // the controlled select snapped back to 25. It must now stick at 100.
    await waitFor(() => expect(perPage).toHaveValue('100'));

    fireEvent.click(screen.getByRole('button', { name: 'Explore' }));

    await waitFor(() =>
      expect(
        mockedRequest.mock.calls.some((c) => String(c[0]).includes('/battery_level/')),
      ).toBe(true),
    );
    const url = String(
      mockedRequest.mock.calls.find((c) => String(c[0]).includes('/battery_level/'))![0],
    );
    // 100 (size) * 10 = 1000 — proves the new size propagated into the query.
    expect(url).toContain('limit=1000');
  });

  it('switches to live mode: connected badge, live KPIs, waiting chart, no history table', () => {
    h.connected = true;

    renderPage(['/signals/explorer?signals=battery_level,speed']);

    fireEvent.click(screen.getByRole('button', { name: 'Live' }));

    // Live affordances swap in.
    expect(screen.getByRole('button', { name: 'Stop live' })).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    // KPI band flips to the streaming vocabulary — the Status value and the
    // events subtitle both read "Streaming" when connected.
    expect(screen.getAllByText('Streaming').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Live Events')).toBeInTheDocument();
    expect(screen.queryByText('Records')).not.toBeInTheDocument();
    // The live chart shows its waiting state and the history table (historical
    // only) is absent.
    expect(screen.getByText('Waiting for signal data…')).toBeInTheDocument();
    expect(screen.queryByText('Signal Data')).not.toBeInTheDocument();
    // No historical fetch in live mode.
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('applies an AI draft as one atomic update — signals AND page size both land (regression)', () => {
    renderPage(['/signals/explorer']);

    // Sanity: nothing selected yet, default size.
    expect(screen.getByText(/Signals \(0 \/ 5\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Per Page')).toHaveValue('25');

    fireEvent.click(screen.getByTestId('mock-ai-apply'));

    // Before the fix only the last setter survived (page reset), so signals
    // and size were dropped. Now both the two-signal selection and the size
    // land together.
    expect(screen.getByText(/Signals \(2 \/ 5\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Per Page')).toHaveValue('100');
  });
});
