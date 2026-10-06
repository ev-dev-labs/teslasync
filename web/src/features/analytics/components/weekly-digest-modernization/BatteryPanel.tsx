import { useTranslation } from 'react-i18next';
import { Battery, TrendingUp, Zap, MapPin } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatGroup } from '@/components/data-display/stat-reference';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatPeriod } from '@/lib/metric-reference';
import type { DigestMetrics } from '../weekly-digest/types';
import { BatteryPill } from '../weekly-digest';
import { presentedMetric } from './presentation';

// Preserve the original rough estimate: 5.5 km/kWh = 5.5 m/Wh.
const EST_RANGE_M_PER_WH = 5.5;

interface BatteryPanelProps {
  metrics: DigestMetrics;
  period: StatPeriod;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function BatteryPanel({
  metrics,
  period,
  isLoading,
  isError,
  error,
  onRetry,
}: BatteryPanelProps) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { formatDistance } = useUnits();
  const hasData = (metrics.chargingSessionCount ?? 0) > 0;
  return (
    <LayoutCard title={t('analytics.weeklyDigest.batteryHealth', 'Battery health')}>
      {isLoading ? (
        <Skeleton height={200} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : !hasData ? (
        <EmptyState
          icon={<Battery className="h-8 w-8" aria-hidden="true" />}
          message={t('analytics.weeklyDigest.noBatteryData', 'No battery data is available for this week.')}
          actionTo={{ label: t('routes.charging', 'Charging'), to: '/charging' }}
          className="py-8"
        />
      ) : (
        <>
          {/* Keep the specialist battery gauge's rounding, clamping and color.
              Its original average measurements are not new SOC snapshots. */}
          <div className="flex min-w-0 flex-wrap gap-3">
            <BatteryPill
              className="w-full min-w-0"
              level={Math.round(metrics.batteryStart ?? 0)}
              label={t('analytics.weeklyDigest.avgBatteryStart', 'Avg battery at charge start')}
            />
            <BatteryPill
              className="w-full min-w-0"
              level={Math.round(metrics.batteryEnd ?? 0)}
              label={t('analytics.weeklyDigest.avgBatteryEnd', 'Avg battery at charge end')}
            />
          </div>
          <StatGroup
            period={period}
            metrics={[
              presentedMetric(
                'avg-charge-gain',
                t('analytics.weeklyDigest.avgChargeGain', 'Avg charge gain'),
                `${fmtNumber((metrics.batteryEnd ?? 0) - (metrics.batteryStart ?? 0))}%`,
                <TrendingUp className="h-4 w-4" aria-hidden="true" />,
              ),
              presentedMetric(
                'charge-sessions',
                t('analytics.weeklyDigest.chargeSessions', 'Charge sessions'),
                fmtInt(metrics.chargingSessionCount ?? 0),
                <Zap className="h-4 w-4" aria-hidden="true" />,
              ),
              presentedMetric(
                'estimated-range-added',
                t('analytics.weeklyDigest.estRangeAdded', 'Est. range added'),
                formatDistance((metrics.chargeEnergyAddedWh ?? 0) * EST_RANGE_M_PER_WH),
                <MapPin className="h-4 w-4" aria-hidden="true" />,
              ),
            ]}
          />
        </>
      )}
    </LayoutCard>
  );
}
