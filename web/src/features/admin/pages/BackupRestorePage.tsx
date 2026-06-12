import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Input, Select, Modal, Toggle, ConfirmDialog, DataTable, Textarea, type Column } from '@/components/ui';
import { MetricCard, TimeStamp } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useToast } from '@/components/feedback/Toast';
import { formatDurationMsCompact, formatRelative } from '@/lib/dateFormat';
import { formatBytes, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { getErrorMessage } from '@/lib/errorMessage';
import { request, getApiBase } from '@/api/client';
import { Icons } from '@/lib/icons';
// Settings JSON bundle export/import — reused from features/settings to
// give the dedicated /backup page a single canonical home for "backup &
// restore" surfaces (was previously also rendered as <section id="backup">
// inside SettingsPage, which read as a duplicate of this page).
import { SettingsExportImport } from '@/features/settings/components/SettingsExportImport';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BackupConfig {
  id: number;
  name: string;
  enabled: boolean;
  backup_type: string;
  frequency_days: number;
  max_retention: number;
  provider: string;
  provider_config: Record<string, string>;
  include_tables?: string[];
  compress: boolean;
  encrypt: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface BackupRun {
  id: number;
  config_id: number | null;
  run_type: string;
  backup_type: string;
  status: string;
  provider: string;
  file_name?: string | null;
  file_path?: string | null;
  file_size: number;
  record_count: number;
  table_count: number;
  checksum?: string | null;
  duration_ms: number;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

interface RestorePreview {
  tables: { name: string; rows: number }[];
  metadata: Record<string, unknown> | null;
  checksum_verified: boolean;
}

type ConfigFormData = Omit<BackupConfig, 'id' | 'last_run_at' | 'next_run_at' | 'created_at' | 'updated_at'>;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PROVIDERS: { value: string; label: string }[] = [
  { value: 'local', label: 'Local' },
  { value: 's3', label: 'Amazon S3' },
  { value: 'azure', label: 'Azure Blob' },
  { value: 'gcs', label: 'Google Cloud' },
];

const PROVIDER_BADGE_VARIANT: Record<string, 'neutral' | 'warning' | 'info' | 'success'> = {
  local: 'neutral',
  s3: 'warning',
  azure: 'info',
  gcs: 'success',
};

const PROVIDER_ICON: Record<string, typeof Icons.folderOpen> = {
  local: Icons.folderOpen,
  s3: Icons.cloud,
  azure: Icons.cloud,
  gcs: Icons.cloud,
};

const STATUS_CONFIG: Record<
  string,
  { color: string; bg: string; icon: typeof Icons.successFilled; variant: 'success' | 'danger' | 'info' | 'neutral' }
> = {
  completed: { color: 'text-neon-green', bg: 'bg-neon-green/15', icon: Icons.successFilled, variant: 'success' },
  failed: { color: 'text-neon-red', bg: 'bg-neon-red/15', icon: Icons.error, variant: 'danger' },
  running: { color: 'text-neon-cyan', bg: 'bg-neon-cyan/15', icon: Icons.loading, variant: 'info' },
  queued: { color: 'text-[var(--text-muted)]', bg: 'bg-gray-500/15', icon: Icons.timer, variant: 'neutral' },
};

const EMPTY_FORM: ConfigFormData = {
  name: '',
  enabled: true,
  backup_type: 'full',
  frequency_days: 1,
  max_retention: 7,
  provider: 'local',
  provider_config: { path: '/backups' },
  compress: true,
  encrypt: false,
};

const BACKUP_TYPE_OPTIONS = [
  { value: 'full', label: 'Full' },
  { value: 'incremental', label: 'Incremental' },
];

const PROVIDER_OPTIONS = PROVIDERS.map((p) => ({ value: p.value, label: p.label }));

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
    { key: 'prefix', label: 'Prefix (optional)', placeholder: 'backups/' },
  ],
  azure: [
    { key: 'account_name', label: 'Account Name', required: true },
    { key: 'account_key', label: 'Account Key', required: true, type: 'password' },
    { key: 'container_name', label: 'Container Name', required: true },
    { key: 'prefix', label: 'Prefix (optional)', placeholder: 'backups/' },
  ],
  gcs: [
    { key: 'bucket', label: 'Bucket', required: true, placeholder: 'my-backup-bucket' },
    { key: 'credentials_json', label: 'Credentials JSON', required: true, type: 'textarea' },
    { key: 'prefix', label: 'Prefix (optional)', placeholder: 'backups/' },
  ],
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BackupRestorePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  usePageTitle(t('backup.title', 'Backup & Restore'));

  /* ---- state ---- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BackupConfig | null>(null);
  const [form, setForm] = useState<ConfigFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<BackupConfig | null>(null);
  const [previewData, setPreviewData] = useState<RestorePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  /* ---- queries ---- */
  const {
    data: configs = [],
    isLoading: loadingConfigs,
    error: configsError,
  } = useQuery<BackupConfig[]>({
    queryKey: ['backup-configs'],
    queryFn: () => request<BackupConfig[]>('/backup/configs'),
  });

  const { data: runs = [], isLoading: loadingRuns, error: runsError } = useQuery<BackupRun[]>({
    queryKey: ['backup-runs'],
    queryFn: () => request<BackupRun[]>('/backup/runs'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.some((r) => r.status === 'queued' || r.status === 'running')) return 5000;
      return 30000;
    },
  });

  const anyError = [configsError, runsError].find(Boolean);
  const loading = loadingConfigs || loadingRuns;

  /* ---- derived stats ---- */
  const stats = useMemo(() => {
    const totalBackups = runs.length;
    const lastBackup = runs.find((r) => r.status === 'completed');
    const totalSize = runs.reduce((sum, r) => sum + (r.file_size || 0), 0);
    return { totalBackups, lastBackup, totalSize };
  }, [runs]);

  const failedRuns = useMemo(
    () => runs.filter((r) => r.status === 'failed' && r.error_message).slice(0, 5),
    [runs],
  );

  /* ---- mutations ---- */
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['backup-configs'] });
    qc.invalidateQueries({ queryKey: ['backup-runs'] });
  };

  const createMutation = useMutation({
    mutationFn: (body: ConfigFormData) =>
      request<BackupConfig>('/backup/configs', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.configCreated', 'Config created'));
      closeModal();
    },
    onError: () => toast.error(t('backup.configCreateFailed', 'Failed to create config')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ConfigFormData }) =>
      request<BackupConfig>(`/backup/configs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.configUpdated', 'Config updated'));
      closeModal();
    },
    onError: () => toast.error(t('backup.configUpdateFailed', 'Failed to update config')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      request<void>(`/backup/configs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.configDeleted', 'Config deleted'));
      setDeleteTarget(null);
    },
    onError: () => toast.error(t('backup.configDeleteFailed', 'Failed to delete config')),
  });

  const triggerMutation = useMutation({
    mutationFn: (configId: number) =>
      request<void>(`/backup/configs/${configId}/trigger`, { method: 'POST' }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.triggered', 'Backup triggered'));
    },
    onError: () => toast.error(t('backup.triggerFailed', 'Failed to trigger backup')),
  });

  const quickBackupMutation = useMutation({
    mutationFn: () => request<void>('/backup/quick', { method: 'POST' }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.quickStarted', 'Quick backup started'));
    },
    onError: () => toast.error(t('backup.quickFailed', 'Quick backup failed')),
  });

  const verifyMutation = useMutation({
    mutationFn: (runId: number) =>
      request<{ verified: boolean }>(`/backup/runs/${runId}/verify`, { method: 'POST' }),
    onSuccess: (data) => {
      if (data.verified) toast.success(t('backup.checksumVerified', 'Checksum verified'));
      else toast.warning(t('backup.checksumMismatch', 'Checksum mismatch'));
    },
    onError: () => toast.error(t('backup.verifyFailed', 'Verification failed')),
  });

  /* ---- callbacks ---- */
  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingConfig(null);
    setForm(EMPTY_FORM);
  }, []);

  const openCreate = useCallback(() => {
    setEditingConfig(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((cfg: BackupConfig) => {
    setEditingConfig(cfg);
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
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (editingConfig) {
      updateMutation.mutate({ id: editingConfig.id, body: form });
    } else {
      createMutation.mutate(form);
    }
  }, [editingConfig, form, updateMutation, createMutation]);

  const handleDownload = useCallback((runId: number) => {
    window.open(`${getApiBase()}/api/v1/backup/runs/${runId}/download`, '_blank');
  }, []);

  const handlePreview = useCallback(async (runId: number) => {
    try {
      const data = await request<RestorePreview>(`/backup/runs/${runId}/preview`);
      setPreviewData(data);
      setPreviewOpen(true);
    } catch {
      toast.error(t('backup.previewFailed', 'Failed to load preview'));
    }
  }, [t, toast]);

  const setField = useCallback(<K extends keyof ConfigFormData>(key: K, value: ConfigFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setProviderField = useCallback((key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      provider_config: { ...prev.provider_config, [key]: value },
    }));
  }, []);

  /* ---- columns: configs ---- */
  const configColumns: Column<BackupConfig>[] = [
    {
      key: 'name',
      header: t('backup.name', 'Name'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {!row.enabled && (
            <Badge variant="neutral" size="sm">{t('backup.disabled', 'Disabled')}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'backup_type',
      header: t('backup.type', 'Type'),
      render: (row) => (
        <Badge variant={row.backup_type === 'full' ? 'info' : 'warning'} size="sm">
          {row.backup_type === 'full' ? t('backup.full', 'Full') : t('backup.incremental', 'Incremental')}
        </Badge>
      ),
    },
    {
      key: 'provider',
      header: t('backup.provider', 'Provider'),
      render: (row) => {
        const p = PROVIDERS.find((pr) => pr.value === row.provider);
        const ProvIcon = PROVIDER_ICON[row.provider] ?? Icons.cloud;
        return (
          <Badge variant={PROVIDER_BADGE_VARIANT[row.provider] ?? 'neutral'} size="sm">
            <ProvIcon className="h-3 w-3 mr-1" />
            {p?.label ?? row.provider}
          </Badge>
        );
      },
    },
    {
      key: 'frequency',
      header: t('backup.frequency', 'Frequency'),
      render: (row) => (
        <span className="text-sm text-[var(--text-secondary)]">
          {row.frequency_days === 1 ? t('backup.daily', 'Daily') : t('backup.everyNDays', { days: row.frequency_days, defaultValue: 'Every {{days}}d' })}
        </span>
      ),
    },
    {
      key: 'schedule',
      header: t('backup.schedule', 'Schedule'),
      render: (row) => (
        <div className="space-y-0.5 text-xs text-[var(--text-muted)]">
          <p>{t('backup.lastRun', 'Last')}: <span className="text-[var(--text-secondary)]">{row.last_run_at ? formatRelative(row.last_run_at) : '—'}</span></p>
          <p>{t('backup.nextRun', 'Next')}: <span className="text-[var(--text-secondary)]">{row.next_run_at ? formatRelative(row.next_run_at) : '—'}</span></p>
        </div>
      ),
    },
    {
      key: 'options',
      header: t('backup.options', 'Options'),
      render: (row) => (
        <div className="flex gap-1.5">
          {row.compress && <Badge variant="neutral" size="sm">{t('backup.compress', 'Compress')}</Badge>}
          {row.encrypt && <Badge variant="warning" size="sm">{t('backup.encrypt', 'Encrypt')}</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-32 text-right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<Icons.play className="h-3.5 w-3.5" />}
            onClick={() => triggerMutation.mutate(row.id)}
            loading={triggerMutation.isPending}
            aria-label={t('backup.triggerNow', 'Trigger now')}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Icons.pencil className="h-3.5 w-3.5" />}
            onClick={() => openEdit(row)}
            aria-label={t('backup.edit', 'Edit')}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Icons.delete className="h-3.5 w-3.5 text-neon-red" />}
            onClick={() => setDeleteTarget(row)}
            aria-label={t('backup.delete', 'Delete')}
          />
        </div>
      ),
    },
  ];

  /* ---- columns: runs ---- */
  const runColumns: Column<BackupRun>[] = [
    {
      key: 'created_at',
      header: t('backup.time', 'Time'),
      sortable: true,
      render: (row) => (
        <TimeStamp value={row.created_at} className="text-sm text-[var(--text-secondary)]" />
      ),
    },
    {
      key: 'run_type',
      header: t('backup.runType', 'Run Type'),
      render: (row) => (
        <Badge
          variant={({ backup: 'info', restore: 'success', quick: 'warning' } as Record<string, 'info' | 'success' | 'warning'>)[row.run_type] ?? 'neutral'}
          size="sm"
        >
          {row.run_type}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('backup.status', 'Status'),
      sortable: true,
      render: (row) => {
        const s = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.queued;
        const Icon = s.icon;
        return (
          <div className="flex items-center gap-1.5">
            <Icon className={cn('h-4 w-4', s.color, row.status === 'running' && 'animate-spin')} />
            <Badge variant={s.variant} size="sm">{t(`backup.status.${row.status}`, row.status)}</Badge>
          </div>
        );
      },
    },
    {
      key: 'provider',
      header: t('backup.provider', 'Provider'),
      render: (row) => {
        const p = PROVIDERS.find((pr) => pr.value === row.provider);
        return (
          <Badge variant={PROVIDER_BADGE_VARIANT[row.provider] ?? 'neutral'} size="sm">
            {p?.label ?? row.provider}
          </Badge>
        );
      },
    },
    {
      key: 'file_name',
      header: t('backup.file', 'File'),
      render: (row) => (
        <span className="text-xs text-[var(--text-secondary)] max-w-[200px] truncate block font-mono">
          {row.file_name ?? '—'}
        </span>
      ),
    },
    {
      key: 'file_size',
      header: t('backup.size', 'Size'),
      sortable: true,
      render: (row) => (
        <span className="text-sm tabular-nums">{row.file_size ? formatBytes(row.file_size) : '—'}</span>
      ),
    },
    {
      key: 'record_count',
      header: t('backup.records', 'Records'),
      render: (row) => (
        <span className="text-sm tabular-nums text-[var(--text-secondary)] font-mono">
          {row.record_count > 0 ? fmtInt(row.record_count) : '—'}
        </span>
      ),
    },
    {
      key: 'duration',
      header: t('backup.duration', 'Duration'),
      render: (row) => (
        <span className="text-sm tabular-nums text-[var(--text-muted)]">
          {row.duration_ms > 0 ? formatDurationMsCompact(row.duration_ms) : '—'}
        </span>
      ),
    },
    {
      key: 'run_actions',
      header: '',
      className: 'w-28 text-right',
      render: (row) =>
        row.status === 'completed' ? (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={<Icons.download className="h-3.5 w-3.5" />}
              onClick={() => handleDownload(row.id)}
              aria-label={t('backup.download', 'Download')}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Icons.securityCheck className="h-3.5 w-3.5" />}
              onClick={() => verifyMutation.mutate(row.id)}
              loading={verifyMutation.isPending}
              aria-label={t('backup.verify', 'Verify')}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Icons.show className="h-3.5 w-3.5" />}
              onClick={() => handlePreview(row.id)}
              aria-label={t('backup.preview', 'Preview')}
            />
          </div>
        ) : null,
    },
  ];

  /* ---- preview table columns ---- */
  const previewColumns: Column<{ name: string; rows: number }>[] = [
    { key: 'name', header: t('backup.table', 'Table'), render: (row) => <span className="font-medium font-mono">{row.name}</span> },
    {
      key: 'rows',
      header: t('backup.rows', 'Rows'),
      render: (row) => <span className="tabular-nums">{fmtInt(row.rows)}</span>,
    },
  ];

  /* ---- render ---- */
  return (
    <PageContainer
      title={t('backup.title', 'Backup & Restore')}
      subtitle={t('backup.subtitle', 'Manage automated backups and restore points')}
      loading={loading}
      error={configsError as Error | null}
      actions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Icons.charging className="h-4 w-4" />}
            onClick={() => quickBackupMutation.mutate()}
            loading={quickBackupMutation.isPending}
          >
            {t('backup.quickBackup', 'Quick Backup')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Icons.add className="h-4 w-4" />}
            onClick={openCreate}
          >
            {t('backup.newConfig', 'New Config')}
          </Button>
        </div>
      }
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<Icons.alertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* ---- stats row ---- */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={88} rounded />)
          ) : (
            <>
              <MetricCard
                label={t('backup.totalConfigs', 'Total Configs')}
                value={fmtInt(configs.length)}
                icon={<Icons.database className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('backup.totalBackups', 'Total Backups')}
                value={fmtInt(stats.totalBackups)}
                icon={<Icons.archive className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('backup.lastBackup', 'Last Backup')}
                value={
                  stats.lastBackup
                    ? formatRelative(stats.lastBackup.completed_at ?? stats.lastBackup.created_at)
                    : '—'
                }
                icon={<Icons.clock className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('backup.totalSize', 'Total Size')}
                value={formatBytes(stats.totalSize)}
                icon={<Icons.hardDrive className="h-5 w-5" />}
              />
            </>
          )}
        </div>
      </FadeIn>

      {/* ---- backup configurations ---- */}
      <FadeIn delay={0.1}>
        <GlassPanel className="mt-6">
          <h2 className="mb-4 text-lg font-semibold">{t('backup.configurations', 'Backup Configurations')}</h2>
          {configs.length === 0 && !loadingConfigs ? (
            <EmptyState
              icon={<Icons.database className="h-10 w-10 text-[var(--text-muted)]" />}
              title={t('backup.noConfigs', 'No backup configurations')}
              message={t('backup.noConfigsMessage', 'Create a backup configuration to start protecting your data.')}
              action={{ label: t('backup.newConfig', 'New Config'), onClick: openCreate }}
            />
          ) : (
            <DataTable<BackupConfig>
              tableId="admin:backup-configs"
              columns={configColumns}
              data={configs}
              keyExtractor={(r) => r.id}
              emptyMessage={t('backup.noConfigs', 'No backup configurations')}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- backup runs history ---- */}
      <FadeIn delay={0.2}>
        <GlassPanel className="mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{t('backup.history', 'Backup History')}</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ['backup-runs'] })}
              aria-label={t('backup.refresh', 'Refresh')}
            >
              {t('backup.refresh', 'Refresh')}
            </Button>
          </div>
          {runs.length === 0 && !loadingRuns ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Icons.clock className="h-10 w-10 text-[var(--text-muted)]" />}
              title={t('backup.noRuns', 'No backup runs yet')}
              message={t('backup.noRunsMessage', 'Trigger a backup or wait for the scheduled run.')}
            />
          ) : (
            <>
              <DataTable<BackupRun>
                tableId="admin:backup-runs"
                columns={runColumns}
                data={runs}
                keyExtractor={(r) => r.id}
                emptyMessage={t('backup.noRuns', 'No backup runs yet')}
                compact
                pagination
              />

              {/* Recent Errors for failed runs */}
              {failedRuns.length > 0 && (
                <div className="border-t border-white/[0.06] p-4 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-neon-red/70 mb-2">
                    {t('backup.recentErrors', 'Recent Errors')}
                  </p>
                  {failedRuns.map((run) => (
                    <div
                      key={`err-${run.id}`}
                      className="flex items-start gap-2 rounded-lg bg-neon-red/5 p-3 ring-1 ring-neon-red/10"
                    >
                      <Icons.alertCircle className="h-4 w-4 text-neon-red shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs text-rose-300 font-medium">
                          {run.file_name ?? `Run #${run.id}`}
                        </p>
                        <p className="text-[11px] text-neon-red/70 mt-0.5 break-words">
                          {run.error_message}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- portable settings JSON bundle ----
          Lightweight "stash to git" export/import for the configuration
          subset (general settings, alert rules, geofences, quiet-hours).
          Distinct from the operational backup runs above — those are
          full-database snapshots driven by scheduled providers, this is
          a portable JSON bundle for fresh-install transfer. */}
      <FadeIn delay={0.3}>
        <div className="mt-6">
          <SettingsExportImport />
        </div>
      </FadeIn>

      {/* ---- create / edit config modal ---- */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingConfig ? t('backup.editConfig', 'Edit Configuration') : t('backup.newConfig', 'New Configuration')}
        size="lg"
      >
        <div className="flex flex-col gap-5 p-1">
          <Input
            label={t('backup.configName', 'Name')}
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder={t('backup.configNamePlaceholder', 'Daily full backup')}
          />

          <Toggle
            label={t('backup.enabled', 'Enabled')}
            checked={form.enabled}
            onChange={(v) => setField('enabled', v)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              label={t('backup.backupType', 'Backup Type')}
              options={BACKUP_TYPE_OPTIONS}
              value={form.backup_type}
              onChange={(e) => setField('backup_type', e.target.value)}
            />
            <Select
              label={t('backup.provider', 'Provider')}
              options={PROVIDER_OPTIONS}
              value={form.provider}
              onChange={(e) => {
                setField('provider', e.target.value);
                setField('provider_config', {});
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('backup.frequencyDays', 'Frequency (days)')}
              type="number"
              value={String(form.frequency_days)}
              onChange={(e) => setField('frequency_days', Math.max(1, Number(e.target.value)))}
            />
            <Input
              label={t('backup.maxRetention', 'Max Retention')}
              type="number"
              value={String(form.max_retention)}
              onChange={(e) => setField('max_retention', Math.max(1, Number(e.target.value)))}
            />
          </div>

          {/* dynamic provider fields */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-4">
            <p className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
              {t('backup.providerSettings', 'Provider Settings')}
            </p>
            <div className="grid gap-3">
              {(PROVIDER_FIELDS[form.provider] ?? []).map((field) => (
                <div key={field.key}>
                  {field.type === 'textarea' ? (
                    <Textarea
                      label={field.required ? `${field.label} *` : field.label}
                      value={form.provider_config[field.key] ?? ''}
                      onChange={(e) => setProviderField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                    />
                  ) : (
                    <Input
                      label={field.required ? `${field.label} *` : field.label}
                      type={field.type ?? 'text'}
                      value={form.provider_config[field.key] ?? ''}
                      onChange={(e) => setProviderField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-6">
            <Toggle
              label={t('backup.compress', 'Compress')}
              checked={form.compress}
              onChange={(v) => setField('compress', v)}
            />
            <Toggle
              label={t('backup.encrypt', 'Encrypt')}
              checked={form.encrypt}
              onChange={(v) => setField('encrypt', v)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeModal}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={createMutation.isPending || updateMutation.isPending}
              disabled={!form.name.trim()}
            >
              {editingConfig ? t('backup.saveChanges', 'Save Changes') : t('backup.create', 'Create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- delete confirm dialog ---- */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('backup.deleteConfig', 'Delete Configuration')}
        message={t('backup.deleteConfigMessage', 'Are you sure you want to delete "{{name}}"? This cannot be undone.', {
          name: deleteTarget?.name,
        })}
        variant="danger"
        confirmLabel={t('backup.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ---- restore preview modal ---- */}
      <Modal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewData(null);
        }}
        title={t('backup.restorePreview', 'Restore Preview')}
        size="md"
      >
        {previewData ? (
          <div className="flex flex-col gap-4 p-1">
            <div className="flex items-center gap-2 text-sm">
              <Icons.securityCheck
                className={cn(
                  'h-4 w-4',
                  previewData.checksum_verified ? 'text-emerald-300' : 'text-rose-300',
                )}
              />
              <span className={previewData.checksum_verified ? 'text-emerald-300' : 'text-rose-300'}>
                {previewData.checksum_verified
                  ? t('backup.checksumVerified', 'Checksum verified')
                  : t('backup.checksumFailed', 'Checksum verification failed')}
              </span>
            </div>

            {/* Metadata */}
            {previewData.metadata && Object.keys(previewData.metadata).length > 0 && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {t('backup.metadata', 'Backup Metadata')}
                </p>
                <div className="space-y-1 text-xs">
                  {Object.entries(previewData.metadata).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-[var(--text-muted)]">{k}</span>
                      <span className="text-[var(--text-secondary)] font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tables */}
            {previewData.tables.length > 0 ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  {t('backup.tables', 'Tables')} ({previewData.tables.length})
                </p>
                <DataTable<{ name: string; rows: number }>
                  tableId="admin:backup-preview-tables"
                  columns={previewColumns}
                  data={previewData.tables}
                  keyExtractor={(r) => r.name}
                  compact
                  pagination
                />
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('backup.noTables', 'No tables found in backup')} />
            )}

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPreviewOpen(false);
                  setPreviewData(null);
                }}
              >
                {t('common.close', 'Close')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center">
            <Icons.loading className="h-6 w-6 animate-spin text-neon-purple mx-auto mb-2" />
            <p className="text-sm text-[var(--text-muted)]">{t('backup.loadingPreview', 'Loading preview…')}</p>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
