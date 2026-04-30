import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetGaugeHero, type GaugeHeroConfig, type GaugeHeroStat } from './shared';
import type { WidgetProps } from './types';

export default function DriveScoreWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: analytics, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useFleetAnalytics(7);
  const { convertEfficiency, efficiencyUnit } = useSettings();

  // Derive a score from efficiency (lower Wh/mi = better score)
  const efficiency = analytics?.avg_efficiency_wh_km ?? 0;
  const score = efficiency > 0 ? Math.min(100, Math.round((250 / efficiency) * 100)) : 0;
  const isCompact = size.cols === 1 && size.rows === 1;

  const gauge = useMemo<GaugeHeroConfig>(() => ({
    value: score,
    max: 100,
    label: t('widget.score', 'Score'),
    unit: '',
    color: score > 75 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444',
  }), [score, t]);

  const stats = useMemo<GaugeHeroStat[]>(() => [
    { label: t('widget.efficiency', 'Efficiency'), value: fmtNumber(convertEfficiency(efficiency), 0), unit: efficiencyUnit },
  ], [t, efficiency, convertEfficiency, efficiencyUnit]);

  return (
    <WidgetShell
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {analytics ? (
        <WidgetGaugeHero gauge={gauge} stats={stats} compact={isCompact} />
      ) : (
        <EmptyState
          icon={<TrendingUp className="h-5 w-5" />}
          message={t('widget.noScore', 'No data yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
