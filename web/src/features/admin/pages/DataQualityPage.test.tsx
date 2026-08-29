/**
 * DataQualityPage — orchestration + branch coverage.
 *
 * The page is a thin orchestrator over three child sections. Its own behaviour
 * (the surface under test here) is:
 *
 *   1. `useDataQuality()` is called with no arguments — the scoring window is a
 *      server-side concern, so the page must not invent one.
 *   2. 503 "subsystem missing" detection → explanatory notice + `sectionError`
 *      suppression so every section renders a calm empty state, not a red error.
 *   3. generic-error pass-through → `sectionError` handed to every section.
 *   4. null-safe `fields` / `normalization` extraction, including a payload
 *      that omits `fields` entirely.
 *   5. every panel stays mounted in every state — loading, error, 503, empty.
 *   6. a null aggregate coverage reaches the KPI band untouched so it can be
 *      rendered as "Unknown" rather than a fabricated 0 %.
 *
 * Strategy: render the REAL page shell and stub only the three data sections so
 * we can capture the exact props the page computed. Network is never touched.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// jsdom lacks matchMedia; framer-motion / useMotionPreference (reached via the
// page's <FadeIn> + PageContainer freshness chip) read it at module load.
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

const { useDataQualityMock, captured } = vi.hoisted(() => ({
  useDataQualityMock: vi.fn(),
  captured: {} as Record<string, Record<string, unknown>>,
}));

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

vi.mock('@/api/hooks/useOperatorConfidence', async () => {
  const actual = await vi.importActual<
    typeof import('@/api/hooks/useOperatorConfidence')
  >('@/api/hooks/useOperatorConfidence');
  return {
    ...actual,
    useDataQuality: (...args: unknown[]) => useDataQualityMock(...args),
  };
});

// Stub ONLY the three data sections; keep the real helpers so the page's own
// derivation logic still runs.
vi.mock('../components/data-quality', async () => {
  const actual = await vi.importActual<
    typeof import('../components/data-quality')
  >('../components/data-quality');
  const React = await vi.importActual<typeof import('react')>('react');
  const makeStub = (name: string, testid: string) =>
    function Stub(props: Record<string, unknown>) {
      captured[name] = props;
      return React.createElement('div', { 'data-testid': testid });
    };
  return {
    ...actual,
    NormalizationCoverageKpis: makeStub('kpis', 'stub-kpis'),
    NormalizationVersionPanel: makeStub('versions', 'stub-versions'),
    FieldQualityTable: makeStub('fields', 'stub-fields'),
  };
});

import DataQualityPage from './DataQualityPage';
import { ApiError } from '@/lib/resilience';
import type {
  DataQualityFieldScore,
  DataQualitySnapshot,
} from '@/types/admin-operator-confidence';

interface FakeQuery {
  data?: DataQualitySnapshot;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

function makeQuery(overrides: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeField(overrides: Partial<DataQualityFieldScore> = {}): DataQualityFieldScore {
  return {
    field: 'VehicleSpeed',
    sample_count: 100,
    last_seen_at: '2026-08-29T12:00:00Z',
    freshness_seconds: 5,
    max_gap_seconds: 2,
    duplicate_ratio: 0,
    versioned_sample_count: 100,
    unversioned_sample_count: 0,
    normalization_coverage_pct: 100,
    normalization_coverage_state: 'measured',
    composite_score: 100,
    severity: 'ok',
    ...overrides,
  };
}

const SNAPSHOT: DataQualitySnapshot = {
  generated_at: '2026-08-29T12:00:00Z',
  window_start: '2026-08-29T11:00:00Z',
  window_end: '2026-08-29T12:00:00Z',
  window_mins: 60,
  required_normalization_version: 1,
  normalization: {
    required_version: 1,
    total_sample_count: 1000,
    versioned_sample_count: 800,
    unversioned_sample_count: 200,
    coverage_pct: 80,
    coverage_state: 'measured',
    versions: [
      { version: null, sample_count: 200, share_pct: 20 },
      { version: 1, sample_count: 800, share_pct: 80 },
    ],
  },
  firmware_assignment: 'latest_version_at_window_end',
  firmware_segments: [],
  fields: [
    makeField({ field: 'VehicleSpeed', composite_score: 95 }),
    makeField({
      field: 'Gear',
      composite_score: 20,
      severity: 'critical',
      versioned_sample_count: 0,
      unversioned_sample_count: 100,
      normalization_coverage_pct: 0,
    }),
  ],
};

const EMPTY_SNAPSHOT: DataQualitySnapshot = {
  ...SNAPSHOT,
  normalization: {
    required_version: 1,
    total_sample_count: 0,
    versioned_sample_count: 0,
    unversioned_sample_count: 0,
    coverage_pct: null,
    coverage_state: 'unknown',
    versions: [],
  },
  fields: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DataQualityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useDataQualityMock.mockReset();
  for (const key of Object.keys(captured)) delete captured[key];
});

describe('DataQualityPage', () => {
  it('renders the page title and mounts all three sections', () => {
    useDataQualityMock.mockReturnValue(makeQuery({ data: SNAPSHOT }));
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Data Quality' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('stub-kpis')).toBeInTheDocument();
    expect(screen.getByTestId('stub-versions')).toBeInTheDocument();
    expect(screen.getByTestId('stub-fields')).toBeInTheDocument();
  });

  it('calls useDataQuality with no arguments — the window is a server concern', () => {
    useDataQualityMock.mockReturnValue(makeQuery({ data: SNAPSHOT }));
    renderPage();

    expect(useDataQualityMock).toHaveBeenCalled();
    expect(useDataQualityMock.mock.calls[0]).toEqual([]);
  });

  it('passes the normalization aggregate and fields straight through', () => {
    useDataQualityMock.mockReturnValue(makeQuery({ data: SNAPSHOT }));
    renderPage();

    expect(captured.kpis.normalization).toBe(SNAPSHOT.normalization);
    expect(captured.versions.normalization).toBe(SNAPSHOT.normalization);
    expect(captured.fields.fields).toBe(SNAPSHOT.fields);
    expect(captured.kpis.windowMins).toBe(60);
    expect(captured.kpis.error).toBeNull();
  });

  it('forwards a null aggregate coverage untouched so the band can say "Unknown"', () => {
    useDataQualityMock.mockReturnValue(makeQuery({ data: EMPTY_SNAPSHOT }));
    renderPage();

    const normalization = captured.kpis.normalization as { coverage_pct: number | null; coverage_state: string };
    // The page must NOT coerce null → 0 on the way to the display layer.
    expect(normalization.coverage_pct).toBeNull();
    expect(normalization.coverage_state).toBe('unknown');
    // Panels stay mounted on an empty window.
    expect(screen.getByTestId('stub-kpis')).toBeInTheDocument();
    expect(screen.getByTestId('stub-versions')).toBeInTheDocument();
    expect(screen.getByTestId('stub-fields')).toBeInTheDocument();
    expect((captured.fields.fields as unknown[]).length).toBe(0);
  });

  it('propagates the loading flag with empty derives during the first fetch', () => {
    useDataQualityMock.mockReturnValue(
      makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 }),
    );
    renderPage();

    expect(captured.kpis.loading).toBe(true);
    expect(captured.versions.loading).toBe(true);
    expect(captured.fields.loading).toBe(true);
    expect(captured.kpis.normalization).toBeUndefined();
    expect((captured.fields.fields as unknown[]).length).toBe(0);
  });

  it('shows the subsystem-missing notice and suppresses section errors on a 503', () => {
    const err = new ApiError('subsystem not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED');
    useDataQualityMock.mockReturnValue(
      makeQuery({ error: err, isError: true, dataUpdatedAt: 0 }),
    );
    renderPage();

    expect(screen.getByText('Feature not supported')).toBeInTheDocument();
    expect(screen.getByText(/data-quality scorer is not configured/i)).toBeInTheDocument();
    expect(captured.kpis.error).toBeNull();
    expect(captured.versions.error).toBeNull();
    expect(captured.fields.error).toBeNull();
    // Panels remain mounted behind the notice.
    expect(screen.getByTestId('stub-fields')).toBeInTheDocument();
  });

  it('passes a generic (non-503) error straight through to every section', () => {
    const err = new ApiError('boom', 500);
    useDataQualityMock.mockReturnValue(
      makeQuery({ error: err, isError: true, dataUpdatedAt: 0 }),
    );
    renderPage();

    expect(screen.queryByText('Feature not supported')).not.toBeInTheDocument();
    expect(captured.kpis.error).toBe(err);
    expect(captured.versions.error).toBe(err);
    expect(captured.fields.error).toBe(err);
  });

  it('degrades safely when the payload omits the fields array', () => {
    const partial = {
      ...SNAPSHOT,
      fields: undefined,
    } as unknown as DataQualitySnapshot;
    useDataQualityMock.mockReturnValue(makeQuery({ data: partial }));
    renderPage();

    expect((captured.fields.fields as unknown[]).length).toBe(0);
    expect((captured.kpis.fields as unknown[]).length).toBe(0);
    expect(captured.kpis.normalization).toBe(SNAPSHOT.normalization);
  });

  it('wires every section retry to a single refetch', () => {
    const query = makeQuery({ data: SNAPSHOT });
    useDataQualityMock.mockReturnValue(query);
    renderPage();

    (captured.kpis.onRetry as () => void)();
    (captured.versions.onRetry as () => void)();
    (captured.fields.onRetry as () => void)();
    expect(query.refetch).toHaveBeenCalledTimes(3);
  });
});
