import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Caption } from '@/components/ui';
import { MetricBar, KVList } from '@/components/data-display';
import { DataStateNotice, EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens } from '@/lib/tokens';
import type { VehicleCostBar } from '../vehicle-cost/helpers';

export function VehicleCostTalkers({ talkers, totalRows, loading, error, onRetry }: {
  talkers: VehicleCostBar[]; totalRows: number | null | undefined;
  loading: boolean; error: unknown; onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const items = talkers ?? [];
  // Preserve the original known-total scale, including its measured-zero fallback.
  const max = totalRows != null
    ? totalRows > 0 ? totalRows : items.reduce((largest, item) => Math.max(largest, item.rows ?? 0), 0) || 1
    : null;
  return (
    <LayoutCard title={t('admin.vehicleCost.topTalkersTitle', 'Top talkers')}
      actions={<Flame className="h-4 w-4 text-amber-300" aria-hidden />}>
      <Caption>{t('admin.vehicleCost.topTalkersSubtitle', 'Share of total rows ingested')}</Caption>
      {error ? <QueryError error={error} onRetry={onRetry} /> : loading && items.length === 0 ? (
        <div className="space-y-3" role="status" aria-busy="true" aria-label={t('common.loading', 'Loading')}>
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} height={40} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Flame className="h-8 w-8" aria-hidden />}
          message={t('admin.vehicleCost.topTalkersEmpty', 'No vehicles have ingested signals yet.')}
          action={{ label: t('common.retry', 'Retry'), onClick: onRetry }} />
      ) : max == null ? (
        <>
          <DataStateNotice state="partial" />
          <KVList layout="responsive" items={items.map(item => ({
            id: String(item.vehicle_id), label: item.name ?? '—', value: `${fmtInt(item.rows)} · —`,
          }))} />
        </>
      ) : (
        <ul className="space-y-3" aria-label={t('admin.vehicleCost.topTalkersListLabel', 'Top talkers ranked by ingested rows')}>
          {items.map((item, index) => {
            const value = item.rows ?? 0;
            const percent = Math.min(max > 0 ? value / max * 100 : 0, 100);
            return (
              <li key={item.vehicle_id}>
                <MetricBar label={item.name ?? '—'} value={value} max={max}
                  color={chartTokens.series[index % chartTokens.series.length]}
                  sublabel={`${fmtInt(value)} · ${fmtPercent(percent)}`} />
              </li>
            );
          })}
        </ul>
      )}
    </LayoutCard>
  );
}
