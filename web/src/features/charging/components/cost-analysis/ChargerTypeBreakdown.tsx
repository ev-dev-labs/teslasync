import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { Text, Caption } from '@/components/ui';
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

/** Neutral swatch/slice fill when an API row omits its brand color. */
const FALLBACK_COLOR = 'var(--text-muted)';

export function ChargerTypeBreakdown({
  data, totalCost, isLoading, error, onRetry,
}: ChargerTypeBreakdownProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  // Null-safe: a late/failed fetch can hand back undefined/null despite the
  // typed prop — degrade to the per-section empty state instead of crashing
  // on `.length` / `.map`.
  const rows = data ?? [];
  const total = totalCost ?? 0;

  return (
    <CostSection
      title={t('costAnalysis.chargerType.title', 'Cost by Charger Type')}
      icon={<Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={rows.length === 0}
      emptyMessage={t('costAnalysis.charts.noData', 'Not enough data')}
      skeletonHeight={280}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Pie chart */}
        <div
          className="flex items-center justify-center lg:col-span-1"
          role="img"
          aria-label={t(
            'costAnalysis.chargerType.chartAria',
            'Pie chart of charging cost by charger type.',
          )}
        >
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={rows}
                dataKey="cost"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={3}
                strokeWidth={0}
                isAnimationActive={false}
              >
                {rows.map((entry, idx) => (
                  <Cell key={`${entry.name ?? 'type'}-${idx}`} fill={entry.color ?? FALLBACK_COLOR} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Detail breakdown bars */}
        <div className="space-y-3 lg:col-span-2">
          <div className="mb-2 flex flex-wrap gap-4">
            {rows.map((entry, idx) => (
              <div key={`${entry.name ?? 'type'}-${idx}`} className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: entry.color ?? FALLBACK_COLOR }}
                  aria-hidden="true"
                />
                <Caption>{entry.name ?? '—'}</Caption>
              </div>
            ))}
          </div>
          {rows.map((entry, idx) => {
            const cost = entry.cost ?? 0;
            const energy = entry.energy ?? 0;
            const pct = total > 0 ? (cost / total) * 100 : 0;
            // Clamp the visual bar to [0,100] so a malformed row (cost > total,
            // or a NaN slipping through) can never paint an overflowing or
            // negative-width bar; the numeric label keeps the true percentage.
            const barWidth = Math.min(100, Math.max(0, pct));
            return (
              <div key={`${entry.name ?? 'type'}-${idx}`} className="space-y-1">
                <div className="flex items-center justify-between">
                  <Text size="xs" weight="medium" color="secondary">
                    {entry.name ?? '—'}
                  </Text>
                  <Caption>
                    {formatCurrency(cost, 2)} · {fmtInt(entry.sessions)}{' '}
                    {t('costAnalysis.chargerType.sessions', 'sessions')}
                  </Caption>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: entry.color ?? FALLBACK_COLOR,
                    }}
                  />
                </div>
                <div className="flex justify-between">
                  <Text size="2xs" color="muted">{fmtWithUnit(energy, 'kWh', 1)}</Text>
                  <Text size="2xs" color="muted">
                    {energy > 0
                      ? `${formatCurrency(cost / energy, 3)}/kWh`
                      : '—'}
                  </Text>
                  <Text size="2xs" color="muted">{fmtNumber(pct, 1)}%</Text>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </CostSection>
  );
}
