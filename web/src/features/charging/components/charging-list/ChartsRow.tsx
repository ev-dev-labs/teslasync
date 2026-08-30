import { useTranslation } from 'react-i18next';
import { Calendar, Plug } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import {
  ChartLegend, ChartTooltip, ChartGradient, EmbeddedChart, chartGrid, axisTickSm,
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

  // Null-safety: callers derive these from a possibly-empty session list, and a
  // late/failed fetch can hand us `undefined`. Normalise before any `.map` /
  // `.length` so a missing prop degrades to an empty state, never a crash.
  const trend = energyTrend ?? [];
  const breakdown = chargerBreakdown ?? [];
  const costs = costByType ?? [];

  const hasTrend = trend.length > 0;
  const hasBreakdown = breakdown.length > 0 || costs.length > 0;

  const energySeriesName = t('charging.charts.energyKwh', 'Energy (kWh)');
  const costSeriesName = t('charging.charts.costUsd', 'Cost ($)');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Energy & Cost Trend */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-neon-cyan" aria-hidden="true" />
            {t('charging.charts.energyCostTrend', 'Energy & Cost Trend')}
          </h3>
          <EmbeddedChart
            title={t('charging.charts.energyCostTrend', 'Energy & Cost Trend')}
            ariaLabel={t(
              'charging.charts.energyCostTrendAria',
              'Charging energy and cost trend',
            )}
            data={trend.map(({ date, energy, cost }) => ({ date, energy, cost }))}
            dataColumns={[
              { key: 'date', label: t('charging.charts.date', 'Date') },
              { key: 'energy', label: energySeriesName },
              { key: 'cost', label: costSeriesName },
            ]}
            chartKey="charging-list-energy-cost-trend"
            empty={!hasTrend}
            emptyMessage={t(
              'charging.charts.noTrendData',
              'No charging trend data available yet.',
            )}
            fluid={false}
            mobileHeight={160}
            height={208}
          >
            {({ hiddenSeries }) => (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    <ChartGradient id="eGrad" color="#10b981" />
                  </defs>
                  {chartGrid}
                  <XAxis dataKey="date" tick={axisTickSm} />
                  <YAxis tick={axisTickSm} />
                  <Tooltip content={<ChartTooltip />} />
                  <ChartLegend />
                  <Area {...AREA_DEFAULTS} dataKey="energy" name={energySeriesName} stroke="#10b981" fill="url(#eGrad)" hide={hiddenSeries?.isHidden('energy')} />
                  <Area {...AREA_DEFAULTS} dataKey="cost" name={costSeriesName} stroke="#f59e0b" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" hide={hiddenSeries?.isHidden('cost')} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </EmbeddedChart>
        </GlassPanel>
      </FadeIn>

      {/* Charger Type Breakdown */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <Plug className="h-4 w-4 text-neon-purple" aria-hidden="true" />
            {t('charging.charts.chargerBreakdown', 'Charger Breakdown')}
          </h3>
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
              <EmbeddedChart
                title={t('charging.charts.chargerBreakdown', 'Charger Breakdown')}
                ariaLabel={t(
                  'charging.charts.chargerBreakdownAria',
                  'Charging sessions by charger type',
                )}
                data={breakdown.map(({ name, value }) => ({ name, value }))}
                dataColumns={[
                  { key: 'name', label: t('charging.charts.chargerType', 'Charger type') },
                  { key: 'value', label: t('charging.charts.sessions', 'Sessions') },
                ]}
                empty={!hasBreakdown}
                emptyMessage={t(
                  'charging.charts.noBreakdownData',
                  'No charger breakdown data available yet.',
                )}
                fluid={false}
                mobileHeight={144}
                height={192}
                className="w-36 shrink-0 sm:w-48"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={breakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                      {breakdown.map((d) => (
                        <Cell key={d.name} fill={d.fill} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </EmbeddedChart>
              <div className="flex-1 space-y-3">
                {costs.map((ct) => (
                  <div key={ct.name}>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-secondary)]">{ct.name}</span>
                      <span className="text-[var(--text-primary)] font-medium">{fmtWithUnit(ct.energy ?? 0, 'kWh')}</span>
                    </div>
                    <div className="flex justify-between text-xs text-[var(--text-muted)]">
                      <span>${fmtNumber(ct.cost ?? 0)} {t('charging.charts.total', 'total')}</span>
                      <span>${fmtNumber(ct.perKwh ?? 0)}/kWh</span>
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
