import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { exportDownloadUrl, useExports } from '@/api/hooks/useExports';
import { useExportJobs } from '@/api/hooks/useAdmin';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import type { ExportJob as ExportJobExport } from '@/types/export';
import type { ExportJob as ExportJobAdmin } from '@/types/admin';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { fmtNumber } from '@/lib/numberFormat';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';

// ── Normalised job shape used within this widget ─────────────────────

export interface NormalisedJob {
  id: string;
  format: string;
  filePath?: string;
  fileSize: number | null;
  createdAt: string;
}

function fromExportHook(j: ExportJobExport): NormalisedJob {
  return {
    id: j.id,
    format: j.format,
    filePath: j.filePath,
    fileSize: j.fileSize ?? null,
    createdAt: j.createdAt,
  };
}

function fromAdminHook(j: ExportJobAdmin): NormalisedJob {
  return {
    id: j.id,
    format: j.format,
    filePath: undefined,
    fileSize: j.fileSize ?? null,
    createdAt: j.createdAt,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

export type JobStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'unknown';

export function normaliseStatusFromAdmin(status: string | undefined): JobStatus {
  const s = (status ?? '').toLowerCase();
  if (s === 'processing' || s === 'running') return 'processing';
  if (s === 'ready' || s === 'done' || s === 'completed') return 'ready';
  if (s === 'failed' || s === 'error') return 'failed';
  return s === 'queued' || s === 'pending' ? 'queued' : 'unknown';
}

export function normaliseStatusFromExport(status: string | undefined): JobStatus {
  return normaliseStatusFromAdmin(status);
}

const STATUS_ORDER: Record<JobStatus, number> = {
  processing: 0,
  queued: 1,
  ready: 2,
  failed: 3,
  unknown: 4,
};

const STATUS_BADGE: Record<JobStatus, { variant: 'neutral' | 'info' | 'success' | 'danger'; labelKey: string; label: string }> = {
  queued:     { variant: 'neutral', labelKey: 'widget.exportQueued',     label: 'Queued' },
  processing: { variant: 'info',    labelKey: 'widget.exportRunning',    label: 'Running' },
  ready:      { variant: 'success', labelKey: 'widget.exportDone',       label: 'Done' },
  failed:     { variant: 'danger',  labelKey: 'widget.exportFailed',     label: 'Failed' },
  unknown:    { variant: 'neutral', labelKey: 'common.unknown', label: 'Unknown' },
};

export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmtNumber((bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fmtNumber((bytes / (1024 * 1024)))} MB`;
  return `${fmtNumber((bytes / (1024 * 1024 * 1024)))} GB`;
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

  for (const j of safeArray(exports)) {
    byId.set(j.id, {
      job: fromExportHook(j),
      status: normaliseStatusFromExport(j.fsmState),
    });
  }

  for (const j of safeArray(adminJobs)) {
    const existing = byId.get(j.id);
    const adminJob = fromAdminHook(j);
    byId.set(j.id, {
      job: {
        ...adminJob,
        filePath: existing?.job.filePath ?? adminJob.filePath,
        fileSize: adminJob.fileSize ?? existing?.job.fileSize ?? null,
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
  hasUnknown,
  t,
}: {
  activeCount: number;
  hasRunning: boolean;
  hasUnknown: boolean;
  t: (key: string, fallback: string) => string;
}) {
  const { fmtInt } = useNumberFormatting();
  return (
    <WidgetBigNumber
      value={hasUnknown && activeCount === 0 ? null : fmtInt(activeCount)}
      label={t('widget.exportActiveJobs', 'Active exports')}
      badge={{
        text: hasRunning
          ? t('widget.exportRunningBadge', 'Running')
          : hasUnknown ? t('common.unknown', 'Unknown') : t('widget.exportIdleBadge', 'Idle'),
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
  useNumberFormatting();
  const cfg = STATUS_BADGE[status];
  const format = (job.format ?? '').toUpperCase() || '—';

  return (
    <div className="flex flex-wrap items-center gap-2 min-h-[44px] py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
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
        {fmtBytes(job.fileSize)}
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
        </div>
      ))}
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function ExportStatusWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const exportsQuery = useExports();
  const {
    data: exports,
    isFetching: exportsFetching,
    isStale: exportsStale,
    isError: exportsIsError,
    refetch: exportsRefetch,
  } = exportsQuery;

  const adminQuery = useExportJobs();
  const {
    data: adminJobs,
    isFetching: adminFetching,
    isStale: adminStale,
    isError: adminIsError,
    refetch: adminRefetch,
  } = adminQuery;

  const isFetching = exportsFetching || adminFetching;
  const isStale = exportsStale || adminStale;
  const isError = exportsIsError || adminIsError;
  const exportsState = useDataState(exportsQuery, { provenance: 'historical' });
  const adminState = useDataState(adminQuery, { provenance: 'historical' });
  const retry = () => { void exportsRefetch(); void adminRefetch(); };
  const dataState = {
    ...combineDataStates([exportsState, adminState]),
    data: { exports, adminJobs },
    hasData: exportsState.hasData || adminState.hasData,
    retry,
  };

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
  const hasUnknown = sortedJobs.some((job) => job.status === 'unknown');

  return (
    <WidgetShell
      title={t('widget.exportStatus', 'Export status')}
      icon={<Download className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={hasUnknown && dataState.status === 'ok' ? { ...dataState, status: 'partial' } : dataState}
      updatedAt={dataState.updatedAt ?? 0}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={retry}
    >
      {isCompact ? (
        sortedJobs.length > 0 ? (
          <CompactView activeCount={activeCount} hasRunning={hasRunning} hasUnknown={hasUnknown} t={t} />
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
