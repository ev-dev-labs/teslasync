/**
 * RedisSignalViewerPage error-aware tests.
 *
 * Verifies that the page no longer disguises a backend failure as
 * the legacy generic "no signals cached for this vehicle" empty
 * state. When `getRedisSignals` rejects with a 503 ApiError, the
 * page surfaces the {@link RedisDiagnosticEmptyState} cacheNotWired
 * banner AND the four StatCards display the `'—'` placeholder so
 * the top-of-page numbers don't lie about a 0 count.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/feedback/Toast';
import type { ReactNode } from 'react';

// ── i18n stub: returns the fallback string with {{var}} interpolation ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) {
            s = s.replace(`{{${k}}}`, String(v));
          }
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: keep tests fast + deterministic ─────────────────────
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safeRest: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              k === 'animate' ||
              k === 'initial' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover' ||
              k === 'whileTap' ||
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

// ── Vehicle hook: mutable so the empty-fleet safety state stays covered ─
const vehicleHook = vi.hoisted(() => ({
  data: [{ id: 1, display_name: 'Falcon', vin: 'TESLA1234567890' }],
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: vehicleHook.data,
    isLoading: false,
  }),
}));

// ── devtools API: drive the failure mode per test ──────────────────────
vi.mock('@/api/devtools', async () => {
  const actual = await vi.importActual<typeof import('@/api/devtools')>(
    '@/api/devtools',
  );
  return {
    ...actual,
    getRedisSignals: vi.fn(),
    getRedisSignalKeys: vi.fn().mockResolvedValue({ keys: [], total: 0 }),
    purgeRedisSignals: vi.fn(),
    purgeAllRedisSignals: vi.fn(),
  };
});

import { getRedisSignals, purgeRedisSignals, purgeAllRedisSignals } from '@/api/devtools';
import { ApiError } from '@/lib/resilience';
import RedisSignalViewerPage from '../RedisSignalViewerPage';

const mockedGetSignals = getRedisSignals as unknown as ReturnType<typeof vi.fn>;
const mockedPurge = purgeRedisSignals as unknown as ReturnType<typeof vi.fn>;
const mockedPurgeAll = purgeAllRedisSignals as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vehicleHook.data = [{ id: 1, display_name: 'Falcon', vin: 'TESLA1234567890' }];
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RedisSignalViewerPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function makeApiError(status: number, message: string): ApiError {
  return Object.assign(new Error(message), {
    name: 'ApiError',
    status,
  }) as ApiError;
}

describe('RedisSignalViewerPage — Phase-46 / Prompt 59 (error states)', () => {
  beforeEach(() => {
    mockedGetSignals.mockReset();
  });

  it('renders the cacheNotWired banner when getRedisSignals rejects with 503 "not available" (NOT the legacy "No signals cached" string)', async () => {
    mockedGetSignals.mockRejectedValue(
      makeApiError(503, 'Redis signal cache is not available'),
    );
    renderPage();

    // Pick the first vehicle so the query fires. The page renders multiple
    // <select>s (vehicle picker, category filter); the vehicle picker is
    // the first one in DOM order.
    const selects = screen.getAllByRole('combobox');
    const vehicleSelect = selects[0] as HTMLSelectElement;
    fireEvent.change(vehicleSelect, { target: { value: '1' } });

    const banner = await screen.findByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'danger');
    expect(banner).toHaveTextContent('Redis cache is not configured');

    // The legacy generic copy MUST NOT appear when the request errored —
    // that was the original symptom this test guards.
    expect(
      screen.queryByText('No signals cached for this vehicle'),
    ).toBeNull();

    // Stat cards must show the placeholder, not "0", so the operator
    // doesn't see a fake "0 Total Signals" reading on a failed request.
    await waitFor(() => {
      const labelEl = screen.getByText('Total Signals');
      // Walk up to the StatCard root and inspect its rendered value text.
      const card = labelEl.closest('div')?.parentElement?.parentElement;
      expect(card?.textContent).toContain('—');
    });
  });
});

describe('RedisSignalViewerPage — Purge cache controls', () => {
  beforeEach(() => {
    mockedGetSignals.mockReset();
    mockedPurge.mockReset();
    mockedPurgeAll.mockReset();
  });

  it('purges single-vehicle cache after confirmation, then refetches', async () => {
    mockedGetSignals.mockResolvedValue({
      vehicle_id: 1,
      signal_count: 1,
      signals: { BatteryLevel: { value: 72, type: 'number' } },
    });
    mockedPurge.mockResolvedValue({ vehicle_id: 1, purged: true });

    renderPage();

    // Pick the vehicle so the per-vehicle Purge button enables.
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0] as HTMLSelectElement, { target: { value: '1' } });
    await waitFor(() => expect(mockedGetSignals).toHaveBeenCalledTimes(1));

    // Click the per-vehicle "Purge Redis (L2)" button (NOT "Purge All Redis").
    const purgeBtn = screen.getByRole('button', { name: /^Purge Redis \(L2\)$/ });
    expect(purgeBtn).not.toBeDisabled();
    fireEvent.click(purgeBtn);

    // ConfirmDialog renders a confirm button labeled with the same text;
    // pick the one inside the modal (last match in DOM order).
    const confirmBtns = await screen.findAllByRole('button', { name: 'Purge Redis (L2)' });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => expect(mockedPurge).toHaveBeenCalledWith(1));
    // Refetch after invalidation: getRedisSignals fires again.
    await waitFor(() => expect(mockedGetSignals).toHaveBeenCalledTimes(2));
  });

  it('PurgeAll button requires typing PURGE ALL before the destructive call fires', async () => {
    mockedGetSignals.mockResolvedValue({
      vehicle_id: 1,
      signal_count: 0,
      signals: {},
    });
    mockedPurgeAll.mockResolvedValue({ purged: 7, scanned: 7, limit: 1000, has_more: false });

    renderPage();

    const purgeAllBtn = screen.getByRole('button', { name: /Purge All Redis/ });
    fireEvent.click(purgeAllBtn);

    // Confirm button must be disabled until "PURGE ALL" is typed.
    const confirmBtns = await screen.findAllByRole('button', { name: 'Purge All Vehicles' });
    const confirmBtn = confirmBtns[confirmBtns.length - 1];
    expect(confirmBtn).toBeDisabled();

    // Type the magic string into the typed-confirmation input
    // (aria-label-scoped to disambiguate from the page's search input).
    const input = screen.getByLabelText('Type PURGE ALL to confirm');
    fireEvent.change(input, { target: { value: 'PURGE ALL' } });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockedPurgeAll).toHaveBeenCalledTimes(1));
  });

  it('per-vehicle Purge button stays disabled when the fleet is empty', () => {
    vehicleHook.data = [];
    mockedGetSignals.mockResolvedValue({
      vehicle_id: 1,
      signal_count: 0,
      signals: {},
    });
    renderPage();
    const purgeBtn = screen.getByRole('button', { name: /^Purge Redis \(L2\)$/ });
    expect(purgeBtn).toBeDisabled();
  });

  it('pins the per-vehicle purge target so a mid-confirm vehicle change does not retarget', async () => {
    // Regression: rubber-duck flagged that switching the vehicle picker
    // while the confirm dialog is open could retarget the destructive
    // call from vehicle 1 to vehicle 2. We pin the target id at open
    // time, so the API call must still hit vehicle 1.
    mockedGetSignals.mockResolvedValue({
      vehicle_id: 1,
      signal_count: 1,
      signals: { BatteryLevel: { value: 72, type: 'number' } },
    });
    mockedPurge.mockResolvedValue({ vehicle_id: 1, purged: true });

    // Mock vehicles hook to return TWO vehicles so we can switch.
    vi.doMock('@/api/hooks/useVehicles', () => ({
      useVehicles: () => ({
        data: [
          { id: 1, display_name: 'Falcon', vin: 'TESLA0000000001' },
          { id: 2, display_name: 'Hawk', vin: 'TESLA0000000002' },
        ],
        isLoading: false,
      }),
    }));

    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0] as HTMLSelectElement, { target: { value: '1' } });
    await waitFor(() => expect(mockedGetSignals).toHaveBeenCalledWith(1));

    // Open dialog targeting vehicle 1.
    fireEvent.click(screen.getByRole('button', { name: /^Purge Redis \(L2\)$/ }));

    // Change the picker to vehicle 2 BEFORE confirming.
    fireEvent.change(selects[0] as HTMLSelectElement, { target: { value: '2' } });

    // Confirm — the call MUST still target vehicle 1, the pinned target.
    const confirmBtns = await screen.findAllByRole('button', { name: 'Purge Redis (L2)' });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => expect(mockedPurge).toHaveBeenCalled());
    expect(mockedPurge).toHaveBeenCalledWith(1);
    expect(mockedPurge).not.toHaveBeenCalledWith(2);
  });

  it('shows a partial-purge warning toast when has_more is true', async () => {
    mockedGetSignals.mockResolvedValue({
      vehicle_id: 1,
      signal_count: 0,
      signals: {},
    });
    mockedPurgeAll.mockResolvedValue({ purged: 1000, scanned: 1000, limit: 1000, has_more: true });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Purge All Redis/ }));
    const confirmBtns = await screen.findAllByRole('button', { name: 'Purge All Vehicles' });
    const confirmBtn = confirmBtns[confirmBtns.length - 1];
    fireEvent.change(screen.getByLabelText('Type PURGE ALL to confirm'), { target: { value: 'PURGE ALL' } });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockedPurgeAll).toHaveBeenCalledTimes(1));
    // Toast text comes through as the success/warning title — assert the
    // partial-purge copy made it to the DOM.
    await waitFor(() =>
      expect(screen.getByText(/partially purged/i)).toBeInTheDocument(),
    );
  });
});
