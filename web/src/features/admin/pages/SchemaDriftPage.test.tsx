/**
 * SchemaDriftPage contract + hardening tests.
 *
 * The page has a single export (the default `SchemaDriftPage`) composed of
 * several module-private sub-components (KpiBand, FingerprintPanel,
 * BreakdownPanel, GuidancePanel, …). We exercise every branch of the page
 * through its public surface by driving the `useSchemaDrift` hook return:
 *
 *   1. Loading — skeletons show, no drift verdict yet.
 *   2. 503 "subsystem not configured" — AlertBanner + per-section empty
 *      states, and crucially NOT a per-section QueryError (the 503 is an
 *      expected state, surfaced once via the banner).
 *   3. Generic (non-503) error — every section renders <QueryError> with a
 *      working Retry that calls refetch().
 *   4. Clean / no drift — "No drift" verdict, "Match" badges, clean guidance.
 *   5. Drift with count deltas — "Drift detected", signed integer deltas,
 *      "Drift" badges, and the count-driven guidance sentence.
 *   6. Drift with matching counts (hash-only) — "Drift detected" while every
 *      count tile still reads "Match", and the hash-only guidance branch.
 *   7. Refresh action — the header control invokes query.refetch().
 *
 * It also pins the integer-formatting fix: dimensionless schema object
 * counts/deltas must render as integers ("42", "+3"), never with the user's
 * measurement decimal precision ("42.00", "+3.00").
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

// i18n stub: return the fallback string, interpolating {{var}} tokens from
// the options object so assertions can target the rendered English copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useOperatorConfidence', () => ({
  useSchemaDrift: vi.fn(),
}));

import { useSchemaDrift } from '@/api/hooks/useOperatorConfidence';
import { ApiError } from '@/lib/resilience';
import type {
  SchemaDrift,
  SchemaDriftResponse,
  SchemaFingerprint,
} from '@/types/admin-operator-confidence';
import SchemaDriftPage from './SchemaDriftPage';

const mockedUseSchemaDrift = useSchemaDrift as unknown as ReturnType<typeof vi.fn>;

type DriftQuery = UseQueryResult<SchemaDriftResponse, unknown>;

const ARROW = '\u2192'; // → used by the "current → expected" template
const MIDDOT = '\u00b7'; // · used by "current · expected" + change joins

function makeFingerprint(overrides: Partial<SchemaFingerprint> = {}): SchemaFingerprint {
  return {
    sha256: 'a1b2c3d4e5f60011',
    table_count: 42,
    column_count: 128,
    index_count: 40,
    ...overrides,
  };
}

function makeDrift(overrides: Partial<SchemaDrift> = {}): SchemaDrift {
  return {
    has_drift: false,
    current: makeFingerprint(),
    expected: makeFingerprint(),
    table_count_delta: 0,
    column_count_delta: 0,
    index_count_delta: 0,
    expected_generated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(overrides: Partial<DriftQuery> = {}): DriftQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isError: false,
    isFetching: false,
    isStale: false,
    isSuccess: false,
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DriftQuery;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <SchemaDriftPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The real header refresh control is a native <button>; the freshness chip
 * is a <span role="button"> that shares the "Refresh" accessible name. */
function headerRefreshButton(): HTMLElement {
  const el = screen
    .getAllByRole('button', { name: 'Refresh' })
    .find((n) => n.tagName === 'BUTTON');
  if (!el) throw new Error('header refresh button not found');
  return el;
}

beforeEach(() => {
  mockedUseSchemaDrift.mockReset();
});

describe('SchemaDriftPage', () => {
  it('renders the page shell but withholds the drift verdict while loading', () => {
    mockedUseSchemaDrift.mockReturnValue(
      makeQuery({ isLoading: true, isFetching: true, dataUpdatedAt: 0 }),
    );

    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Schema Drift');
    // The KPI status label is always present; its verdict is not, because the
    // tile shows a skeleton until data arrives.
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.queryByText('No drift')).toBeNull();
    expect(screen.queryByText('Drift detected')).toBeNull();
  });

  it('surfaces a 503 as the "subsystem unavailable" banner + empty sections, not an error', () => {
    const err = new ApiError(
      'schema_drift subsystem not configured on this deployment',
      503,
      'SUBSYSTEM_NOT_CONFIGURED',
    );
    mockedUseSchemaDrift.mockReturnValue(
      makeQuery({ error: err, isError: true, errorUpdatedAt: Date.now() }),
    );

    renderPage();

    expect(screen.getByText('Subsystem unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/subsystem is not configured on this deployment/i),
    ).toBeInTheDocument();
    // Sections fall back to their empty state, never a crash.
    expect(screen.getByText('No fingerprint available')).toBeInTheDocument();
    // A 503 must NOT also render a per-section error with a Retry CTA.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });

  it('renders a QueryError with a working Retry in every section on a generic failure', () => {
    const refetch = vi.fn();
    mockedUseSchemaDrift.mockReturnValue(
      makeQuery({
        error: new Error('boom'),
        isError: true,
        errorUpdatedAt: Date.now(),
        refetch: refetch as unknown as DriftQuery['refetch'],
      }),
    );

    renderPage();

    // Three independent data sections each render their own QueryError.
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries.length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Can't reach server").length).toBeGreaterThanOrEqual(3);
    // A generic error is NOT the "not configured" banner.
    expect(screen.queryByText('Subsystem unavailable')).toBeNull();

    fireEvent.click(retries[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows a clean verdict with integer counts when the schema matches the seed', () => {
    const drift = makeDrift(); // counts equal, deltas 0
    mockedUseSchemaDrift.mockReturnValue(
      makeQuery({ data: { drift, is_different: false }, isSuccess: true }),
    );

    renderPage();

    expect(screen.getByText('No drift')).toBeInTheDocument();
    expect(screen.queryByText('Drift detected')).toBeNull();
    expect(
      screen.getByText(/The live schema matches the recorded seed fingerprint/i),
    ).toBeInTheDocument();
    // Every count comparison is a "Match" (3 KPI tiles + 3 breakdown rows).
    expect(screen.getAllByText('Match').length).toBeGreaterThanOrEqual(3);

    // Counts are dimensionless integers — never the 2-decimal measurement
    // precision. The tables row renders "42 → 42", not "42.00 → 42.00".
    expect(screen.getByText(`42 ${ARROW} 42`)).toBeInTheDocument();
    expect(screen.queryByText(`42.00 ${ARROW} 42.00`)).toBeNull();
    expect(screen.queryByText('42.00')).toBeNull();
    // The fingerprint hash is rendered for both the current and seed cards.
    expect(screen.getAllByText('a1b2c3d4e5f60011').length).toBe(2);
  });

  it('shows signed integer deltas + count-driven guidance when object counts drift', () => {
    const drift = makeDrift({
      has_drift: true,
      current: makeFingerprint({ sha256: 'newhash00000001', table_count: 45, column_count: 130, index_count: 41 }),
      expected: makeFingerprint({ sha256: 'oldhash00000000', table_count: 42, column_count: 128, index_count: 40 }),
      table_count_delta: 3,
      column_count_delta: 2,
      index_count_delta: 1,
    });
    mockedUseSchemaDrift.mockReturnValue(
      makeQuery({ data: { drift, is_different: true }, isSuccess: true }),
    );

    renderPage();

    expect(screen.getByText('Drift detected')).toBeInTheDocument();
    expect(screen.queryByText('No drift')).toBeNull();
    // Signed integer delta, not "+3.00".
    expect(screen.getAllByText('+3').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('+3.00')).toBeNull();
    // The tables breakdown row shows the integer transition.
    expect(screen.getByText(`45 ${ARROW} 42`)).toBeInTheDocument();
    // Mismatched categories are badged as "Drift".
    expect(screen.getAllByText('Drift').length).toBeGreaterThanOrEqual(3);
    // Guidance enumerates the concrete count changes.
    expect(
      screen.getByText(
        new RegExp(`Tables \\+3 ${MIDDOT} Columns \\+2 ${MIDDOT} Indexes \\+1`),
      ),
    ).toBeInTheDocument();
  });

  it('flags a hash-only drift (matching counts) as drifted while every count reads Match', () => {
    const drift = makeDrift({
      has_drift: true,
      current: makeFingerprint({ sha256: 'liveaaaaaaaa1111' }),
      expected: makeFingerprint({ sha256: 'seedbbbbbbbb0000' }),
      // counts identical → all deltas 0
    });
    mockedUseSchemaDrift.mockReturnValue(
      makeQuery({ data: { drift, is_different: true }, isSuccess: true }),
    );

    renderPage();

    expect(screen.getByText('Drift detected')).toBeInTheDocument();
    // Deltas are all zero, so each tile/row is still a "Match".
    expect(screen.getAllByText('Match').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('Drift detected but counts')).toBeNull();
    // The guidance falls to the hash-only explanation branch.
    expect(
      screen.getByText(/differs from the seed even though object counts match/i),
    ).toBeInTheDocument();
    // Counts still render as integers in the "42 → 42" transition.
    expect(screen.getByText(`42 ${ARROW} 42`)).toBeInTheDocument();
  });

  it('invokes refetch when the header refresh control is clicked', () => {
    const refetch = vi.fn();
    mockedUseSchemaDrift.mockReturnValue(
      makeQuery({
        data: { drift: makeDrift(), is_different: false },
        isSuccess: true,
        refetch: refetch as unknown as DriftQuery['refetch'],
      }),
    );

    renderPage();

    fireEvent.click(headerRefreshButton());
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
