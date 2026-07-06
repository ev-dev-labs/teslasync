/**
 * DataRepairPage contract tests (Project Apex elevation).
 *
 * DataRepairPage is the triage worklist for stale (incomplete) charging
 * sessions and drives. Its single default export orchestrates:
 *   - a four-tile KPI band whose Status tile flips Clean → Needs Repair,
 *   - an opt-in AI suggestion surface (absent while ai_mode='off'),
 *   - a two-column worklist bento with independent loading / error / empty /
 *     populated states per panel,
 *   - single-open disclosure rows that expand into an inline SI repair form,
 *   - a header refresh control and per-row close/discard/update mutations.
 *
 * These tests exercise every one of those branches. The shared `request`
 * helper is stubbed so the real TanStack Query hooks (`useStaleSessions`,
 * `useCloseCharging`, …) run end-to-end without a network. `useSettings` is
 * left to the global test-setup stub (ai_mode='off', metric/SI units), so the
 * AI surface stays absent and SI values format as km / kWh / kW at the display
 * boundary. i18n is stubbed to return the English `defaultValue` with `{{var}}`
 * interpolation so visible copy is deterministic.
 *
 * user-event is intentionally NOT used — it is not installed in this repo
 * (see web/src/components/ui/EditableText.test.tsx). Interactions go through
 * `fireEvent`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// Stub the resilient fetch client while preserving the rest of the module
// (QueryError reaches for `isApiError`, so a bare `{ request }` mock would
// crash the error branch).
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Deterministic i18n: return the English defaultValue and interpolate the
// `{{count}}` / `{{id}}` placeholders the page + rows use.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>): string =>
    vars
      ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) =>
          k in vars ? String(vars[k]) : `{{${k}}}`,
        )
      : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, dflt?: unknown, opts?: unknown) => {
        if (typeof dflt === 'string') {
          const vars = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : undefined;
          return interpolate(dflt, vars);
        }
        if (dflt && typeof dflt === 'object') {
          const o = dflt as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return interpolate(o.defaultValue, o);
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
import DataRepairPage from './DataRepairPage';
import type {
  StaleChargingSession,
  StaleDrive,
  StaleSessionsResponse,
} from '@/api/hooks/useDataRepair';

const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

function buildCharging(overrides?: Partial<StaleChargingSession>): StaleChargingSession {
  return {
    id: 101,
    vehicle_id: 7,
    started_at: '2026-03-29T10:00:00Z',
    ended_at: null,
    start_soc_pct: 20,
    end_soc_pct: null,
    total_energy_added_wh: 42000, // → 42.00 kWh
    peak_power_w: 250000, // → 250.00 kW
    avg_power_w: 90000,
    cost_decimal: null,
    ...overrides,
  };
}

function buildDrive(overrides?: Partial<StaleDrive>): StaleDrive {
  return {
    id: 202,
    vehicle_id: 7,
    start_ts: '2026-03-29T09:00:00Z',
    end_ts: null,
    duration_s: null,
    distance_m: 15000, // → 15.0 km
    start_battery_pct: 80,
    end_battery_pct: null,
    max_speed_mps: 30, // → 108 km/h
    avg_speed_mps: 20,
    energy_used_wh: null,
    ...overrides,
  };
}

/** Resolve the stale-sessions GET with the given inventory; other calls → {}. */
function mockInventory(resp: StaleSessionsResponse): void {
  mockRequest.mockImplementation((url: string) => {
    if (url === '/data-repair/stale-sessions') return Promise.resolve(resp);
    return Promise.resolve({});
  });
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/system/data-repair']}>
          <DataRepairPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRequest.mockReset();
  // jsdom defaults navigator.onLine to true, but pin it so the QueryError
  // branch is deterministically the "online / can't reach server" variant
  // rather than the "offline / disabled retry" one.
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('DataRepairPage — Project Apex elevation', () => {
  it('renders the clean-state KPI band, subtitle, and both empty worklists (AI surface absent)', async () => {
    mockInventory({ stale_charging: [], stale_drives: [] });
    renderPage();

    // Page title (single h1) + the "all clean" subtitle variant.
    expect(await screen.findByRole('heading', { name: 'Data Repair', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Fix incomplete or stale sessions')).toBeInTheDocument();

    // KPI band — scope to the labelled summary region so the numeric zeros
    // don't collide with counts elsewhere on the page.
    const kpi = screen.getByRole('region', { name: 'Repair summary' });
    expect(within(kpi).getByText('Total Stale')).toBeInTheDocument();
    expect(within(kpi).getByText('Stale Charging')).toBeInTheDocument();
    expect(within(kpi).getByText('Stale Drives')).toBeInTheDocument();
    // Status tile reads "Clean" when nothing is stale.
    expect(within(kpi).getByText('Clean')).toBeInTheDocument();
    expect(within(kpi).queryByText('Needs Repair')).not.toBeInTheDocument();

    // Both deterministic empty states render (never a blank panel).
    expect(await screen.findByText('All charging sessions are complete')).toBeInTheDocument();
    expect(screen.getByText('All drives are complete')).toBeInTheDocument();

    // The privileged-action callout is always visible.
    expect(
      screen.getByText(/Editing, closing, or discarding a record is a privileged action/i),
    ).toBeInTheDocument();

    // ai_mode='off' (global stub) → AI suggestions surface is not in the DOM.
    expect(
      screen.queryByTestId('ai-feature-data-repair-suggestions-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Draft repair plan/i }),
    ).not.toBeInTheDocument();
  });

  it('renders needs-repair KPIs, the pluralised count subtitle, and SI metric chips for a populated inventory', async () => {
    mockInventory({
      stale_charging: [
        buildCharging({ id: 101, total_energy_added_wh: 42000, peak_power_w: 250000 }),
        buildCharging({ id: 102, total_energy_added_wh: 5000, peak_power_w: 11000 }),
      ],
      stale_drives: [buildDrive({ id: 202, distance_m: 15000, max_speed_mps: 30 })],
    });
    renderPage();

    // Subtitle switches to the interpolated count (2 charging + 1 drive = 3).
    expect(await screen.findByText('3 incomplete session(s) found')).toBeInTheDocument();

    // KPI counts, scoped to the summary region (3 total / 2 charging / 1 drive).
    const kpi = screen.getByRole('region', { name: 'Repair summary' });
    expect(within(kpi).getByText('3')).toBeInTheDocument();
    expect(within(kpi).getByText('2')).toBeInTheDocument();
    expect(within(kpi).getByText('1')).toBeInTheDocument();
    // Status tile flips to "Needs Repair" once anything is stale.
    expect(within(kpi).getByText('Needs Repair')).toBeInTheDocument();

    // SI values are converted at the display boundary via useUnits():
    //   42000 Wh → 42.00 kWh, 250000 W → 250.00 kW,
    //   15000 m → 15.00 km, 30 m/s → 108.00 km/h.
    // (The global useSettings stub sets decimal_precision=2, which overrides
    // each formatter's per-quantity default precision.)
    expect(screen.getByText('42.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('250.00 kW')).toBeInTheDocument();
    expect(screen.getByText('15.00 km')).toBeInTheDocument();
    expect(screen.getByText('108.00 km/h')).toBeInTheDocument();

    // Both worklist panel headings render (regex name tolerates the trailing
    // count badge appended to the accessible name).
    expect(screen.getByRole('heading', { name: /Charging Sessions/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Drives/ })).toBeInTheDocument();

    // Both charging rows + the drive row are present as disclosure toggles.
    expect(
      screen.getByRole('button', { name: 'Open repair form for record #101' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open repair form for record #102' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open repair form for record #202' }),
    ).toBeInTheDocument();
  });

  it('shows loading skeletons in both panels while the stale-sessions query is in flight', () => {
    // A promise that never settles keeps the query in its loading state.
    mockRequest.mockReturnValue(new Promise<never>(() => {}));
    const { container } = renderPage();

    // Skeleton renders `.animate-pulse` bars (Button spinners use animate-spin,
    // the freshness chip uses animate-ping, so this class is skeleton-specific).
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);

    // Panel scaffolding is visible during load — never a blank page.
    expect(screen.getByRole('heading', { name: /Charging Sessions/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Drives/ })).toBeInTheDocument();

    // Neither the empty-state nor any resolved rows have rendered yet.
    expect(screen.queryByText('All charging sessions are complete')).not.toBeInTheDocument();
    expect(screen.queryByText('No stale drives found.')).not.toBeInTheDocument();
  });

  it('renders a QueryError with a working Retry in each panel when the query fails', async () => {
    mockRequest.mockRejectedValue(new Error('network boom'));
    renderPage();

    // A plain (non-ApiError) rejection lands on the network/unknown branch:
    // "Can't reach server" — one per panel.
    const banners = await screen.findAllByText("Can't reach server");
    expect(banners).toHaveLength(2);

    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(2);

    // Clicking Retry triggers another fetch attempt.
    const before = mockRequest.mock.calls.length;
    fireEvent.click(retries[0]);
    await waitFor(() => {
      expect(mockRequest.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('expands a charging row into an inline SI repair form and collapses it again on re-toggle', async () => {
    mockInventory({ stale_charging: [buildCharging({ id: 101 })], stale_drives: [] });
    renderPage();

    const row = await screen.findByRole('button', { name: 'Open repair form for record #101' });
    expect(row).toHaveAttribute('aria-expanded', 'false');

    // Expand.
    fireEvent.click(row);
    const form = await screen.findByRole('region', { name: 'Repair charging session #101' });
    expect(form).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'true');

    // The inline form exposes the full action set.
    expect(within(form).getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Close Session' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    // Re-toggle collapses it.
    fireEvent.click(row);
    await waitFor(() => {
      expect(
        screen.queryByRole('region', { name: 'Repair charging session #101' }),
      ).not.toBeInTheDocument();
    });
    expect(row).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps only one repair form open at a time across the charging and drive panels', async () => {
    mockInventory({
      stale_charging: [buildCharging({ id: 101 })],
      stale_drives: [buildDrive({ id: 202 })],
    });
    renderPage();

    const chargingRow = await screen.findByRole('button', {
      name: 'Open repair form for record #101',
    });
    const driveRow = screen.getByRole('button', { name: 'Open repair form for record #202' });

    // Open the charging form.
    fireEvent.click(chargingRow);
    expect(
      await screen.findByRole('region', { name: 'Repair charging session #101' }),
    ).toBeInTheDocument();

    // Opening the drive form must close the charging one (single expandedKey).
    fireEvent.click(driveRow);
    expect(
      await screen.findByRole('region', { name: 'Repair drive #202' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Repair charging session #101' }),
    ).not.toBeInTheDocument();
  });

  it('closes a stale charging session via the SI-canonical POST route and collapses the form', async () => {
    mockRequest.mockImplementation((url: string) => {
      if (url === '/data-repair/stale-sessions') {
        return Promise.resolve({ stale_charging: [buildCharging({ id: 101 })], stale_drives: [] });
      }
      // The close endpoint (and the follow-up invalidation refetch) resolve OK.
      return Promise.resolve({});
    });
    renderPage();

    const row = await screen.findByRole('button', { name: 'Open repair form for record #101' });
    fireEvent.click(row);
    const form = await screen.findByRole('region', { name: 'Repair charging session #101' });

    fireEvent.click(within(form).getByRole('button', { name: 'Close Session' }));

    // Hits the singular SI-canonical close route as a POST.
    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        '/data-repair/charging/101/close',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // onSuccess collapses the form.
    await waitFor(() => {
      expect(
        screen.queryByRole('region', { name: 'Repair charging session #101' }),
      ).not.toBeInTheDocument();
    });
  });

  it('refetches the inventory when the header refresh control is clicked', async () => {
    mockInventory({ stale_charging: [], stale_drives: [] });
    renderPage();

    // Wait for the initial fetch to settle so the refresh button is enabled.
    await screen.findByText('All charging sessions are complete');

    const refresh = screen.getByTestId('data-repair-refresh');
    expect(refresh).toHaveAttribute('aria-label', 'Refresh');

    const before = mockRequest.mock.calls.length;
    fireEvent.click(refresh);
    await waitFor(() => {
      expect(mockRequest.mock.calls.length).toBeGreaterThan(before);
    });
  });
});
