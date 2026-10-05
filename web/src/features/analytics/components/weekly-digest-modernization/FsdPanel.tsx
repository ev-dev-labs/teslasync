import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatGroup } from '@/components/data-display/stat-reference';
import { AlertBanner, EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { FsdInsights } from '@/types/fsd';
import type { StatPeriod } from '@/lib/metric-reference';
import { presentedMetric } from './presentation';

interface FsdPanelProps {
  insights: FsdInsights | undefined;
  period: StatPeriod;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isCurrentWeek?: boolean;
}

export function FsdPanel({
  insights,
  period,
  isLoading,
  isError,
  error,
  onRetry,
  isCurrentWeek,
}: FsdPanelProps) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { formatDistance } = useUnits();
  const fsdDistanceM = insights?.totals?.fsd_distance_m;
  const comparison = insights?.drive_analytics?.comparison;
  const share = insights?.totals?.fsd_share_pct;
  const shareChange = comparison?.fsd_share_change_pct_points;
  const distanceChange = comparison?.fsd_distance_change_m;

  return (
    <LayoutCard title={t('analytics.weeklyDigest.fsdSection', 'Supervised driving')}>
      <div data-testid="fsd-weekly-section" className="flex min-w-0 flex-col gap-3">
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
                    distance: formatDistance(fsdDistanceM),
                    share: share == null
                      ? ''
                      : t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', {
                          value: fmtNumber(share),
                        }),
                    change: shareChange == null
                      ? ''
                      : t('analytics.weeklyDigest.fsdNoticeChange', ', {{delta}} pts vs last week', {
                          delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,
                        }),
                  },
                )}
              </AlertBanner>
            )}
            <StatGroup
              period={period}
              metrics={[
                presentedMetric(
                  'reported-fsd',
                  t('analytics.weeklyDigest.fsdDistance', 'Reported FSD'),
                  formatDistance(fsdDistanceM),
                  <Gauge className="h-4 w-4" aria-hidden="true" />,
                ),
                presentedMetric(
                  'fsd-share',
                  t('analytics.weeklyDigest.fsdShare', 'Share of observed driving'),
                  share == null ? '—' : `${fmtNumber(share)}%`,
                  <Gauge className="h-4 w-4" aria-hidden="true" />,
                ),
                presentedMetric(
                  'fsd-distance-change',
                  t('analytics.weeklyDigest.fsdDistanceChange', 'FSD vs previous week'),
                  distanceChange == null
                    ? t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')
                    : `${distanceChange >= 0 ? '+' : ''}${formatDistance(distanceChange)}`,
                  distanceChange != null && distanceChange < 0
                    ? <TrendingDown className="h-4 w-4 text-amber-300" aria-hidden="true" />
                    : <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />,
                ),
                presentedMetric(
                  'fsd-share-change',
                  t('analytics.weeklyDigest.fsdShareChange', 'Share vs previous week'),
                  shareChange == null
                    ? t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week')
                    : `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)} pts`,
                  shareChange != null && shareChange < 0
                    ? <TrendingDown className="h-4 w-4 text-amber-300" aria-hidden="true" />
                    : <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" />,
                ),
              ]}
            />
            <Text as="p" variant="caption">
              {t(
                'analytics.weeklyDigest.fsdHonesty',
                'These are cumulative counter changes, not exact FSD engagement. Absence is not zero.',
              )}
              {' '}
              <Link
                to="/fsd?days=7"
                className="inline-flex min-h-11 items-center text-[var(--accent)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]"
              >
                {t('analytics.weeklyDigest.fsdOpenInsights', 'Open FSD insights')}
              </Link>
            </Text>
          </>
        )}
      </div>
    </LayoutCard>
  );
}
