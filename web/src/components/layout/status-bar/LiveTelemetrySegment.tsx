import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Wifi, WifiOff } from 'lucide-react';
import { Tooltip } from '@/components/ui/runtime';
import { useLiveConnection, type LiveConnectionStatus } from '@/hooks/useLiveConnection';
import { cn } from '@/lib/cn';
import { PrefetchLink } from '../PrefetchLink';
import { useStatusBarAnnouncer } from './StatusBarContext';

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

const STALE_AFTER_MS = 2 * 60_000;

function messageAgeMs(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function ageSecondsLabel(iso: string | null, now: number): string {
  if (!iso) return '—';
  const ms = messageAgeMs(iso, now);
  if (ms == null) return '—';
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
  const announce = useStatusBarAnnouncer();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== 'connected' || !lastMessageAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [lastMessageAt, status]);

  const ageMs = messageAgeMs(lastMessageAt, now);
  const stale = status === 'connected' && ageMs != null && ageMs >= STALE_AFTER_MS;

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
  const effectiveVariant: VariantConfig = stale
    ? {
        icon: WifiOff,
        text: 'text-amber-300',
        dot: 'bg-amber-400',
        short: t('statusBar.live.stale', 'Stale'),
      }
    : v;
  const Icon = effectiveVariant.icon;
  const previousAnnouncement = useRef(effectiveVariant.short);

  useEffect(() => {
    if (previousAnnouncement.current !== effectiveVariant.short) {
      announce?.(
        `${t('statusBar.live.aria', 'Live telemetry status')}: ${effectiveVariant.short}`,
      );
      previousAnnouncement.current = effectiveVariant.short;
    }
  }, [announce, effectiveVariant.short, t]);

  const tooltipBody =
    status === 'connected'
      ? `${t('statusBar.live.tooltip', 'Live telemetry stream')} · ${t('statusBar.live.lastMessage', 'Last message {{age}} ago', {
          age: ageSecondsLabel(lastMessageAt, now),
        })}`
      : `${t('statusBar.live.tooltip', 'Live telemetry stream')} · ${effectiveVariant.short}`;

  const ariaLabel = `${t('statusBar.live.aria', 'Live telemetry status')}: ${effectiveVariant.short}`;

  return (
    <Tooltip content={tooltipBody} side="top">
      <PrefetchLink
        to="/signal-diff"
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
          'hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
          effectiveVariant.text,
        )}
      >
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
            effectiveVariant.dot,
          )}
          aria-hidden
        />
        <Icon
          className={cn('h-3 w-3 shrink-0', effectiveVariant.spin && 'animate-spin')}
          aria-hidden
        />
        {!iconOnly && (
          <>
            <span className="font-medium">{effectiveVariant.short}</span>
            {status === 'connected' && lastMessageAt && (
              <span className="text-[var(--text-muted)]">
                · {ageSecondsLabel(lastMessageAt, now)}
              </span>
            )}
          </>
        )}
      </PrefetchLink>
    </Tooltip>
  );
}
