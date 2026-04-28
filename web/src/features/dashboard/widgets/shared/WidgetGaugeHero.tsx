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
        <div className="flex items-center gap-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center text-center">
              <span className="text-xs text-white/50">{stat.label}</span>
              <span className="text-sm font-semibold text-white/90">
                {stat.value}
                {stat.unit && (
                  <span className="ml-0.5 text-xs font-normal text-white/50">{stat.unit}</span>
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
