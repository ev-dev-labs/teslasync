import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid, PageLayout, Stack } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';

import { SavedViewMenu } from '@/components/data-display';
import { PrintButton } from '@/components/ui';
import { AICostForecastNarration } from '@/components/ai';
import { useChargingSessionsPaginated, useCostForecast } from '@/api/hooks/useCharging';
import { useSettings } from '@/hooks/useSettings';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useRangeState } from '@/hooks/useRangeState';
import { useDataState } from '@/hooks/useDataState';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { PAGINATION } from '@/lib/constants';
import { DEFAULT_GAS_PRICE, DEFAULT_MPG, DEFAULT_ELECTRICITY_RATE } from '../components/cost-analysis/constants';
import { useCostAnalysisData } from '../components/cost-analysis/useCostAnalysisData';
import {
  MonthlyCostChart,
  CostPerKwhChart,
  MonthlyCostTable,
} from '../components/cost-analysis';
import {
  CostSummaryCards,
  ChargerTypeBreakdown,
  SavingsCalculator,
  TimeOfUseAnalysis,
  CostForecastSection,
  LifetimeSummary,
  EnvironmentalImpact,
  BillVarianceCard,
  useReturnedSessionPeriod,
} from '../components/stat-modernization';

const TREND_COLUMNS = { default: 1, xl: 3 } as const;
const IMPACT_COLUMNS = { default: 1, xl: 2 } as const;

export default function CostAnalysisPage() {
  const { t } = useTranslation();
  usePageTitle(t('costAnalysis.title', 'Cost Analysis'));
  const savedView = useSavedViewUrl();

  const { isMiles } = useSettings();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  // Stable SI-meters → display-distance converter. Memoized on the distance
  // preference so the memoized derives inside useCostAnalysisData don't
  // recompute on every render (this closure is one of their dependencies).
  const toDistanceDisplay = useCallback(
    (meters: number) => convertDistanceFromSI(meters, unitPrefs.distance),
    [unitPrefs.distance],
  );
  // Header VehiclePicker is the source of truth.
  const { vehicleId } = useSelectedVehicle();

  // ── Filters ──────────────────────────────────────────────────────────
  const { start: startDate, end: endDate, reset: resetRange } = useRangeState({
    persistKey: 'cost-analysis.range',
    defaultPresetId: '1y',
  });
  const returnedSessionPeriod = useReturnedSessionPeriod(startDate, endDate, PAGINATION.MAX_LIMIT);

  // ── Gas calculator inputs ────────────────────────────────────────────
  const [gasPrice, setGasPrice] = useState(DEFAULT_GAS_PRICE);
  const [mpg, setMpg] = useState(DEFAULT_MPG);
  const [electricityRate, setElectricityRate] = useState(DEFAULT_ELECTRICITY_RATE);

  // ── Data ─────────────────────────────────────────────────────────────
  const sessionsQuery = useChargingSessionsPaginated(vehicleId, {
    limit: PAGINATION.MAX_LIMIT,
    start: startDate,
    end: endDate,
  });
  const { data: sessions } = sessionsQuery;
  const sessionsState = useDataState(sessionsQuery, { provenance: 'historical' });
  const sessionsLoading = sessionsQuery.isLoading && !sessionsState.hasData;
  const sessionsError = sessionsState.fatalError;
  const retrySessions = useCallback(() => { void sessionsQuery.refetch(); }, [sessionsQuery]);

  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const forecastQuery = useCostForecast(vehicleIdStr);
  const { data: forecastData } = forecastQuery;
  const forecastState = useDataState(forecastQuery, { provenance: 'historical' });
  const forecastLoading = forecastQuery.isLoading && !forecastState.hasData;
  const forecastError = forecastState.fatalError;
  const retryForecast = useCallback(() => { void forecastQuery.refetch(); }, [forecastQuery]);

  const {
    coreStats, monthlyData, costPerKwhTrend, chargerTypeData,
    hourlyData, touInsights, gasComparison, lifetimeMetrics,
  } = useCostAnalysisData({
    sessions, gasPrice, mpg, electricityRate, toDistanceDisplay, isMiles,
  });

  const actions = (
    <Stack direction="row" gap={2} align="center" data-print-hide className="min-w-0 flex-wrap sm:gap-3">
      <SavedViewMenu
        route="/cost-analysis"
        currentQuery={savedView.currentQuery}
        onApply={savedView.apply}
      />
      <PrintButton />
    </Stack>
  );

  return (
    <PageLayout
      title={t('costAnalysis.title', 'Cost Analysis')}
      subtitle={t('costAnalysis.subtitle', 'Electricity cost trends, gas savings, and charging economics')}
      overflowActions={actions}
      query={[sessionsQuery, forecastQuery]}
      busy={sessionsState.isRefreshing || forecastState.isRefreshing}
      dataSources={[
        { id: 'sessions', label: t('charging.curve.resource', 'Charging sessions'), query: sessionsQuery },
        { id: 'forecast', label: t('costAnalysis.forecast.title', 'Cost Forecast'), query: forecastQuery },
      ]}
    >
      <StaleRefreshWarning state={sessionsState} label={t('charging.curve.resource', 'Charging sessions')} />
      <StaleRefreshWarning state={forecastState} label={t('costAnalysis.forecast.title', 'Cost Forecast')} />
      {/* 1 — KPI band */}
      <div className="min-w-0">
        <section data-tour="cost-analysis" aria-label={t('costAnalysis.kpis', 'Cost summary metrics')}>
          <CostSummaryCards
            period={returnedSessionPeriod}
            coreStats={coreStats}
            gasPrice={gasPrice}
            distanceUnit={distanceUnit}
            isMiles={isMiles}
            isLoading={sessionsLoading}
            error={sessionsError}
            onRetry={retrySessions}
            onResetRange={resetRange}
          />
        </section>
      </div>

      {/* 1b — Bill truth: measured vs Tesla invoices */}
      <div className="min-w-0">
        <BillVarianceCard vehicleId={vehicleId} />
      </div>

      {/* 2 — Cost trends: hero area chart + rate line */}
      <div className="min-w-0">
        <section
          aria-label={t('costAnalysis.trends', 'Cost trends')}
          className="min-w-0"
        >
          <Grid cols={TREND_COLUMNS} gap={4}>
            <div className="min-w-0 xl:col-span-2">
              <MonthlyCostChart
                data={monthlyData}
                vehicleId={vehicleId}
                isLoading={sessionsLoading}
                error={sessionsError}
                onRetry={retrySessions}
              />
            </div>
            <CostPerKwhChart
              data={costPerKwhTrend}
              isLoading={sessionsLoading}
              error={sessionsError}
              onRetry={retrySessions}
            />
          </Grid>
        </section>
      </div>

      {/* 3 — Charger-type economics */}
      <div className="min-w-0">
        <ChargerTypeBreakdown
          period={returnedSessionPeriod}
          data={chargerTypeData}
          totalCost={coreStats?.totalCost ?? 1}
          isLoading={sessionsLoading}
          error={sessionsError}
          onRetry={retrySessions}
        />
      </div>

      {/* 4 — Gas vs EV savings calculator */}
      <div className="min-w-0">
        <SavingsCalculator
          period={returnedSessionPeriod}
          gasComparison={gasComparison}
          gasPrice={gasPrice}
          mpg={mpg}
          electricityRate={electricityRate}
          onGasPriceChange={setGasPrice}
          onMpgChange={setMpg}
          onElectricityRateChange={setElectricityRate}
          distanceUnit={distanceUnit}
          isLoading={sessionsLoading}
          error={sessionsError}
          onRetry={retrySessions}
        />
      </div>

      {/* 5 — Monthly breakdown table */}
      <div className="min-w-0">
        <MonthlyCostTable
          data={monthlyData}
          isLoading={sessionsLoading}
          error={sessionsError}
          onRetry={retrySessions}
        />
      </div>

      {/* 6 — Time-of-use analysis */}
      <div className="min-w-0">
        <TimeOfUseAnalysis
          period={returnedSessionPeriod}
          hourlyData={hourlyData}
          touInsights={touInsights}
          isLoading={sessionsLoading}
          error={sessionsError}
          onRetry={retrySessions}
        />
      </div>

      {/* 7 — Opt-in AI narration (self-gated; absent in ai_mode=off) */}
      <AICostForecastNarration vehicleId={vehicleId ?? undefined} />

      {/* 8 — Deterministic cost forecast */}
      <div className="min-w-0">
        <CostForecastSection
          forecastData={forecastData}
          isLoading={forecastLoading}
          error={forecastError}
          onRetry={retryForecast}
        />
      </div>

      {/* 9 — Lifetime summary + environmental impact */}
      <div className="min-w-0">
        <section
          aria-label={t('costAnalysis.impact', 'Lifetime and environmental impact')}
          className="min-w-0"
        >
          <Grid cols={IMPACT_COLUMNS} gap={4}>
            <LifetimeSummary
              period={returnedSessionPeriod}
              lifetimeMetrics={lifetimeMetrics}
              coreStats={coreStats}
              isLoading={sessionsLoading}
              error={sessionsError}
              onRetry={retrySessions}
            />
            <EnvironmentalImpact
              period={returnedSessionPeriod}
              coreStats={coreStats}
              isLoading={sessionsLoading}
              error={sessionsError}
              onRetry={retrySessions}
            />
          </Grid>
        </section>
      </div>
    </PageLayout>
  );
}
