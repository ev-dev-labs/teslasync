import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, CircleSlash, HelpCircle } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { useApiHealth, type ApiHealthStatus } from '@/api/hooks/useApiHealth';
import { cn } from '@/lib/cn';

/**
 * Footer status-bar API connection health segment.
 *
 * Footer status-bar segment that pings the backend `/healthz` endpoint and
 * surfaces the current API connection health (latency + ok/degraded/offline).
 * Color is paired with an icon so the state is also legible to users with
 * color-vision differences.
 */

interface ConnectionSegmentProps {
  iconOnly?: boolean;
}

interface VariantConfig {
  icon: typeof Activity;
  text: string;
  dot: string;
  /** Short label, e.g. "API". Shown to the right of the icon when not iconOnly. */
  short: string;
}

export function ConnectionSegment({ iconOnly = false }: ConnectionSegmentProps) {
  const { t } = useTranslation();
  const { status: rawStatus, latencyMs } = useApiHealth();

  const short = t('statusBar.connection.short', 'API');
  const cfg: Record<ApiHealthStatus, VariantConfig> = {
    ok: { icon: Activity, text: 'text-emerald-300', dot: 'bg-emerald-400', short },
    degraded: { icon: AlertTriangle, text: 'text-amber-300', dot: 'bg-amber-400', short },
    offline: { icon: CircleSlash, text: 'text-rose-300', dot: 'bg-rose-400', short },
    unknown: { icon: HelpCircle, text: 'text-[var(--text-muted)]', dot: 'bg-[var(--surface-2)]', short },
  };
  // Defensive: an out-of-contract status (a bad cast or a future union member)
  // degrades to the neutral "unknown" variant instead of throwing on
  // `cfg[status].icon`. Every downstream lookup then uses this safe value.
  const status: ApiHealthStatus = rawStatus in cfg ? rawStatus : 'unknown';
  const v = cfg[status];
  const Icon = v.icon;

  const stateLabel: Record<ApiHealthStatus, string> = {
    ok: t('statusBar.connection.ok', 'Online'),
    degraded: t('statusBar.connection.degraded', 'Degraded'),
    offline: t('statusBar.connection.offline', 'Offline'),
    unknown: t('statusBar.connection.unknown', 'Connecting…'),
  };

  const latencyLabel = latencyMs != null ? `${latencyMs}ms` : '—';
  const tooltip = (
    <span>
      {t('statusBar.connection.tooltip', 'API connection')} · {stateLabel[status]}
      {latencyMs != null && status !== 'offline' ? ` · ${latencyLabel}` : ''}
    </span>
  );

  const ariaLabel = `${t('statusBar.connection.aria', 'API connection status')}: ${stateLabel[status]}${
    latencyMs != null && status !== 'offline' ? ` (${latencyLabel})` : ''
  }`;

  return (
    <Tooltip content={tooltip} side="top">
      <Link
        to="/system-status"
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
          'hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
          v.text,
        )}
      >
        <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', v.dot)} aria-hidden />
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
        {!iconOnly && (
          <>
            <span className="font-medium">{v.short}</span>
            {status !== 'offline' && status !== 'unknown' && latencyMs != null && (
              <span className="text-[var(--text-muted)]">· {latencyLabel}</span>
            )}
            {status === 'offline' && (
              <span className="text-[var(--text-muted)]">· {stateLabel.offline}</span>
            )}
          </>
        )}
      </Link>
    </Tooltip>
  );
}
