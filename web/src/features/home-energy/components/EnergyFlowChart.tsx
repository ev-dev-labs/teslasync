import { useTranslation } from 'react-i18next';
import {
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
import { ChartCard } from '@/components/layout';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatTime } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import { asFiniteNumber } from '@/lib/typeGuards';
import type { SlotResult } from '../lib/types';

interface EnergyFlowChartProps {
  slots: SlotResult[];
  slotMinutes: number;
}

const CHART_HEIGHT = 320;

/** Multi-series stacked/line view of the proposed 15-minute-slot energy flow schedule. */
export function EnergyFlowChart({ slots, slotMinutes }: EnergyFlowChartProps) {
  const { t } = useTranslation();
  const { formatPower } = useUnits();
  const { fmtPercent } = useNumberFormatting();
  const powerLabel = (value: unknown) => formatPower(asFiniteNumber(value));
  const percentLabel = (value: unknown) => {
    const number = asFiniteNumber(value);
    return number === null ? '—' : fmtPercent(number);
  };

  const rows = slots.map((s) => ({
    time: s.startIso,
    solarW: asFiniteNumber(s.solarW),
    loadW: asFiniteNumber(s.loadW),
    vehicleChargeW: asFiniteNumber(s.vehicleChargeW),
    batteryPowerW: asFiniteNumber(s.batteryPowerW),
    gridImportW: asFiniteNumber(s.gridImportW),
    gridExportW: asFiniteNumber(s.gridExportW) === null ? null : -s.gridExportW,
    batterySocPct: asFiniteNumber(s.batterySocPct),
  }));

  return (
    <ChartCard
      title={t('homeEnergy.flow.title', 'Energy flow schedule')}
      subtitle={t('homeEnergy.flow.interval', 'Solar, household load, vehicle charging, battery, and grid — per {{minutes}}-minute slot', { minutes: slotMinutes })}
      ariaLabel={t('homeEnergy.flow.aria', 'Multi-series chart of solar generation, household load, vehicle charging, battery, and grid power across the planning horizon')}
      chartKey="home-energy-flow-schedule"
      empty={rows.length === 0}
      height={CHART_HEIGHT}
      data={rows}
      exportData={rows}
      exportable
      fullscreen
      dataColumns={[
        { key: 'time', label: t('powershare.time', 'Time') },
        { key: 'solarW', label: t('homeEnergy.flow.solar', 'Solar'), format: powerLabel },
        { key: 'loadW', label: t('homeEnergy.flow.load', 'Household load'), format: powerLabel },
        { key: 'vehicleChargeW', label: t('homeEnergy.flow.vehicles', 'Vehicle charging'), format: powerLabel },
        { key: 'batteryPowerW', label: t('homeEnergy.flow.battery', 'Powerwall (+charge/-discharge)'), format: powerLabel },
        { key: 'gridImportW', label: t('homeEnergy.flow.gridImport', 'Grid import'), format: powerLabel },
        { key: 'gridExportW', label: t('homeEnergy.flow.gridExport', 'Grid export (shown negative)'), format: powerLabel },
        { key: 'batterySocPct', label: t('homeEnergy.powerwall.soc', 'State of charge'), format: percentLabel },
      ]}
    >
      {({ hiddenSeries }) => (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={rows} margin={chartMarginLabeled}>
          {chartGrid}
          <XAxis dataKey="time" tickFormatter={(v: string) => formatTime(v)} {...axisTick} />
          <YAxis tickFormatter={(v: number) => formatPower(v)} {...axisTick} />
          <Tooltip content={<ChartTooltip formatter={(value, _name, entry) =>
            entry.dataKey === 'batterySocPct' ? percentLabel(value) : powerLabel(value)
          } />} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Area
            {...AREA_DEFAULTS}
            dataKey="solarW"
            name={t('homeEnergy.flow.solar', 'Solar')}
            stroke={CHART_COLORS[2]}
            fill={CHART_COLORS[2]}
            fillOpacity={0.08}
            hide={hiddenSeries?.isHidden('solarW')}
          />
          <Line type="monotone" dataKey="loadW" name={t('homeEnergy.flow.load', 'Household load')} stroke={CHART_COLORS[0]} dot={false} strokeWidth={2} hide={hiddenSeries?.isHidden('loadW')} />
          <Line type="monotone" dataKey="vehicleChargeW" name={t('homeEnergy.flow.vehicles', 'Vehicle charging')} stroke={CHART_COLORS[1]} dot={false} strokeWidth={2} hide={hiddenSeries?.isHidden('vehicleChargeW')} />
          <Line type="monotone" dataKey="batteryPowerW" name={t('homeEnergy.flow.battery', 'Powerwall (+charge/-discharge)')} stroke={CHART_COLORS[3]} dot={false} strokeWidth={2} strokeDasharray="4 2" hide={hiddenSeries?.isHidden('batteryPowerW')} />
          <Line type="monotone" dataKey="gridImportW" name={t('homeEnergy.flow.gridImport', 'Grid import')} stroke={CHART_COLORS[4]} dot={false} strokeWidth={chartTokens.cursor.strokeWidth} hide={hiddenSeries?.isHidden('gridImportW')} />
          <Line type="monotone" dataKey="gridExportW" name={t('homeEnergy.flow.gridExport', 'Grid export (shown negative)')} stroke={CHART_COLORS[5]} dot={false} strokeWidth={chartTokens.cursor.strokeWidth} hide={hiddenSeries?.isHidden('gridExportW')} />
          <ChartLegend />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
