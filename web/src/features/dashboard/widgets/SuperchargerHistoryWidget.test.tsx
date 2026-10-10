/**
 * SuperchargerHistoryWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile summarising a vehicle's Tesla
 * Supercharger / DC billing records (`/tesla/charging/history`). Its shape is a
 * function of two inputs: the query result (`{ entries, summary }`) and the
 * widget `size`:
 *
 *   - size.cols <= 1  → compact tile: the 30-day spend as one big number, no
 *                       ranked session list; the heading and source brief remain.
 *   - otherwise       → full tile: titled header + ranked session list (each row
 *                       showing energy added + a cost badge) + a 30-day totals row.
 *   - entries.length === 0 → the accessible empty state in either layout.
 *
 * The suite locks, facet by facet:
 *   1. Full view: the SI watt-hours on disk are formatted to kWh at the display
 *      boundary, each known session cost renders as a currency badge (including 0),
 *      the list is ranked by energy, and the totals row echoes the summary.
 *   2. The request goes to the un-prefixed `/tesla/charging/history` (no
 *      `/api/v1` double-prefix, no camelCase params).
 *   3. Recency selection: with > 10 sessions only the 10 MOST RECENT survive —
 *      proven by making the two OLDEST rows carry the largest energy and
 *      asserting they never appear (they were sliced by date BEFORE the list
 *      re-ranked by value).
 *   4. Robustness: a missing / unparseable `charge_start_datetime` is treated as
 *      oldest and sliced out instead of scrambling the order (the NaN guard).
 *   5. Null-safety: null site / usage / cost degrade to '—' / '—' / no badge,
 *      and a null summary remains unknown — never a crash or invented zero.
 *   6. Compact view: the spend headline, heading and source brief render, no ranked list.
 *   7. Empty (resolved with no entries) → accessible empty state, never a list.
 *   8. Loading → heading and skeleton (no empty copy / list).
 *   9. Failure path → the tile surfaces the shared error card, not the children.
 *  10. Refresh: the accessible "Refresh" freshness control refetches on click.
 *
 * i18n is stubbed to echo the English fallback so visible copy is deterministic;
 * the shared `request` seam is mocked so no network is touched; `useUnits` /
 * `useFormatting` stay REAL (the global `useSettings` mock in test-setup pins
 * km / `$` / 2-dp / en-US), so the SI→kWh and currency formatting are exercised
 * end-to-end; and `matchMedia` is stubbed to "reduce motion" so the compact
 * `AnimatedNumber` lands on its final value synchronously.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n passthrough: honour the English fallback so every copy assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Neutralise the shared fetch seam; keep ApiError/isApiError etc. real so the
// error card branches exactly as it would in production.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import SuperchargerHistoryWidget from './SuperchargerHistoryWidget';

it.each([1, 2, 3])('identifies supercharger history at %i columns', (cols) => {
  renderWidget({ cols, rows: 4 });
  expect(screen.getByRole('heading', { name: 'Supercharger history' })).toBeInTheDocument();
});
import { request } from '@/api/client';
import { useSettings } from '@/hooks/useSettings';
import type { WidgetSize } from './types';
import type {
  TeslaChargingHistoryEntry,
  TeslaChargingHistorySummary,
  TeslaChargingHistoryResponse,
} from '@/api/hooks/useCharging';

// The generic `request<T>` fights `mockResolvedValue`'s inference; the repo's
// convention is to treat it as a plain untyped mock at the call site.
const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

const HISTORY_ENDPOINT = '/tesla/charging/history';

function makeEntry(overrides: Partial<TeslaChargingHistoryEntry> = {}): TeslaChargingHistoryEntry {
  return {
    id: 1,
    session_id: 1,
    vin: '5YJ3E1EA1LF000001',
    site_location_name: 'Fremont Supercharger',
    charge_start_datetime: '2026-07-01T00:00:00Z',
    charge_stop_datetime: '2026-07-01T00:30:00Z',
    country: 'US',
    state: 'CA',
    county: 'Alameda',
    postal_code: '94538',
    billing_type: 'billed',
    fee_type: 'charging',
    currency_code: 'USD',
    pricing_type: 'per_kwh',
    rate_base: 0.28,
    usage_wh: 10_000,
    total_due: 5,
    has_invoice: true,
    invoice_content_id: null,
    fetched_at: '2026-07-02T00:00:00Z',
    created_at: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

function makeSummary(
  overrides: Partial<TeslaChargingHistorySummary> = {},
): TeslaChargingHistorySummary {
  return {
    total_sessions: 3,
    total_wh: 60_000,
    total_spend: 17.5,
    avg_cost_per_kwh: 0.29,
    ...overrides,
  };
}

function makeResponse(
  entries: TeslaChargingHistoryEntry[],
  summary: TeslaChargingHistorySummary = makeSummary(),
): TeslaChargingHistoryResponse {
  return { entries, summary };
}

function renderWidget(size: WidgetSize) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SuperchargerHistoryWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(view.container.querySelector('h3')).toHaveAccessibleName('Supercharger history');
  return view;
}

beforeEach(() => {
  mockedRequest.mockReset();
  // `AnimatedNumber` (inside the compact big number) eases via requestAnimationFrame
  // unless the user prefers reduced motion. jsdom has no matchMedia, so stub it to
  // report "reduce" — the number then commits its final value synchronously.
  vi.stubGlobal(
    'matchMedia',
    (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SuperchargerHistoryWidget — full view', () => {
  it('reviews actual raw-source totals independently of the ranked ten-row presentation', async () => {
    mockedRequest.mockResolvedValue(makeResponse([
      makeEntry({ site_location_name: 'Retained location', usage_wh: 10_000 }),
    ]));
    renderWidget(FULL);
    expect(await screen.findByText('Retained location')).toBeInTheDocument();
    const brief = screen.getByTestId('supercharger-history-operational-brief');
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(2);
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('60.00 kWh')).toBeInTheDocument();
    expect(within(drawer).getByText('$17.50')).toBeInTheDocument();
    expect(within(drawer).getByText(/not the sum of the top-ten presentation rows/)).toBeInTheDocument();
    expect(within(within(drawer).getByRole('region', { name: 'Decision narrative' })).getByText(/exact instants and timezone are not supplied/)).toBeInTheDocument();
  });
  it('renders a ranked, kWh-formatted session list with cost badges and a totals row', async () => {
    mockedRequest.mockResolvedValue(
      makeResponse(
        [
          makeEntry({
            id: 1,
            site_location_name: 'Fremont Supercharger',
            charge_start_datetime: '2026-07-03T00:00:00Z', // newest
            usage_wh: 30_000, // 30.0 kWh
            total_due: 12.5, // $12.50
          }),
          makeEntry({
            id: 2,
            site_location_name: 'Harris Ranch',
            charge_start_datetime: '2026-07-02T00:00:00Z',
            usage_wh: 10_000, // 10.0 kWh
            total_due: 5, // $5.00
          }),
          makeEntry({
            id: 3,
            site_location_name: 'Kettleman City',
            charge_start_datetime: '2026-07-01T00:00:00Z', // oldest
            usage_wh: 20_000, // 20.0 kWh
            total_due: 0, // known zero remains visible
          }),
        ],
        makeSummary({ total_wh: 60_000, total_spend: 17.5 }),
      ),
    );
    renderWidget(FULL);

    // The full tile shows a header title once the query resolves.
    expect(await screen.findByText('Supercharger history')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());

    // Un-prefixed endpoint — no /api/v1 double-prefix, no query params.
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(HISTORY_ENDPOINT);

    // Every site is listed and every SI watt-hours value is formatted to kWh.
    expect(screen.getByText('Fremont Supercharger')).toBeInTheDocument();
    expect(screen.getByText('Harris Ranch')).toBeInTheDocument();
    expect(screen.getByText('Kettleman City')).toBeInTheDocument();
    expect(screen.getByText('30.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('10.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('20.00 kWh')).toBeInTheDocument();

    // Known session costs get a currency badge, including the free ($0) session.
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText('$5.00')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();

    // Rows are ranked by energy descending: Fremont (30) → Kettleman (20) → Harris (10).
    const rowLabels = within(screen.getByText('Fremont Supercharger').closest('ul')!)
      .getAllByRole('listitem')
      .map((li) => within(li).getByText(/Supercharger|Ranch|City/).textContent);
    expect(rowLabels).toEqual(['Fremont Supercharger', 'Kettleman City', 'Harris Ranch']);

    // Totals row echoes the summary (60 kWh across the window, $17.50 spent).
    expect(screen.getByText('30-day totals')).toBeInTheDocument();
    expect(screen.getByText('60.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('$17.50')).toBeInTheDocument();
  });

  it('keeps only the 10 most-recent sessions, slicing by date before ranking by value', async () => {
    const recent: TeslaChargingHistoryEntry[] = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        id: 100 + i,
        site_location_name: `Recent ${i}`,
        // 2026-07-01 .. 2026-07-10 — all newer than the two "old" June rows below.
        charge_start_datetime: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
        usage_wh: 1_000 * (i + 1), // small energies
        total_due: 1,
      }),
    );
    // The two OLDEST rows carry the LARGEST energy — if the widget failed to
    // slice by date they would rank #1/#2 by value and be impossible to miss.
    const old: TeslaChargingHistoryEntry[] = [
      makeEntry({
        id: 1,
        site_location_name: 'OldSiteA',
        charge_start_datetime: '2026-06-01T00:00:00Z',
        usage_wh: 999_000,
      }),
      makeEntry({
        id: 2,
        site_location_name: 'OldSiteB',
        charge_start_datetime: '2026-06-02T00:00:00Z',
        usage_wh: 998_000,
      }),
    ];
    mockedRequest.mockResolvedValue(makeResponse([...old, ...recent]));
    renderWidget(FULL);

    // A recent session confirms the list mounted.
    expect(await screen.findByText('Recent 9')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());

    // Exactly ten rows, and neither high-energy old row survived the date slice.
    expect(within(screen.getByText('Recent 9').closest('ul')!).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByText('OldSiteA')).toBeNull();
    expect(screen.queryByText('OldSiteB')).toBeNull();
  });

  it('treats a missing start timestamp as oldest instead of scrambling the order', async () => {
    const recent: TeslaChargingHistoryEntry[] = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        id: 200 + i,
        site_location_name: `Valid ${i}`,
        charge_start_datetime: `2026-06-${String(20 + i).padStart(2, '0')}T00:00:00Z`,
        usage_wh: 1_000 * (i + 1),
        total_due: 1,
      }),
    );
    // Unparseable date + huge energy: the NaN guard must rank it oldest so it is
    // sliced out — without the guard NaN comparisons could leave it in the top 10.
    const broken = makeEntry({
      id: 999,
      site_location_name: 'BrokenSite',
      charge_start_datetime: '',
      usage_wh: 999_000,
    });
    mockedRequest.mockResolvedValue(makeResponse([broken, ...recent]));
    renderWidget(FULL);

    expect(await screen.findByText('Valid 9')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    // No crash, ten rows, and the malformed-date row was sliced out as oldest.
    expect(within(screen.getByText('Valid 9').closest('ul')!).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByText('BrokenSite')).toBeNull();
  });

  it('degrades null site / usage / cost / summary to safe placeholders (no crash)', async () => {
    mockedRequest.mockResolvedValue(
      makeResponse(
        [
          makeEntry({
            id: 1,
            site_location_name: null as unknown as string,
            usage_wh: null,
            total_due: null,
          }),
        ],
        makeSummary({ total_sessions: 1, total_wh: null, total_spend: null }),
      ),
    );
    renderWidget(FULL);

    // Missing site name falls back to an em dash.
    expect((await screen.findAllByText('—')).length).toBeGreaterThanOrEqual(3);
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());

    // Missing usage stays unknown in both the row and the source summary.
    expect(screen.queryByText('0.00 kWh')).toBeNull();

    // Missing cost carries no badge, independently of the source summary.
    const [row] = within(document.querySelector('ul')!).getAllByRole('listitem');
    expect(within(row).queryByText(/\$/)).toBeNull();

    // Missing summary spend is not invented as $0.00.
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});

describe('SuperchargerHistoryWidget — compact view', () => {
  it('reacts to currency and locale preferences without changing billing facts', async () => {
    const response = makeResponse([makeEntry()], makeSummary({ total_spend: 120.5 }));
    mockedRequest.mockResolvedValue(response);
    const client = new QueryClient();
    const tree = () => <QueryClientProvider client={client}><MemoryRouter><SuperchargerHistoryWidget size={COMPACT} /></MemoryRouter></QueryClientProvider>;
    const view = render(tree());
    const headline = await screen.findByRole('group', { name: '30-day Supercharger' });
    await within(headline).findByText('$120.50');
    const settings = renderHook(() => useSettings()).result.current.settings;
    const original = { currency_symbol: settings.currency_symbol, locale: settings.locale, decimal_precision: settings.decimal_precision };
    try {
      Object.assign(settings, { currency_symbol: '€', locale: 'de-DE', decimal_precision: 3 });
      view.rerender(tree());
      expect(within(headline).getByText('€120,500')).toBeInTheDocument();
      expect(response.summary.total_spend).toBe(120.5);
    } finally {
      Object.assign(settings, original);
    }
  });

  it('identifies the 30-day spend headline without adding a list', async () => {
    mockedRequest.mockResolvedValue(
      makeResponse([makeEntry({ id: 1 })], makeSummary({ total_spend: 120 })),
    );
    renderWidget(COMPACT);

    // The spend lands as a big number (reduced-motion → synchronous commit).
    const headline = await screen.findByRole('group', { name: '30-day Supercharger' });
    expect(await within(headline).findByText('$120.00')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(within(headline).getByText('30-day Supercharger')).toBeInTheDocument();

    // A compact tile keeps its heading but does not add a ranked session list.
    expect(screen.getByRole('heading', { name: 'Supercharger history' })).toBeInTheDocument();
    expect(document.querySelector('ul li')).toBeNull();
  });

  it('shows the accessible empty state (not a big number) when there are no sessions', async () => {
    mockedRequest.mockResolvedValue(makeResponse([], makeSummary({ total_spend: 0 })));
    renderWidget(COMPACT);

    expect(await screen.findByText('No Supercharger sessions')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByText('No Supercharger sessions').closest('[role="status"]')).toBeInTheDocument();
    // The big-number label only renders in the populated compact path.
    expect(screen.queryByText('30-day Supercharger')).toBeNull();
  });
});

describe('SuperchargerHistoryWidget — empty / lifecycle states', () => {
  it.each([COMPACT, FULL, { cols: 4, rows: 2 }])('preserves billing content and recovers stale history at %j', async (size) => {
    mockedRequest.mockResolvedValue(makeResponse([makeEntry()], makeSummary()));
    renderWidget(size);
    const content = size.cols === 1
      ? within(await screen.findByRole('group', { name: '30-day Supercharger' }))
      : screen;
    await content.findByText(size.cols === 1 ? '$17.50' : 'Fremont Supercharger');
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    mockedRequest.mockRejectedValueOnce(new Error('refresh'));
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await screen.findByTestId('stale-refresh-warning');
    expect(document.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(content.getByText(size.cols === 1 ? '$17.50' : 'Fremont Supercharger')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.queryByTestId('stale-refresh-warning')).toBeNull());
    expect(mockedRequest).toHaveBeenCalledTimes(3);
  });

  it('normalizes nullable entries without inventing spend or energy', async () => {
    mockedRequest.mockResolvedValue({ entries: null, summary: null });
    renderWidget(FULL);
    await screen.findByText('No Supercharger sessions');
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText('0.00 kWh')).toBeNull();
  });

  it('shows an accessible empty state (not a list) when the history is empty', async () => {
    mockedRequest.mockResolvedValue(makeResponse([]));
    renderWidget(FULL);

    expect(await screen.findByText('No Supercharger sessions')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByText('No Supercharger sessions').closest('[role="status"]')).toBeInTheDocument();
    expect(document.querySelector('ul li')).toBeNull();
    // No totals row when there is nothing to summarise.
    expect(screen.queryByText('30-day totals')).toBeNull();
  });

  it('retains its heading above a pending skeleton without empty copy or list', () => {
    mockedRequest.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderWidget(FULL);

    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeTruthy();
    expect(screen.queryByText('Supercharger history')).toBeInTheDocument();
    expect(screen.queryByText('No Supercharger sessions')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('surfaces the shared error card (not the children) when the request rejects', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'));
    renderWidget(FULL);

    // The error branch renders WidgetShell's <QueryError> — an alert card — and
    // suppresses the list / empty state entirely.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(HISTORY_ENDPOINT);
    expect(screen.queryByText('No Supercharger sessions')).toBeNull();
    // The shared error card now lists "where to look next" destinations
    // (HELP-05) as list items, so prove the CHILDREN are suppressed via the
    // totals row, which only renders alongside session data.
    expect(screen.queryByText('30-day totals')).toBeNull();
  });
});

describe('SuperchargerHistoryWidget — refresh', () => {
  it('refetches when the accessible "Refresh" freshness control is activated', async () => {
    mockedRequest.mockResolvedValue(makeResponse([makeEntry({ id: 1 })]));
    renderWidget(FULL);

    // Wait for the first load to settle — a visible title implies the query is
    // no longer fetching, so the refresh control is armed.
    expect(await screen.findByText('Supercharger history')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
  });
});
