/**
 * TelemetryErrorsWidget — behaviour, hardening & a11y contract.
 *
 * The widget fans TWO hooks — `useFleetTelemetryErrorVINs` (the active-VIN
 * summary that drives the status badge / hero count) and
 * `useFleetTelemetryErrors` (the raw error rows aggregated into the feed) —
 * into two responsive layouts (compact 1×N status hero / standard ≥2-col
 * header + scrollable error feed). It has no named exports, so this suite
 * drives the single default export through its accessible surface across every
 * layout, state, and branch:
 *
 *   - the loading / empty paths of each layout (a load in EITHER source gates
 *     the shared skeleton; a truly empty result renders an <EmptyState
 *     role="status"> rather than a blank panel);
 *   - the compact status hero: the active-VIN count (`fmtInt`) + the
 *     danger/"Errors" vs success/"Healthy" badge driven by whether any VIN is
 *     currently active;
 *   - the standard layout's header ("{{count}} VINs with errors") + the
 *     aggregated feed: duplicate `vin::error_code` rows collapse into a single
 *     "×N" row, distinct codes stay separate, a null `error_code` renders the
 *     i18n'd "Unknown" fallback, the "recent" badge appears only for entries
 *     seen within the last hour, rows sort newest-first, and each row's
 *     `last_seen` is threaded into <TimeStamp>;
 *   - the "No errors recorded" branch (VIN summary present but zero error rows);
 *   - the two ELEVATION BUG FIXES: (1) the freshness refresh now refetches BOTH
 *     sources (it previously refetched only the VIN summary, leaving the feed
 *     stale); (2) a failed load with no data now surfaces a <QueryError>
 *     ("Can't reach server") instead of the misleading "No telemetry error
 *     data" empty state — while a failure that still has data degrades
 *     gracefully to stale content rather than blanking.
 *
 * Both hooks are mocked at the hook boundary (`importActual` keeps the module's
 * other telemetry hooks intact for any transitive importer) so no network is
 * touched. <TimeStamp> is stubbed via a partial mock of `@/components/data-display`
 * (its real implementation reaches the un-stubbed `@/api/hooks/useSettings`
 * TanStack query through `useTimeFormatPreference`); `DataFreshness` /
 * `DataFreshnessAuto` are preserved from the actual module so <WidgetShell>'s
 * freshness/refresh control renders for real. `react-i18next` is stubbed to echo
 * the English fallback and interpolate `{{var}}` tokens. `@testing-library/user-event`
 * is not installed in this repo (see the sibling widget suites), so interactions
 * use `fireEvent`. `QueryError` + `EmptyState` pull in `react-router-dom`, so
 * renders are wrapped in a `MemoryRouter`.
 */

import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so count-bearing copy ("{{count}} VINs with errors") renders as
// real text. The namespace argument passed by the widget is ignored.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two data sources become controllable vi.fns. importActual keeps the
// module's many other telemetry hooks intact for any transitive importer.
vi.mock('@/api/hooks/useTelemetry', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>(
    '@/api/hooks/useTelemetry',
  );
  return {
    ...actual,
    useFleetTelemetryErrorVINs: vi.fn(),
    useFleetTelemetryErrors: vi.fn(),
  };
});

// Stub only <TimeStamp> (its real impl reaches the un-stubbed
// `@/api/hooks/useSettings` query via useTimeFormatPreference). The stub echoes
// the raw `value` so we can assert each feed row is threaded its `last_seen`.
// DataFreshness / DataFreshnessAuto are preserved so <WidgetShell>'s freshness
// + refresh control renders for real.
vi.mock('@/components/data-display', async () => {
  const actual = await vi.importActual<typeof import('@/components/data-display')>(
    '@/components/data-display',
  );
  return {
    ...actual,
    TimeStamp: ({
      value,
      className,
    }: {
      value: string | number | Date | null | undefined;
      className?: string;
    }) => (
      <span data-testid="timestamp" className={className}>
        {value == null ? '—' : String(value)}
      </span>
    ),
  };
});

import TelemetryErrorsWidget from './TelemetryErrorsWidget';
import {
  useFleetTelemetryErrorVINs,
  useFleetTelemetryErrors,
  type FleetTelemetryError,
  type FleetTelemetryErrorVIN,
} from '@/api/hooks/useTelemetry';
import type { WidgetSize } from './types';

const mockUseVINs = vi.mocked(useFleetTelemetryErrorVINs);
const mockUseErrors = vi.mocked(useFleetTelemetryErrors);

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via <DataFreshness>
// inside <WidgetShell>) reads it.
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

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

let vinSeq = 0;
function makeVIN(over: Partial<FleetTelemetryErrorVIN> = {}): FleetTelemetryErrorVIN {
  vinSeq += 1;
  return {
    id: vinSeq,
    vin: `VIN${String(vinSeq).padStart(3, '0')}`,
    active: true,
    first_seen_at: '2024-05-01T00:00:00Z',
    last_seen_at: '2024-05-01T01:00:00Z',
    resolved_at: null,
    ...over,
  };
}

let errSeq = 0;
function makeError(over: Partial<FleetTelemetryError> = {}): FleetTelemetryError {
  errSeq += 1;
  return {
    id: errSeq,
    vin: 'VIN001',
    error_code: `E${errSeq}`,
    error_message: `message ${errSeq}`,
    reported_at: '2024-05-01T00:00:00Z',
    tesla_updated_at: null,
    fetched_at: '2024-05-01T00:00:00Z',
    ...over,
  };
}

/** ISO string `mins` minutes in the past (for the recency / ordering branches). */
const minsAgo = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

function renderWidget(size: WidgetSize) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TelemetryErrorsWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const STANDARD: WidgetSize = { cols: 2, rows: 4 };

beforeEach(() => {
  vinSeq = 0;
  errSeq = 0;
  vi.clearAllMocks();
  mockUseVINs.mockReturnValue(qr());
  mockUseErrors.mockReturnValue(qr());
});

// ── Compact layout (cols ≤ 1): the status hero ──────────────────────────────

describe('TelemetryErrorsWidget — compact layout', () => {
  it('renders a loading skeleton (no hero copy) while the VIN query loads', () => {
    mockUseVINs.mockReturnValue(qr({ isLoading: true }));
    const { container } = renderWidget(COMPACT);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('error VINs')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when both sources are empty', () => {
    mockUseVINs.mockReturnValue(qr({ data: [] }));
    mockUseErrors.mockReturnValue(qr({ data: [] }));
    renderWidget(COMPACT);
    const empty = screen.getByText('No telemetry error data');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });

  it('renders the active-VIN count and the danger "Errors" badge when VINs are active', () => {
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN(), makeVIN()] }));
    renderWidget(COMPACT);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('error VINs')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.queryByText('Healthy')).toBeNull();
  });

  it('renders the success "Healthy" badge when data exists but no VIN is active', () => {
    // Inactive VIN → hasData is true (so we skip the empty state) but the
    // active count is 0 → success/"Healthy".
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN({ active: false })] }));
    renderWidget(COMPACT);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.queryByText('Errors')).toBeNull();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

// ── Standard layout (≥2 cols): header + aggregated error feed ───────────────

describe('TelemetryErrorsWidget — standard layout', () => {
  it('renders the title, the active-VIN header, and the danger badge', () => {
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN(), makeVIN()] }));
    mockUseErrors.mockReturnValue(qr({ data: [makeError()] }));
    renderWidget(STANDARD);
    expect(screen.getByText('Telemetry Errors')).toBeInTheDocument();
    expect(screen.getByText('2 VINs with errors')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
  });

  it('aggregates duplicate vin+code rows into a single ×N entry, keeping distinct codes separate', () => {
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN()] }));
    mockUseErrors.mockReturnValue(
      qr({
        data: [
          makeError({ vin: 'VINX', error_code: 'DUPE' }),
          makeError({ vin: 'VINX', error_code: 'DUPE' }),
          makeError({ vin: 'VINX', error_code: 'OTHER' }),
        ],
      }),
    );
    renderWidget(STANDARD);

    // DUPE collapses to one ×2 row; OTHER stays a separate ×1 row.
    expect(screen.getByText('DUPE')).toBeInTheDocument();
    expect(screen.getByText('OTHER')).toBeInTheDocument();
    expect(screen.getByText('\u00D72')).toBeInTheDocument();
    // The VIN appears once per aggregated row → two rows share VINX.
    expect(screen.getAllByText('VINX')).toHaveLength(2);
    expect(screen.getAllByTestId('timestamp')).toHaveLength(2);
  });

  it('renders the i18n "Unknown" fallback for a null error_code', () => {
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN()] }));
    mockUseErrors.mockReturnValue(qr({ data: [makeError({ error_code: null })] }));
    renderWidget(STANDARD);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('flags only entries seen within the last hour as "recent" and sorts newest-first', () => {
    const recentTs = minsAgo(5);
    const oldTs = minsAgo(120);
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN()] }));
    mockUseErrors.mockReturnValue(
      qr({
        data: [
          makeError({ vin: 'VINR', error_code: 'RECENT', reported_at: recentTs, fetched_at: recentTs }),
          makeError({ vin: 'VINO', error_code: 'OLDONE', reported_at: oldTs, fetched_at: oldTs }),
        ],
      }),
    );
    const { container } = renderWidget(STANDARD);

    // Exactly one "recent" badge (the 5-minute-old entry).
    expect(screen.getAllByText('recent')).toHaveLength(1);
    // Each row threads its resolved last_seen into <TimeStamp>.
    expect(screen.getByText(recentTs)).toBeInTheDocument();
    expect(screen.getByText(oldTs)).toBeInTheDocument();
    // Newest-first ordering: RECENT appears before OLDONE in the DOM.
    const text = container.textContent ?? '';
    expect(text.indexOf('RECENT')).toBeLessThan(text.indexOf('OLDONE'));
  });

  it('shows "No errors recorded" (and stays Healthy) when the VIN summary has no active VINs and no error rows', () => {
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN({ active: false })] }));
    mockUseErrors.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);
    expect(screen.getByText('No errors recorded')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('0 VINs with errors')).toBeInTheDocument();
  });
});

// ── Hardening: loading gate, error surfacing, dual-source refresh ────────────

describe('TelemetryErrorsWidget — loading, error & refresh hardening', () => {
  it('treats a load in the SECONDARY error-rows query as loading too (renders the skeleton)', () => {
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN()] }));
    mockUseErrors.mockReturnValue(qr({ isLoading: true }));
    const { container } = renderWidget(STANDARD);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Telemetry Errors')).toBeNull();
  });

  it('surfaces a QueryError (not the misleading empty state) when a load fails with no data', () => {
    mockUseVINs.mockReturnValue(qr({ isError: true, error: new Error('boom'), data: undefined }));
    mockUseErrors.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);
    // The generic (status-less) network branch of QueryError.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // The "healthy-looking" empty copy must NOT be shown on a failure.
    expect(screen.queryByText('No telemetry error data')).toBeNull();
  });

  it('degrades gracefully — keeps showing data on error rather than blanking to a QueryError', () => {
    mockUseVINs.mockReturnValue(qr({ isError: true, data: [makeVIN()] }));
    mockUseErrors.mockReturnValue(qr({ data: [makeError({ error_code: 'STILL_HERE' })] }));
    renderWidget(STANDARD);
    expect(screen.getByText('STILL_HERE')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });

  it('refetches BOTH sources when the accessible refresh control is activated', () => {
    const vinsRefetch = vi.fn();
    const errorsRefetch = vi.fn();
    mockUseVINs.mockReturnValue(qr({ data: [makeVIN()], refetch: vinsRefetch }));
    mockUseErrors.mockReturnValue(qr({ data: [makeError()], refetch: errorsRefetch }));
    renderWidget(STANDARD);

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);

    // BUG FIX: the feed is driven by the errors query, so refresh must refetch
    // it too — previously only the VIN summary was refetched.
    expect(vinsRefetch).toHaveBeenCalledTimes(1);
    expect(errorsRefetch).toHaveBeenCalledTimes(1);
  });
});
