import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { useFormatting } from '@/hooks/useFormatting';
import {
  ChartTooltip, PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { CostSection } from './CostSection';
import type { ChargerTypeData } from './types';

interface ChargerTypeBreakdownProps {
  data: ChargerTypeData[];
  totalCost: number;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function ChargerTypeBreakdown({
  data, totalCost, isLoading, error, onRetry,
}: ChargerTypeBreakdownProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  return (
    <CostSection
      title={t('costAnalysis.chargerType.title', 'Cost by Charger Type')}
      icon={<Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={data.length === 0}
      emptyMessage={t('costAnalysis.charts.noData', 'Not enough data')}
      skeletonHeight={280}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pie chart */}
        <div className="flex items-center justify-center lg:col-span-1">
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
        <div className="space-y-3 lg:col-span-2">
          <div className="mb-2 flex flex-wrap gap-4">
            {data.map((entry) => (
              <div key={entry.name} className="flex items-center gap-1.5">
                <span
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
                  <span>{fmtWithUnit(entry.energy, 'kWh', 1)}</span>
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
    </CostSection>
  );
}
