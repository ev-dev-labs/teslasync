import { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Minus,
  Maximize2,
  AlertTriangle,
  Package,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui/Button';

import { formatRelative } from '@/lib/dateFormat';
import {
  useExportJobs,
  exportDownloadUrl,
  type ExportJobSummary,
} from '@/api/hooks/useExports';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { DataStateNotice } from './DataStateNotice';
import { ErrorDisplay } from './ErrorDisplay';
import { Skeleton } from './Skeleton';
import { StaleRefreshWarning } from './StaleRefreshWarning';

/**
 * Floating, minimizable widget that surfaces in-flight + recently-finished
 * export jobs. Auto-shows when there is at least one queued/processing job
 * and stays open until the user dismisses it. Once minimized, a small badge
 * shows the active count so the user can re-expand it.
 *
 * The drawer polls via the shared `useExportJobs` hook (5-second cadence
 * while any job is queued/processing).
 */

type JobBucket = 'active' | 'recent';

const STORAGE_KEY = 'teslasync.exportDrawer.state';

type DrawerState = 'open' | 'minimized' | 'dismissed';

function readPersistedState(): DrawerState {
  if (typeof window === 'undefined') return 'minimized';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'open' || raw === 'minimized' || raw === 'dismissed') return raw;
  } catch {
    /* localStorage unavailable */
  }
  return 'minimized';
}

function writePersistedState(state: DrawerState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, state);
  } catch {
    /* ignore */
  }
}

function isActive(job: ExportJobSummary): boolean {
  return job.status === 'queued' || job.status === 'processing';
}

function bucketFor(job: ExportJobSummary): JobBucket {
  return isActive(job) ? 'active' : 'recent';
}

function statusIcon(status: ExportJobSummary['status']): React.ReactNode {
  switch (status) {
    case 'queued':
      return <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />;
    case 'processing':
      return <Loader2 className="h-3.5 w-3.5 text-[var(--semantic-info)] animate-spin" aria-hidden="true" />;
    case 'ready':
      return <CheckCircle2 className="h-3.5 w-3.5 text-[var(--semantic-success)]" aria-hidden="true" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-[var(--semantic-danger)]" aria-hidden="true" />;
    case 'expired':
      return <AlertTriangle className="h-3.5 w-3.5 text-[var(--semantic-warning)]" aria-hidden="true" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />;
  }
}

interface JobProgressDrawerProps {
  /** Maximum number of recently-finished jobs to show alongside active jobs.
   *  Defaults to 5. */
  maxRecent?: number;
  /** Override classes for positioning. Defaults to bottom-right floating. */
  className?: string;
}

export function JobProgressDrawer({ maxRecent = 5, className }: JobProgressDrawerProps) {
  const { t } = useTranslation();
  const jobsQuery = useExportJobs();
  const jobsState = useDataState(jobsQuery);
  const allJobs = jobsState.data ?? [];

  const [state, setState] = useState<DrawerState>(() => readPersistedState());

  const activeJobs = useMemo(() => allJobs.filter(isActive), [allJobs]);
  const recentJobs = useMemo(
    () => allJobs.filter((j) => !isActive(j)).slice(0, maxRecent),
    [allJobs, maxRecent],
  );

  // Auto-promote dismissed → minimized when a NEW job appears so the user
  // notices it. Active jobs always force at least the minimized chip.
  useEffect(() => {
    if (activeJobs.length > 0 && state === 'dismissed') {
      setState('minimized');
      writePersistedState('minimized');
    }
  }, [activeJobs.length, state]);

  const persist = useCallback((next: DrawerState) => {
    setState(next);
    writePersistedState(next);
  }, []);

  // Hide the drawer entirely when there's nothing to show and the user has
  // dismissed it. The dashboard page can still surface jobs without us.
  if (state === 'dismissed' && activeJobs.length === 0) return null;
  if (jobsState.status === 'ok' && allJobs.length === 0) return null;

  const positionClass = className ?? 'fixed bottom-4 right-4 z-40';

  // Collapsed chip: rendered while minimized, and also transitionally while a
  // dismissed drawer is being auto-promoted back to minimized because a new
  // active job just appeared (see the effect above). Guarding on `!== 'open'`
  // rather than `=== 'minimized'` means that promotion shows the subtle chip
  // immediately instead of flashing the full drawer open for one frame.
  if (state !== 'open') {
    const activeCount = activeJobs.length;
    return (
      <div className={positionClass}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          wrapLabel
          onClick={() => persist('open')}
          aria-label={t('export.jobDrawer.expand', 'Show export jobs ({{count}} active)', { count: activeCount })}
          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0 max-w-[calc(100vw-2rem)] rounded-full"
          icon={activeCount > 0 ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 text-[var(--semantic-info)] animate-spin" aria-hidden="true" />
          ) : (
            <Package className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
          )}
        >
          {activeCount > 0
            ? t('export.jobDrawer.activeCount', '{{count}} export running', { count: activeCount })
            : t('export.jobDrawer.recentLabel', 'Exports')}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        positionClass,
        'w-[360px] max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--border-default)]',
        'bg-[var(--surface-elevated)] shadow-lg',
      )}
      role="region"
      aria-label={t('export.jobDrawer.label', 'Export job progress')}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-subtle)]">
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
          <Package className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
          <span className="text-xs font-semibold text-[var(--text-primary)] break-words">
            {t('export.jobDrawer.title', 'Export jobs')}
          </span>
          {activeJobs.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium bg-[var(--surface-2)] text-[var(--text-secondary)]">
              {t('export.jobDrawer.activePill', '{{count}} active', { count: activeJobs.length })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-11 min-h-11 min-w-11 md:h-6 md:w-6 md:min-h-6 md:min-w-6 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            icon={<Minus className="h-3.5 w-3.5" />}
            onClick={() => persist('minimized')}
            aria-label={t('export.jobDrawer.minimize', 'Minimize')}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-11 w-11 min-h-11 min-w-11 md:h-6 md:w-6 md:min-h-6 md:min-w-6 p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            icon={<X className="h-3.5 w-3.5" />}
            onClick={() => persist('dismissed')}
            aria-label={t('export.jobDrawer.close', 'Dismiss')}
          />
        </div>
      </div>

      {/* Body */}
      <div className="max-h-[60vh] overflow-y-auto p-2 space-y-2">
        <StaleRefreshWarning state={jobsState} label={t('export.jobDrawer.title', 'Export jobs')} />
        {jobsState.fatalError ? (
          <ErrorDisplay error={jobsState.fatalError} compact onRetry={jobsState.retry ?? undefined} />
        ) : !jobsState.hasData && jobsState.isRefreshBlocked ? (
          <DataStateNotice
            state="stale"
            title={t('dataSources.status.paused', 'Refresh paused')}
            role="status"
          >
            {jobsState.retry && (
              <Button variant="ghost" size="sm" className="min-h-11 md:min-h-9" onClick={jobsState.retry}>
                {t('common.refresh', 'Refresh')}
              </Button>
            )}
          </DataStateNotice>
        ) : !jobsState.hasData ? (
          <div role="status" className="space-y-2 px-2 py-4 text-center text-xs text-[var(--text-muted)]">
            {t('export.jobDrawer.loading', 'Loading export jobs…')}
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <DrawerSection
              label={t('export.jobDrawer.activeHeading', 'In progress')}
              emptyLabel={t('export.jobDrawer.activeEmpty', 'No active exports')}
              jobs={activeJobs}
            />
            <DrawerSection
              label={t('export.jobDrawer.recentHeading', 'Recent')}
              emptyLabel={t('export.jobDrawer.recentEmpty', 'No recent exports')}
              jobs={recentJobs}
            />
          </>
        )}
      </div>
    </div>
  );
}

function DrawerSection({
  label,
  emptyLabel,
  jobs,
}: {
  label: string;
  emptyLabel: string;
  jobs: ExportJobSummary[];
}) {
  return (
    <div>
      <p className="px-2 pb-1 pt-1 text-2xs font-semibold tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      {jobs.length === 0 ? (
        <p className="px-2 py-2 text-xs text-[var(--text-muted)]">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </ul>
      )}
    </div>
  );
}

function JobRow({ job }: { job: ExportJobSummary }) {
  const { formatBytes } = useNumberFormatting();
  const { t } = useTranslation();
  const bucket = bucketFor(job);
  const typeLabel = prettyType(job.type, t);
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 text-xs',
        'border border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--surface-2)]',
        bucket === 'active' && 'bg-[var(--surface-1)]',
      )}
    >
      <div className="shrink-0">{statusIcon(job.status)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="min-w-0 font-medium text-[var(--text-primary)] break-words">
            {typeLabel}
          </span>
          <span className="text-2xs tracking-wider text-[var(--text-muted)]">
            {job.format === 'csv' ? 'CSV' : job.format === 'json' ? 'JSON' : job.format}
          </span>
        </div>
        <div className="text-xs text-[var(--text-muted)] break-words">
          {bucket === 'active'
            ? t('export.jobDrawer.statusLine', '{{status}} · started {{relative}}', {
                status: prettyStatus(job.status, t),
                relative: formatRelative(job.created_at),
              })
            : t('export.jobDrawer.completedLine', '{{size}} · {{relative}}', {
                size: formatBytes(job.file_size, { zeroAsEmpty: false }),
                relative: formatRelative(job.completed_at ?? job.created_at),
              })}
        </div>
        {job.error_message && (
          <p className="mt-0.5 text-xs text-[var(--semantic-danger)] break-words" title={job.error_message}>
            {job.error_message}
          </p>
        )}
      </div>
      {job.status === 'ready' && (
        <a
          href={exportDownloadUrl(job.id)}
          target="_blank"
          rel="noreferrer"
          aria-label={t('export.jobDrawer.downloadLabel', 'Download {{type}} export', {
            type: typeLabel,
          })}
          className={cn(
            BUTTON_BASE,
            BUTTON_VARIANTS.outline,
            'shrink-0 min-h-11 min-w-11 md:min-h-0 md:min-w-0 max-w-full whitespace-normal break-words px-2 py-1 text-xs',
          )}
        >
          <Download className="h-3 w-3" aria-hidden="true" />
          {t('export.jobDrawer.download', 'Download')}
        </a>
      )}
      {job.status === 'failed' && (
        <Maximize2 className="h-3 w-3 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
      )}
    </li>
  );
}

function prettyType(type: string, t: (k: string, fallback: string) => string): string {
  switch (type) {
    case 'account':
      return t('export.types.account', 'Account export');
    case 'drives':
      return t('export.types.drives', 'Drives');
    case 'charging':
      return t('export.types.charging', 'Charging');
    case 'analytics':
      return t('export.types.analytics', 'Analytics');
    case 'backup':
      return t('export.types.backup', 'Backup');
    case 'import_drives':
      return t('export.types.importDrives', 'Import drives');
    case 'import_charging':
      return t('export.types.importCharging', 'Import charging');
    default:
      return type;
  }
}

function prettyStatus(status: ExportJobSummary['status'], t: (k: string, fallback: string) => string): string {
  switch (status) {
    case 'queued':
      return t('export.status.queued', 'Queued');
    case 'processing':
      return t('export.status.processing', 'Processing');
    case 'ready':
      return t('export.status.ready', 'Ready');
    case 'failed':
      return t('export.status.failed', 'Failed');
    case 'expired':
      return t('export.status.expired', 'Expired');
    default:
      return status;
  }
}
