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

  // Guard the numbers the gauge feeds into its arc math. A missing / non-finite
  // value collapses to 0, and a non-positive max would make the RadialGauge
  // divide by zero — producing a NaN stroke offset and a visually broken ring —
  // so it falls back to a sane 100-unit scale.
  const value = Number.isFinite(gauge?.value) ? gauge.value : 0;
  const max = Number.isFinite(gauge?.max) && gauge.max > 0 ? gauge.max : 100;

  // Never call .length / .map on a possibly-undefined stats prop.
  const items = stats ?? [];

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <RadialGauge
        value={value}
        max={max}
        label={gauge?.label ?? ''}
        unit={gauge?.unit ?? ''}
        color={gauge?.color}
        size={size}
      />

      {!compact && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {items.map((stat, index) => (
            <div
              key={`${stat.label ?? 'stat'}-${index}`}
              className="flex min-w-0 flex-col items-center text-center"
            >
              <span className="truncate text-xs text-[var(--text-secondary)]">{stat.label ?? '—'}</span>
              <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                {stat.value ?? '—'}
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
