/**
 * VersionInfoWidget — behaviour + hardening tests.
 *
 * VersionInfoWidget renders the deployment/version panel on the dashboard. It
 * pulls `/system/version` (`useVersionInfo`) and the telemetry-capture rollup
 * (`useCaptureStats`), derives a key/value list (version, build date, git SHA,
 * Go version, uptime) plus a stat grid (throughput tiles), and lays all of it
 * inside a `WidgetShell` (freshness + refresh affordance, never a blank panel).
 * The layout adapts to the widget's grid width: a 1-col compact chip, a 2-col
 * standard body, and a 4-col wide body that also surfaces OS/arch + extra tiles.
 *
 * The two data hooks are mocked at their module boundary so orchestration is
 * deterministic; `react-i18next` is echo-mocked (returns the English fallback,
 * interpolating `{{var}}`); `useSettings` / `useTimezone` come from the global
 * stub in src/test-setup.ts. `matchMedia` reports reduced-motion so the
 * freshness chip never spins/ticks and assertions are stable.
 *
 * Facets covered:
 *   - uptime (the fix / regression): the API sends `uptime_seconds` (a number),
 *     NOT a pre-formatted `uptime` string, so the row must render "1d 1h 1m"
 *     (from 90,061s) rather than the previous permanent em dash. The ladder is
 *     exercised at day / hour / minute / zero magnitudes.
 *   - key/value list: version, build date, truncated 7-char git SHA, Go version.
 *   - null-safety: a realistic payload that omits build_date/git_commit/
 *     uptime_seconds degrades those rows to "—" (never `undefined`/crash).
 *   - stat grid: throughput tiles render at standard width; the byte + latency
 *     tiles appear only in the wide layout, alongside the OS/arch line.
 *   - compact layout: a 1-col widget collapses to a version + SHA chip.
 *   - shell states: loading → skeleton, error → QueryError, empty → EmptyState
 *     (all "never a blank panel"), and the refresh control retries the query.
 *   - capture resilience: an undefined capture payload still paints every tile
 *     with placeholder zeros.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two data hooks are mocked so the widget's inputs are deterministic while
// every other export from the module stays real.
vi.mock('@/api/hooks/useSettings', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useSettings')>();
  return { ...actual, useVersionInfo: vi.fn(), useCaptureStats: vi.fn() };
});

// jsdom lacks matchMedia. Report reduced-motion so the freshness chip renders
// its static (non-spinning, non-ticking) form and stays inspectable.
window.matchMedia = ((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import VersionInfoWidget from './VersionInfoWidget';
import { useVersionInfo, useCaptureStats } from '@/api/hooks/useSettings';
import type { WidgetSize } from './types';

const mockVersion = vi.mocked(useVersionInfo);
const mockCapture = vi.mocked(useCaptureStats);

const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const WIDE: WidgetSize = { cols: 4, rows: 2 };

/** Minimal `UseQueryResult` stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

/** A realistic `/system/version` payload (snake_case, matching the Go tags). */
function makeVersion(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app_version: '2.5.0',
    chart_version: '1.4.2',
    go_version: 'go1.25.0',
    os: 'linux',
    arch: 'amd64',
    build_date: '2025-01-15',
    git_commit: 'abcdef1234567890',
    uptime_seconds: 90_061, // 1d 1h 1m 1s
    goroutines: 142,
    ...over,
  };
}

/** A capture-stats payload feeding the throughput tiles. */
function makeCapture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signals_per_sec: 12.5,
    messages_today: 34_567,
    bytes_processed: 1_572_864, // 1.5 MiB
    avg_processing_latency_ms: 3.4,
    ...over,
  };
}

function renderWidget(size: WidgetSize) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VersionInfoWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Read the `<dd>` value paired with a KVList `<dt>` label. */
function kvValue(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.parentElement?.querySelector('dd');
  return dd?.textContent?.trim() ?? '';
}

/** Read the big value of a StatCard identified by its label text. */
function statValue(label: string): string {
  const labelEl = screen.getByText(label);
  const card = labelEl.parentElement?.parentElement;
  return card?.querySelector('.text-2xl')?.textContent?.trim() ?? '';
}

beforeEach(() => {
  mockVersion.mockReturnValue(qr({ data: makeVersion() }));
  mockCapture.mockReturnValue(qr({ data: makeCapture() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VersionInfoWidget — key/value list & uptime fix (regression)', () => {
  it('renders every version row, surfacing uptime from uptime_seconds (not the missing uptime string)', () => {
    renderWidget(STANDARD);

    expect(kvValue('Version')).toBe('1.4.2');
    expect(kvValue('Build Date')).toBe('2025-01-15');
    expect(kvValue('Go Version')).toBe('go1.25.0');
    // The bug: reading a non-existent `uptime` string always rendered "—".
    // The fix formats the real `uptime_seconds` (90,061s) into the ladder.
    expect(kvValue('Uptime')).toBe('1d 1h 1m');
    expect(kvValue('Uptime')).not.toBe('—');
  });

  it('truncates the git commit to a 7-char SHA', () => {
    renderWidget(STANDARD);

    expect(kvValue('Git SHA')).toBe('abcdef1');
    expect(kvValue('Git SHA')).toHaveLength(7);
  });
});

describe('VersionInfoWidget — uptime ladder', () => {
  it('formats a sub-day uptime as hours + minutes', () => {
    mockVersion.mockReturnValue(qr({ data: makeVersion({ uptime_seconds: 7_325 }) }));
    renderWidget(STANDARD);
    expect(kvValue('Uptime')).toBe('2h 2m');
  });

  it('formats a sub-hour uptime as minutes only', () => {
    mockVersion.mockReturnValue(qr({ data: makeVersion({ uptime_seconds: 300 }) }));
    renderWidget(STANDARD);
    expect(kvValue('Uptime')).toBe('5m');
  });

  it('renders an em dash for a zero / freshly-booted uptime', () => {
    mockVersion.mockReturnValue(qr({ data: makeVersion({ uptime_seconds: 0 }) }));
    renderWidget(STANDARD);
    expect(kvValue('Uptime')).toBe('—');
  });
});

describe('VersionInfoWidget — null-safety on a realistic payload', () => {
  it('degrades build date, git SHA, and uptime to em dashes when the API omits them', () => {
    // The live `/system/version` response has no build_date / git_commit and
    // reports uptime via uptime_seconds only — omitting all three here proves
    // the defensive `?? '—'` / `formatUptime(0)` fallbacks never leak undefined.
    mockVersion.mockReturnValue(
      qr({ data: { chart_version: '9.9.9', go_version: 'go1.25.1', os: 'darwin', arch: 'arm64' } }),
    );
    renderWidget(STANDARD);

    expect(kvValue('Version')).toBe('9.9.9');
    expect(kvValue('Build Date')).toBe('—');
    expect(kvValue('Git SHA')).toBe('—');
    expect(kvValue('Uptime')).toBe('—');
  });
});

describe('VersionInfoWidget — stat grid', () => {
  it('renders the two throughput tiles at standard width and hides the wide-only tiles', () => {
    renderWidget(STANDARD);

    expect(statValue('Signals/sec')).toBe('12.5');
    expect(statValue('Messages Today')).toBe('34,567');
    // Byte + latency tiles are wide-layout only.
    expect(screen.queryByText('Bytes Processed')).toBeNull();
    expect(screen.queryByText('Avg Latency')).toBeNull();
  });

  it('adds the OS/arch line and byte + latency tiles in the wide layout', () => {
    renderWidget(WIDE);

    expect(screen.getByText('OS: linux')).toBeInTheDocument();
    expect(screen.getByText('Arch: amd64')).toBeInTheDocument();
    expect(statValue('Bytes Processed')).toBe('1.5 MB');
    expect(statValue('Avg Latency')).toBe('3.4 ms');
  });

  it('paints every tile with placeholder zeros when the capture payload is undefined', () => {
    mockCapture.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);

    // Never a blank panel — the tiles degrade to zero, not to nothing.
    expect(screen.getByText('Signals/sec')).toBeInTheDocument();
    expect(statValue('Signals/sec')).toBe('0.0');
    expect(statValue('Messages Today')).toBe('0');
  });
});

describe('VersionInfoWidget — compact layout', () => {
  it('collapses to a version + SHA chip without the key/value list', () => {
    mockVersion.mockReturnValue(
      qr({ data: makeVersion({ chart_version: '3.3.3', git_commit: 'deadbeefcafe' }) }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('3.3.3')).toBeInTheDocument();
    expect(screen.getByText('deadbee')).toBeInTheDocument();
    // The full KV list is not rendered in the compact chip.
    expect(screen.queryByText('Go Version')).toBeNull();
    expect(screen.queryByText('Signals/sec')).toBeNull();
  });
});

describe('VersionInfoWidget — shell states', () => {
  it('renders a skeleton (no content) while the version query is loading', () => {
    mockVersion.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Go Version')).toBeNull();
  });

  it('surfaces a QueryError instead of the panel when the version query fails', () => {
    mockVersion.mockReturnValue(
      qr({ isError: true, error: new Error('boom'), data: undefined }),
    );
    renderWidget(STANDARD);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Go Version')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when there is no version data', () => {
    mockVersion.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);

    const status = screen.getByRole('status');
    expect(within(status).getByText('No version data available')).toBeInTheDocument();
    expect(screen.queryByText('Go Version')).toBeNull();
  });

  it('retries the version query when the refresh control is activated', () => {
    const refetch = vi.fn();
    mockVersion.mockReturnValue(qr({ data: makeVersion(), refetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
