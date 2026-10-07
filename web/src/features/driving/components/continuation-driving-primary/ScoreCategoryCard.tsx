import type { ReactNode } from 'react';
import { LayoutCard } from '@/components/layout';
import { LinearGauge } from '@/components/charts';
import { AnimatedNumber, MetricBar, InlineMetric } from '@/components/data-display';
import { Text, Caption } from '@/components/ui';

interface ScoreCategoryCardProps {
  title: string;
  value: number | null;
  max: number;
  color: string;
  icon: ReactNode;
  metricLabel: string;
  metricValue: string;
  sourceFallback?: ReactNode;
}

export function ScoreCategoryCard({
  title, value, max, color, icon, metricLabel, metricValue, sourceFallback,
}: ScoreCategoryCardProps) {
  const reading = value != null && Number.isFinite(value) ? value : null;
  return (
    <LayoutCard title={title}>
      {sourceFallback ?? <div className="flex min-w-0 flex-col items-center">
        <LinearGauge value={reading} max={max} label={title} color={color} size={120} hideScale />
        <div className="mt-3 flex items-baseline gap-1">
          <Text as="span" size="2xl" weight="bold" color="primary" className="tabular-nums">
            {reading != null ? <AnimatedNumber value={reading} /> : '—'}
          </Text>
          <Caption>/{max}</Caption>
        </div>
        <div className="mt-3 w-full min-w-0">
          <MetricBar label={title} value={reading} max={max} color={color} />
        </div>
        <InlineMetric
          icon={icon}
          value={metricValue}
          label={metricLabel}
          className="mt-2 min-w-0 self-start"
        />
      </div>}
    </LayoutCard>
  );
}
