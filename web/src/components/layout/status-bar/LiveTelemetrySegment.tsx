import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Wifi, WifiOff } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { useLiveConnection, type LiveConnectionStatus } from '@/hooks/useLiveConnection';
import { cn } from '@/lib/cn';

/**
 * LiveTelemetrySegment.
 *
 * Footer status-bar segment that mirrors `<LiveIndicator>` but in a denser
 * single-line form. Reflects the SSE/MQTT pipeline freshness:
 *   - `connected`    → emerald, "Live · Xs ago"
 *   - `reconnecting` → amber spinner
 *   - `disconnected` → rose
 *   - `unknown`      → muted
 *
 * Click navigates to `/signal-diff` (the live signal explorer).
 */

interface LiveTelemetrySegmentProps {
  iconOnly?: boolean;
}

interface VariantConfig {
  icon: typeof Wifi;
  text: string;
  dot: string;
  /** Short label, e.g. "Live". */
  short: string;
  spin?: boolean;
}

function ageSecondsLabel(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.floor(ms / 1_000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

export function LiveTelemetrySegment({ iconOnly = false }: LiveTelemetrySegmentProps) {
  const { t } = useTranslation();
  const { status, lastMessageAt } = useLiveConnection();

  const cfg: Record<LiveConnectionStatus, VariantConfig> = {
    connected: {
      icon: Wifi,
      text: 'text-emerald-300',
      dot: 'bg-emerald-400',
      short: t('statusBar.live.short', 'Live'),
    },
    reconnecting: {
      icon: Loader2,
      text: 'text-amber-300',
      dot: 'bg-amber-400',
      short: t('statusBar.live.reconnecting', 'Reconnecting'),
      spin: true,
    },
    disconnected: {
      icon: WifiOff,
      text: 'text-rose-300',
      dot: 'bg-rose-400',
      short: t('statusBar.live.offline', 'Offline'),
    },
    unknown: {
      icon: WifiOff,
      text: 'text-[var(--text-muted)]',
      dot: 'bg-[var(--surface-2)]',
      short: t('statusBar.live.unknown', 'Idle'),
    },
  };
  // Defensive: `useLiveConnection` is contracted to emit one of the four
  // known statuses, but fall back to the muted "unknown" variant rather than
  // dereference `undefined.icon` if an out-of-contract value ever reaches us.
  const v = cfg[status] ?? cfg.unknown;
  const Icon = v.icon;

  const tooltipBody =
    status === 'connected'
      ? `${t('statusBar.live.tooltip', 'Live telemetry stream')} · ${t('statusBar.live.lastMessage', 'Last message {{age}} ago', {
          age: ageSecondsLabel(lastMessageAt),
        })}`
      : `${t('statusBar.live.tooltip', 'Live telemetry stream')} · ${v.short}`;

  const ariaLabel = `${t('statusBar.live.aria', 'Live telemetry status')}: ${v.short}`;

  return (
    <Tooltip content={tooltipBody} side="top">
      <Link
        to="/signal-diff"
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
          'hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
          v.text,
        )}
      >
        <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', v.dot)} aria-hidden />
        <Icon className={cn('h-3 w-3 shrink-0', v.spin && 'animate-spin')} aria-hidden />
        {!iconOnly && (
          <>
            <span className="font-medium">{v.short}</span>
            {status === 'connected' && lastMessageAt && (
              <span className="text-[var(--text-muted)]">· {ageSecondsLabel(lastMessageAt)}</span>
            )}
          </>
        )}
      </Link>
    </Tooltip>
  );
}
