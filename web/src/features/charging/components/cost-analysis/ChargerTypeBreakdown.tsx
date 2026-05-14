import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Zap } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip, PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import type { ChargerTypeData } from './types';

interface ChargerTypeBreakdownProps {
  data: ChargerTypeData[];
  totalCost: number;
}

export function ChargerTypeBreakdown({ data, totalCost }: ChargerTypeBreakdownProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  return (
    <GlassPanel className="p-4">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
        <Zap className="h-4 w-4 text-yellow-400" />
        {t('costAnalysis.chargerType.title', 'Cost by Charger Type')}
      </h3>
      {data.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Pie chart */}
          <div className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="cost"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {data.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Detail breakdown bars */}
          <div className="space-y-3">
            <div className="mb-2 flex flex-wrap gap-4">
              {data.map((entry) => (
                <div key={entry.name} className="flex items-center gap-1.5">
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-xs text-[var(--text-muted)]">{entry.name}</span>
                </div>
              ))}
            </div>
            {data.map((entry) => {
              const pct = totalCost > 0 ? (entry.cost / totalCost) * 100 : 0;
              return (
                <div key={entry.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--text-secondary)]">
                      {entry.name}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      {formatCurrency(entry.cost, 2)} · {fmtInt(entry.sessions)}{' '}
                      {t('costAnalysis.chargerType.sessions', 'sessions')}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: entry.color,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
                    <span>
                      {fmtWithUnit(entry.energy, 'kWh', 1)}
                    </span>
                    <span>
                      {entry.energy > 0
                        ? `${formatCurrency(entry.cost / entry.energy, 3)}/kWh`
                        : '—'}
                    </span>
                    <span>{fmtNumber(pct, 1)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex h-[200px] items-center justify-center text-sm text-[var(--text-muted)]">
          {t('costAnalysis.charts.noData', 'Not enough data')}
        </div>
      )}
    </GlassPanel>
  );
}
