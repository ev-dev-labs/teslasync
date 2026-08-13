import type { ReactNode } from 'react';
import { GlassPanel, Text } from '@/components/ui';
import { cn } from '@/lib/cn';

interface MiniStatProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  className?: string;
}

export function MiniStat({ label, value, icon, className }: MiniStatProps) {
  // Guard against a nullish `value` leaking the literal string "undefined" /
  // "null" as the headline figure: callers derive it from optional telemetry
  // (e.g. `formatEfficiency(metrics.avgEfficiencyWhPerM ?? 0)`), and a missing metric that
  // slips past those guards would otherwise be stringified verbatim.
  const displayValue = String(value ?? '—');
  return (
    <GlassPanel className={cn('flex items-center gap-3 px-4 py-3', className)}>
      {icon && (
        <span className="shrink-0 text-[var(--text-muted)]" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <Text size="xs" color="secondary" className="truncate" title={label}>
          {label}
        </Text>
        <Text
          size="sm"
          weight="semibold"
          color="primary"
          className="truncate"
          title={displayValue}
        >
          {displayValue}
        </Text>
      </span>
    </GlassPanel>
  );
}
