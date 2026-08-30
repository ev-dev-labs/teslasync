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
 *   - The recharts cadence chart and the status-breakdown panel are replaced
 *     with prop-surfacing doubles: recharts doesn't lay out in jsdom, so we
 *     assert the page's binning / tally derivations through their props instead.
 *   - The AI summarizer is swapped for a prop double to assert the page forwards
 *     the resolved vehicleId (number → undefined at the null boundary) without
 *     pulling in the AI-off contract machinery (covered by its own suite).
 *   - `RangePicker` is replaced with a commit button so the page's URL-batch
 *     wiring can be driven without the real calendar popover.
 *
 * This suite also guards a real bug fixed alongside it: the range picker's
 * `onChange` used to call two separate URL setters (`setRange` + `setPage`) in
 * one handler. Under react-router v6 both read the same params snapshot, so the
 * second `setSearchParams(replace)` discarded the first — changing the range
 * while on page ≥ 2 silently reverted the range. It now writes both keys in one
 * `useUrlBatch` navigation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

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

// Network seam. The page calls request() directly through useQuery; a hoisted
// state object flips the response so every query branch is deterministic.
const api = vi.hoisted(() => ({
  mode: 'data' as 'data' | 'error' | 'pending',
  updates: [] as unknown,
}));

vi.mock('@/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/api/client')>();
  return {
    ...actual,
    request: vi.fn((path: string) => {
      if (!path.startsWith('/software-updates')) return Promise.resolve([]);
      if (api.mode === 'pending') return new Promise<never>(() => {});
      if (api.mode === 'error') return Promise.reject(new Error('boom'));
      return Promise.resolve(api.updates);
    }),
  };
});

// Selection mocked at the boundary so vehicle scope is deterministic.
vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// RangePicker → commit-button double: keeps the rest of the barrel (VehicleSelect)
// real so we can still assert the vehicle picker's combobox a11y.
vi.mock('@/components/forms', async (importActual) => {
  const actual = await importActual<typeof import('@/components/forms')>();
  return {
    ...actual,
    RangePicker: ({ onChange }: { onChange: (v: { start: string; end: string }) => void }) => (
      <button
        type="button"
        data-testid="mock-range"
        onClick={() => onChange({ start: '2025-02-01', end: '2025-02-28' })}
      >
        commit-range
      </button>
    ),
  };
});

// Chart + breakdown children surface their derived props (recharts won't lay
// out in jsdom, so the page's binning/tally logic is asserted via props).
vi.mock('../components/SoftwareUpdateCadenceChart', () => ({
  SoftwareUpdateCadenceChart: ({
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
import SoftwareUpdatesPage from './SoftwareUpdatesPage';

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

function renderPage(initialEntries: string[] = ['/software-updates']) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <SoftwareUpdatesPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Scope a MetricCard by its (unique-within-the-KPI-band) label. */
function kpiCard(label: string): HTMLElement {
  const band = screen.getByRole('region', { name: 'Software update summary' });
  const el = within(band).getByText(label).closest('[data-role="metric-card"]');
  if (!el) throw new Error(`MetricCard wrapper not found for "${label}"`);
  return el as HTMLElement;
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
  vi.clearAllMocks();
  localStorage.clear();
  api.mode = 'data';
  api.updates = UPDATES;
  selectVehicle(1, [{ id: 1, display_name: 'Model 3', vin: 'VIN1' }]);
});

describe('SoftwareUpdatesPage — structure, wiring & a11y', () => {
  it('renders the title/subtitle, vehicle picker, refresh control and requests snake_case-safe params', async () => {
    renderPage();
    await screen.findByTestId('cadence-chart');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Software Updates' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Track firmware versions and update history'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Software Updates');

    // VehicleSelect renders a labelled combobox for a ≥1-vehicle fleet.
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toBeInTheDocument();
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

    expect(within(kpiCard('Current Version')).getByText('2025.20.1')).toBeInTheDocument();
    expect(within(kpiCard('Total Updates')).getByText('3')).toBeInTheDocument();
    expect(within(kpiCard('Installed')).getByText('2')).toBeInTheDocument();
    expect(within(kpiCard('Pending')).getByText('1')).toBeInTheDocument();
    // Two installs 92 days apart → avg cadence "92d" (absolute-instant math).
    expect(within(kpiCard('Avg Cadence')).getByText('92d')).toBeInTheDocument();
    // Last installed resolves to a real date, not the em-dash placeholder.
    expect(within(kpiCard('Last Installed')).getByText(/2025/)).toBeInTheDocument();
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
    // Vehicle name resolved from the fleet map, one per timeline card (the
    // vehicle picker also lists it as an <option>, so scope to the list).
    const timeline = screen.getByRole('list');
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

    // cadence + breakdown + 4 timeline card skeletons.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(6);
    // Data children are not shown while loading…
    expect(screen.queryByTestId('cadence-chart')).toBeNull();
    // …but the KPI band always renders (never a blank page) with a placeholder.
    expect(within(kpiCard('Current Version')).getByText('—')).toBeInTheDocument();
  });

  it('shows an error state with retry in every data section on request failure', async () => {
    api.mode = 'error';
    renderPage();

    const errors = await screen.findAllByText("Can't reach server");
    expect(errors).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(3);
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
  it('applies the new range AND clears the page in one navigation when changed from page ≥ 2', async () => {
    renderPage(['/software-updates?page=3&from=2024-01-01&to=2024-12-31']);

    // Precondition: we start on page 3 with a stale range.
    expect(screen.getByTestId('loc-search').textContent).toContain('page=3');

    fireEvent.click(screen.getByTestId('mock-range'));

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
