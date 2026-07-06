/**
 * Tesla Orders — delivery outlook.
 *
 * Compact context panel beside the status breakdown. Surfaces the soonest
 * upcoming delivery, how many orders are upgradable, the distinct model count,
 * VIN-assignment progress, and when the orders were last synced from Tesla.
 */
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { KVList, TimeStamp } from '@/components/data-display';
import { useDateFormat } from '@/hooks/useDateFormat';

import { OrdersSectionState } from './OrdersSectionState';
import type { OrderSectionStatus, OrderStats } from './teslaOrderStats';

interface DeliveryOutlookPanelProps {
  stats: OrderStats;
  status: OrderSectionStatus;
  error: unknown;
  onRetry: () => void;
  /** Server-side timestamp of the last Tesla sync (`envelope.fetched_at`). */
  fetchedAt: string | null;
  emptyIcon?: ReactNode;
}

export function DeliveryOutlookPanel({
  stats,
  status,
  error,
  onRetry,
  fetchedAt,
  emptyIcon,
}: DeliveryOutlookPanelProps) {
  const { t } = useTranslation();
  const { formatDateWithDay } = useDateFormat();

  const items = useMemo(
    () => [
      {
        label: t('admin.teslaOrders.outlook.upgradable', 'Upgradable orders'),
        value: (
          <Text as="span" weight="semibold" color="primary" className="tabular-nums">
            {stats.upgradable ?? 0}
          </Text>
        ),
      },
      {
        label: t('admin.teslaOrders.outlook.models', 'Distinct models'),
        value: (
          <Text as="span" weight="semibold" color="primary" className="tabular-nums">
            {stats.models ?? 0}
          </Text>
        ),
      },
      {
        label: t('admin.teslaOrders.outlook.vin', 'VIN assigned'),
        value: (
          <Text as="span" weight="semibold" color="primary" className="tabular-nums">
            {stats.withVin ?? 0} / {stats.total ?? 0}
          </Text>
        ),
      },
      {
        label: t('admin.teslaOrders.outlook.lastSynced', 'Last synced'),
        value: fetchedAt ? (
          <TimeStamp value={fetchedAt} format="relative" />
        ) : (
          <Text as="span" color="muted">
            —
          </Text>
        ),
      },
    ],
    [t, stats, fetchedAt],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.teslaOrders.panels.outlook', 'Delivery Outlook')}
      </PanelTitle>

      <OrdersSectionState
        status={status}
        error={error}
        onRetry={onRetry}
        skeletonHeight={180}
        emptyIcon={emptyIcon}
        emptyMessage={t(
          'admin.teslaOrders.outlook.empty',
          'Sync your Tesla account to see delivery details.',
        )}
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-3">
            <Caption>
              {t('admin.teslaOrders.outlook.nextDelivery', 'Next delivery')}
            </Caption>
            <Text
              as="div"
              size="lg"
              weight="bold"
              color="primary"
              className="mt-1"
            >
              {stats.nextDelivery
                ? formatDateWithDay(stats.nextDelivery)
                : t('admin.teslaOrders.outlook.noUpcoming', 'None scheduled')}
            </Text>
          </div>

          <KVList items={items} />
        </div>
      </OrdersSectionState>
    </GlassPanel>
  );
}
