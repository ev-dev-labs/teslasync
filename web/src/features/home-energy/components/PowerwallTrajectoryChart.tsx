import { useTranslation } from 'react-i18next';
import { BatteryCharging } from 'lucide-react';
import { GlassPanel, PanelTitle } from '@/components/ui';
import {
  ChartContainer,
  ChartTooltip,
  chartGrid,
  axisTick,
  chartMarginLabeled,
  CHART_COLORS,
  AREA_DEFAULTS,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { formatTime } from '@/lib/dateFormat';
import type { PowerwallInput, SlotResult } from '../lib/types';

interface PowerwallTrajectoryChartProps {
  slots: SlotResult[];
  powerwall: PowerwallInput | null;
}

const CHART_HEIGHT = 260;

/** Powerwall state-of-charge trajectory across the horizon, with a reference line at the reserve floor. */
export function PowerwallTrajectoryChart({ slots, powerwall }: PowerwallTrajectoryChartProps) {
  const { t } = useTranslation();

  if (!powerwall) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3">{t('homeEnergy.powerwall.title', 'Powerwall Trajectory')}</PanelTitle>
        {/* no-action: the enable toggle lives in the Scenario & Assumptions panel above this chart. */}
        <EmptyState
          icon={<BatteryCharging className="h-8 w-8" />}
          message={t('homeEnergy.powerwall.none', 'No home battery is modeled in this scenario. Enable it under Scenario & Assumptions.')}
        />
      </GlassPanel>
    );
  }

  const rows = slots.map((s) => ({ time: s.startIso, socPct: Math.round(s.batterySocPct * 10) / 10 }));

  return (
    // chart-a11y:no-table dense 15-minute-slot SoC trace — the KPI summary reports the
    // aggregate battery energy figures in tabular form already.
    <ChartContainer
      title={t('homeEnergy.powerwall.title', 'Powerwall Trajectory')}
      subtitle={t('homeEnergy.powerwall.subtitle', 'Projected state of charge, with the backup reserve floor')}
      ariaLabel={t('homeEnergy.powerwall.aria', 'Powerwall state of charge over time, with reserve floor reference line')}
      empty={rows.length === 0}
      height={CHART_HEIGHT}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={rows} margin={chartMarginLabeled}>
          {chartGrid}
          <XAxis dataKey="time" tickFormatter={(v: string) => formatTime(v)} {...axisTick} />
          <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} {...axisTick} />
          <Tooltip content={<ChartTooltip />} />
          <ReferenceLine
            y={powerwall.reservePct}
            stroke={CHART_COLORS[4]}
            strokeDasharray="4 4"
            label={{ value: t('homeEnergy.powerwall.reserveLabel', 'Reserve floor'), position: 'insideBottomLeft', fill: CHART_COLORS[4] }}
          />
          <Area
            {...AREA_DEFAULTS}
            dataKey="socPct"
            name={t('homeEnergy.powerwall.soc', 'State of charge')}
            stroke={CHART_COLORS[3]}
            fill={CHART_COLORS[3]}
            fillOpacity={0.2}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartContainer>
  );
}
