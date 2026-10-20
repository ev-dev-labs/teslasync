import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { DataQualitySnapshot } from '@/types/admin-operator-confidence';
import { ApiError } from '@/lib/resilience';

const { useDataQualityMock } = vi.hoisted(() => ({ useDataQualityMock: vi.fn() }));
vi.mock('@/api/hooks/useOperatorConfidence', () => ({ useDataQuality: useDataQualityMock }));

import DataQualityPage from './DataQualityPage';

const SNAPSHOT: DataQualitySnapshot = {
  generated_at: '2026-10-01T11:00:00Z',
  window_start: '2026-10-01T10:00:00Z',
  window_end: '2026-10-01T11:00:00Z',
  window_mins: 60,
  required_normalization_version: 1,
  firmware_assignment: 'latest_version_at_window_end',
  firmware_segments: [],
  normalization: {
    required_version: 1, total_sample_count: 1000, versioned_sample_count: 800,
    unversioned_sample_count: 200, coverage_pct: 80, coverage_state: 'measured',
    versions: [{ version: null, sample_count: 200, share_pct: 20 },
      { version: 1, sample_count: 800, share_pct: 80 }],
  },
  fields: [{
    field: 'VehicleSpeed', sample_count: 100, last_seen_at: '2026-10-01T11:00:00Z',
    freshness_seconds: 5, max_gap_seconds: 2, duplicate_ratio: 0,
    versioned_sample_count: 100, unversioned_sample_count: 0,
    normalization_coverage_pct: 100, normalization_coverage_state: 'measured',
    composite_score: 95, severity: 'ok',
  }],
};

function makeQuery(overrides: DataStateSource<DataQualitySnapshot> = {}) {
  return {
    data: undefined, error: null, isLoading: false, isFetching: false, isError: false,
    isPending: false, isSuccess: false, isStale: false, dataUpdatedAt: 0,
    fetchStatus: 'idle' as const, refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>
    <DataQualityPage />
  </MemoryRouter></QueryClientProvider>);
}

function expectSections() {
  expect(screen.getByRole('region', { name: 'Normalization coverage totals' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Normalization version distribution' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Per-field quality and provenance' })).toBeInTheDocument();
}

beforeEach(() => { useDataQualityMock.mockReset(); });

describe('DataQualityPage source-status contract', () => {
  it.each([
    { name: 'nested semantic code', error: new ApiError('Scorer not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED') },
    { name: 'flat httpx exact marker', error: new ApiError('SUBSYSTEM_NOT_CONFIGURED', 503, 'SERVICE_UNAVAILABLE') },
  ])('shows unsupported without simultaneous outage for $name', ({ error }) => {
    useDataQualityMock.mockReturnValue(makeQuery({ error, isError: true }));
    const { container } = renderPage();
    expectSections();
    expect(screen.getAllByText('Feature not supported')).toHaveLength(1);
    expect(container.querySelectorAll('[data-data-state="unsupported"]')).toHaveLength(1);
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeNull();
    expect(container.querySelector('[data-unavailable-reason="service_outage"]')).toBeNull();
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText('No version evidence')).toBeInTheDocument();
    expect(screen.getByText('No field scores')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Refresh' })).toHaveLength(2);
  });

  it.each([
    { name: 'uncoded proxy outage', error: new ApiError('Proxy unavailable', 503) },
    { name: 'generic service code', error: new ApiError('Scoring temporarily unavailable', 503, 'SERVICE_UNAVAILABLE') },
    { name: 'different dependency code', error: new ApiError('Dependency unavailable', 503, 'UPSTREAM_UNAVAILABLE') },
    { name: 'marker embedded in arbitrary text', error: new ApiError('Proxy reports SUBSYSTEM_NOT_CONFIGURED unexpectedly', 503) },
    { name: 'non-503 semantic code', error: new ApiError('Scorer unavailable', 500, 'SUBSYSTEM_NOT_CONFIGURED') },
  ])('keeps outage and every section retry for $name', ({ error }) => {
    const query = makeQuery({ error, isError: true });
    useDataQualityMock.mockReturnValue(query);
    const { container } = renderPage();
    expectSections();
    expect(screen.queryByText('Feature not supported')).not.toBeInTheDocument();
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(3);
    retries.forEach(retry => fireEvent.click(retry));
    expect(query.refetch).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(query.refetch).toHaveBeenCalledTimes(4);
  });

  it('forwards healthy refreshing state while keeping all measured values and sections', () => {
    useDataQualityMock.mockReturnValue(makeQuery({
      data: SNAPSHOT, dataUpdatedAt: Date.now(), isFetching: true, fetchStatus: 'fetching',
    }));
    renderPage();
    expectSections();
    const brief = screen.getByTestId('normalization-coverage-summary');
    assertOperationalBriefDisclosure(brief, 'Refreshing source');
    expect(brief).not.toHaveTextContent('Source loaded');
    expect(brief.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(6);
    expect(brief).toHaveTextContent('80.00%');
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Per-field quality and provenance' })).toHaveTextContent('VehicleSpeed');
    expect(useDataQualityMock.mock.calls[0]).toEqual([]);
  });

  it.each([
    { name: 'ordinary outage', error: new ApiError('Temporarily unavailable', 503) },
    { name: 'explicit missing subsystem', error: new ApiError('SUBSYSTEM_NOT_CONFIGURED', 503, 'SERVICE_UNAVAILABLE') },
  ])('retains measurements rather than declaring unsupported after a refresh: $name', ({ error }) => {
    useDataQualityMock.mockReturnValue(makeQuery({ data: SNAPSHOT, error, isError: true, dataUpdatedAt: Date.now() }));
    const { container } = renderPage();
    expectSections();
    expect(screen.queryByText('Feature not supported')).not.toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeNull();
    assertOperationalBriefDisclosure(screen.getByTestId('normalization-coverage-summary'), 'Retained source', { contains: true });
    expect(screen.getByRole('table', { name: 'Per-field quality and provenance' })).toHaveTextContent('VehicleSpeed');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry unavailable sources' })).toBeInTheDocument();
  });

  it('keeps cold-paused unknown readings and section refresh actions without inventing configuration failure', () => {
    const query = makeQuery({ isPending: true, fetchStatus: 'paused' });
    useDataQualityMock.mockReturnValue(query);
    const { container } = renderPage();
    expectSections();
    expect(screen.queryByText('Feature not supported')).not.toBeInTheDocument();
    expect(container.querySelector('[data-unavailable-reason="service_outage"]')).toBeNull();
    const brief = screen.getByTestId('normalization-coverage-summary');
    assertOperationalBriefDisclosure(brief, 'Awaiting source');
    // Unknown tiles are omitted from the face (never zero-filled); only the
    // contract-version tile survives, reading 'Unknown'.
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(brief.querySelector('[data-operational-metric="normalization-coverage"]')).toBeNull();
    expect(brief.querySelector('[data-operational-metric="normalization-total"]')).toBeNull();
    expect(within(brief).getByText('Required version')).toBeInTheDocument();
    expect(within(brief).getByText('Unknown')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('5 empty fields are hidden.');
    screen.getAllByRole('button', { name: 'Refresh' }).forEach(button => fireEvent.click(button));
    expect(query.refetch).toHaveBeenCalledTimes(2);
  });

  it('keeps paused retained source independent from unsupported and preserves source retry', () => {
    useDataQualityMock.mockReturnValue(makeQuery({
      data: SNAPSHOT, isPending: true, fetchStatus: 'paused', dataUpdatedAt: Date.now(),
    }));
    const { container } = renderPage();
    expectSections();
    expect(screen.queryByText('Feature not supported')).not.toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    assertOperationalBriefDisclosure(screen.getByTestId('normalization-coverage-summary'), 'Retained source', { contains: true });
    expect(screen.getByRole('table', { name: 'Per-field quality and provenance' })).toHaveTextContent('VehicleSpeed');
    expect(screen.getByRole('button', { name: 'Retry unavailable sources' })).toBeInTheDocument();
  });

  it('preserves first-load section shells and suppresses fabricated measurements', () => {
    useDataQualityMock.mockReturnValue(makeQuery({ isPending: true, isLoading: true, isFetching: true, fetchStatus: 'fetching' }));
    renderPage();
    expectSections();
    const brief = screen.getByTestId('normalization-coverage-summary');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    assertOperationalBriefDisclosure(brief, 'Loading source', { contains: true });
    expect(brief).not.toHaveTextContent('Refreshing source');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });
});
