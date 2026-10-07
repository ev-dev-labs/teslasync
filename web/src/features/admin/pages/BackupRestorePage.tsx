import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageLayout, LayoutCard, SourceContent } from '@/components/layout';
import {
  Badge,
  Button,
  Input,
  Select,
  Modal,
  Toggle,
  ConfirmDialog,
  DataTable,
  Textarea,
  PanelTitle,
  Text,
  Label,
  type Column,
} from '@/components/ui';
import { MetricBar, TimeStamp, type StatMetric } from '@/components/data-display';
import { AdminSummary } from '../components/operationalbrief-a-g/AdminSummary';
import {
  EmptyState,
  InlineCallout,
  QueryError,
  Skeleton,
  TableSkeleton,
  useToast,
} from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatRelative } from '@/lib/dateFormat';

import { cn } from '@/lib/cn';
import { chartTokens } from '@/lib/tokens';
import { request, apiUrl } from '@/api/client';
import { Icons } from '@/lib/icons';
// Settings JSON bundle export/import — reused from features/settings to
// give the dedicated /backup page a single canonical home for "backup &
// restore" surfaces (was previously also rendered as <section id="backup">
// inside SettingsPage, which read as a duplicate of this page).
import { SettingsExportImport } from '@/features/settings/components/SettingsExportImport';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FormSection } from '@/components/forms';
import { deriveDataState } from '@/api/dataState';

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

interface ProviderUsage {
  provider: string;
  count: number;
  size: number;
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

// Storage-bar tint per provider. Colours come from the colour-blind-safe
// chart series so the side panel stays consistent with the rest of the app.
const PROVIDER_COLOR: Record<string, string> = {
  local: chartTokens.series[0],
  s3: chartTokens.series[2],
  azure: chartTokens.series[5],
  gcs: chartTokens.series[1],
};

// Status glyph + toned-down (300-level) foreground colour + badge variant.
// Neon hues are intentionally avoided for the icon foreground — status is
// still colour-independent because it is paired with the labelled Badge.
const STATUS_CONFIG: Record<
  string,
  { color: string; icon: typeof Icons.successFilled; variant: 'success' | 'danger' | 'info' | 'neutral' }
> = {
  completed: { color: 'text-emerald-300', icon: Icons.successFilled, variant: 'success' },
  failed: { color: 'text-rose-300', icon: Icons.error, variant: 'danger' },
  running: { color: 'text-cyan-300', icon: Icons.loading, variant: 'info' },
  queued: { color: 'text-[var(--text-muted)]', icon: Icons.timer, variant: 'neutral' },
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

// Provider-specific credential/config fields. `label` doubles as the i18n
// fallback via `t('backup.field.<key>', label)` so the visible label is
// translatable while the example placeholders stay as literal technical values.
const PROVIDER_FIELDS: Record<string, { key: string; label: string; type?: string; required?: boolean; placeholder?: string }[]> = {
  local: [
    { key: 'path', label: 'Path', required: true, placeholder: '/backups' },
  ],
  s3: [
    { key: 'bucket', label: 'Bucket', required: true, placeholder: 'my-backup-bucket' },
    { key: 'region', label: 'Region', required: true, placeholder: 'us-east-1' },
    { key: 'access_key', label: 'Access key', required: true },
    { key: 'secret_key', label: 'Secret key', required: true, type: 'password' },
    { key: 'endpoint', label: 'Endpoint (optional)', placeholder: 'https://s3.amazonaws.com' },
    { key: 'prefix', label: 'Prefix (optional)', placeholder: 'backups/' },
  ],
  azure: [
    { key: 'account_name', label: 'Account name', required: true },
    { key: 'account_key', label: 'Account key', required: true, type: 'password' },
    { key: 'container_name', label: 'Container name', required: true },
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
  const { formatDurationMsCompact } = useNumberFormatting();
  const { formatBytes, fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  usePageTitle(t('backup.title', 'Backup & restore'));

  /* ---- state ---- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BackupConfig | null>(null);
  const [form, setForm] = useState<ConfigFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<BackupConfig | null>(null);
  const [previewData, setPreviewData] = useState<RestorePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  /* ---- queries ---- */
  const configsQuery = useQuery<BackupConfig[]>({
    queryKey: ['backup-configs'],
    queryFn: () => request<BackupConfig[]>('/backup/configs'),
  });

  const runsQuery = useQuery<BackupRun[]>({
    queryKey: ['backup-runs'],
    queryFn: () => request<BackupRun[]>('/backup/runs'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.some((r) => r.status === 'queued' || r.status === 'running')) return 5000;
      return 30000;
    },
  });
  const dataSources = useMemo(
    () => [
      {
        id: 'backup-configurations',
        label: t('dataSources.labels.backupConfigurations', 'Backup configurations'),
        query: configsQuery,
      },
      {
        id: 'backup-runs',
        label: t('dataSources.labels.backupRuns', 'Backup runs'),
        query: runsQuery,
      },
    ],
    [configsQuery, runsQuery, t],
  );

  const configs = configsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const loadingConfigs = configsQuery.isLoading;
  const loadingRuns = runsQuery.isLoading;
  const configsState = deriveDataState(configsQuery);
  const runsState = deriveDataState(runsQuery);
  const configsError = configsState.fatalError;
  const runsError = runsState.fatalError;

  /* ---- derived stats ---- */
  const stats = useMemo(() => {
    const totalBackups = runs.length;
    const completedCount = runs.filter((r) => r.status === 'completed').length;
    const failedCount = runs.filter((r) => r.status === 'failed').length;
    const lastBackup = runs.find((r) => r.status === 'completed') ?? null;
    const totalSize = runs.reduce((sum, r) => sum + (r.file_size ?? 0), 0);
    const successRate = totalBackups > 0 ? (completedCount / totalBackups) * 100 : 0;
    return { totalBackups, completedCount, failedCount, lastBackup, totalSize, successRate };
  }, [runs]);

  const summaryMetrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'configs', label: t('backup.totalConfigs', 'Total configs'),
      rawValue: configsState.hasData ? configs.length : undefined },
    { metricId: 'count', occurrenceId: 'backups', label: t('backup.totalBackups', 'Total backups'),
      rawValue: runsState.hasData ? stats.totalBackups : undefined },
    { metricId: 'percent', occurrenceId: 'success', label: t('backup.successRate', 'Success rate'),
      rawValue: runsState.hasData && stats.totalBackups > 0 ? stats.successRate : undefined,
      display: { formatter: raw => ({ value: fmtPercent(raw), unit: '' }) } },
    { metricId: 'count', occurrenceId: 'failed', label: t('backup.failedRuns', 'Failed runs'),
      rawValue: runsState.hasData ? stats.failedCount : undefined },
    { metricId: 'text', occurrenceId: 'last', label: t('backup.lastBackup', 'Last backup'),
      rawValue: stats.lastBackup ? formatRelative(stats.lastBackup.completed_at ?? stats.lastBackup.created_at) : undefined,
      context: stats.lastBackup ? <TimeStamp value={stats.lastBackup.completed_at ?? stats.lastBackup.created_at} /> : undefined },
    { metricId: 'bytes', occurrenceId: 'size', label: t('backup.totalSize', 'Total size'),
      rawValue: runsState.hasData ? stats.totalSize : undefined,
      display: { formatter: raw => ({ value: formatBytes(raw), unit: '' }) } },
  ];
  const summaryStatus = configsState.status === 'stale' || runsState.status === 'stale'
    ? 'stale' : configsState.isRefreshing || runsState.isRefreshing ? 'refreshing'
      : configsState.hasData && runsState.hasData ? 'ready'
      : configsState.hasData || runsState.hasData ? 'partial'
        : configsError || runsError ? 'error' : 'initial';

  const failedRuns = useMemo(
    () => runs.filter((r) => r.status === 'failed' && r.error_message).slice(0, 5),
    [runs],
  );

  // Per-provider storage footprint for the reliability side panel.
  const providerBreakdown = useMemo<ProviderUsage[]>(() => {
    const map = new Map<string, { count: number; size: number }>();
    for (const r of runs) {
      const key = r.provider || 'local';
      const cur = map.get(key) ?? { count: 0, size: 0 };
      cur.count += 1;
      cur.size += r.file_size ?? 0;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([provider, v]) => ({ provider, count: v.count, size: v.size }))
      .sort((a, b) => b.size - a.size);
  }, [runs]);

  const maxProviderSize = useMemo(
    () => Math.max(1, ...providerBreakdown.map((p) => p.size)),
    [providerBreakdown],
  );

  /* ---- i18n label helpers ---- */
  const providerLabel = useCallback(
    (v: string) => t(`backup.provider.${v}`, PROVIDERS.find((p) => p.value === v)?.label ?? v),
    [t],
  );

  const backupTypeOptions = useMemo(
    () => [
      { value: 'full', label: t('backup.full', 'Full') },
      { value: 'incremental', label: t('backup.incremental', 'Incremental') },
    ],
    [t],
  );

  const providerOptions = useMemo(
    () => PROVIDERS.map((p) => ({ value: p.value, label: providerLabel(p.value) })),
    [providerLabel],
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
      // The endpoint may answer 204 (no body) on some deployments — request()
      // resolves that to `undefined`, so the response is modelled as nullable
      // and read defensively below rather than assuming `{ verified }` exists.
      request<{ verified: boolean } | null>(`/backup/runs/${runId}/verify`, { method: 'POST' }),
    onSuccess: (data) => {
      if (data?.verified) toast.success(t('backup.checksumVerified', 'Checksum verified'));
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
    // Direct browser navigation (not the request() client) needs the fully
    // qualified URL. apiUrl() is the canonical builder that prepends the
    // /api/v1 base exactly the way request() does, so downloads can never
    // drift out of sync with the client or double-prefix the path.
    window.open(apiUrl(`/backup/runs/${runId}/download`), '_blank');
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
      filterValue: (row) => row.name ?? null,
      header: t('backup.name', 'Name'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Text weight="medium" color="primary">{row.name}</Text>
          {!row.enabled && (
            <Badge variant="neutral" size="sm">{t('backup.disabled', 'Disabled')}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'backup_type',
      filterValue: (row) => row.backup_type ?? null,
      filterValueLabel: (_value, row) => row.backup_type === 'full' ? t('backup.full', 'Full') : t('backup.incremental', 'Incremental'),
      header: t('backup.type', 'Type'),
      render: (row) => (
        <Badge variant={row.backup_type === 'full' ? 'info' : 'warning'} size="sm">
          {row.backup_type === 'full' ? t('backup.full', 'Full') : t('backup.incremental', 'Incremental')}
        </Badge>
      ),
    },
    {
      key: 'provider',
      filterValue: (row) => row.provider ?? null,
      filterValueLabel: (_value, row) => providerLabel(row.provider),
      header: t('backup.provider', 'Provider'),
      render: (row) => {
        const ProvIcon = PROVIDER_ICON[row.provider] ?? Icons.cloud;
        return (
          <Badge variant={PROVIDER_BADGE_VARIANT[row.provider] ?? 'neutral'} size="sm">
            <ProvIcon className="mr-1 h-3 w-3" aria-hidden="true" />
            {providerLabel(row.provider)}
          </Badge>
        );
      },
    },
    {
      key: 'frequency',
      filterValue: (row) => row.frequency_days ?? null,
      align: 'right',
      header: t('backup.frequency', 'Frequency'),
      render: (row) => (
        <Text size="sm" color="secondary">
          {row.frequency_days === 1 ? t('backup.daily', 'Daily') : t('backup.everyNDays', { days: row.frequency_days, defaultValue: 'Every {{days}}d' })}
        </Text>
      ),
    },
    {
      key: 'schedule',
      header: t('backup.schedule', 'Schedule'),
      render: (row) => (
        <div className="space-y-0.5">
          <Text as="p" variant="caption">{t('backup.lastRun', 'Last')}: <Text color="secondary">{row.last_run_at ? formatRelative(row.last_run_at) : '—'}</Text></Text>
          <Text as="p" variant="caption">{t('backup.nextRun', 'Next')}: <Text color="secondary">{row.next_run_at ? formatRelative(row.next_run_at) : '—'}</Text></Text>
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
            icon={<Icons.delete className="h-3.5 w-3.5 text-rose-300" />}
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
      filterValue: (row) => row.created_at ?? null,
      header: t('backup.time', 'Time'),
      sortable: true,
      render: (row) => (
        <TimeStamp value={row.created_at} className="text-sm text-[var(--text-secondary)]" />
      ),
    },
    {
      key: 'run_type',
      filterValue: (row) => row.run_type ?? null,
      filterValueLabel: (_value, row) => t(`backup.runType.${row.run_type}`, row.run_type),
      header: t('backup.runType', 'Run type'),
      render: (row) => (
        <Badge
          variant={({ backup: 'info', restore: 'success', quick: 'warning' } as Record<string, 'info' | 'success' | 'warning'>)[row.run_type] ?? 'neutral'}
          size="sm"
        >
          {t(`backup.runType.${row.run_type}`, row.run_type)}
        </Badge>
      ),
    },
    {
      key: 'status',
      filterValue: (row) => row.status ?? null,
      header: t('backup.status', 'Status'),
      sortable: true,
      render: (row) => {
        const s = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.queued;
        const Icon = s.icon;
        return (
          <div className="flex items-center gap-1.5">
            <Icon className={cn('h-4 w-4', s.color, row.status === 'running' && 'animate-spin')} aria-hidden="true" />
            <Badge variant={s.variant} size="sm">{t(`backup.status.${row.status}`, row.status)}</Badge>
          </div>
        );
      },
    },
    {
      key: 'provider',
      filterValue: (row) => row.provider ?? null,
      filterValueLabel: (_value, row) => providerLabel(row.provider),
      header: t('backup.provider', 'Provider'),
      render: (row) => (
        <Badge variant={PROVIDER_BADGE_VARIANT[row.provider] ?? 'neutral'} size="sm">
          {providerLabel(row.provider)}
        </Badge>
      ),
    },
    {
      key: 'file_name',
      filterValue: (row) => row.file_name ?? null,
      header: t('backup.file', 'File'),
      render: (row) => (
        <Text mono size="xs" color="secondary" className="block break-all">
          {row.file_name ?? '—'}
        </Text>
      ),
    },
    {
      key: 'file_size',
      filterValue: (row) => row.file_size ?? null,
      filterValueLabel: (_value, row) => row.file_size == null ? '—' : formatBytes(row.file_size),
      align: 'right',
      groupStart: true,
      header: t('backup.size', 'Size'),
      sortable: true,
      render: (row) => (
        <Text size="sm" color="primary" className="tabular-nums">{row.file_size != null ? formatBytes(row.file_size) : '—'}</Text>
      ),
    },
    {
      key: 'record_count',
      filterValue: (row) => row.record_count ?? null,
      filterValueLabel: (_value, row) => fmtInt(row.record_count),
      align: 'right',
      header: t('backup.records', 'Records'),
      render: (row) => (
        <Text mono size="sm" color="secondary" className="tabular-nums">
          {row.record_count > 0 ? fmtInt(row.record_count) : '—'}
        </Text>
      ),
    },
    {
      key: 'duration',
      filterValue: (row) => row.duration_ms ?? null,
      filterValueLabel: (_value, row) => formatDurationMsCompact(row.duration_ms),
      align: 'right',
      header: t('backup.duration', 'Duration'),
      render: (row) => (
        <Text size="sm" color="muted" className="tabular-nums">
          {row.duration_ms > 0 ? formatDurationMsCompact(row.duration_ms) : '—'}
        </Text>
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
    { key: 'name', filterValue: (row) => row.name ?? null, header: t('backup.table', 'Hypertable'), render: (row) => <Text mono weight="medium" color="primary">{row.name}</Text> },
    {
      key: 'rows',
      filterValue: (row) => row.rows ?? null,
      filterValueLabel: (_value, row) => fmtInt(row.rows),
      align: 'right',
      header: t('backup.rows', 'Rows'),
      render: (row) => <Text color="secondary" className="tabular-nums">{fmtInt(row.rows)}</Text>,
    },
  ];

  // Defensive: the type contract says non-null, but harden against a
  // backend returning `tables: null` so the modal never crashes on `.length`.
  const previewTables = previewData?.tables ?? [];
  const configsEmpty = (
    <EmptyState
      icon={<Icons.database className="h-10 w-10 text-[var(--text-muted)]" />}
      title={t('backup.noConfigs', 'No backup configurations')}
      message={t('backup.noConfigsMessage', 'Create a backup configuration to start protecting your data.')}
      action={{ label: t('backup.newConfig', 'New config'), onClick: openCreate }}
    />
  );
  const runsEmpty = (
    <EmptyState
      icon={<Icons.clock className="h-10 w-10 text-[var(--text-muted)]" />}
      title={t('backup.noRuns', 'No backup runs yet')}
      message={t('backup.noRunsMessage', 'Trigger a backup or wait for the scheduled run.')}
      action={{ label: t('backup.quickBackup', 'Quick backup'), onClick: () => quickBackupMutation.mutate() }}
    />
  );

  /* ---- render ---- */
  return (
    <PageLayout
      title={t('backup.title', 'Backup & restore')}
      subtitle={t('backup.subtitle', 'Manage automated backups and restore points')}
      query={[configsQuery, runsQuery]}
      dataSources={dataSources}
      secondaryActions={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Icons.charging className="h-4 w-4" />}
            onClick={() => quickBackupMutation.mutate()}
            loading={quickBackupMutation.isPending}
          >
            {t('backup.quickBackup', 'Quick backup')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Icons.add className="h-4 w-4" />}
            onClick={openCreate}
          >
            {t('backup.newConfig', 'New config')}
          </Button>
        </div>
      }
    >
      {/* ── 1 · KPI band — full-width responsive metric grid ────────── */}
      <FadeIn>
        <AdminSummary metrics={summaryMetrics} testId="backup-restore-summary"
          eyebrow={t('backup.title', 'Backup & restore')} title={t('backup.overview', 'Backup overview')}
          description={t('backup.summary.source', 'Configuration counts use the loaded configurations. Run counts, completion rate, last completed backup and storage size use the returned run list, not a server-wide total.')}
          scope={t('backup.summary.scope', 'Independent configuration and run snapshots; run-list coverage and observation bounds are not supplied.')}
          sourceStatus={summaryStatus}
          loading={!configsState.hasData && !runsState.hasData && (loadingConfigs || loadingRuns)} />
      </FadeIn>

      {/* ── 2 · Primary bento — configs (hero) + reliability (side) ──── */}
      <section
        aria-label={t('backup.manage', 'Backup management')}
        className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
      >
        {/* Backup configurations — hero, spans two of three columns on wide */}
        <FadeIn delay={0.1} className="h-full min-w-0 xl:col-span-2">
          <LayoutCard
            title={t('backup.configurations', 'Backup configurations')}
            actions={!loadingConfigs && configsState.hasData && (
                <Badge variant="neutral" size="sm">{fmtInt(configs.length)}</Badge>
            )}
          >
            {configsError ? (
              <QueryError error={configsError} onRetry={() => configsQuery.refetch()} />
            ) : (
              <SourceContent
                state={loadingConfigs ? 'loading' : configsState.status === 'stale' ? 'retained' : configs.length === 0 ? 'empty' : 'ready'}
                label={t('backup.configurations', 'Backup configurations')}
                emptyMessage={t('backup.noConfigs', 'No backup configurations')}
                errorMessage={t('backup.configurations', 'Backup configurations')}
                loadingContent={<Skeleton height={280} />}
                emptyContent={configsEmpty}
              >
              {configs.length === 0 ? configsEmpty : (
              <DataTable<BackupConfig>
                tableId="admin:backup-configs"
                columns={configColumns}
                mobileColumns={['name', 'provider', 'schedule']}
                data={configs}
                enableValueFilters
                keyExtractor={(r) => r.id}
                emptyMessage={t('backup.noConfigs', 'No backup configurations')}
                compact
                pagination
              />
              )}
              </SourceContent>
            )}
          </LayoutCard>
        </FadeIn>

        {/* Reliability & storage — success rate, per-provider footprint, recent errors */}
        <FadeIn delay={0.15} className="h-full xl:col-span-1">
          <LayoutCard title={t('backup.reliability', 'Reliability & storage')}>
            {loadingRuns ? (
              <Skeleton height={260} />
            ) : runsError ? (
              <QueryError error={runsError} onRetry={() => runsQuery.refetch()} />
            ) : runs.length === 0 ? (
              // no-action: the Backup History panel below owns the "Quick
              // Backup" CTA for this same runs===0 condition — avoid duplicating it here.
              <EmptyState
                icon={<Icons.archive className="h-10 w-10 text-[var(--text-muted)]" />}
                message={t('backup.noRunsReliability', 'No backup runs to analyze yet.')}
              />
            ) : (
              <>
                {/* Success rate */}
                <div>
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <PanelTitle>{t('backup.successRate', 'Success rate')}</PanelTitle>
                    <Text as="span" size="2xl" weight="bold" color="primary" className="tabular-nums">
                      {stats.totalBackups > 0 ? fmtPercent(stats.successRate) : '—'}
                    </Text>
                  </div>
                  <MetricBar
                    label={t('backup.completedVsTotal', 'Completed vs total')}
                    value={stats.completedCount}
                    max={Math.max(1, stats.totalBackups)}
                    color={chartTokens.series[1]}
                    sublabel={`${fmtInt(stats.completedCount)} / ${fmtInt(stats.totalBackups)}`}
                  />
                </div>

                {/* Storage by provider */}
                <div className="space-y-3">
                  <PanelTitle>{t('backup.storageByProvider', 'Storage by provider')}</PanelTitle>
                  {providerBreakdown.length === 0 ? (
                    <Text as="p" variant="caption">{t('backup.noStorage', 'No stored backups yet.')}</Text>
                  ) : (
                    <div className="space-y-3">
                      {providerBreakdown.map((p, i) => (
                        <MetricBar
                          key={p.provider}
                          label={providerLabel(p.provider)}
                          value={p.size}
                          max={maxProviderSize}
                          color={PROVIDER_COLOR[p.provider] ?? chartTokens.series[i % chartTokens.series.length]}
                          sublabel={`${formatBytes(p.size)} · ${fmtInt(p.count)}`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent errors */}
                <div className="space-y-2">
                  <PanelTitle>{t('backup.recentErrors', 'Recent errors')}</PanelTitle>
                  {failedRuns.length === 0 ? (
                    <InlineCallout variant="success" icon={<Icons.successFilled />}>
                      {t('backup.noErrors', 'No recent backup failures.')}
                    </InlineCallout>
                  ) : (
                    <div className="space-y-2">
                      {failedRuns.map((run) => (
                        <InlineCallout key={`err-${run.id}`} variant="danger" icon={<Icons.alertCircle />}>
                          <Text weight="medium">
                            {run.file_name ?? t('backup.runN', 'Run #{{id}}', { id: run.id })}
                          </Text>
                          {run.error_message ? ` — ${run.error_message}` : ''}
                        </InlineCallout>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </LayoutCard>
        </FadeIn>
      </section>

      {/* ── 3 · Detail band — full-width backup history ─────────────── */}
      <FadeIn delay={0.2}>
        <LayoutCard
          title={t('backup.history', 'Backup history')}
          actions={
          <>
              {!loadingRuns && runsState.hasData && (
                <Badge variant="neutral" size="sm">{fmtInt(runs.length)}</Badge>
              )}
            <Button
              variant="ghost"
              size="sm"
              icon={<Icons.refresh className="h-4 w-4" />}
              onClick={() => qc.invalidateQueries({ queryKey: ['backup-runs'] })}
            >
              {t('backup.refresh', 'Refresh')}
            </Button>
          </>
          }
        >
          {runsError ? (
            <QueryError error={runsError} onRetry={() => runsQuery.refetch()} />
          ) : (
            <SourceContent
              state={loadingRuns ? 'loading' : runsState.status === 'stale' ? 'retained' : runs.length === 0 ? 'empty' : 'ready'}
              label={t('backup.history', 'Backup history')}
              emptyMessage={t('backup.noRuns', 'No backup runs yet')}
              errorMessage={t('backup.history', 'Backup history')}
              loadingContent={<Skeleton height={320} />}
              emptyContent={runsEmpty}
            >
            {runs.length === 0 ? runsEmpty : (
            <DataTable<BackupRun>
              tableId="admin:backup-runs"
              columns={runColumns}
              mobileColumns={['file_name', 'status', 'created_at']}
              data={runs}
              enableValueFilters
              keyExtractor={(r) => r.id}
              emptyMessage={t('backup.noRuns', 'No backup runs yet')}
              compact
              pagination
            />
            )}
            </SourceContent>
          )}
        </LayoutCard>
      </FadeIn>

      {/* ── 4 · Portable settings JSON bundle ───────────────────────
          Lightweight "stash to git" export/import for the configuration
          subset (general settings, alert rules, geofences, quiet-hours).
          Distinct from the operational backup runs above — those are
          full-database snapshots driven by scheduled providers, this is
          a portable JSON bundle for fresh-install transfer. */}
      <FadeIn delay={0.25}>
        <SettingsExportImport />
      </FadeIn>

      {/* ── Create / edit config modal ─────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingConfig ? t('backup.editConfig', 'Edit configuration') : t('backup.newConfig', 'New configuration')}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label={t('backup.backupType', 'Backup type')}
              options={backupTypeOptions}
              value={form.backup_type}
              onChange={(e) => setField('backup_type', e.target.value)}
            />
            <Select
              label={t('backup.provider', 'Provider')}
              options={providerOptions}
              value={form.provider}
              onChange={(e) => {
                setField('provider', e.target.value);
                setField('provider_config', {});
              }}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('backup.frequencyDays', 'Frequency (days)')}
              type="number"
              value={String(form.frequency_days)}
              onChange={(e) => setField('frequency_days', Math.max(1, Number(e.target.value)))}
            />
            <Input
              label={t('backup.maxRetention', 'Max retention')}
              type="number"
              value={String(form.max_retention)}
              onChange={(e) => setField('max_retention', Math.max(1, Number(e.target.value)))}
            />
          </div>

          {/* dynamic provider fields */}
          <FormSection title={t('backup.providerSettings', 'Provider settings')}>
            <div className="grid gap-3">
              {(PROVIDER_FIELDS[form.provider] ?? []).map((field) => {
                const fieldLabel = t(`backup.field.${field.key}`, field.label) + (field.required ? ' *' : '');
                return (
                  <div key={field.key}>
                    {field.type === 'textarea' ? (
                      <Textarea
                        label={fieldLabel}
                        value={form.provider_config[field.key] ?? ''}
                        onChange={(e) => setProviderField(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        rows={3}
                      />
                    ) : (
                      <Input
                        label={fieldLabel}
                        type={field.type ?? 'text'}
                        value={form.provider_config[field.key] ?? ''}
                        onChange={(e) => setProviderField(field.key, e.target.value)}
                        placeholder={field.placeholder}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </FormSection>

          <div className="flex flex-wrap gap-6">
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
              {editingConfig ? t('backup.saveChanges', 'Save changes') : t('backup.create', 'Create')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Delete confirm dialog ──────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('backup.deleteConfig', 'Delete configuration')}
        message={t('backup.deleteConfigMessage', 'Are you sure you want to delete "{{name}}"? This cannot be undone.', {
          name: deleteTarget?.name,
        })}
        variant="danger"
        confirmLabel={t('backup.delete', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ── Restore preview modal ──────────────────────────────────── */}
      <Modal
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewData(null);
        }}
        title={t('backup.restorePreview', 'Restore preview')}
        size="md"
      >
        {previewData ? (
          <div className="flex flex-col gap-4 p-1">
            <div className="flex items-center gap-2">
              <Icons.securityCheck
                className={cn(
                  'h-4 w-4',
                  previewData.checksum_verified ? 'text-emerald-300' : 'text-rose-300',
                )}
                aria-hidden="true"
              />
              <Text as="span" size="sm" className={previewData.checksum_verified ? 'text-emerald-300' : 'text-rose-300'}>
                {previewData.checksum_verified
                  ? t('backup.checksumVerified', 'Checksum verified')
                  : t('backup.checksumFailed', 'Checksum verification failed')}
              </Text>
            </div>

            {previewTables.length > 0 ? (
              <div>
                <Label className="mb-2 block">
                  {t('backup.tables', 'Tables')} ({previewTables.length})
                </Label>
                <DataTable<{ name: string; rows: number }>
                  tableId="admin:backup-preview-tables"
                  columns={previewColumns}
                  data={previewTables}
                  enableValueFilters
                  keyExtractor={(r) => r.name}
                  compact
                  pagination
                />
              </div>
            ) : (
              // no-action: reflects the specific backup being previewed — its
              // table list is fixed at capture time; pick a different backup instead.
              <EmptyState message={t('backup.noTables', 'No tables found in backup')} />
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
          <TableSkeleton
            rows={5}
            cols={2}
            className="py-4"
          />
        )}
      </Modal>
    </PageLayout>
  );
}
