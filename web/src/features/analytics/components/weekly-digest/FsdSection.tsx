import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gauge, TrendingDown, TrendingUp } from 'lucide-react';

import { AlertBanner, EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import type { FsdInsights } from '@/types/fsd';

import { MiniStat } from './MiniStat';

interface FsdSectionProps {
  insights: FsdInsights | undefined;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isCurrentWeek?: boolean;
}

export function FsdSection({
  insights,
  isLoading,
  isError,
  error,
  onRetry,
  isCurrentWeek,
}: FsdSectionProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const fsdDistanceM = insights?.totals?.fsd_distance_m;
  const comparison = insights?.drive_analytics?.comparison;
  const share = insights?.totals?.fsd_share_pct;
  const shareChange = comparison?.fsd_share_change_pct_points;
  const distanceChange = comparison?.fsd_distance_change_m;

  return (
    <GlassPanel className="flex h-full flex-col gap-5 p-4 sm:p-5" data-testid="fsd-weekly-section">
      <PanelTitle className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('analytics.weeklyDigest.fsdSection', 'Supervised driving')}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={180} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : fsdDistanceM == null ? (
        <EmptyState
          icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'analytics.weeklyDigest.fsdNotMeasured',
            'No supervised-driving distance was measured this week.',
          )}
          className="py-8"
        />
      ) : (
        <>
          {isCurrentWeek && (
            <AlertBanner
              variant="info"
              title={t('analytics.weeklyDigest.fsdNoticeTitle', 'This week vs last week')}
            >
              {t(
                'analytics.weeklyDigest.fsdNotice',
                'Reported FSD {{distance}}{{share}}{{change}}.',
                {
                  distance: formatDistance(fsdDistanceM, { precision: 1 }),
                  share: share == null
                    ? ''
                    : t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', {
                        value: fmtNumber(share, 1),
                      }),
                  change: shareChange == null
                    ? ''
                    : t(
                        'analytics.weeklyDigest.fsdNoticeChange',
                        ', {{delta}} pts vs last week',
                        {
                          delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange, 1)}`,
                        },
                      ),
                },
              )}
            </AlertBanner>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MiniStat
              label={t('analytics.weeklyDigest.fsdDistance', 'Reported FSD')}
              value={formatDistance(fsdDistanceM, { precision: 1 })}
              icon={<Gauge className="h-4 w-4" />}
            />
            <MiniStat
              label={t('analytics.weeklyDigest.fsdShare', 'Share of observed driving')}
              value={share == null ? '—' : `${fmtNumber(share, 1)}%`}
              icon={<Gauge className="h-4 w-4" />}
            />
            <MiniStat
              label={t('analytics.weeklyDigest.fsdDistanceChange', 'FSD vs previous week')}
              value={distanceChange == null
                ? t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')
                : `${distanceChange >= 0 ? '+' : ''}${formatDistance(distanceChange, { precision: 1 })}`}
              icon={
                distanceChange != null && distanceChange < 0
                  ? <TrendingDown className="h-4 w-4 text-amber-300" />
                  : <TrendingUp className="h-4 w-4 text-cyan-300" />
              }
            />
            <MiniStat
              label={t('analytics.weeklyDigest.fsdShareChange', 'Share vs previous week')}
              value={shareChange == null
                ? t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')
                : `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange, 1)} pts`}
              icon={
                shareChange != null && shareChange < 0
                  ? <TrendingDown className="h-4 w-4 text-amber-300" />
                  : <TrendingUp className="h-4 w-4 text-cyan-300" />
              }
            />
          </div>

          <Text as="p" variant="caption">
            {t(
              'analytics.weeklyDigest.fsdHonesty',
              'These are cumulative counter changes, not exact FSD engagement. Absence is not zero.',
            )}
            {' '}
            <Link to="/fsd?days=7" className="text-cyan-300 hover:text-cyan-200">
              {t('analytics.weeklyDigest.fsdOpenInsights', 'Open FSD insights')}
            </Link>
          </Text>
        </>
      )}
    </GlassPanel>
  );
}
