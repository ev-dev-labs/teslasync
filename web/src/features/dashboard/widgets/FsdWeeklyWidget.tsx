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
import { useDataState } from '@/hooks/useDataState';

import { browserTimezone } from '@/lib/timezone';

import { WidgetShell } from './WidgetShell';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export default function FsdWeeklyWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { formatDistance } = useUnits();
  const isCompact = size.cols <= 1;

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(0), []);
  const startIso = weekStart.toISOString();
  const endIso = useMemo(() => new Date(weekEnd.getTime() + 1).toISOString(), [weekEnd]);

  const query = useFsdInsightsRange(
    id > 0 ? String(id) : undefined,
    startIso,
    endIso,
    browserTimezone(),
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

  const distanceM = data?.totals?.fsd_distance_m ?? null;
  const sharePct = data?.totals?.fsd_share_pct ?? null;
  const shareChange = data?.drive_analytics?.comparison?.fsd_share_change_pct_points ?? null;

  const metrics: readonly StatMetric[] = [
    { metricId: 'distance', rawValue: distanceM, label: t('widget.fsdWeekly.distance', 'Reported FSD'),
      description: t('widget.fsdWeekly.summary.distanceHelp', 'Reported supervised-driving distance in metres for this Monday–Sunday window.'),
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) } },
    { metricId: 'percent', rawValue: sharePct, label: t('widget.fsdWeekly.share', 'Share'),
      description: t('widget.fsdWeekly.summary.shareHelp', 'Source-reported FSD share, on the 0–100 percent scale.'),
      display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) } },
    { metricId: 'number', rawValue: shareChange, label: t('widget.fsdWeekly.vsLastWeek', 'vs last week'),
      description: t('widget.fsdWeekly.summary.changeHelp', 'Share change in percentage points versus the previous Monday–Sunday window, not a percent growth rate.'),
      display: { formatter: raw => ({ value: `${raw >= 0 ? '+' : ''}${fmtNumber(raw)}`, unit: 'pts' }) } },
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
            <DashboardSourceBrief
              metrics={metrics}
              state={dataState}
              eyebrow={t('widget.fsdWeekly.summary.eyebrow', 'Supervised driving')}
              title={t('widget.fsdWeekly.summary.title', 'Weekly FSD summary')}
              description={t('widget.fsdWeekly.honesty', 'Unmeasured is not zero. Last week is the previous Monday–Sunday window.')}
              scope={t('widget.fsdWeekly.summary.scope', 'Vehicle {{id}} · {{start}} to {{end}} exclusive · {{timezone}}', {
                id, start: startIso, end: endIso, timezone: browserTimezone(),
              })}
              testId="fsd-weekly-operational-brief"
            />
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
