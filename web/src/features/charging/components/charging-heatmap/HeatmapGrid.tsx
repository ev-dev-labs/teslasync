import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Caption, Text } from '@/components/ui';
import { DAYS } from '@/lib/constants';
import { heatColor, HEAT_LEGEND, formatHourLabel, type HeatmapModel } from './heatmapData';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface HeatmapGridProps {
  model: HeatmapModel;
  /** Row-major slot evidence shared with the accessible table and export. */
  energySlots?: readonly {
    energy_wh: number | null;
    recorded_energy_count: number;
  }[];
  /** Formats an SI watt-hours value for the hover tooltip. */
  formatEnergy: (wh: number) => string;
}

/**
 * The hero visualization for Charging Patterns: a 7×24 weekday/hour density
 * grid with a hover detail popover and a color-scale legend. The grid keeps a
 * sensible min-width and scrolls inside its own container on narrow screens so
 * the page itself never scrolls horizontally.
 */
export function HeatmapGrid({ model, energySlots, formatEnergy }: HeatmapGridProps) {
  const { t } = useTranslation();
  const grid = model?.grid ?? [];
  const maxCount = model?.maxCount ?? 0;
  const [hovered, setHovered] = useState<{ day: number; hour: number } | null>(null);
  const sessionsWord = t('charging.heatmap.sessionsWord', 'sessions');

  return (
    <div>
      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label={t('charging.heatmap.gridAria', 'Charging sessions by weekday and hour of day')}
          className="grid min-w-[640px] grid-cols-[56px_repeat(24,minmax(0,1fr))] gap-[2px]"
        >
          {/* Hour header row */}
          <div aria-hidden="true" />
          {HOURS.map((h) => (
            <Caption key={h} className="text-center">
              {h}
            </Caption>
          ))}

          {/* One row per weekday */}
          {DAYS.map((dayLabel, day) => (
            <Fragment key={dayLabel}>
              <div className="flex items-center">
                <Text variant="bodySm">{dayLabel}</Text>
              </div>
              {HOURS.map((hour) => {
                const cell = grid[day]?.[hour] ?? { count: 0, totalEnergyWh: 0 };
                const evidence = energySlots?.[day * 24 + hour];
                const energy = evidence?.energy_wh;
                const recordedCount = evidence?.recorded_energy_count;
                const hasEnergy = typeof energy === 'number' && Number.isFinite(energy)
                  && typeof recordedCount === 'number' && Number.isInteger(recordedCount)
                  && recordedCount > 0 && recordedCount <= cell.count;
                const partial = hasEnergy && recordedCount < cell.count;
                const isHovered = hovered?.day === day && hovered?.hour === hour;
                return (
                  <div
                    key={hour}
                    title={`${dayLabel} ${formatHourLabel(hour)} — ${cell.count} ${sessionsWord}`}
                    className={`relative h-7 rounded-sm transition-transform ${isHovered ? 'z-10 scale-125' : ''}`}
                    style={{ backgroundColor: heatColor(cell.count, maxCount) }}
                    onMouseEnter={() => setHovered({ day, hour })}
                    onMouseLeave={() => setHovered(null)}
                  >
                    {isHovered && cell.count > 0 && (
                      <div className="absolute bottom-full left-1/2 z-20 mb-1 w-max max-w-64 -translate-x-1/2 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1 shadow-lg">
                        <Text as="div" size="xs" color="primary">
                          {dayLabel} {formatHourLabel(hour)}
                        </Text>
                        <Text variant="caption" as="div">
                          {cell.count} {sessionsWord} · {hasEnergy
                            ? formatEnergy(energy)
                            : t('charging.heatmap.noMeasurements', 'No recorded measurements in the returned sessions')}
                        </Text>
                        {partial && (
                          <Text variant="caption" as="div">
                            {t('charging.heatmap.partialMeasurements', 'Some returned sessions have no recorded value; the total includes recorded values only.')}
                          </Text>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Color-scale legend */}
      <div className="mt-3 flex items-center gap-2">
        <Caption>{t('charging.heatmap.less', 'Less')}</Caption>
        {HEAT_LEGEND.map((c) => (
          <span
            key={c}
            aria-hidden="true"
            className="h-3 w-6 rounded-sm"
            style={{ backgroundColor: c }}
          />
        ))}
        <Caption>{t('charging.heatmap.more', 'More')}</Caption>
      </div>
    </div>
  );
}
