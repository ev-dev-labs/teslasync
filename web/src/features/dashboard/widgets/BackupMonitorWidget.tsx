import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive } from 'lucide-react';
import { Badge, Caption, Subhead, Text } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useBackupRuns } from '@/api/hooks/useAdmin';
import { cn } from '@/lib/cn';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { fmtNumber } from '@/lib/numberFormat';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetStatGrid } from './shared';
import { severityTokens } from '@/lib/tokens';

type BackupStatus = 'completed' | 'failed' | 'running' | 'queued';

/**
 * Minimal translate signature — accepts a key, an English fallback, and an
 * optional interpolation bag. The full i18next `TFunction` is assignable to
 * this, so callers can pass `useTranslation().t` directly.
 */
type TranslateFn = (
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
) => string;

export function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'running' || status === 'queued') return 'warning';
  return status === 'failed' ? 'danger' : 'neutral';
}

export function statusLabel(status: string, t: TranslateFn): string {
  if (status === 'completed') return t('widget.backupMonitor.statusSuccess', 'Success');
  if (status === 'running') return t('widget.backupMonitor.statusRunning', 'Running');
  if (status === 'queued') return t('widget.backupMonitor.statusQueued', 'Queued');
  return status === 'failed' ? t('widget.backupMonitor.statusFailed', 'Failed') : '—';
}

export function statusDotColor(status: string): string {
  if (status === 'completed') return severityTokens.success.dot;
  if (status === 'running' || status === 'queued') return severityTokens.warn.dot;
  return status === 'failed' ? severityTokens.critical.dot : 'bg-[var(--text-muted)]';
}

/** Format bytes into human-readable size (e.g. "1.2 GB", "450 MB"). */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  // Clamp the unit index into range: sub-1 byte counts yield a negative
  // exponent and out-of-range values overflow past TB — either would index
  // `units` out of bounds and render "<n> undefined".
  const i = Math.max(
    0,
    Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1),
  );
  const val = bytes / Math.pow(1024, i);
  return `${i === 0 ? bytes : fmtNumber(val)} ${units[i]}`;
}

/** Parse an ISO timestamp to epoch ms, coercing nullish/invalid input to 0 so sorts stay stable. */
function toEpoch(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Format ISO timestamp as relative time (e.g. "2m ago", "3h ago", "5d ago"). */
export function fmtRelativeTime(iso: string | null, t: TranslateFn): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (diffMs < 0 || mins < 1) return t('widget.backupMonitor.relativeNow', 'just now');
  if (mins < 60) return t('widget.backupMonitor.relativeMinutes', '{{count}}m ago', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('widget.backupMonitor.relativeHours', '{{count}}h ago', { count: hrs });
  const days = Math.floor(hrs / 24);
  return t('widget.backupMonitor.relativeDays', '{{count}}d ago', { count: days });
}

export default function BackupMonitorWidget({ size }: WidgetProps) {
  const { formatDurationMs } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatDateTime: fmtShortTime } = useDateFormat();
  const query = useBackupRuns();
  const { data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const dataState = useDataState(query, { provenance: 'historical' });

  const runs = useMemo(() => safeArray(data), [data]);

  const sortedRuns = useMemo(
    () =>
      [...runs].sort(
        (a, b) =>
          toEpoch(b.completedAt ?? b.createdAt) - toEpoch(a.completedAt ?? a.createdAt),
      ),
    [runs],
  );

  const latestRun = sortedRuns[0] ?? null;
  const latestStatus: BackupStatus | '' = latestRun?.status ?? '';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const shellProps = {
    title: t('widget.backupMonitor.title', 'Backup monitor'),
    dataState,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact layout (1×2) ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {runs.length === 0 && !isLoading ? (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<HardDrive className="h-5 w-5" />}
            message={t('widget.backupMonitor.noData', 'No backup data')}
            className="py-4"
          />
        ) : (
          <div className="flex items-center gap-3 min-h-[44px]">
            <span
              role="img"
              aria-label={statusLabel(latestStatus, t)}
              className={cn(
                'inline-block h-2.5 w-2.5 rounded-full shadow-[0_0_6px] shrink-0',
                statusDotColor(latestStatus),
              )}
            />
            <div className="min-w-0">
              <Text as="p" variant="metricValue" className="min-w-0 [overflow-wrap:anywhere]">
                {fmtRelativeTime(latestRun?.completedAt ?? latestRun?.createdAt ?? null, t)}
              </Text>
              <Caption className="block [overflow-wrap:anywhere]">
                {t('widget.backupMonitor.lastBackup', 'Last backup')}
              </Caption>
            </div>
          </div>
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×2) and Wide (2×4) layouts ──
  return (
    <WidgetShell
      icon={<HardDrive className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      {...shellProps}
    >
      {runs.length === 0 && !isLoading ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<HardDrive className="h-5 w-5" />}
          message={t('widget.backupMonitor.noData', 'No backup data')}
          className="py-4"
        />
      ) : (
        <div className="flex flex-col gap-3 h-full">
          {/* Stat card grid */}
          <WidgetStatGrid cols={2} stats={[
            { label: t('widget.backupMonitor.lastBackup', 'Last backup'), value: fmtRelativeTime(latestRun?.completedAt ?? latestRun?.createdAt ?? null, t) },
            { label: t('widget.backupMonitor.size', 'Backup size'), value: fmtBytes(latestRun?.fileSize) },
            { label: t('widget.backupMonitor.type', 'Type'), value: latestRun?.backupType ?? '—' },
          ]} />
            <div className="min-w-0">
              <Caption className="block">
                {t('widget.backupMonitor.status', 'Status')}
              </Caption>
              <Badge variant={statusVariant(latestStatus)}>
                {statusLabel(latestStatus, t)}
              </Badge>
          </div>

          {/* Wide layout: last 5 backup runs */}
          {isWide && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
              <Subhead className="mb-1">
                {t('widget.backupMonitor.recentRuns', 'Recent runs')}
              </Subhead>
              <KVList layout="responsive" wrap items={sortedRuns.slice(0, 5).map((run) => ({
                id: run.id,
                leading: (
                  <span aria-hidden="true" className={cn('inline-block h-2 w-2 rounded-full shrink-0', statusDotColor(run.status))} />
                ),
                label: (
                  <span className="flex min-w-0 flex-col gap-1">
                    <Text variant="bodySm">{fmtShortTime(run.completedAt ?? run.createdAt)}</Text>
                    <Caption>
                      {fmtBytes(run.fileSize)}
                      {knownNumber(run.durationMs) != null ? ` · ${formatDurationMs(run.durationMs)}` : ''}
                    </Caption>
                  </span>
                ),
                value: <Badge variant={statusVariant(run.status)}>{statusLabel(run.status, t)}</Badge>,
              }))} />
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
