import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  FileSpreadsheet,
  FileJson,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  BarChart3,
  Car,
  Database,
  FileDown,
  Package,
  RefreshCw,
  Zap,
  AlertCircle,
  Battery,
  Wrench,
  HardDrive,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/cn';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useToast } from '@/components/feedback/Toast';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { request } from '@/api/client';
import type { Vehicle } from '@/api/types';

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
  icon: typeof Car;
  descKey: string;
  color: string;
}[] = [
  { value: 'drives', labelKey: 'dataExport.types.drives', icon: Car, descKey: 'dataExport.types.drivesDesc', color: 'cyan' },
  { value: 'charging', labelKey: 'dataExport.types.charging', icon: Zap, descKey: 'dataExport.types.chargingDesc', color: 'green' },
  { value: 'analytics', labelKey: 'dataExport.types.analytics', icon: BarChart3, descKey: 'dataExport.types.analyticsDesc', color: 'purple' },
  { value: 'full_backup', labelKey: 'dataExport.types.fullBackup', icon: Database, descKey: 'dataExport.types.fullBackupDesc', color: 'amber' },
  { value: 'maintenance', labelKey: 'dataExport.types.maintenance', icon: Wrench, descKey: 'dataExport.types.maintenanceDesc', color: 'red' },
  { value: 'energy', labelKey: 'dataExport.types.energy', icon: Battery, descKey: 'dataExport.types.energyDesc', color: 'green' },
];

const EXPORT_FORMATS: { value: ExportFormat; labelKey: string; icon: typeof FileSpreadsheet; descKey: string }[] = [
  { value: 'csv', labelKey: 'dataExport.formats.csv', icon: FileSpreadsheet, descKey: 'dataExport.formats.csvDesc' },
  { value: 'json', labelKey: 'dataExport.formats.json', icon: FileJson, descKey: 'dataExport.formats.jsonDesc' },
];

const DATE_PRESETS: { labelKey: string; days: number }[] = [
  { labelKey: 'dataExport.presets.last7', days: 7 },
  { labelKey: 'dataExport.presets.last30', days: 30 },
  { labelKey: 'dataExport.presets.last90', days: 90 },
  { labelKey: 'dataExport.presets.lastYear', days: 365 },
  { labelKey: 'dataExport.presets.allTime', days: 0 },
];

const STATUS_CONFIG: Record<ExportStatus, {
  icon: typeof Clock;
  badgeVariant: 'neutral' | 'info' | 'success' | 'danger' | 'warning';
  labelKey: string;
  spinning?: boolean;
}> = {
  queued: { icon: Clock, badgeVariant: 'neutral', labelKey: 'dataExport.status.queued' },
  processing: { icon: Loader2, badgeVariant: 'info', labelKey: 'dataExport.status.processing', spinning: true },
  ready: { icon: CheckCircle2, badgeVariant: 'success', labelKey: 'dataExport.status.ready' },
  failed: { icon: XCircle, badgeVariant: 'danger', labelKey: 'dataExport.status.failed' },
  expired: { icon: AlertCircle, badgeVariant: 'warning', labelKey: 'dataExport.status.expired' },
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

function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function formatDuration(ms: number | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${Math.round(sec % 60)}s`;
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
              'p-4 text-left transition-all duration-200 cursor-pointer border-2 rounded-xl',
              active
                ? 'border-white/30'
                : 'border-transparent hover:border-white/10',
            )}
            style={active ? { borderColor: `var(--neon-${et.color})` } : undefined}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div
                className={cn(
                  'p-1.5 rounded-lg',
                  active ? 'bg-white/10' : 'bg-white/5',
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
                {t(et.labelKey)}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
              {t(et.descKey)}
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
            {t(f.labelKey)}
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
            {t(p.labelKey)}
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
      {t(cfg.labelKey)}
    </Badge>
  );
}

function TypeBadge({ type }: { type: ExportType }) {
  const { t } = useTranslation();
  const variant = TYPE_BADGE_VARIANT[type] ?? 'neutral';
  const cfg = EXPORT_TYPES.find((et) => et.value === type);
  return (
    <Badge variant={variant} size="sm">
      {cfg ? t(cfg.labelKey) : type}
    </Badge>
  );
}

function FormatBadge({ format }: { format: ExportFormat }) {
  return (
    <Badge variant={format === 'csv' ? 'info' : 'warning'} size="sm">
      {format === 'csv' && <FileSpreadsheet className="h-3 w-3" />}
      {format === 'json' && <FileJson className="h-3 w-3" />}
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
          <FileSpreadsheet className="h-5 w-5 text-neon-cyan" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Csv Title')}
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          {t('Csv Desc')}
        </p>
        <div className="rounded-lg bg-black/20 p-3 font-mono text-[11px] text-[var(--text-muted)]">
          <p>date,distance_km,efficiency</p>
          <p>2025-01-15,45.2,152</p>
          <p>2025-01-16,32.8,148</p>
        </div>
      </GlassPanel>

      <GlassPanel className="p-4" hover glow="purple">
        <div className="flex items-center gap-2 mb-3">
          <FileJson className="h-5 w-5 text-neon-purple" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Json Title')}
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          {t('Json Desc')}
        </p>
        <div className="rounded-lg bg-black/20 p-3 font-mono text-[11px] text-[var(--text-muted)]">
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
        <Database className="h-4 w-4 text-neon-cyan" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {t('Title')}
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
            <Car className="h-3.5 w-3.5 text-neon-cyan" />
            <span>{fmtInt(overview.drives)} {t('Drives')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Zap className="h-3.5 w-3.5 text-neon-green" />
            <span>{fmtInt(overview.charging_sessions)} {t('Charging Sessions')}</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">{t('Unavailable')}</p>
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
        icon={<Package className="h-4 w-4" />}
        color="cyan"
      />
      <MetricCard
        label={t('Total Size')}
        value={formatFileSize(totalSize)}
        icon={<HardDrive className="h-4 w-4" />}
        color="blue"
      />
      <MetricCard
        label={t('Most Exported')}
        value={mostExportedType}
        icon={<BarChart3 className="h-4 w-4" />}
        color="purple"
        subtitle={t('By Count')}
      />
      <MetricCard
        label={t('Last Export')}
        value={lastExport}
        icon={<Clock className="h-4 w-4" />}
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
    onSubmit(payload);
  }, [exportType, exportFormat, vehicleId, presetDays, customStart, customEnd, useCustomRange, onSubmit]);

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
        <FileDown className="h-5 w-5 text-neon-cyan" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          {t('Title')}
        </h2>
      </div>

      {/* Step 1: Export Type */}
      <div className="mb-5">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
          {t('dataExport.wizard.step1', 'Step1')}
        </p>
        <ExportTypeSelector selected={exportType} onChange={setExportType} />
      </div>

      {/* Step 2: Format */}
      <div className="mb-5">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
          {t('dataExport.wizard.step2', 'Step2')}
        </p>
        <FormatSelector selected={exportFormat} onChange={setExportFormat} />
      </div>

      {/* Step 3: Vehicle */}
      {vehicles && vehicles.length > 0 && (
        <div className="mb-5 max-w-xs">
          <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
            {t('dataExport.wizard.step3', 'Step3')}
          </p>
          <Select
            options={vehicleOptions}
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder={t('All Vehicles')}
          />
        </div>
      )}

      {/* Step 4: Date Range */}
      <div className="mb-6">
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
          {t('dataExport.wizard.step4', 'Step4')}
        </p>
        <DatePresetSelector selected={useCustomRange ? -1 : presetDays} onChange={handlePresetChange} />
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant={useCustomRange ? 'primary' : 'ghost'}
            size="sm"
            icon={<Calendar className="h-3.5 w-3.5" />}
            onClick={() => setUseCustomRange(!useCustomRange)}
          >
            {t('Custom Range')}
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
        icon={<Download className="h-4 w-4" />}
        onClick={handleSubmit}
      >
        {t('Start Export')}
      </Button>
    </GlassPanel>
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
            {formatFileSize(row.file_size)}
          </span>
        ),
      },
      {
        key: 'duration',
        header: t('Duration'),
        render: (row) => (
          <span className="text-xs text-[var(--text-muted)]">
            {formatDuration(row.duration_ms)}
          </span>
        ),
      },
      {
        key: 'time',
        header: t('Time'),
        sortable: true,
        render: (row) => (
          <span className="text-xs text-[var(--text-muted)]" title={formatDateTime(row.created_at)}>
            {formatRelative(row.created_at)}
          </span>
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
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() => onDownload(row)}
            >
              {t('Download')}
            </Button>
          ) : row.status === 'failed' && row.error_message ? (
            <span
              className="text-[11px] text-neon-red truncate max-w-[120px] inline-block"
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
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {t('Title')}
          </h2>
          {activeJobs > 0 && (
            <Badge variant="info" size="sm" dot>
              {activeJobs} {t('Active')}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRefresh}>
          {t('Refresh')}
        </Button>
      </div>

      {!jobs || jobs.length === 0 ? (
        <EmptyState
          icon={<FileDown className="h-10 w-10" />}
          title={t('Empty Title')}
          message={t('Empty Message')}
        />
      ) : (
        <DataTable
          columns={columns}
          data={jobs}
          keyExtractor={(row) => row.id}
          emptyMessage={t('No Jobs')}
          compact
        />
      )}
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

  usePageTitle(t('Page Title'));

  /* --- Queries --- */

  const {
    data: jobs,
    isLoading: jobsLoading,
    error: jobsError,
  } = useQuery<ExportJobSummary[]>({
    queryKey: ['exports'],
    queryFn: () => request<ExportJobSummary[]>('/exports'),
    refetchInterval: 10_000,
  });

  const { data: vehicles, isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  /* --- Mutations --- */

  const submitExport = useMutation({
    mutationFn: (payload: ExportSubmitPayload) =>
      request<ExportJobSummary>('/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success(t('Export Started'), t('Export Started Msg'));
      queryClient.invalidateQueries({ queryKey: ['exports'] });
    },
    onError: () => {
      toast.error(t('Export Failed'), t('Export Failed Msg'));
    },
  });

  /* --- Handlers --- */

  const handleDownload = useCallback((job: ExportJobSummary) => {
    window.open(`/api/v1/exports/${job.id}/download`, '_blank');
  }, []);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['exports'] });
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
      title={t('Page Title')}
      subtitle={t('Page Subtitle')}
      loading={isLoading}
      error={jobsError as Error | null}
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className="h-4 w-4" />}
          onClick={handleRefresh}
        >
          {t('Refresh')}
        </Button>
      }
    >
      {/* Stats */}
      <FadeIn>
        <StatsRow jobs={jobs} isLoading={jobsLoading} />
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
    </PageContainer>
  );
}
