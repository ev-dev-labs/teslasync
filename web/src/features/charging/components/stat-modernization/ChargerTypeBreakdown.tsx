import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { Text, Caption } from '@/components/ui';
import { StatGroup } from '@/components/data-display/stat-reference';
import {
  ChartTooltip, PieChart, Pie, Cell, Tooltip, ResponsiveContainer, EmbeddedChart,
} from '@/components/charts';
import type { StatPeriod } from '@/lib/metric-reference';
import type { ChargerTypeData } from '../cost-analysis/types';
import { CostStatSection } from './CostStatSection';
import { energyDisplay, kwhToCanonicalWh } from './displayBoundary';
import { useStatFormatting } from './useStatFormatting';

interface ChargerTypeBreakdownProps {
  data: ChargerTypeData[];
  totalCost: number;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  period: StatPeriod;
}
const FALLBACK_COLOR = 'var(--text-muted)';

export function ChargerTypeBreakdown({
  data, totalCost, isLoading, error, onRetry, period,
}: ChargerTypeBreakdownProps) {
  const { t } = useTranslation();
  const { preferences } = useStatFormatting();
  const rows = data ?? [];
  const total = totalCost ?? 0;

  return (
    <CostStatSection title={t('costAnalysis.chargerType.title', 'Cost by Charger Type')}
      icon={<Zap className="h-4 w-4 text-amber-300" aria-hidden="true" />}
      isLoading={isLoading} error={error} onRetry={onRetry} retained={rows.length > 0}
      isEmpty={rows.length === 0} period={period}
      emptyMessage={t('costAnalysis.charts.noData', 'Not enough data')} skeletonHeight={280}>
      {periodHeaderId => (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <EmbeddedChart
            title={t('costAnalysis.chargerType.title', 'Cost by Charger Type')}
            ariaLabel={t('costAnalysis.chargerType.chartAria', 'Pie chart of charging cost by charger type.')}
            data={rows.map(({ name, cost, energy, sessions }) => ({
              name: name ?? '—', cost: cost ?? 0, energy: energy ?? 0, sessions: sessions ?? 0,
            }))}
            dataColumns={[
              { key: 'name', label: t('costAnalysis.chargerType.type', 'Charger type') },
              { key: 'cost', label: t('costAnalysis.chargerType.cost', 'Cost') },
              { key: 'energy', label: t('costAnalysis.chargerType.energy', 'Energy (kWh)') },
              { key: 'sessions', label: t('costAnalysis.chargerType.sessions', 'Sessions') },
            ]}
            fluid={false} mobileHeight={280} height={280}
            className="flex items-center justify-center lg:col-span-1">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={rows} dataKey="cost" nameKey="name" cx="50%" cy="50%"
                  innerRadius={60} outerRadius={100} paddingAngle={3} strokeWidth={0} isAnimationActive={false}>
                  {rows.map((entry, idx) => (
                    <Cell key={`${entry.name ?? 'type'}-${idx}`} fill={entry.color ?? FALLBACK_COLOR} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </EmbeddedChart>
          <div className="space-y-3 lg:col-span-2">
            <div className="mb-2 flex flex-wrap gap-4">
              {rows.map((entry, idx) => (
                <div key={`${entry.name ?? 'type'}-${idx}`} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: entry.color ?? FALLBACK_COLOR }} aria-hidden="true" />
                  <Caption>{entry.name ?? '—'}</Caption>
                </div>
              ))}
            </div>
            {rows.map((entry, idx) => {
              const cost = entry.cost ?? 0;
              const energy = entry.energy ?? 0;
              const pct = total > 0 ? (cost / total) * 100 : 0;
              const barWidth = Math.min(100, Math.max(0, pct));
              return (
                <div key={`${entry.name ?? 'type'}-${idx}`} className="space-y-1">
                  <Text size="xs" weight="medium" color="secondary">{entry.name ?? '—'}</Text>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${barWidth}%`, backgroundColor: entry.color ?? FALLBACK_COLOR,
                    }} />
                  </div>
                  <StatGroup period={period} preferences={preferences} periodInHeader periodContextInHeader periodHeaderId={periodHeaderId}
                    metrics={[
                      { metricId: 'currency', rawValue: entry.cost,
                        label: t('costAnalysis.chargerType.cost', 'Cost') },
                      { metricId: 'count', rawValue: entry.sessions,
                        label: t('costAnalysis.chargerType.sessions', 'sessions') },
                      { metricId: 'energy', rawValue: kwhToCanonicalWh(entry.energy), display: energyDisplay,
                        label: t('costAnalysis.chargerType.energy', 'Energy (kWh)') },
                      { metricId: 'currency', rawValue: energy > 0 && entry.cost != null ? cost / energy : null,
                        label: `${t('costAnalysis.chargerType.cost', 'Cost')} ${t('costAnalysis.stats.per', 'per')} kWh` },
                      { metricId: 'percent', rawValue: entry.cost != null && totalCost != null ? pct : null,
                        label: t('costAnalysis.forecast.share', 'Share (%)') },
                    ]} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </CostStatSection>
  );
}
