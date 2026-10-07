import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { Battery, TrendingUp, Zap, MapPin } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { BatteryPill } from './BatteryPill';
import { MiniStat } from './MiniStat';
import type { DigestMetrics } from './types';

// Rough driving-range estimate: 5.5 km/kWh is dimensionally 5.5 m/Wh.
const EST_RANGE_M_PER_WH = 5.5;

interface BatteryHealthSectionProps {
  metrics: DigestMetrics;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function BatteryHealthSection({
  metrics,
  isLoading,
  isError,
  error,
  onRetry,
}: BatteryHealthSectionProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const hasData = (metrics.chargingSessionCount ?? 0) > 0;

  return (
    <GlassPanel className="flex h-full flex-col gap-5 p-4 sm:p-5">
      <PanelTitle className="flex items-center gap-2">
        <Battery className="h-4 w-4 text-purple-300" aria-hidden="true" />
        {t('analytics.weeklyDigest.batteryHealth', 'Battery Health')}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={200} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : !hasData ? (
        <EmptyState /* no-action: transient empty state — surfaces when no charging sessions exist for the week */
          icon={<Battery className="h-8 w-8" />}
          message={t('analytics.weeklyDigest.noBatteryData', 'No battery data is available for this week.')}
          className="py-8"
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BatteryPill
              level={Math.round(metrics.batteryStart ?? 0)}
              label={t('analytics.weeklyDigest.avgBatteryStart', 'Avg Battery at Charge Start')}
            />
            <BatteryPill
              level={Math.round(metrics.batteryEnd ?? 0)}
              label={t('analytics.weeklyDigest.avgBatteryEnd', 'Avg Battery at Charge End')}
            />
          </div>

          {/* Range stats */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MiniStat
              label={t('analytics.weeklyDigest.avgChargeGain', 'Avg Charge Gain')}
              value={`${fmtNumber((metrics.batteryEnd ?? 0) - (metrics.batteryStart ?? 0), 1)}%`}
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <MiniStat
              label={t('analytics.weeklyDigest.chargeSessions', 'Charge Sessions')}
              value={fmtInt(metrics.chargingSessionCount ?? 0)}
              icon={<Zap className="h-4 w-4" />}
            />
            <MiniStat
              label={t('analytics.weeklyDigest.estRangeAdded', 'Est. Range Added')}
              value={formatDistance(
                (metrics.chargeEnergyAddedWh ?? 0) * EST_RANGE_M_PER_WH,
                { precision: 0 },
              )}
              icon={<MapPin className="h-4 w-4" />}
            />
          </div>
        </>
      )}
    </GlassPanel>
  );
}
