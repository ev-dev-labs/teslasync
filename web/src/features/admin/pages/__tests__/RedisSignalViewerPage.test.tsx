/**
 * Phase-46 / Prompt 59 — RedisSignalViewerPage error-aware tests.
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

// ── Vehicle hook: one vehicle, statically returned ─────────────────────
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: [{ id: 1, display_name: 'Falcon', vin: 'TESLA1234567890' }],
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
  };
});

import { getRedisSignals } from '@/api/devtools';
import { ApiError } from '@/lib/resilience';
import RedisSignalViewerPage from '../RedisSignalViewerPage';

const mockedGetSignals = getRedisSignals as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RedisSignalViewerPage />
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
    // that was the original symptom this prompt fixes.
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
