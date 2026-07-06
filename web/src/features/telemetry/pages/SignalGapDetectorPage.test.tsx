/**
 * SignalGapDetectorPage — orchestration, derivation + branch coverage.
 *
 * SignalGapDetectorPage is a thin orchestrator that fans the live-signal map
 * out into a KPI band, a hero health/freshness bento, and a full signal
 * catalog. The surface under test here is the page's OWN behaviour:
 *
 *   1. The vehicle-selection derivation: `vid` / `hasVehicle` branch off the
 *      global `useSelectedVehicle` store — `null`, `0` and negative ids all
 *      collapse to the no-vehicle posture (prompt banner, disabled refresh,
 *      `hasVehicle=false` handed to every section); a positive id enables the
 *      whole cockpit.
 *   2. The REAL `useSignalGapAnalysis` + `signalGapUtils` staleness math is
 *      exercised end-to-end (only the lowest-level `useSignalGaps` query is
 *      mocked), so the exact `buckets` / `freshnessPct` / `topStale` the page
 *      derives are asserted where they land on the child sections.
 *   3. Every section renders in every posture — loading and error do NOT gate
 *      the page behind a single data check; each panel owns its own state.
 *   4. The refresh action wiring (`query.refetch`) and its `disabled` guard.
 *   5. i18n fallbacks match the real `en.json` resource (tab title + H1 both
 *      resolve to "Signal Gaps").
 *
 * Strategy (mirrors ./`DrivetrainHealthPage.test.tsx` / `SpeedProfilePage.test.tsx`):
 *   - `useSignalGaps` + the vehicle selector are mocked with hoisted vi.fn()s
 *     so the network is never touched and each render is deterministic. The
 *     REAL `useSignalGapAnalysis` / `deriveSignalRows` / `computeGapBuckets` /
 *     `computeFreshnessPct` run, so the derivations are genuinely exercised.
 *   - The 4 sections + the toolbar VehicleSelect are stubbed to capture the
 *     exact props the page computed (createElement keeps jsx-a11y off the mock
 *     markup), keeping orchestration assertions crisp and avoiding recharts /
 *     ProgressRing rendering that jsdom's unmeasured container can't support.
 *   - react-i18next resolves the developer fallback string, interpolating
 *     `{{vars}}`.
 *
 * user-event is intentionally NOT a dependency of this codebase (see
 * web/package.json) — interactions use fireEvent, consistent with the other
 * page tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// jsdom lacks matchMedia; framer-motion (<FadeIn>) + PageContainer's freshness
// chip read it at module load for the reduced-motion preference.
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

// Shared, hoisted test doubles so the mock factories below and the specs can
// both reach them.
const { signalGapsMock, selectedVehicleMock, refetchMock, captured } = vi.hoisted(() => ({
  signalGapsMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  refetchMock: vi.fn(),
  captured: {} as Record<string, Record<string, unknown>>,
}));

// i18n → return the developer fallback string, interpolating `{{vars}}`.
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
  };
});

// Drive the analysis deterministically without any network: mock ONLY the
// low-level query so the REAL useSignalGapAnalysis + signalGapUtils derive the
// buckets / freshness / topStale under test.
vi.mock('@/api/hooks/useTelemetry', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useTelemetry')>('@/api/hooks/useTelemetry');
  return {
    ...actual,
    useSignalGaps: (...args: unknown[]) => signalGapsMock(...args),
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => selectedVehicleMock() }));

// Stub the toolbar vehicle picker. createElement (not JSX) keeps jsx-a11y off
// the mock markup.
vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: function VehicleSelectStub() {
      return React.createElement('div', { 'data-testid': 'vehicle-select' });
    },
  };
});

// Stub the 4 sections so we can capture the exact props the page computed.
vi.mock('../components/SignalGapKpis', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    SignalGapKpis: function SignalGapKpisStub(props: Record<string, unknown>) {
      captured.kpis = props;
      return React.createElement('div', { 'data-testid': 'kpis' });
    },
  };
});
vi.mock('../components/SignalGapHealthPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    SignalGapHealthPanel: function SignalGapHealthPanelStub(props: Record<string, unknown>) {
      captured.health = props;
      return React.createElement('div', { 'data-testid': 'health' });
    },
  };
});
vi.mock('../components/SignalGapFreshnessPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    SignalGapFreshnessPanel: function SignalGapFreshnessPanelStub(props: Record<string, unknown>) {
      captured.freshness = props;
      return React.createElement('div', { 'data-testid': 'freshness' });
    },
  };
});
vi.mock('../components/SignalCatalogPanel', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    SignalCatalogPanel: function SignalCatalogPanelStub(props: Record<string, unknown>) {
      captured.catalog = props;
      return React.createElement('div', { 'data-testid': 'catalog' });
    },
  };
});

import SignalGapDetectorPage from './SignalGapDetectorPage';
import { __resetTitleStoreForTests } from '@/lib/titleStore';
import type { SignalGapAnalysis } from '../hooks/useSignalGapAnalysis';
import type { GapBuckets } from '../signalGapUtils';

/* ── Fixtures ─────────────────────────────────────────────────────── */

type LiveEntry = { value: unknown; timestamp: string | null };

function makeQuery(
  overrides: { data?: unknown; isLoading?: boolean; error?: unknown; refetch?: () => void } = {},
) {
  return {
    data: overrides.data,
    isLoading: overrides.isLoading ?? false,
    isFetching: false,
    isStale: false,
    isError: overrides.error != null,
    error: overrides.error ?? null,
    dataUpdatedAt: Date.now(),
    refetch: overrides.refetch ?? refetchMock,
  };
}

// Built fresh in beforeEach so staleness (measured against render-time
// Date.now()) is a few ms — well inside each bucket's wide margin.
let live: Record<string, LiveEntry>;

const REFRESH = { name: 'Refresh signals' } as const;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SignalGapDetectorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(captured)) delete captured[key];
  __resetTitleStoreForTests();

  const now = Date.now();
  live = {
    battery_level: { value: 82, timestamp: new Date(now - 5_000).toISOString() }, // active (<30s)
    vehicle_speed: { value: 60, timestamp: new Date(now - 120_000).toISOString() }, // aging (<5min)
    tpms_fl: { value: 2.9, timestamp: new Date(now - 600_000).toISOString() }, // stale (>5min)
    odometer: { value: 12_345, timestamp: null }, // never received
  };

  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  signalGapsMock.mockReturnValue(makeQuery({ data: live }));
});

/* ── Specs ────────────────────────────────────────────────────────── */

describe('SignalGapDetectorPage — no vehicle selected', () => {
  it('shows the select-vehicle prompt and disables refresh when vehicleId is null', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    renderPage();

    // The prompt banner is the ONLY place the prompt text renders (sections stubbed).
    expect(
      screen.getByText('Select a vehicle to inspect its signal freshness.'),
    ).toBeInTheDocument();

    const refresh = screen.getByRole('button', REFRESH);
    expect(refresh).toBeDisabled();
    // A disabled button never fires onClick → refetch stays untouched.
    fireEvent.click(refresh);
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it('hands hasVehicle=false + a catalog scoped to vehicleId 0 to every section', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    renderPage();

    expect(captured.kpis.hasVehicle).toBe(false);
    expect(captured.health.hasVehicle).toBe(false);
    expect(captured.freshness.hasVehicle).toBe(false);
    expect(captured.catalog.vehicleId).toBe(0);
    expect(captured.catalog.showSummary).toBe(false);
    // The underlying live query is called with the sentinel id (disabled upstream).
    expect(signalGapsMock).toHaveBeenCalledWith(0);
  });

  it.each([
    ['zero', 0],
    ['negative', -3],
  ])('treats a %s vehicleId as no-vehicle', (_label, id) => {
    selectedVehicleMock.mockReturnValue({ vehicleId: id });
    renderPage();

    expect(screen.getByRole('button', REFRESH)).toBeDisabled();
    expect(captured.kpis.hasVehicle).toBe(false);
    expect(signalGapsMock).toHaveBeenCalledWith(0);
  });
});

describe('SignalGapDetectorPage — vehicle selected', () => {
  it('renders the header, hides the prompt, and enables refresh', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Signal Gaps' })).toBeInTheDocument();
    expect(
      screen.getByText('Identify signals that have stopped arriving or have gaps'),
    ).toBeInTheDocument();
    // No banner once a vehicle is chosen.
    expect(
      screen.queryByText('Select a vehicle to inspect its signal freshness.'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', REFRESH)).toBeEnabled();
    // The picker + all four sections mount — nothing is gutted or hidden.
    expect(screen.getByTestId('vehicle-select')).toBeInTheDocument();
    expect(screen.getByTestId('kpis')).toBeInTheDocument();
    expect(screen.getByTestId('health')).toBeInTheDocument();
    expect(screen.getByTestId('freshness')).toBeInTheDocument();
    expect(screen.getByTestId('catalog')).toBeInTheDocument();
  });

  it('feeds the REAL staleness derivation to the KPI band + panels', () => {
    renderPage();

    // deriveSignalRows → computeGapBuckets: 1 per bucket across the 4 fixtures.
    expect(captured.kpis.buckets).toEqual<GapBuckets>({
      total: 4,
      active: 1,
      aging: 1,
      stale: 1,
      never: 1,
    });
    // computeFreshnessPct: (active + aging) / total = 2/4 → 50%.
    expect(captured.kpis.freshnessPct).toBe(50);
    expect(captured.kpis.hasVehicle).toBe(true);

    // Both panels receive the SAME analysis object the page destructured once,
    // and the KPI buckets are that analysis' buckets (referential identity).
    const analysis = captured.health.analysis as SignalGapAnalysis;
    expect(captured.freshness.analysis).toBe(analysis);
    expect(captured.kpis.buckets).toBe(analysis.buckets);

    // Only the stale (non-null, >= aging window) signal surfaces as top-stale.
    expect(analysis.topStale.map((r) => r.name)).toEqual(['tpms_fl']);
    expect(analysis.freshnessPct).toBe(50);

    // The catalog is scoped to the selected vehicle, summary suppressed.
    expect(captured.catalog.vehicleId).toBe(42);
    expect(captured.catalog.showSummary).toBe(false);
    expect(captured.catalog.title).toBe('Signal Catalog');
  });

  it('wires the refresh button straight to query.refetch', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', REFRESH));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it('drives the tab title + H1 from the same "Signal Gaps" resource fallback', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Signal Gaps' })).toBeInTheDocument();
    expect(document.title).toContain('Signal Gaps');
  });
});

describe('SignalGapDetectorPage — degraded data postures', () => {
  it('still renders every section while the live query is loading', () => {
    signalGapsMock.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    renderPage();

    // Sections are NOT gated behind a single loading check.
    expect(screen.getByTestId('kpis')).toBeInTheDocument();
    expect(screen.getByTestId('health')).toBeInTheDocument();
    expect(screen.getByTestId('catalog')).toBeInTheDocument();
    // No data yet → empty buckets, but hasVehicle stays true.
    expect((captured.kpis.buckets as GapBuckets).total).toBe(0);
    expect(captured.kpis.freshnessPct).toBe(0);
    expect(captured.kpis.hasVehicle).toBe(true);
  });

  it('keeps the page + a working refresh affordance on a query error', () => {
    signalGapsMock.mockReturnValue(makeQuery({ error: new Error('boom') }));
    renderPage();

    // The page does not blank out — sections still mount and own their errors.
    expect(screen.getByTestId('kpis')).toBeInTheDocument();
    expect(screen.getByTestId('freshness')).toBeInTheDocument();
    // Refresh stays enabled so the user can retry.
    const refresh = screen.getByRole('button', REFRESH);
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
