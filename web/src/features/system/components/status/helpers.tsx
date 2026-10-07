import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { fmtNumber } from '@/lib/numberFormat';

export function getStatusColor(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy': case 'ok': case 'online': case 'connected': case 'ready': case 'sent': case 'completed':
      return '#22c55e';
    case 'degraded': case 'warning': case 'pending': case 'queued': case 'processing':
      return '#f59e0b';
    case 'unhealthy': case 'offline': case 'error': case 'down': case 'failed':
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

export function statusTextClass(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy': case 'ok': case 'online': case 'connected': case 'ready': case 'sent': case 'completed':
      return 'text-green-400';
    case 'degraded': case 'warning': case 'pending': case 'queued': case 'processing':
      return 'text-amber-400';
    case 'unhealthy': case 'offline': case 'error': case 'down': case 'failed':
      return 'text-red-400';
    default:
      return 'text-[var(--text-muted)]';
  }
}

export function getStatusIcon(status: string): JSX.Element {
  const cls = statusTextClass(status);
  // The icon is always rendered beside a visible status label, so it is
  // decorative — hide it from assistive tech to avoid a meaningless SVG
  // announcement.
  switch ((status ?? '').toLowerCase()) {
    case 'healthy': case 'ok': case 'online': case 'connected': case 'ready': case 'sent': case 'completed':
      return <CheckCircle aria-hidden="true" className={`h-4 w-4 ${cls}`} />;
    case 'degraded': case 'warning': case 'pending': case 'queued': case 'processing':
      return <AlertTriangle aria-hidden="true" className={`h-4 w-4 ${cls}`} />;
    case 'unhealthy': case 'offline': case 'error': case 'down': case 'failed':
      return <XCircle aria-hidden="true" className={`h-4 w-4 ${cls}`} />;
    default:
      return <AlertTriangle aria-hidden="true" className={`h-4 w-4 ${cls}`} />;
  }
}

export function formatUptime(seconds: number): string {
  // Uptime is never negative; guard non-finite / negative input (missing or
  // clock-skewed API values) so we render "0m" instead of "NaNm" / "-1d …".
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatBytes(bytes: number): string {
  // Guard non-finite / non-positive input (missing API fields, negatives) and
  // clamp the unit index so a petabyte-scale value never indexes past the
  // `sizes` array (which produced "1.0 undefined" for >= 1 PB).
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.max(Math.floor(Math.log(bytes) / Math.log(k)), 0), sizes.length - 1);
  return `${fmtNumber(bytes / Math.pow(k, i), 1)} ${sizes[i]}`;
}

export function statusToBadgeVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy': case 'ok': case 'online': case 'connected': case 'ready': case 'sent': case 'completed':
      return 'success';
    case 'degraded': case 'warning': case 'pending': case 'queued': case 'processing':
      return 'warning';
    case 'unhealthy': case 'offline': case 'error': case 'down': case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}
