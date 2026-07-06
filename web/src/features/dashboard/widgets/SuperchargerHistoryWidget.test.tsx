/**
 * SuperchargerHistoryWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile summarising a vehicle's Tesla
 * Supercharger / DC billing records (`/tesla/charging/history`). Its shape is a
 * function of two inputs: the query result (`{ entries, summary }`) and the
 * widget `size`:
 *
 *   - size.cols <= 1  → compact tile: the 30-day spend as one big number, no
 *                       title, no list.
 *   - otherwise       → full tile: titled header + ranked session list (each row
 *                       showing energy added + a cost badge) + a 30-day totals row.
 *   - entries.length === 0 → the accessible empty state in either layout.
 *
 * The suite locks, facet by facet:
 *   1. Full view: the SI watt-hours on disk are formatted to kWh at the display
 *      boundary, each session's cost renders as a currency badge (only when > 0),
 *      the list is ranked by energy, and the totals row echoes the summary.
 *   2. The request goes to the un-prefixed `/tesla/charging/history` (no
 *      `/api/v1` double-prefix, no camelCase params).
 *   3. Recency selection: with > 10 sessions only the 10 MOST RECENT survive —
 *      proven by making the two OLDEST rows carry the largest energy and
 *      asserting they never appear (they were sliced by date BEFORE the list
 *      re-ranked by value).
 *   4. Robustness: a missing / unparseable `charge_start_datetime` is treated as
 *      oldest and sliced out instead of scrambling the order (the NaN guard).
 *   5. Null-safety: null site / usage / cost degrade to '—' / 0 kWh / no badge,
 *      and a null summary degrades the totals to zeroes — never a crash.
 *   6. Compact view: the spend big number + label render; title + list do NOT.
 *   7. Empty (resolved with no entries) → accessible empty state, never a list.
 *   8. Loading → skeleton only (no title / empty copy / list).
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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { request } from '@/api/client';
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
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SuperchargerHistoryWidget size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
            total_due: 0, // free → no badge
          }),
        ],
        makeSummary({ total_wh: 60_000, total_spend: 17.5 }),
      ),
    );
    renderWidget(FULL);

    // The full tile shows a header title once the query resolves.
    expect(await screen.findByText('Supercharger History')).toBeInTheDocument();

    // Un-prefixed endpoint — no /api/v1 double-prefix, no query params.
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(HISTORY_ENDPOINT);

    // Every site is listed and every SI watt-hours value is formatted to kWh.
    expect(screen.getByText('Fremont Supercharger')).toBeInTheDocument();
    expect(screen.getByText('Harris Ranch')).toBeInTheDocument();
    expect(screen.getByText('Kettleman City')).toBeInTheDocument();
    expect(screen.getByText('30.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('10.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('20.0 kWh')).toBeInTheDocument();

    // Priced sessions get a currency badge; the free ($0) session does NOT.
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText('$5.00')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).toBeNull();

    // Rows are ranked by energy descending: Fremont (30) → Kettleman (20) → Harris (10).
    const rowLabels = screen
      .getAllByRole('listitem')
      .map((li) => within(li).getByText(/Supercharger|Ranch|City/).textContent);
    expect(rowLabels).toEqual(['Fremont Supercharger', 'Kettleman City', 'Harris Ranch']);

    // Totals row echoes the summary (60 kWh across the window, $17.50 spent).
    expect(screen.getByText('30-day totals')).toBeInTheDocument();
    expect(screen.getByText('60.0 kWh')).toBeInTheDocument();
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

    // Exactly ten rows, and neither high-energy old row survived the date slice.
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
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
    // No crash, ten rows, and the malformed-date row was sliced out as oldest.
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
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
    expect(await screen.findByText('—')).toBeInTheDocument();

    // Null usage → 0 Wh formats to "0.0 kWh"; it shows in the row AND the totals.
    expect(screen.getAllByText('0.0 kWh').length).toBeGreaterThanOrEqual(2);

    // Null cost → the row carries no badge (only the totals row shows a $ value).
    const [row] = screen.getAllByRole('listitem');
    expect(within(row).queryByText(/\$/)).toBeNull();

    // Null summary spend degrades the totals figure to $0.00.
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });
});

describe('SuperchargerHistoryWidget — compact view', () => {
  it('shows the 30-day spend as a big number with a label, and no title or list', async () => {
    mockedRequest.mockResolvedValue(
      makeResponse([makeEntry({ id: 1 })], makeSummary({ total_spend: 120 })),
    );
    renderWidget(COMPACT);

    // The spend lands as a big number (reduced-motion → synchronous commit).
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('$')).toBeInTheDocument();
    expect(screen.getByText('30-day Supercharger')).toBeInTheDocument();

    // A compact tile drops the header title and the ranked list entirely.
    expect(screen.queryByText('Supercharger History')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('shows the accessible empty state (not a big number) when there are no sessions', async () => {
    mockedRequest.mockResolvedValue(makeResponse([], makeSummary({ total_spend: 0 })));
    renderWidget(COMPACT);

    expect(await screen.findByText('No Supercharger sessions')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The big-number label only renders in the populated compact path.
    expect(screen.queryByText('30-day Supercharger')).toBeNull();
  });
});

describe('SuperchargerHistoryWidget — empty / lifecycle states', () => {
  it('shows an accessible empty state (not a list) when the history is empty', async () => {
    mockedRequest.mockResolvedValue(makeResponse([]));
    renderWidget(FULL);

    expect(await screen.findByText('No Supercharger sessions')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
    // No totals row when there is nothing to summarise.
    expect(screen.queryByText('30-day totals')).toBeNull();
  });

  it('renders only a skeleton (no title / empty copy / list) while pending', () => {
    mockedRequest.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderWidget(FULL);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Supercharger History')).toBeNull();
    expect(screen.queryByText('No Supercharger sessions')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('surfaces the shared error card (not the children) when the request rejects', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'));
    renderWidget(FULL);

    // The error branch renders WidgetShell's <QueryError> — an alert card — and
    // suppresses the list / empty state entirely.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(HISTORY_ENDPOINT);
    expect(screen.queryByText('No Supercharger sessions')).toBeNull();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});

describe('SuperchargerHistoryWidget — refresh', () => {
  it('refetches when the accessible "Refresh" freshness control is activated', async () => {
    mockedRequest.mockResolvedValue(makeResponse([makeEntry({ id: 1 })]));
    renderWidget(FULL);

    // Wait for the first load to settle — a visible title implies the query is
    // no longer fetching, so the refresh control is armed.
    expect(await screen.findByText('Supercharger History')).toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
  });
});
