import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { Zap } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from '@/components/charts';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import type { ChargerTypeData } from './types';

interface ChargerTypeBreakdownProps {
  data: ChargerTypeData[];
  totalCost: number;
}

interface ChargerTypeTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: ChargerTypeData }>;
  formatCurrency: (amount: number, decimals?: number) => string;
  sessionsLabel: string;
}

// recharts builds a Pie tooltip payload item WITHOUT a top-level `color`/`fill`
// (the segment data — including its colour — sits under `payload[0].payload`),
// so the generic shared <ChartTooltip> can't resolve the per-segment swatch.
// This pie-aware renderer reads the segment directly, matching the glass styling
// of the migrated ChartTooltip. `pointer-events-none` keeps it tap-friendly on
// touch devices; `role="tooltip"` announces it to assistive tech.
function ChargerTypeTooltip({
  active,
  payload,
  formatCurrency,
  sessionsLabel,
}: ChargerTypeTooltipProps) {
  const entry = payload?.[0]?.payload;
  if (!active || !entry) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none max-w-[min(16rem,90vw)] select-none rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-3 text-xs shadow-[0_8px_32px_rgba(0,0,0,0.3)] backdrop-blur-xl"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: entry.color }}
        />
        <span className="font-medium text-[var(--text-secondary)]">
          {entry.name ?? '—'}
        </span>
      </div>
      <div className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">
        {formatCurrency(entry.cost ?? 0, 2)}
      </div>
      <div className="mt-0.5 text-[var(--text-muted)]">
        {fmtInt(entry.sessions ?? 0)} {sessionsLabel} ·{' '}
        {fmtWithUnit(entry.energy ?? 0, 'kWh', 1)}
      </div>
    </div>
  );
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
                <Tooltip
                  content={
                    <ChargerTypeTooltip
                      formatCurrency={formatCurrency}
                      sessionsLabel={t('costAnalysis.chargerType.sessions', 'sessions')}
                    />
                  }
                />
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
