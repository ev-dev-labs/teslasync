import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/numberFormat';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { TimeStamp } from '@/components/data-display';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useToast } from '@/components/feedback/Toast';
import { formatDurationMsLong, formatRelative } from '@/lib/dateFormat';
import { request } from '@/api/client';
import { useCreateAccountExport, useExportColumns } from '@/api/hooks/useExports';
import { JobProgressDrawer } from '@/components/feedback/JobProgressDrawer';
import type { Vehicle } from '@/api/types';
import { Icons } from '@/lib/icons';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ExportType = 'drives' | 'charging' | 'analytics' | 'full_backup' | 'maintenance' | 'energy';
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
  /** Phase-46/62 — caller-supplied column allowlist. Omitted when the
   *  user kept the default selection (every column) so the backend
   *  preserves byte-for-byte legacy behaviour. */
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
  color: string;
}[] = [
  { value: 'drives', labelKey: 'dataExport.types.drives', label: 'Drives', icon: Icons.vehicle, descKey: 'dataExport.types.drivesDesc', desc: 'Export drive sessions, routes, and efficiency data', color: 'cyan' },
  { value: 'charging', labelKey: 'dataExport.types.charging', label: 'Charging', icon: Icons.charging, descKey: 'dataExport.types.chargingDesc', desc: 'Export charging sessions and energy data', color: 'green' },
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

const TYPE_BADGE_VARIANT: Record<ExportType, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  drives: 'info',
  charging: 'success',
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
  return n.toLocaleString();
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {EXPORT_TYPES.map((et) => {
        const Icon = et.icon;
        const active = selected === et.value;
        return (
          <GlassPanel
            key={et.value}
            hover
            onClick={() => onChange(et.value)}
            className={cn(
              'p-4 text-left transition-all duration-normal cursor-pointer border-2 rounded-xl',
              active
                ? 'border-[var(--border-strong)]'
                : 'border-transparent hover:border-[var(--border-subtle)]',
            )}
            style={active ? { borderColor: `var(--neon-${et.color})` } : undefined}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div
                className={cn(
                  'p-1.5 rounded-lg',
                  active ? 'bg-[var(--surface-2)]' : 'bg-[var(--surface-2)]',
                )}
                style={active ? { background: `color-mix(in srgb, var(--neon-${et.color}) 15%, transparent)` } : undefined}
              >
                <Icon
                  className={cn('h-4 w-4', active ? 'text-white' : 'text-[var(--text-muted)]')}
                  style={active ? { color: `var(--neon-${et.color})` } : undefined}
                />
              </div>
              <span
                className={cn(
                  'text-sm font-semibold',
                  active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]',
                )}
              >
                {t(et.labelKey, et.label)}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              {t(et.descKey, et.desc)}
            </p>
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
    <div className="flex gap-3">
      {EXPORT_FORMATS.map((f) => {
        const Icon = f.icon;
        const active = selected === f.value;
        return (
          <Button
            key={f.value}
            variant={active ? 'primary' : 'outline'}
            size="md"
            icon={<Icon className="h-4 w-4" />}
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
    <div className="flex flex-wrap gap-2">
      {DATE_PRESETS.map((p) => {
        const active = selected === p.days;
        return (
          <Button
            key={p.days}
            size="sm"
            variant={active ? 'primary' : 'ghost'}
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
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.badgeVariant} size="sm">
      <Icon className={cn('h-3 w-3', cfg.spinning && 'animate-spin')} />
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
  return (
    <Badge variant={format === 'csv' ? 'info' : 'warning'} size="sm">
      {format === 'csv' && <Icons.fileSpreadsheet className="h-3 w-3" />}
      {format === 'json' && <Icons.fileJson className="h-3 w-3" />}
      {format.toUpperCase()}
    </Badge>
  );
}

function FormatInfoCards() {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <GlassPanel className="p-4" hover glow="cyan">
        <div className="flex items-center gap-2 mb-3">
          <Icons.fileSpreadsheet className="h-5 w-5 text-neon-cyan" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('dataExport.csvPreview', 'CSV Preview')}
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          {t('dataExport.csvDesc', 'Comma-separated values, compatible with Excel and Google Sheets')}
        </p>
        <div className="rounded-lg bg-[var(--surface-overlay)] p-3 font-mono text-[11px] text-[var(--text-muted)]">
          <p>date,distance_km,efficiency</p>
          <p>2025-01-15,45.2,152</p>
          <p>2025-01-16,32.8,148</p>
        </div>
      </GlassPanel>

      <GlassPanel className="p-4" hover glow="purple">
        <div className="flex items-center gap-2 mb-3">
          <Icons.fileJson className="h-5 w-5 text-neon-purple" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('dataExport.jsonPreview', 'JSON Preview')}
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          {t('dataExport.jsonDesc', 'Structured JSON format for programmatic access')}
        </p>
        <div className="rounded-lg bg-[var(--surface-overlay)] p-3 font-mono text-[11px] text-[var(--text-muted)]">
          <p>{`[{ "date": "2025-01-15",`}</p>
          <p>{`   "distance_km": 45.2,`}</p>
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
      <div className="flex items-center gap-2 mb-3">
        <Icons.database className="h-4 w-4 text-neon-cyan" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {t('dataExport.dataOverview', 'Data Overview')}
        </span>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      ) : overview ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Icons.vehicle className="h-3.5 w-3.5 text-neon-cyan" />
            <span>{fmtInt(overview.drives)} {t('dataExport.drives', 'Drives')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Icons.charging className="h-3.5 w-3.5 text-neon-green" />
            <span>{fmtInt(overview.charging_sessions)} {t('dataExport.chargingSessions', 'Charging Sessions')}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">{t('dataExport.unavailable', 'Unavailable')}</p>
      )}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom date range inputs                                           */
/* ------------------------------------------------------------------ */

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
    <div className="flex gap-3 items-end">
      <Input
        type="date"
        label={t('Start')}
        value={startDate}
        onChange={(e) => onStartChange(e.target.value)}
      />
      <Input
        type="date"
        label={t('End')}
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

  const totalSize = useMemo(() => {
    if (!jobs) return 0;
    return jobs.reduce((sum, j) => sum + (j.file_size ?? 0), 0);
  }, [jobs]);

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={80} rounded />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
  const [exportType, setExportType] = useState<ExportType>('drives');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [vehicleId, setVehicleId] = useState('');
  const [presetDays, setPresetDays] = useState(30);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [useCustomRange, setUseCustomRange] = useState(false);
  // Phase-46/62 — column allowlist state. `null` means "user has not
  // touched the picker; submit without `columns` so backend preserves
  // legacy byte-for-byte behaviour". A non-null value is the explicit
  // ordered allowlist the backend should honour.
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(null);

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
    <GlassPanel className="p-6" glow="cyan">
      <div className="flex items-center gap-2 mb-5">
        <Icons.fileDown className="h-5 w-5 text-neon-cyan" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {t('dataExport.wizardTitle', 'New Export')}
        </h2>
      </div>

      {/* Step 1: Export Type */}
      <div className="mb-5">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
          {t('dataExport.wizard.step1', 'STEP 1 — Select Data Type')}
        </p>
        <ExportTypeSelector selected={exportType} onChange={handleExportTypeChange} />
      </div>

      {/* Step 2: Format */}
      <div className="mb-5">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
          {t('dataExport.wizard.step2', 'STEP 2 — Choose Format')}
        </p>
        <FormatSelector selected={exportFormat} onChange={setExportFormat} />
      </div>

      {/* Step 2.5 (Phase-46/62): Columns — only when the catalog supports it */}
      <ColumnPickerSection
        exportType={exportType}
        selectedColumns={selectedColumns}
        onChange={setSelectedColumns}
      />

      {/* Step 3: Vehicle */}
      {vehicles && vehicles.length > 0 && (
        <div className="mb-5 max-w-xs">
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
            {t('dataExport.wizard.step3', 'STEP 3 — Select Vehicle')}
          </p>
          <Select
            options={vehicleOptions}
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder={t('dataExport.allVehicles', 'All Vehicles')}
          />
        </div>
      )}

      {/* Step 4: Date Range */}
      <div className="mb-6">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
          {t('dataExport.wizard.step4', 'STEP 4 — Date Range')}
        </p>
        <DatePresetSelector selected={useCustomRange ? -1 : presetDays} onChange={handlePresetChange} />
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant={useCustomRange ? 'primary' : 'ghost'}
            size="sm"
            icon={<Icons.calendar className="h-3.5 w-3.5" />}
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
        icon={<Icons.download className="h-4 w-4" />}
        onClick={handleSubmit}
      >
        {t('Start Export')}
      </Button>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Column Picker (Phase-46 / Prompt 62)                                */
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
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
          {t('dataExport.columns.title', 'STEP 2½ — Columns')}
        </p>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (isError || !data || !data.supports_selection || data.columns.length === 0) {
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
      <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
        {t('dataExport.columns.title', 'STEP 2½ — Columns')}
      </p>
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--text-secondary)]">
            {t(
              'dataExport.columns.helperText',
              'Select which columns to include in the export. Required columns cannot be removed.',
            )}
          </p>
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
              <label
                key={col.name}
                className={cn(
                  'flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-3 py-2 text-xs',
                  required ? 'opacity-70' : 'cursor-pointer hover:bg-[var(--surface-2)]',
                )}
                data-testid={`export-column-row-${col.name}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={required}
                  onChange={() => toggleColumn(col.name)}
                  aria-label={col.label}
                  data-testid={`export-column-checkbox-${col.name}`}
                />
                <span className="text-[var(--text-primary)]">{col.label}</span>
                {required ? (
                  <span className="ml-auto rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                    {t('dataExport.columns.alwaysIncluded', 'Required')}
                  </span>
                ) : null}
              </label>
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
  vehicles,
  onDownload,
  onRefresh,
}: {
  jobs: ExportJobSummary[] | undefined;
  isLoading: boolean;
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
          <span className="text-xs text-[var(--text-secondary)]">
            {row.vehicle_id ? vehicleMap.get(row.vehicle_id) ?? `#${row.vehicle_id}` : '—'}
          </span>
        ),
      },
      {
        key: 'records',
        header: t('Records'),
        sortable: true,
        render: (row) => (
          <span className="text-xs text-[var(--text-secondary)]">
            {row.record_count != null ? fmtInt(row.record_count) : '—'}
          </span>
        ),
      },
      {
        key: 'size',
        header: t('Size'),
        sortable: true,
        render: (row) => (
          <span className="text-xs text-[var(--text-secondary)]">
            {formatBytes(row.file_size, { zeroAsEmpty: true, gbDecimals: 2 })}
          </span>
        ),
      },
      {
        key: 'duration',
        header: t('Duration'),
        render: (row) => (
          <span className="text-xs text-[var(--text-muted)]">
            {formatDurationMsLong(row.duration_ms)}
          </span>
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
              icon={<Icons.download className="h-3.5 w-3.5" />}
              onClick={() => onDownload(row)}
            >
              {t('Download')}
            </Button>
          ) : row.status === 'failed' && row.error_message ? (
            <span
              className="text-[11px] text-rose-300 truncate max-w-[120px] inline-block"
              title={row.error_message}
            >
              {row.error_message}
            </span>
          ) : null,
      },
    ],
    [t, vehicleMap, onDownload],
  );

  if (isLoading) {
    return (
      <GlassPanel className="p-6">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </div>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-0 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('dataExport.exportHistory', 'Export History')}
          </h2>
          {activeJobs > 0 && (
            <Badge variant="info" size="sm" dot>
              {activeJobs} {t('dataExport.active', 'Active')}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" icon={<Icons.refresh className="h-3.5 w-3.5" />} onClick={onRefresh}>
          {t('dataExport.refresh', 'Refresh')}
        </Button>
      </div>

      {!jobs || jobs.length === 0 ? (
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
/*  Account Export Panel — Phase 40 / Prompt 31                        */
/* ------------------------------------------------------------------ */

interface AccountExportPanelProps {
  vehicles: Vehicle[] | undefined;
}

function AccountExportPanel({ vehicles }: AccountExportPanelProps) {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const createAccount = useCreateAccountExport();

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
    <GlassPanel className="p-6" glow="cyan">
      <div className="flex items-start gap-3 mb-4">
        <div className="rounded-lg bg-cyan-400/10 p-2">
          <Icons.package className="h-5 w-5 text-cyan-300" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {t('dataExport.account.title', 'Download my data')}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {t(
              'dataExport.account.subtitle',
              'Get a single ZIP containing every table we store for you — drives, charging, signal history, alerts, settings, and a manifest. Use this for backup, migration, or your personal records.',
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label
            htmlFor="account-export-vehicle"
            className="block text-xs font-medium text-[var(--text-muted)] mb-1"
          >
            {t('dataExport.account.vehicle', 'Vehicle')}
          </label>
          <Select
            id="account-export-vehicle"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            options={vehicleOptions}
          />
        </div>
        <div>
          <label
            htmlFor="account-export-start"
            className="block text-xs font-medium text-[var(--text-muted)] mb-1"
          >
            {t('dataExport.account.startDate', 'Start date (optional)')}
          </label>
          <Input
            id="account-export-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label
            htmlFor="account-export-end"
            className="block text-xs font-medium text-[var(--text-muted)] mb-1"
          >
            {t('dataExport.account.endDate', 'End date (optional)')}
          </label>
          <Input
            id="account-export-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-white/[0.06]">
        <div className="flex items-start gap-2 text-xs text-[var(--text-muted)]">
          <Icons.alertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'dataExport.account.warning',
              'Large signal histories are capped per table to keep the ZIP under control. Track progress in the floating widget that appears once your export starts.',
            )}
          </span>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={handleStart}
          loading={createAccount.isPending}
          icon={<Icons.download className="h-4 w-4" />}
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

  const { data: vehicles, isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
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
    window.open(`/api/v1/export/jobs/${job.id}/download`, '_blank');
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

  const isLoading = jobsLoading || vehiclesLoading;

  /* --- Render --- */

  return (
    <PageContainer
      title={t('dataExport.title', 'Data Export')}
      subtitle={t('dataExport.subtitle', 'Export vehicle data in CSV or JSON format')}
      loading={isLoading}
      error={jobsError as Error | null}
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.refresh className="h-4 w-4" />}
          onClick={handleRefresh}
        >
          {t('dataExport.refresh', 'Refresh')}
        </Button>
      }
    >
      {/* Stats */}
      <FadeIn>
        <StatsRow jobs={jobs} isLoading={jobsLoading} />
      </FadeIn>

      {/* GDPR-style "Download my data" — Phase 40 / Prompt 31 */}
      <FadeIn delay={0.025}>
        <AccountExportPanel vehicles={vehicles} />
      </FadeIn>

      {/* Export Wizard */}
      <FadeIn delay={0.05}>
        <ExportWizard
          vehicles={vehicles}
          onSubmit={handleSubmit}
          isPending={submitExport.isPending}
        />
      </FadeIn>

      {/* Format Info + Data Overview row */}
      <FadeIn delay={0.1}>
        <div className="space-y-4">
          <FormatInfoCards />
          <DataOverviewCard overview={dataOverview} isLoading={jobsLoading} />
        </div>
      </FadeIn>

      {/* Export History */}
      <FadeIn delay={0.15}>
        <ExportHistoryTable
          jobs={jobs}
          isLoading={jobsLoading}
          vehicles={vehicles}
          onDownload={handleDownload}
          onRefresh={handleRefresh}
        />
      </FadeIn>

      {/* Floating job progress drawer — visible across the page */}
      <JobProgressDrawer />
    </PageContainer>
  );
}
