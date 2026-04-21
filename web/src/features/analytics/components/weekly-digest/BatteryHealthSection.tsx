import { useTranslation } from 'react-i18next';
import { Battery, TrendingUp, Zap, MapPin } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { BatteryPill } from './BatteryPill';
import { MiniStat } from './MiniStat';
import type { DigestMetrics } from './types';

interface BatteryHealthSectionProps {
  metrics: DigestMetrics;
}

export function BatteryHealthSection({ metrics }: BatteryHealthSectionProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.2}>
      <GlassPanel className="space-y-6 p-6">
        <span className="flex items-center gap-2 text-lg font-bold text-white">
          <Battery className="h-5 w-5 text-neon-purple" />
          {t('analytics.weeklyDigest.batteryHealth', 'Battery Health')}
        </span>

        <span className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <BatteryPill
            level={Math.round(metrics.batteryStart)}
            label={t('analytics.weeklyDigest.avgBatteryStart', 'Avg Battery at Charge Start')}
          />
          <BatteryPill
            level={Math.round(metrics.batteryEnd)}
            label={t('analytics.weeklyDigest.avgBatteryEnd', 'Avg Battery at Charge End')}
          />
        </span>

        {/* Range stats */}
        <span className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MiniStat
            label={t('analytics.weeklyDigest.avgChargeGain', 'Avg Charge Gain')}
            value={`${fmtNumber(metrics.batteryEnd - metrics.batteryStart, 1)}%`}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.chargeSessions', 'Charge Sessions')}
            value={fmtInt(metrics.chargingSessionCount)}
            icon={<Zap className="h-4 w-4" />}
          />
          <MiniStat
            label={t('analytics.weeklyDigest.estRangeAdded', 'Est. Range Added')}
            value={`${fmtNumber(metrics.chargeEnergyAdded * 5.5, 0)} km`}
            icon={<MapPin className="h-4 w-4" />}
          />
        </span>
      </GlassPanel>
    </FadeIn>
  );
}
