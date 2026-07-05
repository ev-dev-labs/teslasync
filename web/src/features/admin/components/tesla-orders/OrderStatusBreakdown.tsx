/**
 * Tesla Orders — status breakdown.
 *
 * Visualises how the account's orders split across their lifecycle buckets
 * (in-progress / ready / delivered / cancelled / other). A proportion bar
 * gives an at-a-glance ratio; the stat cards below give exact counts with the
 * canonical `<Badge>` variant so the colour language matches the board + table.
 */
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';

import { OrdersSectionState } from './OrdersSectionState';
import {
  ORDER_BUCKET_ORDER,
  ORDER_BUCKET_META,
  type OrderSectionStatus,
  type OrderStats,
} from './teslaOrderStats';

interface OrderStatusBreakdownProps {
  stats: OrderStats;
  status: OrderSectionStatus;
  error: unknown;
  onRetry: () => void;
  emptyIcon?: ReactNode;
}

export function OrderStatusBreakdown({
  stats,
  status,
  error,
  onRetry,
  emptyIcon,
}: OrderStatusBreakdownProps) {
  const { t } = useTranslation();
  const total = stats.total ?? 0;

  return (
    <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <PieChart className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.teslaOrders.panels.breakdown', 'Order Status')}
      </PanelTitle>

      <OrdersSectionState
        status={status}
        error={error}
        onRetry={onRetry}
        skeletonHeight={180}
        emptyIcon={emptyIcon}
        emptyMessage={t(
          'admin.teslaOrders.breakdown.empty',
          'No orders to classify yet.',
        )}
      >
        <div className="space-y-4">
          <div
            className="flex h-3 overflow-hidden rounded-full bg-white/[0.05]"
            role="img"
            aria-label={t(
              'admin.teslaOrders.breakdown.barAria',
              'Order status distribution',
            )}
          >
            {(stats.buckets ?? []).map(({ bucket, count }) => {
              const meta = ORDER_BUCKET_META[bucket];
              const pct = total > 0 ? (count / total) * 100 : 0;
              if (!meta || pct <= 0) return null;
              return (
                <div
                  key={bucket}
                  className={cn('h-full', meta.bar)}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {ORDER_BUCKET_ORDER.map((bucket) => {
              const count = stats.byBucket?.[bucket] ?? 0;
              const pct = total > 0 ? Math.round((count / total) * 100) : 0;
              const meta = ORDER_BUCKET_META[bucket];
              return (
                <div
                  key={bucket}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn('h-2.5 w-2.5 rounded-full', meta.dot)}
                      aria-hidden="true"
                    />
                    <Caption className="tabular-nums">{pct}%</Caption>
                  </div>
                  <Text
                    as="div"
                    size="xl"
                    weight="bold"
                    color="primary"
                    className="mt-2 tabular-nums"
                  >
                    {count}
                  </Text>
                  <div className="mt-1">
                    <Badge variant={meta.badge} size="sm">
                      {t(meta.key, meta.fallback)}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </OrdersSectionState>
    </GlassPanel>
  );
}
