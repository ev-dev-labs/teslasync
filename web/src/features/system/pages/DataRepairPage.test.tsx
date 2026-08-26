/**
 * DataRepairPage contract tests.
 *
 * The page surfaces evidence-based session-boundary repairs and, below them,
 * the legacy stale-session worklist. Its default export orchestrates:
 *   - a four-tile KPI band driven by the diagnosis report,
 *   - independent loading / error / empty / populated states for the drive and
 *     charging suggestion sections,
 *   - explicit, per-row, confirmed apply with its own pending/error/success,
 *   - the stale worklist with single-open inline SI repair forms,
 *   - a header refresh that re-runs BOTH queries.
 *
 * Both GETs are stubbed at the shared `request` helper so the real TanStack
 * Query hooks run end-to-end without a network. `useSettings` is left to the
 * global test-setup stub (ai_mode='off', metric/SI units), so the AI surface
 * stays absent. i18n is stubbed to return the English `defaultValue` with
 * `{{var}}` interpolation so visible copy is deterministic.
 *
 * user-event is intentionally NOT used — it is not installed in this repo.
 * Interactions go through `fireEvent`.
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
  RepairSuggestion,
  RepairSuggestionsResponse,
  StaleChargingSession,
  StaleDrive,
  StaleSessionsResponse,
} from '@/api/hooks/useDataRepair';

const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

const SUGGESTIONS_URL = '/data-repair/suggestions';
const STALE_URL = '/data-repair/stale-sessions';

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

function buildDriveSuggestion(overrides?: Partial<RepairSuggestion>): RepairSuggestion {
  return {
    kind: 'drive',
    session_id: 42,
    vehicle_id: 7,
    rule: 'drive_open_charging_started',
    confidence: 'high',
    started_at: '2026-03-29T06:00:00Z',
    stored_ended_at: null,
    stored_duration_s: null,
    last_in_session_evidence: {
      ts: '2026-03-29T07:00:00Z',
      source: 'drive_telemetry',
      field: 'Gear',
      value: 'D',
    },
    contradicting_evidence: {
      ts: '2026-03-29T08:00:00Z',
      source: 'charging_sessions',
      field: 'charging_session.started_at',
      value: '#900',
    },
    suggested_ended_at: '2026-03-29T07:00:00Z',
    suggested_duration_s: 3600,
    evidence_gap_s: 3600,
    applicable: true,
    ...overrides,
  };
}

function buildReport(overrides?: Partial<RepairSuggestionsResponse>): RepairSuggestionsResponse {
  return {
    generated_at: '2026-03-30T00:00:00Z',
    lookback_days: 30,
    scanned_drives: 0,
    scanned_charging_sessions: 0,
    drive_suggestions: [],
    charging_suggestions: [],
    truncated: false,
    ...overrides,
  };
}

const EMPTY_STALE: StaleSessionsResponse = { stale_charging: [], stale_drives: [] };

/** Route both GETs; every other call resolves `{}` (mutations). */
function mockApi(report: RepairSuggestionsResponse, stale: StaleSessionsResponse): void {
  mockRequest.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.startsWith(SUGGESTIONS_URL)) return Promise.resolve(report);
    if (url === STALE_URL) return Promise.resolve(stale);
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
        <MemoryRouter initialEntries={['/data-repair']}>
          <DataRepairPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRequest.mockReset();
  // jsdom defaults navigator.onLine to true, but pin it so the QueryError
  // branch is deterministically the "online / can't reach server" variant.
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});

describe('DataRepairPage', () => {
  it('renders the clean-state KPI band, the honest empty states, and the risk callout', async () => {
    mockApi(buildReport(), EMPTY_STALE);
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Data Repair', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByText('Find and repair broken drive and charging session boundaries'),
    ).toBeInTheDocument();

    const kpi = screen.getByRole('region', { name: 'Repair summary' });
    expect(within(kpi).getByText('Suggested Repairs')).toBeInTheDocument();
    expect(within(kpi).getByText('Drive Boundaries')).toBeInTheDocument();
    expect(within(kpi).getByText('Charging Boundaries')).toBeInTheDocument();
    expect(within(kpi).getByText('Blocked')).toBeInTheDocument();

    // Both suggestion sections state the truth: nothing contradicts the data.
    expect(await screen.findByText('No contradicted drive boundaries')).toBeInTheDocument();
    expect(screen.getByText('No contradicted charging boundaries')).toBeInTheDocument();

    // The stale fallback panels are always present too.
    expect(screen.getByText('All charging sessions are complete')).toBeInTheDocument();
    expect(screen.getByText('All drives are complete')).toBeInTheDocument();

    // The "we never auto-apply" contract is stated on the page.
    expect(screen.getByText(/never done automatically/i)).toBeInTheDocument();

    // ai_mode='off' (global stub) → AI suggestions surface is not in the DOM.
    expect(
      screen.queryByTestId('ai-feature-data-repair-suggestions-root'),
    ).not.toBeInTheDocument();
  });

  it('renders evidence-backed suggestions in the correct sections with a count subtitle', async () => {
    mockApi(
      buildReport({
        scanned_drives: 1,
        scanned_charging_sessions: 1,
        drive_suggestions: [buildDriveSuggestion()],
        charging_suggestions: [
          buildDriveSuggestion({
            kind: 'charging',
            session_id: 9,
            rule: 'charging_open_charge_ended',
          }),
        ],
      }),
      EMPTY_STALE,
    );
    renderPage();

    expect(
      await screen.findByText('2 session boundary(s) contradicted by later evidence'),
    ).toBeInTheDocument();

    expect(screen.getByTestId('repair-suggestion-drive-42')).toBeInTheDocument();
    expect(screen.getByTestId('repair-suggestion-charging-9')).toBeInTheDocument();
    expect(screen.getByText('Drive left open, then charging started')).toBeInTheDocument();
    expect(screen.getByText('Charging left open after it stopped')).toBeInTheDocument();
  });

  it('shows loading skeletons for the suggestion sections while the diagnosis is in flight', () => {
    mockRequest.mockReturnValue(new Promise<never>(() => {}));
    const { container } = renderPage();

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // Panel scaffolding is visible during load — never a blank page.
    expect(screen.getByRole('heading', { name: /Drive Boundaries/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Charging Boundaries/ })).toBeInTheDocument();
    expect(screen.queryByText('No contradicted drive boundaries')).not.toBeInTheDocument();
  });

  it('renders a QueryError with a working Retry when the diagnosis fails', async () => {
    mockRequest.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith(SUGGESTIONS_URL)) {
        return Promise.reject(new Error('diagnosis boom'));
      }
      return Promise.resolve(EMPTY_STALE);
    });
    renderPage();

    // One banner per suggestion section; the stale panels resolve fine.
    const banners = await screen.findAllByText("Can't reach server");
    expect(banners).toHaveLength(2);

    const before = mockRequest.mock.calls.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    await waitFor(() => {
      expect(mockRequest.mock.calls.length).toBeGreaterThan(before);
    });
  });

  it('never applies a repair without an explicit confirmation, then POSTs the reviewed boundary', async () => {
    mockApi(
      buildReport({ scanned_drives: 1, drive_suggestions: [buildDriveSuggestion()] }),
      EMPTY_STALE,
    );
    renderPage();

    const applyButton = await screen.findByTestId('repair-apply-drive-42');

    // Opening the dialog is not applying.
    fireEvent.click(applyButton);
    expect(
      mockRequest.mock.calls.filter(([url]) => String(url).includes('/close')),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }));

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalledWith(
        '/data-repair/drive/42/close',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const call = mockRequest.mock.calls.find(([url]) => url === '/data-repair/drive/42/close');
    expect(JSON.parse(call![1].body)).toEqual({
      ended_at: '2026-03-29T07:00:00Z',
      rule: 'drive_open_charging_started',
      // Empty pin = "assert this session is still open".
      expected_stored_ended_at: '',
    });

    // The card stays on screen, marked applied, until a fresh diagnosis
    // confirms it is resolved.
    expect(await screen.findByText(/Applied\. Refresh to re-check/i)).toBeInTheDocument();
    expect(screen.getByTestId('repair-suggestion-drive-42')).toBeInTheDocument();
  });

  it('shows a per-row error when the backend rejects the apply, and keeps the suggestion', async () => {
    mockRequest.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith(SUGGESTIONS_URL)) {
        return Promise.resolve(
          buildReport({ scanned_drives: 1, drive_suggestions: [buildDriveSuggestion()] }),
        );
      }
      if (url === STALE_URL) return Promise.resolve(EMPTY_STALE);
      return Promise.reject(new Error('no durable evidence currently supports repairing this drive'));
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('repair-apply-drive-42'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }));

    expect(
      await screen.findByText('no durable evidence currently supports repairing this drive'),
    ).toBeInTheDocument();
    // Not removed, not marked applied.
    expect(screen.getByTestId('repair-suggestion-drive-42')).toBeInTheDocument();
    expect(screen.queryByText(/Applied\. Refresh to re-check/i)).not.toBeInTheDocument();
  });

  it('counts blocked suggestions and refuses to apply them', async () => {
    mockApi(
      buildReport({
        scanned_drives: 1,
        drive_suggestions: [
          buildDriveSuggestion({ applicable: false, blocked_reason: 'overlaps_next_session' }),
        ],
      }),
      EMPTY_STALE,
    );
    renderPage();

    const card = await screen.findByTestId('repair-suggestion-drive-42');
    expect(
      within(card).getByText(/would still leave the session overlapping the next one/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('repair-apply-drive-42')).toBeDisabled();

    const kpi = screen.getByRole('region', { name: 'Repair summary' });
    expect(within(kpi).getByText('Blocked')).toBeInTheDocument();
  });

  it('surfaces a truncated scan honestly instead of implying the list is complete', async () => {
    mockApi(buildReport({ truncated: true }), EMPTY_STALE);
    renderPage();
    expect(await screen.findByText(/hit its per-request limit/i)).toBeInTheDocument();
  });

  it('still renders the stale worklist with SI metrics converted at the display boundary', async () => {
    mockApi(buildReport(), {
      stale_charging: [buildCharging()],
      stale_drives: [buildDrive()],
    });
    renderPage();

    // 42000 Wh → 42.00 kWh, 250000 W → 250.00 kW, 15000 m → 15.00 km,
    // 30 m/s → 108.00 km/h (global useSettings stub: metric, precision 2).
    expect(await screen.findByText('42.00 kWh')).toBeInTheDocument();
    expect(screen.getByText('250.00 kW')).toBeInTheDocument();
    expect(screen.getByText('15.00 km')).toBeInTheDocument();
    expect(screen.getByText('108.00 km/h')).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: 'Open repair form for record #101' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open repair form for record #202' }),
    ).toBeInTheDocument();
  });

  it('keeps only one manual repair form open at a time across the stale panels', async () => {
    mockApi(buildReport(), {
      stale_charging: [buildCharging()],
      stale_drives: [buildDrive()],
    });
    renderPage();

    const chargingRow = await screen.findByRole('button', {
      name: 'Open repair form for record #101',
    });
    const driveRow = screen.getByRole('button', { name: 'Open repair form for record #202' });

    fireEvent.click(chargingRow);
    expect(
      await screen.findByRole('region', { name: 'Repair charging session #101' }),
    ).toBeInTheDocument();

    fireEvent.click(driveRow);
    expect(await screen.findByRole('region', { name: 'Repair drive #202' })).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Repair charging session #101' }),
    ).not.toBeInTheDocument();
  });

  it('refetches BOTH the diagnosis and the stale inventory from the header refresh', async () => {
    mockApi(buildReport(), EMPTY_STALE);
    renderPage();

    await screen.findByText('All charging sessions are complete');

    const refresh = screen.getByTestId('data-repair-refresh');
    expect(refresh).toHaveAttribute('aria-label', 'Refresh');

    const before = mockRequest.mock.calls.length;
    fireEvent.click(refresh);
    await waitFor(() => {
      expect(mockRequest.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
    });
  });
});
