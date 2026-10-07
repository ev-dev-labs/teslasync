import type { ComponentProps } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gauge, TrendingDown, TrendingUp } from 'lucide-react';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { LayoutCard } from '@/components/layout';
import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Text } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { FsdPanel } from '../weekly-digest-modernization/FsdPanel';

export function FsdOperationalPanel({
  insights, period, isLoading, isError, error, onRetry, isCurrentWeek,
}: ComponentProps<typeof FsdPanel>) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const distance = insights?.totals?.fsd_distance_m;
  const share = insights?.totals?.fsd_share_pct;
  const distanceChange = insights?.drive_analytics?.comparison?.fsd_distance_change_m;
  const shareChange = insights?.drive_analytics?.comparison?.fsd_share_change_pct_points;
  const available = insights != null;
  const baselineMissing = t('analytics.weeklyDigest.fsdNoBaseline', 'No comparable week');
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'weekly-fsd-distance', rawValue: available ? distance : null,
      label: t('analytics.weeklyDigest.fsdDistance', 'Reported FSD'),
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'weekly-fsd-share', rawValue: available ? share : null,
      label: t('analytics.weeklyDigest.fsdShare', 'Share of observed driving'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) } },
    { metricId: 'distance', occurrenceId: 'weekly-fsd-distance-change', rawValue: available ? distanceChange : null,
      label: t('analytics.weeklyDigest.fsdDistanceChange', 'FSD vs previous week'), missingReason: baselineMissing,
      context: distanceChange != null ? distanceChange < 0
        ? <TrendingDown className="h-4 w-4 text-amber-300" aria-hidden="true" />
        : <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" /> : undefined,
      display: { formatter: raw => ({ value: `${raw >= 0 ? '+' : ''}${formatDistance(raw)}`, unit: '' }) } },
    { metricId: 'rate', occurrenceId: 'weekly-fsd-share-change', rawValue: available ? shareChange : null,
      label: t('analytics.weeklyDigest.fsdShareChange', 'Share vs previous week'), missingReason: baselineMissing,
      context: shareChange != null ? shareChange < 0
        ? <TrendingDown className="h-4 w-4 text-amber-300" aria-hidden="true" />
        : <TrendingUp className="h-4 w-4 text-cyan-300" aria-hidden="true" /> : undefined,
      display: { formatter: raw => ({ value: `${raw >= 0 ? '+' : ''}${fmtNumber(raw)}`, unit: 'pts' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const honesty = t('analytics.weeklyDigest.fsdHonesty', 'These are cumulative counter changes, not exact FSD engagement. Absence is not zero.');
  return <LayoutCard title={t('analytics.weeklyDigest.fsdSection', 'Supervised driving')}>
    <div data-testid="fsd-weekly-section" className="flex min-w-0 flex-col gap-3">
      <OperationalBrief compact testId="weekly-fsd-brief"
        eyebrow={t('analytics.weeklyDigest.title', 'Weekly digest')}
        title={t('analytics.weeklyDigest.brief.fsdTitle', 'Supervised-driving evidence')}
        description={honesty} metrics={operationalMetrics} loading={Boolean(isLoading && !insights)}
        statusLabel={isError ? insights
          ? t('analytics.weeklyDigest.brief.retained', 'Retained or partial weekly records')
          : t('analytics.weeklyDigest.brief.unavailable', 'Weekly sources unavailable')
          : isLoading ? t('analytics.weeklyDigest.brief.loading', 'Loading weekly records')
            : distance == null ? t('analytics.weeklyDigest.brief.fsdMissing', 'Supervised distance not measured')
              : t('analytics.weeklyDigest.brief.available', 'Returned weekly records')}
        statusTone={isError ? 'warning' : 'neutral'} scope={period.label} provenance={honesty} />
      {isError ? <QueryError error={error} onRetry={onRetry} />
        : !isLoading && distance == null ? <EmptyState
          icon={<Gauge className="h-8 w-8" aria-hidden="true" />}
          message={t('analytics.weeklyDigest.fsdNotMeasured', 'No supervised-driving distance was measured this week.')}
          actionTo={{ label: t('routes.fSDInsights', 'FSD insights'), to: '/fsd?days=7' }} className="py-8" />
          : null}
      {available && distance != null && isCurrentWeek && <AlertBanner variant="info"
        title={t('analytics.weeklyDigest.fsdNoticeTitle', 'This week vs last week')}>
        {t('analytics.weeklyDigest.fsdNotice', 'Reported FSD {{distance}}{{share}}{{change}}.', {
          distance: formatDistance(distance),
          share: share == null ? '' : t('analytics.weeklyDigest.fsdNoticeShare', ' ({{value}}% of observed driving)', { value: fmtNumber(share) }),
          change: shareChange == null ? '' : t('analytics.weeklyDigest.fsdNoticeChange', ', {{delta}} pts vs last week', {
            delta: `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange)}`,
          }),
        })}
      </AlertBanner>}
      {available && distance != null && <Text as="p" variant="caption">
        {honesty}{' '}
        <Link to="/fsd?days=7" className="inline-flex min-h-11 items-center text-[var(--accent)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">
          {t('analytics.weeklyDigest.fsdOpenInsights', 'Open FSD insights')}
        </Link>
      </Text>}
    </div>
  </LayoutCard>;
}
