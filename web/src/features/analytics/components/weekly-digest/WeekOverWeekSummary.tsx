import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Car, Activity, Zap, Fuel, BarChart3, Leaf } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { trendFor } from './helpers';
import type { DigestMetrics } from './types';

interface WeekOverWeekSummaryProps {
  metrics: DigestMetrics;
}

export function WeekOverWeekSummary({ metrics }: WeekOverWeekSummaryProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  return (
    <FadeIn delay={0.3}>
      <GlassPanel className="space-y-4 p-6">
        <span className="text-lg font-bold text-white">
          {t('analytics.weeklyDigest.weekOverWeek', 'Week-over-Week Comparison')}
        </span>
        <span className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={t('analytics.weeklyDigest.distance', 'Distance')}
            value={fmtNumber(metrics.totalDistance, 1)}
            unit="km"
            icon={<Car className="h-4 w-4" />}
            trend={trendFor(metrics.totalDistance, metrics.prevDistance)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.drives', 'Drives')}
            value={fmtInt(metrics.totalDrives)}
            icon={<Activity className="h-4 w-4" />}
            trend={trendFor(metrics.totalDrives, metrics.prevDriveCount)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.energy', 'Energy')}
            value={fmtNumber(metrics.energyUsed, 1)}
            unit="kWh"
            icon={<Zap className="h-4 w-4" />}
            trend={trendFor(metrics.energyUsed, metrics.prevEnergy, true)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.cost', 'Cost')}
            value={formatCurrency(metrics.chargingCost, 2)}
            icon={<Fuel className="h-4 w-4" />}
            trend={trendFor(metrics.chargingCost, metrics.prevChargingCost, true)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.efficiency', 'Efficiency')}
            value={fmtNumber(metrics.avgEfficiency, 1)}
            unit="Wh/km"
            icon={<BarChart3 className="h-4 w-4" />}
            trend={trendFor(metrics.avgEfficiency, metrics.prevAvgEfficiency, true)}
          />
          <StatCard
            label={t('analytics.weeklyDigest.co2', 'CO₂ Saved')}
            value={fmtNumber(metrics.co2Saved, 1)}
            unit="kg"
            icon={<Leaf className="h-4 w-4" />}
            trend={trendFor(metrics.co2Saved, metrics.prevCo2)}
          />
        </span>
      </GlassPanel>
    </FadeIn>
  );
}
