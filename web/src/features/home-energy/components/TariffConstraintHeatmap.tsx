import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Caption } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { formatTime } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { GridLimits, SlotResult } from '../lib/types';

interface TariffConstraintHeatmapProps {
  slots: SlotResult[];
  grid: GridLimits;
  hasPowerwall: boolean;
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
 * charging / Powerwall SoC as a dense per-slot heatmap row set, scrollable
 * horizontally for long horizons. Cell color and column count are
 * data-driven so a static Tailwind class cannot express them — the sanctioned
 * `style={{}}` exception (see `HeatmapGrid.tsx` precedent).
 */
export function TariffConstraintHeatmap({ slots, grid, hasPowerwall }: TariffConstraintHeatmapProps) {
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

  const columnStyle = { gridTemplateColumns: `repeat(${Math.max(1, slots.length)}, max-content)` };

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

  return (
    <LayoutCard title={t('homeEnergy.heatmap.title', 'Tariff & constraint heatmap')}>
      {slots.length === 0 ? (
        <Caption>{t('homeEnergy.heatmap.empty', 'No plan slots to display yet.')}</Caption>
      ) : (
        <div className="overflow-x-auto p-1">
          <div className="w-max">
            {rows.map((row) => (
              <div key={row.key} className="mb-1.5 flex items-center gap-2">
                <Caption className="w-32 shrink-0 break-words whitespace-normal">{row.label}</Caption>
                <div role="group" aria-label={row.label} className="grid gap-2" style={columnStyle}>
                  {slots.map((s, i) => (
                    <Button
                      key={i}
                      type="button"
                      variant="ghost"
                      title={`${formatTime(s.startIso)} — ${row.format(s)}`}
                      aria-label={`${row.label}: ${formatTime(s.startIso)} — ${row.format(s)}`}
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
        <Caption as="div" id={detailId} className="mt-2 break-words">
          {`${activeRow.label}: ${formatTime(activeSlot.startIso)} — ${activeRow.format(activeSlot)}`}
        </Caption>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Caption>{t('homeEnergy.heatmap.less', 'Less')}</Caption>
        {HEAT_LEGEND.map((c) => (
          <span key={c} aria-hidden="true" className="h-3 w-6 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <Caption>{t('homeEnergy.heatmap.more', 'More')}</Caption>
      </div>
    </LayoutCard>
  );
}
