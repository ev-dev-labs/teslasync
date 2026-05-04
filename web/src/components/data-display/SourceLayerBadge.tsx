import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui';

/**
 * Phase 40 / Prompt 58 — debugger-only badge for "where did this signal value
 * come from?".
 *
 * The layered live-state contract documented in `.github/copilot-instructions.md`
 * requires power-user diagnostics surfaces (FSM debugger, signal diff) to be
 * able to distinguish the L1 in-process store from the L2 Redis hot cache and
 * the durable signal_log replay path. The backend reports the layer per
 * signal as one of:
 *   - `l1`    — fresh value satisfied from the local in-process Store
 *   - `l2`    — value came from Redis HSET (legacy unknown-freshness entry)
 *   - `log`   — replayed from signal_log (point-in-time snapshot)
 *   - `stale` — Redis-backed value older than the 2 minute freshness threshold
 *
 * The badge is intentionally tiny (single character glyph + tooltip) so it
 * fits in dense table cells next to a value without crowding the surrounding
 * text.
 */
export type SignalSource = 'l1' | 'l2' | 'log' | 'stale' | string;

export interface SourceLayerBadgeProps {
  source: SignalSource | null | undefined;
  /** Optional age-in-ms — when provided, surfaces in the tooltip. */
  ageMs?: number | null;
  /** Render the badge with the layer label spelled out instead of the glyph. */
  showLabel?: boolean;
  className?: string;
}

const STYLE: Record<string, { tint: string; label: string; descKey: string; descFallback: string }> = {
  l1: {
    tint: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30',
    label: 'L1',
    descKey: 'sourceLayer.l1.desc',
    descFallback: 'Read from the in-process SignalStore (hot path, freshest).',
  },
  l2: {
    tint: 'bg-blue-500/15 text-blue-200 border border-blue-500/30',
    label: 'L2',
    descKey: 'sourceLayer.l2.desc',
    descFallback: 'Read from Redis cross-pod cache (legacy entry; freshness unknown).',
  },
  log: {
    tint: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-strong)]',
    label: 'LOG',
    descKey: 'sourceLayer.log.desc',
    descFallback: 'Replayed from signal_log (durable history).',
  },
  stale: {
    tint: 'bg-amber-500/15 text-amber-200 border border-amber-500/30',
    label: 'STALE',
    descKey: 'sourceLayer.stale.desc',
    descFallback: 'Redis-backed value older than the 2-minute freshness window.',
  },
  unknown: {
    tint: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
    label: '—',
    descKey: 'sourceLayer.unknown.desc',
    descFallback: 'Source layer unknown.',
  },
};

function formatAge(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  return `${(ms / 86_400_000).toFixed(1)} d`;
}

export function SourceLayerBadge({ source, ageMs, showLabel, className }: SourceLayerBadgeProps) {
  const { t } = useTranslation();
  const key = (source ?? 'unknown').toLowerCase();
  const style = STYLE[key] ?? STYLE.unknown;
  const ageText = formatAge(ageMs);
  const tooltip = ageText
    ? `${t(style.descKey, style.descFallback)} (${t('sourceLayer.age', 'age')}: ${ageText})`
    : t(style.descKey, style.descFallback);

  return (
    <Tooltip content={tooltip}>
      <span
        data-testid="source-layer-badge"
        data-source={key}
        className={cn(
          'inline-flex items-center justify-center rounded px-1.5 py-px font-mono uppercase',
          'text-[10px] tracking-wider leading-none',
          showLabel ? 'min-w-[2.5rem]' : 'min-w-[1.5rem]',
          style.tint,
          className,
        )}
      >
        {style.label}
      </span>
    </Tooltip>
  );
}
