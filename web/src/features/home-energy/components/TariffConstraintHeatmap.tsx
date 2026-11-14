import { useId, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Caption, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { formatTime } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { GridLimits, SlotResult } from '../lib/types';
import { DEFAULT_SLOT_MINUTES } from '../lib/scenarioDefaults';

interface TariffConstraintHeatmapProps {
  slots: SlotResult[];
  grid: GridLimits;
  hasPowerwall: boolean;
  slotMinutes?: number;
}

const HEAT_LEGEND = [4, 15, 40, 55, 75].map(
  (intensity) => `color-mix(in srgb, ${chartTokens.series[0]} ${intensity}%, transparent)`,
);

/** Preserve the five ratio buckets; intensity is not a success/failure status. */
function heatColor(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return HEAT_LEGEND[0];
  if (ratio < 0.25) return HEAT_LEGEND[1];
  if (ratio < 0.5) return HEAT_LEGEND[2];
  if (ratio < 0.75) return HEAT_LEGEND[3];
  return HEAT_LEGEND[4];
}

/**
 * Tariff price / grid-import utilization / grid-export utilization / vehicle
 * charging / Powerwall SoC as a per-slot heatmap. Phone layouts wrap the
 * complete horizon; wider layouts keep the continuous, scrollable timeline.
 */
export function TariffConstraintHeatmap({ slots, grid, hasPowerwall, slotMinutes = DEFAULT_SLOT_MINUTES }: TariffConstraintHeatmapProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const { formatPower } = useUnits();
  const detailId = useId();
  const [activeCell, setActiveCell] = useState({ rowKey: 'tariff', index: 0 });

  const maxImportPrice = useMemo(
    () => Math.max(0.0001, ...slots.map((s) => s.importPricePerKwh)),
    [slots],
  );
  const maxVehicleW = useMemo(
    () => Math.max(1, ...slots.map((s) => s.vehicleChargeW)),
    [slots],
  );

  const columnStyle = {
    '--tariff-heatmap-columns': `repeat(${Math.max(1, slots.length)}, max-content)`,
  } as CSSProperties;

  const rows: Array<{ key: string; label: string; ratio: (s: SlotResult) => number; format: (s: SlotResult) => string }> = [
    {
      key: 'tariff',
      label: t('homeEnergy.heatmap.tariff', 'Import tariff'),
      ratio: (s) => s.importPricePerKwh / maxImportPrice,
      format: (s) => `${formatCurrency(s.importPricePerKwh)}/kWh`,
    },
    {
      key: 'gridImport',
      label: t('homeEnergy.heatmap.gridImport', 'Grid import %'),
      ratio: (s) => (grid.maxImportW > 0 ? s.gridImportW / grid.maxImportW : 0),
      format: (s) => formatPower(s.gridImportW),
    },
    {
      key: 'gridExport',
      label: t('homeEnergy.heatmap.gridExport', 'Grid export %'),
      ratio: (s) => (grid.maxExportW > 0 ? s.gridExportW / grid.maxExportW : 0),
      format: (s) => formatPower(s.gridExportW),
    },
    {
      key: 'vehicles',
      label: t('homeEnergy.heatmap.vehicles', 'Vehicle charging'),
      ratio: (s) => s.vehicleChargeW / maxVehicleW,
      format: (s) => formatPower(s.vehicleChargeW),
    },
    ...(hasPowerwall
      ? [
          {
            key: 'powerwall',
            label: t('homeEnergy.heatmap.powerwall', 'Powerwall SoC'),
            ratio: (s: SlotResult) => s.batterySocPct / 100,
            format: (s: SlotResult) => `${Math.round(s.batterySocPct)}%`,
          },
        ]
      : []),
  ];
  const activeRow = rows.find((row) => row.key === activeCell.rowKey) ?? rows[0];
  const activeSlot = slots[activeCell.index] ?? slots[0];
  const rowTime = (rowKey: string, s: SlotResult) => formatTime(
    rowKey === 'powerwall'
      ? new Date(Date.parse(s.startIso) + slotMinutes * 60_000).toISOString()
      : s.startIso,
  );

  return (
    <LayoutCard title={t('homeEnergy.heatmap.title', 'Tariff & constraint heatmap')}>
      {slots.length === 0 ? (
        <Caption>{t('homeEnergy.heatmap.empty', 'No plan slots to display yet.')}</Caption>
      ) : (
        <div data-tariff-heatmap className="min-w-0 p-1 md:overflow-x-auto">
          <div className="min-w-0 md:w-max">
            {rows.map((row) => (
              <div key={row.key} className="mb-1.5 flex flex-col items-start gap-2 md:flex-row md:items-center">
                <Text as="div" variant="bodySm" className="w-full shrink-0 break-words whitespace-normal md:w-32">{row.label}</Text>
                <div
                  data-tariff-heatmap-cells
                  role="group"
                  aria-label={row.label}
                  className="grid w-full grid-cols-[repeat(auto-fit,minmax(var(--app-touch-size,2.75rem),1fr))] justify-items-center gap-[var(--app-heatmap-gap,0.25rem)] md:w-auto md:grid-cols-[var(--tariff-heatmap-columns)] md:gap-2"
                  style={columnStyle}
                >
                  {slots.map((s, i) => (
                    <Button
                      key={i}
                      type="button"
                      variant="ghost"
                      title={`${rowTime(row.key, s)} — ${row.format(s)}`}
                      aria-label={`${row.label}: ${rowTime(row.key, s)} — ${row.format(s)}`}
                      aria-describedby={detailId}
                      className="h-11 w-11 min-w-11 p-0 md:h-6 md:w-6 md:min-w-6"
                      onFocus={() => setActiveCell({ rowKey: row.key, index: i })}
                      onMouseEnter={() => setActiveCell({ rowKey: row.key, index: i })}
                      onClick={() => setActiveCell({ rowKey: row.key, index: i })}
                    >
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 rounded-sm"
                        style={{ backgroundColor: heatColor(row.ratio(s)) }}
                      />
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {activeSlot && (
        <Text as="div" variant="bodySm" id={detailId} data-tariff-heatmap-detail
          className="sticky bottom-[var(--shell-chrome-bottom)] z-10 break-words rounded-shape-sm bg-[var(--surface-1)] px-d-pad-x py-d-pad-y shadow-e1 md:static md:bg-transparent md:p-0 md:shadow-none">
          {`${activeRow.label}: ${rowTime(activeRow.key, activeSlot)} — ${activeRow.format(activeSlot)}`}
        </Text>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Caption>{t('homeEnergy.heatmap.less', 'Less')}</Caption>
        {HEAT_LEGEND.map((c) => (
          <span key={c} aria-hidden="true" className="h-3 w-6 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <Caption>{t('homeEnergy.heatmap.more', 'More')}</Caption>
      </div>
    </LayoutCard>
  );
}
