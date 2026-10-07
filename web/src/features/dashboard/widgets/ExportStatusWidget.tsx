import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui';
import { MetricBar, TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { exportDownloadUrl, useExports } from '@/api/hooks/useExports';
import { useExportJobs } from '@/api/hooks/useAdmin';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import type { ExportJob as ExportJobExport } from '@/types/export';
import type { ExportJob as ExportJobAdmin } from '@/types/admin';

// ── Normalised job shape used within this widget ─────────────────────

export interface NormalisedJob {
  id: string;
  format: string;
  filePath?: string;
  fileSize: number;
  createdAt: string;
}

function fromExportHook(j: ExportJobExport): NormalisedJob {
  return {
    id: j.id,
    format: j.format,
    filePath: j.filePath,
    fileSize: j.fileSize ?? 0,
    createdAt: j.createdAt,
  };
}

function fromAdminHook(j: ExportJobAdmin): NormalisedJob {
  return {
    id: j.id,
    format: j.format,
    filePath: undefined,
    fileSize: j.fileSize ?? 0,
    createdAt: j.createdAt,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'processing' | 'ready' | 'failed';

export function normaliseStatusFromAdmin(status: string | undefined): JobStatus {
  const s = (status ?? '').toLowerCase();
  if (s === 'processing' || s === 'running') return 'processing';
  if (s === 'ready' || s === 'done' || s === 'completed') return 'ready';
  if (s === 'failed' || s === 'error') return 'failed';
  return 'queued';
}

export function normaliseStatusFromExport(status: string | undefined): JobStatus {
  return normaliseStatusFromAdmin(status);
}

const STATUS_ORDER: Record<JobStatus, number> = {
  processing: 0,
  queued: 1,
  ready: 2,
  failed: 3,
};

const STATUS_BADGE: Record<JobStatus, { variant: 'neutral' | 'info' | 'success' | 'danger'; labelKey: string; label: string }> = {
  queued:     { variant: 'neutral', labelKey: 'widget.exportQueued',     label: 'Queued' },
  processing: { variant: 'info',    labelKey: 'widget.exportRunning',    label: 'Running' },
  ready:      { variant: 'success', labelKey: 'widget.exportDone',       label: 'Done' },
  failed:     { variant: 'danger',  labelKey: 'widget.exportFailed',     label: 'Failed' },
};

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function truncateFilename(path: string | undefined, maxLen: number): string {
  if (!path) return '—';
  const name = path.split('/').pop() || path;
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}

export function mergeExportJobs(
  exports: ExportJobExport[] | undefined,
  adminJobs: ExportJobAdmin[] | undefined,
): { job: NormalisedJob; status: JobStatus }[] {
  const byId = new Map<string, { job: NormalisedJob; status: JobStatus }>();

  for (const j of (exports ?? [])) {
    byId.set(j.id, {
      job: fromExportHook(j),
      status: normaliseStatusFromExport(j.fsmState),
    });
  }

  for (const j of (adminJobs ?? [])) {
    const existing = byId.get(j.id);
    const adminJob = fromAdminHook(j);
    byId.set(j.id, {
      job: {
        ...adminJob,
        filePath: existing?.job.filePath ?? adminJob.filePath,
      },
      status: normaliseStatusFromAdmin(j.status),
    });
  }

  const items = Array.from(byId.values());
  items.sort((a, b) => {
    const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (orderDiff !== 0) return orderDiff;
    const aTime = new Date(a.job.createdAt ?? 0).getTime();
    const bTime = new Date(b.job.createdAt ?? 0).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
  return items;
}

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  activeCount,
  hasRunning,
  t,
}: {
  activeCount: number;
  hasRunning: boolean;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <WidgetBigNumber
      value={activeCount}
      label={t('widget.exportActiveJobs', 'Active Exports')}
      badge={{
        text: hasRunning
          ? t('widget.exportRunningBadge', 'Running')
          : t('widget.exportIdleBadge', 'Idle'),
        variant: hasRunning ? 'success' : 'neutral',
      }}
    />
  );
}

// ── Job row ──────────────────────────────────────────────────────────

function JobRow({
  job,
  status,
  showDownload,
  t,
}: {
  job: NormalisedJob;
  status: JobStatus;
  showDownload: boolean;
  t: (key: string, fallback: string) => string;
}) {
  const cfg = STATUS_BADGE[status];
  const format = (job.format ?? '').toUpperCase() || '—';

  return (
    <div className="flex items-center gap-2 min-h-[44px] px-1 py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
      {/* Filename */}
      <span className="flex-1 min-w-0 truncate text-xs text-[var(--text-primary)]">
        {truncateFilename(job.filePath, 28)}
      </span>

      {/* Format badge */}
      <Badge variant="neutral" size="sm" className="shrink-0">
        {format}
      </Badge>

      {/* File size */}
      <span className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)] w-16 text-right">
        {fmtBytes(job.fileSize ?? 0)}
      </span>

      {/* Status badge */}
      <Badge variant={cfg.variant} size="sm" className="shrink-0 min-w-[52px] justify-center">
        {t(cfg.labelKey, cfg.label)}
      </Badge>

      {/* Relative time */}
      <span className="shrink-0 w-14 text-right">
        <TimeStamp value={job.createdAt} className="text-2xs text-[var(--text-muted)]" />
      </span>

      {/* Download link — wide only */}
      {showDownload && (
        job.filePath && status === 'ready' ? (
          <a
            href={exportDownloadUrl(job.id)}
            aria-label={t('widget.exportDownload', 'Download')}
            className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center text-cyan-300 hover:text-[var(--text-primary)] transition-colors"
            title={t('widget.exportDownload', 'Download')}
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span className="shrink-0 w-[44px]" />
        )
      )}
    </div>
  );
}

// ── Standard list with optional progress bars ────────────────────────

function StandardView({
  jobs,
  showDownload,
  maxItems,
  t,
}: {
  jobs: { job: NormalisedJob; status: JobStatus }[];
  showDownload: boolean;
  maxItems: number;
  t: (key: string, fallback: string) => string;
}) {
  const visible = jobs.slice(0, maxItems);

  if (visible.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={<Download className="h-5 w-5" />}
        message={t('widget.noExportJobs', 'No export jobs')}
        className="py-4"
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {visible.map(({ job, status }) => (
        <div key={job.id}>
          <JobRow job={job} status={status} showDownload={showDownload} t={t} />
          {status === 'processing' && (
            <div className="px-1 pb-1.5">
              <MetricBar value={50} max={100} color="#22d3ee" label="" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function ExportStatusWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const {
    data: exports,
    isLoading: exportsLoading,
    isFetching: exportsFetching,
    isStale: exportsStale,
    isError: exportsIsError,
    dataUpdatedAt: exportsUpdatedAt,
    refetch: exportsRefetch,
  } = useExports();

  const {
    data: adminJobs,
    isLoading: adminLoading,
    isFetching: adminFetching,
    isStale: adminStale,
    isError: adminIsError,
    dataUpdatedAt: adminUpdatedAt,
    refetch: adminRefetch,
  } = useExportJobs();

  const isLoading = exportsLoading || adminLoading;
  const isFetching = exportsFetching || adminFetching;
  const isStale = exportsStale || adminStale;
  const isError = exportsIsError || adminIsError;
  const updatedAt = Math.max(exportsUpdatedAt ?? 0, adminUpdatedAt ?? 0);

  const sortedJobs = useMemo(() => {
    return mergeExportJobs(exports, adminJobs);
  }, [exports, adminJobs]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const activeCount = useMemo(
    () => sortedJobs.filter((j) => j.status === 'processing' || j.status === 'queued').length,
    [sortedJobs],
  );
  const hasRunning = useMemo(
    () => sortedJobs.some((j) => j.status === 'processing'),
    [sortedJobs],
  );

  return (
    <WidgetShell
      title={t('widget.exportStatus', 'Export Status')}
      icon={<Download className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => { exportsRefetch(); adminRefetch(); }}
    >
      {isCompact ? (
        sortedJobs.length > 0 ? (
          <CompactView activeCount={activeCount} hasRunning={hasRunning} t={t} />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Download className="h-5 w-5" />}
            message={t('widget.noExportJobs', 'No export jobs')}
            className="py-4"
          />
        )
      ) : (
        <StandardView
          jobs={sortedJobs}
          showDownload={isWide}
          maxItems={isCompact ? 5 : 15}
          t={t}
        />
      )}
    </WidgetShell>
  );
}
