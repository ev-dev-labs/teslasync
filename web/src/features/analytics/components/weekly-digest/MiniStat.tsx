import { GlassPanel, Text } from '@/components/ui';
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
      {icon && (
        <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <Text size="xs" color="secondary" className="truncate">
          {label}
        </Text>
        <Text size="sm" weight="semibold" color="primary" className="truncate">
          {String(value)}
        </Text>
      </span>
    </GlassPanel>
  );
}
