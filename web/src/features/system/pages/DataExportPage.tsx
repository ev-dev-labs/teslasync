import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { cn } from '@/lib/cn';
import { formatBytes, fmtInt as libFmtInt } from '@/lib/numberFormat';
import { formatDurationMsLong, formatRelative } from '@/lib/dateFormat';
import { neonColorMap, typography, type NeonColor } from '@/lib/tokens';
import { Icons } from '@/lib/icons';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  Input,
  Select,
  Checkbox,
  DataTable,
  PanelTitle,
  Label,
  Text,
  HelperText,
  type Column,
} from '@/components/ui';
import { MetricCard, TimeStamp } from '@/components/data-display';
import {
  Skeleton,
  EmptyState,
  QueryError,
  AlertBanner,
  JobProgressDrawer,
  RequiresAuth,
} from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useToast } from '@/components/feedback/Toast';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { request } from '@/api/client';
import {
  useCreateAccountExport,
  useExportColumns,
  exportDownloadUrl,
} from '@/api/hooks/useExports';
import { ScheduledExportsPanel } from './ScheduledExportsPanel';
import type { Vehicle } from '@/api/types';

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
  type: ExportType;
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
  color: NeonColor;
}[] = [
  { value: 'drives', labelKey: 'dataExport.types.drives', label: 'Drives', icon: Icons.vehicle, descKey: 'dataExport.types.drivesDesc', desc: 'Export drive sessions, routes, and efficiency data', color: 'cyan' },
  { value: 'charging', labelKey: 'dataExport.types.charging', label: 'Charging', icon: Icons.charging, descKey: 'dataExport.types.chargingDesc', desc: 'Export charging sessions and energy data', color: 'green' },
  { value: 'trips', labelKey: 'dataExport.types.trips', label: 'Trips', icon: Icons.trip, descKey: 'dataExport.types.tripsDesc', desc: 'Export trip summaries with SI aggregate columns', color: 'cyan' },
  { value: 'analytics', labelKey: 'dataExport.types.analytics', label: 'Analytics', icon: Icons.analytics, descKey: 'dataExport.types.analyticsDesc', desc: 'Export analytics and aggregated statistics', color: 'purple' },
  { value: 'full_backup', labelKey: 'dataExport.types.fullBackup', label: 'Full Backup', icon: Icons.database, descKey: 'dataExport.types.fullBackupDesc', desc: 'Complete database backup of all vehicle data', color: 'amber' },
  { value: 'maintenance', labelKey: 'dataExport.types.maintenance', label: 'Maintenance', icon: Icons.maintenance, descKey: 'dataExport.types.maintenanceDesc', desc: 'Export maintenance and service records', color: 'red' },
  { value: 'energy', labelKey: 'dataExport.types.energy', label: 'Energy', icon: Icons.battery, descKey: 'dataExport.types.energyDesc', desc: 'Export energy consumption and efficiency data', color: 'green' },
];

const EXPORT_FORMATS: { value: ExportFormat; labelKey: string; label: string; icon: typeof Icons.fileSpreadsheet; descKey: string; desc: string }[] = [
  { value: 'csv', labelKey: 'dataExport.formats.csv', label: 'CSV', icon: Icons.fileSpreadsheet, descKey: 'dataExport.formats.csvDesc', desc: 'Comma-separated values, compatible with Excel and Google Sheets' },
  { value: 'json', labelKey: 'dataExport.formats.json', label: 'JSON', icon: Icons.fileJson, descKey: 'dataExport.formats.jsonDesc', desc: 'Structured JSON format for programmatic access' },
];

const DATE_PRESETS: { labelKey: string; label: string; days: number }[] = [
  { labelKey: 'dataExport.presets.last7', label: 'Last 7 Days', days: 7 },
  { labelKey: 'dataExport.presets.last30', label: 'Last 30 Days', days: 30 },
  { labelKey: 'dataExport.presets.last90', label: 'Last 90 Days', days: 90 },
  { labelKey: 'dataExport.presets.lastYear', label: 'Last Year', days: 365 },
  { labelKey: 'dataExport.presets.allTime', label: 'All Time', days: 0 },
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
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
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
      aria-label={t('dataExport.wizard.step1', 'STEP 1 — Select Data Type')}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
    >
      {EXPORT_TYPES.map((et) => {
        const Icon = et.icon;
        const active = selected === et.value;
        const c = neonColorMap[et.color];
        return (
          <GlassPanel
            key={et.value}
            role="radio"
            aria-checked={active}
            aria-label={t(et.labelKey, et.label)}
            tabIndex={0}
            hover
            onClick={() => onChange(et.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onChange(et.value);
              }
            }}
            className={cn(
              'min-h-11 cursor-pointer rounded-xl border-2 p-4 text-left transition-all duration-normal',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
              active ? cn(c.border, c.glow) : 'border-transparent hover:border-[var(--border-subtle)]',
            )}
          >
            <div className="mb-2 flex items-center gap-2.5">
              <div className={cn('rounded-lg p-1.5', active ? c.bg : 'bg-[var(--surface-2)]')}>
                <Icon
                  className={cn('h-4 w-4', active ? c.text : 'text-[var(--text-muted)]')}
                  aria-hidden="true"
                />
              </div>
              <Text as="span" size="sm" weight="semibold" color={active ? 'primary' : 'secondary'}>
                {t(et.labelKey, et.label)}
              </Text>
            </div>
            <Text as="p" variant="caption" className="leading-relaxed">
              {t(et.descKey, et.desc)}
            </Text>
          </GlassPanel>
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
    <div className="flex flex-wrap gap-3" role="group" aria-label={t('dataExport.wizard.step2', 'STEP 2 — Choose Format')}>
      {EXPORT_FORMATS.map((f) => {
        const Icon = f.icon;
        const active = selected === f.value;
        return (
          <Button
            key={f.value}
            variant={active ? 'primary' : 'outline'}
            size="md"
            aria-pressed={active}
            icon={<Icon className="h-4 w-4" aria-hidden="true" />}
            onClick={() => onChange(f.value)}
          >
            {t(f.labelKey, f.label)}
          </Button>
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
    'rounded-lg bg-[var(--surface-overlay)] p-3',
    typography.family.mono,
    typography.size['2xs'],
    typography.color.muted,
  );
  return (
    <div className="grid grid-cols-1 gap-4">
      <GlassPanel className="p-4" hover glow="cyan">
        <div className="mb-3 flex items-center gap-2">
          <Icons.fileSpreadsheet className="h-5 w-5 text-cyan-300" aria-hidden="true" />
          <PanelTitle>{t('dataExport.csvPreview', 'CSV Preview')}</PanelTitle>
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

      <GlassPanel className="p-4" hover glow="purple">
        <div className="mb-3 flex items-center gap-2">
          <Icons.fileJson className="h-5 w-5 text-purple-300" aria-hidden="true" />
          <PanelTitle>{t('dataExport.jsonPreview', 'JSON Preview')}</PanelTitle>
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
}: {
  overview: DataOverview | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icons.database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <PanelTitle>{t('dataExport.dataOverview', 'Data Overview')}</PanelTitle>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      ) : overview ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Icons.vehicle className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
            <Text size="xs" color="secondary">
              {fmtInt(overview.drives)} {t('dataExport.drives', 'Drives')}
            </Text>
          </div>
          <div className="flex items-center gap-2">
            <Icons.charging className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
            <Text size="xs" color="secondary">
              {fmtInt(overview.charging_sessions)} {t('dataExport.chargingSessions', 'Charging Sessions')}
            </Text>
          </div>
        </div>
      ) : (
        <Text as="p" variant="caption">{t('dataExport.unavailable', 'Unavailable')}</Text>
      )}
    </GlassPanel>
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
    <div className="flex flex-wrap gap-3">
      <Input
        type="date"
        label={t('dataExport.startDate', 'Start')}
        value={startDate}
        onChange={(e) => onStartChange(e.target.value)}
      />
      <Input
        type="date"
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
}: {
  jobs: ExportJobSummary[] | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const totalExports = jobs?.length ?? 0;

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

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={80} rounded />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <MetricCard
        label={t('Total Exports')}
        value={totalExports}
        icon={<Icons.package className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('Total Size')}
        value={formatBytes(totalSize, { zeroAsEmpty: true, gbDecimals: 2 })}
        icon={<Icons.hardDrive className="h-4 w-4" />}
        color="blue"
      />
      <MetricCard
        label={t('Most Exported')}
        value={mostExportedType}
        icon={<Icons.analytics className="h-4 w-4" />}
        color="purple"
        subtitle={t('By Count')}
      />
      <MetricCard
        label={t('Last Export')}
        value={lastExport}
        icon={<Icons.clock className="h-4 w-4" />}
        color="green"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Export Wizard                                                       */
/* ------------------------------------------------------------------ */

function ExportWizard({
  vehicles,
  onSubmit,
  isPending,
}: {
  vehicles: Vehicle[] | undefined;
  onSubmit: (payload: ExportSubmitPayload) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const {
    vehicleId: globalVehicleId,
    setVehicleId: setGlobalVehicleId,
  } = useSelectedVehicle();
  const [exportType, setExportType] = useState<ExportType>('drives');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [vehicleId, setVehicleId] = useState(
    globalVehicleId == null ? '' : String(globalVehicleId),
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

  useEffect(() => {
    setVehicleId(globalVehicleId == null ? '' : String(globalVehicleId));
  }, [globalVehicleId]);

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
    const payload: ExportSubmitPayload = {
      type: exportType,
      format: exportFormat,
    };
    if (vehicleId) {
      payload.vehicle_id = Number(vehicleId);
    }
    if (useCustomRange && customStart) {
      payload.start = customStart;
      payload.end = customEnd || new Date().toISOString().split('T')[0];
    } else if (presetDays > 0) {
      payload.start = daysAgo(presetDays);
      payload.end = new Date().toISOString().split('T')[0];
    }
    if (selectedColumns !== null && selectedColumns.length > 0) {
      payload.columns = selectedColumns;
    }
    onSubmit(payload);
  }, [exportType, exportFormat, vehicleId, presetDays, customStart, customEnd, useCustomRange, selectedColumns, onSubmit]);

  const vehicleOptions = useMemo(() => {
    const opts = [{ value: '', label: t('All Vehicles') }];
    if (vehicles) {
      for (const v of vehicles) {
        opts.push({ value: String(v.id), label: v.display_name || v.vin });
      }
    }
    return opts;
  }, [vehicles, t]);

  return (
    <GlassPanel className="p-4 sm:p-5 lg:p-6" glow="cyan">
      <div className="mb-5 flex items-center gap-2">
        <Icons.fileDown className="h-5 w-5 text-cyan-300" aria-hidden="true" />
        <PanelTitle>{t('dataExport.wizardTitle', 'New Export')}</PanelTitle>
      </div>

      {/* Step 1: Export Type */}
      <div className="mb-5">
        <Label className="mb-2 block">{t('dataExport.wizard.step1', 'STEP 1 — Select Data Type')}</Label>
        <ExportTypeSelector selected={exportType} onChange={handleExportTypeChange} />
      </div>

      {/* Step 2: Format */}
      <div className="mb-5">
        <Label className="mb-2 block">{t('dataExport.wizard.step2', 'STEP 2 — Choose Format')}</Label>
        <FormatSelector selected={exportFormat} onChange={setExportFormat} />
      </div>

      {/* Step 2.5: Columns — only when the catalog supports it */}
      <ColumnPickerSection
        exportType={exportType}
        selectedColumns={selectedColumns}
        onChange={setSelectedColumns}
      />

      {/* Step 3: Vehicle */}
      {vehicles && vehicles.length > 0 && (
        <div className="mb-5 max-w-xs">
          <Label className="mb-2 block">{t('dataExport.wizard.step3', 'STEP 3 — Select Vehicle')}</Label>
          <Select
            options={vehicleOptions}
            value={vehicleId}
            onChange={(e) => handleVehicleChange(e.target.value)}
            placeholder={t('dataExport.allVehicles', 'All Vehicles')}
          />
        </div>
      )}

      {/* Step 4: Date Range */}
      <div className="mb-6">
        <Label className="mb-2 block">{t('dataExport.wizard.step4', 'STEP 4 — Date Range')}</Label>
        <DatePresetSelector selected={useCustomRange ? -1 : presetDays} onChange={handlePresetChange} />
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant={useCustomRange ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={useCustomRange}
            icon={<Icons.calendar className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => setUseCustomRange(!useCustomRange)}
          >
            {t('dataExport.customRange', 'Custom Range')}
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
          </div>
        )}
      </div>

      {/* Submit */}
      <Button
        variant="primary"
        size="lg"
        loading={isPending}
        icon={<Icons.download className="h-4 w-4" aria-hidden="true" />}
        onClick={handleSubmit}
      >
        {t('Start Export')}
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
  const { data, isLoading, isError } = useExportColumns(catalogType || undefined);

  // Hide the picker entirely when the export type doesn't publish a
  // catalog. The backend will continue to write all of its native
  // columns — this matches today's behaviour exactly.
  if (!catalogType) {
    return null;
  }
  if (isLoading) {
    return (
      <div className="mb-5">
        <Label className="mb-2 block">{t('dataExport.columns.title', 'STEP 2½ — Columns')}</Label>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (isError || !data || !data.supports_selection || (data.columns?.length ?? 0) === 0) {
    return null;
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
      <Label className="mb-2 block">{t('dataExport.columns.title', 'STEP 2½ — Columns')}</Label>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <HelperText className="max-w-prose">
            {t(
              'dataExport.columns.helperText',
              'Select which columns to include in the export. Required columns cannot be removed.',
            )}
          </HelperText>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              disabled={allSelected}
              data-testid="export-column-select-all"
            >
              {t('dataExport.columns.selectAll', 'Select all')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              data-testid="export-column-clear"
            >
              {t('dataExport.columns.clear', 'Clear')}
            </Button>
          </div>
        </div>
        <div
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
          role="group"
          aria-label={t('dataExport.columns.title', 'STEP 2½ — Columns')}
        >
          {data.columns.map((col) => {
            const checked = selectedSet.has(col.name);
            const required = requiredSet.has(col.name);
            return (
              <div
                key={col.name}
                data-testid={`export-column-row-${col.name}`}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-3 py-2',
                  required ? 'opacity-70' : 'hover:bg-[var(--surface-2)]',
                )}
              >
                <Checkbox
                  size="sm"
                  checked={checked}
                  disabled={required}
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
  error,
  vehicles,
  onDownload,
  onRefresh,
}: {
  jobs: ExportJobSummary[] | undefined;
  isLoading: boolean;
  error?: unknown;
  vehicles: Vehicle[] | undefined;
  onDownload: (job: ExportJobSummary) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
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
        header: t('Type'),
        sortable: true,
        render: (row) => <TypeBadge type={row.type} />,
      },
      {
        key: 'format',
        header: t('Format'),
        render: (row) => <FormatBadge format={row.format} />,
      },
      {
        key: 'status',
        header: t('Status'),
        sortable: true,
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'vehicle',
        header: t('Vehicle'),
        render: (row) => (
          <Text size="xs" color="secondary">
            {row.vehicle_id ? vehicleMap.get(row.vehicle_id) ?? `#${row.vehicle_id}` : '—'}
          </Text>
        ),
      },
      {
        key: 'records',
        header: t('Records'),
        sortable: true,
        render: (row) => (
          <Text size="xs" color="secondary">
            {row.record_count != null ? fmtInt(row.record_count) : '—'}
          </Text>
        ),
      },
      {
        key: 'size',
        header: t('Size'),
        sortable: true,
        render: (row) => (
          <Text size="xs" color="secondary">
            {formatBytes(row.file_size, { zeroAsEmpty: true, gbDecimals: 2 })}
          </Text>
        ),
      },
      {
        key: 'duration',
        header: t('Duration'),
        render: (row) => (
          <Text size="xs" color="muted">
            {formatDurationMsLong(row.duration_ms)}
          </Text>
        ),
      },
      {
        key: 'time',
        header: t('Time'),
        sortable: true,
        render: (row) => (
          <TimeStamp value={row.created_at} className="text-xs text-[var(--text-muted)]" />
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
              onClick={() => onDownload(row)}
            >
              {t('Download')}
            </Button>
          ) : row.status === 'failed' && row.error_message ? (
            <Text
              as="span"
              variant="error"
              className="inline-block max-w-[120px] truncate"
              title={row.error_message}
            >
              {row.error_message}
            </Text>
          ) : null,
      },
    ],
    [t, vehicleMap, onDownload],
  );

  return (
    <GlassPanel className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="flex items-center gap-3">
          <PanelTitle>{t('dataExport.exportHistory', 'Export History')}</PanelTitle>
          {activeJobs > 0 && (
            <Badge variant="info" size="sm" dot>
              {activeJobs} {t('dataExport.active', 'Active')}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" icon={<Icons.refresh className="h-3.5 w-3.5" aria-hidden="true" />} onClick={onRefresh}>
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
      ) : isLoading && (!jobs || jobs.length === 0) ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Icons.fileDown className="h-10 w-10" />}
          title={t('dataExport.noExports', 'No Exports Yet')}
          message={t('dataExport.noExportsMessage', 'Create your first export above to get started.')}
        />
      ) : (
        <DataTable
          tableId="system:data-export-jobs"
          columns={columns}
          data={jobs}
          keyExtractor={(row) => row.id}
          emptyMessage={t('dataExport.noJobs', 'No export jobs')}
          compact
          pagination
        />
      )}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Account Export Panel                                             */
/* ------------------------------------------------------------------ */

interface AccountExportPanelProps {
  vehicles: Vehicle[] | undefined;
}

function AccountExportPanel({ vehicles }: AccountExportPanelProps) {
  const { t } = useTranslation();
  const {
    vehicleId: globalVehicleId,
    setVehicleId: setGlobalVehicleId,
  } = useSelectedVehicle();
  const [vehicleId, setVehicleId] = useState<string>(
    globalVehicleId == null ? 'all' : String(globalVehicleId),
  );
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const createAccount = useCreateAccountExport();

  useEffect(() => {
    setVehicleId(globalVehicleId == null ? 'all' : String(globalVehicleId));
  }, [globalVehicleId]);

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
    const payload: { vehicle_id?: number; start?: string; end?: string } = {};
    if (vehicleId !== 'all') {
      const id = Number(vehicleId);
      if (!Number.isNaN(id)) payload.vehicle_id = id;
    }
    if (startDate) payload.start = new Date(startDate).toISOString();
    if (endDate) payload.end = new Date(endDate).toISOString();
    createAccount.mutate(payload);
  }, [vehicleId, startDate, endDate, createAccount]);

  const vehicleOptions = useMemo(
    () => [
      { value: 'all', label: t('dataExport.account.allVehicles', 'All vehicles') },
      ...(vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin || `Vehicle ${v.id}`,
      })),
    ],
    [vehicles, t],
  );

  return (
    <GlassPanel className="p-4 sm:p-5 lg:p-6" glow="cyan">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-lg bg-cyan-400/10 p-2">
          <Icons.package className="h-5 w-5 text-cyan-300" aria-hidden="true" />
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
        />
        <Input
          label={t('dataExport.account.startDate', 'Start date (optional)')}
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label={t('dataExport.account.endDate', 'End date (optional)')}
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-3 sm:flex-row sm:items-center sm:justify-between">
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
          loading={createAccount.isPending}
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

  usePageTitle(t('dataExport.title', 'Data Export'));

  /* --- Queries --- */

  const {
    data: jobs,
    isLoading: jobsLoading,
    error: jobsError,
  } = useQuery<ExportJobSummary[]>({
    queryKey: ['export-jobs'],
    queryFn: () => request<ExportJobSummary[]>('/export/jobs'),
    refetchInterval: 10_000,
  });

  const { data: vehicles } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  /* --- Mutations --- */

  const submitExport = useMutation({
    mutationFn: (payload: ExportSubmitPayload) =>
      request<ExportJobSummary>('/export/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success(t('Export Started'), t('Export Started Msg'));
      queryClient.invalidateQueries({ queryKey: ['export-jobs'] });
    },
    onError: () => {
      toast.error(t('Export Failed'), t('Export Failed Msg'));
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
    <PageContainer
      title={t('dataExport.title', 'Data Export')}
      subtitle={t('dataExport.subtitle', 'Export vehicle data in CSV or JSON format')}
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.refresh className="h-4 w-4" aria-hidden="true" />}
          onClick={handleRefresh}
        >
          {t('dataExport.refresh', 'Refresh')}
        </Button>
      }
    >
      {/* Non-blocking load error — the History panel below also renders its
          own QueryError so each section stays self-sufficient. */}
      {jobsError && (
        <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('dataExport.loadError', 'Failed to load export jobs')}
        </AlertBanner>
      )}

      {/* 1 — KPI band */}
      <FadeIn>
        <section aria-label={t('dataExport.stats.aria', 'Export summary metrics')}>
          <StatsRow jobs={jobs} isLoading={jobsLoading} />
        </section>
      </FadeIn>

      {/* 2 — Primary bento: export wizard (hero) + context rail */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('dataExport.create.aria', 'Create a new export')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="xl:col-span-2">
            <ExportWizard
              vehicles={vehicles}
              onSubmit={handleSubmit}
              isPending={submitExport.isPending}
            />
          </div>
          <div className="space-y-4 xl:col-span-1">
            <DataOverviewCard overview={dataOverview} isLoading={jobsLoading} />
            <FormatInfoCards />
          </div>
        </section>
      </FadeIn>

      {/* 3 — GDPR-style "Download my data" full-width band */}
      <FadeIn delay={0.1}>
        <section aria-label={t('dataExport.account.aria', 'Full account export')}>
          <AccountExportPanel vehicles={vehicles} />
        </section>
      </FadeIn>

      {/* 4 — Export history detail band */}
      <FadeIn delay={0.15}>
        <section aria-label={t('dataExport.history.aria', 'Export history')}>
          <ExportHistoryTable
            jobs={jobs}
            isLoading={jobsLoading}
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
    </PageContainer>
  );
}
