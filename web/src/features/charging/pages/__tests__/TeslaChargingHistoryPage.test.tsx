/**
 * TeslaChargingHistoryPage — pure-helper, behaviour, branch, and a11y coverage.
 *
 * The page is the "Tesla Charging History" billing surface. It fans a single
 * `useTeslaChargingHistory(vin)` feed into:
 *
 *   1. A six-tile KPI band. Three tiles read the server `summary` (all-time
 *      sessions / SI-Wh→kWh energy / undenominated spend / avg cost-per-kWh); two are
 *      derived client-side from the entry list (total duration, distinct sites).
 *   2. A monthly-spending bar chart + a top-locations MetricBar panel, both
 *      derived from the range-filtered entries.
 *   3. A searchable, sortable, virtualized sessions table with bulk CSV export.
 *
 * Strategy mirrors ChargingHeatmapPage's test: render the REAL page + REAL shared
 * subtree (PageLayout, StatStrip, MetricBar, QueryError, charts). Only the
 * network `request` helper and i18n are mocked — the range state and the
 * settings-driven unit/format/currency hooks all run for real so the SI → display
 * conversion is genuinely exercised.
 *
 * The four exported pure helpers (durationMinutes, formatDurationMinutes,
 * buildMonthlySpending, buildTopLocations) are additionally unit-tested directly
 * for their branch/edge behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import type { AppSettings } from '@/api/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

// jsdom lacks matchMedia; framer-motion (via <FadeIn>, <MetricBar>, the
// ToastProvider, and the PageContainer freshness chip) reads it at module load.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

// Replace only `request`; keep the real isApiError/ApiError so <QueryError>
// classifies an injected ApiError(500) into its "Server error" branch.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockRequest };
});

// i18n → developer fallback with {{var}} interpolation so assertions read real
// sentences rather than raw keys.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// The global setup stubs useSettings to en-US/UTC defaults, which ignores the
// per-test /settings payload this suite installs. Restore the real hook (a
// file-level vi.mock wins over the setupFiles registration) so saved
// locale/tz/precision preferences genuinely drive formatting.
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>(
    '@/hooks/useSettings',
  );
  return { ...actual };
});

import TeslaChargingHistoryPage, {
  durationMinutes,
  formatDurationMinutes,
  buildMonthlySpending,
  buildTopLocations,
} from '../TeslaChargingHistoryPage';
import type { TeslaChargingHistoryEntry } from '@/api/hooks/useCharging';
import { ToastProvider } from '@/components/feedback/Toast';
import { ApiError } from '@/lib/resilience';
import { OperationalModeProvider } from '@/hooks/useOperationalMode';

// ── Fixtures ────────────────────────────────────────────────────────────────
const VEHICLES = [
  { id: 1, vehicle_id: 1, vin: '5YJ3E1EA1KF000001', display_name: 'Model 3', state: 'online' },
  { id: 2, vehicle_id: 2, vin: '5YJYGDEE5MF000002', display_name: 'Model Y', state: 'asleep' },
];

interface EntryOverrides {
  id: number;
  session_id: number;
  site_location_name?: string;
  charge_start_datetime?: string;
  charge_stop_datetime?: string | null;
  usage_wh?: number | null;
  total_due?: number | null;
  currency_code?: string | null;
  has_invoice?: boolean;
  invoice_content_id?: string | null;
  fetched_at?: string;
}
function entry(o: EntryOverrides): TeslaChargingHistoryEntry {
  return {
    id: o.id,
    session_id: o.session_id,
    vin: '5YJ3E1EA1KF000001',
    site_location_name: o.site_location_name ?? 'Supercharger - Fremont',
    charge_start_datetime: o.charge_start_datetime ?? '2024-01-15T10:00:00Z',
    charge_stop_datetime: o.charge_stop_datetime === undefined ? '2024-01-15T11:00:00Z' : o.charge_stop_datetime,
    country: 'US',
    state: 'CA',
    county: null,
    postal_code: null,
    billing_type: null,
    fee_type: null,
    currency_code: o.currency_code === undefined ? 'USD' : o.currency_code,
    pricing_type: 'kWh',
    rate_base: 0.42,
    usage_wh: o.usage_wh === undefined ? 50000 : o.usage_wh,
    total_due: o.total_due === undefined ? 12.5 : o.total_due,
    has_invoice: o.has_invoice ?? false,
    invoice_content_id: o.invoice_content_id ?? null,
    fetched_at: o.fetched_at ?? '2024-01-16T00:00:00Z',
    created_at: '2024-01-16T00:00:00Z',
  };
}

// Fremont ×2 (12.5 + 7.5 = $20, 2 sessions), Gilroy ×1 ($10, live/no-stop).
// Recorded durations: 60m + 30m = 90m; the open session remains unknown.
const ENTRIES: TeslaChargingHistoryEntry[] = [
  entry({
    id: 1, session_id: 1001, site_location_name: 'Supercharger - Fremont',
    charge_start_datetime: '2024-01-15T10:00:00Z', charge_stop_datetime: '2024-01-15T11:00:00Z',
    usage_wh: 50000, total_due: 12.5, has_invoice: true, invoice_content_id: 'inv-1',
  }),
  entry({
    id: 2, session_id: 1002, site_location_name: 'Supercharger - Fremont',
    charge_start_datetime: '2024-01-20T09:00:00Z', charge_stop_datetime: '2024-01-20T09:30:00Z',
    usage_wh: 25000, total_due: 7.5,
  }),
  entry({
    id: 3, session_id: 1003, site_location_name: 'Supercharger - Gilroy',
    charge_start_datetime: '2024-02-10T14:00:00Z', charge_stop_datetime: null,
    usage_wh: 40000, total_due: 10,
  }),
];

const SUMMARY = { total_sessions: 3, total_wh: 115000, total_spend: 30, avg_cost_per_kwh: 0.26 };
const RESPONSE = { entries: ENTRIES, summary: SUMMARY };

type FeedMode = 'resolve' | 'pending' | 'reject';
interface InstallOpts {
  settings?: Partial<AppSettings>;
  vehicles?: unknown[];
  response?: unknown;
  feedMode?: FeedMode;
  feedError?: unknown;
}
function installRequest({
  settings = {},
  vehicles = VEHICLES,
  response = RESPONSE,
  feedMode = 'resolve',
  feedError,
}: InstallOpts = {}) {
  mockRequest.mockImplementation((url: unknown) => {
    const u = String(url);
    // Refresh is a POST that starts with the same prefix — match it FIRST.
    if (u.startsWith('/tesla/charging/history/refresh')) return Promise.resolve(RESPONSE);
    if (u.startsWith('/tesla/charging/history')) {
      if (feedMode === 'pending') return new Promise(() => {});
      if (feedMode === 'reject') return Promise.reject(feedError ?? new Error('boom'));
      return Promise.resolve(response);
    }
    if (u.startsWith('/vehicles')) return Promise.resolve(vehicles);
    if (u.startsWith('/settings')) return Promise.resolve(settings);
    return Promise.resolve({});
  });
}

function historyCalls(): string[] {
  return mockRequest.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith('/tesla/charging/history') && !u.includes('/refresh'));
}
function refreshCalls(): string[] {
  return mockRequest.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/tesla/charging/history/refresh'));
}

function renderPage(route = '/charging/tesla-history') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const mounted = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <OperationalModeProvider>
            <TeslaChargingHistoryPage />
          </OperationalModeProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...mounted, client };
}

function kpiValue(label: string): string {
  const card = screen.getByText(label).closest('[data-operational-metric]');
  expect(card).not.toBeNull();
  const value = card!.querySelector('[data-operational-value]');
  expect(value).not.toBeNull();
  return value!.textContent ?? '';
}
function waitForSummary() {
  return waitFor(() => expect(
    screen.getByText('Total sessions').closest('[data-operational-metric]')?.querySelector('[data-operational-value]'),
  ).not.toBeNull());
}

beforeEach(() => {
  mockRequest.mockReset();
  window.localStorage.clear();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.dispatchEvent(new Event('online'));
});

// ── Pure helpers ─────────────────────────────────────────────────────────────
describe('Tesla history operational mode', () => {
  it.each([
    ['as_of', 'Return to live mode before making operational changes.'],
    ['cached', 'Reconnect before making operational changes.'],
  ] as const)('keeps populated billing data while disabling manual sync in %s', async (mode, reason) => {
    installRequest();
    if (mode === 'cached') {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      window.dispatchEvent(new Event('offline'));
    }
    renderPage(mode === 'as_of'
      ? '/charging/tesla-history?as_of=2026-10-01T00:00:00Z'
      : '/charging/tesla-history');
    await waitForSummary();
    const button = screen.getByRole('button', { name: 'Refresh from Tesla' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', reason);
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByText('Operational changes are read-only')).toBeInTheDocument();
    expect(kpiValue('Total sessions')).not.toBe('—');
    fireEvent.click(button);
    expect(refreshCalls()).toHaveLength(0);
  });
});

describe('durationMinutes', () => {
  it('preserves fractional elapsed minutes and a recorded zero gap', () => {
    expect(durationMinutes('2024-01-01T10:00:00Z', '2024-01-01T12:00:00Z')).toBe(120);
    // 2m40s retains its fractional minutes for aggregation.
    expect(durationMinutes('2024-01-01T10:00:00Z', '2024-01-01T10:02:40Z')).toBeCloseTo(8 / 3);
    expect(durationMinutes('2024-01-01T10:00:00Z', '2024-01-01T10:00:00Z')).toBe(0);
  });

  it('returns null for a missing stop, a negative gap, or unparseable dates', () => {
    expect(durationMinutes('2024-01-01T10:00:00Z', null)).toBeNull();
    expect(durationMinutes('2024-01-01T12:00:00Z', '2024-01-01T10:00:00Z')).toBeNull();
    expect(durationMinutes('not-a-date', 'also-not-a-date')).toBeNull();
  });
});

describe('formatDurationMinutes', () => {
  it('localizes numbers without losing fractional minutes or the zero minute remainder', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(0);
    expect(formatDurationMinutes(2 + 2 / 3)).toBe('2,67m');
    expect(formatDurationMinutes(65.125)).toBe('1h 5,13m');
    expect(formatDurationMinutes(65.1)).toBe('1h 5,1m');
    expect(formatDurationMinutes(60)).toBe('1h 0m');
    expect(formatDurationMinutes(59.999)).toBe('60m');
    expect(formatDurationMinutes(-1)).toBe('—');
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
  });

  it('formats sub-hour and multi-hour durations distinctly', () => {
    expect(formatDurationMinutes(0)).toBe('0m');
    expect(formatDurationMinutes(45)).toBe('45m');
    expect(formatDurationMinutes(60)).toBe('1h 0m');
    expect(formatDurationMinutes(125)).toBe('2h 5m');
  });

  it('degrades null and non-finite input to the em-dash placeholder', () => {
    expect(formatDurationMinutes(null)).toBe('—');
    expect(formatDurationMinutes(Number.NaN)).toBe('—');
    expect(formatDurationMinutes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('buildMonthlySpending', () => {
  it('keeps currency and unknown-denomination evidence separate without FX or symbol inference', () => {
    const rows = [
      entry({ id: 1, session_id: 1, currency_code: 'USD', total_due: -2.25 }),
      entry({ id: 2, session_id: 2, currency_code: 'EUR', total_due: 0.5 }),
      entry({ id: 3, session_id: 3, currency_code: null, total_due: 0 }),
      entry({ id: 4, session_id: 4, currency_code: '', total_due: null }),
      entry({ id: 5, session_id: 5, currency_code: '$', total_due: -0.125 }),
      entry({ id: 6, session_id: 6, currency_code: 'not-a-code', total_due: 1.125 }),
      entry({ id: 7, session_id: 7, currency_code: 'EUR', total_due: Infinity }),
    ];
    const monthly = buildMonthlySpending(rows);
    expect(monthly).toHaveLength(5);
    expect(monthly.find(bucket => bucket.currency === 'USD')).toMatchObject({ total: -2.25, count: 1 });
    expect(monthly.find(bucket => bucket.currency === 'EUR')).toMatchObject({
      total: null, recordedTotal: 0.5, missingCount: 1, count: 2,
    });
    expect(monthly.find(bucket => bucket.currency === null)).toMatchObject({
      total: null, recordedTotal: 0, missingCount: 1, count: 2,
    });
    expect(monthly.find(bucket => bucket.currency === '$')).toMatchObject({ total: -0.125 });
    expect(monthly.find(bucket => bucket.currency === 'not-a-code')).toMatchObject({ total: 1.125 });
    const locations = buildTopLocations(rows);
    expect(locations).toHaveLength(5);
    expect(locations.reduce((count, bucket) => count + bucket.count, 0)).toBe(rows.length);
    expect(locations.find(bucket => bucket.currency === 'EUR')).toMatchObject({
      total: null, recordedTotal: 0.5, missingCount: 1, count: 2,
    });
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, '', '12', false])(
    'does not invent a monthly total for absent or invalid amount %s',
    value => {
      const row = Object.assign(entry({ id: 1, session_id: 1 }), { total_due: value });
      expect(buildMonthlySpending([row])).toEqual([
        { month: '2024-01', currency: 'USD', count: 1, total: null, recordedTotal: null, missingCount: 1 },
      ]);
      expect(buildTopLocations([Object.assign(row, { usage_wh: value })])[0]).toMatchObject({
        total: null, recordedTotal: null, missingCount: 1,
        energyWh: null, recordedEnergyWh: null, missingEnergyCount: 1,
      });
    },
  );

  it('preserves measured zero, signed credits, and fractional values', () => {
    const rows = [0, -2.25, 0.5].map((value, id) =>
      entry({ id, session_id: id, total_due: value, usage_wh: value }),
    );
    expect(buildMonthlySpending(rows)[0]).toMatchObject({
      total: -1.75, recordedTotal: -1.75, missingCount: 0,
    });
    expect(buildTopLocations(rows)[0]).toMatchObject({
      total: -1.75, energyWh: -1.75, missingCount: 0, missingEnergyCount: 0,
    });
    expect(buildMonthlySpending([rows[0]])[0].total).toBe(0);
    expect(buildTopLocations([rows[0]])[0].energyWh).toBe(0);
  });

  it('ranks unknown sites after recorded signed subtotals and preserves partial energy', () => {
    const rows = buildTopLocations([
      entry({ id: 1, session_id: 1, site_location_name: 'Unknown', total_due: null, usage_wh: null }),
      entry({ id: 2, session_id: 2, site_location_name: 'Credit', total_due: -1.25, usage_wh: 0 }),
      entry({ id: 3, session_id: 3, site_location_name: 'Credit', total_due: null, usage_wh: NaN }),
    ]);
    expect(rows.map(row => row.name)).toEqual(['Credit', 'Unknown']);
    expect(rows[0]).toMatchObject({
      total: null, recordedTotal: -1.25, missingCount: 1,
      energyWh: null, recordedEnergyWh: 0, missingEnergyCount: 1,
    });
  });

  it('returns an empty array for no entries', () => {
    expect(buildMonthlySpending([])).toEqual([]);
  });

  it('keeps partial monthly totals unknown and exposes recorded subtotals', () => {
    const rows = buildMonthlySpending([
      entry({ id: 1, session_id: 1, charge_start_datetime: '2024-02-10T00:00:00Z', total_due: 10 }),
      entry({ id: 2, session_id: 2, charge_start_datetime: '2024-01-05T00:00:00Z', total_due: 12.5 }),
      entry({ id: 3, session_id: 3, charge_start_datetime: '2024-01-25T00:00:00Z', total_due: 7.5 }),
      entry({ id: 4, session_id: 4, charge_start_datetime: '2024-01-28T00:00:00Z', total_due: null }),
    ]);
    expect(rows).toEqual([
      { month: '2024-01', currency: 'USD', count: 3, total: null, recordedTotal: 20, missingCount: 1 },
      { month: '2024-02', currency: 'USD', count: 1, total: 10, recordedTotal: 10, missingCount: 0 },
    ]);
  });

  it('skips rows with an unparseable start date instead of emitting a NaN-NaN bucket', () => {
    const rows = buildMonthlySpending([
      entry({ id: 1, session_id: 1, charge_start_datetime: '2024-03-15T12:00:00Z', total_due: 5 }),
      entry({ id: 2, session_id: 2, charge_start_datetime: 'garbage', total_due: 99 }),
    ]);
    expect(rows).toEqual([{ month: '2024-03', currency: 'USD', count: 1, total: 5, recordedTotal: 5, missingCount: 0 }]);
    expect(rows.some((r) => r.month.includes('NaN'))).toBe(false);
  });
});

describe('buildTopLocations', () => {
  it('rolls up spend, energy, and count per site and ranks by spend descending', () => {
    const rows = buildTopLocations([
      entry({ id: 1, session_id: 1, site_location_name: 'Gilroy', total_due: 4, usage_wh: 1000 }),
      entry({ id: 2, session_id: 2, site_location_name: 'Fremont', total_due: 12, usage_wh: 5000 }),
      entry({ id: 3, session_id: 3, site_location_name: 'Fremont', total_due: 8, usage_wh: 3000 }),
    ]);
    expect(rows).toEqual([
      { name: 'Fremont', currency: 'USD', total: 20, recordedTotal: 20, missingCount: 0, energyWh: 8000, recordedEnergyWh: 8000, missingEnergyCount: 0, count: 2 },
      { name: 'Gilroy', currency: 'USD', total: 4, recordedTotal: 4, missingCount: 0, energyWh: 1000, recordedEnergyWh: 1000, missingEnergyCount: 0, count: 1 },
    ]);
  });

  it('labels a missing site name as an em-dash and retains every site', () => {
    const withNullName = buildTopLocations([
      entry({ id: 1, session_id: 1, site_location_name: '', total_due: 3, usage_wh: 100 }),
    ]);
    expect(withNullName[0].name).toBe('—');

    const many = Array.from({ length: 9 }, (_, i) =>
      entry({ id: i, session_id: i, site_location_name: `Site ${i}`, total_due: i + 1, usage_wh: 100 }),
    );
    const capped = buildTopLocations(many);
    expect(capped).toHaveLength(9);
    // Highest spend (Site 8, $9) ranks first.
    expect(capped[0].name).toBe('Site 8');
  });
});

// ── Component — happy path ───────────────────────────────────────────────────
describe('TeslaChargingHistoryPage — happy path', () => {
  it('updates desktop dates and filter labels when saved preferences change', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1024);
    const invoice = entry({ id: 1, session_id: 1, charge_start_datetime: '2024-02-01T00:30:00Z' });
    const settings: Partial<AppSettings> = {
      locale: 'de-DE', tz_display_default: 'user', timezone_user: 'America/Los_Angeles',
    };
    installRequest({ settings, response: { ...RESPONSE, entries: [invoice] } });
    const { client } = renderPage();
    const initial = formatDateTime(invoice.charge_start_datetime, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    const dateCell = await screen.findByText(initial);
    fireEvent.click(screen.getByRole('button', { name: 'Date filter' }));
    expect(screen.getByRole('checkbox', { name: initial })).toBeChecked();
    act(() => client.setQueryData(['settings'], { ...settings, locale: 'ja-JP', timezone_user: 'Asia/Tokyo' }));
    const updated = formatDateTime(invoice.charge_start_datetime, { locale: 'ja-JP', tz: 'Asia/Tokyo' });
    await waitFor(() => expect(dateCell).toHaveTextContent(updated));
    expect(screen.getByRole('checkbox', { name: updated })).toBeChecked();
    const browserDate = new Date(invoice.charge_start_datetime);
    const month = `${browserDate.getFullYear()}-${String(browserDate.getMonth() + 1).padStart(2, '0')}`;
    expect(buildMonthlySpending([invoice])[0].month).toBe(month);
    expect(invoice.charge_start_datetime).toBe('2024-02-01T00:30:00Z');
  });

  it('keeps invalid and missing start dates out of the range-scoped view', async () => {
    const invalid = entry({ id: 2, session_id: 2, charge_start_datetime: 'garbage', site_location_name: 'Invalid date site' });
    const missing = entry({ id: 3, session_id: 3, charge_start_datetime: '', site_location_name: 'Missing date site' });
    installRequest({ settings: { locale: 'de-DE', tz_display_default: 'user', timezone_user: 'Asia/Tokyo' },
      response: { ...RESPONSE, entries: [ENTRIES[0], invalid, missing] } });
    renderPage();
    await screen.findByText('Last synced:', { exact: false });
    expect(screen.queryByRole('progressbar', { name: 'Invalid date site' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Missing date site' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date|NaN-NaN/)).not.toBeInTheDocument();
    expect(kpiValue('Total sessions')).toBe('3');
  });

  it('updates billing precision and locale while mounted without changing canonical amounts', async () => {
    // jsdom has no layout; expose a viewport so the real virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1024);
    const invoice = entry({
      id: 1,
      session_id: 1,
      site_location_name: 'Precision billing fixture',
      total_due: 1234.5678,
      currency_code: 'EUR',
    });
    installRequest({ response: { ...RESPONSE, entries: [invoice] } });
    renderPage();
    const value = await screen.findByText('€1,234.57');
    const row = value.closest('tr, [role="row"]');
    expect(row).not.toBeNull();
    const billing = within(row as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Cost filter' }));
    expect(screen.getByRole('checkbox', { name: '€1,234.57' })).toBeChecked();
    act(() => setGlobalPrecision(4));
    expect(billing.getByText('€1,234.5678')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '€1,234.5678' })).toBeChecked();
    act(() => setGlobalLocale('de-DE'));
    expect(billing.getByText('1.234,5678 €')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '1.234,5678\u00a0€' })).toBeChecked();
    expect(row).toBeInTheDocument();
    expect(invoice.total_due).toBe(1234.5678);
    expect(invoice.usage_wh).toBe(50000);
  });
  it('renders the page shell, every section, and all panel headings', async () => {
    installRequest();
    const { container } = renderPage();
    await waitForSummary();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tesla charging history' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Supercharger & DC fast charging billing records from Tesla'),
    ).toBeInTheDocument();

    // KPI region + the three data panels all mount (none gated away).
    const summary = container.querySelector('#tesla-charging-history-summary');
    expect(summary).toBeInstanceOf(HTMLElement);
    if (!(summary instanceof HTMLElement)) throw new Error('Charging summary container is missing');
    expect(
      within(summary).getByRole('region', { name: 'Charging summary metrics' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Monthly spending')).toBeInTheDocument();
    expect(screen.getByText('Top locations')).toBeInTheDocument();
    // The sessions table renders an sr-only caption with the same name, so
    // pin the visible panel heading by role.
    expect(screen.getByRole('heading', { name: 'Charging sessions' })).toBeInTheDocument();
  });

  it('fills the wide-screen space below spending with sessions alongside Price Radar', async () => {
    installRequest();
    renderPage();
    await screen.findByText('Charging sessions');

    const spending = screen.getByText('Monthly spending').closest('[class*="2xl:col-span-2"]');
    const sessions = screen.getByText('Charging sessions').closest('[class*="2xl:col-span-2"]');
    const locations = screen.getByText('Top locations').closest('[class*="2xl:col-start-3"]');
    expect(spending).toHaveClass('2xl:col-span-2');
    expect(sessions).toHaveClass('2xl:row-start-2');
    expect(locations).toHaveClass('2xl:row-start-1');
    expect(spending?.parentElement).toBe(sessions?.parentElement);
    expect(sessions?.parentElement).toBe(locations?.parentElement);
  });

  it('derives the KPI band from the server summary + entry list', async () => {
    installRequest();
    renderPage();
    await waitForSummary();

    expect(kpiValue('Total sessions')).toBe('3');
    expect(kpiValue('Total energy')).toMatch(/^115(?:\.0+)?\s*kWh$/);
    expect(kpiValue('Total spend')).toBe('30.00 · —');
    expect(kpiValue('Avg cost/kWh')).toBe('0.26 · —');
    // Total Duration + Sites Visited are derived client-side from the entries.
    expect(kpiValue('Sites visited')).toBe('2');
    // Duration is unknown (one session is still open), so the brief face
    // omits the metric entirely instead of showing a dash; the Review
    // details drawer counts it as hidden rather than measured zero.
    expect(screen.queryByText('Total duration')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Charging summary metrics details' });
    expect(within(details).getByText('1 empty fields are hidden.')).toBeInTheDocument();
  });

  it('renders the top-locations panel ranked by spend with formatted currency + counts', async () => {
    installRequest();
    renderPage();
    await waitForSummary();

    expect(screen.getByText('Supercharger - Fremont')).toBeInTheDocument();
    expect(screen.getByText('Supercharger - Gilroy')).toBeInTheDocument();
    // MetricBar sublabel: "<currency> · <count>×".
    expect(screen.getByText('$20.00 · 2×')).toBeInTheDocument();
    expect(screen.getByText('$10.00 · 1×')).toBeInTheDocument();
  });

  it('shows the monthly-spending chart (not its empty state) when data exists', async () => {
    installRequest();
    renderPage();
    await waitForSummary();

    expect(
      screen.getByRole('img', { name: 'Monthly Tesla charging spending bar chart' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No spending data yet. Click "Refresh from Tesla" to sync.'),
    ).toBeNull();
  });
});

// ── Component — loading / error / empty branches ────────────────────────────
describe('TeslaChargingHistoryPage — loading / error / empty branches', () => {
  it('promotes a valid VIN bookmark without requesting the default vehicle or fleet', async () => {
    installRequest();
    renderPage(`/charging/tesla-history?vin=${VEHICLES[1].vin}`);
    await waitFor(() => expect(historyCalls()).toContain(`/tesla/charging/history?vin=${VEHICLES[1].vin}`));
    expect(historyCalls().every(url => url.includes(`vin=${VEHICLES[1].vin}`))).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toHaveValue(VEHICLES[1].vin);
  });

  it('retains an unmatched VIN bookmark without broadening billing or enabling sync', async () => {
    installRequest();
    renderPage('/charging/tesla-history?vin=UNMATCHED_BOOKMARK');
    await waitFor(() => expect(screen.queryByText('Loading')).not.toBeInTheDocument());
    expect(historyCalls()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeDisabled();
    expect(screen.queryByText('No charging sessions yet')).not.toBeInTheDocument();
  });

  it('honors explicit fleet mode while the vehicle list is still loading', async () => {
    installRequest();
    const transport = mockRequest.getMockImplementation();
    mockRequest.mockImplementation((url: unknown) => String(url).startsWith('/vehicles')
      ? new Promise(() => {}) : transport?.(url));
    renderPage('/charging/tesla-history?vin=*');
    await waitFor(() => expect(historyCalls()).toContain('/tesla/charging/history'));
    expect(historyCalls().every(url => !url.includes('vin='))).toBe(true);
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeEnabled();
  });

  it('retains lifetime metrics, billing rows, search and independent panels when a background refresh fails', async () => {
    installRequest();
    const { client } = renderPage();
    await waitForSummary();
    const search = screen.getByPlaceholderText('Search by location…');
    fireEvent.change(search, { target: { value: 'Fremont' } });
    installRequest({ feedMode: 'reject', feedError: new ApiError('refresh failed', 500) });
    await act(async () => {
      await client.refetchQueries({ queryKey: ['tesla-charging-history'] });
    });
    const warning = await screen.findByTestId('stale-refresh-warning');
    expect(warning).toBeInTheDocument();
    expect(warning.closest('button')).toBeNull();
    expect(kpiValue('Total sessions')).toBe('3');
    expect(kpiValue('Total spend')).toBe('30.00 · —');
    expect(screen.getByPlaceholderText('Search by location…')).toHaveValue('Fremont');
    expect(screen.getByText('Monthly spending')).toBeInTheDocument();
    expect(screen.getByText('Top locations')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Charging sessions' })).toBeInTheDocument();
    expect(screen.queryAllByText('Server error')).toHaveLength(0);
  });
  it('shows skeletons (never blank panels) while the first feed is in flight', async () => {
    installRequest({ feedMode: 'pending' });
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThan(0),
    );
    // Panel chrome stays mounted — only the bodies are skeletons.
    expect(screen.getByText('Monthly spending')).toBeInTheDocument();
    expect(screen.getByText('Charging sessions')).toBeInTheDocument();
    // Every metric identity stays mounted while its value is loading.
    const metric = screen.getByText('Total sessions').closest('[data-operational-metric]');
    expect(metric?.closest('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(metric?.querySelector('[data-operational-value]')).toBeNull();
  });

  it('renders per-section QueryError with a Retry that refetches the feed', async () => {
    installRequest({ feedMode: 'reject', feedError: new ApiError('kaboom', 500) });
    renderPage();

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText('Server error').length).toBeGreaterThan(0);

    const before = historyCalls().length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => expect(historyCalls().length).toBeGreaterThan(before));
  });

  it('shows empty states (not blank) in every panel when there is no history', async () => {
    installRequest({
      response: {
        entries: [],
        summary: { total_sessions: 0, total_wh: null, total_spend: null, avg_cost_per_kwh: null },
      },
    });
    renderPage();
    await waitForSummary();

    expect(screen.getAllByText('No charging sessions yet')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Charging sessions' })).toBeInTheDocument();
    // Each of the three empty panels offers the fleet-scope recovery.
    expect(screen.getAllByRole('button', { name: 'All vehicles' })).toHaveLength(3);
    expect(refreshCalls()).toHaveLength(0);
    // KPIs still render guarded zeros, never NaN; unknown metrics are
    // omitted from the face and counted as hidden in the drawer.
    expect(kpiValue('Total sessions')).toBe('0');
    expect(screen.queryByText('Total energy')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Charging summary metrics details' });
    expect(within(details).getByText('4 empty fields are hidden.')).toBeInTheDocument();
    fireEvent.click(within(details).getByText('Close'));
    fireEvent.click(screen.getAllByRole('button', { name: 'All vehicles' })[0]);
    await waitFor(() => expect(historyCalls()).toContain('/tesla/charging/history'));
    expect(refreshCalls()).toHaveLength(0);
  });
});

// ── Component — data contract & toolbar ─────────────────────────────────────
describe('TeslaChargingHistoryPage — data contract & toolbar', () => {
  it('requests the globally selected VIN with no /api/v1 prefix or camelCase params', async () => {
    installRequest();
    renderPage();
    await waitForSummary();

    const calls = historyCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toContain(
      '/tesla/charging/history?vin=5YJ3E1EA1KF000001',
    );
    expect(calls.every((u) => !u.includes('/api/v1'))).toBe(true);
    expect(calls.every((u) => !/vehicleId=/.test(u))).toBe(true);
  });

  it('re-scopes the feed when a different vehicle is selected', async () => {
    installRequest();
    renderPage();
    await waitForSummary();

    expect(historyCalls()).toContain(
      '/tesla/charging/history?vin=5YJ3E1EA1KF000001',
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Select vehicle' }), {
      target: { value: '5YJYGDEE5MF000002' },
    });
    await waitFor(() =>
      expect(historyCalls()).toContain(
        '/tesla/charging/history?vin=5YJYGDEE5MF000002',
      ),
    );
  });

  it('POSTs to the refresh endpoint when "Refresh from Tesla" is pressed', async () => {
    installRequest();
    renderPage();
    await waitForSummary();

    expect(refreshCalls().length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from Tesla' }));
    await waitFor(() => expect(refreshCalls().length).toBeGreaterThan(0));
    expect(refreshCalls().every((u) => !u.includes('/api/v1'))).toBe(true);
  });

  it('filters the sessions table to an empty state when the search matches nothing', async () => {
    installRequest();
    renderPage();
    await waitForSummary();

    const search = screen.getByPlaceholderText('Search by location…');
    fireEvent.change(search, { target: { value: 'no-such-location-zzz' } });
    // SearchInput debounces ~250ms before committing to the URL filter.
    await waitFor(() =>
      expect(screen.getByText('No sessions match your search.')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(search).toHaveValue(''));
    expect(screen.queryByText('No sessions match your search.')).not.toBeInTheDocument();
    expect(refreshCalls()).toHaveLength(0);
  });
});

// ── Component — accessibility ────────────────────────────────────────────────
describe('TeslaChargingHistoryPage — accessibility', () => {
  it('labels the vehicle selector and the spending chart region for assistive tech', async () => {
    installRequest();
    renderPage();
    await waitForSummary();

    const select = screen.getByRole('combobox', { name: 'Select vehicle' });
    expect(select).toHaveAttribute('aria-label', 'Select vehicle');
    expect(select.closest('[data-action-group="context"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })
      .closest('[data-action-group="primary"]')).not.toBeNull();

    const chart = screen.getByRole('img', { name: 'Monthly Tesla charging spending bar chart' });
    expect(chart).toBeInTheDocument();
  });
});
