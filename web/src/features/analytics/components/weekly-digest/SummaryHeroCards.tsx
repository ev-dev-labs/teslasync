import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Car, Activity, Zap, Fuel, Leaf, MapPin } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { HighlightCard } from './HighlightCard';
import { trendFor } from './helpers';
import type { DigestMetrics, FunFact } from './types';

interface SummaryHeroCardsProps {
  metrics: DigestMetrics;
  funFact: FunFact | undefined;
}

export function SummaryHeroCards({ metrics, funFact }: SummaryHeroCardsProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  return (
    <FadeIn delay={0.05}>
      <GlassPanel className="space-y-4 p-6">
        <span className="text-lg font-bold text-white">
          {t('analytics.weeklyDigest.weekSummary', 'Week Summary')}
        </span>
        <span className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <HighlightCard
            icon={<Car className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.totalDistance', 'Total Distance')}
            value={`${fmtNumber(metrics.totalDistance, 1)} km`}
            change={trendFor(metrics.totalDistance, metrics.prevDistance)}
            color="cyan"
          />
          <HighlightCard
            icon={<Activity className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.totalDrives', 'Total Drives')}
            value={fmtInt(metrics.totalDrives)}
            change={trendFor(metrics.totalDrives, metrics.prevDriveCount)}
            color="green"
          />
          <HighlightCard
            icon={<Zap className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.energyUsed', 'Energy Used')}
            value={`${fmtNumber(metrics.energyUsed, 1)} kWh`}
            change={trendFor(metrics.energyUsed, metrics.prevEnergy, true)}
            color="purple"
          />
          <HighlightCard
            icon={<Fuel className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.chargingCost', 'Charging Cost')}
            value={formatCurrency(metrics.chargingCost, 2)}
            change={trendFor(metrics.chargingCost, metrics.prevChargingCost, true)}
            color="amber"
          />
          <HighlightCard
            icon={<Leaf className="h-5 w-5" />}
            label={t('analytics.weeklyDigest.co2Saved', 'CO₂ Saved')}
            value={`${fmtNumber(metrics.co2Saved, 1)} kg`}
            change={trendFor(metrics.co2Saved, metrics.prevCo2)}
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
        </span>
      </GlassPanel>
    </FadeIn>
  );
}
