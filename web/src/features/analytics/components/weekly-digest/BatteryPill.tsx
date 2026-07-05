import { memo } from 'react';
import { Battery } from 'lucide-react';
import { GlassPanel, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { STATUS_COLORS } from '@/lib/colors';
import { cn } from '@/lib/cn';

interface BatteryPillProps {
  level: number;
  label: string;
  className?: string;
}

function BatteryPillComponent({ level, label, className }: BatteryPillProps) {
  // `level` is typed `number` but arrives from API/aggregation code that can
  // hand us `undefined`/`NaN` at runtime. Coerce to a finite value before any
  // arithmetic so the width never becomes `NaN%` and the color thresholds stay
  // deterministic.
  const safeLevel = Number.isFinite(level) ? level : 0;
  // Clamp to the [0, 100] track range: the previous `Math.min(level, 100)`
  // only capped the top, so a negative level produced a negative CSS width.
  const clamped = Math.max(0, Math.min(safeLevel, 100));
  const percentText = `${fmtInt(safeLevel)}%`;

  const color =
    safeLevel >= 60
      ? STATUS_COLORS.good
      : safeLevel >= 30
        ? STATUS_COLORS.warning
        : STATUS_COLORS.critical;

  return (
    <GlassPanel className={cn('flex items-center gap-3 px-4 py-3', className)}>
      <Battery className="h-5 w-5 shrink-0" style={{ color }} aria-hidden="true" />
      <span className="flex min-w-0 flex-col" aria-hidden="true">
        <Text size="xs" color="secondary" className="truncate">
          {label}
        </Text>
        <Text as="span" size="sm" weight="bold" className="tabular-nums" style={{ color }}>
          {percentText}
        </Text>
      </span>
      <span
        role="meter"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={percentText}
        // `--surface-3` (not `--surface-2`) so the empty track stays perceivable
        // against the GlassPanel, which is itself painted with `--surface-2`.
        className="ml-auto h-2 w-16 overflow-hidden rounded-full bg-[var(--surface-3)]"
      >
        <span
          aria-hidden="true"
          className="block h-full rounded-full transition-all"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </span>
    </GlassPanel>
  );
}

export const BatteryPill = memo(BatteryPillComponent);
BatteryPill.displayName = 'BatteryPill';
