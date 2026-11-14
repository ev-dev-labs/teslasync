import { Fragment, useCallback, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button, Caption, Popover, Text } from '@/components/ui';
import { HeatmapLegend } from '@/components/charts';
import { DAYS } from '@/lib/constants';
import { createHeatmapScale, heatmapColor, heatmapTextColor } from '@/lib/heatmap';
import { formatHourLabel, type HeatmapModel } from './heatmapData';

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
  /** The containing chart frame already provides the visualization label. */
  framed?: boolean;
  dayLabels?: readonly string[];
}

/**
 * The hero visualization for Charging Patterns: a 7×24 weekday/hour density
 * grid with shared hover/activation detail and a color-scale legend. One roving
 * tab stop exposes cell buttons without adding 168 sequential stops. On phones
 * each weekday wraps into six-hour rows so every slot remains touchable.
 */
export function HeatmapGrid({ model, energySlots, formatEnergy, framed = false, dayLabels = DAYS }: HeatmapGridProps) {
  const { t } = useTranslation();
  const grid = model?.grid ?? [];
  const scale = useMemo(() => createHeatmapScale(
    (model?.grid ?? []).flatMap(row => row.map(cell => cell.count)),
  ), [model]);
  const [hovered, setHovered] = useState<{ day: number; hour: number; pinned: boolean } | null>(null);
  const [activeSlot, setActiveSlot] = useState(0);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const detailId = useId();
  const closeDetail = useCallback(() => setHovered(null), []);
  const sessionsWord = t('charging.heatmap.sessionsWord', 'sessions');
  const selectedCell = hovered ? grid[hovered.day]?.[hovered.hour] : undefined;
  const evidence = hovered ? energySlots?.[hovered.day * 24 + hovered.hour] : undefined;
  const energy = evidence?.energy_wh;
  const recordedCount = evidence?.recorded_energy_count;
  const hasEnergy = typeof energy === 'number' && Number.isFinite(energy)
    && typeof recordedCount === 'number' && Number.isInteger(recordedCount)
    && recordedCount > 0 && recordedCount <= (selectedCell?.count ?? 0);
  const partial = hasEnergy && recordedCount < (selectedCell?.count ?? 0);
  const detailOpen = hovered != null && (selectedCell?.count ?? 0) > 0;
  const openDetail = (anchor: HTMLButtonElement, day: number, hour: number, pinned = false) => {
    anchorRef.current = anchor;
    setActiveSlot(day * 24 + hour);
    setHovered({ day, hour, pinned });
  };

  return (
    <div>
      <div className="min-w-0">
        <div
          data-app-part="chart-plot"
          {...(framed ? {} : {
            role: 'group' as const,
            'aria-label': t('charging.heatmap.gridAria', 'Charging sessions by weekday and hour of day'),
          })}
          data-heatmap-grid
          className="grid grid-cols-6 gap-0.5 sm:grid-cols-[56px_repeat(24,minmax(0,1fr))]"
        >
          {/* Hour header row */}
          <div aria-hidden="true" data-heatmap-axis-spacer className="hidden sm:block" />
          {HOURS.map((h) => (
            <Caption key={h} data-heatmap-axis-hour={h} className="hidden text-center sm:block">
              {h}
            </Caption>
          ))}

          {/* One row per weekday */}
          {dayLabels.map((dayLabel, day) => (
            <Fragment key={dayLabel}>
              <div data-heatmap-day-label className="col-span-6 flex items-center pt-2 sm:col-span-1 sm:pt-0">
                <Text variant="bodySm">{dayLabel}</Text>
              </div>
              {HOURS.map((hour) => {
                const cell = grid[day]?.[hour] ?? { count: 0, totalEnergyWh: 0 };
                const level = scale(cell.count);
                const isHovered = hovered?.day === day && hovered?.hour === hour;
                const slot = day * 24 + hour;
                const label = `${dayLabel} ${formatHourLabel(hour)} — ${cell.count} ${sessionsWord}`;
                return (
                  <Button
                    key={hour}
                    type="button"
                    variant="ghost"
                    data-app-part="chart-plot"
                    data-chart-family="heatmap"
                    data-heatmap-level={level ?? undefined}
                    data-heatmap-state={level == null ? 'unavailable' : level === 0 ? 'idle' : 'active'}
                    data-heatmap-slot={slot}
                    tabIndex={activeSlot === slot ? 0 : -1}
                    aria-label={label}
                    title={label}
                    aria-haspopup="dialog"
                    aria-expanded={isHovered && detailOpen}
                    aria-describedby={isHovered && detailOpen ? detailId : undefined}
                    className={`relative h-11 min-w-0 rounded-sm border border-[var(--border-subtle)] p-0 text-base transition-transform motion-reduce:transition-none sm:h-7 ${isHovered ? 'z-10 scale-125' : ''}`}
                    style={{ backgroundColor: heatmapColor(level), color: heatmapTextColor(level) }}
                    onFocus={() => setActiveSlot(slot)}
                    onMouseEnter={event => openDetail(event.currentTarget, day, hour)}
                    onMouseLeave={event => {
                      if (!hovered?.pinned && document.activeElement !== event.currentTarget
                        && !(event.relatedTarget instanceof Node && document.getElementById(detailId)?.parentElement?.contains(event.relatedTarget))) closeDetail();
                    }}
                    onBlur={event => {
                      if (!event.currentTarget.parentElement?.contains(event.relatedTarget)
                        && !(event.relatedTarget instanceof Node && document.getElementById(detailId)?.contains(event.relatedTarget))) closeDetail();
                    }}
                    onClick={event => {
                      if (isHovered && hovered.pinned) closeDetail();
                      else openDetail(event.currentTarget, day, hour, true);
                    }}
                    onKeyDown={event => {
                      let next = slot;
                      switch (event.key) {
                        case 'ArrowLeft': next = day * 24 + Math.max(0, hour - 1); break;
                        case 'ArrowRight': next = day * 24 + Math.min(23, hour + 1); break;
                        case 'ArrowUp': next = Math.max(0, day - 1) * 24 + hour; break;
                        case 'ArrowDown': next = Math.min(dayLabels.length - 1, day + 1) * 24 + hour; break;
                        case 'Home': next = event.ctrlKey ? 0 : day * 24; break;
                        case 'End': next = event.ctrlKey ? dayLabels.length * 24 - 1 : day * 24 + 23; break;
                        default: return;
                      }
                      event.preventDefault();
                      const target = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-heatmap-slot="${next}"]`);
                      target?.focus();
                      if (detailOpen && target) openDetail(target, Math.floor(next / 24), next % 24, hovered?.pinned);
                    }}
                  >
                    <span aria-hidden="true" data-heatmap-hour-label className="sm:hidden">{hour}</span>
                  </Button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      {/* Changing the selected slot remounts the shared anchor measurement. */}
      <Popover key={activeSlot} open={detailOpen} onClose={closeDetail} anchorRef={anchorRef}
        side="top"
        sideOffset={0}
        align="center"
        ariaLabel={hovered ? `${dayLabels[hovered.day]} ${formatHourLabel(hovered.hour)}` : undefined}
      >
        {hovered && selectedCell && (
          <div
            id={detailId}
            data-app-part="chart-tooltip"
            data-heatmap-tooltip
            className="max-w-64 rounded-md px-2 py-1"
            onMouseLeave={event => {
              if (!hovered.pinned && !event.currentTarget.contains(document.activeElement)
                && document.activeElement !== anchorRef.current
                && !(event.relatedTarget instanceof Node && anchorRef.current?.contains(event.relatedTarget))) closeDetail();
            }}
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchorRef.current) closeDetail();
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <Text as="div" size="xs" color="primary" data-chart-tooltip-label>
                {dayLabels[hovered.day]} {formatHourLabel(hovered.hour)}
              </Text>
              <Button
                variant="ghost"
                size="sm"
                className="h-11 w-11 shrink-0 p-0"
                aria-label={t('common.close', 'Close')}
                icon={<X className="h-4 w-4" aria-hidden="true" />}
                onClick={closeDetail}
              />
            </div>
            <Text variant="caption" as="div" data-chart-readout data-chart-tooltip-copy>
              {selectedCell.count} {sessionsWord} · {hasEnergy
                ? formatEnergy(energy)
                : t('charging.heatmap.noMeasurements', 'No recorded measurements in the returned sessions')}
            </Text>
            {partial && (
              <Text variant="caption" as="div" data-chart-tooltip-copy>
                {t('charging.heatmap.partialMeasurements', 'Some returned sessions have no recorded value; the total includes recorded values only.')}
              </Text>
            )}
          </div>
        )}
      </Popover>

      <HeatmapLegend
        label={`${t('charging.heatmap.less', 'Less')} – ${t('charging.heatmap.more', 'More')}`}
        less={t('charging.heatmap.less', 'Less')}
        more={t('charging.heatmap.more', 'More')}
      />
    </div>
  );
}
