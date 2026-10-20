import { type ComponentProps, type ReactNode } from 'react';
import { LinearGauge } from '@/components/charts';

export interface GaugeHeroConfig extends Pick<
  ComponentProps<typeof LinearGauge>,
  'value' | 'max' | 'min' | 'ariaLabel' | 'tone' | 'status' | 'kind' | 'decimals' | 'hideScale'
> {
  label: string;
  unit: string;
  color: string;
  /**
   * Forward unknown readings and caller scales unchanged to LinearGauge.
   * Opt in until existing callers migrate: omission temporarily retains the
   * tested non-finite→0 reading and invalid-max→100 defaults.
   */
  preserveReadingAndScale?: boolean;
  /** Optional reference tick (e.g. a configured charge limit). */
  marker?: number;
  markerLabel?: string;
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

  // LinearGauge already handles missing readings and invalid scales safely.
  // Keep the original, test-pinned defaults only outside preservation mode.
  const value = gauge?.preserveReadingAndScale
    ? gauge.value
    : Number.isFinite(gauge?.value) ? gauge.value : 0;
  const max = gauge?.preserveReadingAndScale
    ? gauge.max
    : Number.isFinite(gauge?.max) && gauge.max > 0 ? gauge.max : 100;

  // Never call .length / .map on a possibly-undefined stats prop.
  const items = stats ?? [];

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <LinearGauge
        value={value}
        preserveReadingAndScale={gauge?.preserveReadingAndScale}
        max={max}
        label={gauge?.label ?? ''}
        unit={gauge?.unit ?? ''}
        color={gauge?.color}
        size={size}
        marker={gauge?.marker}
        markerLabel={gauge?.markerLabel}
        min={gauge?.min}
        ariaLabel={gauge?.ariaLabel}
        tone={gauge?.tone}
        status={gauge?.status}
        kind={gauge?.kind}
        decimals={gauge?.decimals}
        hideScale={gauge?.hideScale}
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
