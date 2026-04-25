import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import {
  ChartTooltip, chartGrid, axisTickSm,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
  renderAnnotationLines, AddAnnotationPopover, AnnotationList,
  CHART_COLORS, AREA_DEFAULTS, areaGradient,
} from '@/components/charts';
import { useAnnotations } from '@/hooks/useAnnotations';
import { cn } from '@/lib/cn';
import type { AnnotationCategory } from '@/types/annotations';
import type { MonthlyBucket } from './types';

interface MonthlyCostChartProps {
  data: MonthlyBucket[];
  vehicleId: number | null;
}

export function MonthlyCostChart({ data, vehicleId }: MonthlyCostChartProps) {
  const { t } = useTranslation();
  const { annotations, addAnnotation, removeAnnotation } = useAnnotations('charging-cost', vehicleId);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [pendingTimestamp, setPendingTimestamp] = useState<string | null>(null);

  const handleChartClick = useCallback(
    (state: { activeLabel?: string }) => {
      if (isAnnotating && state?.activeLabel) {
        setPendingTimestamp(String(state.activeLabel));
      }
    },
    [isAnnotating],
  );

  const handleAddAnnotation = useCallback(
    (label: string, category: AnnotationCategory, description?: string) => {
      if (pendingTimestamp) {
        addAnnotation(pendingTimestamp, label, category, description);
        setPendingTimestamp(null);
        setIsAnnotating(false);
      }
    },
    [pendingTimestamp, addAnnotation],
  );

  return (
    <>
      <GlassPanel className={cn('p-4', isAnnotating && 'ring-1 ring-blue-400/30')}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <TrendingUp className="h-4 w-4 text-cyan-400" />
            {t('costAnalysis.charts.monthlyCost', 'Monthly Cost Trend')}
          </h3>
          <button
            type="button"
            onClick={() => setIsAnnotating((v) => !v)}
            className={cn(
              'rounded p-1 text-xs transition-colors',
              isAnnotating ? 'text-blue-400' : 'text-white/30 hover:text-white/50',
            )}
            aria-label={t('annotation.toggle', 'Toggle annotations')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
          </button>
        </div>
        {data.length > 0 ? (
          <div className={isAnnotating ? 'cursor-crosshair' : undefined}>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data} onClick={handleChartClick}>
                {areaGradient('costGrad', CHART_COLORS[0])}
                <CartesianGrid {...chartGrid} />
                <XAxis
                  dataKey="month"
                  {...axisTickSm}
                  tickFormatter={(v: string) => {
                    const parts = v.split('-');
                    return parts.length === 2 ? `${parts[1]}/${parts[0].slice(2)}` : v;
                  }}
                />
                <YAxis
                  {...axisTickSm}
                  tickFormatter={(v: number) => `$${v}`}
                />
                <Tooltip content={<ChartTooltip />} />
                {renderAnnotationLines(annotations, (ts) => ts)}
                <Area
                  {...AREA_DEFAULTS}
                  dataKey="cost"
                  name={t('costAnalysis.charts.cost', 'Cost ($)')}
                  stroke={CHART_COLORS[0]}
                  fill="url(#costGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-[260px] items-center justify-center text-sm text-gray-500">
            {t('costAnalysis.charts.noData', 'Not enough data')}
          </div>
        )}
        <AnnotationList annotations={annotations} onRemove={removeAnnotation} />
      </GlassPanel>
      <AddAnnotationPopover
        open={pendingTimestamp != null}
        timestamp={pendingTimestamp ?? ''}
        onAdd={handleAddAnnotation}
        onCancel={() => setPendingTimestamp(null)}
      />
    </>
  );
}
