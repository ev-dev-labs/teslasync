import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getVehicles,
  getExportJobs,
  submitExportJob,
  getExportJobDownloadUrl,
  getDrives,
  getChargingSessions,
} from '../api'
import type { ExportJobSummary, ExportJobSubmitRequest } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, StatCard, Badge, Button, MetricCard, Select, Input } from '../components/ui'
import { useToast } from '../components/Toast'
import {
  Download,
  FileSpreadsheet,
  FileJson,
  MapPin,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  HardDrive,
  BarChart3,
  Car,
  Calendar,
  Database,
  FileDown,
  Package,
  Info,
  RefreshCw,
  Zap,
  Activity,
} from 'lucide-react'
import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'
import { usePageTitle } from '../hooks/usePageTitle'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EXPORT_TYPES = [
  { value: 'drives', label: 'Drives', description: 'All drive records with distance, duration, and efficiency', icon: Car, color: 'cyan' },
  { value: 'charging', label: 'Charging', description: 'All charging sessions with energy added and costs', icon: Zap, color: 'green' },
  { value: 'analytics', label: 'Analytics', description: 'Aggregated analytics and efficiency statistics', icon: BarChart3, color: 'purple' },
  { value: 'backup', label: 'Full Backup', description: 'Complete data export for backup or migration', icon: Database, color: 'amber' },
] as const

type ExportType = (typeof EXPORT_TYPES)[number]['value']

const EXPORT_FORMATS = [
  { value: 'csv', label: 'CSV', description: 'Spreadsheet-compatible', icon: FileSpreadsheet },
  { value: 'json', label: 'JSON', description: 'Structured data', icon: FileJson },
] as const

type ExportFormat = (typeof EXPORT_FORMATS)[number]['value']

const DATE_PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last Year', days: 365 },
  { label: 'All Time', days: 0 },
] as const



/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatFileSize(bytes: number): string {
  usePageTitle('Data Export')
  if (!bytes || bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return formatDateTime(dateStr)
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const TYPE_BADGE_COLORS: Record<string, 'cyan' | 'green' | 'purple' | 'amber' | 'neutral'> = {
  drives: 'cyan',
  charging: 'green',
  analytics: 'purple',
  backup: 'amber',
  import_drives: 'cyan',
  import_charging: 'green',
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_BADGE_COLORS[type] || 'neutral'
  const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return <Badge color={color}>{label}</Badge>
}

function FormatBadge({ format }: { format: string }) {
  return (
    <Badge color={format === 'csv' ? 'blue' : 'amber'}>
      {format === 'csv' && <FileSpreadsheet className="h-3 w-3" />}
      {format === 'json' && <FileJson className="h-3 w-3" />}
      {format.toUpperCase()}
    </Badge>
  )
}

function StatusIndicator({ status }: { status: ExportJobSummary['status'] }) {
  switch (status) {
    case 'queued':
      return <Badge color="amber"><Loader2 className="h-3 w-3 animate-spin" /> Queued</Badge>
    case 'processing':
      return <Badge color="cyan"><Loader2 className="h-3 w-3 animate-spin" /> Processing</Badge>
    case 'ready':
      return <Badge color="green"><CheckCircle2 className="h-3 w-3" /> Ready</Badge>
    case 'failed':
      return <Badge color="red"><XCircle className="h-3 w-3" /> Failed</Badge>
    default:
      return <Badge color="neutral">{status}</Badge>
  }
}

function ExportTypeSelector({
  selected,
  onChange,
}: {
  selected: ExportType
  onChange: (t: ExportType) => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {EXPORT_TYPES.map(t => {
        const Icon = t.icon
        const active = selected === t.value
        return (
          <GlassPanel
            key={t.value}
            onClick={() => onChange(t.value)}
            className={clsx(
              'p-4 text-left transition-all duration-200 cursor-pointer border-2 rounded-xl',
              active
                ? `border-neon-${t.color} shadow-[0_0_20px_rgba(var(--neon-${t.color}-rgb),0.15)]`
                : 'border-transparent hover:border-white/10'
            )}
            style={active ? { borderColor: `var(--neon-${t.color})` } : undefined}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div
                className={clsx(
                  'p-1.5 rounded-lg',
                  active ? `bg-neon-${t.color}/20` : 'bg-white/5'
                )}
                style={active ? { background: `color-mix(in srgb, var(--neon-${t.color}) 15%, transparent)` } : undefined}
              >
                <Icon className={clsx('h-4 w-4', active ? `text-neon-${t.color}` : 'text-[var(--text-muted)]')} />
              </div>
              <span
                className={clsx('text-sm font-semibold', active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}
              >
                {t.label}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {t.description}
            </p>
          </GlassPanel>
        )
      })}
    </div>
  )
}

function FormatSelector({
  selected,
  onChange,
}: {
  selected: ExportFormat
  onChange: (f: ExportFormat) => void
}) {
  return (
    <div className="flex gap-2">
      {EXPORT_FORMATS.map(f => {
        const Icon = f.icon
        const active = selected === f.value
        return (
          <button
            key={f.value}
            onClick={() => onChange(f.value)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-all duration-200 cursor-pointer',
              active
                ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                : 'border-white/10 bg-white/5 text-[var(--text-secondary)] hover:border-white/20'
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="text-sm font-medium">{f.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function DatePresetSelector({
  selected,
  onChange,
}: {
  selected: number
  onChange: (days: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {DATE_PRESETS.map(p => {
        const active = selected === p.days
        return (
          <button
            key={p.days}
            onClick={() => onChange(p.days)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer border',
              active
                ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                : 'border-white/10 bg-white/5 text-[var(--text-muted)] hover:border-white/20 hover:text-[var(--text-secondary)]'
            )}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

function JobRow({
  job,
  onDownload,
}: {
  job: ExportJobSummary
  onDownload: (job: ExportJobSummary) => void
}) {
  return (
    <GlassPanel
      className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 transition-all duration-200 hover:border-white/10"
      style={{ borderColor: 'var(--glass-border)' }}
    >
      {/* Type + Format */}
      <div className="flex items-center gap-2 sm:w-48 shrink-0">
        <TypeBadge type={job.type} />
        <FormatBadge format={job.format} />
      </div>

      {/* Status */}
      <div className="sm:w-28 shrink-0">
        <StatusIndicator status={job.status} />
      </div>

      {/* Details */}
      <div className="flex-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        {job.record_count > 0 && (
          <span className="flex items-center gap-1">
            <Database className="h-3 w-3" />
            {job.record_count.toLocaleString()} records
          </span>
        )}
        {job.file_size > 0 && (
          <span className="flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            {formatFileSize(job.file_size)}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {relativeTime(job.created_at)}
        </span>
      </div>

      {/* Error message */}
      {job.status === 'failed' && job.error_message && (
        <p className="text-[11px] text-neon-red/80 sm:hidden">{job.error_message}</p>
      )}

      {/* Actions */}
      <div className="sm:w-24 shrink-0 flex justify-end">
        {job.status === 'ready' ? (
          <Button variant="secondary" size="sm" onClick={() => onDownload(job)} icon={<Download className="h-3.5 w-3.5" />}>
            Download
          </Button>
        ) : job.status === 'failed' ? (
          <span className="text-[10px] text-neon-red/60 max-w-[120px] truncate hidden sm:inline" title={job.error_message}>
            {job.error_message || 'Export failed'}
          </span>
        ) : (
          <span className="text-[10px] text-[var(--text-muted)] italic">In progress…</span>
        )}
      </div>
    </GlassPanel>
  )
}

function FormatInfoCard({
  icon: Icon,
  title,
  description,
  useCases,
  color,
}: {
  icon: React.ElementType
  title: string
  description: string
  useCases: string[]
  color: string
}) {
  return (
    <GlassPanel className="p-5 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className={clsx('p-2 rounded-lg', `bg-${color}/15`)} style={{ background: `color-mix(in srgb, var(--neon-cyan) 10%, transparent)` }}>
          <Icon className={clsx('h-5 w-5', `text-${color}`)} style={{ color: `var(--neon-cyan)` }} />
        </div>
        <h4 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h4>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {description}
      </p>
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {useCases.map(uc => (
          <span
            key={uc}
            className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10"
            style={{ color: 'var(--text-muted)' }}
          >
            {uc}
          </span>
        ))}
      </div>
    </GlassPanel>
  )
}

function DataOverviewCard({
  icon: Icon,
  label,
  value,
  sublabel,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sublabel?: string
}) {
  return (
    <MetricCard
      label={label}
      value={value}
      icon={<Icon className="h-4 w-4" />}
      color="cyan"
      subtitle={sublabel}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function DataExport() {
  const queryClient = useQueryClient()
  const { success, error: showError } = useToast()

  /* ---- Form state ---- */
  const [selectedType, setSelectedType] = useState<ExportType>('drives')
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('csv')
  const [selectedVehicle, setSelectedVehicle] = useState<string>('all')
  const [datePreset, setDatePreset] = useState<number>(0)
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [showCustomDates, setShowCustomDates] = useState(false)
  const [showAllJobs, setShowAllJobs] = useState(false)

  /* ---- Queries ---- */
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: getVehicles,
  })

  const {
    data: jobs,
    isLoading: loadingJobs,
    refetch: refetchJobs,
  } = useQuery({
    queryKey: ['export-jobs'],
    queryFn: () => getExportJobs(100, 0),
    refetchInterval: 5000,
  })

  const { data: drives } = useQuery({
    queryKey: ['drives-count'],
    queryFn: () => getDrives(1, 1),
  })

  const { data: chargingSessions } = useQuery({
    queryKey: ['charging-count'],
    queryFn: () => getChargingSessions(1, 1),
  })

  /* ---- Export mutation ---- */
  const exportMutation = useMutation({
    mutationFn: (data: ExportJobSubmitRequest) => submitExportJob(data),
    onSuccess: (resp) => {
      success('Export Started', `Job ${resp.id.slice(0, 8)}… is ${resp.status}`)
      queryClient.invalidateQueries({ queryKey: ['export-jobs'] })
    },
    onError: (err: Error) => {
      showError('Export Failed', err.message || 'Could not start export. Please try again.')
    },
  })

  /* ---- Computed values ---- */
  const sortedJobs = useMemo(() => {
    if (!jobs) return []
    return [...jobs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }, [jobs])

  const displayedJobs = showAllJobs ? sortedJobs : sortedJobs.slice(0, 10)

  const stats = useMemo(() => {
    if (!jobs || jobs.length === 0)
      return { total: 0, totalSize: 0, mostExportedType: '—', lastExport: '—' }

    const total = jobs.length
    const totalSize = jobs.reduce((sum, j) => sum + (j.file_size || 0), 0)

    const typeCounts: Record<string, number> = {}
    for (const j of jobs) {
      typeCounts[j.type] = (typeCounts[j.type] || 0) + 1
    }
    const mostExportedType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—'

    const lastExport = jobs.length > 0
      ? formatDateTime(
          [...jobs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )[0].created_at
        )
      : '—'

    return { total, totalSize, mostExportedType, lastExport }
  }, [jobs])

  const activeJobCount = useMemo(
    () => (jobs ?? []).filter(j => j.status === 'queued' || j.status === 'processing').length,
    [jobs]
  )

  /* ---- Handlers ---- */
  const handleExport = () => {
    let startDate: string | undefined
    let endDate: string | undefined

    if (showCustomDates && customStartDate) {
      startDate = customStartDate
      endDate = customEndDate || undefined
    } else if (datePreset > 0) {
      startDate = daysAgo(datePreset)
    }

    exportMutation.mutate({
      type: selectedType,
      format: selectedFormat,
      vehicle_id: selectedVehicle === 'all' ? undefined : Number(selectedVehicle),
      start: startDate,
      end: endDate,
    })
  }

  const handleDownload = (job: ExportJobSummary) => {
    const url = getExportJobDownloadUrl(job.id)
    window.open(url, '_blank')
  }

  const handleDatePreset = (days: number) => {
    setDatePreset(days)
    setShowCustomDates(false)
    setCustomStartDate('')
    setCustomEndDate('')
  }

  /* ---- Render ---- */
  return (
    <FadeIn>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Data Export"
          subtitle="Export your vehicle data in CSV or JSON format for analysis, backup, or migration"
          icon={<FileDown className="h-7 w-7 text-neon-cyan" />}
        />

        {activeJobCount > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-neon-cyan/30 bg-neon-cyan/5">
            <Loader2 className="h-3.5 w-3.5 text-neon-cyan animate-spin" />
            <span className="text-xs font-medium text-neon-cyan">
              {activeJobCount} export{activeJobCount > 1 ? 's' : ''} in progress
            </span>
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/*  Section 1: New Export Panel                                       */}
      {/* ================================================================ */}
      <GlassPanel className="p-5 sm:p-7 mb-6 sm:mb-8" glow="cyan">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="p-2 rounded-lg bg-neon-cyan/15">
            <Package className="h-5 w-5 text-neon-cyan" />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Create New Export
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Choose what data to export and in which format
            </p>
          </div>
        </div>

        {/* Export Type */}
        <div className="mb-5">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
            Export Type
          </label>
          <ExportTypeSelector selected={selectedType} onChange={setSelectedType} />
        </div>

        {/* Format */}
        <div className="mb-5">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
            Format
          </label>
          <FormatSelector selected={selectedFormat} onChange={setSelectedFormat} />
        </div>

        {/* Vehicle + Date Range row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
          {/* Vehicle selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
              Vehicle
            </label>
            <div className="relative">
              <Select
                value={selectedVehicle}
                onChange={e => setSelectedVehicle(e.target.value)}
                options={[
                  { value: 'all', label: 'All Vehicles' },
                  ...(vehicles?.map(v => ({ value: String(v.id), label: v.display_name || v.vin })) ?? []),
                ]}
                className="w-full"
              />
            </div>
          </div>

          {/* Date Range */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>
              Date Range
            </label>
            <DatePresetSelector selected={showCustomDates ? -1 : datePreset} onChange={handleDatePreset} />
            <button
              onClick={() => {
                setShowCustomDates(!showCustomDates)
                if (!showCustomDates) setDatePreset(-1)
              }}
              className="mt-2 text-[11px] text-neon-cyan/70 hover:text-neon-cyan transition-colors cursor-pointer"
            >
              {showCustomDates ? '← Back to presets' : 'Custom date range →'}
            </button>
            {showCustomDates && (
              <div className="flex gap-3 mt-2">
                <Input
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  className="text-xs"
                  style={{ colorScheme: 'dark' }}
                  placeholder="Start date"
                />
                <span className="text-[var(--text-muted)] self-center text-xs">to</span>
                <Input
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  className="text-xs"
                  style={{ colorScheme: 'dark' }}
                  placeholder="End date"
                />
              </div>
            )}
          </div>
        </div>

        {/* Export Button */}
        <Button
          variant="primary"
          size="lg"
          onClick={handleExport}
          loading={exportMutation.isPending}
          icon={<Download className="h-4.5 w-4.5" />}
          className="w-full sm:w-auto"
        >
          {exportMutation.isPending ? 'Starting Export…' : 'Start Export'}
        </Button>
      </GlassPanel>

      {/* ================================================================ */}
      {/*  Section 2: Export Stats Cards                                     */}
      {/* ================================================================ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {loadingJobs ? (
          [1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              label="Total Exports"
              value={stats.total}
              icon={<Package className="h-5 w-5" />}
              color="cyan"
            />
            <StatCard
              label="Data Exported"
              value={formatFileSize(stats.totalSize)}
              icon={<HardDrive className="h-5 w-5" />}
              color="green"
            />
            <StatCard
              label="Most Exported"
              value={stats.mostExportedType.charAt(0).toUpperCase() + stats.mostExportedType.slice(1)}
              icon={<BarChart3 className="h-5 w-5" />}
              color="purple"
            />
            <StatCard
              label="Last Export"
              value={stats.lastExport}
              icon={<Calendar className="h-5 w-5" />}
              color="amber"
            />
          </>
        )}
      </div>

      {/* ================================================================ */}
      {/*  Section 3: Export History / Jobs List                             */}
      {/* ================================================================ */}
      <GlassPanel className="p-5 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <Clock className="h-5 w-5 text-neon-cyan" />
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Export History
            </h3>
            {sortedJobs.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10" style={{ color: 'var(--text-muted)' }}>
                {sortedJobs.length} job{sortedJobs.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetchJobs()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
            Refresh
          </Button>
        </div>

        {loadingJobs ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : sortedJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-2xl bg-white/5 mb-4">
              <FileDown className="h-10 w-10 text-[var(--text-muted)]" />
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
              No exports yet
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Create your first export above to download your vehicle data.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              {displayedJobs.map(job => (
                <JobRow key={job.id} job={job} onDownload={handleDownload} />
              ))}
            </div>

            {sortedJobs.length > 10 && (
              <button
                onClick={() => setShowAllJobs(!showAllJobs)}
                className="mt-4 w-full py-2 text-xs font-medium text-neon-cyan/70 hover:text-neon-cyan transition-colors cursor-pointer text-center"
              >
                {showAllJobs
                  ? `Show less (${sortedJobs.length - 10} hidden)`
                  : `Show all ${sortedJobs.length} exports`}
              </button>
            )}
          </>
        )}
      </GlassPanel>

      {/* ================================================================ */}
      {/*  Section 4: Export Format Info Panel                               */}
      {/* ================================================================ */}
      <GlassPanel className="p-5 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center gap-2.5 mb-5">
          <Info className="h-5 w-5 text-neon-cyan" />
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Export Formats
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormatInfoCard
            icon={FileSpreadsheet}
            title="CSV — Comma-Separated Values"
            description="Spreadsheet-compatible format. Open directly in Excel, Google Sheets, LibreOffice, or any data analysis tool. Each row represents a record with columns for all fields."
            useCases={['Excel', 'Google Sheets', 'Pandas', 'R', 'Tableau']}
            color="neon-cyan"
          />
          <FormatInfoCard
            icon={FileJson}
            title="JSON — JavaScript Object Notation"
            description="Structured data format with nested objects and arrays. Ideal for developers building custom integrations, importing into databases, or programmatic analysis."
            useCases={['APIs', 'Databases', 'Custom Tools', 'Python', 'Node.js']}
            color="neon-cyan"
          />
        </div>

        <div className="mt-4 p-3 rounded-lg bg-white/[0.03] border border-white/5 flex items-start gap-2.5">
          <MapPin className="h-4 w-4 text-neon-green shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              GPS Data Tip
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Export drives as JSON to get full GPS coordinate data. You can then convert to GPX format
              using free tools like{' '}
              <span className="text-neon-cyan">gpx.studio</span> for import into Google Earth, Strava,
              or other mapping applications.
            </p>
          </div>
        </div>
      </GlassPanel>

      {/* ================================================================ */}
      {/*  Section 5: Data Overview                                         */}
      {/* ================================================================ */}
      <GlassPanel className="p-5 sm:p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <Activity className="h-5 w-5 text-neon-cyan" />
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            Data Overview
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Available data for export
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <DataOverviewCard
            icon={Car}
            label="Total Drives"
            value={drives?.length?.toLocaleString() ?? '—'}
            sublabel="Drive records available"
          />
          <DataOverviewCard
            icon={Zap}
            label="Charging Sessions"
            value={chargingSessions?.length?.toLocaleString() ?? '—'}
            sublabel="Charge sessions recorded"
          />
          <DataOverviewCard
            icon={Database}
            label="Vehicles"
            value={vehicles?.length?.toLocaleString() ?? '—'}
            sublabel="Tracked vehicles"
          />
          <DataOverviewCard
            icon={Calendar}
            label="Data Since"
            value={
              drives && drives.length > 0
                ? new Date(drives[drives.length - 1]?.start_date ?? '').toLocaleDateString(undefined, {
                    month: 'short',
                    year: 'numeric',
                  })
                : '—'
            }
            sublabel="First recorded data"
          />
        </div>

        {/* Estimated sizes info */}
        <div className="mt-5 p-4 rounded-xl bg-white/[0.02] border border-white/5">
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
            Estimated Export Sizes
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { type: 'Drives', estimate: '~1 KB per drive', icon: Car },
              { type: 'Charging', estimate: '~0.5 KB per session', icon: Zap },
              { type: 'Analytics', estimate: '~5 KB per report', icon: BarChart3 },
              { type: 'Full Backup', estimate: 'Varies by data volume', icon: Database },
            ].map(item => (
              <div key={item.type} className="flex items-center gap-2.5">
                <item.icon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <div>
                  <p className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {item.type}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {item.estimate}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Export tips */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-neon-cyan/5 border border-neon-cyan/10">
            <p className="text-[11px] font-semibold text-neon-cyan mb-1">💡 Tip: Large Exports</p>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Full backup exports run in the background. You&apos;ll be able to download once processing completes.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-neon-green/5 border border-neon-green/10">
            <p className="text-[11px] font-semibold text-neon-green mb-1">📊 Tip: Analysis</p>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              CSV exports open directly in Excel or Google Sheets for quick data analysis and charting.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-neon-purple/5 border border-neon-purple/10">
            <p className="text-[11px] font-semibold text-neon-purple mb-1">🔄 Tip: Automation</p>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Use JSON format with the API to build automated data pipelines and integrations.
            </p>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
