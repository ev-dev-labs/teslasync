import { Battery } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
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
      <Battery className="h-5 w-5" style={{ color }} />
      <span className="flex flex-col">
        <span className="text-xs text-white/50">{label}</span>
        <span className="text-sm font-bold" style={{ color }}>
          {fmtInt(level)}%
        </span>
      </span>
      <span className="ml-auto h-2 w-16 overflow-hidden rounded-full bg-white/10">
        <span
          className="block h-full rounded-full transition-all"
          style={{ width: `${Math.min(level, 100)}%`, backgroundColor: color }}
        />
      </span>
    </GlassPanel>
  );
}
