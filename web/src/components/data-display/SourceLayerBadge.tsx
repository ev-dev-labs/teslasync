import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { Button } from '@/components/ui/Button';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * Debugger-only badge for the inspector's legacy freshness codes.
 * These codes do not attest the physical L1/L2 read layer:
 *   - `l1`    — timestamp within the freshness window
 *   - `l2`    — timestamp absent; freshness unknown
 *   - `log`   — replayed from signal_log (point-in-time snapshot)
 *   - `stale` — value older than the 2 minute freshness threshold
 *
 * Compact labels retain the freshness distinction without inventing provenance.
 */
export type SignalSource = 'l1' | 'l2' | 'log' | 'stale' | string;

export interface SourceLayerBadgeProps {
  source: SignalSource | null | undefined;
  /** Optional age-in-ms — when provided, surfaces in the tooltip. */
  ageMs?: number | null;
  /** Reserve extra width for the descriptive label. */
  showLabel?: boolean;
  className?: string;
}

const STYLE: Record<string, { tint: string; label: string; labelKey?: string; descKey: string; descFallback: string }> = {
  l1: {
    tint: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-default)]',
    label: 'Fresh',
    labelKey: 'timeMachine.ageFresh',
    descKey: 'sourceLayer.unknown.desc',
    descFallback: 'Source layer unknown.',
  },
  l2: {
    tint: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-default)]',
    label: 'Unknown',
    labelKey: 'common.unknown',
    descKey: 'sourceLayer.unknown.desc',
    descFallback: 'Source layer unknown.',
  },
  log: {
    tint: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-strong)]',
    label: 'Log',
    labelKey: 'sourceLayer.log.label',
    descKey: 'sourceLayer.log.desc',
    descFallback: 'Replayed from signal_log (durable history).',
  },
  stale: {
    tint: 'bg-[var(--semantic-warning-bg)] text-[var(--semantic-warning)] border border-[var(--semantic-warning-border)]',
    label: 'Stale',
    labelKey: 'sourceLayer.stale.label',
    descKey: 'admin.liveSignals.kpi.staleHint',
    descFallback: 'Past 2-min window',
  },
  unknown: {
    tint: 'bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
    label: '—',
    descKey: 'sourceLayer.unknown.desc',
    descFallback: 'Source layer unknown.',
  },
};

function formatAge(ms: number | null | undefined, fmtWithUnit: ReturnType<typeof useNumberFormatting>['fmtWithUnit']): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return fmtWithUnit(ms, 'ms');
  if (ms < 60_000) return fmtWithUnit(ms / 1000, 's');
  if (ms < 3_600_000) return fmtWithUnit(ms / 60_000, 'min');
  if (ms < 86_400_000) return fmtWithUnit(ms / 3_600_000, 'h');
  return fmtWithUnit(ms / 86_400_000, 'd');
}

export function SourceLayerBadge({ source, ageMs, showLabel, className }: SourceLayerBadgeProps) {
  const { t } = useTranslation();
  const { fmtWithUnit } = useNumberFormatting();
  const key = (source ?? 'unknown').toLowerCase();
  const style = STYLE[key] ?? STYLE.unknown;
  const ageText = formatAge(ageMs, fmtWithUnit);
  const description = key === 'l1'
    ? `${t('timeMachine.ageFresh', 'Fresh')}. ${t(style.descKey, style.descFallback)}`
    : key === 'l2'
      ? `${t('sourceLayer.age', 'age')}: ${t('common.unknown', 'Unknown')}. ${t(style.descKey, style.descFallback)}`
      : key === 'stale'
        ? `${t(style.descKey, style.descFallback)}. ${t('sourceLayer.unknown.desc', 'Source layer unknown.')}`
        : t(style.descKey, style.descFallback);
  const tooltip = ageText
    ? `${description} (${t('sourceLayer.age', 'age')}: ${ageText})`
    : description;
  const label = style.labelKey ? t(style.labelKey, style.label) : style.label;

  return (
    <Tooltip content={tooltip} multiline>
      <Button
        type="button"
        variant="ghost"
        aria-label={style === STYLE.unknown ? t('common.unknown', 'Unknown') : label}
        onClick={(event) => event.currentTarget.focus()}
        data-testid="source-layer-badge"
        data-source={key}
        className={cn(
          'inline-flex h-auto min-h-11 min-w-11 items-center justify-center rounded px-1.5 py-px font-mono md:min-h-6',
          'text-2xs tracking-wider leading-none',
          showLabel ? 'md:min-w-[2.5rem]' : 'md:min-w-[1.5rem]',
          style.tint,
          className,
        )}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
