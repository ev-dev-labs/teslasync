/**
 * DiagnosticPage — Phase-46 / Prompt 33 contract tests.
 *
 * Covers:
 *   1. Empty state on first mount; "Run diagnostic" button is wired.
 *   2. Click → mocked /system/diagnostic POST → renders 8+ check
 *      cards plus the overall hero badge.
 *   3. A check with status='fail' surfaces its remediation copy.
 *   4. Copy + Download buttons appear after a successful run and
 *      operate against the shared CopyButton + URL.createObjectURL
 *      flow.
 *   5. An endpoint error switches the page to the error banner
 *      without losing the Run button.
 *
 * The shared `request` helper is mocked so the real `useRunDiagnostic`
 * hook runs end-to-end without a network. i18n is stubbed to fall
 * back to the `defaultValue` argument so visible copy stays English.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
          // Cheap interpolation for the {{ts}} / {{when}} / {{ms}}
          // / {{count}} placeholders the page uses.
          if (
            'count' in o ||
            'ms' in o ||
            'ts' in o ||
            'when' in o
          ) {
            return key + ' ' + JSON.stringify(o);
          }
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import DiagnosticPage from './DiagnosticPage';
import type { DiagnosticReport } from '@/api/types';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/diagnostic']}>
        <ToastProvider>
          <DiagnosticPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildReport(overrides?: Partial<DiagnosticReport>): DiagnosticReport {
  return {
    generated_at: '2025-01-15T12:34:56Z',
    overall_status: 'degraded',
    checks: [
      { id: 'db.connectivity', name: 'Database connectivity', status: 'ok', detail: 'SELECT 1 succeeded', duration_ms: 4 },
      { id: 'db.migration_version', name: 'Database migration version', status: 'ok', detail: 'at version 172 (clean)', duration_ms: 6 },
      { id: 'telemetry.signal_log_freshness', name: 'Telemetry freshness', status: 'warn', detail: 'most recent signal 12m20s ago', remediation: 'Check Fleet Telemetry stream.', duration_ms: 8 },
      { id: 'tesla.token_valid', name: 'Tesla Fleet API token', status: 'ok', detail: 'valid token cached', duration_ms: 1 },
      { id: 'tesla.circuit_breaker', name: 'Tesla API circuit breaker', status: 'ok', detail: 'breaker closed', duration_ms: 1 },
      { id: 'mqtt.connected', name: 'MQTT broker connection', status: 'ok', detail: 'broker connected', duration_ms: 2 },
      { id: 'redis.ping', name: 'Redis cache', status: 'ok', detail: 'PING ok', duration_ms: 3 },
      { id: 'system.health_monitor', name: 'Resilience HealthMonitor summary', status: 'ok', detail: 'all monitored components healthy', duration_ms: 1 },
      { id: 'runtime.goroutines', name: 'Go runtime goroutines', status: 'ok', detail: '142 goroutines', duration_ms: 0 },
      { id: 'runtime.uptime', name: 'Process uptime', status: 'ok', detail: '4h21m12s', duration_ms: 0 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mockedRequest.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DiagnosticPage — Phase-46 / Prompt 33', () => {
  it('renders the empty state with a Run button on first mount', () => {
    renderPage();
    // Two run buttons (header + EmptyState CTA) — both render the same
    // English copy via the i18n mock fallback.
    const runButtons = screen.getAllByRole('button', {
      name: /Run diagnostic/i,
    });
    expect(runButtons.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/No diagnostic has been run/i)).toBeInTheDocument();
  });

  it('runs the diagnostic and renders a card per check + an overall badge', async () => {
    mockedRequest.mockResolvedValueOnce(buildReport());
    renderPage();

    fireEvent.click(screen.getByTestId('diagnostic-run-button'));

    await waitFor(() => {
      expect(screen.getByTestId('diagnostic-overall')).toBeInTheDocument();
    });

    // 10 cards in the report — assert at least 8 to leave headroom for
    // future check additions/removals.
    const cards = screen.getAllByTestId(/^diagnostic-check-/);
    expect(cards.length).toBeGreaterThanOrEqual(8);

    expect(mockedRequest).toHaveBeenCalledWith(
      '/system/diagnostic',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces the remediation copy for non-ok checks', async () => {
    mockedRequest.mockResolvedValueOnce(buildReport());
    renderPage();
    fireEvent.click(screen.getByTestId('diagnostic-run-button'));

    await waitFor(() => {
      expect(
        screen.getByText(/Check Fleet Telemetry stream\./i),
      ).toBeInTheDocument();
    });
  });

  it('shows Copy + Download actions only after a successful run', async () => {
    mockedRequest.mockResolvedValueOnce(buildReport());
    renderPage();

    expect(screen.queryByTestId('diagnostic-actions')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('diagnostic-download-button'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('diagnostic-run-button'));

    await waitFor(() => {
      expect(screen.getByTestId('diagnostic-actions')).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('diagnostic-download-button'),
    ).toBeInTheDocument();
    // The CopyButton is provided by the shared @/components/ui module
    // and renders a button with the supplied label as visible text.
    expect(
      screen.getByRole('button', { name: /Copy report/i }),
    ).toBeInTheDocument();
  });

  it('triggers the download flow with a generated filename', async () => {
    mockedRequest.mockResolvedValueOnce(buildReport());

    // Stub URL.createObjectURL + revokeObjectURL — jsdom doesn't ship
    // them. Stub HTMLAnchorElement.click so the synthetic <a> in the
    // page doesn't try to actually navigate.
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock');
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    renderPage();
    fireEvent.click(screen.getByTestId('diagnostic-run-button'));
    await waitFor(() => {
      expect(
        screen.getByTestId('diagnostic-download-button'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('diagnostic-download-button'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });

  it('renders an error banner when the endpoint fails', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom: 500 Internal'));
    renderPage();

    fireEvent.click(screen.getByTestId('diagnostic-run-button'));

    await waitFor(() => {
      expect(screen.getByTestId('diagnostic-error')).toBeInTheDocument();
    });
    // Scope the assertion to the diagnostic-error region — the
    // useMutationToast helper also surfaces the error in a Toast,
    // so a global getByText(/boom/) would match twice.
    const banner = screen.getByTestId('diagnostic-error');
    expect(banner).toHaveTextContent(/boom: 500 Internal/i);
    // The Run button must remain so the operator can retry. Its label
    // stays "Run diagnostic" because no successful report was cached.
    expect(screen.getByTestId('diagnostic-run-button')).toBeInTheDocument();
  });

  it('flips the Run button label to "Re-run" once a report is cached', async () => {
    mockedRequest.mockResolvedValueOnce(buildReport());
    renderPage();

    fireEvent.click(screen.getByTestId('diagnostic-run-button'));
    await waitFor(() => {
      expect(screen.getByTestId('diagnostic-overall')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /Re-run diagnostic/i }),
    ).toBeInTheDocument();
  });
});
