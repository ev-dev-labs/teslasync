import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getBackupConfigs,
  createBackupConfig,
  updateBackupConfig,
  deleteBackupConfig,
  triggerBackup,
  triggerQuickBackup,
  getBackupRuns,
  downloadBackup,
  verifyBackup,
  previewRestore,
} from '../api'
import type { BackupConfig } from '../api'
import { PageHeader, GlassPanel, FadeIn, StatCard, ConfirmModal } from '../components/ui'
import { useToast } from '../components/Toast'
import {
  DatabaseBackup,
  Plus,
  Play,
  Trash2,
  Pencil,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  HardDrive,
  Cloud,
  FolderOpen,
  ToggleLeft,
  ToggleRight,
  X,
  Zap,
  Archive,
  Shield,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  Download,
  Lock,
  Eye,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PROVIDERS = [
  { value: 'local', label: 'Local', color: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
  { value: 's3', label: 'Amazon S3', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  { value: 'azure', label: 'Azure Blob', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  { value: 'gcs', label: 'Google Cloud', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
] as const

const PROVIDER_MAP: Record<string, (typeof PROVIDERS)[number]> = Object.fromEntries(PROVIDERS.map(p => [p.value, p]))

const BACKUP_TYPES = [
  { value: 'full', label: 'Full' },
  { value: 'incremental', label: 'Incremental' },
] as const

const FREQUENCY_OPTIONS = Array.from({ length: 30 }, (_, i) => ({
  value: i + 1,
  label: i === 0 ? 'Daily' : `Every ${i + 1} days`,
}))

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  completed: { icon: CheckCircle2, color: 'text-neon-green', bg: 'bg-neon-green/15', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-neon-red', bg: 'bg-neon-red/15', label: 'Failed' },
  running: { icon: Loader2, color: 'text-neon-cyan', bg: 'bg-neon-cyan/15', label: 'Running' },
  queued: { icon: Clock, color: 'text-gray-400', bg: 'bg-gray-500/15', label: 'Queued' },
}

const RUN_TYPE_COLORS: Record<string, string> = {
  backup: 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/30',
  restore: 'bg-neon-purple/15 text-neon-purple border-neon-purple/30',
  quick: 'bg-neon-amber/15 text-neon-amber border-neon-amber/30',
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return `${m}m ${rs}s`
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diffMs = now - date
  const isFuture = diffMs < 0
  const absDiff = Math.abs(diffMs)

  const minutes = Math.floor(absDiff / 60000)
  const hours = Math.floor(absDiff / 3600000)
  const days = Math.floor(absDiff / 86400000)

  if (minutes < 1) return isFuture ? 'in a moment' : 'just now'
  if (minutes < 60) return isFuture ? `in ${minutes}m` : `${minutes}m ago`
  if (hours < 24) return isFuture ? `in ${hours}h` : `${hours}h ago`
  return isFuture ? `in ${days}d` : `${days}d ago`
}

/* ------------------------------------------------------------------ */
/*  Empty form state                                                   */
/* ------------------------------------------------------------------ */

interface ConfigFormState {
  name: string
  enabled: boolean
  backup_type: string
  frequency_days: number
  max_retention: number
  provider: string
  provider_config: Record<string, string>
  compress: boolean
  encrypt: boolean
}

const EMPTY_FORM: ConfigFormState = {
  name: '',
  enabled: true,
  backup_type: 'full',
  frequency_days: 1,
  max_retention: 7,
  provider: 'local',
  provider_config: { path: '/backups' },
  compress: true,
  encrypt: false,
}

/* ------------------------------------------------------------------ */
/*  Provider Config Fields                                             */
/* ------------------------------------------------------------------ */

const PROVIDER_FIELDS: Record<string, { key: string; label: string; type?: string; required?: boolean; placeholder?: string }[]> = {
  local: [
    { key: 'path', label: 'Path', required: true, placeholder: '/backups' },
  ],
  s3: [
    { key: 'bucket', label: 'Bucket', required: true, placeholder: 'my-backup-bucket' },
    { key: 'region', label: 'Region', required: true, placeholder: 'us-east-1' },
    { key: 'access_key', label: 'Access Key', required: true },
    { key: 'secret_key', label: 'Secret Key', required: true, type: 'password' },
    { key: 'endpoint', label: 'Endpoint (optional)', placeholder: 'https://s3.amazonaws.com' },
  ],
  azure: [
    { key: 'account_name', label: 'Account Name', required: true },
    { key: 'account_key', label: 'Account Key', required: true, type: 'password' },
    { key: 'container_name', label: 'Container Name', required: true },
  ],
  gcs: [
    { key: 'bucket', label: 'Bucket', required: true, placeholder: 'my-backup-bucket' },
    { key: 'credentials_json', label: 'Credentials JSON', required: true, type: 'textarea' },
  ],
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BackupRestore() {
  const queryClient = useQueryClient()
  const toast = useToast()

  // State
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ConfigFormState>(EMPTY_FORM)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: number; name: string }>({ open: false, id: 0, name: '' })
  const [verifyResults, setVerifyResults] = useState<Record<number, { verified: boolean; error?: string; checksum?: string } | 'loading'>>({})
  const [previewModal, setPreviewModal] = useState<{
    open: boolean
    runId: number | null
    loading: boolean
    data: { tables: { name: string; rows: number }[]; metadata: Record<string, unknown>; checksum_verified: boolean } | null
  }>({ open: false, runId: null, loading: false, data: null })

  // Queries
  const { data: configs, isLoading: configsLoading } = useQuery({
    queryKey: ['backup-configs'],
    queryFn: getBackupConfigs,
  })

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['backup-runs'],
    queryFn: () => getBackupRuns(50, 0),
    refetchInterval: (query) => {
      const data = query.state.data
      if (data?.some(r => r.status === 'queued' || r.status === 'running')) return 5000
      return 30000
    },
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: (cfg: Partial<BackupConfig>) => createBackupConfig(cfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-configs'] })
      toast.success('Backup configuration created')
      closeModal()
    },
    onError: () => toast.error('Failed to create configuration'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, cfg }: { id: number; cfg: Partial<BackupConfig> }) => updateBackupConfig(id, cfg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-configs'] })
      toast.success('Backup configuration updated')
      closeModal()
    },
    onError: () => toast.error('Failed to update configuration'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBackupConfig(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-configs'] })
      toast.success('Backup configuration deleted')
    },
    onError: () => toast.error('Failed to delete configuration'),
  })

  const triggerMutation = useMutation({
    mutationFn: (configId: number) => triggerBackup(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-runs'] })
      toast.success('Backup triggered')
    },
    onError: () => toast.error('Failed to trigger backup'),
  })

  const quickBackupMutation = useMutation({
    mutationFn: triggerQuickBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-runs'] })
      toast.success('Quick backup started')
    },
    onError: () => toast.error('Failed to start quick backup'),
  })

  // Action handlers for completed runs
  async function handleVerify(runId: number) {
    setVerifyResults(prev => ({ ...prev, [runId]: 'loading' }))
    try {
      const result = await verifyBackup(runId)
      setVerifyResults(prev => ({ ...prev, [runId]: result }))
      if (result.verified) {
        toast.success('Backup verified — checksum valid')
      } else {
        toast.error(result.error ?? 'Backup verification failed')
      }
    } catch {
      setVerifyResults(prev => ({ ...prev, [runId]: { verified: false, error: 'Request failed' } }))
      toast.error('Failed to verify backup')
    }
  }

  async function handlePreview(runId: number) {
    setPreviewModal({ open: true, runId, loading: true, data: null })
    try {
      const data = await previewRestore(runId)
      setPreviewModal({ open: true, runId, loading: false, data })
    } catch {
      toast.error('Failed to load restore preview')
      setPreviewModal({ open: false, runId: null, loading: false, data: null })
    }
  }

  // Derived stats
  const stats = useMemo(() => {
    const totalBackups = runs?.length ?? 0
    const lastBackup = runs?.find(r => r.status === 'completed')
    const totalSize = runs?.reduce((sum, r) => sum + (r.file_size || 0), 0) ?? 0
    return { totalBackups, lastBackup, totalSize }
  }, [runs])

  // Form helpers
  function openCreateModal() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEditModal(cfg: BackupConfig) {
    setEditingId(cfg.id)
    setForm({
      name: cfg.name,
      enabled: cfg.enabled,
      backup_type: cfg.backup_type,
      frequency_days: cfg.frequency_days,
      max_retention: cfg.max_retention,
      provider: cfg.provider,
      provider_config: { ...cfg.provider_config },
      compress: cfg.compress,
      encrypt: cfg.encrypt,
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function handleSubmit() {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    const payload: Partial<BackupConfig> = {
      name: form.name.trim(),
      enabled: form.enabled,
      backup_type: form.backup_type,
      frequency_days: form.frequency_days,
      max_retention: form.max_retention,
      provider: form.provider,
      provider_config: form.provider_config,
      compress: form.compress,
      encrypt: form.encrypt,
    }
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, cfg: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  function setProviderConfigField(key: string, value: string) {
    setForm(prev => ({ ...prev, provider_config: { ...prev.provider_config, [key]: value } }))
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <>
      {/* Header */}
      <PageHeader
        title="Backup & Restore"
        subtitle="Manage automated backups and restore points"
        icon={<DatabaseBackup className="h-7 w-7 text-neon-cyan" />}
        actions={
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 rounded-xl bg-neon-cyan/10 px-4 py-2.5 text-sm font-medium text-neon-cyan ring-1 ring-neon-cyan/20 hover:bg-neon-cyan/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            New Config
          </button>
        }
      />

      {/* Quick Actions + Stats */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {/* Quick Backup Card */}
          <GlassPanel className="p-4 sm:p-5 flex flex-col items-center justify-center gap-3" hover glow="cyan">
            <button
              onClick={() => quickBackupMutation.mutate()}
              disabled={quickBackupMutation.isPending}
              className="flex items-center gap-2 rounded-xl bg-neon-green/10 px-5 py-3 text-sm font-medium text-neon-green ring-1 ring-neon-green/20 hover:bg-neon-green/20 transition-all disabled:opacity-50"
            >
              {quickBackupMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Quick Backup
            </button>
            <p className="text-[10px] text-[var(--text-muted)] text-center">Full backup with default settings</p>
          </GlassPanel>

          <StatCard
            label="Total Backups"
            value={stats.totalBackups}
            icon={<Archive className="h-5 w-5" />}
            color="cyan"
          />
          <StatCard
            label="Last Backup"
            value={stats.lastBackup ? relativeTime(stats.lastBackup.completed_at ?? stats.lastBackup.created_at) : 'Never'}
            icon={<Clock className="h-5 w-5" />}
            color="purple"
          />
          <StatCard
            label="Total Size"
            value={formatFileSize(stats.totalSize)}
            icon={<HardDrive className="h-5 w-5" />}
            color="green"
          />
        </div>
      </FadeIn>

      {/* Backup Configurations */}
      <FadeIn delay={0.1}>
        <div className="mb-6 sm:mb-8">
          <h2 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-neon-cyan/70" />
            Backup Configurations
          </h2>

          {configsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <GlassPanel key={i} className="p-5 h-48 animate-pulse">
                  <div className="h-4 w-32 bg-white/5 rounded mb-3" />
                  <div className="h-3 w-48 bg-white/5 rounded mb-2" />
                  <div className="h-3 w-24 bg-white/5 rounded" />
                </GlassPanel>
              ))}
            </div>
          ) : !configs?.length ? (
            <GlassPanel className="p-8 text-center">
              <DatabaseBackup className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3" />
              <p className="text-sm text-[var(--text-secondary)] mb-1">No backup configurations</p>
              <p className="text-xs text-[var(--text-muted)]">Create a configuration to schedule automated backups</p>
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {configs.map(cfg => (
                <GlassPanel key={cfg.id} className="p-4 sm:p-5" hover glow={cfg.enabled ? 'cyan' : 'none'}>
                  {/* Config Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{cfg.name}</h3>
                        <span className={clsx(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                          cfg.enabled
                            ? 'bg-neon-green/15 text-neon-green ring-neon-green/30'
                            : 'bg-gray-500/15 text-gray-400 ring-gray-500/30',
                        )}>
                          {cfg.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                      cfg.backup_type === 'full' ? 'bg-neon-cyan/15 text-neon-cyan ring-neon-cyan/30' : 'bg-neon-amber/15 text-neon-amber ring-neon-amber/30'
                    )}>
                      {cfg.backup_type === 'full' ? 'Full' : 'Incremental'}
                    </span>
                    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                      PROVIDER_MAP[cfg.provider]?.color ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'
                    )}>
                      {cfg.provider === 'local' && <FolderOpen className="h-3 w-3 mr-1" />}
                      {cfg.provider === 's3' && <Cloud className="h-3 w-3 mr-1" />}
                      {cfg.provider === 'azure' && <Cloud className="h-3 w-3 mr-1" />}
                      {cfg.provider === 'gcs' && <Cloud className="h-3 w-3 mr-1" />}
                      {PROVIDER_MAP[cfg.provider]?.label ?? cfg.provider}
                    </span>
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 bg-white/5 text-[var(--text-secondary)] ring-white/10">
                      Every {cfg.frequency_days}d
                    </span>
                  </div>

                  {/* Times */}
                  <div className="space-y-1 mb-4 text-xs text-[var(--text-muted)]">
                    <p>Last run: <span className="text-[var(--text-secondary)]">{relativeTime(cfg.last_run_at)}</span></p>
                    <p>Next run: <span className="text-[var(--text-secondary)]">{relativeTime(cfg.next_run_at)}</span></p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-white/[0.06]">
                    <button
                      onClick={() => openEditModal(cfg)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-all"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      onClick={() => triggerMutation.mutate(cfg.id)}
                      disabled={triggerMutation.isPending}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-neon-cyan hover:bg-neon-cyan/10 transition-all disabled:opacity-50"
                    >
                      <Play className="h-3.5 w-3.5" /> Trigger Now
                    </button>
                    <button
                      onClick={() => setDeleteConfirm({ open: true, id: cfg.id, name: cfg.name })}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-neon-red hover:bg-neon-red/10 transition-all ml-auto"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </GlassPanel>
              ))}
            </div>
          )}
        </div>
      </FadeIn>

      {/* Backup Run History */}
      <FadeIn delay={0.15}>
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base sm:text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Clock className="h-5 w-5 text-neon-cyan/70" />
              Backup History
            </h2>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['backup-runs'] })}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-all"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          <GlassPanel className="overflow-hidden">
            {runsLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-neon-cyan mx-auto mb-2" />
                <p className="text-sm text-[var(--text-muted)]">Loading backup history…</p>
              </div>
            ) : !runs?.length ? (
              <div className="p-8 text-center">
                <Archive className="h-10 w-10 text-[var(--text-muted)] mx-auto mb-3" />
                <p className="text-sm text-[var(--text-secondary)]">No backup runs yet</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Trigger a backup or wait for the next scheduled run</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Status</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Type</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Provider</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">File</th>
                      <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Size</th>
                      <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Records</th>
                      <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Duration</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Created</th>
                      <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map(run => {
                      const sc = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.queued
                      const StatusIcon = sc.icon
                      return (
                        <tr key={run.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                          {/* Status */}
                          <td className="px-4 py-3">
                            <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium', sc.bg, sc.color)}>
                              <StatusIcon className={clsx('h-3 w-3', run.status === 'running' && 'animate-spin')} />
                              {sc.label}
                            </span>
                          </td>
                          {/* Type */}
                          <td className="px-4 py-3">
                            <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                              RUN_TYPE_COLORS[run.run_type] ?? 'bg-white/5 text-[var(--text-secondary)] ring-white/10'
                            )}>
                              {run.run_type}
                            </span>
                          </td>
                          {/* Provider */}
                          <td className="px-4 py-3">
                            <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                              PROVIDER_MAP[run.provider]?.color ?? 'bg-gray-500/15 text-gray-400 ring-gray-500/30'
                            )}>
                              {PROVIDER_MAP[run.provider]?.label ?? run.provider}
                            </span>
                          </td>
                          {/* File */}
                          <td className="px-4 py-3 text-xs text-[var(--text-secondary)] max-w-[200px] truncate font-mono">
                            {run.file_name || '—'}
                          </td>
                          {/* Size */}
                          <td className="px-4 py-3 text-xs text-[var(--text-secondary)] text-right font-mono">
                            {formatFileSize(run.file_size)}
                          </td>
                          {/* Records */}
                          <td className="px-4 py-3 text-xs text-[var(--text-secondary)] text-right font-mono">
                            {run.record_count > 0 ? run.record_count.toLocaleString() : '—'}
                          </td>
                          {/* Duration */}
                          <td className="px-4 py-3 text-xs text-[var(--text-secondary)] text-right font-mono">
                            {formatDuration(run.duration_ms)}
                          </td>
                          {/* Created */}
                          <td className="px-4 py-3 text-xs text-[var(--text-muted)] whitespace-nowrap">
                            {formatDateTime(run.created_at)}
                          </td>
                          {/* Actions */}
                          <td className="px-4 py-3">
                            {run.status === 'completed' ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => downloadBackup(run.id)}
                                  title="Download backup"
                                  className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-neon-cyan hover:bg-neon-cyan/10 transition-all"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleVerify(run.id)}
                                  disabled={verifyResults[run.id] === 'loading'}
                                  title="Verify backup integrity"
                                  className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-neon-amber hover:bg-neon-amber/10 transition-all disabled:opacity-50 relative"
                                >
                                  {verifyResults[run.id] === 'loading' ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Lock className="h-3.5 w-3.5" />
                                  )}
                                  {verifyResults[run.id] && verifyResults[run.id] !== 'loading' && (
                                    <span className={clsx(
                                      'absolute -top-1 -right-1 text-[9px] leading-none',
                                      (verifyResults[run.id] as { verified: boolean }).verified ? 'text-neon-green' : 'text-neon-red'
                                    )}>
                                      {(verifyResults[run.id] as { verified: boolean }).verified ? '✅' : '❌'}
                                    </span>
                                  )}
                                </button>
                                <button
                                  onClick={() => handlePreview(run.id)}
                                  title="Preview / Restore"
                                  className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-neon-purple hover:bg-neon-purple/10 transition-all"
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[var(--text-muted)] text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Error messages for failed runs */}
                {runs.filter(r => r.status === 'failed' && r.error_message).length > 0 && (
                  <div className="border-t border-white/[0.06] p-4 space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-neon-red/70 mb-2">Recent Errors</p>
                    {runs.filter(r => r.status === 'failed' && r.error_message).slice(0, 5).map(run => (
                      <div key={`err-${run.id}`} className="flex items-start gap-2 rounded-lg bg-neon-red/5 p-3 ring-1 ring-neon-red/10">
                        <AlertCircle className="h-4 w-4 text-neon-red shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs text-neon-red font-medium">{run.file_name || `Run #${run.id}`}</p>
                          <p className="text-[11px] text-neon-red/70 mt-0.5 break-words">{run.error_message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={deleteConfirm.open}
        title="Delete Backup Configuration"
        message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          deleteMutation.mutate(deleteConfirm.id)
          setDeleteConfirm({ open: false, id: 0, name: '' })
        }}
        onCancel={() => setDeleteConfirm({ open: false, id: 0, name: '' })}
      />

      {/* Create/Edit Config Modal */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={closeModal}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative glass-panel p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto scrollbar-thin"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  {editingId !== null ? 'Edit Configuration' : 'New Backup Configuration'}
                </h3>
                <button onClick={closeModal} className="rounded-lg p-1.5 hover:bg-white/5 transition-colors">
                  <X className="h-5 w-5 text-[var(--text-muted)]" />
                </button>
              </div>

              <div className="space-y-5">
                {/* Name */}
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Daily full backup"
                    className="w-full rounded-lg bg-white/[0.03] border border-white/[0.08] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/40 transition-all"
                  />
                </div>

                {/* Enabled Toggle */}
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[var(--text-secondary)]">Enabled</label>
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className="transition-colors"
                  >
                    {form.enabled
                      ? <ToggleRight className="h-7 w-7 text-neon-green" />
                      : <ToggleLeft className="h-7 w-7 text-[var(--text-muted)]" />}
                  </button>
                </div>

                {/* Backup Type */}
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Backup Type</label>
                  <div className="relative">
                    <select
                      value={form.backup_type}
                      onChange={e => setForm(prev => ({ ...prev, backup_type: e.target.value }))}
                      className="w-full appearance-none rounded-lg border border-white/[0.08] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/40 transition-all pr-8"
                      style={{ background: 'var(--surface-2, #0f1020)', colorScheme: 'dark' }}
                    >
                      {BACKUP_TYPES.map(bt => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
                  </div>
                </div>

                {/* Frequency */}
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Frequency</label>
                  <div className="relative">
                    <select
                      value={form.frequency_days}
                      onChange={e => setForm(prev => ({ ...prev, frequency_days: Number(e.target.value) }))}
                      className="w-full appearance-none rounded-lg border border-white/[0.08] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/40 transition-all pr-8"
                      style={{ background: 'var(--surface-2, #0f1020)', colorScheme: 'dark' }}
                    >
                      {FREQUENCY_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
                  </div>
                </div>

                {/* Max Retention */}
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Max Retention (backups to keep)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={form.max_retention}
                    onChange={e => setForm(prev => ({ ...prev, max_retention: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))}
                    className="w-full rounded-lg bg-white/[0.03] border border-white/[0.08] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/40 transition-all"
                  />
                </div>

                {/* Provider */}
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Provider</label>
                  <div className="relative">
                    <select
                      value={form.provider}
                      onChange={e => {
                        const newProvider = e.target.value
                        setForm(prev => ({ ...prev, provider: newProvider, provider_config: {} }))
                      }}
                      className="w-full appearance-none rounded-lg border border-white/[0.08] px-3 py-2.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/40 transition-all pr-8"
                      style={{ background: 'var(--surface-2, #0f1020)', colorScheme: 'dark' }}
                    >
                      {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
                  </div>
                </div>

                {/* Provider Config Fields */}
                {PROVIDER_FIELDS[form.provider]?.map(field => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                      {field.label}
                      {field.required && <span className="text-neon-red ml-0.5">*</span>}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        value={form.provider_config[field.key] ?? ''}
                        onChange={e => setProviderConfigField(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        rows={3}
                        className="w-full rounded-lg bg-white/[0.03] border border-white/[0.08] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/40 transition-all font-mono resize-none"
                      />
                    ) : (
                      <input
                        type={field.type ?? 'text'}
                        value={form.provider_config[field.key] ?? ''}
                        onChange={e => setProviderConfigField(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full rounded-lg bg-white/[0.03] border border-white/[0.08] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-neon-cyan/40 transition-all"
                      />
                    )}
                  </div>
                ))}

                {/* Compress Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-medium text-[var(--text-secondary)]">Compress</label>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Gzip compression for smaller file size</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, compress: !prev.compress }))}
                    className="transition-colors"
                  >
                    {form.compress
                      ? <ToggleRight className="h-7 w-7 text-neon-green" />
                      : <ToggleLeft className="h-7 w-7 text-[var(--text-muted)]" />}
                  </button>
                </div>

                {/* Encrypt Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-medium text-[var(--text-secondary)]">Encrypt</label>
                    <p className="text-[10px] text-[var(--text-muted)] mt-0.5">AES-256 encryption for sensitive data</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, encrypt: !prev.encrypt }))}
                    className="transition-colors"
                  >
                    {form.encrypt
                      ? <ToggleRight className="h-7 w-7 text-neon-green" />
                      : <ToggleLeft className="h-7 w-7 text-[var(--text-muted)]" />}
                  </button>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center gap-3 justify-end mt-6 pt-4 border-t border-white/[0.06]">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-white/5 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-lg bg-neon-cyan/20 px-4 py-2 text-sm font-medium text-neon-cyan ring-1 ring-neon-cyan/30 hover:bg-neon-cyan/30 transition-all disabled:opacity-50"
                >
                  {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editingId !== null ? 'Save Changes' : 'Create Configuration'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Restore Preview Modal */}
      <AnimatePresence>
        {previewModal.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setPreviewModal({ open: false, runId: null, loading: false, data: null })}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative glass-panel p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto scrollbar-thin"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Eye className="h-5 w-5 text-neon-purple" />
                  Restore Preview
                </h3>
                <button
                  onClick={() => setPreviewModal({ open: false, runId: null, loading: false, data: null })}
                  className="rounded-lg p-1.5 hover:bg-white/5 transition-colors"
                >
                  <X className="h-5 w-5 text-[var(--text-muted)]" />
                </button>
              </div>

              {previewModal.loading ? (
                <div className="py-12 text-center">
                  <Loader2 className="h-6 w-6 animate-spin text-neon-purple mx-auto mb-2" />
                  <p className="text-sm text-[var(--text-muted)]">Loading preview…</p>
                </div>
              ) : previewModal.data ? (
                <div className="space-y-5">
                  {/* Checksum Status */}
                  <div className={clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2.5 ring-1',
                    previewModal.data.checksum_verified
                      ? 'bg-neon-green/10 ring-neon-green/20'
                      : 'bg-neon-red/10 ring-neon-red/20',
                  )}>
                    {previewModal.data.checksum_verified
                      ? <CheckCircle2 className="h-4 w-4 text-neon-green shrink-0" />
                      : <XCircle className="h-4 w-4 text-neon-red shrink-0" />}
                    <span className={clsx('text-xs font-medium', previewModal.data.checksum_verified ? 'text-neon-green' : 'text-neon-red')}>
                      {previewModal.data.checksum_verified ? 'Checksum verified' : 'Checksum verification failed'}
                    </span>
                  </div>

                  {/* Metadata */}
                  {Object.keys(previewModal.data.metadata).length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Backup Metadata</p>
                      <div className="rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] divide-y divide-white/[0.06]">
                        {Object.entries(previewModal.data.metadata).map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between px-3 py-2">
                            <span className="text-xs text-[var(--text-muted)]">{key}</span>
                            <span className="text-xs text-[var(--text-secondary)] font-mono">{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Table List */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                      Tables ({previewModal.data.tables.length})
                    </p>
                    <div className="rounded-lg bg-white/[0.03] ring-1 ring-white/[0.06] overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Table</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Rows</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previewModal.data.tables.map(t => (
                            <tr key={t.name} className="border-b border-white/[0.03]">
                              <td className="px-3 py-2 text-xs text-[var(--text-secondary)] font-mono">{t.name}</td>
                              <td className="px-3 py-2 text-xs text-[var(--text-secondary)] text-right font-mono">{t.rows.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Modal Footer */}
              <div className="flex items-center justify-end mt-6 pt-4 border-t border-white/[0.06]">
                <button
                  onClick={() => setPreviewModal({ open: false, runId: null, loading: false, data: null })}
                  className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg hover:bg-white/5 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
