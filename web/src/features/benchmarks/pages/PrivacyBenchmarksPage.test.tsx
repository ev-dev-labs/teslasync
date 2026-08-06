import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  optedIn: false,
  releasesEnabled: true,
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
    return { data: { items: [], limit: 12, offset: 0 } };
  },
  useOptInBenchmarks: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreateBenchmarkRelease: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRevokeBenchmarks: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../components', () => ({
  ConsentGate: () => <div data-testid="consent-gate" />,
  PrivacyBudgetPanel: () => <div data-testid="budget-panel" />,
  CohortEligibilityPanel: () => <div data-testid="cohort-panel" />,
  MetricComparisonGrid: () => <div data-testid="metric-panel" />,
  BenchmarkPercentileChart: () => <div data-testid="chart-panel" />,
  MethodologyPanel: () => <div data-testid="method-panel" />,
  PrivacyControls: () => <div data-testid="controls-panel" />,
}));

import PrivacyBenchmarksPage from './PrivacyBenchmarksPage';

beforeEach(() => {
  hookState.vehicleId = 7;
  hookState.optedIn = false;
  hookState.releasesEnabled = true;
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
});

