/**
 * NormalizationCoverageKpis — coverage KPI band for the Data Quality page.
 *
 * The load-bearing assertion in this file is the one that would be easiest to
 * regress: when the backend reports `coverage_state: 'unknown'` with a null
 * `coverage_pct` (an empty scoring window), the coverage card MUST render the
 * word "Unknown" and must NOT render "0.0%". Coercing null → 0 would let the
 * page claim a failing coverage measurement that was never taken.
 *
 * Also pinned here:
 *   - a measured 0 % IS shown as 0.0% (rows observed, none attested) and is
 *     visually distinct from the unknown state;
 *   - partial coverage shows the real attested / unattested counts;
 *   - the loading branch renders six skeletons and no values;
 *   - the error branch renders QueryError inside a panel and wires Retry,
 *     taking precedence over loading so the section is never left blank.
 *
 * `react-i18next` is mocked to echo English fallbacks with `{{var}}`
 * interpolation; `useOnlineStatus` is pinned online so QueryError's copy is
 * deterministic. QueryError pulls in `useNavigate`, so renders are wrapped in
 * a MemoryRouter.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { NormalizationCoverageKpis } from './NormalizationCoverageKpis';
import { ApiError } from '@/lib/resilience';
import type {
  DataQualityFieldScore,
  NormalizationSummary,
} from '@/types/admin-operator-confidence';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

function makeSummary(overrides: Partial<NormalizationSummary> = {}): NormalizationSummary {
  return {
    required_version: 1,
    total_sample_count: 1000,
    versioned_sample_count: 800,
    unversioned_sample_count: 200,
    coverage_pct: 80,
    coverage_state: 'measured',
    versions: [],
    ...overrides,
  };
}

function makeField(overrides: Partial<DataQualityFieldScore> = {}): DataQualityFieldScore {
  return {
    field: 'VehicleSpeed',
    sample_count: 100,
    last_seen_at: '2026-08-29T12:00:00Z',
    freshness_seconds: 5,
    max_gap_seconds: 1,
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

function renderBand(props: Partial<Parameters<typeof NormalizationCoverageKpis>[0]> = {}) {
  return render(
    <MemoryRouter>
      <NormalizationCoverageKpis
        normalization={makeSummary()}
        fields={[]}
        windowMins={60}
        loading={false}
        error={null}
        onRetry={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('NormalizationCoverageKpis', () => {
  it('renders every KPI card with its label', () => {
    renderBand();
    expect(screen.getByText('Samples in window')).toBeInTheDocument();
    expect(screen.getByText('Version-attested')).toBeInTheDocument();
    expect(screen.getByText('Unattested')).toBeInTheDocument();
    expect(screen.getByText('Attested coverage')).toBeInTheDocument();
    expect(screen.getByText('Required version')).toBeInTheDocument();
    expect(screen.getByText('Critical fields')).toBeInTheDocument();
  });

  it('shows "Unknown" — never 0.0% — when the aggregate coverage is null', () => {
    renderBand({
      normalization: makeSummary({
        total_sample_count: 0,
        versioned_sample_count: 0,
        unversioned_sample_count: 0,
        coverage_pct: null,
        coverage_state: 'unknown',
      }),
    });

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(
      screen.getByText('No samples were observed in this window'),
    ).toBeInTheDocument();
    // The exact regression this page exists to prevent.
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('distinguishes a measured 0% from an unknown coverage', () => {
    renderBand({
      normalization: makeSummary({
        total_sample_count: 500,
        versioned_sample_count: 0,
        unversioned_sample_count: 500,
        coverage_pct: 0,
        coverage_state: 'measured',
      }),
    });

    // Rows WERE observed and none were attested — that is a real 0 %.
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.getByText('0 of 500 rows')).toBeInTheDocument();
  });

  it('surfaces partial coverage with the underlying attested / unattested counts', () => {
    renderBand({
      normalization: makeSummary({
        total_sample_count: 1000,
        versioned_sample_count: 750,
        unversioned_sample_count: 250,
        coverage_pct: 75,
        coverage_state: 'measured',
      }),
    });

    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('750 of 1,000 rows')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('counts only critical fields in the critical KPI', () => {
    renderBand({
      fields: [
        makeField({ field: 'a', severity: 'critical', composite_score: 10 }),
        makeField({ field: 'b', severity: 'critical', composite_score: 20 }),
        makeField({ field: 'c', severity: 'warn', composite_score: 60 }),
        makeField({ field: 'd', severity: 'ok', composite_score: 95 }),
      ],
    });
    expect(screen.getByText('Composite score below 50')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders skeletons and no values while the first fetch is in flight', () => {
    renderBand({ normalization: undefined, loading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Attested coverage')).not.toBeInTheDocument();
  });

  it('keeps showing cached values during a background refetch', () => {
    renderBand({ loading: true });
    expect(screen.getByText('80.0%')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the error branch with a working retry, taking precedence over loading', () => {
    const onRetry = vi.fn();
    renderBand({
      normalization: undefined,
      loading: true,
      error: new ApiError('boom', 500),
      onRetry,
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry|try again/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('degrades to zeros without hiding the region when the payload is missing', () => {
    renderBand({ normalization: undefined, windowMins: undefined });
    // Panel stays mounted — no hidden sections.
    expect(screen.getByText('Samples in window')).toBeInTheDocument();
    // Coverage has no measurement, so it must read Unknown, not 0.0%.
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });
});
