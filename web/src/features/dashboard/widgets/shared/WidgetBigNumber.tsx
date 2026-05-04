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
  valueColor = 'text-white',
  nullDisplay = '—',
  animated = true,
}: WidgetBigNumberProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-1">
      <div className="flex items-baseline gap-1">
        {value !== null ? (
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
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
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
