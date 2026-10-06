import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import CostAnalysisPage from '../../pages/CostAnalysisPage';
import { coreStats, lifetimeMetrics, gasComparison, hourlyData, touInsights, forecastData } from './fixtures.test-utils';

const mocks = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: vi.fn(),
  forecast: vi.fn(),
  derivations: vi.fn(),
  apply: vi.fn(), resetRange: vi.fn(), refetch: vi.fn(),
  CostSummaryCards: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  ChargerTypeBreakdown: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  SavingsCalculator: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  TimeOfUseAnalysis: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  LifetimeSummary: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  EnvironmentalImpact: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  BillVarianceCard: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  CostForecastSection: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback: string, options?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? '')),
  }),
}));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ isMiles: true }) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: { distance: 'mi' } }) }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: mocks.vehicleId }) }));
vi.mock('@/hooks/useSavedViewUrl', () => ({ useSavedViewUrl: () => ({ currentQuery: '?from=2026-01-01&to=2026-01-31', apply: mocks.apply }) }));
vi.mock('@/hooks/useRangeState', () => ({ useRangeState: () => ({ start: '2026-01-01', end: '2026-01-31', reset: mocks.resetRange }) }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessionsPaginated: mocks.query, useCostForecast: mocks.forecast,
}));
vi.mock('../cost-analysis/useCostAnalysisData', () => ({ useCostAnalysisData: mocks.derivations }));
vi.mock('@/features/charging/components/stat-modernization', async importOriginal => {
  const actual = await importOriginal<typeof import('./index')>();
  return { ...actual,
    CostSummaryCards: mocks.CostSummaryCards, ChargerTypeBreakdown: mocks.ChargerTypeBreakdown,
    SavingsCalculator: mocks.SavingsCalculator, TimeOfUseAnalysis: mocks.TimeOfUseAnalysis,
    LifetimeSummary: mocks.LifetimeSummary, EnvironmentalImpact: mocks.EnvironmentalImpact,
    BillVarianceCard: mocks.BillVarianceCard, CostForecastSection: mocks.CostForecastSection,
  };
});
vi.mock('../cost-analysis', () => ({
  MonthlyCostChart: () => null, CostPerKwhChart: () => null, MonthlyCostTable: () => null,
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/data-display', () => ({ SavedViewMenu: () => null }));
vi.mock('@/components/ui', () => ({ PrintButton: () => null }));
vi.mock('@/components/ai/AICostForecastNarration', () => ({ AICostForecastNarration: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function model() {
  mocks.query.mockReturnValue({ data: [], isLoading: false, error: null, refetch: mocks.refetch });
  mocks.forecast.mockReturnValue({ data: forecastData, isLoading: false, error: null, refetch: mocks.refetch });
  mocks.derivations.mockReturnValue({
    coreStats, lifetimeMetrics, gasComparison, hourlyData, touInsights,
    monthlyData: [], costPerKwhTrend: [], chargerTypeData: [],
  });
}

describe('actual production cost page wiring, not browser acceptance', () => {
  it('uses the legal API limit while preserving bounds, forecast independence, model operands and all six period consumers', () => {
    mocks.vehicleId = 7; model();
    render(<CostAnalysisPage />);
    expect(mocks.query).toHaveBeenCalledWith(7, { limit: 1000, start: '2026-01-01', end: '2026-01-31' });
    expect(mocks.forecast).toHaveBeenCalledWith('7');
    expect(mocks.derivations.mock.calls[0]?.[0]).toMatchObject({
      sessions: [], gasPrice: 3.5, mpg: 30, electricityRate: 0.13, isMiles: true,
    });
    const calls = [
      mocks.CostSummaryCards, mocks.ChargerTypeBreakdown, mocks.SavingsCalculator,
      mocks.TimeOfUseAnalysis, mocks.LifetimeSummary, mocks.EnvironmentalImpact,
    ];
    for (const consumer of calls) {
      expect(consumer).toHaveBeenCalledOnce();
      const props = consumer.mock.calls[0]?.[0];
      expect(props).toHaveProperty('period.kind', 'unknown');
      expect(props).not.toHaveProperty('period.label', 'Lifetime');
      expect(props).toHaveProperty('period.reason', expect.stringContaining('1000'));
    }
    expect(mocks.BillVarianceCard.mock.calls[0]?.[0]).toMatchObject({ vehicleId: 7 });
    expect(mocks.BillVarianceCard.mock.calls[0]?.[0]).not.toHaveProperty('period');
    expect(mocks.CostForecastSection.mock.calls[0]?.[0]).toMatchObject({ forecastData });
    expect(mocks.CostForecastSection.mock.calls[0]?.[0]).not.toHaveProperty('period');
  });
  it('keeps unselected vehicle null, forecast disabled input and the original reset/retry functions', () => {
    mocks.vehicleId = null; model();
    render(<CostAnalysisPage />);
    expect(mocks.query).toHaveBeenCalledWith(null, { limit: 1000, start: '2026-01-01', end: '2026-01-31' });
    expect(mocks.forecast).toHaveBeenCalledWith(null);
    const props = mocks.CostSummaryCards.mock.calls[0]?.[0];
    expect(props?.onResetRange).toBe(mocks.resetRange);
    const retry = props?.onRetry;
    if (typeof retry !== 'function') throw new Error('Cost summary must expose a retry callback');
    retry();
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
