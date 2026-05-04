import { GlassPanel } from '@/components/ui';
import { cn } from '@/lib/cn';

interface MiniStatProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  className?: string;
}

export function MiniStat({ label, value, icon, className }: MiniStatProps) {
  return (
    <GlassPanel className={cn('flex items-center gap-3 px-4 py-3', className)}>
      {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
      <span className="flex flex-col">
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
        <span className="text-sm font-semibold text-white">{String(value)}</span>
      </span>
    </GlassPanel>
  );
}
