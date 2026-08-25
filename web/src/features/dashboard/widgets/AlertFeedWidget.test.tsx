/**
 * AlertFeedWidget — behaviour + hardening tests.
 *
 * AlertFeedWidget is a dashboard tile that reads the alert feed (`useAlerts`)
 * and projects each alert onto a `WidgetEventFeed` row: a severity icon +
 * colour, a title (null-safe), a subtitle that is size-dependent (the alert
 * message on wide tiles, the severity label otherwise), a relative timestamp,
 * and a drill-through `href` computed by `getAlertDrillthroughHref`. The shell
 * around it (`WidgetShell`) owns the loading / error / freshness affordances.
 *
 * The single data hook is mocked at the `@/api/hooks/useNotifications` boundary
 * so every orchestration branch is exercised deterministically — loading,
 * error, empty, and the populated happy path across the narrow / tall / wide
 * size variants. `react-i18next` is echo-mocked so assertions target the
 * rendered English fallback (with `{{var}}` interpolation); `useSettings` /
 * `useTimezone` come from the global stub in src/test-setup.ts. Network never
 * touches the real backend.
 *
 * Facets covered:
 *   - loading  → skeleton, no title, no rows (never a blank panel).
 *   - error    → QueryError alert, no rows.
 *   - empty    → explicit "No alerts yet" empty state under the real title.
 *   - narrow   → severity-label subtitles + correct drill-through hrefs
 *                (mapped signal → context page; unmapped / un-scoped → the
 *                Signal Explorer fallback with no vehicle_id).
 *   - wide     → message subtitles (labels suppressed), maxItems=12.
 *   - tall     → maxItems=8 (vs 5 on a 1×1 tile).
 *   - severity normalisation ('error' → critical → "Critical").
 *   - null-safety: missing title renders "—"; the wide-tile subtitle falls
 *     back to the severity label when the message is empty (hardening).
 *   - refresh: the header freshness control invokes the query's refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

vi.mock('@/api/hooks/useNotifications', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useNotifications')>();
  return { ...actual, useAlerts: vi.fn() };
});

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshness>) reads it.
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

import AlertFeedWidget from './AlertFeedWidget';
import { useAlerts } from '@/api/hooks/useNotifications';
import type { Alert } from '@/api/types';
import type { WidgetSize } from './types';

const mockAlerts = vi.mocked(useAlerts);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
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

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();

function makeAlert(over: Partial<Alert> = {}): Alert {
  return {
    id: 1,
    vehicle_id: 1,
    type: 'battery_low',
    severity: 'critical',
    title: 'Battery critically low',
    message: 'Pack at 2%',
    is_read: false,
    created_at: iso(60_000),
    rule_signal: 'BatteryLevel',
    ...over,
  };
}

// Three alerts spanning the three canonical severities, a mapped signal, an
// unmapped signal, and an un-scoped (vehicle_id 0) row.
const ALERTS: Alert[] = [
  makeAlert({ id: 1, severity: 'critical', title: 'Battery critically low', message: 'Pack at 2%', rule_signal: 'BatteryLevel', vehicle_id: 1, created_at: iso(60_000) }),
  makeAlert({ id: 2, severity: 'warning', title: 'Tire pressure warning', message: 'Front-left soft', rule_signal: 'TpmsPressureFl', vehicle_id: 2, created_at: iso(120_000) }),
  makeAlert({ id: 3, severity: 'info', title: 'Software update available', message: 'v2025 is ready', rule_signal: 'CustomUnmappedSignal', vehicle_id: 0, created_at: iso(180_000) }),
];

const NARROW: WidgetSize = { cols: 1, rows: 1 };
const TALL: WidgetSize = { cols: 1, rows: 2 };
const WIDE: WidgetSize = { cols: 3, rows: 2 };

function makeMany(n: number): Alert[] {
  return Array.from({ length: n }, (_, i) =>
    makeAlert({ id: i + 1, title: `Alert ${i + 1}`, message: `Message ${i + 1}`, created_at: iso((i + 1) * 60_000) }),
  );
}

function renderWidget(size: WidgetSize) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AlertFeedWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockAlerts.mockReturnValue(qr({ data: ALERTS }));
});

afterEach(() => {
  cleanup();
});

describe('AlertFeedWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) and no rows while loading', () => {
    mockAlerts.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(NARROW);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // Title + rows are suppressed until the shell resolves.
    expect(screen.queryByText('Alert Feed')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders a QueryError alert (not a blank panel) and no rows on failure', () => {
    mockAlerts.mockReturnValue(
      qr({ isError: true, error: new Error('alerts down'), data: undefined }),
    );
    renderWidget(NARROW);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Alert Feed')).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders an explicit empty state under the real title when there are no alerts', () => {
    mockAlerts.mockReturnValue(qr({ data: [] }));
    renderWidget(NARROW);

    expect(screen.getByText('Alert Feed')).toBeInTheDocument();
    expect(screen.getByText('No alerts yet')).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('is resilient when the query resolves to undefined (no data, no error, no loading)', () => {
    mockAlerts.mockReturnValue(qr({ data: undefined }));
    renderWidget(NARROW);

    expect(screen.getByText('Alert Feed')).toBeInTheDocument();
    expect(screen.getByText('No alerts yet')).toBeInTheDocument();
  });
});

describe('AlertFeedWidget — populated narrow tile', () => {
  it('renders one drill-through row per alert with severity-label subtitles', () => {
    renderWidget(NARROW);

    expect(screen.getByText('Battery critically low')).toBeInTheDocument();
    expect(screen.getByText('Tire pressure warning')).toBeInTheDocument();
    expect(screen.getByText('Software update available')).toBeInTheDocument();

    // Subtitle = severity label (narrow tile) — one per canonical severity.
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();

    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('computes drill-through hrefs: mapped signal → context page with vehicle + signal', () => {
    renderWidget(NARROW);

    const battery = screen.getByRole('link', { name: /Battery critically low/ });
    const href = battery.getAttribute('href') ?? '';
    expect(href).toContain('/battery');
    expect(href).toContain('vehicle_id=1');
    expect(href).toContain('signal=BatteryLevel');
  });

  it('falls back to the Signal Explorer (no vehicle_id) for an unmapped, un-scoped alert', () => {
    renderWidget(NARROW);

    const update = screen.getByRole('link', { name: /Software update available/ });
    const href = update.getAttribute('href') ?? '';
    expect(href).toContain('/signal-explorer');
    expect(href).toContain('signal=CustomUnmappedSignal');
    // vehicle_id 0 is treated as "no vehicle" and omitted from the query.
    expect(href).not.toContain('vehicle_id');
  });

  it('normalises legacy severities: an "error" alert is labelled "Critical"', () => {
    mockAlerts.mockReturnValue(
      qr({ data: [makeAlert({ id: 9, severity: 'error', title: 'Fault detected', message: 'Inverter fault' })] }),
    );
    renderWidget(NARROW);

    expect(screen.getByText('Fault detected')).toBeInTheDocument();
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });
});

describe('AlertFeedWidget — wide tile', () => {
  it('shows the alert message as the subtitle and suppresses the severity label', () => {
    renderWidget(WIDE);

    expect(screen.getByText('Pack at 2%')).toBeInTheDocument();
    expect(screen.getByText('Front-left soft')).toBeInTheDocument();
    expect(screen.getByText('v2025 is ready')).toBeInTheDocument();

    // Labels are not used as subtitles on a wide tile.
    expect(screen.queryByText('Critical')).toBeNull();
    expect(screen.queryByText('Warning')).toBeNull();
  });

  it('falls back to the severity label when a wide-tile alert has an empty message', () => {
    mockAlerts.mockReturnValue(
      qr({ data: [makeAlert({ id: 5, severity: 'critical', title: 'Silent alert', message: '' })] }),
    );
    renderWidget(WIDE);

    expect(screen.getByText('Silent alert')).toBeInTheDocument();
    // Pre-hardening the row would have had no subtitle at all.
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });
});

describe('AlertFeedWidget — null-safety & sizing', () => {
  it('renders an em dash when an alert has no title', () => {
    mockAlerts.mockReturnValue(
      qr({ data: [makeAlert({ id: 7, title: undefined as unknown as string })] }),
    );
    renderWidget(NARROW);

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('caps the feed at 5 rows on a 1×1 tile and 8 rows on a taller tile', () => {
    const many = makeMany(9);

    mockAlerts.mockReturnValue(qr({ data: many }));
    const narrow = renderWidget(NARROW);
    expect(narrow.container.querySelectorAll('a')).toHaveLength(5);
    narrow.unmount();

    mockAlerts.mockReturnValue(qr({ data: many }));
    renderWidget(TALL);
    expect(screen.getAllByRole('link')).toHaveLength(8);
  });

  it('caps the feed at 12 rows on a wide tile', () => {
    mockAlerts.mockReturnValue(qr({ data: makeMany(15) }));
    renderWidget(WIDE);

    expect(screen.getAllByRole('link')).toHaveLength(12);
  });
});

describe('AlertFeedWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockAlerts.mockReturnValue(qr({ data: ALERTS, refetch }));
    renderWidget(NARROW);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
