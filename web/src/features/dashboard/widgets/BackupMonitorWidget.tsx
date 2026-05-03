import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import { StatCard } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useBackupRuns } from '@/api/hooks/useAdmin';
import { cn } from '@/lib/cn';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

type BackupStatus = 'completed' | 'failed' | 'running' | 'queued';

function statusVariant(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'completed') return 'success';
  if (status === 'running' || status === 'queued') return 'warning';
  return 'danger';
}

function statusLabel(status: string, t: (key: string, fallback: string) => string): string {
  if (status === 'completed') return t('widget.backupMonitor.statusSuccess', 'Success');
  if (status === 'running') return t('widget.backupMonitor.statusRunning', 'Running');
  if (status === 'queued') return t('widget.backupMonitor.statusQueued', 'Queued');
  return t('widget.backupMonitor.statusFailed', 'Failed');
}

function statusDotColor(status: string): string {
  if (status === 'completed') return 'bg-green-500 shadow-green-500/40';
  if (status === 'running' || status === 'queued') return 'bg-amber-400 shadow-amber-400/40';
  return 'bg-red-500 shadow-red-500/40';
}

/** Format bytes into human-readable size (e.g. "1.2 GB", "450 MB"). */
function fmtBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

/** Format ISO timestamp as relative time (e.g. "2m ago", "3h ago", "5d ago"). */
function fmtRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Format ISO timestamp as short locale date/time. */
function fmtShortTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function BackupMonitorWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } =
    useBackupRuns();

  const runs = useMemo(() => data ?? [], [data]);

  const sortedRuns = useMemo(
    () =>
      [...runs].sort(
        (a, b) =>
          new Date(b.completedAt ?? b.createdAt).getTime() -
          new Date(a.completedAt ?? a.createdAt).getTime(),
      ),
    [runs],
  );

  const latestRun = sortedRuns[0] ?? null;
  const latestStatus: BackupStatus = latestRun?.status ?? 'failed';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const shellProps = {
    loading: isLoading,
    error: null as string | null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact layout (1×2) ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
        {runs.length === 0 && !isLoading ? (
          <EmptyState
            icon={<HardDrive className="h-5 w-5" />}
            message={t('widget.backupMonitor.noData', 'No backup data')}
            className="py-4"
          />
        ) : (
          <div className="flex items-center gap-3 min-h-[44px]">
            <span
              className={cn(
                'inline-block h-2.5 w-2.5 rounded-full shadow-[0_0_6px] shrink-0',
                statusDotColor(latestRun?.status ?? 'failed'),
              )}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {fmtRelativeTime(latestRun?.completedAt ?? latestRun?.createdAt ?? null)}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] truncate">
                {t('widget.backupMonitor.lastBackup', 'Last backup')}
              </p>
            </div>
          </div>
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×2) and Wide (2×4) layouts ──
  return (
    <WidgetShell
      title={t('widget.backupMonitor.title', 'Backup Monitor')}
      icon={<HardDrive className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      {runs.length === 0 && !isLoading ? (
        <EmptyState
          icon={<HardDrive className="h-5 w-5" />}
          message={t('widget.backupMonitor.noData', 'No backup data')}
          className="py-4"
        />
      ) : (
        <div className="flex flex-col gap-3 h-full">
          {/* Stat card grid */}
          <div className="grid grid-cols-2 gap-3 shrink-0">
            <StatCard
              label={t('widget.backupMonitor.lastBackup', 'Last backup')}
              value={fmtRelativeTime(latestRun?.completedAt ?? latestRun?.createdAt ?? null)}
            />
            <StatCard
              label={t('widget.backupMonitor.size', 'Backup Size')}
              value={fmtBytes(latestRun?.fileSize ?? 0)}
            />
            <StatCard
              label={t('widget.backupMonitor.type', 'Type')}
              value={latestRun?.backupType ?? '—'}
            />
            <div
              className={cn(
                'rounded-lg p-3',
                latestStatus === 'failed' && 'bg-red-500/10',
              )}
            >
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                {t('widget.backupMonitor.status', 'Status')}
              </p>
              <Badge variant={statusVariant(latestRun?.status ?? 'failed')}>
                {statusLabel(latestRun?.status ?? 'failed', t)}
              </Badge>
            </div>
          </div>

          {/* Wide layout: last 5 backup runs */}
          {isWide && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                {t('widget.backupMonitor.recentRuns', 'Recent Runs')}
              </p>
              {sortedRuns.slice(0, 5).map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 min-h-[44px]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={cn(
                        'inline-block h-2 w-2 rounded-full shadow-[0_0_6px] shrink-0',
                        statusDotColor(run.status),
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--text-primary)] truncate">
                        {fmtShortTime(run.completedAt ?? run.createdAt)}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)] truncate">
                        {fmtBytes(run.fileSize ?? 0)}
                        {run.durationMs != null ? ` · ${run.durationMs}ms` : ''}
                      </p>
                    </div>
                  </div>
                  <Badge variant={statusVariant(run.status)} className="shrink-0 text-[10px]">
                    {statusLabel(run.status, t)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
