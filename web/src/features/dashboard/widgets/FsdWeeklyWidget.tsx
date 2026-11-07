import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { useFsdInsightsRange } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Caption, Text } from '@/components/ui';
import { getWeekRange } from '@/features/analytics/components/weekly-digest/helpers';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { knownNumber } from '@/api/dataState';

import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';

export default function FsdWeeklyWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const isClassic = usePackPresentation() === 'classic';
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatDistance } = useUnits();
  const { tz } = useDateFormat();
  const isCompact = size.cols <= 1;

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(0, tz), [tz]);
  const startIso = weekStart.toISOString();
  const endIso = useMemo(() => new Date(weekEnd.getTime() + 1).toISOString(), [weekEnd]);

  const query = useFsdInsightsRange(
    id > 0 ? String(id) : undefined,
    startIso,
    endIso,
    tz,
  );
  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const dataState = useDataState(query, { provenance: 'historical' });

  const reportedDistanceM = knownNumber(data?.totals?.fsd_distance_m);
  const distanceM = reportedDistanceM != null && reportedDistanceM >= 0 ? reportedDistanceM : null;
  const reportedSharePct = knownNumber(data?.totals?.fsd_share_pct);
  const sharePct = reportedSharePct != null && reportedSharePct >= 0 && reportedSharePct <= 100
    ? reportedSharePct : null;
  const shareChange = knownNumber(
    data?.drive_analytics?.comparison?.fsd_share_change_pct_points,
  );
  const previousDistanceM = knownNumber(data?.drive_analytics?.comparison?.previous_fsd_distance_m);
  const distanceValue = distanceM != null ? formatDistance(distanceM, { precision: 0 }) : null;
  const previousDistanceValue = previousDistanceM != null && previousDistanceM >= 0
    ? formatDistance(previousDistanceM, { precision: 0 }) : null;
  const stats: StatGridItem[] = [
    {
      label: t('widget.fsdWeekly.share', 'Share'),
      value: sharePct != null ? fmtNumber(sharePct, 0) : null,
      unit: '%',
    },
    {
      label: t('widget.fsdWeekly.vsLastWeek', 'vs last week'),
      value: shareChange != null
        ? `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange, 0)}`
        : null,
      unit: 'pts',
    },
  ];
  const notAvailable = t('dashboardWidgets.analytics.fsdWeekly.notAvailable', 'Not available');
  const headline = (
    <div data-testid="fsd-weekly-distance">
      <WidgetBigNumber
        value={distanceValue}
        label={isClassic
          ? t('widget.fsdWeekly.distance', 'Reported FSD')
          : t('dashboardWidgets.analytics.fsdWeekly.reportedDistance', 'Reported supervised-driving distance')}
        animated={false}
        align={isCompact ? 'center' : 'start'}
        badge={!isClassic && distanceM == null
          ? { text: t('dashboardWidgets.analytics.fsdWeekly.unmeasured', 'UNMEASURED'), variant: 'neutral' }
          : undefined}
      />
    </div>
  );
  const navigation = !isCompact && (
    <Text as="div" variant="label" className="mt-auto flex flex-wrap gap-3">
      <Link to="/fsd" className="text-theme-accent hover:text-theme-accent">
        {t('widget.fsdWeekly.openFsd', 'FSD insights')}
      </Link>
      <Link to="/weekly-digest" className="text-theme-accent hover:text-theme-accent">
        {t('widget.fsdWeekly.openDigest', 'Weekly digest')}
      </Link>
    </Text>
  );
  const noVehicle = (
    <EmptyState /* no-action: informational empty — no CTA */
      icon={<Gauge className="h-5 w-5" />}
      message={t('widget.fsdWeekly.noVehicle', 'Select a vehicle')}
      className="py-4"
    />
  );
  const details = id > 0 && !isCompact && (
    <div className="flex min-w-0 flex-col gap-3">
      <KVList wrap items={[
        { id: 'current', label: t('dashboardWidgets.analytics.fsdWeekly.thisWeek', 'This week'), value: distanceValue ?? notAvailable },
        { id: 'previous', label: t('widget.comparison.previousLabel', 'Last week'), value: previousDistanceValue ?? notAvailable },
        ...stats.map((stat, index) => ({
          id: `stat-${index}`,
          label: stat.label,
          value: stat.value != null ? <>{stat.value} <Caption>{stat.unit}</Caption></> : notAvailable,
        })),
      ]} />
      {navigation}
    </div>
  );

  return (
    <WidgetShell
      dataState={id > 0 && (data || isLoading || isError) ? dataState : undefined}
      title={t('widget.fsdWeekly.title', 'FSD this week')}
      icon={isCompact ? undefined : <Gauge className="h-3.5 w-3.5 text-theme-accent" />}
      loading={isLoading}
      error={error && !data ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => {
        void refetch();
      }}
      help={{
        i18nKey: 'help.fsdWeekly.body',
        defaultValue:
          'Reported supervised-driving distance this Monday–Sunday versus last week. Unmeasured is not zero.',
      }}
    >
      <InstrumentPresentation
        family="empty"
        compact={isCompact}
        icon={id > 0 ? <Gauge /> : undefined}
        headline={id > 0 ? headline : undefined}
        context={id > 0 ? (
          <Caption>{t('dashboardWidgets.analytics.fsdWeekly.unmeasuredNote', 'Unmeasured distance is not zero.')}</Caption>
        ) : undefined}
        instrument={id <= 0 ? noVehicle : undefined}
        details={details}
      >
        {id <= 0 ? noVehicle : (
          <div className="flex h-full min-w-0 flex-col gap-3">
            {headline}
            {data && !isCompact && <WidgetStatGrid stats={stats} cols={2} maxPerRow={2} />}
            {navigation}
          </div>
        )}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
