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
import type { BackupConfig, BackupRun } from '../api'
import { PageHeader, GlassPanel, FadeIn, StatCard, ConfirmModal, Badge, Button, Toggle, Modal, DataTable, type Column, Input, Select } from '../components/ui'
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
  Zap,
  Archive,
  Shield,
  RefreshCw,
  AlertCircle,
  Download,
  Lock,
  Eye,
} from 'lucide-react'

import clsx from 'clsx'
import { formatDateTime } from '../lib/dateFormat'
import { usePageTitle } from '../hooks/usePageTitle'

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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatFileSize(bytes: number): string {
  usePageTitle('Backup & Restore')
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
          <Button variant="secondary" onClick={openCreateModal} icon={<Plus className="h-4 w-4" />}>
            New Config
          </Button>
        }
      />

      {/* Quick Actions + Stats */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {/* Quick Backup Card */}
          <GlassPanel className="p-4 sm:p-5 flex flex-col items-center justify-center gap-3" hover glow="cyan">
            <Button variant="secondary" onClick={() => quickBackupMutation.mutate()} loading={quickBackupMutation.isPending} icon={<Zap className="h-4 w-4" />}>
              Quick Backup
            </Button>
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
                        <Badge color={cfg.enabled ? 'green' : 'neutral'}>
                          {cfg.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <Badge color={cfg.backup_type === 'full' ? 'cyan' : 'amber'}>
                      {cfg.backup_type === 'full' ? 'Full' : 'Incremental'}
                    </Badge>
                    <Badge color={({ local: 'neutral', s3: 'amber', azure: 'blue', gcs: 'green' } as Record<string, 'neutral' | 'amber' | 'blue' | 'green'>)[cfg.provider] ?? 'neutral'}>
                      {cfg.provider === 'local' && <FolderOpen className="h-3 w-3 mr-1" />}
                      {cfg.provider === 's3' && <Cloud className="h-3 w-3 mr-1" />}
                      {cfg.provider === 'azure' && <Cloud className="h-3 w-3 mr-1" />}
                      {cfg.provider === 'gcs' && <Cloud className="h-3 w-3 mr-1" />}
                      {PROVIDER_MAP[cfg.provider]?.label ?? cfg.provider}
                    </Badge>
                    <Badge color="neutral">Every {cfg.frequency_days}d</Badge>
                  </div>

                  {/* Times */}
                  <div className="space-y-1 mb-4 text-xs text-[var(--text-muted)]">
                    <p>Last run: <span className="text-[var(--text-secondary)]">{relativeTime(cfg.last_run_at)}</span></p>
                    <p>Next run: <span className="text-[var(--text-secondary)]">{relativeTime(cfg.next_run_at)}</span></p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-3 border-t border-white/[0.06]">
                    <Button variant="ghost" size="sm" onClick={() => openEditModal(cfg)} icon={<Pencil className="h-3.5 w-3.5" />}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => triggerMutation.mutate(cfg.id)} disabled={triggerMutation.isPending} icon={<Play className="h-3.5 w-3.5" />}>
                      Trigger Now
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setDeleteConfirm({ open: true, id: cfg.id, name: cfg.name })} icon={<Trash2 className="h-3.5 w-3.5" />} className="ml-auto" />
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
            <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['backup-runs'] })} icon={<RefreshCw className="h-3.5 w-3.5" />}>
              Refresh
            </Button>
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
                <DataTable
                  columns={[
                    { key: 'status', header: 'Status', render: (run) => {
                      const sc = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.queued
                      const StatusIcon = sc.icon
                      return <Badge color={({ completed: 'green', failed: 'red', running: 'cyan', queued: 'neutral' } as Record<string, 'green' | 'red' | 'cyan' | 'neutral'>)[run.status] ?? 'neutral'}><StatusIcon className={clsx('h-3 w-3', run.status === 'running' && 'animate-spin')} />{sc.label}</Badge>
                    }},
                    { key: 'type', header: 'Type', render: (run) => <Badge color={({ backup: 'cyan', restore: 'purple', quick: 'amber' } as Record<string, 'cyan' | 'purple' | 'amber'>)[run.run_type] ?? 'neutral'}>{run.run_type}</Badge> },
                    { key: 'provider', header: 'Provider', render: (run) => <Badge color={({ local: 'neutral', s3: 'amber', azure: 'blue', gcs: 'green' } as Record<string, 'neutral' | 'amber' | 'blue' | 'green'>)[run.provider] ?? 'neutral'}>{PROVIDER_MAP[run.provider]?.label ?? run.provider}</Badge> },
                    { key: 'file', header: 'File', render: (run) => <span className="text-xs text-[var(--text-secondary)] max-w-[200px] truncate block font-mono">{run.file_name || '—'}</span> },
                    { key: 'size', header: 'Size', render: (run) => <span className="text-xs text-[var(--text-secondary)] font-mono">{formatFileSize(run.file_size)}</span>, className: 'text-right' },
                    { key: 'records', header: 'Records', render: (run) => <span className="text-xs text-[var(--text-secondary)] font-mono">{run.record_count > 0 ? run.record_count.toLocaleString() : '—'}</span>, className: 'text-right' },
                    { key: 'duration', header: 'Duration', render: (run) => <span className="text-xs text-[var(--text-secondary)] font-mono">{formatDuration(run.duration_ms)}</span>, className: 'text-right' },
                    { key: 'created', header: 'Created', render: (run) => <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{formatDateTime(run.created_at)}</span> },
                    { key: 'actions', header: 'Actions', className: 'text-center', render: (run) => run.status === 'completed' ? (
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => downloadBackup(run.id)} title="Download backup" aria-label="Download backup" className="!p-1.5 !rounded-lg hover:!text-neon-cyan hover:!bg-neon-cyan/10"><Download className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => handleVerify(run.id)} disabled={verifyResults[run.id] === 'loading'} title="Verify backup integrity" className="!p-1.5 !rounded-lg hover:!text-neon-amber hover:!bg-neon-amber/10 !relative">
                          {verifyResults[run.id] === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                          {verifyResults[run.id] && verifyResults[run.id] !== 'loading' && (
                            <span className={clsx('absolute -top-1 -right-1 text-[9px] leading-none', (verifyResults[run.id] as { verified: boolean }).verified ? 'text-neon-green' : 'text-neon-red')}>{(verifyResults[run.id] as { verified: boolean }).verified ? '✅' : '❌'}</span>
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handlePreview(run.id)} title="Preview / Restore" aria-label="Preview backup" className="!p-1.5 !rounded-lg hover:!text-neon-purple hover:!bg-neon-purple/10"><Eye className="h-3.5 w-3.5" /></Button>
                      </div>
                    ) : <span className="text-[var(--text-muted)] text-xs">—</span> },
                  ] as Column<BackupRun>[]}
                  data={runs}
                  keyExtractor={(run) => run.id}
                />

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
      <Modal open={modalOpen} onClose={closeModal} title={editingId !== null ? 'Edit Configuration' : 'New Backup Configuration'}>
              <div className="space-y-5">
                {/* Name */}
                <div>
                  <label htmlFor="backup-name" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Name</label>
                  <Input
                    id="backup-name"
                    type="text"
                    value={form.name}
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Daily full backup"
                  />
                </div>

                {/* Enabled Toggle */}
                <Toggle
                  checked={form.enabled}
                  onChange={(v) => setForm(prev => ({ ...prev, enabled: v }))}
                  label="Enabled"
                />

                {/* Backup Type */}
                <div>
                  <label htmlFor="backup-type" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Backup Type</label>
                  <Select
                    id="backup-type"
                    value={form.backup_type}
                    onChange={e => setForm(prev => ({ ...prev, backup_type: e.target.value }))}
                    options={BACKUP_TYPES.map(bt => ({ value: bt.value, label: bt.label }))}
                  />
                </div>

                {/* Frequency */}
                <div>
                  <label htmlFor="backup-frequency" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Frequency</label>
                  <Select
                    id="backup-frequency"
                    value={String(form.frequency_days)}
                    onChange={e => setForm(prev => ({ ...prev, frequency_days: Number(e.target.value) }))}
                    options={FREQUENCY_OPTIONS.map(f => ({ value: String(f.value), label: f.label }))}
                  />
                </div>

                {/* Max Retention */}
                <div>
                  <label htmlFor="backup-retention" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Max Retention (backups to keep)</label>
                  <Input
                    id="backup-retention"
                    type="number"
                    min={1}
                    max={100}
                    value={form.max_retention}
                    onChange={e => setForm(prev => ({ ...prev, max_retention: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))}
                  />
                </div>

                {/* Provider */}
                <div>
                  <label htmlFor="backup-provider" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Provider</label>
                  <Select
                    id="backup-provider"
                    value={form.provider}
                    onChange={e => {
                      const newProvider = e.target.value
                      setForm(prev => ({ ...prev, provider: newProvider, provider_config: {} }))
                    }}
                    options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
                  />
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
                      <Input
                        type={field.type ?? 'text'}
                        value={form.provider_config[field.key] ?? ''}
                        onChange={e => setProviderConfigField(field.key, e.target.value)}
                        placeholder={field.placeholder}
                      />
                    )}
                  </div>
                ))}

                {/* Compress Toggle */}
                <Toggle
                  checked={form.compress}
                  onChange={(v) => setForm(prev => ({ ...prev, compress: v }))}
                  label="Compress"
                  description="Gzip compression for smaller file size"
                />

                {/* Encrypt Toggle */}
                <Toggle
                  checked={form.encrypt}
                  onChange={(v) => setForm(prev => ({ ...prev, encrypt: v }))}
                  label="Encrypt"
                  description="AES-256 encryption for sensitive data"
                />
              </div>

              {/* Modal Footer */}
              <div className="flex items-center gap-3 justify-end mt-6 pt-4 border-t border-white/[0.06]">
                <Button variant="ghost" onClick={closeModal}>
                  Cancel
                </Button>
                <Button variant="secondary" onClick={handleSubmit} loading={isSaving}>
                  {editingId !== null ? 'Save Changes' : 'Create Configuration'}
                </Button>
              </div>
      </Modal>
      {/* Restore Preview Modal */}
      <Modal open={previewModal.open} onClose={() => setPreviewModal({ open: false, runId: null, loading: false, data: null })} title="Restore Preview">
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
                      <DataTable
                        columns={[
                          { key: 'name', header: 'Table', render: (t) => <span className="text-xs text-[var(--text-secondary)] font-mono">{t.name}</span> },
                          { key: 'rows', header: 'Rows', render: (t) => <span className="text-xs text-[var(--text-secondary)] font-mono">{t.rows.toLocaleString()}</span>, className: 'text-right' },
                        ] as Column<{ name: string; rows: number }>[]}
                        data={previewModal.data.tables}
                        keyExtractor={(t) => t.name}
                        compact
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Modal Footer */}
              <div className="flex items-center justify-end mt-6 pt-4 border-t border-white/[0.06]">
                <Button variant="ghost" onClick={() => setPreviewModal({ open: false, runId: null, loading: false, data: null })}>
                  Close
                </Button>
              </div>
      </Modal>
    </>
  )
}
