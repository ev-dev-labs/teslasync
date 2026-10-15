import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataState } from '@/api/dataState';
import type { BenchmarkReleasePage } from '@/api/hooks/useBenchmarks';

const hookState = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  optedIn: false,
  releasesEnabled: true,
  releaseError: null as Error | null,
  releaseLoading: false,
  releasePaused: false,
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: hookState.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));
vi.mock('@/api/hooks/useBenchmarks', () => ({
  useBenchmarkPrivacyStatus: () => ({
    data: {
      vehicle_id: 7,
      opted_in: hookState.optedIn,
      opted_in_at: null,
      revoked_at: null,
      epsilon_budget: 4,
      epsilon_spent: 0,
      epsilon_remaining: 4,
      minimum_cohort_size: 5,
      mechanism_version: 1,
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    isStale: false,
    error: null,
  }),
  useBenchmarkReleases: (_vehicleId: number | null, _limit: number, _offset: number, enabled: boolean) => {
    hookState.releasesEnabled = enabled;
    return {
      data: { items: [], limit: 12, offset: 0 },
      error: hookState.releaseError,
      isLoading: hookState.releaseLoading,
      fetchStatus: hookState.releasePaused ? 'paused' : 'idle',
    };
  },
  useOptInBenchmarks: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreateBenchmarkRelease: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRevokeBenchmarks: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../components', () => ({
  ConsentGate: () => <div data-testid="consent-gate" />,
  PrivacyBudgetPanel: () => <div data-testid="budget-panel" />,
  CohortEligibilityPanel: () => <div data-testid="cohort-panel" />,
  MetricComparisonGrid: ({ source, loading, optedIn }: {
    source: DataState<BenchmarkReleasePage>; loading: boolean; optedIn: boolean;
  }) => <div data-testid="metric-panel" data-source-state={source.status}
    data-provenance={source.provenance} data-loading={String(loading)} data-opted-in={String(optedIn)} />,
  BenchmarkPercentileChart: () => <div data-testid="chart-panel" />,
  MethodologyPanel: () => <div data-testid="method-panel" />,
  PrivacyControls: () => <div data-testid="controls-panel" />,
}));

import PrivacyBenchmarksPage from './PrivacyBenchmarksPage';

beforeEach(() => {
  hookState.vehicleId = 7;
  hookState.optedIn = false;
  hookState.releasesEnabled = true;
  hookState.releaseError = null;
  hookState.releaseLoading = false;
  hookState.releasePaused = false;
});

describe('PrivacyBenchmarksPage', () => {
  it('keeps every privacy panel visible while opted out and suppresses release reads', () => {
    render(<PrivacyBenchmarksPage />);
    for (const testId of [
      'consent-gate',
      'budget-panel',
      'cohort-panel',
      'metric-panel',
      'chart-panel',
      'method-panel',
      'controls-panel',
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(hookState.releasesEnabled).toBe(false);
  });

  it('renders an explicit vehicle-selection state instead of firing data controls', () => {
    hookState.vehicleId = null;
    render(
      <MemoryRouter>
        <PrivacyBenchmarksPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Select a vehicle')).toBeInTheDocument();
    expect(screen.queryByTestId('consent-gate')).not.toBeInTheDocument();
  });

  it('passes retained historical release trust to comparisons without hiding the other sections', () => {
    hookState.optedIn = true;
    hookState.releaseError = new Error('release refresh failed');
    render(<PrivacyBenchmarksPage />);
    expect(screen.getByTestId('metric-panel')).toHaveAttribute('data-source-state', 'stale');
    expect(screen.getByTestId('metric-panel')).toHaveAttribute('data-provenance', 'historical');
    expect(screen.getByTestId('chart-panel')).toBeInTheDocument();
    expect(screen.getByTestId('cohort-panel')).toBeInTheDocument();
    expect(screen.getByTestId('controls-panel')).toBeInTheDocument();
    expect(hookState.releasesEnabled).toBe(true);
  });

  it('passes paused release trust and does not present disabled opted-out reads as loading', () => {
    hookState.releasePaused = true;
    hookState.releaseLoading = true;
    render(<PrivacyBenchmarksPage />);
    expect(screen.getByTestId('metric-panel')).toHaveAttribute('data-source-state', 'stale');
    expect(screen.getByTestId('metric-panel')).toHaveAttribute('data-loading', 'false');
    expect(screen.getByTestId('metric-panel')).toHaveAttribute('data-opted-in', 'false');
    expect(hookState.releasesEnabled).toBe(false);
  });
});
