import { useTranslation } from 'react-i18next'
import { useTeslaUserOrders, useRefreshTeslaOrders } from '@/api/hooks/useUser'
import { GlassPanel, Button, IconBox, Badge } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import { ShoppingCart, RefreshCw, Info, Package, Calendar } from 'lucide-react'

function orderStatusVariant(status: string | undefined | null): 'info' | 'success' | 'warning' | 'danger' | 'neutral' {
  if (!status) return 'neutral'
  const s = status.toUpperCase()
  if (s.includes('DELIVER')) return 'success'
  if (s.includes('READY') || s.includes('TRANSPORT')) return 'info'
  if (s.includes('CANCEL') || s.includes('REJECT')) return 'danger'
  if (s.includes('PENDING') || s.includes('ORDER')) return 'warning'
  return 'neutral'
}

function formatOrderStatus(status: string | undefined | null): string {
  if (!status) return '—'
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDeliveryDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function ActiveOrdersSection() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { data: ordersData } = useTeslaUserOrders()
  const ordersRefresh = useRefreshTeslaOrders()

  return (
    <FadeIn delay={0.045}>
      <GlassPanel className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IconBox color="cyan">
              <ShoppingCart className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('orders.title', 'Active Orders')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('orders.subtitle', 'Vehicle orders and delivery tracking from Tesla')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {ordersData?.fetched_at && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {t('orders.lastSynced', 'Synced')} {formatDateTime(ordersData.fetched_at)}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className={cn('h-3.5 w-3.5', ordersRefresh.isPending && 'animate-spin')} />}
              onClick={() => ordersRefresh.mutate(undefined, {
                onSuccess: () => toast.success(t('toast.ordersRefreshed', 'Orders refreshed')),
                onError: (err: Error) => toast.error(t('toast.ordersFailed', 'Failed to refresh orders'), err.message),
              })}
              disabled={ordersRefresh.isPending}
            >
              {t('orders.refresh', 'Refresh')}
            </Button>
          </div>
        </div>

        {(ordersData?.orders ?? []).length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(ordersData?.orders ?? []).map((order) => (
              <div key={order.order_id} className="rounded-lg bg-white/[0.02] border border-white/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-[var(--text-muted)]" />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{order.model || '—'}</span>
                  </div>
                  <Badge variant={orderStatusVariant(order.status)}>
                    {formatOrderStatus(order.status)}
                  </Badge>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">{t('orders.orderId', 'Order ID')}</span>
                    <span className="font-mono text-[var(--text-primary)]">{order.order_id}</span>
                  </div>
                  {order.vin && (
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">{t('orders.vin', 'VIN')}</span>
                      <span className="font-mono text-[var(--text-primary)]">{order.vin}</span>
                    </div>
                  )}
                  {order.delivery_date && (
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">{t('orders.deliveryDate', 'Delivery Date')}</span>
                      <span className="flex items-center gap-1 text-[var(--text-primary)]">
                        <Calendar className="h-3 w-3" />
                        {formatDeliveryDate(order.delivery_date)}
                      </span>
                    </div>
                  )}
                  {order.is_upgradable && (
                    <div className="flex justify-end">
                      <Badge variant="info" size="sm">{t('orders.upgradable', 'Upgradable')}</Badge>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Info className="h-10 w-10" />} message={
            ordersData?.fetched_at
              ? t('orders.noOrders', 'No active orders found.')
              : t('orders.noData', 'No order data yet. Click Refresh to fetch from Tesla.')
          } />
        )}
      </GlassPanel>
    </FadeIn>
  )
}
