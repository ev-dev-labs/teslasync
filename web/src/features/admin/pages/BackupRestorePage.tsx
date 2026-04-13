import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Database,
  Play,
  Pencil,
  Trash2,
  Download,
  ShieldCheck,
  Eye,
  Zap,
  Plus,
  HardDrive,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Timer,
} from 'lucide-react';
import clsx from 'clsx';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Toggle } from '@/components/ui/Toggle';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useToast } from '@/components/feedback/Toast';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BackupConfig {
  id: number;
  name: string;
  enabled: boolean;
  backup_type: 'full' | 'incremental';
  frequency_days: number;
  max_retention: number;
  provider: 'local' | 's3' | 'azure' | 'gcs';
  provider_config: Record<string, string>;
  compress: boolean;
  encrypt: boolean;
}

interface BackupRun {
  id: number;
  config_id: number;
  config_name?: string;
  status: 'completed' | 'failed' | 'running' | 'queued';
  backup_type: string;
  file_size: number;
  created_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error?: string;
}

interface BackupStats {
  total_configs: number;
  total_runs: number;
  last_backup: string | null;
  total_size: number;
}

interface RestorePreview {
  tables: { name: string; row_count: number }[];
  metadata: Record<string, string>;
  checksum_verified: boolean;
}

type ConfigFormData = Omit<BackupConfig, 'id'>;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PROVIDERS: { value: string; label: string; color: string }[] = [
  { value: 'local', label: 'Local', color: 'bg-gray-500/15 text-[var(--text-muted)] border-gray-500/30' },
  { value: 's3', label: 'Amazon S3', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  { value: 'azure', label: 'Azure Blob', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  { value: 'gcs', label: 'Google Cloud', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
];

const STATUS_CONFIG: Record<
  string,
  { color: string; bg: string; icon: typeof CheckCircle2; variant: 'success' | 'danger' | 'info' | 'neutral' }
> = {
  completed: { color: 'text-neon-green', bg: 'bg-neon-green/15', icon: CheckCircle2, variant: 'success' },
  failed: { color: 'text-neon-red', bg: 'bg-neon-red/15', icon: XCircle, variant: 'danger' },
  running: { color: 'text-neon-cyan', bg: 'bg-neon-cyan/15', icon: Loader2, variant: 'info' },
  queued: { color: 'text-[var(--text-muted)]', bg: 'bg-gray-500/15', icon: Timer, variant: 'neutral' },
};

const EMPTY_FORM: ConfigFormData = {
  name: '',
  enabled: true,
  backup_type: 'full',
  frequency_days: 1,
  max_retention: 7,
  provider: 'local',
  provider_config: {},
  compress: true,
  encrypt: false,
};

const BACKUP_TYPE_OPTIONS = [
  { value: 'full', label: 'Full' },
  { value: 'incremental', label: 'Incremental' },
];

const PROVIDER_OPTIONS = PROVIDERS.map((p) => ({ value: p.value, label: p.label }));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function providerFields(provider: string): { key: string; label: string }[] {
  switch (provider) {
    case 's3':
      return [
        { key: 'bucket', label: 'Bucket' },
        { key: 'prefix', label: 'Prefix' },
        { key: 'region', label: 'Region' },
      ];
    case 'azure':
      return [
        { key: 'container', label: 'Container' },
        { key: 'prefix', label: 'Prefix' },
      ];
    case 'gcs':
      return [
        { key: 'bucket', label: 'Bucket' },
        { key: 'prefix', label: 'Prefix' },
      ];
    default:
      return [{ key: 'path', label: 'Path' }];
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BackupRestorePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  usePageTitle(t('Backup & Restore'));

  /* ---- state ---- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BackupConfig | null>(null);
  const [form, setForm] = useState<ConfigFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<BackupConfig | null>(null);
  const [previewData, setPreviewData] = useState<RestorePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  /* ---- queries ---- */
  const { data: stats, isLoading: loadingStats } = useQuery<BackupStats>({
    queryKey: ['backup-stats'],
    queryFn: () => request<BackupStats>('/system/backup/stats'),
  });

  const {
    data: configs = [],
    isLoading: loadingConfigs,
    error: configsError,
  } = useQuery<BackupConfig[]>({
    queryKey: ['backup-configs'],
    queryFn: () => request<BackupConfig[]>('/system/backup/configs'),
  });

  const { data: runs = [], isLoading: loadingRuns } = useQuery<BackupRun[]>({
    queryKey: ['backup-runs'],
    queryFn: () => request<BackupRun[]>('/system/backup'),
  });

  const loading = loadingStats || loadingConfigs || loadingRuns;

  /* ---- mutations ---- */
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['backup-stats'] });
    qc.invalidateQueries({ queryKey: ['backup-configs'] });
    qc.invalidateQueries({ queryKey: ['backup-runs'] });
  };

  const createMutation = useMutation({
    mutationFn: (body: ConfigFormData) =>
      request<BackupConfig>('/system/backup/configs', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('Config created'));
      closeModal();
    },
    onError: () => toast.error(t('Failed to create config')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ConfigFormData }) =>
      request<BackupConfig>(`/system/backup/configs/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('Config updated'));
      closeModal();
    },
    onError: () => toast.error(t('Failed to update config')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      request<void>(`/system/backup/configs/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('Config deleted'));
      setDeleteTarget(null);
    },
    onError: () => toast.error(t('Failed to delete config')),
  });

  const triggerMutation = useMutation({
    mutationFn: (configId: number) =>
      request<void>(`/system/backup/trigger/${configId}`, { method: 'POST' }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('Backup triggered'));
    },
    onError: () => toast.error(t('Failed to trigger backup')),
  });

  const quickBackupMutation = useMutation({
    mutationFn: () => request<void>('/system/backup/quick', { method: 'POST' }),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('Quick backup started'));
    },
    onError: () => toast.error(t('Quick backup failed')),
  });

  const verifyMutation = useMutation({
    mutationFn: (runId: number) =>
      request<{ verified: boolean }>(`/system/backup/${runId}/verify`, { method: 'POST' }),
    onSuccess: (data) => {
      if (data.verified) toast.success(t('Checksum verified'));
      else toast.warning(t('Checksum mismatch'));
    },
    onError: () => toast.error(t('Verification failed')),
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
    window.open(`/api/system/backup/${runId}/download`, '_blank');
  }, []);

  const handlePreview = useCallback(async (runId: number) => {
    try {
      const data = await request<RestorePreview>(`/system/backup/${runId}/preview`);
      setPreviewData(data);
      setPreviewOpen(true);
    } catch {
      toast.error(t('Failed to load preview'));
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
      header: t('Name'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {!row.enabled && (
            <Badge variant="neutral" size="sm">{t('Disabled')}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'backup_type',
      header: t('Type'),
      render: (row) => (
        <Badge variant="info" size="sm">
          {row.backup_type === 'full' ? t('Full') : t('Incremental')}
        </Badge>
      ),
    },
    {
      key: 'provider',
      header: t('Provider'),
      render: (row) => {
        const p = PROVIDERS.find((pr) => pr.value === row.provider);
        return (
          <span className={clsx('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', p?.color)}>
            {p?.label ?? row.provider}
          </span>
        );
      },
    },
    {
      key: 'frequency',
      header: t('Frequency'),
      render: (row) => (
        <span className="text-sm text-[var(--text-secondary)]">
          {t('Every')} {row.frequency_days}{row.frequency_days === 1 ? t('d') : t('d')}
        </span>
      ),
    },
    {
      key: 'options',
      header: t('Options'),
      render: (row) => (
        <div className="flex gap-1.5">
          {row.compress && <Badge variant="neutral" size="sm">{t('Compress')}</Badge>}
          {row.encrypt && <Badge variant="warning" size="sm">{t('Encrypt')}</Badge>}
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
            icon={<Play className="h-3.5 w-3.5" />}
            onClick={() => triggerMutation.mutate(row.id)}
            loading={triggerMutation.isPending}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={() => openEdit(row)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="h-3.5 w-3.5 text-neon-red" />}
            onClick={() => setDeleteTarget(row)}
          />
        </div>
      ),
    },
  ];

  /* ---- columns: runs ---- */
  const runColumns: Column<BackupRun>[] = [
    {
      key: 'created_at',
      header: t('Time'),
      sortable: true,
      render: (row) => (
        <span className="text-sm text-[var(--text-secondary)]">
          {formatDateTime(row.created_at)}
        </span>
      ),
    },
    {
      key: 'config_name',
      header: t('Config'),
      render: (row) => <span className="font-medium">{row.config_name ?? `#${row.config_id}`}</span>,
    },
    {
      key: 'status',
      header: t('Status'),
      sortable: true,
      render: (row) => {
        const s = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.queued;
        const Icon = s.icon;
        return (
          <div className="flex items-center gap-1.5">
            <Icon className={clsx('h-4 w-4', s.color, row.status === 'running' && 'animate-spin')} />
            <Badge variant={s.variant} size="sm">{t(row.status)}</Badge>
          </div>
        );
      },
    },
    {
      key: 'backup_type',
      header: t('Type'),
      render: (row) => <Badge variant="info" size="sm">{row.backup_type}</Badge>,
    },
    {
      key: 'file_size',
      header: t('Size'),
      sortable: true,
      render: (row) => (
        <span className="text-sm tabular-nums">{row.file_size ? formatBytes(row.file_size) : '—'}</span>
      ),
    },
    {
      key: 'duration',
      header: t('Duration'),
      render: (row) => (
        <span className="text-sm tabular-nums text-[var(--text-muted)]">
          {row.duration_ms != null ? formatDuration(row.duration_ms) : '—'}
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
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() => handleDownload(row.id)}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              onClick={() => verifyMutation.mutate(row.id)}
              loading={verifyMutation.isPending}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={<Eye className="h-3.5 w-3.5" />}
              onClick={() => handlePreview(row.id)}
            />
          </div>
        ) : null,
    },
  ];

  /* ---- preview table columns ---- */
  const previewColumns: Column<{ name: string; row_count: number }>[] = [
    { key: 'name', header: t('Table'), render: (row) => <span className="font-medium">{row.name}</span> },
    {
      key: 'row_count',
      header: t('Rows'),
      render: (row) => <span className="tabular-nums">{fmtInt(row.row_count)}</span>,
    },
  ];

  /* ---- render ---- */
  return (
    <PageContainer
      title={t('Backup & Restore')}
      subtitle={t('Manage automated backups and restore points')}
      loading={loading}
      error={configsError as Error | null}
      actions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Zap className="h-4 w-4" />}
            onClick={() => quickBackupMutation.mutate()}
            loading={quickBackupMutation.isPending}
          >
            {t('Quick Backup')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="h-4 w-4" />}
            onClick={openCreate}
          >
            {t('New Config')}
          </Button>
        </div>
      }
    >
      {/* ---- stats row ---- */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={88} rounded />)
          ) : (
            <>
              <MetricCard
                label={t('Total Configs')}
                value={fmtInt(stats?.total_configs ?? configs.length)}
                icon={<Database className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('Total Backups')}
                value={fmtInt(stats?.total_runs ?? runs.length)}
                icon={<HardDrive className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('Last Backup')}
                value={stats?.last_backup ? formatRelative(stats.last_backup) : '—'}
                icon={<Clock className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('Total Size')}
                value={formatBytes(stats?.total_size ?? 0)}
                icon={<HardDrive className="h-5 w-5" />}
              />
            </>
          )}
        </div>
      </FadeIn>

      {/* ---- backup configurations ---- */}
      <FadeIn delay={0.1}>
        <GlassPanel className="mt-6">
          <h2 className="mb-4 text-lg font-semibold">{t('Backup Configurations')}</h2>
          {configs.length === 0 && !loadingConfigs ? (
            <EmptyState
              icon={<Database className="h-10 w-10 text-[var(--text-muted)]" />}
              title={t('No backup configurations')}
              message={t('Create a backup configuration to start protecting your data.', '')}
              action={{ label: t('New Config'), onClick: openCreate }}
            />
          ) : (
            <DataTable<BackupConfig>
              columns={configColumns}
              data={configs}
              keyExtractor={(r) => r.id}
              emptyMessage={t('No backup configurations')}
              compact
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- backup runs history ---- */}
      <FadeIn delay={0.2}>
        <GlassPanel className="mt-6">
          <h2 className="mb-4 text-lg font-semibold">{t('Backup History')}</h2>
          {runs.length === 0 && !loadingRuns ? (
            <EmptyState
              icon={<Clock className="h-10 w-10 text-[var(--text-muted)]" />}
              title={t('No backup runs yet')}
              message={t('Trigger a backup or wait for the scheduled run.', '')}
            />
          ) : (
            <DataTable<BackupRun>
              columns={runColumns}
              data={runs}
              keyExtractor={(r) => r.id}
              emptyMessage={t('No backup runs yet')}
              compact
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- create / edit config modal ---- */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingConfig ? t('Edit Configuration') : t('New Configuration')}
        size="lg"
      >
        <div className="flex flex-col gap-5 p-1">
          <Input
            label={t('Name')}
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder={t('e.g. Daily Full Backup', ' Daily Full Backup')}
          />

          <Toggle
            label={t('Enabled')}
            checked={form.enabled}
            onChange={(v) => setField('enabled', v)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              label={t('Backup Type')}
              options={BACKUP_TYPE_OPTIONS}
              value={form.backup_type}
              onChange={(e) => setField('backup_type', e.target.value as 'full' | 'incremental')}
            />
            <Select
              label={t('Provider')}
              options={PROVIDER_OPTIONS}
              value={form.provider}
              onChange={(e) => {
                setField('provider', e.target.value as BackupConfig['provider']);
                setField('provider_config', {});
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('Frequency (days)')}
              type="number"
              value={String(form.frequency_days)}
              onChange={(e) => setField('frequency_days', Math.max(1, Number(e.target.value)))}
            />
            <Input
              label={t('Max Retention')}
              type="number"
              value={String(form.max_retention)}
              onChange={(e) => setField('max_retention', Math.max(1, Number(e.target.value)))}
            />
          </div>

          {/* dynamic provider fields */}
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
            <p className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
              {t('Provider Settings')}
            </p>
            <div className="grid gap-3">
              {providerFields(form.provider).map((f) => (
                <Input
                  key={f.key}
                  label={f.label}
                  value={form.provider_config[f.key] ?? ''}
                  onChange={(e) => setProviderField(f.key, e.target.value)}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-6">
            <Toggle
              label={t('Compress')}
              checked={form.compress}
              onChange={(v) => setField('compress', v)}
            />
            <Toggle
              label={t('Encrypt')}
              checked={form.encrypt}
              onChange={(v) => setField('encrypt', v)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={closeModal}>
              {t('Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={createMutation.isPending || updateMutation.isPending}
              disabled={!form.name.trim()}
            >
              {editingConfig ? t('Save Changes') : t('Create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---- delete confirm dialog ---- */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('Delete Configuration')}
        message={t('Are you sure you want to delete "{{name}}"? This cannot be undone.', {
          name: deleteTarget?.name,
        })}
        variant="danger"
        confirmLabel={t('Delete')}
        cancelLabel={t('Cancel')}
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
        title={t('Restore Preview')}
        size="md"
      >
        {previewData && (
          <div className="flex flex-col gap-4 p-1">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck
                className={clsx(
                  'h-4 w-4',
                  previewData.checksum_verified ? 'text-neon-green' : 'text-neon-red',
                )}
              />
              <span>
                {previewData.checksum_verified
                  ? t('Checksum verified')
                  : t('Checksum mismatch')}
              </span>
            </div>

            {previewData.tables.length > 0 ? (
              <DataTable<{ name: string; row_count: number }>
                columns={previewColumns}
                data={previewData.tables}
                keyExtractor={(r) => r.name}
                compact
              />
            ) : (
              <EmptyState message={t('No tables found in backup')} />
            )}

            {Object.keys(previewData.metadata).length > 0 && (
              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <p className="mb-2 text-sm font-medium text-[var(--text-secondary)]">
                  {t('Metadata')}
                </p>
                <div className="space-y-1 text-xs">
                  {Object.entries(previewData.metadata).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-[var(--text-muted)]">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setPreviewOpen(false);
                  setPreviewData(null);
                }}
              >
                {t('Close')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </PageContainer>
  );
}
