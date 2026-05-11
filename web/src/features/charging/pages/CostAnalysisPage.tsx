import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DollarSign } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { SavedViewMenu } from '@/components/data-display';
import { PrintButton } from '@/components/ui';
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
  LoadingSkeleton,
} from '../components/cost-analysis';

export default function CostAnalysisPage() {
  const { t } = useTranslation();
  usePageTitle(t('costAnalysis.title', 'Cost Analysis'));
  const savedView = useSavedViewUrl();

  const { isMiles } = useSettings();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);
  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
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

  const { data: sessions, isLoading } = useChargingSessionsPaginated(vehicleId, {
    limit: 5000,
    start: startDate,
    end: endDate,
  });
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const { data: forecastData } = useCostForecast(vehicleIdStr);

  const {
    coreStats, monthlyData, costPerKwhTrend, chargerTypeData,
    hourlyData, touInsights, gasComparison, lifetimeMetrics,
  } = useCostAnalysisData({
    sessions, gasPrice, mpg, electricityRate, toDistanceDisplay, isMiles,
  });

  if (isLoading) return <LoadingSkeleton />;

  if (!sessions || sessions.length === 0) {
    return (
      <FadeIn>
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<DollarSign className="h-12 w-12 text-[var(--text-muted)]" />}
            title={t('costAnalysis.empty.title', 'No Charging Data')}
            message={t(
              'costAnalysis.empty.message',
              'Start charging your vehicle to see cost analysis and savings trends.',
            )}
          />
        </div>
      </FadeIn>
    );
  }

  return (
    <PageContainer
      title={t('costAnalysis.title', 'Cost Analysis')}
      subtitle={t('costAnalysis.subtitle', 'Electricity cost trends, gas savings, and charging economics')}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          <div data-print-hide className="flex flex-wrap items-center gap-3">
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
        </div>
      }
    >
      <div className="space-y-6">
        <div data-tour="cost-analysis">
        <CostSummaryCards
          coreStats={coreStats}
          gasPrice={gasPrice}
          distanceUnit={distanceUnit}
          isMiles={isMiles}
        />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <MonthlyCostChart data={monthlyData} vehicleId={vehicleId} />
          <CostPerKwhChart data={costPerKwhTrend} />
        </div>

        <ChargerTypeBreakdown
          data={chargerTypeData}
          totalCost={coreStats?.totalCost ?? 1}
        />

        <SavingsCalculator
          gasComparison={gasComparison}
          gasPrice={gasPrice}
          mpg={mpg}
          electricityRate={electricityRate}
          onGasPriceChange={setGasPrice}
          onMpgChange={setMpg}
          onElectricityRateChange={setElectricityRate}
          distanceUnit={distanceUnit}
        />

        <MonthlyCostTable data={monthlyData} />

        <TimeOfUseAnalysis hourlyData={hourlyData} touInsights={touInsights} />

        <CostForecastSection forecastData={forecastData} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LifetimeSummary lifetimeMetrics={lifetimeMetrics} coreStats={coreStats} />
          <EnvironmentalImpact coreStats={coreStats} />
        </div>
      </div>
    </PageContainer>
  );
}
