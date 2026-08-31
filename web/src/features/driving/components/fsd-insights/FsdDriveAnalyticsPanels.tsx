import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  GitCompareArrows,
  ListChecks,
  MapPinned,
  Route,
  Scale,
} from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { Grid } from '@/components/layout';
import { MetricCard } from '@/components/data-display';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type {
  DriveFsdInsight,
  FsdAttributionConfidence,
  FsdInsights,
  FsdRouteEfficiencyComparison,
  GroupedFsdInsight,
} from '@/types/fsd';

import { FsdSectionBody } from './FsdSectionBody';
import type { FsdSectionState } from './types';

interface FsdDriveAnalyticsPanelsProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

const confidenceVariant: Record<
  FsdAttributionConfidence,
  'success' | 'info' | 'warning' | 'neutral'
> = {
  high: 'success',
  estimated: 'info',
  ambiguous: 'warning',
  unknown: 'neutral',
};

function ConfidenceBadge({ value }: { value: FsdAttributionConfidence }) {
  const { t } = useTranslation();
  return (
    <Badge variant={confidenceVariant[value]} size="sm">
      {value === 'high'
        ? t('fsd.drive.confidence.high', 'High')
        : value === 'estimated'
          ? t('fsd.drive.confidence.estimated', 'Estimated')
          : value === 'ambiguous'
            ? t('fsd.drive.confidence.ambiguous', 'Ambiguous')
            : t('fsd.drive.confidence.unknown', 'Unknown')}
    </Badge>
  );
}

function ComparisonPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const comparison = insights?.drive_analytics?.comparison;

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="fsd-period-comparison">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('fsd.comparison.title', 'Change from the previous period')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {t(
          'fsd.comparison.subtitle',
          'The immediately preceding window uses the same duration and timezone.',
        )}
      </Text>
      <FsdSectionBody state={state} className="min-h-28">
        <Grid cols={{ default: 1, sm: 3 }} gap={4}>
          <MetricCard
            label={t('fsd.comparison.distance', 'Reported FSD distance')}
            value={insights?.totals.fsd_distance_m == null
              ? '-'
              : formatDistance(insights.totals.fsd_distance_m, { precision: 1 })}
            subtitle={comparison?.fsd_distance_change_m == null
              ? t(
                  'fsd.comparison.noDistanceBaseline',
                  'Periods lack comparable trusted coverage',
                )
              : t('fsd.comparison.distanceDelta', '{{delta}} vs previous', {
                  delta: `${comparison.fsd_distance_change_m >= 0 ? '+' : ''}${formatDistance(
                    comparison.fsd_distance_change_m,
                    { precision: 1 },
                  )}`,
                })}
            color="cyan"
          />
          <MetricCard
            label={t('fsd.comparison.share', 'Share of observed driving')}
            value={insights?.totals.fsd_share_pct == null
              ? '-'
              : `${fmtNumber(insights.totals.fsd_share_pct, 1)}%`}
            subtitle={comparison?.fsd_share_change_pct_points == null
              ? t(
                  'fsd.comparison.noShareBaseline',
                  'Share periods lack comparable trusted coverage',
                )
              : t('fsd.comparison.shareDelta', '{{delta}} percentage points', {
                  delta: `${comparison.fsd_share_change_pct_points >= 0 ? '+' : ''}${fmtNumber(
                    comparison.fsd_share_change_pct_points,
                    1,
                  )}`,
                })}
            color="purple"
          />
          <MetricCard
            label={t('fsd.comparison.previous', 'Previous FSD distance')}
            value={comparison?.previous_fsd_distance_m == null
              ? '-'
              : formatDistance(comparison.previous_fsd_distance_m, { precision: 1 })}
            subtitle={comparison
              ? `${comparison.previous_period.start_date} - ${comparison.previous_period.end_date}`
              : t('fsd.comparison.notLoaded', 'Previous period not loaded')}
            color="green"
          />
        </Grid>
      </FsdSectionBody>
    </GlassPanel>
  );
}

function AttributionPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const analytics = insights?.drive_analytics;
  const breakdown = analytics?.attribution;
  const buckets = [
    {
      key: 'attributed',
      label: t('fsd.attribution.attributed', 'High-confidence attributed'),
      value: breakdown?.attributed_distance_m,
      variant: 'success' as const,
    },
    {
      key: 'estimated',
      label: t('fsd.attribution.estimated', 'Estimated'),
      value: breakdown?.estimated_distance_m,
      variant: 'info' as const,
    },
    {
      key: 'ambiguous',
      label: t('fsd.attribution.ambiguous', 'Ambiguous between drives'),
      value: breakdown?.ambiguous_distance_m,
      variant: 'warning' as const,
    },
    {
      key: 'unattributed',
      label: t('fsd.attribution.unattributed', 'Outside a known drive'),
      value: breakdown?.unattributed_distance_m,
      variant: 'neutral' as const,
    },
  ];

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="fsd-attribution">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Scale className="h-4 w-4 text-purple-300" aria-hidden="true" />
        {t('fsd.attribution.title', 'Attribution and counter resets')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {t(
          'fsd.attribution.subtitle',
          'Observed FSD counter distance is separated from drive distance that lacks synchronized evidence.',
        )}
      </Text>
      <FsdSectionBody state={state}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {buckets.map((bucket) => (
            <div
              key={bucket.key}
              className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3"
            >
              <Badge variant={bucket.variant} size="sm">{bucket.label}</Badge>
              <Text as="div" size="lg" weight="semibold" className="mt-2 tabular-nums">
                {bucket.value == null
                  ? t('fsd.notMeasured', 'Not measured')
                  : formatDistance(bucket.value, { precision: 1 })}
              </Text>
            </div>
          ))}
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
            <Badge variant="neutral" size="sm">
              {t('fsd.attribution.unknown', 'Drive distance unknown')}
            </Badge>
            <Text as="div" size="lg" weight="semibold" className="mt-2 tabular-nums">
              {breakdown?.unknown_drive_distance_m == null
                ? t('fsd.notMeasured', 'Not measured')
                : formatDistance(breakdown.unknown_drive_distance_m, { precision: 1 })}
            </Text>
          </div>
        </div>

        <div className="mt-5">
          <Text as="h3" size="sm" weight="semibold" className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
            {t('fsd.resets.title', 'Counter-reset timeline')}
          </Text>
          {(analytics?.reset_events.length ?? 0) > 0 ? (
            <ol className="space-y-2">
              {analytics?.reset_events.map((event) => (
                <li
                  key={`${event.field}-${event.at}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm"
                >
                  <Text as="span" weight="medium">{formatDateTime(event.at)}</Text>
                  <Badge variant="warning" size="sm">{event.field}</Badge>
                  <Text as="span" color="muted">
                    {t('fsd.resets.changed', 'Counter moved from {{previous}} to {{current}}.', {
                      previous: formatDistance(event.previous_value_m, { precision: 1 }),
                      current: formatDistance(event.current_value_m, { precision: 1 }),
                    })}
                  </Text>
                  {event.affected_drive_ids.map((driveID) => (
                    <Link key={driveID} to={`/drives/${driveID}`} className="text-cyan-300 hover:text-cyan-200">
                      #{driveID}
                    </Link>
                  ))}
                </li>
              ))}
            </ol>
          ) : (
            <Text as="p" variant="caption">
              {t('fsd.resets.none', 'No trusted counter reset was observed in this period.')}
            </Text>
          )}
        </div>
      </FsdSectionBody>
    </GlassPanel>
  );
}

function ContributingDrivesPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const rows = useMemo(
    () => (insights?.drive_analytics?.contributing_drives ?? [])
      .filter((drive) => drive.fsd_distance_m != null && drive.fsd_distance_m > 0),
    [insights],
  );
  const columns = useMemo<Column<DriveFsdInsight>[]>(() => [
    {
      key: 'started_at',
      header: t('fsd.drives.date', 'Drive'),
      render: (row) => (
        <div>
          <Link to={`/drives/${row.drive_id}`} className="font-medium text-cyan-300 hover:text-cyan-200">
            {formatDateTime(row.started_at)}
          </Link>
          <Text as="div" size="xs" color="muted">
            {row.start_place ?? t('fsd.drives.unknownStart', 'Unknown start')}
            {' to '}
            {row.end_place ?? t('fsd.drives.unknownEnd', 'Unknown end')}
          </Text>
        </div>
      ),
    },
    {
      key: 'fsd_distance_m',
      header: t('fsd.drives.distance', 'Reported FSD'),
      render: (row) => (
        <span className="tabular-nums">
          {row.confidence === 'high' ? '' : '~'}
          {formatDistance(row.fsd_distance_m, { precision: 1 })}
        </span>
      ),
    },
    {
      key: 'fsd_share_pct',
      header: t('fsd.drives.share', 'Drive share'),
      render: (row) => row.fsd_share_pct == null
        ? '-'
        : `${row.confidence === 'high' ? '' : '~'}${fmtNumber(row.fsd_share_pct, 1)}%`,
    },
    {
      key: 'confidence',
      header: t('fsd.drives.confidence', 'Confidence'),
      render: (row) => <ConfidenceBadge value={row.confidence} />,
    },
    {
      key: 'firmware_version',
      header: t('fsd.drives.firmware', 'Firmware'),
      render: (row) => row.firmware_version ?? '-',
    },
    {
      key: 'drive_id',
      header: '',
      render: (row) => (
        <Link to={`/drives/${row.drive_id}`} aria-label={t('fsd.drives.open', 'Open drive {{id}}', { id: row.drive_id })}>
          <ArrowRight className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        </Link>
      ),
    },
  ], [formatDistance, t]);

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="fsd-contributing-drives">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('fsd.drives.title', 'Contributing drives')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {t(
          'fsd.drives.subtitle',
          'Completed drives fully inside this period with positive reported supervised-driving distance.',
        )}
      </Text>
      <FsdSectionBody state={state} className="min-h-52">
        {rows.length > 0 ? (
          <DataTable
            tableId="fsd-contributing-drives"
            name="FsdContributingDrives"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.drive_id}
            mobileColumns={['started_at', 'fsd_distance_m', 'confidence']}
          />
        ) : (
          <EmptyState /* no-action: this fills automatically when the selected period contains attributable FSD distance */
            icon={<Route className="h-8 w-8" aria-hidden="true" />}
            message={t('fsd.drives.empty', 'No drive has positive attributable FSD distance in this period.')}
          />
        )}
      </FsdSectionBody>
    </GlassPanel>
  );
}

function GroupTable({
  title,
  rows,
}: {
  title: string;
  rows: GroupedFsdInsight[];
}) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  return (
    <div>
      <Text as="h3" size="sm" weight="semibold" className="mb-2">{title}</Text>
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-default)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2">{t('fsd.groups.group', 'Group')}</th>
                <th className="px-3 py-2">{t('fsd.groups.drives', 'Drives')}</th>
                <th className="px-3 py-2">{t('fsd.groups.distance', 'FSD distance')}</th>
                <th className="px-3 py-2">{t('fsd.groups.share', 'Share')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-[var(--border-default)]">
                  <td className="px-3 py-2 font-medium">{row.label}</td>
                  <td className="px-3 py-2 tabular-nums">{row.drive_count}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatDistance(row.fsd_distance_m, { precision: 1 })}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.fsd_share_pct == null ? '-' : `${fmtNumber(row.fsd_share_pct, 1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Text as="p" variant="caption">
          {t('fsd.groups.empty', 'Not enough high-confidence drives for this comparison.')}
        </Text>
      )}
    </div>
  );
}

function ComparisonGroupsPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { t } = useTranslation();
  const analytics = insights?.drive_analytics;
  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="fsd-comparison-groups">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Clock3 className="h-4 w-4 text-green-300" aria-hidden="true" />
        {t('fsd.groups.title', 'Route, time, and firmware comparisons')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-4">
        {t(
          'fsd.groups.subtitle',
          'Only high-confidence drives contribute; repeated routes require at least two drives.',
        )}
      </Text>
      <FsdSectionBody state={state}>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <GroupTable
            title={t('fsd.groups.routes', 'Repeated routes')}
            rows={analytics?.repeated_routes ?? []}
          />
          <GroupTable
            title={t('fsd.groups.time', 'Time of day')}
            rows={analytics?.time_of_day ?? []}
          />
          <GroupTable
            title={t('fsd.groups.firmware', 'Firmware version')}
            rows={analytics?.firmware ?? []}
          />
        </div>
      </FsdSectionBody>
    </GlassPanel>
  );
}

function EfficiencyPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const rows = insights?.drive_analytics?.route_efficiency ?? [];
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const efficiencyMultiplier = unitPrefs.distance === 'mi' ? 1.609344 : 1;
  const columns = useMemo<Column<FsdRouteEfficiencyComparison>[]>(() => [
    {
      key: 'route_label',
      header: t('fsd.efficiency.route', 'Route'),
      render: (row) => row.route_label,
    },
    {
      key: 'fsd_heavy_drive_count',
      header: t('fsd.efficiency.heavy', 'FSD-heavy'),
      render: (row) => `${row.fsd_heavy_drive_count} / ${fmtNumber(
        row.fsd_heavy_efficiency_wh_per_km * efficiencyMultiplier,
        0,
      )} ${efficiencyUnit}`,
    },
    {
      key: 'low_fsd_drive_count',
      header: t('fsd.efficiency.low', 'Low-FSD'),
      render: (row) => `${row.low_fsd_drive_count} / ${fmtNumber(
        row.low_fsd_efficiency_wh_per_km * efficiencyMultiplier,
        0,
      )} ${efficiencyUnit}`,
    },
    {
      key: 'difference_pct',
      header: t('fsd.efficiency.difference', 'Difference'),
      render: (row) => `${row.difference_pct >= 0 ? '+' : ''}${fmtNumber(row.difference_pct, 1)}%`,
    },
  ], [efficiencyMultiplier, efficiencyUnit, t]);

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="fsd-route-efficiency">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <MapPinned className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('fsd.efficiency.title', 'Same-route efficiency comparison')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {insights?.drive_analytics?.correlation_disclaimer
          ?? t(
            'fsd.efficiency.disclaimer',
            'This is a same-route correlation, not proof that supervised driving caused an efficiency difference.',
          )}
      </Text>
      <FsdSectionBody state={state} className="min-h-40">
        {rows.length > 0 ? (
          <DataTable
            tableId="fsd-route-efficiency"
            name="FsdRouteEfficiency"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.route_key}
            mobileColumns={['route_label', 'difference_pct']}
          />
        ) : (
          <EmptyState /* no-action: this comparison appears automatically after enough matching high-confidence drives accumulate */
            icon={<MapPinned className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'fsd.efficiency.empty',
              'No repeated route has at least two FSD-heavy and two low-FSD high-confidence drives.',
            )}
          />
        )}
      </FsdSectionBody>
    </GlassPanel>
  );
}

export function FsdDriveAnalyticsPanels(props: FsdDriveAnalyticsPanelsProps) {
  return (
    <>
      <ComparisonPanel {...props} />
      <AttributionPanel {...props} />
      <ContributingDrivesPanel {...props} />
      <ComparisonGroupsPanel {...props} />
      <EfficiencyPanel {...props} />
    </>
  );
}
