import { AnimatedNumber } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';

const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

interface WidgetBigNumberProps {
  value: number | null;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'neutral' };
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
}

export function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  badge,
  valueColor = 'text-[var(--text-primary)]',
  nullDisplay = '—',
  animated = true,
}: WidgetBigNumberProps) {
  // A "big number" is only meaningful when it is a finite number. Guarding on
  // `!== null` alone let NaN / ±Infinity through — the non-animated path then
  // rendered the literal string "NaN"/"Infinity", and AnimatedNumber silently
  // coerced non-finite input to a misleading "0". A runtime-`undefined` value
  // (the type says `number | null`, but callers pass `data?.field`) slipped
  // through the same crack. Treat every non-finite input as absent so it lands
  // on the placeholder instead.
  return (
    <div className="flex flex-col items-center justify-center h-full gap-1">
      <div className="flex items-baseline gap-1">
        {value != null && Number.isFinite(value) ? (
          animated ? (
            <AnimatedNumber value={value} className={cn('text-3xl font-bold', valueColor)} />
          ) : (
            <span className={cn('text-3xl font-bold tabular-nums', valueColor)}>{value}</span>
          )
        ) : (
          <span className="text-3xl font-bold text-[var(--text-muted)]">{nullDisplay}</span>
        )}
        {unit && <span className="text-lg text-[var(--text-secondary)]">{unit}</span>}
      </div>

      {label && (
        <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
      )}

      {subtitle && <span className="text-xs text-[var(--text-secondary)]">{subtitle}</span>}

      {badge && (
        <Badge variant={badgeVariantMap[badge.variant]} size="sm">
          {badge.text}
        </Badge>
      )}
    </div>
  );
}
