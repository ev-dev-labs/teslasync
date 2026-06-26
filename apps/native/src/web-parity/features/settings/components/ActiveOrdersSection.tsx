// Native parity port of
// web/src/features/settings/components/ActiveOrdersSection.tsx.
//
// `ActiveOrdersSection` is the Settings → Tesla "Active Orders" panel: a glass
// card with a header (cart IconBox + title/subtitle on the left; a last-synced
// label + a "Refresh" button on the right), followed by either a grid of order
// cards (model + status Badge, Order ID, optional VIN, optional delivery date,
// optional "Upgradable" chip) or an empty state. Every state name
// (`t`, `toast`, `formatDeliveryDate`, `ordersData`, `ordersRefresh`), the
// `useTeslaUserOrders` / `useRefreshTeslaOrders` API paths (via the reused
// hooks), the `ordersRefresh.mutate(undefined, { onSuccess, onError })` refresh
// behaviour, the two helper functions (`orderStatusVariant`,
// `formatOrderStatus`) — ported verbatim — and every `t(key, 'English')` i18n
// key + fallback are preserved.
//
// Web modules with no native-parity surface are mapped per the conversion
// contract (rules 4-7), each documented in the parity sidecar:
//   - react-i18next `useTranslation('settings')` (L1) -> a local key-preserving
//     shim returning the inline English fallback (apps/native lacks
//     react-i18next; the same approach as the motion / InboxBody ports). Every
//     i18n key is referenced verbatim.
//   - `@/components/ui` GlassPanel/Button/IconBox/Badge (L3): GlassPanel -> the
//     shared native GlassPanel; Badge -> the web-parity Badge port (variant set
//     matches 1:1); Button (variant="secondary" size="sm" + spinner icon) -> a
//     local Pressable "RefreshButton" (neutral surface; ActivityIndicator while
//     pending mirrors the web `animate-spin`); IconBox color="cyan" -> a local
//     accent-tinted rounded box (accentSoft fill + borderAccent ring) wrapping
//     the decorative cart glyph (the web cyan ring/tint is the visual intent).
//   - `@/components/feedback` EmptyState (L4) + `@/components/feedback/Toast`
//     useToast (L6): EmptyState (icon + message) -> a local info-glyph + message
//     block; useToast -> a local lightweight in-panel banner host preserving the
//     `success(title)` / `error(title, detail)` contract (the InboxBody port
//     precedent). NOTE the reused `useRefreshTeslaOrders` hook also surfaces its
//     own native Alert feedback; this component's banner mirrors the web
//     component's *own* explicit toast, exactly as the web double-fires.
//   - `@/components/motion` FadeIn (L5) -> the reused web-parity motion FadeIn
//     (delay 0.045s preserved).
//   - `@/lib/cn` (L7) -> dropped: React Native has no className, so the
//     conditional `animate-spin` class becomes the busy ActivityIndicator and
//     all static class styling moves to StyleSheet.
//   - `@/lib/dateFormat` formatDateTime (L8) -> an inlined native-safe copy
//     (nullish/invalid -> '—'; full date + time via toLocaleString), the
//     ChargingDetailPage precedent.
//   - `@/hooks/useDateFormat` (L9) -> a local `useDateFormat()` shim returning a
//     `{ formatDate }` formatter (locale-aware "Mon D, YYYY"; nullish/invalid ->
//     '—'). The user's tz/locale settings cascade is unavailable on native, so
//     the formatter uses the device locale (documented in the sidecar). The
//     `const { formatDate: formatDeliveryDate } = useDateFormat()` call site is
//     preserved verbatim.
//   - lucide-react icons ShoppingCart/RefreshCw/Info/Package/Calendar (L10) ->
//     decorative emoji glyphs via `Glyph` (accessibility-hidden); the adjacent
//     translated label / message carries the meaning (the TeslaChargingSessions
//     page precedent).
//
// Tailwind -> px (1 unit = 4px): p-6 -> 24, gap-3 -> 12, gap-4 -> 16,
// gap-1/1.5 -> 4/6, space-y-4 -> 16, space-y-3 -> 12, space-y-1.5 -> 6,
// rounded-lg -> 8, text-base -> 16, text-sm -> 14, text-xs -> 12,
// text-[11px] -> 11, h-10/w-10 rounded-xl -> 40/40 radius 12. The web
// `bg-white/[0.02]` card fill + `--border-subtle` border map to the closest
// tokens (surfaceRaised-ish literal + colors.border). No DOM-only modules,
// browser HTML elements, Recharts, Leaflet, or old web UI components are
// imported.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useRefreshTeslaOrders, useTeslaUserOrders} from '../../../api/hooks/useUser';
import {Badge, type BadgeVariant} from '../../../components/ui/Badge';
import {FadeIn} from '../../../components/motion';

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

/* ── i18n shim (web react-i18next `useTranslation`) ───────────────── */
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, preserving intent.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(_namespace?: string): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

/* ── dateFormat (inlined from @/lib/dateFormat) ───────────────────── */
// formatDateTime -> full date + time; nullish/invalid -> '—' placeholder.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ── useDateFormat shim (web @/hooks/useDateFormat) ───────────────── */
// The web hook binds locale + timezone from the user's settings. Native has no
// settings/timezone cascade yet, so `formatDate` uses the device locale and
// renders "Mon D, YYYY" (nullish/invalid -> '—'). The `{ formatDate }` shape is
// preserved so the `const { formatDate: formatDeliveryDate } = useDateFormat()`
// call site is identical to the web source.
function useDateFormat(): {formatDate: (value: string | Date | null | undefined) => string} {
  const formatDate = useCallback((value: string | Date | null | undefined): string => {
    if (!value) {
      return '—';
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return '—';
    }
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, []);
  return {formatDate};
}

/* ── status helpers (ported verbatim from the web source) ─────────── */
function orderStatusVariant(status: string | undefined | null): BadgeVariant {
  if (!status) {
    return 'neutral';
  }
  const s = status.toUpperCase();
  if (s.includes('DELIVER')) {
    return 'success';
  }
  if (s.includes('READY') || s.includes('TRANSPORT')) {
    return 'info';
  }
  if (s.includes('CANCEL') || s.includes('REJECT')) {
    return 'danger';
  }
  if (s.includes('PENDING') || s.includes('ORDER')) {
    return 'warning';
  }
  return 'neutral';
}

function formatOrderStatus(status: string | undefined | null): string {
  if (!status) {
    return '—';
  }
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/* ── Glyph (decorative lucide-icon stand-in) ──────────────────────── */
function Glyph({children, style}: {children: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText accessibilityElementsHidden importantForAccessibility="no" style={style}>
      {children}
    </AppText>
  );
}

/* ── useToast (web @/components/feedback/Toast useToast) ───────────── */
// Lightweight in-panel banner host preserving the `success(title)` /
// `error(title, detail)` contract; auto-dismisses after a few seconds.
interface ActiveToast {
  id: number;
  type: 'success' | 'error';
  title: string;
  detail?: string;
}

function useToast() {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((next: ActiveToast) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setActive(next);
    timer.current = setTimeout(() => setActive(null), next.type === 'error' ? 6000 : 5000);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const success = useCallback(
    (title: string, detail?: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'success', title, detail});
    },
    [show],
  );

  const error = useCallback(
    (title: string, detail?: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'error', title, detail});
    },
    [show],
  );

  const node = active ? (
    <View style={styles.toastWrap}>
      <GlassPanel style={[styles.toast, active.type === 'error' ? styles.toastError : styles.toastSuccess]}>
        <AppText style={styles.toastTitle} weight="semibold">
          {active.title}
        </AppText>
        {active.detail ? (
          <AppText style={styles.toastDetail} tone="secondary" variant="caption">
            {active.detail}
          </AppText>
        ) : null}
      </GlassPanel>
    </View>
  ) : null;

  return {success, error, node};
}

export function ActiveOrdersSection() {
  const {t} = useTranslation('settings');
  const toast = useToast();
  const {formatDate: formatDeliveryDate} = useDateFormat();
  const {data: ordersData} = useTeslaUserOrders();
  const ordersRefresh = useRefreshTeslaOrders();

  const orders = ordersData?.orders ?? [];

  return (
    <>
      <FadeIn delay={0.045}>
        <GlassPanel style={styles.panel}>
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <View style={styles.iconBox}>
                <Glyph style={styles.iconBoxGlyph}>🛒</Glyph>
              </View>
              <View style={styles.headerTitleBlock}>
                <AppText style={styles.title} weight="semibold">
                  {t('orders.title', 'Active Orders')}
                </AppText>
                <AppText style={styles.subtitle} tone="muted">
                  {t('orders.subtitle', 'Vehicle orders and delivery tracking from Tesla')}
                </AppText>
              </View>
            </View>
            <View style={styles.headerRight}>
              {ordersData?.fetched_at ? (
                <AppText style={styles.syncedLabel} tone="muted">
                  {t('orders.lastSynced', 'Synced')} {formatDateTime(ordersData.fetched_at)}
                </AppText>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('orders.refresh', 'Refresh')}
                accessibilityState={{disabled: ordersRefresh.isPending}}
                disabled={ordersRefresh.isPending}
                onPress={() =>
                  ordersRefresh.mutate(undefined, {
                    onSuccess: () => toast.success(t('toast.ordersRefreshed', 'Orders refreshed')),
                    onError: (err: Error) =>
                      toast.error(t('toast.ordersFailed', 'Failed to refresh orders'), err.message),
                  })
                }
                style={({pressed}) => [
                  styles.refreshBtn,
                  ordersRefresh.isPending && styles.refreshBtnDisabled,
                  pressed && !ordersRefresh.isPending && styles.refreshBtnPressed,
                ]}>
                {ordersRefresh.isPending ? (
                  <ActivityIndicator color={colors.textPrimary} size="small" />
                ) : (
                  <Glyph style={styles.refreshGlyph}>🔄</Glyph>
                )}
                <AppText style={styles.refreshLabel} weight="semibold">
                  {t('orders.refresh', 'Refresh')}
                </AppText>
              </Pressable>
            </View>
          </View>

          {orders.length > 0 ? (
            <View style={styles.ordersGrid}>
              {orders.map(order => (
                <View key={order.order_id} style={styles.orderCard}>
                  <View style={styles.orderHeaderRow}>
                    <View style={styles.orderModelRow}>
                      <Glyph style={styles.orderModelGlyph}>📦</Glyph>
                      <AppText style={styles.orderModel} weight="semibold">
                        {order.model || '—'}
                      </AppText>
                    </View>
                    <Badge variant={orderStatusVariant(order.status)}>{formatOrderStatus(order.status)}</Badge>
                  </View>
                  <View style={styles.orderDetails}>
                    <View style={styles.detailRow}>
                      <AppText style={styles.detailLabel} tone="muted">
                        {t('orders.orderId', 'Order ID')}
                      </AppText>
                      <AppText style={styles.detailValueMono}>{order.order_id}</AppText>
                    </View>
                    {order.vin ? (
                      <View style={styles.detailRow}>
                        <AppText style={styles.detailLabel} tone="muted">
                          {t('orders.vin', 'VIN')}
                        </AppText>
                        <AppText style={styles.detailValueMono}>{order.vin}</AppText>
                      </View>
                    ) : null}
                    {order.delivery_date ? (
                      <View style={styles.detailRow}>
                        <AppText style={styles.detailLabel} tone="muted">
                          {t('orders.deliveryDate', 'Delivery Date')}
                        </AppText>
                        <View style={styles.detailDateValue}>
                          <Glyph style={styles.detailDateGlyph}>🗓</Glyph>
                          <AppText style={styles.detailValue}>{formatDeliveryDate(order.delivery_date)}</AppText>
                        </View>
                      </View>
                    ) : null}
                    {order.is_upgradable ? (
                      <View style={styles.upgradableRow}>
                        <Badge size="sm" variant="info">
                          {t('orders.upgradable', 'Upgradable')}
                        </Badge>
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Glyph style={styles.emptyGlyph}>ℹ️</Glyph>
              <AppText style={styles.emptyMessage} tone="muted">
                {ordersData?.fetched_at
                  ? t('orders.noOrders', 'No active orders found.')
                  : t('orders.noData', 'No order data yet. Click Refresh to fetch from Tesla.')}
              </AppText>
            </View>
          )}
        </GlassPanel>
      </FadeIn>
      {toast.node}
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 24, // p-6
    gap: 16, // space-y-4
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12, // gap-3
    flexShrink: 1,
  },
  iconBox: {
    width: 40, // h-10 w-10
    height: 40,
    borderRadius: 12, // rounded-xl
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft, // IconBox color="cyan" bg
    borderWidth: 1,
    borderColor: colors.borderAccent, // ring-1
  },
  iconBoxGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  headerTitleBlock: {
    flexShrink: 1,
  },
  title: {
    fontSize: 16, // text-base
    lineHeight: 22,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  syncedLabel: {
    fontSize: 11, // text-[11px]
    lineHeight: 14,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised, // Button variant="secondary"
  },
  refreshBtnDisabled: {
    opacity: 0.5, // disabled:opacity-50
  },
  refreshBtnPressed: {
    opacity: 0.82,
  },
  refreshGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  refreshLabel: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  ordersGrid: {
    gap: 16, // grid gap-4 (mobile-first single column)
  },
  orderCard: {
    borderRadius: 8, // rounded-lg
    backgroundColor: 'rgba(255, 255, 255, 0.02)', // bg-white/[0.02]
    borderWidth: 1,
    borderColor: colors.border, // --border-subtle
    padding: 16, // p-4
    gap: 12, // space-y-3
  },
  orderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  orderModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8, // gap-2
    flexShrink: 1,
  },
  orderModelGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  orderModel: {
    fontSize: 14, // text-sm
    lineHeight: 20,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  orderDetails: {
    gap: 6, // space-y-1.5
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  detailLabel: {
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  detailValue: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  detailValueMono: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
    fontFamily: MONO_FONT, // font-mono
    flexShrink: 1,
    textAlign: 'right',
  },
  detailDateValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4, // gap-1
  },
  detailDateGlyph: {
    fontSize: 11,
    lineHeight: 14,
  },
  upgradableRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  emptyState: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 24,
  },
  emptyGlyph: {
    fontSize: 32, // h-10 w-10 icon
    lineHeight: 38,
  },
  emptyMessage: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  toastWrap: {
    marginTop: 12,
  },
  toast: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 4,
  },
  toastSuccess: {
    borderColor: colors.successBorder,
  },
  toastError: {
    borderColor: colors.dangerBorder,
  },
  toastTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  toastDetail: {
    fontSize: 12,
    lineHeight: 16,
  },
});

export default ActiveOrdersSection;
