import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui';
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
  acDcBreakdown: ReturnType<typeof computeAcDcBreakdown> | null;
  startLevelDist: ReturnType<typeof computeStartLevelDist>;
  chargeRateStats: ReturnType<typeof computeChargeRateStats> | null;
  chargerSpecs: ReturnType<typeof computeChargerSpecs> | null;
}

export function ChargingInsights({
  sessions, loading, optimizer, acDcBreakdown, startLevelDist, chargeRateStats, chargerSpecs,
}: ChargingInsightsProps) {
  const { t } = useTranslation();
  const count = sessions?.length ?? 0;
  return (
    <section aria-label={t('charging.section.insights', 'Charging insights')} className="space-y-4 xl:space-y-5">
      <SectionTitle>{t('charging.insights.title', 'Charging insights')}</SectionTitle>
      {loading ? <Skeleton className="h-40" /> : count === 0 && (
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
        {acDcBreakdown && acDcBreakdown.ac.count + acDcBreakdown.dc.count >= 1 && (
          <div className="min-w-0 2xl:col-span-4">
            <AcDcStatsPanel breakdown={acDcBreakdown} />
          </div>
        )}
        {startLevelDist.length > 0 && count >= 5 ? (
          <div className="min-w-0 2xl:col-span-2">
            <BatteryLevelChart data={startLevelDist} />
          </div>
        ) : count > 0 && count < 5 ? (
          <div className="min-w-0 2xl:col-span-2">
            <EmptyStateThreshold
              currentCount={count}
              threshold={5}
              itemNoun={t('charging.itemNoun', 'sessions')}
              sectionLabel={t('charging.section.batteryDist', 'Battery start-level distribution')}
              description={t('charging.section.batteryDistDesc', 'See where you typically start charging.')}
            />
          </div>
        ) : null}
        {chargeRateStats && (
          <div className="min-w-0 2xl:col-span-6">
            <ChargeRatePanel stats={chargeRateStats} />
          </div>
        )}
        {chargerSpecs && count >= 5 ? (
          <div className="min-w-0 2xl:col-span-6">
            <ChargerSpecsPanel specs={chargerSpecs} />
          </div>
        ) : count > 0 && count < 5 ? (
          <div className="min-w-0 2xl:col-span-6">
            <EmptyStateThreshold
              currentCount={count}
              threshold={5}
              itemNoun={t('charging.itemNoun', 'sessions')}
              sectionLabel={t('charging.section.specs', 'Charger specs breakdown')}
            />
          </div>
        ) : null}
      </div>
      {optimizer && count >= 10 ? (
        <OptimizerSection optimizer={optimizer} />
      ) : count > 0 && count < 10 ? (
        <EmptyStateThreshold
          currentCount={count}
          threshold={10}
          itemNoun={t('charging.itemNoun', 'sessions')}
          sectionLabel={t('charging.section.optimizer', 'Cost optimizer & heatmap')}
          description={t('charging.section.optimizerDesc', 'Smart scheduling recommendations require pattern recognition.')}
        />
      ) : null}
    </section>
  );
}
