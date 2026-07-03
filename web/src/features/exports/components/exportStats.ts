import type { BadgeProps } from '@/components/ui';
import type { ExportJobSummary } from '@/api/hooks/useExports';

/** Canonical status order used by the KPI band, the status breakdown, and any
 *  status-keyed iteration so every surface renders the same sequence. */
export const STATUS_ORDER: ExportJobSummary['status'][] = [
  'ready',
  'processing',
  'queued',
  'failed',
  'expired',
];

/** Toned display colour per job status. Consumed by MetricBar (which takes a
 *  raw CSS colour string) and status dots. Kept as hex — MetricBar composes a
 *  dynamic gradient/glow from the value, so a token class won't work here. */
export const statusColor: Record<ExportJobSummary['status'], string> = {
  ready: '#10b981',
  processing: '#00f0ff',
  queued: '#f59e0b',
  failed: '#f43f5e',
  expired: '#64748b',
};

/** Map a job status to a shared Badge variant so status is legible without
 *  relying on colour alone (the badge always carries its text label). */
export function statusBadgeVariant(
  status: ExportJobSummary['status'],
): NonNullable<BadgeProps['variant']> {
  switch (status) {
    case 'ready':
      return 'success';
    case 'failed':
      return 'danger';
    case 'processing':
    case 'queued':
      return 'info';
    default:
      return 'neutral';
  }
}

export interface ExportStats {
  total: number;
  ready: number;
  /** queued + processing — the "in flight" bucket surfaced as one KPI. */
  inProgress: number;
  failed: number;
  expired: number;
  /** Sum of every known file_size in bytes. */
  totalBytes: number;
  /** Count of each individual status, always keyed for all statuses. */
  byStatus: Record<ExportJobSummary['status'], number>;
}

/** Derive the aggregate counts + storage total the KPI band and breakdown
 *  panel render. Null-safe: missing file_size contributes 0 bytes and an
 *  empty list yields all-zero stats (never NaN). */
export function deriveExportStats(jobs: ExportJobSummary[]): ExportStats {
  const byStatus: Record<ExportJobSummary['status'], number> = {
    ready: 0,
    processing: 0,
    queued: 0,
    failed: 0,
    expired: 0,
  };
  let totalBytes = 0;
  for (const job of jobs) {
    if (job.status in byStatus) byStatus[job.status] += 1;
    totalBytes += job.file_size ?? 0;
  }
  return {
    total: jobs.length,
    ready: byStatus.ready,
    inProgress: byStatus.processing + byStatus.queued,
    failed: byStatus.failed,
    expired: byStatus.expired,
    totalBytes,
    byStatus,
  };
}
