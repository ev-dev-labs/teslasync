import { useTranslation } from 'react-i18next';
import { Calendar, Plug } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, ChartGradient, chartGrid, axisTickSm,
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
  AREA_DEFAULTS,
} from '@/components/charts';
import { fmtNumber, fmtWithUnit } from '@/lib/numberFormat';
import type { EnergyTrendPoint, ChargerBreakdownEntry, CostByTypeEntry } from './helpers';

interface ChartsRowProps {
  energyTrend: EnergyTrendPoint[];
  chargerBreakdown: ChargerBreakdownEntry[];
  costByType: CostByTypeEntry[];
}

export function ChartsRow({ energyTrend, chargerBreakdown, costByType }: ChartsRowProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Energy & Cost Trend */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-neon-cyan" />
            {t('charging.charts.energyCostTrend', 'Energy & Cost Trend')}
          </h3>
          <div className="h-40 sm:h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={energyTrend}>
                <defs>
                  <ChartGradient id="eGrad" color="#10b981" />
                </defs>
                {chartGrid}
                <XAxis dataKey="date" tick={axisTickSm} />
                <YAxis tick={axisTickSm} />
                <Tooltip content={<ChartTooltip />} />
                <Area {...AREA_DEFAULTS} dataKey="energy" name="Energy (kWh)" stroke="#10b981" fill="url(#eGrad)" />
                <Area {...AREA_DEFAULTS} dataKey="cost" name="Cost ($)" stroke="#f59e0b" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Charger Type Breakdown */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <Plug className="h-4 w-4 text-neon-purple" />
            {t('charging.charts.chargerBreakdown', 'Charger Breakdown')}
          </h3>
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="h-36 w-36 sm:h-48 sm:w-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chargerBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                    {chargerBreakdown.map((d, i) => (
                      <Cell key={i} fill={d.fill} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-3">
              {costByType.map((ct) => (
                <div key={ct.name}>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">{ct.name}</span>
                    <span className="text-[var(--text-primary)] font-medium">{fmtWithUnit(ct.energy, 'kWh')}</span>
                  </div>
                  <div className="flex justify-between text-xs text-[var(--text-muted)]">
                    <span>${fmtNumber(ct.cost)} total</span>
                    <span>${fmtNumber(ct.perKwh)}/kWh</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>
    </div>
  );
}
