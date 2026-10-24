import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { useFsdInsightsRange } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { EmptyState } from '@/components/feedback';
import { getWeekRange } from '@/features/analytics/components/weekly-digest/helpers';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { knownNumber } from '@/api/dataState';

import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { WidgetBigNumber, WidgetStatGrid, type StatGridItem } from './shared';

export default function FsdWeeklyWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
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

  const distanceM = knownNumber(data?.totals?.fsd_distance_m);
  const sharePct = knownNumber(data?.totals?.fsd_share_pct);
  const shareChange = knownNumber(
    data?.drive_analytics?.comparison?.fsd_share_change_pct_points,
  );
  const distanceValue = distanceM != null ? formatDistance(distanceM, { precision: 0 }) : null;
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

  return (
    <WidgetShell
      dataState={id > 0 && (data || isLoading || isError) ? dataState : undefined}
      title={t('widget.fsdWeekly.title', 'FSD this week')}
      icon={isCompact ? undefined : <Gauge className="h-3.5 w-3.5 text-cyan-400" />}
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
      {id <= 0 ? (
        <EmptyState /* no-action: informational empty — no CTA */
          icon={<Gauge className="h-5 w-5" />}
          message={t('widget.fsdWeekly.noVehicle', 'Select a vehicle')}
          className="py-4"
        />
      ) : (
        <div className="flex h-full min-w-0 flex-col gap-3">
          <div data-testid="fsd-weekly-distance">
            <WidgetBigNumber
              value={distanceValue}
              label={t('widget.fsdWeekly.distance', 'Reported FSD')}
              animated={false}
              align={isCompact ? 'center' : 'start'}
            />
          </div>
          {data && !isCompact && <WidgetStatGrid stats={stats} cols={2} maxPerRow={2} />}
          {!isCompact && (
            <div className="mt-auto flex flex-wrap gap-3 text-xs font-medium">
              <Link to="/fsd" className="text-cyan-300 hover:text-cyan-200">
                {t('widget.fsdWeekly.openFsd', 'FSD insights')}
              </Link>
              <Link to="/weekly-digest" className="text-cyan-300 hover:text-cyan-200">
                {t('widget.fsdWeekly.openDigest', 'Weekly digest')}
              </Link>
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
