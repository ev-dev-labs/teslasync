import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { useFsdInsightsRange } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
import { getWeekRange } from '@/features/analytics/components/weekly-digest/helpers';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { browserTimezone } from '@/lib/timezone';

import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function FsdWeeklyWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatDistance } = useUnits();
  const isCompact = size.cols <= 1;

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(0), []);
  const startIso = weekStart.toISOString();
  const endIso = useMemo(() => new Date(weekEnd.getTime() + 1).toISOString(), [weekEnd]);

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useFsdInsightsRange(
    id > 0 ? String(id) : undefined,
    startIso,
    endIso,
    browserTimezone(),
  );

  const distanceM = data?.totals.fsd_distance_m ?? null;
  const sharePct = data?.totals.fsd_share_pct ?? null;
  const shareChange = data?.drive_analytics.comparison.fsd_share_change_pct_points ?? null;

  const distanceLabel = distanceM == null
    ? '—'
    : formatDistance(distanceM, { precision: 1 });
  const shareLabel = sharePct == null ? '—' : `${fmtNumber(sharePct, 1)}%`;
  const changeLabel = shareChange == null
    ? '—'
    : `${shareChange >= 0 ? '+' : ''}${fmtNumber(shareChange, 1)} pts`;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.fsdWeekly.title', 'FSD this week')}
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
        <EmptyState
          icon={<Gauge className="h-5 w-5" />}
          message={t('widget.fsdWeekly.noVehicle', 'Select a vehicle')}
          className="py-4"
        />
      ) : (
        <div className="flex h-full flex-col gap-3 px-4 pb-3">
          <div>
            <Text as="div" size="xs" color="muted">
              {t('widget.fsdWeekly.distance', 'Reported FSD')}
            </Text>
            <div
              data-testid="fsd-weekly-distance"
              className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--text-primary)]"
            >
              {distanceLabel}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <div>
              <Text as="div" size="xs" color="muted">
                {t('widget.fsdWeekly.share', 'Share')}
              </Text>
              <div data-testid="fsd-weekly-share" className="tabular-nums">
                {shareLabel}
              </div>
            </div>
            <div>
              <Text as="div" size="xs" color="muted">
                {t('widget.fsdWeekly.vsLastWeek', 'vs last week')}
              </Text>
              <div data-testid="fsd-weekly-change" className="tabular-nums">
                {changeLabel}
              </div>
            </div>
          </div>
          <Text as="p" size="xs" color="muted">
            {t(
              'widget.fsdWeekly.honesty',
              'Unmeasured is not zero. Last week is the previous Monday–Sunday window.',
            )}
          </Text>
          {!isCompact && (
            <div className="mt-auto flex flex-wrap gap-3 text-xs font-medium">
              <Link to="/fsd" className="text-cyan-300 hover:text-cyan-200">
                {t('widget.fsdWeekly.openFsd', 'FSD Insights')}
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
