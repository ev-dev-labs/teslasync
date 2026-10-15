import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import { GlassPanel, PanelTitle, SectionTitle } from '@/components/ui';
import { EmptyState, Skeleton } from '@/components/feedback';
import { EmptyStateThreshold } from '@/components/feedback/EmptyStateThreshold';
import type { ChargingSession } from '@/api/types';
import {
  AcDcStatsPanel, BatteryLevelChart, ChargeRatePanel, ChargerSpecsPanel, OptimizerSection,
  type computeAcDcBreakdown, type computeStartLevelDist, type computeChargeRateStats, type computeChargerSpecs,
} from './index';

interface ChargingInsightsProps {
  sessions: ChargingSession[] | undefined;
  loading: boolean;
  optimizer: ComponentProps<typeof OptimizerSection>['optimizer'] | undefined;
  optimizerContent?: ReactNode;
  acDcBreakdown: ReturnType<typeof computeAcDcBreakdown> | null;
  startLevelDist: ReturnType<typeof computeStartLevelDist>;
  chargeRateStats: ReturnType<typeof computeChargeRateStats> | null;
  chargerSpecs: ReturnType<typeof computeChargerSpecs> | null;
}

export function ChargingInsights({
  sessions, loading, optimizer, optimizerContent, acDcBreakdown, startLevelDist, chargeRateStats, chargerSpecs,
}: ChargingInsightsProps) {
  const { t } = useTranslation();
  const count = sessions?.length ?? 0;
  const acDcTitle = t('charging.stats.chargingByType', 'Charging stats by type');
  const batteryTitle = t('charging.section.batteryDist', 'Battery start-level distribution');
  const rateTitle = t('charging.deliveryRate.title', 'Charging delivery rate');
  const specsTitle = t('charging.section.specs', 'Charger specs breakdown');
  const optimizerTitle = t('charging.section.optimizer', 'Cost optimizer & heatmap');
  const recovery = t('operations.charging.noDataDescription', 'Choose a wider analysis window or complete a charging session.');

  const missing = (title: string, message: string, threshold: number, description?: string) => (
    <GlassPanel className="p-4 sm:p-6">
      {loading ? (
        <>
          <PanelTitle className="mb-4">{title}</PanelTitle>
          <Skeleton className="h-40" />
        </>
      ) : sessions !== undefined && count < threshold ? (
        <EmptyStateThreshold
          currentCount={count}
          threshold={threshold}
          itemNoun={t('charging.itemNoun', 'sessions')}
          sectionLabel={title}
          description={description ? `${description} ${recovery}` : recovery}
        />
      ) : (
        <>
          <PanelTitle>{title}</PanelTitle>
          {/* no-action: recovery uses the existing workspace scope controls. */}
          <EmptyState message={message} description={description ? `${description} ${recovery}` : recovery} className="py-8" />
        </>
      )}
    </GlassPanel>
  );
  return (
    <section aria-label={t('charging.section.insights', 'Charging insights')} className="space-y-4 xl:space-y-5">
      <SectionTitle>{t('charging.insights.title', 'Charging insights')}</SectionTitle>
      {!loading && sessions !== undefined && count === 0 && (
        <GlassPanel className="p-6">
          {/* no-action: recovery uses the workspace vehicle, period, and collection filters. */}
          <EmptyState
            icon={<Plug className="h-8 w-8" aria-hidden="true" />}
            message={t('charging.insights.emptyMessage', 'Charging insights need completed sessions in the selected range.')}
            description={t('charging.insights.emptyDescription', 'Battery-start patterns, charger comparisons, and scheduling guidance appear as session history accumulates.')}
            className="py-8"
          />
        </GlassPanel>
      )}
      <div className="grid grid-cols-1 gap-4 xl:gap-5 2xl:grid-cols-6">
        <section aria-label={acDcTitle} className="min-w-0 2xl:col-span-4">
          {acDcBreakdown && acDcBreakdown.ac.count + acDcBreakdown.dc.count >= 1
            ? <AcDcStatsPanel breakdown={acDcBreakdown} />
            : missing(acDcTitle, t('charging.stats.noData', 'No AC/DC charging data'), 1)}
        </section>
        <section aria-label={batteryTitle} className="min-w-0 2xl:col-span-2">
          {startLevelDist.some(bucket => bucket.count > 0) && count >= 5
            ? <BatteryLevelChart data={startLevelDist} />
            : missing(batteryTitle, t('costAnalysis.charts.noData', 'Not enough data'), 5,
              t('charging.section.batteryDistDesc', 'See where you typically start charging.'))}
        </section>
        <section aria-label={rateTitle} className="min-w-0 2xl:col-span-6">
          {chargeRateStats
            ? <ChargeRatePanel stats={chargeRateStats} />
            : missing(rateTitle, t('chargePlanner.noRateData', 'No rate data available'), 1,
              t('charging.brief.deliveryScope', 'Computed from the loaded history, independently of collection and search filters; only usable energy and positive completed-session duration contribute.'))}
        </section>
        <section aria-label={specsTitle} className="min-w-0 2xl:col-span-6">
          {chargerSpecs && count >= 5
            ? <ChargerSpecsPanel specs={chargerSpecs} />
            : missing(specsTitle, t('charging.specs.noData', 'No charger specification data available yet'), 5)}
        </section>
      </div>
      <section aria-label={optimizerTitle} className="min-w-0">
        {optimizerContent ?? (optimizer && count >= 10
          ? <OptimizerSection optimizer={optimizer} />
          : missing(optimizerTitle, t('charging.optimizer.noRecs', 'Recommendations will appear after more charging sessions.'), 10,
            t('charging.brief.optimizerScope', 'Independent optimizer source; its history bounds are not reported. Recommendations and savings are illustrative, not measured outcomes.')))}
      </section>
    </section>
  );
}
