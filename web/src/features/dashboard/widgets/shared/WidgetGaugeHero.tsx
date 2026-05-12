import { type ReactNode } from 'react';
import { RadialGauge } from '@/components/charts';

export interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

export interface GaugeHeroStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface WidgetGaugeHeroProps {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
  children?: ReactNode;
}

export function WidgetGaugeHero({ gauge, stats, compact, children }: WidgetGaugeHeroProps) {
  // Compact size never grows; the standard size renders smaller on narrow
  // widgets via container queries (handled below by the wrapper).
  const size = compact ? 70 : 100;

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <RadialGauge
        value={gauge.value}
        max={gauge.max}
        label={gauge.label}
        unit={gauge.unit}
        color={gauge.color}
        size={size}
      />

      {!compact && stats && stats.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col items-center text-center">
              <span className="truncate text-xs text-[var(--text-secondary)]">{stat.label}</span>
              <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {stat.value}
                {stat.unit && (
                  <span className="ml-0.5 text-xs font-normal text-[var(--text-secondary)]">{stat.unit}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {!compact && children}
    </div>
  );
}
