import { useTranslation } from 'react-i18next';
import {
  ChartContainer,
  ChartTooltip,
  ChartLegend,
  chartGrid,
  axisTick,
  chartMarginLabeled,
  CHART_COLORS,
  AREA_DEFAULTS,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { formatTime } from '@/lib/dateFormat';
import type { SlotResult } from '../lib/types';

interface EnergyFlowChartProps {
  slots: SlotResult[];
}

const CHART_HEIGHT = 320;

/** Multi-series stacked/line view of the proposed 15-minute-slot energy flow schedule. */
export function EnergyFlowChart({ slots }: EnergyFlowChartProps) {
  const { t } = useTranslation();
  const { formatPower } = useUnits();

  const rows = slots.map((s) => ({
    time: s.startIso,
    solarW: Math.round(s.solarW),
    loadW: Math.round(s.loadW),
    vehicleChargeW: Math.round(s.vehicleChargeW),
    batteryPowerW: Math.round(s.batteryPowerW),
    gridImportW: Math.round(s.gridImportW),
    gridExportW: Math.round(-s.gridExportW),
  }));

  return (
    // chart-a11y:no-table dense 15-minute-slot schedule (up to hundreds of rows) — the KPI summary
    // and per-vehicle readiness panels already surface the aggregate figures in tabular form.
    <ChartContainer
      title={t('homeEnergy.flow.title', 'Energy Flow Schedule')}
      subtitle={t('homeEnergy.flow.subtitle', 'Solar, household load, vehicle charging, battery, and grid — per 15-minute slot')}
      ariaLabel={t('homeEnergy.flow.aria', 'Multi-series chart of solar generation, household load, vehicle charging, battery, and grid power across the planning horizon')}
      empty={rows.length === 0}
      height={CHART_HEIGHT}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={rows} margin={chartMarginLabeled}>
          {chartGrid}
          <XAxis dataKey="time" tickFormatter={(v: string) => formatTime(v)} {...axisTick} />
          <YAxis tickFormatter={(v: number) => formatPower(v)} {...axisTick} />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Area
            {...AREA_DEFAULTS}
            dataKey="solarW"
            name={t('homeEnergy.flow.solar', 'Solar')}
            stroke={CHART_COLORS[2]}
            fill={CHART_COLORS[2]}
            fillOpacity={0.25}
          />
          <Line type="monotone" dataKey="loadW" name={t('homeEnergy.flow.load', 'Household load')} stroke={CHART_COLORS[0]} dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="vehicleChargeW" name={t('homeEnergy.flow.vehicles', 'Vehicle charging')} stroke={CHART_COLORS[1]} dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="batteryPowerW" name={t('homeEnergy.flow.battery', 'Powerwall (+charge/-discharge)')} stroke={CHART_COLORS[3]} dot={false} strokeWidth={2} strokeDasharray="4 2" />
          <Line type="monotone" dataKey="gridImportW" name={t('homeEnergy.flow.gridImport', 'Grid import')} stroke={CHART_COLORS[4]} dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="gridExportW" name={t('homeEnergy.flow.gridExport', 'Grid export (shown negative)')} stroke={CHART_COLORS[5]} dot={false} strokeWidth={1.5} />
          <ChartLegend />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
