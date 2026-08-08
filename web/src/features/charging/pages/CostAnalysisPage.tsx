import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { SavedViewMenu } from '@/components/data-display';
import { PrintButton } from '@/components/ui';
import { AICostForecastNarration } from '@/components/ai/AICostForecastNarration';
import { useChargingSessionsPaginated, useCostForecast } from '@/api/hooks/useCharging';
import { useSettings } from '@/hooks/useSettings';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlString } from '@/hooks/useUrlState';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { DEFAULT_GAS_PRICE, DEFAULT_MPG, DEFAULT_ELECTRICITY_RATE } from '../components/cost-analysis/constants';
import { useCostAnalysisData } from '../components/cost-analysis/useCostAnalysisData';
import {
  CostSummaryCards,
  MonthlyCostChart,
  CostPerKwhChart,
  ChargerTypeBreakdown,
  SavingsCalculator,
  MonthlyCostTable,
  TimeOfUseAnalysis,
  CostForecastSection,
  LifetimeSummary,
  EnvironmentalImpact,
} from '../components/cost-analysis';

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
  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate] = useUrlString('from', defaultStartDate);
  const [endDate] = useUrlString('to', defaultEndDate);
  const setRangeBatch = useUrlBatch();

  // ── Gas calculator inputs ────────────────────────────────────────────
  const [gasPrice, setGasPrice] = useState(DEFAULT_GAS_PRICE);
  const [mpg, setMpg] = useState(DEFAULT_MPG);
  const [electricityRate, setElectricityRate] = useState(DEFAULT_ELECTRICITY_RATE);

  // ── Data ─────────────────────────────────────────────────────────────
  const sessionsQuery = useChargingSessionsPaginated(vehicleId, {
    limit: 5000,
    start: startDate,
    end: endDate,
  });
  const { data: sessions, isLoading: sessionsLoading, error: sessionsError } = sessionsQuery;
  const retrySessions = useCallback(() => { void sessionsQuery.refetch(); }, [sessionsQuery]);

  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const forecastQuery = useCostForecast(vehicleIdStr);
  const { data: forecastData, isLoading: forecastLoading, error: forecastError } = forecastQuery;
  const retryForecast = useCallback(() => { void forecastQuery.refetch(); }, [forecastQuery]);

  const {
    coreStats, monthlyData, costPerKwhTrend, chargerTypeData,
    hourlyData, touInsights, gasComparison, lifetimeMetrics,
  } = useCostAnalysisData({
    sessions, gasPrice, mpg, electricityRate, toDistanceDisplay, isMiles,
  });

  const actions = (
    <div data-print-hide className="flex flex-wrap items-center gap-2 sm:gap-3">
      <VehicleSelect />
      <RangePicker
        value={{ start: startDate, end: endDate }}
        onChange={(r) => setRangeBatch({ from: r.start, to: r.end })}
        align="end"
        triggerTestId="cost-analysis-range"
      />
      <SavedViewMenu
        route="/cost-analysis"
        currentQuery={savedView.currentQuery}
        onApply={savedView.apply}
      />
      <PrintButton />
    </div>
  );

  return (
    <PageContainer
      title={t('costAnalysis.title', 'Cost Analysis')}
      subtitle={t('costAnalysis.subtitle', 'Electricity cost trends, gas savings, and charging economics')}
      actions={actions}
      query={sessionsQuery}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section data-tour="cost-analysis" aria-label={t('costAnalysis.kpis', 'Cost summary metrics')}>
          <CostSummaryCards
            coreStats={coreStats}
            gasPrice={gasPrice}
            distanceUnit={distanceUnit}
            isMiles={isMiles}
            isLoading={sessionsLoading}
            error={sessionsError}
            onRetry={retrySessions}
            onResetRange={() => setRangeBatch({ from: null, to: null })}
          />
        </section>
      </FadeIn>

      {/* 2 — Cost trends: hero area chart + rate line */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('costAnalysis.trends', 'Cost trends')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <div className="xl:col-span-2">
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
        </section>
      </FadeIn>

      {/* 3 — Charger-type economics */}
      <FadeIn delay={0.1}>
        <ChargerTypeBreakdown
          data={chargerTypeData}
          totalCost={coreStats?.totalCost ?? 1}
          isLoading={sessionsLoading}
          error={sessionsError}
          onRetry={retrySessions}
        />
      </FadeIn>

      {/* 4 — Gas vs EV savings calculator */}
      <FadeIn delay={0.1}>
        <SavingsCalculator
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
      </FadeIn>

      {/* 5 — Monthly breakdown table */}
      <FadeIn delay={0.1}>
        <MonthlyCostTable
          data={monthlyData}
          isLoading={sessionsLoading}
          error={sessionsError}
          onRetry={retrySessions}
        />
      </FadeIn>

      {/* 6 — Time-of-use analysis */}
      <FadeIn delay={0.1}>
        <TimeOfUseAnalysis
          hourlyData={hourlyData}
          touInsights={touInsights}
          isLoading={sessionsLoading}
          error={sessionsError}
          onRetry={retrySessions}
        />
      </FadeIn>

      {/* 7 — Opt-in AI narration (self-gated; absent in ai_mode=off) */}
      <AICostForecastNarration vehicleId={vehicleId ?? undefined} />

      {/* 8 — Deterministic cost forecast */}
      <FadeIn delay={0.1}>
        <CostForecastSection
          forecastData={forecastData}
          isLoading={forecastLoading}
          error={forecastError}
          onRetry={retryForecast}
        />
      </FadeIn>

      {/* 9 — Lifetime summary + environmental impact */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('costAnalysis.impact', 'Lifetime and environmental impact')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-2"
        >
          <LifetimeSummary
            lifetimeMetrics={lifetimeMetrics}
            coreStats={coreStats}
            isLoading={sessionsLoading}
            error={sessionsError}
            onRetry={retrySessions}
          />
          <EnvironmentalImpact
            coreStats={coreStats}
            isLoading={sessionsLoading}
            error={sessionsError}
            onRetry={retrySessions}
          />
        </section>
      </FadeIn>
    </PageContainer>
  );
}
