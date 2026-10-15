/**
 * SoftwareUpdatesPage — orchestration, derivation, resilience, a11y & URL-state.
 *
 * SoftwareUpdatesPage fans a single paged `/software-updates` query into a KPI
 * band, an update-cadence chart, a status breakdown, the opt-in Helix
 * summarizer, and a chronological card timeline. Every data-bound section owns
 * its own loading / error / empty branch.
 *
 * Strategy:
 *   - The network `request()` seam is mocked path-aware and flipped between
 *     data / error / never-resolving so each query branch is deterministic and
 *     no real network is touched.
 *   - `useSelectedVehicle` is mocked at the boundary so vehicle scope is fixed.
 *   - Chart sizing/rendering and the status-breakdown panel use prop-surfacing
 *     doubles. The real shared cadence card retains its loading/error/empty
 *     states; its chart data exposes the page's binning derivation.
 *   - The AI summarizer is swapped for a prop double to assert the page forwards
 *     the resolved vehicleId (number → undefined at the null boundary) without
 *     pulling in the AI-off contract machinery (covered by its own suite).
 *   - A header range commit button drives the shared range hook and URL state
 *     without the real calendar popover.
 *
 * This suite also guards a real bug fixed alongside it: the range picker's
 * `onChange` used to call two separate URL setters (`setRange` + `setPage`) in
 * one handler. Under react-router v6 both read the same params snapshot, so the
 * second `setSearchParams(replace)` discarded the first — changing the range
 * while on page ≥ 2 silently reverted the range. It now writes both keys in one
 * `useUrlBatch` navigation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, renderHook, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.unmock('@/lib/timezone');

// i18n stub with {{var}} interpolation so assertions target the final copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      let s = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        for (const [k, v] of Object.entries(opts)) {
          s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return s;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
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

// Network seam. The page's typed hook calls request(); a hoisted
// state object flips the response so every query branch is deterministic.
const api = vi.hoisted(() => ({
  mode: 'data' as 'data' | 'error' | 'pending' | 'bounded',
  updates: [] as unknown,
  boundaryUpdates: [] as Array<{ created_at: string }>,
}));

vi.mock('@/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/api/client')>();
  return {
    ...actual,
    request: vi.fn((path: string) => {
      if (!path.startsWith('/software-updates')) return Promise.resolve([]);
      if (api.mode === 'pending') return new Promise<never>(() => {});
      if (api.mode === 'error') return Promise.reject(new Error('boom'));
      if (api.mode === 'bounded') {
        const params = new URL(path, 'http://localhost').searchParams;
        const start = Date.parse(params.get('start') ?? '');
        const end = Date.parse(params.get('end') ?? '');
        return Promise.resolve(api.boundaryUpdates.filter(
          row => Date.parse(row.created_at) >= start && Date.parse(row.created_at) < end,
        ));
      }
      return Promise.resolve(api.updates);
    }),
  };
});

// Selection mocked at the boundary so vehicle scope is deterministic.
vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

vi.mock('@/components/charts', async (importActual) => ({
  ...await importActual<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <>{children}</>,
  BarChart: ({
    data,
  }: {
    data: Array<{ month: string; label: string; count: number }>;
  }) => <div data-testid="cadence-chart" data-points={JSON.stringify(data)} />,
}));
vi.mock('../components/SoftwareUpdateStatusBreakdown', () => ({
  SoftwareUpdateStatusBreakdown: ({
    counts,
    total,
  }: {
    counts: Record<string, number>;
    total: number;
  }) => (
    <div
      data-testid="status-breakdown"
      data-counts={JSON.stringify(counts)}
      data-total={String(total)}
    />
  ),
}));

// AI summarizer → prop double (ai_mode='off' would render it null via the global
// useSettings stub; swap it to assert the forwarded vehicleId).
vi.mock('@/components/ai/AISoftwareUpdateChangelogSummarizer', () => ({
  AISoftwareUpdateChangelogSummarizer: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-summarizer" data-vehicle={String(vehicleId)} />
  ),
}));

import { request } from '@/api/client';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSoftwareUpdatesPage } from '@/api/hooks/useSoftwareUpdatesPage';
import * as settingsHook from '@/hooks/useSettings';
import SoftwareUpdatesPage from './SoftwareUpdatesPage';

const defaultSettings = settingsHook.useSettings();
const mockRequest = vi.mocked(request);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

interface Update {
  id: number;
  vehicle_id: number;
  version: string;
  status: string;
  installed_at: string | null;
  scheduled_at: string | null;
  created_at: string;
}

// Mid-month, noon-UTC timestamps → calendar-month bucketing is timezone-safe.
const UPDATES: Update[] = [
  {
    id: 3,
    vehicle_id: 1,
    version: '2025.20.1',
    status: 'installed',
    installed_at: '2025-06-15T12:00:00Z',
    scheduled_at: null,
    created_at: '2025-06-14T12:00:00Z',
  },
  {
    id: 2,
    vehicle_id: 1,
    version: '2025.14.6',
    status: 'available',
    installed_at: null,
    scheduled_at: '2025-07-15T12:00:00Z',
    created_at: '2025-05-15T12:00:00Z',
  },
  {
    id: 1,
    vehicle_id: 1,
    version: '2025.8.3',
    status: 'installed',
    installed_at: '2025-03-15T12:00:00Z',
    scheduled_at: null,
    created_at: '2025-03-14T12:00:00Z',
  },
];

function selectVehicle(
  vehicleId: number | null,
  vehicles: Array<{ id: number; display_name: string; vin: string }> = [],
) {
  mockSelectedVehicle.mockReturnValue({
    vehicleId,
    vehicle: null,
    vehicles: vehicles as never,
    setVehicleId: vi.fn(),
  });
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc-search">{loc.search}</div>;
}

function HeaderRangeChange() {
  const { setRange, presetId } = useRangeState();
  return (
    <>
      <button onClick={() => setRange({ start: '2025-02-01', end: '2025-02-28' })}>
        Change header range
      </button>
      <span data-testid="header-range-preset">{presetId}</span>
    </>
  );
}

function renderPage(initialEntries: string[] = ['/software-updates']) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <SoftwareUpdatesPage />
        <HeaderRangeChange />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree());
  return { ...result, rerenderPage: () => result.rerender(tree()) };
}

function kpiBand(): HTMLElement {
  const band = screen.getByRole('heading', { name: 'Software update summary' })
    .closest<HTMLElement>('[data-operational-brief]');
  if (!band) throw new Error('Software update summary strip not found');
  return band;
}

/** Scope a shared stat tile by its unique summary label. */
function kpiCard(label: string): HTMLElement {
  const band = kpiBand();
  const el = within(band).getByText(label).closest<HTMLElement>('[data-operational-metric]');
  if (!el) throw new Error(`Stat tile not found for "${label}"`);
  return el;
}

/**
 * The page's refresh control AND the freshness chip both expose the accessible
 * name "Refresh"; the page control is the real `<button>` element.
 */
function refreshButton(): HTMLButtonElement {
  const btn = screen
    .getAllByRole('button', { name: 'Refresh' })
    .find((el): el is HTMLButtonElement => el.tagName === 'BUTTON');
  if (!btn) throw new Error('refresh <button> not found');
  return btn;
}

/** All software-updates request paths seen so far (ignores stray calls). */
function updatePaths(): string[] {
  return mockRequest.mock.calls
    .map((c) => String(c[0]))
    .filter((p) => p.startsWith('/software-updates'));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  api.mode = 'data';
  api.updates = UPDATES;
  selectVehicle(1, [{ id: 1, display_name: 'Model 3', vin: 'VIN1' }]);
});

describe('SoftwareUpdatesPage — selected date presentation', () => {
  function savedPreferences(locale: string, timezone: string) {
    vi.spyOn(settingsHook, 'useSettings').mockReturnValue({
      ...defaultSettings,
      locale,
      settings: {
        ...defaultSettings.settings,
        locale,
        tz_display_default: 'user',
        timezone_user: timezone,
      },
    });
  }

  it('uses saved locale and timezone for every date and rebuckets unchanged rows on preference changes', async () => {
    savedPreferences('de-DE', 'America/Los_Angeles');
    const installed = '2025-03-01T00:30:00Z';
    const scheduled = '2025-04-01T00:30:00Z';
    api.updates = [
      { ...UPDATES[0], installed_at: installed, created_at: installed },
      { ...UPDATES[1], scheduled_at: scheduled, created_at: installed },
      { ...UPDATES[2], installed_at: '2025-02-28T00:30:00Z' },
    ];
    const originalRows = JSON.stringify(api.updates);
    const { rerenderPage } = renderPage();
    await screen.findByTestId('cadence-chart');

    const check = (locale: string, timeZone: string, months: string[]) => {
      const date = (iso: string) => new Intl.DateTimeFormat(locale, {
        timeZone, year: 'numeric', month: 'short', day: 'numeric',
      }).format(new Date(iso));
      expect(within(kpiCard('Last installed')).getByText(date(installed))).toBeInTheDocument();
      const timeline = screen.getByRole('list', { name: 'Update timeline' });
      expect(within(timeline).getByText(`Installed ${date(installed)}`)).toBeInTheDocument();
      expect(within(timeline).getByText(`Scheduled ${date(scheduled)}`)).toBeInTheDocument();
      expect(within(timeline).getAllByText(`Detected ${date(installed)}`)).toHaveLength(2);
      const points = JSON.parse(screen.getByTestId('cadence-chart').getAttribute('data-points') ?? '[]');
      expect(points.map((point: { month: string }) => point.month)).toEqual(months);
      expect(points[0].label).toBe(new Intl.DateTimeFormat(locale, {
        timeZone: 'UTC', month: 'short', year: '2-digit',
      }).format(new Date(`${months[0]}-01T00:00:00Z`)));
      expect(within(kpiCard('Avg cadence')).getByText('1d')).toBeInTheDocument();
    };
    check('de-DE', 'America/Los_Angeles', ['2025-02']);
    savedPreferences('fr-FR', 'America/Los_Angeles');
    rerenderPage();
    check('fr-FR', 'America/Los_Angeles', ['2025-02']);
    savedPreferences('fr-FR', 'Asia/Tokyo');
    rerenderPage();
    check('fr-FR', 'Asia/Tokyo', ['2025-02', '2025-03']);
    expect(JSON.stringify(api.updates)).toBe(originalRows);
  });

  it('skips missing and invalid calendar dates without losing timeline rows or valid latest installs', async () => {
    savedPreferences('de-DE', 'America/Los_Angeles');
    api.updates = [
      { ...UPDATES[0], installed_at: 'not-a-date', created_at: '' },
      { ...UPDATES[1], installed_at: null, scheduled_at: 'bad-date', created_at: '' },
      { ...UPDATES[2], installed_at: '2025-03-01T00:30:00Z', created_at: 'bad-date' },
    ];
    renderPage();
    const chart = await screen.findByTestId('cadence-chart');
    expect(JSON.parse(chart.getAttribute('data-points') ?? '[]')).toEqual([
      { month: '2025-02', label: 'Feb. 25', count: 1 },
    ]);
    expect(within(kpiCard('Last installed')).getByText('28. Feb. 2025')).toBeInTheDocument();
    expect(within(kpiCard('Avg cadence')).getByText('—')).toBeInTheDocument();
    const timeline = screen.getByRole('list', { name: 'Update timeline' });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(3);
    expect(within(timeline).getByText('Installed —')).toBeInTheDocument();
    expect(within(timeline).getByText('Scheduled —')).toBeInTheDocument();
    expect(within(timeline).getAllByText('Detected —')).toHaveLength(3);
  });

  it('keeps the last-install and cadence metrics unknown when every installation date is missing or invalid', async () => {
    api.updates = [
      { ...UPDATES[0], installed_at: 'bad-date', created_at: '' },
      { ...UPDATES[2], installed_at: null, created_at: '' },
    ];
    renderPage();
    await screen.findByText('No update activity in this range');
    expect(within(kpiCard('Last installed')).getByText('—')).toBeInTheDocument();
    expect(within(kpiCard('Avg cadence')).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Update timeline' })).getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('SoftwareUpdatesPage — structure, wiring & a11y', () => {
  it('renders the title/subtitle and refresh control and requests snake_case-safe params', async () => {
    renderPage();
    await screen.findByTestId('cadence-chart');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Software updates' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Track firmware versions and update history'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Software updates');

    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
    // Icon-only refresh control has a real accessible name.
    expect(refreshButton()).toBeInstanceOf(HTMLButtonElement);

    // Query wiring: no /api/v1 double-prefix, snake_case ids, paged offset.
    const path = updatePaths()[0];
    expect(path.startsWith('/software-updates?')).toBe(true);
    expect(path).not.toContain('/api/v1');
    expect(path).toContain('vehicle_id=1');
    expect(path).toContain('limit=50');
    expect(path).toContain('offset=0');
    expect(path).not.toContain('vehicleId=');
  });

  it('forwards the resolved vehicleId to the AI summarizer', async () => {
    renderPage();
    await screen.findByTestId('cadence-chart');
    expect(screen.getByTestId('ai-summarizer')).toHaveAttribute('data-vehicle', '1');
  });
});

describe('SoftwareUpdatesPage — KPI derivations', () => {
  it('derives current version, totals, installed/pending counts and cadence from the rows', async () => {
    renderPage();
    await screen.findByTestId('cadence-chart');

    expect(within(kpiCard('Current version')).getByText('2025.20.1')).toBeInTheDocument();
    expect(within(kpiCard('Total updates')).getByText('3')).toBeInTheDocument();
    expect(within(kpiCard('Installed')).getByText('2')).toBeInTheDocument();
    expect(within(kpiCard('Pending')).getByText('1')).toBeInTheDocument();
    // Two installs 92 days apart → avg cadence "92d" (absolute-instant math).
    expect(within(kpiCard('Avg cadence')).getByText('92d')).toBeInTheDocument();
    // Last installed resolves to a real date, not the em-dash placeholder.
    expect(within(kpiCard('Last installed')).getByText(/2025/)).toBeInTheDocument();
  });

  it('bins updates into sorted calendar-month cadence points and tallies status counts', async () => {
    renderPage();
    const chart = await screen.findByTestId('cadence-chart');

    const points = JSON.parse(chart.getAttribute('data-points') ?? '[]') as Array<{
      month: string;
      label: string;
      count: number;
    }>;
    expect(points.map((p) => p.month)).toEqual(['2025-03', '2025-05', '2025-06']);
    expect(points.every((p) => p.count === 1)).toBe(true);
    // monthLabel() emits a 2-digit year (locale-agnostic on the year part).
    expect(points[0].label).toContain('25');

    const breakdown = screen.getByTestId('status-breakdown');
    expect(JSON.parse(breakdown.getAttribute('data-counts') ?? '{}')).toEqual({
      installed: 2,
      available: 1,
    });
    expect(breakdown).toHaveAttribute('data-total', '3');
  });
});

describe('SoftwareUpdatesPage — update timeline', () => {
  it('renders a card per update with status badge, vehicle name, date lines and a labelled release-notes link', async () => {
    renderPage();
    await screen.findByTestId('cadence-chart');

    // Version chips (2025.8.3 only appears in the timeline).
    expect(screen.getByText('2025.8.3')).toBeInTheDocument();
    // Status badges: two installed, one available.
    expect(screen.getAllByText('Installed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Available')).toBeInTheDocument();
    // Scope timeline cards separately from the operational summary's list.
    const timeline = screen.getByRole('list', { name: 'Update timeline' });
    expect(within(timeline).getAllByText('Model 3')).toHaveLength(3);
    // Date branches: installed (×2), scheduled (available, ×1), detected (×3).
    expect(screen.getAllByText(/^Installed /)).toHaveLength(2);
    expect(screen.getByText(/^Scheduled /)).toBeInTheDocument();
    expect(screen.getAllByText(/^Detected /)).toHaveLength(3);

    // External release-notes link: accessible name + safe target/rel + href.
    const link = screen.getByRole('link', { name: 'Release notes for 2025.20.1' });
    expect(link).toHaveAttribute(
      'href',
      'https://www.notateslaapp.com/software-updates/version/2025.20.1/release-notes',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('refetches the update list when the refresh control is clicked', async () => {
    renderPage();
    await screen.findByTestId('cadence-chart');
    const before = updatePaths().length;

    fireEvent.click(refreshButton());

    await waitFor(() => expect(updatePaths().length).toBeGreaterThan(before));
  });
});

describe('SoftwareUpdatesPage — resilience states', () => {
  it('shows per-section skeletons while loading and still renders the KPI band', () => {
    api.mode = 'pending';
    const { container } = renderPage();

    expect(container.querySelectorAll('[data-chart-state="loading"]')).toHaveLength(1);
    // Breakdown plus four timeline card skeletons; chart and stats own loading.
    expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThanOrEqual(5);
    // Data children are not shown while loading…
    expect(screen.queryByTestId('cadence-chart')).toBeNull();
    const band = kpiBand();
    expect(band.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(band).toHaveAttribute('aria-busy', 'true');
    expect(kpiCard('Current version').querySelector('[data-operational-value]')).not.toBeInTheDocument();
    expect(within(band).queryByText('2025.20.1')).not.toBeInTheDocument();
    expect(screen.queryByText(/is paused while the connection is unavailable/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Update cadence' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: 'By status' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: 'Update timeline' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('ai-summarizer')).toBeInTheDocument();
  });

  it('explains an initial pause locally with unknown counts and retries, then recovers every mounted shell', async () => {
    act(() => onlineManager.setOnline(false));
    try {
      const { container } = renderPage();
      const labels = ['Software update summary', 'Update cadence', 'By status', 'Update timeline'];
      const shells = labels.map(label => screen.getAllByRole('heading', { name: label })[0]!);

      expect(await screen.findAllByText(/is paused while the connection is unavailable/)).toHaveLength(4);
      expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(4);
      expect(updatePaths()).toHaveLength(0);
      expect(kpiBand()).not.toHaveAttribute('aria-busy', 'true');
      for (const label of ['Total updates', 'Installed', 'Pending']) {
        expect(within(kpiCard(label)).getByText('—')).toBeInTheDocument();
        expect(within(kpiCard(label)).queryByText('0')).not.toBeInTheDocument();
      }
      expect(container.querySelector('[data-chart-state="loading"]')).not.toBeInTheDocument();
      expect(screen.queryByText('Update history is not available. Select a vehicle to load its history.')).not.toBeInTheDocument();
      expect(screen.queryByText('No update activity in this range')).not.toBeInTheDocument();
      expect(screen.queryByText('No update history')).not.toBeInTheDocument();
      expect(screen.queryByText('Retained evidence')).not.toBeInTheDocument();
      expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
      expect(screen.getByTestId('ai-summarizer')).toHaveAttribute('data-vehicle', '1');

      fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
      expect(updatePaths()).toHaveLength(0);
      await act(async () => onlineManager.setOnline(true));
      await screen.findByTestId('cadence-chart');

      expect(updatePaths()).toHaveLength(1);
      expect(screen.queryByText(/is paused while the connection is unavailable/)).not.toBeInTheDocument();
      expect(within(kpiCard('Total updates')).getByText('3')).toBeInTheDocument();
      expect(screen.getByTestId('status-breakdown')).toHaveAttribute('data-total', '3');
      expect(within(screen.getByRole('list', { name: 'Update timeline' })).getAllByRole('listitem')).toHaveLength(3);
      labels.forEach((label, index) => expect(screen.getAllByRole('heading', { name: label })[0]).toBe(shells[index]));
    } finally {
      await act(async () => onlineManager.setOnline(true));
    }
  });

  it('shows an error state with retry in every data section on request failure', async () => {
    api.mode = 'error';
    renderPage();

    const errors = await screen.findAllByText("Can't reach server");
    expect(errors).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(4);
    expect(screen.queryByTestId('cadence-chart')).toBeNull();
  });

  it('renders explicit empty states (never blank panels) when there are no updates', async () => {
    api.updates = [];
    renderPage();

    expect(await screen.findByText('No update activity in this range')).toBeInTheDocument();
    expect(screen.getByText('No updates to summarize')).toBeInTheDocument();
    expect(screen.getByText('No update history')).toBeInTheDocument();
    expect(
      screen.getByText('No software update history available for this vehicle yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('cadence-chart')).toBeNull();
    expect(screen.queryByTestId('status-breakdown')).toBeNull();
    for (const label of ['Total updates', 'Installed', 'Pending']) {
      expect(within(kpiCard(label)).getByText('0')).toBeInTheDocument();
    }
    expect(screen.queryByText(/is paused while the connection is unavailable/)).not.toBeInTheDocument();
  });

  it('disables the query and passes an undefined vehicleId to the summarizer when the fleet is empty', () => {
    selectVehicle(null, []);
    renderPage();

    // Query disabled → no software-updates request fired.
    expect(updatePaths()).toHaveLength(0);
    // number|null → undefined at the AI boundary.
    expect(screen.getByTestId('ai-summarizer')).toHaveAttribute('data-vehicle', 'undefined');
    // Empty fleet → VehicleSelect renders nothing.
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).toBeNull();
  });
});

describe('SoftwareUpdatesPage — range change resets pagination atomically (regression)', () => {
  it.each([
    ['cadence', 0],
    ['status breakdown', 1],
    ['timeline', 2],
  ] as const)('selects explicit all time from the %s recovery and clears pagination', async (_surface, actionIndex) => {
    api.updates = [];
    renderPage(['/software-updates?page=3&offset=100&from=2024-01-01&to=2024-12-31&time_scope=custom&vehicle_id=1']);
    const actions = await screen.findAllByRole('button', { name: 'View all time' });
    expect(actions).toHaveLength(3);
    const before = updatePaths().length;
    api.updates = UPDATES;

    fireEvent.click(actions[actionIndex]);

    await screen.findByTestId('cadence-chart');
    const params = new URLSearchParams(screen.getByTestId('loc-search').textContent ?? '');
    expect(params.get('time_scope')).toBe('all');
    expect(params.get('from')).toBe('2015-01-01');
    expect(params.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(params.has('page')).toBe(false);
    expect(params.has('offset')).toBe(false);
    expect(params.get('vehicle_id')).toBe('1');
    expect(screen.getByTestId('header-range-preset')).toHaveTextContent('all');
    const recoveryPaths = updatePaths().slice(before);
    expect(recoveryPaths.length).toBeGreaterThan(0);
    for (const path of recoveryPaths) {
      const query = new URL(path, 'http://localhost').searchParams;
      expect(query.get('start')).toMatch(/^2015-01-01T/);
      expect(query.get('offset')).toBe('0');
      expect(query.get('vehicle_id')).toBe('1');
    }
    expect(within(kpiCard('Total updates')).getByText('3')).toBeInTheDocument();
    expect(screen.getByTestId('status-breakdown')).toHaveAttribute('data-total', '3');
    expect(within(screen.getByRole('list', { name: 'Update timeline' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Release notes for 2025.20.1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View all time' })).not.toBeInTheDocument();
  });

  it('applies the new range AND clears the page in one navigation when changed from page ≥ 2', async () => {
    renderPage(['/software-updates?page=3&from=2024-01-01&to=2024-12-31']);

    // Precondition: we start on page 3 with a stale range.
    expect(screen.getByTestId('loc-search').textContent).toContain('page=3');

    fireEvent.click(screen.getByRole('button', { name: 'Change header range' }));

    // The committed range survives (the old setRange()+setPage() race would
    // have reverted it) and the page param is cleared.
    await waitFor(() => {
      const search = screen.getByTestId('loc-search').textContent ?? '';
      expect(search).toContain('from=2025-02-01');
      expect(search).toContain('to=2025-02-28');
      expect(search).not.toContain('page=');
    });
  });
});

describe('SoftwareUpdatesPage — precise shared bounds', () => {
  it('includes the lower bound and excludes the upper bound across a DST calendar day', async () => {
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    const timezone = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...originalResolvedOptions.call(this), timeZone: 'America/Los_Angeles' };
      });
    const rows = [
      { ...UPDATES[0], id: 10, version: 'before-start', created_at: '2025-03-09T07:59:59.999Z' },
      { ...UPDATES[0], id: 11, version: 'at-start', created_at: '2025-03-09T08:00:00.000Z' },
      { ...UPDATES[0], id: 12, version: 'before-end', created_at: '2025-03-10T06:59:59.999Z' },
      { ...UPDATES[0], id: 13, version: 'at-end', created_at: '2025-03-10T07:00:00.000Z' },
    ];
    // The request seam models ParseDateRange's exclusive-end adaptation and
    // the repository's created_at predicate, not client-side row filtering.
    api.mode = 'bounded';
    api.boundaryUpdates = rows;

    try {
      renderPage(['/software-updates?from=2025-03-09&to=2025-03-09&time_scope=custom']);
      await screen.findByTestId('cadence-chart');
      const params = new URL(updatePaths()[0], 'http://localhost').searchParams;
      expect(params.get('start')).toBe('2025-03-09T08:00:00.000Z');
      expect(params.get('end')).toBe('2025-03-10T07:00:00.000Z');
      const timeline = screen.getByRole('list', { name: 'Update timeline' });
      expect(within(timeline).getByText('at-start')).toBeInTheDocument();
      expect(within(timeline).getByText('before-end')).toBeInTheDocument();
      expect(within(timeline).queryByText('before-start')).not.toBeInTheDocument();
      expect(within(timeline).queryByText('at-end')).not.toBeInTheDocument();
      expect(screen.getByTestId('status-breakdown')).toHaveAttribute('data-total', '2');
    } finally {
      timezone.mockRestore();
    }
  });

  it('sends a precise rolling 24-hour window without losing the selected vehicle or page', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2025-06-15T18:42:13.456Z'));
    try {
      renderPage(['/software-updates?page=3&time_scope=24h']);
      await screen.findByTestId('cadence-chart');
      const params = new URL(updatePaths()[0], 'http://localhost').searchParams;
      expect(params.get('start')).toBe('2025-06-14T18:42:13.456Z');
      expect(params.get('end')).toBe('2025-06-15T18:42:13.456Z');
      expect(params.get('vehicle_id')).toBe('1');
      expect(params.get('offset')).toBe('100');
      expect(screen.getByTestId('loc-search').textContent).toContain('page=3');
    } finally {
      now.mockRestore();
    }
  });

  it('keys both precise bounds independently and aborts an obsolete request', async () => {
    api.mode = 'pending';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const first = { start: '2025-06-14T18:42:13.456Z', end: '2025-06-15T18:42:13.456Z' };
    const { rerender, unmount } = renderHook(
      ({ start, end }) => useSoftwareUpdatesPage(1, 3, start, end),
      { initialProps: first, wrapper },
    );
    await waitFor(() => expect(updatePaths()).toHaveLength(1));
    const firstSignal = mockRequest.mock.calls[0][1]?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    rerender({ ...first, start: '2025-06-14T18:43:13.456Z' });
    await waitFor(() => expect(updatePaths()).toHaveLength(2));
    expect(firstSignal?.aborted).toBe(true);
    rerender({ start: '2025-06-14T18:43:13.456Z', end: '2025-06-15T18:43:13.456Z' });
    await waitFor(() => expect(updatePaths()).toHaveLength(3));
    expect(qc.getQueryCache().getAll().map(query => query.queryKey)).toEqual([
      ['software-updates', 1, 3, first.start, first.end],
      ['software-updates', 1, 3, '2025-06-14T18:43:13.456Z', first.end],
      ['software-updates', 1, 3, '2025-06-14T18:43:13.456Z', '2025-06-15T18:43:13.456Z'],
    ]);
    const lastSignal = mockRequest.mock.calls[2][1]?.signal;
    unmount();
    expect(lastSignal?.aborted).toBe(true);
    qc.clear();
  });
});


describe('SoftwareUpdatesPage — shared trust preservation', () => {
  it('keeps every populated section and release-note action on a failed background refresh', async () => {
    renderPage();
    await screen.findByTestId('cadence-chart');
    api.mode = 'error';

    fireEvent.click(refreshButton());

    expect(await screen.findByText('Update history could not be refreshed. Retry to recover.')).toBeInTheDocument();
    expect(within(kpiBand()).getByText('Retained evidence')).toBeInTheDocument();
    expect(within(kpiCard('Current version')).getByText('2025.20.1')).toBeInTheDocument();
    expect(screen.getByTestId('cadence-chart')).toBeInTheDocument();
    expect(screen.getByTestId('status-breakdown')).toHaveAttribute('data-total', '3');
    expect(within(screen.getByRole('list', { name: 'Update timeline' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Release notes for 2025.20.1' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId('ai-summarizer')).toHaveAttribute('data-vehicle', '1');
    api.mode = 'data';
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => expect(screen.queryByText('Update history could not be refreshed. Retry to recover.')).not.toBeInTheDocument());
    expect(within(kpiBand()).queryByText('Retained evidence')).not.toBeInTheDocument();
    expect(within(kpiCard('Total updates')).getByText('3')).toBeInTheDocument();
    expect(screen.getByTestId('cadence-chart')).toBeInTheDocument();
    expect(screen.getByTestId('status-breakdown')).toHaveAttribute('data-total', '3');
    expect(screen.getByRole('link', { name: 'Release notes for 2025.20.1' })).toBeInTheDocument();
  });

  it('marks all four data sections retained during a paused refresh without inventing a server failure', async () => {
    renderPage();
    await screen.findByTestId('cadence-chart');
    const before = updatePaths().length;

    try {
      act(() => onlineManager.setOnline(false));
      fireEvent.click(refreshButton());

      await waitFor(() => expect(within(kpiBand()).getByText('Retained evidence')).toBeInTheDocument());
      expect(kpiBand().closest('[data-source-period-kind]')).toHaveAttribute('data-source-retained', 'true');
      expect(screen.getAllByText(/Previously loaded data remains visible while affected sources recover/)).toHaveLength(4);
      expect(screen.getByTestId('cadence-chart')).toBeInTheDocument();
      expect(screen.getByTestId('status-breakdown')).toHaveAttribute('data-total', '3');
      expect(within(screen.getByRole('list', { name: 'Update timeline' })).getAllByRole('listitem')).toHaveLength(3);
      expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(4);
      expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
      expect(updatePaths()).toHaveLength(before);
    } finally {
      await act(async () => onlineManager.setOnline(true));
    }
  });

  it('keeps unresolved counts unknown for malformed rows and preserves every section shell', async () => {
    api.updates = { unexpected: 'not an update array' };
    renderPage();

    await waitFor(() => expect(updatePaths()).toHaveLength(1));
    expect(await screen.findAllByText('Update history is not available. Select a vehicle to load its history.')).toHaveLength(4);
    expect(screen.getAllByRole('heading', { name: 'Software update summary' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: 'Update cadence' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: 'By status' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('heading', { name: 'Update timeline' }).length).toBeGreaterThan(0);
    expect(within(kpiCard('Total updates')).queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cadence-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-breakdown')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-summarizer')).toBeInTheDocument();
  });

  it('preserves status text, encoded firmware links, and vehicle-name fallback without firmware commands', async () => {
    api.updates = [
      { ...UPDATES[0], id: 1, vehicle_id: 999, version: '2025.20/beta?', status: 'installing' },
      { ...UPDATES[1], id: 2, status: 'downloading' },
      { ...UPDATES[2], id: 3, status: 'scheduled', installed_at: null },
      { ...UPDATES[2], id: 4, status: 'constructor', installed_at: null },
    ];
    renderPage();
    await screen.findByTestId('cadence-chart');

    const timeline = screen.getByRole('list', { name: 'Update timeline' });
    for (const status of ['Installing', 'Downloading', 'Scheduled', 'Available']) {
      expect(within(timeline).getByText(status)).toBeInTheDocument();
    }
    expect(within(timeline).getByText('Vehicle 999')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Release notes for 2025.20/beta?' })).toHaveAttribute(
      'href', 'https://www.notateslaapp.com/software-updates/version/2025.20%2Fbeta%3F/release-notes',
    );
    expect(mockRequest.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
    expect(refreshButton()).toHaveClass('h-11', 'w-11');
  });
});
