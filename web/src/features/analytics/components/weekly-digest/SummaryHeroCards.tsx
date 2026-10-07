import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { Car, Activity, Zap, Fuel, Leaf, MapPin } from 'lucide-react';
import { SectionTitle, GlassPanel } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { HighlightCard } from './HighlightCard';
import { trendFor } from './helpers';
import type { DigestMetrics, FunFact } from './types';

interface SummaryHeroCardsProps {
  metrics: DigestMetrics;
  funFact: FunFact | undefined;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

const KPI_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 3xl:grid-cols-6';

export function SummaryHeroCards({
  metrics,
  funFact,
  isLoading,
  isError,
  error,
  onRetry,
}: SummaryHeroCardsProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { formatDistance, formatEnergy } = useUnits();

  return (
    <section
      aria-label={t('analytics.weeklyDigest.weekSummary', 'Week Summary')}
      aria-busy={isLoading ? true : undefined}
      className="space-y-3"
    >
      <SectionTitle>{t('analytics.weeklyDigest.weekSummary', 'Week Summary')}</SectionTitle>
      {isError ? (
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={error} onRetry={onRetry} />
        </GlassPanel>
      ) : isLoading ? (
        <div className={KPI_GRID}>
          {Array.from({ length: 6 }).map((_, i) => (
            <GlassPanel key={i} className="p-4 sm:p-5">
              <Skeleton height={72} />
            </GlassPanel>
          ))}
        </div>
      ) : (
        <div className={KPI_GRID}>
          <HighlightCard
            icon={<Car className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.totalDistance', 'Total Distance')}
            value={formatDistance(metrics.totalDistanceM ?? 0, { precision: 1 })}
            change={trendFor(metrics.totalDistanceM ?? 0, metrics.prevDistanceM ?? 0)}
            color="cyan"
          />
          <HighlightCard
            icon={<Activity className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.totalDrives', 'Total Drives')}
            value={fmtInt(metrics.totalDrives ?? 0)}
            change={trendFor(metrics.totalDrives ?? 0, metrics.prevDriveCount ?? 0)}
            color="green"
          />
          <HighlightCard
            icon={<Zap className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.energyUsed', 'Energy Used')}
            value={formatEnergy(metrics.energyUsedWh ?? 0, { precision: 1 })}
            change={trendFor(metrics.energyUsedWh ?? 0, metrics.prevEnergyWh ?? 0, true)}
            color="purple"
          />
          <HighlightCard
            icon={<Fuel className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.chargingCost', 'Charging Cost')}
            value={formatCurrency(metrics.chargingCost ?? 0, 2)}
            change={trendFor(metrics.chargingCost ?? 0, metrics.prevChargingCost ?? 0, true)}
            color="amber"
          />
          <HighlightCard
            icon={<Leaf className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.co2Saved', 'CO₂ Saved')}
            value={`${fmtNumber(metrics.co2Saved ?? 0, 1)} kg`}
            change={trendFor(metrics.co2Saved ?? 0, metrics.prevCo2 ?? 0)}
            color="green"
          />
          {funFact && (
            <HighlightCard
              icon={<MapPin className="h-5 w-5" />}
              label={t('analytics.weeklyDigest.funFact', 'Fun Fact')}
              value={`${funFact.times}×`}
              subtitle={t(
                'analytics.weeklyDigest.funFactDesc',
                '≈ {{times}}× {{from}} → {{to}}',
                { times: funFact.times, from: funFact.from, to: funFact.to },
              )}
              color="cyan"
            />
          )}
        </div>
      )}
    </section>
  );
}
