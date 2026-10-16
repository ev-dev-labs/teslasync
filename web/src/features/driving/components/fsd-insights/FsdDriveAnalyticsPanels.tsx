import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Cpu,
  Download,
  GitCompareArrows,
  ListChecks,
  MapPinned,
  Route,
  Scale,
} from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  Button,
  BUTTON_BASE,
  DataTable,
  GlassPanel,
  Pagination,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { useUnits } from '@/hooks/useUnits';
import { defaultExportFilename, downloadJSON, downloadRowsAsCSV } from '@/lib/csvExport';
import { useDateFormat } from '@/hooks/useDateFormat';
import { convertEfficiencyFromSI } from '@/lib/unitConversion';
import { neonColorMap, typography } from '@/lib/tokens';

import type {
  DriveFsdInsight,
  FsdAttributionConfidence,
  FsdCommuteIdentity,
  FsdFirmwareRouteSpotlight,
  FsdInsights,
  FsdRouteEfficiencyComparison,
  GroupedFsdInsight,
} from '@/types/fsd';

import { FsdCommuteExperimentPanel } from './FsdCommuteExperimentPanel';
import { FsdSectionBody } from './FsdSectionBody';
import type { FsdSectionState } from './types';
import { useClientPagination } from './useClientPagination';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

interface FsdDriveAnalyticsPanelsProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

const driveLinkClassName = `${BUTTON_BASE} min-h-11 min-w-11 max-w-full whitespace-normal break-words text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)] md:min-h-0 md:min-w-0`;
const exportButtonClassName = 'min-h-11 min-w-11 md:min-h-9 md:min-w-0';

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

function InsightTable<T>({
  tableId,
  name = tableId,
  rows,
  columns,
  keyExtractor,
  enableValueFilters,
  empty,
}: {
  tableId: string;
  name?: string;
  rows: T[];
  columns: Column<T>[];
  keyExtractor: (row: T) => string | number;
  enableValueFilters?: boolean;
  empty: ReactNode;
}) {
  return rows.length > 0 ? (
    <DataTable
      tableId={tableId}
      name={name}
      columns={columns}
      data={rows}
      keyExtractor={keyExtractor}
      enableValueFilters={enableValueFilters}
      mobileColumns={columns.map((column) => column.key)}
      pagination
    />
  ) : empty;
}

function AttributionDistanceBucket({
  label,
  value,
  variant,
}: {
  label: string;
  value: number | null | undefined;
  variant: 'success' | 'info' | 'warning' | 'neutral';
}) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  return (
    <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
      <Badge variant={variant} size="sm">{label}</Badge>
      <Text as="div" size="lg" weight="semibold" className="mt-2 tabular-nums">
        {value == null ? t('fsd.notMeasured', 'Not measured') : formatDistance(value)}
      </Text>
    </div>
  );
}

function ComparisonPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const comparison = insights?.drive_analytics?.comparison;
  const metrics: StatMetric[] = [
    { metricId: 'distance', occurrenceId: 'period-fsd-distance', rawValue: insights?.totals.fsd_distance_m,
      label: t('fsd.comparison.distance', 'Reported FSD distance'),
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
      context: !isFiniteNumber(comparison?.fsd_distance_change_m)
        ? t('fsd.comparison.noDistanceBaseline', 'Periods lack comparable trusted coverage')
        : t('fsd.comparison.distanceDelta', '{{delta}} vs previous', {
          delta: `${comparison.fsd_distance_change_m >= 0 ? '+' : ''}${formatDistance(comparison.fsd_distance_change_m)}`,
        }) },
    { metricId: 'percent', occurrenceId: 'period-fsd-share', rawValue: insights?.totals.fsd_share_pct,
      label: t('fsd.comparison.share', 'Share of observed driving'),
      context: !isFiniteNumber(comparison?.fsd_share_change_pct_points)
        ? t('fsd.comparison.noShareBaseline', 'Share periods lack comparable trusted coverage')
        : t('fsd.comparison.shareDelta', '{{delta}} percentage points', {
          delta: `${comparison.fsd_share_change_pct_points >= 0 ? '+' : ''}${fmtNumber(comparison.fsd_share_change_pct_points)}`,
        }) },
    { metricId: 'distance', occurrenceId: 'previous-fsd-distance', rawValue: comparison?.previous_fsd_distance_m,
      label: t('fsd.comparison.previous', 'Previous FSD distance'),
      display: { formatter: raw => ({ value: formatDistance(raw), unit: '' }) },
      context: comparison ? `${comparison.previous_period.start_date} - ${comparison.previous_period.end_date} · ${comparison.previous_period.timezone}`
        : t('fsd.comparison.notLoaded', 'Previous period not loaded') },
  ];

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="fsd-period-comparison">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <GitCompareArrows className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
        {t('fsd.comparison.title', 'Change from the previous period')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {t(
          'fsd.comparison.subtitle',
          'The immediately preceding window uses the same duration and timezone.',
        )}
      </Text>
      <FsdSectionBody state={state} className="min-h-28">
        <NestedDrivingBrief variant="embedded" metrics={metrics}
          title={t('fsd.brief.periodQuantities', 'Current and previous period quantities')}
          description={t('fsd.comparison.subtitle', 'The immediately preceding window uses the same duration and timezone.')}
          loading={state.isLoading} unavailable={state.error != null || insights == null}
          period={{ kind: 'unknown', label: insights ? `${insights.period.start_at} – ${insights.period.end_at} · ${insights.period.timezone}` : t('fsd.notMeasured', 'Not measured'),
            reason: t('fsd.comparison.subtitle', 'The immediately preceding window uses the same duration and timezone.') }} />
      </FsdSectionBody>
    </GlassPanel>
  );
}

function AttributionPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const { formatDateTime } = useDateFormat();
  const analytics = insights?.drive_analytics;
  const breakdown = analytics?.attribution;
  const resetEvents = analytics?.reset_events ?? [];
  const resetPage = useClientPagination(resetEvents);
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
    {
      key: 'unknown',
      label: t('fsd.attribution.unknown', 'Drive distance unknown'),
      value: breakdown?.unknown_drive_distance_m,
      variant: 'neutral' as const,
    },
  ];

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="fsd-attribution">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Scale className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
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
            <AttributionDistanceBucket
              key={bucket.key}
              label={bucket.label}
              value={bucket.value}
              variant={bucket.variant}
            />
          ))}
        </div>

        <div className="mt-5">
          <Text as="h3" size="sm" weight="semibold" className="mb-2 flex items-center gap-2">
            <AlertTriangle className={`h-4 w-4 ${neonColorMap.amber.text}`} aria-hidden="true" />
            {t('fsd.resets.title', 'Counter-reset timeline')}
          </Text>
          {resetEvents.length > 0 ? (
            <>
            <ol className="space-y-2">
              {resetPage.slice.map((event) => (
                <li
                  key={`${event.field}-${event.at}`}
                  className={`flex flex-wrap items-center gap-2 rounded-lg border ${neonColorMap.amber.border} ${neonColorMap.amber.bg} p-3 ${typography.size.sm}`}
                >
                  <Text as="span" weight="medium">{formatDateTime(event.at)}</Text>
                  <Badge variant="warning" size="sm">{event.field}</Badge>
                  {event.firmware_version ? (
                    <Badge variant="neutral" size="sm">{event.firmware_version}</Badge>
                  ) : null}
                  <Text as="span" color="muted">
                    {t('fsd.resets.changed', 'Counter moved from {{previous}} to {{current}}.', {
                      previous: formatDistance(event.previous_value_m),
                      current: formatDistance(event.current_value_m),
                    })}
                  </Text>
                  {event.affected_drive_ids.map((driveID) => (
                    <Link key={driveID} to={`/drives/${driveID}`} className={driveLinkClassName}>
                      #{driveID}
                    </Link>
                  ))}
                </li>
              ))}
            </ol>
            <Pagination
              page={resetPage.page}
              pageSize={resetPage.pageSize}
              total={resetPage.total}
              onPageChange={resetPage.onPageChange}
              onPageSizeChange={resetPage.onPageSizeChange}
              pageSizeOptions={resetPage.pageSizeOptions}
            />
            </>
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

const CONTRIBUTING_DRIVE_EXPORT_COLUMNS = [
  { key: 'drive_id', header: 'drive_id' },
  { key: 'started_at', header: 'started_at' },
  { key: 'ended_at', header: 'ended_at' },
  { key: 'start_place', header: 'start_place' },
  { key: 'end_place', header: 'end_place' },
  { key: 'distance_m', header: 'distance_m' },
  { key: 'energy_used_wh', header: 'energy_used_wh' },
  { key: 'fsd_distance_m', header: 'fsd_distance_m' },
  { key: 'fsd_share_pct', header: 'fsd_share_pct' },
  { key: 'confidence', header: 'confidence' },
  { key: 'reset_affected', header: 'reset_affected' },
  { key: 'firmware_version', header: 'firmware_version' },
] as const;

export function contributingDriveExportRows(drives: readonly DriveFsdInsight[]) {
  return drives
    .filter((drive) => drive.fsd_distance_m != null && drive.fsd_distance_m > 0)
    .map((drive) => ({
      drive_id: drive.drive_id,
      started_at: drive.started_at,
      ended_at: drive.ended_at,
      start_place: drive.start_place,
      end_place: drive.end_place,
      distance_m: drive.distance_m,
      energy_used_wh: drive.energy_used_wh,
      fsd_distance_m: drive.fsd_distance_m,
      fsd_share_pct: drive.fsd_share_pct,
      confidence: drive.confidence,
      reset_affected: drive.reset_affected,
      firmware_version: drive.firmware_version,
    }));
}

function ContributingDrivesPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const { formatDateTime } = useDateFormat();
  const rows = useMemo(
    () => (insights?.drive_analytics?.contributing_drives ?? [])
      .filter((drive) => drive.fsd_distance_m != null && drive.fsd_distance_m > 0),
    [insights],
  );
  const exportRows = useMemo(() => contributingDriveExportRows(rows), [rows]);
  const exportDisabled = exportRows.length === 0;
  const exportCsv = () => {
    downloadRowsAsCSV(
      defaultExportFilename('fsd-contributing-drives'),
      exportRows,
      [...CONTRIBUTING_DRIVE_EXPORT_COLUMNS],
    );
  };
  const exportJson = () => {
    downloadJSON(defaultExportFilename('fsd-contributing-drives'), {
      unit: 'meter',
      note: 'Distances are SI meters. Null means not measured.',
      drives: exportRows,
    });
  };
  const columns = useMemo<Column<DriveFsdInsight>[]>(() => [
    {
      key: 'started_at',
      filterValue: (row) => row.started_at ?? null,
      filterValueLabel: (_, row) => formatDateTime(row.started_at),
      header: t('fsd.drives.date', 'Drive'),
      render: (row) => (
        <div>
          <Link to={`/drives/${row.drive_id}`} className={`${driveLinkClassName} justify-start text-start`}>
            {formatDateTime(row.started_at)}
          </Link>
          <Text as="div" size="xs" color="muted" className="whitespace-normal break-words">
            {t('fsd.analytics.routePlaces', '{{start}} to {{end}}', {
              start: row.start_place ?? t('fsd.drives.unknownStart', 'Unknown start'),
              end: row.end_place ?? t('fsd.drives.unknownEnd', 'Unknown end'),
            })}
          </Text>
        </div>
      ),
    },
    {
      key: 'fsd_distance_m',
      align: 'right',
      filterValue: (row) => row.fsd_distance_m ?? null,
      filterValueLabel: (_, row) => `${row.confidence === 'high' ? '' : '~'}${formatDistance(row.fsd_distance_m)}`,
      header: t('fsd.drives.distance', 'Reported FSD'),
      render: (row) => (
        <span className="tabular-nums">
          {row.confidence === 'high' ? '' : '~'}
          {formatDistance(row.fsd_distance_m)}
        </span>
      ),
    },
    {
      key: 'fsd_share_pct',
      align: 'right',
      filterValue: (row) => row.fsd_share_pct ?? null,
      filterValueLabel: (_, row) => !isFiniteNumber(row.fsd_share_pct) ? '-' : t('fsd.analytics.share', '{{approximate}}{{value}}%', { approximate: row.confidence === 'high' ? '' : '~', value: fmtNumber(row.fsd_share_pct) }),
      header: t('fsd.drives.share', 'Drive share'),
      render: (row) => !isFiniteNumber(row.fsd_share_pct)
        ? '-'
        : t('fsd.analytics.share', '{{approximate}}{{value}}%', { approximate: row.confidence === 'high' ? '' : '~', value: fmtNumber(row.fsd_share_pct) }),
    },
    {
      key: 'confidence',
      header: t('fsd.drives.confidence', 'Confidence'),
      render: (row) => <ConfidenceBadge value={row.confidence} />,
    },
    {
      key: 'firmware_version',
      filterValue: (row) => row.firmware_version ?? null,
      header: t('fsd.drives.firmware', 'Firmware'),
      render: (row) => row.firmware_version ?? '-',
    },
    {
      key: 'drive_id',
      header: '',
      render: (row) => (
        <Link to={`/drives/${row.drive_id}`} className={driveLinkClassName} aria-label={t('fsd.drives.open', 'Open drive {{id}}', { id: row.drive_id })}>
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      ),
    },
  ], [formatDistance, formatDateTime, t, fmtNumber]);

  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5" data-testid="fsd-contributing-drives">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <ListChecks className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
        {t('fsd.drives.title', 'Contributing drives')}
      </PanelTitle>
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <Text as="p" variant="caption" className="min-w-0 md:flex-1">
          {t(
            'fsd.drives.subtitle',
            'Completed drives fully inside this period with positive reported supervised-driving distance.',
          )}
        </Text>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className={exportButtonClassName}
            wrapLabel
            variant="outline"
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
            disabled={exportDisabled}
            onClick={exportCsv}
          >
            {t('fsd.drives.exportCsv', 'CSV')}
          </Button>
          <Button
            type="button"
            size="sm"
            className={exportButtonClassName}
            wrapLabel
            variant="outline"
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
            disabled={exportDisabled}
            onClick={exportJson}
          >
            {t('fsd.drives.exportJson', 'JSON')}
          </Button>
        </div>
      </div>
      <FsdSectionBody state={state} className="min-h-52">
        <InsightTable
          tableId="fsd-contributing-drives"
          enableValueFilters
          name="FsdContributingDrives"
          columns={columns}
          rows={rows}
          keyExtractor={(row) => row.drive_id}
          empty={
            <EmptyState /* no-action: this fills automatically when the selected period contains attributable FSD distance */
              icon={<Route className="h-8 w-8" aria-hidden="true" />}
              message={t('fsd.drives.empty', 'No drive has positive attributable FSD distance in this period.')}
            />
          }
        />
      </FsdSectionBody>
    </GlassPanel>
  );
}

function GroupTable({
  title,
  tableId,
  rows,
}: {
  title: string;
  tableId: string;
  rows: GroupedFsdInsight[];
}) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const columns = useMemo<Column<GroupedFsdInsight>[]>(() => [
    {
      key: 'label',
      header: t('fsd.groups.group', 'Group'),
      render: (row) => row.label,
    },
    {
      key: 'drive_count',
      align: 'right',
      header: t('fsd.groups.drives', 'Drives'),
      render: (row) => <span className="tabular-nums">{isFiniteNumber(row.drive_count) ? fmtInt(row.drive_count) : t('fsd.notMeasured', 'Not measured')}</span>,
    },
    {
      key: 'fsd_distance_m',
      header: t('fsd.groups.distance', 'FSD distance'),
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">{formatDistance(row.fsd_distance_m)}</span>
      ),
    },
    {
      key: 'fsd_share_pct',
      header: t('fsd.groups.share', 'Share'),
      align: 'right',
      render: (row) => (
        <span className="tabular-nums">
          {!isFiniteNumber(row.fsd_share_pct) ? '-' : t('fsd.analytics.share', '{{approximate}}{{value}}%', { approximate: '', value: fmtNumber(row.fsd_share_pct) })}
        </span>
      ),
    },
  ], [formatDistance, t, fmtNumber, fmtInt]);

  return (
    <div className="min-w-0">
      <Text as="h3" size="sm" weight="semibold" className="mb-2">{title}</Text>
      <InsightTable
        tableId={tableId}
        columns={columns}
        rows={rows}
        keyExtractor={(row) => row.key}
        empty={
          <Text as="p" variant="caption">
            {t('fsd.groups.empty', 'Not enough high-confidence drives for this comparison.')}
          </Text>
        }
      />
    </div>
  );
}

function ComparisonGroupsPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { t } = useTranslation();
  const analytics = insights?.drive_analytics;
  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5" data-testid="fsd-comparison-groups">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Clock3 className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
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
            tableId="fsd-groups-routes"
            rows={analytics?.repeated_routes ?? []}
          />
          <GroupTable
            title={t('fsd.groups.time', 'Time of day')}
            tableId="fsd-groups-time"
            rows={analytics?.time_of_day ?? []}
          />
          <GroupTable
            title={t('fsd.groups.firmware', 'Firmware version')}
            tableId="fsd-groups-firmware"
            rows={analytics?.firmware ?? []}
          />
        </div>
      </FsdSectionBody>
    </GlassPanel>
  );
}

function FirmwareSpotlightPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const spotlight = insights?.drive_analytics?.firmware_spotlight;
  const rows = spotlight?.routes ?? [];
  const columns = useMemo<Column<FsdFirmwareRouteSpotlight>[]>(() => [
    {
      key: 'route_label',
      header: t('fsd.firmwareSpotlight.route', 'Route'),
      render: (row) => row.route_label,
    },
    {
      key: 'before_fsd_share_pct',
      header: t('fsd.firmwareSpotlight.before', 'Before'),
      render: (row) => t('fsd.analytics.sharePopulation', '{{share}} · {{drives}}', {
        share: isFiniteNumber(row.before_fsd_share_pct)
          ? t('fsd.analytics.share', '{{approximate}}{{value}}%', { approximate: '', value: fmtNumber(row.before_fsd_share_pct) })
          : t('fsd.notMeasured', 'Not measured'),
        drives: isFiniteNumber(row.before_drive_count) ? fmtInt(row.before_drive_count) : t('fsd.notMeasured', 'Not measured'),
      }),
    },
    {
      key: 'after_fsd_share_pct',
      header: t('fsd.firmwareSpotlight.after', 'After'),
      render: (row) => t('fsd.analytics.sharePopulation', '{{share}} · {{drives}}', {
        share: isFiniteNumber(row.after_fsd_share_pct)
          ? t('fsd.analytics.share', '{{approximate}}{{value}}%', { approximate: '', value: fmtNumber(row.after_fsd_share_pct) })
          : t('fsd.notMeasured', 'Not measured'),
        drives: isFiniteNumber(row.after_drive_count) ? fmtInt(row.after_drive_count) : t('fsd.notMeasured', 'Not measured'),
      }),
    },
    {
      key: 'share_change_pct_points',
      header: t('fsd.firmwareSpotlight.change', 'Share change'),
      render: (row) => !isFiniteNumber(row.share_change_pct_points)
        ? '-'
        : t('fsd.analytics.shareChangePoints', '{{delta}} pts', {
          delta: `${row.share_change_pct_points >= 0 ? '+' : ''}${fmtNumber(row.share_change_pct_points)}`,
        }),
    },
  ], [t, fmtNumber, fmtInt]);

  const hasFirmwarePair = Boolean(spotlight?.from_version && spotlight?.to_version);

  return (
    <GlassPanel id="fsd-firmware-spotlight" className="min-w-0 p-4 sm:p-5" data-testid="fsd-firmware-spotlight">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Cpu className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
        {t('fsd.firmwareSpotlight.title', 'Firmware spotlight')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {hasFirmwarePair
          ? t(
              'fsd.firmwareSpotlight.subtitle',
              'Same-route FSD share on high-confidence drives, {{from}} vs {{to}}. Correlation, not proof that the update caused the change.',
              { from: spotlight?.from_version, to: spotlight?.to_version },
            )
          : t(
              'fsd.firmwareSpotlight.subtitleEmpty',
              'Same-route FSD share before and after a firmware update, using high-confidence drives only.',
            )}
      </Text>
      <FsdSectionBody state={state} className="min-h-40">
        <InsightTable
          tableId="fsd-firmware-spotlight"
          name="FsdFirmwareSpotlight"
          columns={columns}
          rows={rows}
          keyExtractor={(row) => row.route_key}
          empty={
            <EmptyState /* no-action: informational empty — no CTA */
              icon={<Cpu className="h-8 w-8" aria-hidden="true" />}
              message={hasFirmwarePair
                ? t(
                    'fsd.firmwareSpotlight.emptyRoutes',
                    'Firmware moved from {{from}} to {{to}}, but no repeated high-confidence route was observed on both versions.',
                    { from: spotlight?.from_version, to: spotlight?.to_version },
                  )
                : t(
                    'fsd.firmwareSpotlight.empty',
                    'Need high-confidence drives on two firmware versions to compare the same routes.',
                  )}
            />
          }
        />
      </FsdSectionBody>
    </GlassPanel>
  );
}

function EfficiencyPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const rows = insights?.drive_analytics?.route_efficiency ?? [];
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const columns = useMemo<Column<FsdRouteEfficiencyComparison>[]>(() => {
    const formatEfficiency = (value: number | null | undefined) =>
      value != null && Number.isFinite(value)
        ? t('fsd.analytics.efficiencyValue', '{{value}} {{unit}}', {
          value: fmtNumber(convertEfficiencyFromSI(value, unitPrefs.distance), unitPrefs.precision, unitPrefs.locale),
          unit: efficiencyUnit,
        })
        : t('fsd.notMeasured', 'Not measured');
    return [
      {
        key: 'route_label',
        header: t('fsd.efficiency.route', 'Route'),
        render: (row) => row.route_label,
      },
      {
        key: 'fsd_heavy_drive_count',
        header: t('fsd.efficiency.heavy', 'FSD-heavy'),
        render: (row) => t('fsd.analytics.efficiencyPopulation', '{{drives}} / {{efficiency}}', {
          drives: isFiniteNumber(row.fsd_heavy_drive_count) ? fmtInt(row.fsd_heavy_drive_count, unitPrefs.locale) : t('fsd.notMeasured', 'Not measured'),
          efficiency: formatEfficiency(row.fsd_heavy_efficiency_wh_per_km),
        }),
      },
      {
        key: 'low_fsd_drive_count',
        header: t('fsd.efficiency.low', 'Low-FSD'),
        render: (row) => t('fsd.analytics.efficiencyPopulation', '{{drives}} / {{efficiency}}', {
          drives: isFiniteNumber(row.low_fsd_drive_count) ? fmtInt(row.low_fsd_drive_count, unitPrefs.locale) : t('fsd.notMeasured', 'Not measured'),
          efficiency: formatEfficiency(row.low_fsd_efficiency_wh_per_km),
        }),
      },
      {
        key: 'difference_pct',
        header: t('fsd.efficiency.difference', 'Difference'),
        render: (row) => row.difference_pct != null && Number.isFinite(row.difference_pct)
          ? t('fsd.analytics.share', '{{approximate}}{{value}}%', {
            approximate: row.difference_pct >= 0 ? '+' : '',
            value: fmtNumber(row.difference_pct, unitPrefs.precision, unitPrefs.locale),
          })
          : t('fsd.notMeasured', 'Not measured'),
      },
    ];
  }, [unitPrefs, efficiencyUnit, t, fmtNumber, fmtInt]);

  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5" data-testid="fsd-route-efficiency">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <MapPinned className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
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
        <InsightTable
          tableId="fsd-route-efficiency"
          name="FsdRouteEfficiency"
          columns={columns}
          rows={rows}
          keyExtractor={(row) => row.route_key}
          empty={
            <EmptyState /* no-action: this comparison appears automatically after enough matching high-confidence drives accumulate */
              icon={<MapPinned className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'fsd.efficiency.empty',
                'No repeated route has at least two FSD-heavy and two low-FSD high-confidence drives.',
              )}
            />
          }
        />
      </FsdSectionBody>
    </GlassPanel>
  );
}

function CommuteIdentityPanel({ insights, state }: FsdDriveAnalyticsPanelsProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const rows = insights?.drive_analytics?.commute_identities ?? [];
  const columns: Column<FsdCommuteIdentity>[] = useMemo(() => [
    {
      key: 'route_label',
      header: t('fsd.commute.route', 'Commute'),
      render: (row) => (
        <div>
          <div>{row.route_label}</div>
          <Text as="p" variant="caption">{row.window_label}</Text>
        </div>
      ),
    },
    {
      key: 'this_month',
      header: t('fsd.commute.thisMonth', 'This month'),
      render: (row) => !isFiniteNumber(row.this_month.fsd_share_pct)
        ? t('fsd.commute.unknown', 'Unknown')
        : t('fsd.analytics.share', '{{approximate}}{{value}}%', { approximate: '', value: fmtNumber(row.this_month.fsd_share_pct) }),
    },
    {
      key: 'last_month',
      header: t('fsd.commute.lastMonth', 'Last month'),
      render: (row) => !isFiniteNumber(row.last_month.fsd_share_pct)
        ? t('fsd.commute.unknown', 'Unknown')
        : t('fsd.analytics.share', '{{approximate}}{{value}}%', { approximate: '', value: fmtNumber(row.last_month.fsd_share_pct) }),
    },
    {
      key: 'share_change_pct_points',
      header: t('fsd.commute.change', 'Change'),
      render: (row) => !isFiniteNumber(row.share_change_pct_points)
        ? '—'
        : t('fsd.analytics.shareChangePoint', '{{delta}} pt', {
          delta: `${row.share_change_pct_points >= 0 ? '+' : ''}${fmtNumber(row.share_change_pct_points)}`,
        }),
    },
    {
      key: 'unknown_days',
      header: t('fsd.commute.unknownDays', 'Unknown days'),
      render: (row) => isFiniteNumber(row.this_month.unknown_days) ? fmtInt(row.this_month.unknown_days) : t('fsd.commute.unknown', 'Unknown'),
    },
  ], [t, fmtNumber, fmtInt]);

  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5" data-testid="fsd-commute-identity">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <Route className={`h-4 w-4 ${typography.color.muted}`} aria-hidden="true" />
        {t('fsd.commute.title', 'Commute supervised identity')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {rows[0]?.honesty
          ?? t(
            'fsd.commute.honesty',
            'Same route and time-of-day window. Month-over-month supervised share is a trip-meter correlation, not proof FSD improved.',
          )}
      </Text>
      <FsdSectionBody state={state} className="min-h-40">
        <InsightTable
          tableId="fsd-commute-identity"
          name="FsdCommuteIdentity"
          columns={columns}
          rows={rows}
          keyExtractor={(row) => `${row.route_key}|${row.window_key}`}
          empty={
            <EmptyState /* no-action: informational empty — no CTA */
              icon={<Route className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'fsd.commute.empty',
                'No repeated commute window has enough high-confidence drives this month.',
              )}
            />
          }
        />
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
      <FsdCommuteExperimentPanel {...props} />
      <FirmwareSpotlightPanel {...props} />
      <CommuteIdentityPanel {...props} />
      <EfficiencyPanel {...props} />
    </>
  );
}
