import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { GlassPanel, Text, Caption } from '@/components/ui';
import { neonColorMap, type NeonColor } from '@/lib/tokens';
import { cn } from '@/lib/cn';

interface HighlightCardProps {
  icon: ReactNode;
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
  const accent = neonColorMap[color as NeonColor] ?? neonColorMap.cyan;
  return (
    <GlassPanel
      glow={glowMap[color] ?? 'none'}
      hover
      className={cn('flex h-full flex-col gap-2 p-4 sm:p-5', className)}
    >
      <div className="flex items-center gap-2">
        <span className={cn('shrink-0', accent.text)} aria-hidden="true">
          {icon}
        </span>
        <Text size="sm" color="secondary" className="truncate">
          {label || '—'}
        </Text>
      </div>
      <Text
        as="div"
        size="2xl"
        weight="bold"
        color="primary"
        className="truncate tracking-tight tabular-nums"
      >
        {value || '—'}
      </Text>
      {change && (
        <Text
          size="xs"
          weight="medium"
          className={cn(
            'flex items-center gap-1',
            change.positive ? 'text-emerald-300' : 'text-rose-300',
          )}
        >
          {change.positive ? (
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {change.value || '—'}
        </Text>
      )}
      {subtitle && <Caption>{subtitle}</Caption>}
    </GlassPanel>
  );
}
