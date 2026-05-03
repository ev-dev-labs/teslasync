import { TrendingUp, TrendingDown } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { cn } from '@/lib/cn';

interface HighlightCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  change?: { value: string; positive: boolean };
  subtitle?: string;
  color?: 'cyan' | 'green' | 'purple' | 'amber' | 'red';
  className?: string;
}

const glowMap: Record<string, 'cyan' | 'green' | 'purple' | 'none'> = {
  cyan: 'cyan',
  green: 'green',
  purple: 'purple',
  amber: 'none',
  red: 'none',
};

export function HighlightCard({
  icon,
  label,
  value,
  change,
  subtitle,
  color = 'cyan',
  className,
}: HighlightCardProps) {
  return (
    <GlassPanel
      glow={glowMap[color] ?? 'none'}
      className={cn('flex flex-col gap-2 p-5', className)}
    >
      <span className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        {icon}
        {label}
      </span>
      <span className="text-2xl font-bold tracking-tight text-white">
        {value}
      </span>
      {change && (
        <span
          className={cn(
            'flex items-center gap-1 text-xs font-medium',
            change.positive ? 'text-emerald-400' : 'text-red-400',
          )}
        >
          {change.positive ? (
            <TrendingUp className="h-3.5 w-3.5" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" />
          )}
          {change.value}
        </span>
      )}
      {subtitle && (
        <span className="text-xs text-[var(--text-muted)]">{subtitle}</span>
      )}
    </GlassPanel>
  );
}
