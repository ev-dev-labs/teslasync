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

export function BatteryPill({ level, label, className }: BatteryPillProps) {
  const color =
    level >= 60
      ? STATUS_COLORS.good
      : level >= 30
        ? STATUS_COLORS.warning
        : STATUS_COLORS.critical;

  return (
    <GlassPanel className={cn('flex items-center gap-3 px-4 py-3', className)}>
      <Battery className="h-5 w-5 shrink-0" style={{ color }} aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <Text size="xs" color="secondary" className="truncate">
          {label}
        </Text>
        <Text as="span" size="sm" weight="bold" className="tabular-nums" style={{ color }}>
          {fmtInt(level)}%
        </Text>
      </span>
      <span className="ml-auto h-2 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <span
          className="block h-full rounded-full transition-all"
          style={{ width: `${Math.min(level, 100)}%`, backgroundColor: color }}
        />
      </span>
    </GlassPanel>
  );
}
