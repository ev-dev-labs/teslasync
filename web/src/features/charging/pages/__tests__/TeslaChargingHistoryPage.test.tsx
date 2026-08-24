/**
 * TeslaChargingHistoryPage — pure-helper, behaviour, branch, and a11y coverage.
 *
 * The page is the "Tesla Charging History" billing surface. It fans a single
 * `useTeslaChargingHistory(vin)` feed into:
 *
 *   1. A six-tile KPI band. Three tiles read the server `summary` (all-time
 *      sessions / SI-Wh→kWh energy / currency spend / avg cost-per-kWh); two are
 *      derived client-side from the entry list (total duration, distinct sites).
 *   2. A monthly-spending bar chart + a top-locations MetricBar panel, both
 *      derived from the range-filtered entries.
 *   3. A searchable, sortable, virtualized sessions table with bulk CSV export.
 *
 * Strategy mirrors ChargingHeatmapPage's test: render the REAL page + REAL shared
 * subtree (PageContainer, MetricCard, MetricBar, QueryError, charts). Only the
 * network `request` helper and i18n are mocked — the range state and the
 * settings-driven unit/format/currency hooks all run for real so the SI → display
 * conversion is genuinely exercised.
 *
 * The four exported pure helpers (durationMinutes, formatDurationMinutes,
 * buildMonthlySpending, buildTopLocations) are additionally unit-tested directly
 * for their branch/edge behaviour.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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

import TeslaChargingHistoryPage, {
  durationMinutes,
  formatDurationMinutes,
  buildMonthlySpending,
  buildTopLocations,
} from '../TeslaChargingHistoryPage';
import type { TeslaChargingHistoryEntry } from '@/api/hooks/useCharging';
import { ToastProvider } from '@/components/feedback/Toast';
import { ApiError } from '@/lib/resilience';

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
    currency_code: o.currency_code ?? 'USD',
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
// Durations: 60m + 30m + 0 (open) = 90m → "1h 30m". Distinct sites = 2.
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
  vehicles?: unknown[];
  response?: unknown;
  feedMode?: FeedMode;
  feedError?: unknown;
}
function installRequest({
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
    if (u.startsWith('/settings')) return Promise.resolve({});
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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/charging/tesla-history']}>
        <ToastProvider>
          <TeslaChargingHistoryPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Read a KPI card's value by its label text via MetricCard's stable semantic
// hooks: the card root is `[data-role="metric-card"]` and its value node is
// `[data-role="metric-value"]` (both siblings of `[data-role="metric-label"]`).
function kpiValue(label: string): string {
  const card = screen.getByText(label).closest('[data-role="metric-card"]');
  expect(card).not.toBeNull();
  const value = card!.querySelector('[data-role="metric-value"]');
  expect(value).not.toBeNull();
  return value!.textContent ?? '';
}

beforeEach(() => {
  mockRequest.mockReset();
  window.localStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
});

// ── Pure helpers ─────────────────────────────────────────────────────────────
describe('durationMinutes', () => {
  it('rounds the positive gap between two ISO timestamps to whole minutes', () => {
    expect(durationMinutes('2024-01-01T10:00:00Z', '2024-01-01T12:00:00Z')).toBe(120);
    // 2m40s = 160000ms → 2.667 → rounds up to 3.
    expect(durationMinutes('2024-01-01T10:00:00Z', '2024-01-01T10:02:40Z')).toBe(3);
  });

  it('returns null for a missing stop, a non-positive gap, or unparseable dates', () => {
    expect(durationMinutes('2024-01-01T10:00:00Z', null)).toBeNull();
    expect(durationMinutes('2024-01-01T12:00:00Z', '2024-01-01T10:00:00Z')).toBeNull();
    expect(durationMinutes('2024-01-01T10:00:00Z', '2024-01-01T10:00:00Z')).toBeNull();
    expect(durationMinutes('not-a-date', 'also-not-a-date')).toBeNull();
  });
});

describe('formatDurationMinutes', () => {
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
  it('returns an empty array for no entries', () => {
    expect(buildMonthlySpending([])).toEqual([]);
  });

  it('sums total_due per calendar month, sorted ascending, treating null spend as 0', () => {
    const rows = buildMonthlySpending([
      entry({ id: 1, session_id: 1, charge_start_datetime: '2024-02-10T00:00:00Z', total_due: 10 }),
      entry({ id: 2, session_id: 2, charge_start_datetime: '2024-01-05T00:00:00Z', total_due: 12.5 }),
      entry({ id: 3, session_id: 3, charge_start_datetime: '2024-01-25T00:00:00Z', total_due: 7.5 }),
      entry({ id: 4, session_id: 4, charge_start_datetime: '2024-01-28T00:00:00Z', total_due: null }),
    ]);
    expect(rows).toEqual([
      { month: '2024-01', total: 20 },
      { month: '2024-02', total: 10 },
    ]);
  });

  it('skips rows with an unparseable start date instead of emitting a NaN-NaN bucket', () => {
    const rows = buildMonthlySpending([
      entry({ id: 1, session_id: 1, charge_start_datetime: '2024-03-15T12:00:00Z', total_due: 5 }),
      entry({ id: 2, session_id: 2, charge_start_datetime: 'garbage', total_due: 99 }),
    ]);
    expect(rows).toEqual([{ month: '2024-03', total: 5 }]);
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
      { name: 'Fremont', total: 20, energyWh: 8000, count: 2 },
      { name: 'Gilroy', total: 4, energyWh: 1000, count: 1 },
    ]);
  });

  it('labels a missing site name as an em-dash and caps the ranking at six sites', () => {
    const withNullName = buildTopLocations([
      entry({ id: 1, session_id: 1, site_location_name: '', total_due: 3, usage_wh: 100 }),
    ]);
    expect(withNullName[0].name).toBe('—');

    const many = Array.from({ length: 9 }, (_, i) =>
      entry({ id: i, session_id: i, site_location_name: `Site ${i}`, total_due: i + 1, usage_wh: 100 }),
    );
    const capped = buildTopLocations(many);
    expect(capped).toHaveLength(6);
    // Highest spend (Site 8, $9) ranks first.
    expect(capped[0].name).toBe('Site 8');
  });
});

// ── Component — happy path ───────────────────────────────────────────────────
describe('TeslaChargingHistoryPage — happy path', () => {
  it('renders the page shell, every section, and all panel headings', async () => {
    installRequest();
    renderPage();
    await screen.findByText('Total Sessions');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Tesla Charging History' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Supercharger & DC fast charging billing records from Tesla'),
    ).toBeInTheDocument();

    // KPI region + the three data panels all mount (none gated away).
    expect(
      screen.getByRole('region', { name: 'Charging summary metrics' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Monthly Spending')).toBeInTheDocument();
    expect(screen.getByText('Top Locations')).toBeInTheDocument();
    expect(screen.getByText('Charging Sessions')).toBeInTheDocument();
  });

  it('derives the KPI band from the server summary + entry list', async () => {
    installRequest();
    renderPage();
    await screen.findByText('Total Sessions');

    expect(kpiValue('Total Sessions')).toBe('3');
    expect(kpiValue('Total Energy')).toMatch(/^115(?:\.0+)?\s*kWh$/);
    expect(kpiValue('Total Spend')).toBe('$30.00');
    expect(kpiValue('Avg Cost/kWh')).toBe('$0.260');
    // Total Duration + Sites Visited are derived client-side from the entries.
    expect(kpiValue('Total Duration')).toBe('1h 30m');
    expect(kpiValue('Sites Visited')).toBe('2');
  });

  it('renders the top-locations panel ranked by spend with formatted currency + counts', async () => {
    installRequest();
    renderPage();
    await screen.findByText('Total Sessions');

    expect(screen.getByText('Supercharger - Fremont')).toBeInTheDocument();
    expect(screen.getByText('Supercharger - Gilroy')).toBeInTheDocument();
    // MetricBar sublabel: "<currency> · <count>×".
    expect(screen.getByText('$20.00 · 2×')).toBeInTheDocument();
    expect(screen.getByText('$10.00 · 1×')).toBeInTheDocument();
  });

  it('shows the monthly-spending chart (not its empty state) when data exists', async () => {
    installRequest();
    renderPage();
    await screen.findByText('Total Sessions');

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
  it('shows skeletons (never blank panels) while the first feed is in flight', async () => {
    installRequest({ feedMode: 'pending' });
    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0),
    );
    // Panel chrome stays mounted — only the bodies are skeletons.
    expect(screen.getByText('Monthly Spending')).toBeInTheDocument();
    expect(screen.getByText('Charging Sessions')).toBeInTheDocument();
    // KPI values are replaced by skeletons, so no metric label leaks.
    expect(screen.queryByText('Total Sessions')).toBeNull();
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
    await screen.findByText('Total Sessions');

    expect(
      screen.getByText('No spending data yet. Click "Refresh from Tesla" to sync.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No charging locations in this range yet.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No Tesla charging history yet. Click "Refresh from Tesla" to import your Supercharger sessions.',
      ),
    ).toBeInTheDocument();
    // KPIs still render guarded zeros / em-dashes, never NaN.
    expect(kpiValue('Total Sessions')).toBe('0');
    expect(kpiValue('Total Energy')).toBe('—');
  });
});

// ── Component — data contract & toolbar ─────────────────────────────────────
describe('TeslaChargingHistoryPage — data contract & toolbar', () => {
  it('requests the globally selected VIN with no /api/v1 prefix or camelCase params', async () => {
    installRequest();
    renderPage();
    await screen.findByText('Total Sessions');

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
    await screen.findByText('Total Sessions');

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
    await screen.findByText('Total Sessions');

    expect(refreshCalls().length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from Tesla' }));
    await waitFor(() => expect(refreshCalls().length).toBeGreaterThan(0));
    expect(refreshCalls().every((u) => !u.includes('/api/v1'))).toBe(true);
  });

  it('filters the sessions table to an empty state when the search matches nothing', async () => {
    installRequest();
    renderPage();
    await screen.findByText('Total Sessions');

    const search = screen.getByPlaceholderText('Search by location…');
    fireEvent.change(search, { target: { value: 'no-such-location-zzz' } });
    // SearchInput debounces ~250ms before committing to the URL filter.
    await waitFor(() =>
      expect(screen.getByText('No sessions match your search.')).toBeInTheDocument(),
    );
  });
});

// ── Component — accessibility ────────────────────────────────────────────────
describe('TeslaChargingHistoryPage — accessibility', () => {
  it('labels the vehicle selector and the spending chart region for assistive tech', async () => {
    installRequest();
    renderPage();
    await screen.findByText('Total Sessions');

    const select = screen.getByRole('combobox', { name: 'Select vehicle' });
    expect(select).toHaveAttribute('aria-label', 'Select vehicle');

    const chart = screen.getByRole('img', { name: 'Monthly Tesla charging spending bar chart' });
    expect(chart).toBeInTheDocument();
  });
});
