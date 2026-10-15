import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { fmtInt as libFmtInt } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import { addCivilDays } from '@/lib/dateRange';
import { typography } from '@/lib/tokens';
import { Icons } from '@/lib/icons';

import { PageLayout } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  Input,
  Select,
  Checkbox,
  RadioCard,
  DataTable,
  useSortToggle,
  PanelTitle,
  Label,
  Text,
  HelperText,
  type Column,
} from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { SystemSummaryBrief } from '../components/operationalbrief-all/SystemSummaryBrief';
import {
  Skeleton,
  EmptyState,
  QueryError,
  AlertBanner,
  JobProgressDrawer,
  RequiresAuth,
  StaleRefreshWarning,
} from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useToast } from '@/components/feedback/Toast';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { request } from '@/api/client';
import {
  useCreateAccountExport,
  useExportColumns,
  exportDownloadUrl,
  type CreateExportPayload,
} from '@/api/hooks/useExports';
import { ScheduledExportsPanel } from './ScheduledExportsPanel';
import type { Vehicle } from '@/api/types';
import type { DataState } from '@/api/dataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ExportType = 'drives' | 'charging' | 'trips' | 'analytics' | 'full_backup' | 'maintenance' | 'energy';
type ExportFormat = 'csv' | 'json';
type ExportStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'expired';

interface ExportJobSummary {
  id: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportStatus;
  vehicle_id?: number;
  record_count?: number;
  file_size?: number;
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
  error_message?: string;
  download_url?: string;
}

interface ExportSubmitPayload {
  type: CreateExportPayload['type'];
  format: ExportFormat;
  vehicle_id?: number;
  start?: string;
  end?: string;
  /** Caller-supplied column allowlist. Omitted when the user kept the
   *  default selection (every column) so the backend preserves
   *  byte-for-byte legacy behaviour. */
  columns?: string[];
}

interface DataOverview {
  drives: number;
  charging_sessions: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EXPORT_TYPES: {
  value: ExportType;
  labelKey: string;
  label: string;
  icon: typeof Icons.vehicle;
  descKey: string;
  desc: string;
}[] = [
  { value: 'drives', labelKey: 'dataExport.types.drives', label: 'Drives', icon: Icons.vehicle, descKey: 'dataExport.types.drivesDesc', desc: 'Export drive sessions, routes, and efficiency data' },
  { value: 'charging', labelKey: 'dataExport.types.charging', label: 'Charging', icon: Icons.charging, descKey: 'dataExport.types.chargingDesc', desc: 'Export charging sessions and energy data' },
  { value: 'trips', labelKey: 'dataExport.types.trips', label: 'Trips', icon: Icons.trip, descKey: 'dataExport.types.tripsDesc', desc: 'Export trip summaries with SI aggregate columns' },
  { value: 'analytics', labelKey: 'dataExport.types.analytics', label: 'Analytics', icon: Icons.analytics, descKey: 'dataExport.types.analyticsDesc', desc: 'Export analytics and aggregated statistics' },
  { value: 'full_backup', labelKey: 'dataExport.types.fullBackup', label: 'Full backup', icon: Icons.database, descKey: 'dataExport.types.fullBackupDesc', desc: 'Complete database backup of all vehicle data' },
  { value: 'maintenance', labelKey: 'dataExport.types.maintenance', label: 'Maintenance', icon: Icons.maintenance, descKey: 'dataExport.types.maintenanceDesc', desc: 'Export maintenance and service records' },
  { value: 'energy', labelKey: 'dataExport.types.energy', label: 'Energy', icon: Icons.battery, descKey: 'dataExport.types.energyDesc', desc: 'Export energy consumption and efficiency data' },
];

const EXPORT_FORMATS: { value: ExportFormat; labelKey: string; label: string; icon: typeof Icons.fileSpreadsheet; descKey: string; desc: string }[] = [
  { value: 'csv', labelKey: 'dataExport.formats.csv', label: 'CSV', icon: Icons.fileSpreadsheet, descKey: 'dataExport.formats.csvDesc', desc: 'Comma-separated values, compatible with Excel and Google Sheets' },
  { value: 'json', labelKey: 'dataExport.formats.json', label: 'JSON', icon: Icons.fileJson, descKey: 'dataExport.formats.jsonDesc', desc: 'Structured JSON format for programmatic access' },
];

const EXPORT_JOB_TYPES: Record<ExportType, CreateExportPayload['type'] | null> = {
  drives: 'drives',
  charging: 'charging',
  trips: 'trips',
  analytics: 'analytics',
  full_backup: 'backup',
  maintenance: null,
  energy: null,
};

const DATE_PRESETS: { labelKey: string; label: string; days: number }[] = [
  { labelKey: 'dataExport.presets.last7', label: 'Last 7 days', days: 7 },
  { labelKey: 'dataExport.presets.last30', label: 'Last 30 days', days: 30 },
  { labelKey: 'dataExport.presets.last90', label: 'Last 90 days', days: 90 },
  { labelKey: 'dataExport.presets.lastYear', label: 'Last year', days: 365 },
  { labelKey: 'dataExport.presets.allTime', label: 'All time', days: 0 },
];

const STATUS_CONFIG: Record<ExportStatus, {
  icon: typeof Icons.clock;
  badgeVariant: 'neutral' | 'info' | 'success' | 'danger' | 'warning';
  labelKey: string;
  label: string;
  spinning?: boolean;
}> = {
  queued: { icon: Icons.clock, badgeVariant: 'neutral', labelKey: 'dataExport.status.queued', label: 'Queued' },
  processing: { icon: Icons.loading, badgeVariant: 'info', labelKey: 'dataExport.status.processing', label: 'Processing', spinning: true },
  ready: { icon: Icons.successFilled, badgeVariant: 'success', labelKey: 'dataExport.status.ready', label: 'Ready' },
  failed: { icon: Icons.error, badgeVariant: 'danger', labelKey: 'dataExport.status.failed', label: 'Failed' },
  expired: { icon: Icons.alertCircle, badgeVariant: 'warning', labelKey: 'dataExport.status.expired', label: 'Expired' },
};

/** Shape of a single {@link STATUS_CONFIG} entry — used so `StatusBadge` can
 *  do a defensive, runtime-honest lookup. The backend `status` field is typed
 *  `ExportStatus` at compile time, but a newer server could emit a value the
 *  SPA union doesn't know yet (e.g. `cancelled`); indexing the record with
 *  that string returns `undefined`, and reading `.icon` off it would crash the
 *  whole history table. */
type StatusConfigEntry = (typeof STATUS_CONFIG)[ExportStatus];

const TYPE_BADGE_VARIANT: Record<ExportType, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  drives: 'info',
  charging: 'success',
  trips: 'info',
  analytics: 'neutral',
  full_backup: 'warning',
  maintenance: 'danger',
  energy: 'success',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function daysAgo(days: number): string {
  return addCivilDays(new Date().toISOString().split('T')[0], -days);
}

function validExportDates(start: string, end: string): boolean {
  // Both queued endpoints parse date-only UTC midnights and include the end
  // instant itself, not the remainder of that day.
  const valid = (date: string) => !date || (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  );
  return valid(start) && valid(end) && (!start || !end || start <= end);
}

function fmtInt(n: number | undefined): string {
  if (n == null) return '—';
  return libFmtInt(n);
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ExportTypeSelector({
  selected,
  onChange,
}: {
  selected: ExportType;
  onChange: (v: ExportType) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t('dataExport.wizard.step1', 'STEP 1 — select data type')}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
    >
      {EXPORT_TYPES.map((et) => {
        const Icon = et.icon;
        return (
          <RadioCard
            key={et.value}
            name="export-type"
            value={et.value}
            checked={selected === et.value}
            accent="neutral"
            aria-label={t(et.labelKey, et.label)}
            onChange={() => onChange(et.value)}
            label={t(et.labelKey, et.label)}
            description={t(et.descKey, et.desc)}
            icon={<Icon className="h-4 w-4" aria-hidden="true" />}
          />
        );
      })}
    </div>
  );
}

function FormatSelector({
  selected,
  onChange,
}: {
  selected: ExportFormat;
  onChange: (f: ExportFormat) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('dataExport.wizard.step2', 'STEP 2 — choose format')}>
      {EXPORT_FORMATS.map((f) => {
        const Icon = f.icon;
        return (
          <RadioCard
            key={f.value}
            name="export-format"
            value={f.value}
            checked={selected === f.value}
            accent="neutral"
            aria-label={t(f.labelKey, f.label)}
            icon={<Icon className="h-4 w-4" aria-hidden="true" />}
            onChange={() => onChange(f.value)}
            label={t(f.labelKey, f.label)}
            description={t(f.descKey, f.desc)}
          />
        );
      })}
    </div>
  );
}

function DatePresetSelector({
  selected,
  onChange,
}: {
  selected: number;
  onChange: (days: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('dataExport.presets.aria', 'Date range presets')}>
      {DATE_PRESETS.map((p) => {
        const active = selected === p.days;
        return (
          <Button
            key={p.days}
            size="sm"
            wrapLabel
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
            variant={active ? 'primary' : 'ghost'}
            aria-pressed={active}
            onClick={() => onChange(p.days)}
          >
            {t(p.labelKey, p.label)}
          </Button>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: ExportStatus }) {
  const { t } = useTranslation();
  // Defensive lookup: an unrecognized status (server ahead of the SPA union)
  // must degrade to a neutral chip rather than throw on `undefined.icon` and
  // take the entire export-history table down with it.
  const cfg: StatusConfigEntry | undefined =
    (STATUS_CONFIG as Record<string, StatusConfigEntry>)[status];
  if (!cfg) {
    return (
      <Badge variant="neutral" size="sm">
        <Icons.alertCircle className="h-3 w-3" aria-hidden="true" />
        {status ? String(status) : '—'}
      </Badge>
    );
  }
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.badgeVariant} size="sm">
      <Icon className={cn('h-3 w-3', cfg.spinning && 'animate-spin')} aria-hidden="true" />
      {t(cfg.labelKey, cfg.label)}
    </Badge>
  );
}

function TypeBadge({ type }: { type: ExportType }) {
  const { t } = useTranslation();
  const variant = TYPE_BADGE_VARIANT[type] ?? 'neutral';
  const cfg = EXPORT_TYPES.find((et) => et.value === type);
  return (
    <Badge variant={variant} size="sm">
      {cfg ? t(cfg.labelKey, cfg.label) : type}
    </Badge>
  );
}

function FormatBadge({ format }: { format: ExportFormat }) {
  // `format` is `ExportFormat` at compile time but arrives from the API, so a
  // missing/unknown value must not blow up on `.toUpperCase()`.
  const label = typeof format === 'string' && format.length > 0 ? format.toUpperCase() : '—';
  const variant = format === 'csv' ? 'info' : format === 'json' ? 'warning' : 'neutral';
  return (
    <Badge variant={variant} size="sm">
      {format === 'csv' && <Icons.fileSpreadsheet className="h-3 w-3" aria-hidden="true" />}
      {format === 'json' && <Icons.fileJson className="h-3 w-3" aria-hidden="true" />}
      {label}
    </Badge>
  );
}

function FormatInfoCards() {
  const { t } = useTranslation();
  const previewClass = cn(
    'rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3',
    typography.family.mono,
    typography.size['2xs'],
    typography.color.primary,
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icons.fileSpreadsheet className={cn('h-5 w-5', typography.color.secondary)} aria-hidden="true" />
          <PanelTitle>{t('dataExport.csvPreview', 'CSV preview')}</PanelTitle>
        </div>
        <Text as="p" variant="caption" className="mb-3">
          {t('dataExport.csvDesc', 'Comma-separated values, compatible with Excel and Google Sheets')}
        </Text>
        <div className={previewClass}>
          <p>date,distance_m,efficiency_wh_per_m</p>
          <p>2025-01-15,45200,0.152</p>
          <p>2025-01-16,32800,0.148</p>
        </div>
      </GlassPanel>

      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icons.fileJson className={cn('h-5 w-5', typography.color.secondary)} aria-hidden="true" />
          <PanelTitle>{t('dataExport.jsonPreview', 'JSON preview')}</PanelTitle>
        </div>
        <Text as="p" variant="caption" className="mb-3">
          {t('dataExport.jsonDesc', 'Structured JSON format for programmatic access')}
        </Text>
        <div className={previewClass}>
          <p>{`[{ "date": "2025-01-15",`}</p>
          <p>{`   "distance_m": 45200,`}</p>
          <p>{`   "efficiency": 152 }]`}</p>
        </div>
      </GlassPanel>
    </div>
  );
}

function DataOverviewCard({
  overview,
  isLoading,
  retained = false,
}: {
  overview: DataOverview | undefined;
  isLoading: boolean;
  retained?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <SystemSummaryBrief
      title={t('dataExport.dataOverview', 'Data overview')}
      description={t('dataExport.brief.recordsDescription', 'Record counts reported by drive and charging export jobs in the loaded history.')}
      scope={t('dataExport.brief.recordsScope', 'Exported records may overlap between jobs; these are not unique database session totals.')}
      available={overview != null} loading={isLoading} retained={retained}
      metrics={[
        { metricId: 'count', occurrenceId: 'exported-drives', rawValue: overview?.drives, label: t('dataExport.drives', 'Drives') },
        { metricId: 'count', occurrenceId: 'exported-charging', rawValue: overview?.charging_sessions, label: t('dataExport.chargingSessions', 'Charging sessions') },
      ]}
    />
  );
}

function CustomDateRange({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}: {
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <Input
        type="date"
        className="min-h-11 md:min-h-10"
        label={t('dataExport.startDate', 'Start')}
        value={startDate}
        onChange={(e) => onStartChange(e.target.value)}
      />
      <Input
        type="date"
        className="min-h-11 md:min-h-10"
        label={t('dataExport.endDate', 'End')}
        value={endDate}
        onChange={(e) => onEndChange(e.target.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats row                                                          */
/* ------------------------------------------------------------------ */

function StatsRow({
  jobs,
  isLoading,
  retained = false,
}: {
  jobs: ExportJobSummary[] | undefined;
  isLoading: boolean;
  retained?: boolean;
}) {
  const { formatBytes } = useNumberFormatting();
  const { t } = useTranslation();
  const totalExports = jobs?.length ?? null;

  const totalSize = useMemo(
    () => (jobs ?? []).reduce((sum, j) => sum + (j.file_size ?? 0), 0),
    [jobs],
  );

  const mostExportedType = useMemo(() => {
    if (!jobs || jobs.length === 0) return '—';
    const counts: Record<string, number> = {};
    for (const j of jobs) {
      counts[j.type] = (counts[j.type] ?? 0) + 1;
    }
    const max = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return max ? max[0].replace(/_/g, ' ') : '—';
  }, [jobs]);

  const lastExport = useMemo(() => {
    if (!jobs || jobs.length === 0) return '—';
    const sorted = [...jobs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return formatRelative(sorted[0].created_at);
  }, [jobs]);

  return (
    <SystemSummaryBrief
      title={t('dataExport.stats.aria', 'Export summary metrics')}
      description={t('dataExport.brief.description', 'Export counts, recorded file bytes, most frequent export type, and latest creation time from the loaded job history.')}
      scope={t('dataExport.brief.scope', 'Loaded export jobs; no server-wide total or reporting window is supplied.')}
      available={jobs != null} loading={isLoading} retained={retained}
      metrics={[
        { metricId: 'count', occurrenceId: 'total-exports', rawValue: totalExports, label: t('dataExport.totalExports', 'Total exports') },
        { metricId: 'bytes', occurrenceId: 'total-size', rawValue: jobs == null ? null : totalSize,
          label: t('dataExport.totalSize', 'Total size'),
          context: t('dataExport.brief.bytesContext', 'Sum of recorded file sizes; jobs without a file size contribute no recorded bytes.'),
          display: { formatter: (raw) => ({ value: formatBytes(raw, { zeroAsEmpty: false }), unit: '' }) } },
      ]}
      textMetrics={[
        { key: 'most-exported', label: t('dataExport.mostExported', 'Most exported'), value: mostExportedType,
          valueState: mostExportedType === '—' ? 'missing' : 'value', detail: t('dataExport.byCount', 'By count') },
        { key: 'last-export', label: t('dataExport.lastExport', 'Last export'), value: lastExport,
          valueState: lastExport === '—' ? 'missing' : 'value',
          detail: t('dataExport.brief.lastContext', 'Latest job creation time, not completion or download time.') },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Export Wizard                                                       */
/* ------------------------------------------------------------------ */

interface VehicleTargetProps {
  vehiclesState: DataState<Vehicle[]>;
  onRetryVehicles: () => void;
}

function VehicleTargetFeedback({ vehiclesState, onRetryVehicles, unknownTarget }: VehicleTargetProps & { unknownTarget?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status">
      <StaleRefreshWarning state={vehiclesState} label={t('dataExport.vehicle', 'Vehicle')} />
      {vehiclesState.fatalError ? (
        <QueryError error={vehiclesState.fatalError} onRetry={onRetryVehicles} />
      ) : vehiclesState.data === undefined ? (
        <Text color="secondary">{vehiclesState.isRefreshBlocked
          ? t('dataSources.status.paused', 'Refresh paused')
          : t('statCard.loading', 'Loading')}</Text>
      ) : vehiclesState.data.length === 0 ? (
        <EmptyState message={t('palette.noVehicles', 'No vehicles available')}
          description={t('dataExport.noVehiclesHelp', 'Connect a Tesla account and sync a vehicle before exporting vehicle data.')}
          actionTo={{ label: t('common.noVehicleSelected.action', 'Set up TeslaSync'), to: '/onboarding' }} />
      ) : null}
      {unknownTarget && (
        <HelperText>{t('dataExport.vehicleUnavailable', 'Vehicle {{vehicleId}} is not available in the current fleet.', { vehicleId: unknownTarget })}</HelperText>
      )}
    </div>
  );
}

function ExportWizard({
  vehiclesState,
  onRetryVehicles,
  onSubmit,
  isPending,
}: {
  vehiclesState: DataState<Vehicle[]>;
  onRetryVehicles: () => void;
  onSubmit: (payload: ExportSubmitPayload) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const vehicles = vehiclesState.data;
  const [searchParams] = useSearchParams();
  const {
    vehicleId: globalVehicleId,
    setVehicleId: setGlobalVehicleId,
  } = useSelectedVehicle();
  const [exportType, setExportType] = useState<ExportType>('drives');
  const jobType = EXPORT_JOB_TYPES[exportType];
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [vehicleId, setVehicleId] = useState(
    searchParams.get('vehicle_id') || (globalVehicleId == null ? '' : String(globalVehicleId)),
  );
  const [presetDays, setPresetDays] = useState(30);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [useCustomRange, setUseCustomRange] = useState(false);
  // Column allowlist state. `null` means "user has not
  // touched the picker; submit without `columns` so backend preserves
  // legacy byte-for-byte behaviour". A non-null value is the explicit
  // ordered allowlist the backend should honour.
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(null);
  const unknownTarget = vehicleId !== '' && !vehicles?.some(v => String(v.id) === vehicleId);
  const targetReady = !!vehicles?.length && !vehiclesState.fatalError && !unknownTarget;
  const datesReady = !useCustomRange || (
    !!customStart && !!customEnd && validExportDates(customStart, customEnd)
  );

  useEffect(() => {
    // A fleet refresh must not turn a removed target into a different scope.
    setVehicleId(previous => previous && !vehicles?.some(v => String(v.id) === previous)
      ? previous : globalVehicleId == null ? previous : String(globalVehicleId));
  }, [globalVehicleId, vehicles]);

  const handleVehicleChange = useCallback(
    (value: string) => {
      setVehicleId(value);
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0 && parsed !== globalVehicleId) {
        setGlobalVehicleId(parsed);
      }
    },
    [globalVehicleId, setGlobalVehicleId],
  );

  // Reset the column selection whenever the export type changes — a
  // catalog from the previous type is meaningless against the new one.
  const handleExportTypeChange = useCallback((next: ExportType) => {
    setExportType(next);
    setSelectedColumns(null);
  }, []);

  const handlePresetChange = useCallback((days: number) => {
    setPresetDays(days);
    setUseCustomRange(false);
  }, []);

  const handleSubmit = useCallback(() => {
    if (!targetReady || !datesReady || jobType === null) return;
    const payload: ExportSubmitPayload = {
      type: jobType,
      format: exportFormat,
    };
    if (vehicleId) {
      payload.vehicle_id = Number(vehicleId);
    }
    if (useCustomRange) {
      payload.start = customStart;
      payload.end = customEnd;
    } else if (presetDays > 0) {
      payload.start = daysAgo(presetDays);
      payload.end = new Date().toISOString().split('T')[0];
    }
    if (selectedColumns !== null && selectedColumns.length > 0) {
      payload.columns = selectedColumns;
    }
    onSubmit(payload);
  }, [targetReady, datesReady, jobType, exportFormat, vehicleId, presetDays, customStart, customEnd, useCustomRange, selectedColumns, onSubmit]);

  const vehicleOptions = useMemo(() => {
    const opts = [{ value: '', label: t('dataExport.allVehicles', 'All vehicles') }];
    if (vehicles) {
      for (const v of vehicles) {
        opts.push({ value: String(v.id), label: v.display_name || v.vin });
      }
    }
    if (unknownTarget) opts.push({ value: vehicleId, label: t('dataExport.vehicleUnavailable', 'Vehicle {{vehicleId}} is not available in the current fleet.', { vehicleId }) });
    return opts;
  }, [vehicles, t, unknownTarget, vehicleId]);

  return (
    <GlassPanel className="p-4 sm:p-5 lg:p-6">
      <div className="mb-5 flex items-center gap-2">
        <Icons.fileDown className={cn('h-5 w-5', typography.color.secondary)} aria-hidden="true" />
        <PanelTitle>{t('dataExport.wizardTitle', 'New export')}</PanelTitle>
      </div>

      {/* Step 1: Export Type */}
      <div className="mb-5">
        <Label className="mb-2 block">{t('dataExport.wizard.step1', 'STEP 1 — select data type')}</Label>
        <ExportTypeSelector selected={exportType} onChange={handleExportTypeChange} />
        {jobType === null && (
          <div role="status" className="mt-3">
            <Text>{t('error.unsupported.title', 'Feature not supported')}</Text>
            <HelperText>
              {t('error.unsupported.message', 'This feature is not available with the current server or deployment configuration.')}
            </HelperText>
          </div>
        )}
      </div>

      {/* Step 2: Format */}
      <div className="mb-5">
        <Label className="mb-2 block">{t('dataExport.wizard.step2', 'STEP 2 — choose format')}</Label>
        <FormatSelector selected={exportFormat} onChange={setExportFormat} />
      </div>

      {/* Step 2.5: Columns — only when the catalog supports it */}
      <ColumnPickerSection
        exportType={exportType}
        selectedColumns={selectedColumns}
        onChange={setSelectedColumns}
      />

      {/* Step 3: Vehicle */}
      <div className="mb-5">
        <Label className="mb-2 block">{t('dataExport.wizard.step3', 'STEP 3 — select vehicle')}</Label>
        <Select
          aria-label={t('dataExport.wizard.step3', 'STEP 3 — select vehicle')}
          options={vehicleOptions}
          value={vehicleId}
          onChange={(e) => handleVehicleChange(e.target.value)}
          placeholder={t('dataExport.allVehicles', 'All vehicles')}
          disabled={!vehicles?.length || !!vehiclesState.fatalError}
        />
        <VehicleTargetFeedback vehiclesState={vehiclesState} onRetryVehicles={onRetryVehicles} unknownTarget={unknownTarget ? vehicleId : undefined} />
      </div>

      {/* Step 4: Date Range */}
      <div className="mb-6">
        <Label className="mb-2 block">{t('dataExport.wizard.step4', 'STEP 4 — date range')}</Label>
        <DatePresetSelector selected={useCustomRange ? -1 : presetDays} onChange={handlePresetChange} />
        <HelperText>
          {t('dataExport.startDate', 'Start')} 00:00 UTC ≤ {t('common.timestamp', 'Timestamp')} ≤ {t('dataExport.endDate', 'End')} 00:00 UTC
        </HelperText>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant={useCustomRange ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={useCustomRange}
            wrapLabel
            className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
            icon={<Icons.calendar className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => setUseCustomRange(!useCustomRange)}
          >
            {t('dataExport.customRange', 'Custom range')}
          </Button>
        </div>
        {useCustomRange && (
          <div className="mt-3">
            <CustomDateRange
              startDate={customStart}
              endDate={customEnd}
              onStartChange={setCustomStart}
              onEndChange={setCustomEnd}
            />
            {!datesReady && <HelperText role="alert">{t('vehicleSettings.validation.invalidDate', 'Enter a valid date and time.')}</HelperText>}
          </div>
        )}
      </div>

      {/* Submit */}
      <Button
        variant="primary"
        size="lg"
        wrapLabel
        loading={isPending}
        disabled={!targetReady || !datesReady || jobType === null}
        icon={<Icons.download className="h-4 w-4" aria-hidden="true" />}
        onClick={handleSubmit}
      >
        {t('dataExport.startExport', 'Start export')}
      </Button>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Column Picker                                                     */
/* ------------------------------------------------------------------ */

/** Maps the page's export-type identifiers (`drives`, `charging`, ...) to
 *  the backend catalog identifiers. The page exposes a few extra options
 *  (`full_backup`, `maintenance`, `energy`) that don't have a fixed
 *  column catalog — for those we return an empty string so the hook
 *  short-circuits and the picker hides itself. */
function catalogTypeFor(t: ExportType): string {
  switch (t) {
    case 'drives':
      return 'drives';
    case 'charging':
      return 'charging';
    default:
      return '';
  }
}

function ColumnPickerSection({
  exportType,
  selectedColumns,
  onChange,
}: {
  exportType: ExportType;
  selectedColumns: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const { t } = useTranslation();
  const catalogType = catalogTypeFor(exportType);
  const catalogQuery = useExportColumns(catalogType || undefined);
  const catalogState = useDataState(catalogQuery);
  const data = catalogState.data;

  // Hide the picker entirely when the export type doesn't publish a
  // catalog. The backend will continue to write all of its native
  // columns — this matches today's behaviour exactly.
  if (!catalogType) {
    return null;
  }
  if (catalogState.status === 'initial') {
    return (
      <div className="mb-5">
        <Label className="mb-2 block">{t('dataExport.columns.title', 'STEP 2½ — columns')}</Label>
        {catalogState.isRefreshBlocked ? (
          <Text color="secondary" role="status">{t('dataSources.status.paused', 'Refresh paused')}</Text>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </div>
    );
  }
  if (catalogState.fatalError) {
    return (
      <div className="mb-5">
        <Label className="mb-2 block">{t('dataExport.columns.title', 'STEP 2½ — columns')}</Label>
        <QueryError error={catalogState.fatalError} onRetry={() => { void catalogQuery.refetch(); }} />
      </div>
    );
  }
  if (data?.supports_selection === false) {
    return null;
  }
  if (!data || !data.supports_selection || (data.columns?.length ?? 0) === 0) {
    return (
      <div className="mb-5" data-testid="export-column-picker">
        <Label className="mb-2 block">{t('dataExport.columns.title', 'STEP 2½ — columns')}</Label>
        <StaleRefreshWarning state={catalogState} label={t('dataExport.columns.title', 'STEP 2½ — columns')} />
        <EmptyState message={t('dataExport.columns.unavailableTitle', 'No export columns are available for this data type.')}
          description={t('dataExport.columnsUnavailableHelp', 'Column choices appear after the export catalog returns supported fields.')}
          action={{ label: t('common.retry', 'Retry'), onClick: () => { void catalogQuery.refetch(); } }} />
      </div>
    );
  }

  // The "selected" set drives the checkbox UI. Default = every column.
  const allColumnNames = data.columns.map((c) => c.name);
  const effectiveSelected = selectedColumns ?? allColumnNames;
  const selectedSet = new Set(effectiveSelected);
  const allSelected =
    effectiveSelected.length === allColumnNames.length &&
    allColumnNames.every((n) => selectedSet.has(n));

  const requiredSet = new Set(
    data.columns.filter((c) => c.always_included).map((c) => c.name),
  );

  const toggleColumn = (name: string) => {
    if (requiredSet.has(name)) return;
    const next = new Set(effectiveSelected);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    // Preserve catalog order when emitting the new selection so the
    // backend writes columns in a stable order.
    const ordered = allColumnNames.filter((n) => next.has(n));
    // If the user re-selected every column, collapse to the legacy
    // "all selected" state by passing null — the wizard will then omit
    // `columns` from the submit payload entirely.
    if (ordered.length === allColumnNames.length) {
      onChange(null);
    } else {
      onChange(ordered);
    }
  };

  const handleSelectAll = () => onChange(null);
  const handleClear = () => {
    // "Clear" leaves the always-included columns selected — the backend
    // would silently re-add them anyway and it's clearer if the UI
    // reflects that instead of letting the user think they unchecked them.
    const required = allColumnNames.filter((n) => requiredSet.has(n));
    if (required.length === allColumnNames.length) {
      onChange(null);
    } else {
      onChange(required);
    }
  };

  return (
    <div className="mb-5" data-testid="export-column-picker">
      <Label className="mb-2 block">{t('dataExport.columns.title', 'STEP 2½ — columns')}</Label>
      <StaleRefreshWarning state={catalogState} label={t('dataExport.columns.title', 'STEP 2½ — columns')} />
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <HelperText className="max-w-prose">
            {t(
              'dataExport.columns.helperText',
              'Select which columns to include in the export. Required columns cannot be removed.',
            )}
          </HelperText>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              disabled={allSelected}
              data-testid="export-column-select-all"
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
            >
              {t('dataExport.columns.selectAll', 'Select all')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              data-testid="export-column-clear"
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
            >
              {t('dataExport.columns.clear', 'Clear')}
            </Button>
          </div>
        </div>
        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
          role="group"
          aria-label={t('dataExport.columns.title', 'STEP 2½ — columns')}
        >
          {data.columns.map((col) => {
            const checked = selectedSet.has(col.name);
            const required = requiredSet.has(col.name);
            return (
              <div
                key={col.name}
                data-testid={`export-column-row-${col.name}`}
                className={cn(
                  'flex min-w-0 min-h-11 flex-wrap items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-2 md:min-h-0',
                  !required && 'hover:bg-[var(--surface-2)]',
                )}
              >
                <Checkbox
                  size="sm"
                  checked={checked}
                  disabled={required}
                  className={required ? '!opacity-100' : undefined}
                  onChange={() => toggleColumn(col.name)}
                  label={col.label}
                  aria-label={col.label}
                  data-testid={`export-column-checkbox-${col.name}`}
                />
                {required && (
                  <Badge variant="warning" size="sm" className="ml-auto">
                    {t('dataExport.columns.alwaysIncluded', 'Required')}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Export History Table                                                */
/* ------------------------------------------------------------------ */

function ExportHistoryTable({
  jobs,
  isLoading,
  isRefreshBlocked,
  error,
  vehicles,
  onDownload,
  onRefresh,
}: {
  jobs: ExportJobSummary[] | undefined;
  isLoading: boolean;
  isRefreshBlocked: boolean;
  error?: unknown;
  vehicles: Vehicle[] | undefined;
  onDownload: (job: ExportJobSummary) => void;
  onRefresh: () => void;
}) {
  const { formatDurationMsLong } = useNumberFormatting();
  const { formatBytes, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  const { sortKey, sortDir, onSort } = useSortToggle();
  const sortedJobs = useMemo(() => {
    const source = jobs ?? [];
    if (!sortKey) return source;
    const value = (job: ExportJobSummary): string | number | null => {
      switch (sortKey) {
        case 'type': return job.type ?? null;
        case 'status': return job.status ?? null;
        case 'records': return job.record_count ?? null;
        case 'size': return job.file_size ?? null;
        case 'time': {
          const timestamp = Date.parse(job.created_at);
          return Number.isFinite(timestamp) ? timestamp : null;
        }
        default: return null;
      }
    };
    return [...source].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [jobs, sortKey, sortDir]);
  const vehicleMap = useMemo(() => {
    const map = new Map<number, string>();
    if (vehicles) {
      for (const v of vehicles) {
        map.set(v.id, v.display_name || v.vin);
      }
    }
    return map;
  }, [vehicles]);

  const activeJobs = useMemo(
    () => (jobs ?? []).filter((j) => j.status === 'queued' || j.status === 'processing').length,
    [jobs],
  );

  const columns: Column<ExportJobSummary>[] = useMemo(
    () => [
      {
        key: 'type',
        filterValue: (row) => row.type ?? null,
        header: t('dataExport.type', 'Type'),
        sortable: true,
        render: (row) => <TypeBadge type={row.type} />,
      },
      {
        key: 'format',
        filterValue: (row) => row.format ?? null,
        filterValueLabel: (_value, row) => row.format?.toUpperCase() ?? '—',
        header: t('dataExport.format', 'Format'),
        render: (row) => <FormatBadge format={row.format} />,
      },
      {
        key: 'status',
        filterValue: (row) => row.status ?? null,
        header: t('common.status', 'Status'),
        sortable: true,
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'vehicle',
        filterValue: (row) => row.vehicle_id ?? null,
        filterValueLabel: (_value, row) => row.vehicle_id == null ? '—' : vehicleMap.get(row.vehicle_id) ?? `#${row.vehicle_id}`,
        header: t('common.vehicle', 'Vehicle'),
        render: (row) => (
          <Text size="xs" color="secondary">
            {row.vehicle_id ? vehicleMap.get(row.vehicle_id) ?? `#${row.vehicle_id}` : '—'}
          </Text>
        ),
      },
      {
        key: 'records',
        filterValue: (row) => row.record_count ?? null,
        filterValueLabel: (_value, row) => row.record_count == null ? '—' : fmtInt(row.record_count),
        align: 'right',
        groupStart: true,
        header: t('dataExport.records', 'Records'),
        sortable: true,
        render: (row) => (
          <Text size="xs" color="secondary">
            {row.record_count != null ? fmtInt(row.record_count) : '—'}
          </Text>
        ),
      },
      {
        key: 'size',
        filterValue: (row) => row.file_size ?? null,
        filterValueLabel: (_value, row) => formatBytes(row.file_size, { zeroAsEmpty: false }),
        align: 'right',
        header: t('dataExport.size', 'Size'),
        sortable: true,
        render: (row) => (
          <Text size="xs" color="secondary">
            {formatBytes(row.file_size, { zeroAsEmpty: false })}
          </Text>
        ),
      },
      {
        key: 'duration',
        filterValue: (row) => row.duration_ms ?? null,
        filterValueLabel: (_value, row) => formatDurationMsLong(row.duration_ms),
        align: 'right',
        header: t('common.duration', 'Duration'),
        render: (row) => (
          <Text size="xs" color="muted">
            {formatDurationMsLong(row.duration_ms)}
          </Text>
        ),
      },
      {
        key: 'time',
        filterValue: (row) => row.created_at ?? null,
        header: t('dataExport.time', 'Time'),
        sortable: true,
        render: (row) => (
          <TimeStamp value={row.created_at} className={cn(typography.size.xs, typography.color.muted)} />
        ),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-24 text-right',
        render: (row) =>
          row.status === 'ready' ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Icons.download className="h-3.5 w-3.5" aria-hidden="true" />}
              wrapLabel
              className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
              onClick={() => onDownload(row)}
            >
              {t('dataExport.download', 'Download')}
            </Button>
          ) : row.status === 'failed' && row.error_message ? (
            <Text
              as="span"
              variant="error"
              className="block max-w-prose whitespace-normal break-words"
              title={row.error_message}
            >
              {row.error_message}
            </Text>
          ) : null,
      },
    ],
    [t, vehicleMap, onDownload, formatBytes, displayPrecision, displayLocale, formatDurationMsLong],
  );

  return (
    <GlassPanel className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <PanelTitle>{t('dataExport.exportHistory', 'Export history')}</PanelTitle>
          {activeJobs > 0 && (
            <Badge variant="info" size="sm" dot>
              {activeJobs} {t('dataExport.active', 'Active')}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" wrapLabel className="min-h-11 min-w-11 md:min-h-9 md:min-w-0" icon={<Icons.refresh className="h-3.5 w-3.5" aria-hidden="true" />} onClick={onRefresh}>
          {t('dataExport.refresh', 'Refresh')}
        </Button>
      </div>

      {error ? (
        <div className="p-5">
          <QueryError
            error={error}
            onRetry={onRefresh}
            resourceName={t('dataExport.resourceName', 'Export jobs')}
          />
        </div>
      ) : !jobs && isRefreshBlocked ? (
        <Text color="secondary" role="status" className="p-5">{t('dataSources.status.paused', 'Refresh paused')}</Text>
      ) : isLoading && (!jobs || jobs.length === 0) ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Icons.fileDown className="h-10 w-10" />}
          title={t('dataExport.noExports', 'No exports yet')}
          message={t('dataExport.noExportsMessage', 'Create your first export above to get started.')}
        />
      ) : (
        <div role="region" aria-label={t('dataExport.resourceName', 'Export jobs')} className="max-w-full overflow-x-auto">
          <DataTable
            tableId="system:data-export-jobs"
            columns={columns}
            data={sortedJobs}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
            enableValueFilters
            keyExtractor={(row) => row.id}
            emptyMessage={t('dataExport.noJobs', 'No export jobs')}
            compact
            pagination
          />
        </div>
      )}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Account Export Panel                                             */
/* ------------------------------------------------------------------ */

function AccountExportPanel({ vehiclesState, onRetryVehicles }: VehicleTargetProps) {
  const { t } = useTranslation();
  const vehicles = vehiclesState.data;
  const [searchParams] = useSearchParams();
  const {
    vehicleId: globalVehicleId,
    setVehicleId: setGlobalVehicleId,
  } = useSelectedVehicle();
  const [vehicleId, setVehicleId] = useState<string>(
    searchParams.get('vehicle_id') || (globalVehicleId == null ? 'all' : String(globalVehicleId)),
  );
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const createAccount = useCreateAccountExport();
  const unknownTarget = vehicleId !== 'all' && !vehicles?.some(v => String(v.id) === vehicleId);
  const targetReady = !!vehicles?.length && !vehiclesState.fatalError && !unknownTarget;
  const datesReady = validExportDates(startDate, endDate);

  useEffect(() => {
    setVehicleId(previous => previous !== 'all' && !vehicles?.some(v => String(v.id) === previous)
      ? previous : globalVehicleId == null ? previous : String(globalVehicleId));
  }, [globalVehicleId, vehicles]);

  const handleVehicleChange = useCallback(
    (value: string) => {
      setVehicleId(value);
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0 && parsed !== globalVehicleId) {
        setGlobalVehicleId(parsed);
      }
    },
    [globalVehicleId, setGlobalVehicleId],
  );

  const handleStart = useCallback(() => {
    if (!targetReady || !datesReady) return;
    const payload: { vehicle_id?: number; start?: string; end?: string } = {};
    if (vehicleId !== 'all') {
      const id = Number(vehicleId);
      payload.vehicle_id = id;
    }
    if (startDate) payload.start = startDate;
    if (endDate) payload.end = endDate;
    createAccount.mutate(payload);
  }, [targetReady, datesReady, vehicleId, startDate, endDate, createAccount]);

  const vehicleOptions = useMemo(
    () => [
      { value: 'all', label: t('dataExport.account.allVehicles', 'All vehicles') },
      ...(vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin || `Vehicle ${v.id}`,
      })),
      ...(unknownTarget ? [{ value: vehicleId, label: t('dataExport.vehicleUnavailable', 'Vehicle {{vehicleId}} is not available in the current fleet.', { vehicleId }) }] : []),
    ],
    [vehicles, t, unknownTarget, vehicleId],
  );

  return (
    <GlassPanel className="p-4 sm:p-5 lg:p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-[var(--surface-2)] p-2">
          <Icons.package className={cn('h-5 w-5', typography.color.secondary)} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <PanelTitle>{t('dataExport.account.title', 'Download my data')}</PanelTitle>
          <Text as="p" size="sm" color="secondary" className="mt-1">
            {t(
              'dataExport.account.subtitle',
              'Get a single ZIP containing every table we store for you — drives, charging, signal history, alerts, settings, and a manifest. Use this for backup, migration, or your personal records.',
            )}
          </Text>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Select
          label={t('dataExport.account.vehicle', 'Vehicle')}
          value={vehicleId}
          onChange={(e) => handleVehicleChange(e.target.value)}
          options={vehicleOptions}
          disabled={!vehicles?.length || !!vehiclesState.fatalError}
        />
        <Input
          label={t('dataExport.account.startDate', 'Start date (optional)')}
          className="min-h-11 md:min-h-10"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label={t('dataExport.account.endDate', 'End date (optional)')}
          className="min-h-11 md:min-h-10"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      <HelperText>
        {t('dataExport.startDate', 'Start')} 00:00 UTC ≤ {t('common.timestamp', 'Timestamp')} ≤ {t('dataExport.endDate', 'End')} 00:00 UTC
      </HelperText>
      {!datesReady && <HelperText role="alert">{t('vehicleSettings.validation.invalidDate', 'Enter a valid date and time.')}</HelperText>}
      <VehicleTargetFeedback vehiclesState={vehiclesState} onRetryVehicles={onRetryVehicles} unknownTarget={unknownTarget ? vehicleId : undefined} />

      <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Icons.alertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <Text as="span" variant="caption">
            {t(
              'dataExport.account.warning',
              'Large signal histories are capped per table to keep the ZIP under control. Track progress in the floating widget that appears once your export starts.',
            )}
          </Text>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={handleStart}
          wrapLabel
          className="min-h-11 min-w-11 md:min-h-10 md:min-w-0"
          loading={createAccount.isPending}
          disabled={!targetReady || !datesReady}
          icon={<Icons.download className="h-4 w-4" aria-hidden="true" />}
        >
          {t('dataExport.account.start', 'Start full export')}
        </Button>
      </div>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function DataExportPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  usePageTitle(t('dataExport.title', 'Data export'));

  /* --- Queries --- */

  const jobsQuery = useQuery<ExportJobSummary[]>({
    queryKey: ['export-jobs'],
    queryFn: ({ signal }) => request<ExportJobSummary[]>('/export/jobs', { signal }),
    refetchInterval: 10_000,
  });
  const jobsState = useDataState(jobsQuery, { provenance: 'historical' });
  const jobs = jobsState.data;
  const jobsLoading = jobsState.status === 'initial' && !jobsState.isRefreshBlocked;
  const jobsError = jobsState.fatalError;

  const vehiclesQuery = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: ({ signal }) => request<Vehicle[]>('/vehicles', { signal }),
  });
  const vehiclesState = useDataState(vehiclesQuery);
  const vehicles = vehiclesState.data;

  /* --- Mutations --- */

  const submitExport = useMutation({
    mutationFn: (payload: ExportSubmitPayload) =>
      request<ExportJobSummary>('/export/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success(t('dataExport.exportStarted', 'Export started'), t('dataExport.exportStartedMsg', 'Your export has started.'));
      queryClient.invalidateQueries({ queryKey: ['export-jobs'] });
    },
    onError: () => {
      toast.error(t('dataExport.exportFailed', 'Export failed'), t('dataExport.exportFailedMsg', 'The export could not be started. Please try again.'));
    },
  });

  /* --- Handlers --- */

  const handleDownload = useCallback((job: ExportJobSummary) => {
    window.open(exportDownloadUrl(job.id), '_blank');
  }, []);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['export-jobs'] });
  }, [queryClient]);

  const handleSubmit = useCallback(
    (payload: ExportSubmitPayload) => {
      submitExport.mutate(payload);
    },
    [submitExport],
  );

  /* --- Derived data for overview --- */
  const dataOverview = useMemo<DataOverview | undefined>(() => {
    if (!jobs) return undefined;
    const drives = jobs.filter((j) => j.type === 'drives').reduce((s, j) => s + (j.record_count ?? 0), 0);
    const charging = jobs.filter((j) => j.type === 'charging').reduce((s, j) => s + (j.record_count ?? 0), 0);
    return { drives, charging_sessions: charging };
  }, [jobs]);

  /* --- Render --- */

  return (
    <PageLayout
      title={t('dataExport.title', 'Data export')}
      subtitle={t('dataExport.subtitle', 'Export vehicle data in CSV or JSON format')}
      secondaryActions={
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.refresh className="h-4 w-4" aria-hidden="true" />}
          wrapLabel
          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
          onClick={handleRefresh}
        >
          {t('dataExport.refresh', 'Refresh')}
        </Button>
      }
    >
      <StaleRefreshWarning state={jobsState} label={t('dataExport.exportHistory', 'Export history')} />
      {/* Non-blocking load error — the History panel below also renders its
          own QueryError so each section stays self-sufficient. */}
      {jobsError && (
        <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('dataExport.loadError', 'Failed to load export jobs')}
        </AlertBanner>
      )}

      {/* 1 — KPI band */}
      <FadeIn>
        <StatsRow jobs={jobs} isLoading={jobsLoading} retained={jobsState.hasData && jobsQuery.isError} />
      </FadeIn>

      {/* 2 — Primary bento: export wizard (hero) + context rail */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('dataExport.create.aria', 'Create a new export')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="xl:col-span-2">
            <ExportWizard
              vehiclesState={vehiclesState}
              onRetryVehicles={() => { void vehiclesQuery.refetch(); }}
              onSubmit={handleSubmit}
              isPending={submitExport.isPending}
            />
          </div>
          <div className="space-y-4 xl:col-span-1">
            <DataOverviewCard overview={dataOverview} isLoading={jobsLoading} retained={jobsState.hasData && jobsQuery.isError} />
            <FormatInfoCards />
          </div>
        </section>
      </FadeIn>

      {/* 3 — GDPR-style "Download my data" full-width band */}
      <FadeIn delay={0.1}>
        <section aria-label={t('dataExport.account.aria', 'Full account export')}>
          <AccountExportPanel vehiclesState={vehiclesState} onRetryVehicles={() => { void vehiclesQuery.refetch(); }} />
        </section>
      </FadeIn>

      {/* 4 — Export history detail band */}
      <FadeIn delay={0.15}>
        <section aria-label={t('dataExport.history.aria', 'Export history')}>
          <ExportHistoryTable
            jobs={jobs}
            isLoading={jobsLoading}
            isRefreshBlocked={jobsState.isRefreshBlocked}
            error={jobsError}
            vehicles={vehicles}
            onDownload={handleDownload}
            onRefresh={handleRefresh}
          />
        </section>
      </FadeIn>

      {/* 5 — Recurring scheduled exports panel. Wrapped in <RequiresAuth>
          because the underlying API takes ownership from
          FORWARD_AUTH_HEADER; in open mode the placeholder explains
          why the section can't render. */}
      <FadeIn delay={0.2}>
        <section aria-label={t('dataExport.scheduled.aria', 'Scheduled exports')}>
          <RequiresAuth
            capability="session_list"
            feature={t('dataExport.scheduled.feature', 'Scheduled exports')}
          >
            <ScheduledExportsPanel />
          </RequiresAuth>
        </section>
      </FadeIn>

      {/* Floating job progress drawer — visible across the page */}
      <JobProgressDrawer />
    </PageLayout>
  );
}
