import { useTranslation } from 'react-i18next';
import { TrendingUp } from 'lucide-react';
import { RadialGauge } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function DriveScoreWidget(_props: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: analytics, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useFleetAnalytics(7);
  const { convertEfficiency, efficiencyUnit } = useSettings();

  // Derive a score from efficiency (lower Wh/mi = better score)
  const efficiency = analytics?.avg_efficiency_wh_km ?? 0;
  const score = efficiency > 0 ? Math.min(100, Math.round((250 / efficiency) * 100)) : 0;

  return (
    <WidgetShell
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="h-full flex flex-col items-center justify-center">
        {analytics ? (
          <>
            <RadialGauge
              value={score}
              max={100}
              label={t('widget.score', 'Score')}
              color={score > 75 ? '#10b981' : score > 50 ? '#f59e0b' : '#ef4444'}
              size={80}
            />
            <p className="text-[10px] text-white/40 mt-2">
              {fmtNumber(convertEfficiency(efficiency), 0)} {efficiencyUnit}
            </p>
          </>
        ) : (
          <EmptyState
            icon={<TrendingUp className="h-5 w-5" />}
            message={t('widget.noScore', 'No data yet')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
