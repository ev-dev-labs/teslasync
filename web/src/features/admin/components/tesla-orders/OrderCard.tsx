/**
 * Tesla Orders — single order card.
 *
 * Rich per-order tile for the visual "orders board". Shows the model, a
 * lifecycle status badge, the order id, an assigned VIN and delivery date when
 * present, and an "upgradable" affordance. Every field is null-safe (missing
 * values degrade to a placeholder rather than a blank cell) and every label is
 * i18n-driven.
 *
 * The card exposes itself as a labelled `role="group"` so assistive tech reads
 * a concise "{model} order, {status}" name while navigating the board's grid of
 * tiles; the decorative lucide glyphs are all `aria-hidden`. It is `memo`-ised
 * because the board renders one instance per order — the parent page refetches
 * and re-renders on a slow interval, and each `order` reference is stable across
 * renders, so the default shallow prop compare lets unchanged tiles skip work.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Calendar, Fingerprint, Sparkles } from 'lucide-react';

import { GlassPanel, Badge, Text, Caption } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';

import type { TeslaOrder } from '@/api/hooks/useUser';
import { orderStatusVariant, formatOrderStatus } from './teslaOrderStats';

interface OrderCardProps {
  order: TeslaOrder;
}

function OrderCardImpl({ order }: OrderCardProps) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();

  const model = order.model || '—';
  const statusLabel = formatOrderStatus(order.status);
  const orderId = order.order_id || '—';

  return (
    <GlassPanel
      role="group"
      aria-label={t('admin.teslaOrders.card.aria', '{{model}} order, {{status}}', {
        model,
        status: statusLabel,
      })}
      className="flex h-full flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Package
            className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <Text as="span" weight="semibold" color="primary" className="truncate">
            {model}
          </Text>
        </div>
        <Badge variant={orderStatusVariant(order.status)} size="sm">
          {statusLabel}
        </Badge>
      </div>

      <dl className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Text as="dt" variant="caption">{t('admin.teslaOrders.card.orderId', 'Order ID')}</Text>
          <Text
            as="dd"
            size="xs"
            mono
            color="primary"
            className="truncate"
            title={order.order_id || undefined}
          >
            {orderId}
          </Text>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Text as="dt" variant="caption" className="flex items-center gap-1">
            <Fingerprint className="h-3 w-3" aria-hidden="true" />
            {t('admin.teslaOrders.card.vin', 'VIN')}
          </Text>
          {order.vin ? (
            <Text as="dd" size="xs" mono color="primary" className="truncate" title={order.vin}>
              {order.vin}
            </Text>
          ) : (
            <Text as="dd" size="xs" color="muted">
              {t('admin.teslaOrders.card.vinPending', 'Not assigned')}
            </Text>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Text as="dt" variant="caption" className="flex items-center gap-1">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {t('admin.teslaOrders.card.delivery', 'Delivery')}
          </Text>
          <Text as="dd" size="xs" color="primary" className="tabular-nums">
            {order.delivery_date ? formatDate(order.delivery_date) : '—'}
          </Text>
        </div>
      </dl>

      {order.is_upgradable && (
        <div className="mt-auto flex items-center gap-1.5 rounded-md border border-purple-500/20 bg-purple-500/[0.08] px-2 py-1">
          <Sparkles className="h-3.5 w-3.5 text-purple-300" aria-hidden="true" />
          <Caption className="text-purple-300">
            {t('admin.teslaOrders.card.upgradable', 'Upgrade available')}
          </Caption>
        </div>
      )}
    </GlassPanel>
  );
}

export const OrderCard = memo(OrderCardImpl);
