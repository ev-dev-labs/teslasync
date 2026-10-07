import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, Caption } from '@/components/ui';
import { formatTime } from '@/lib/dateFormat';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { GridLimits, SlotResult } from '../lib/types';

interface TariffConstraintHeatmapProps {
  slots: SlotResult[];
  grid: GridLimits;
  hasPowerwall: boolean;
}

const CELL_PX = 18;

/** Ratio (0–1) → rgba heat color. Same 5-bucket scale used by the charging-patterns heatmap for visual consistency. */
function heatColor(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'rgba(0, 240, 255, 0.04)';
  if (ratio < 0.25) return 'rgba(0, 240, 255, 0.15)';
  if (ratio < 0.5) return 'rgba(16, 185, 129, 0.4)';
  if (ratio < 0.75) return 'rgba(245, 158, 11, 0.55)';
  return 'rgba(239, 68, 68, 0.75)';
}

const HEAT_LEGEND: readonly string[] = [
  'rgba(0, 240, 255, 0.04)',
  'rgba(0, 240, 255, 0.15)',
  'rgba(16, 185, 129, 0.4)',
  'rgba(245, 158, 11, 0.55)',
  'rgba(239, 68, 68, 0.75)',
];

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

  const maxImportPrice = useMemo(
    () => Math.max(0.0001, ...slots.map((s) => s.importPricePerKwh)),
    [slots],
  );
  const maxVehicleW = useMemo(
    () => Math.max(1, ...slots.map((s) => s.vehicleChargeW)),
    [slots],
  );

  const columnStyle = { gridTemplateColumns: `repeat(${Math.max(1, slots.length)}, ${CELL_PX}px)` };
  const minWidthPx = Math.max(1, slots.length) * CELL_PX + 80;

  const rows: Array<{ key: string; label: string; ratio: (s: SlotResult) => number; format: (s: SlotResult) => string }> = [
    {
      key: 'tariff',
      label: t('homeEnergy.heatmap.tariff', 'Import tariff'),
      ratio: (s) => s.importPricePerKwh / maxImportPrice,
      format: (s) => `${formatCurrency(s.importPricePerKwh, 2)}/kWh`,
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

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3">{t('homeEnergy.heatmap.title', 'Tariff & Constraint Heatmap')}</PanelTitle>
      {slots.length === 0 ? (
        <Caption>{t('homeEnergy.heatmap.empty', 'No plan slots to display yet.')}</Caption>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: `${minWidthPx}px` }}>
            {rows.map((row) => (
              <div key={row.key} className="mb-1.5 flex items-center gap-2">
                <Caption className="w-32 shrink-0 truncate">{row.label}</Caption>
                <div role="img" aria-label={row.label} className="grid gap-[2px]" style={columnStyle}>
                  {slots.map((s, i) => (
                    <div
                      key={i}
                      title={`${formatTime(s.startIso)} — ${row.format(s)}`}
                      className="h-4 rounded-[2px]"
                      style={{ backgroundColor: heatColor(row.ratio(s)) }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Caption>{t('homeEnergy.heatmap.less', 'Less')}</Caption>
        {HEAT_LEGEND.map((c) => (
          <Fragment key={c}>
            <span aria-hidden="true" className="h-3 w-6 rounded-sm" style={{ backgroundColor: c }} />
          </Fragment>
        ))}
        <Caption>{t('homeEnergy.heatmap.more', 'More')}</Caption>
      </div>
    </GlassPanel>
  );
}
