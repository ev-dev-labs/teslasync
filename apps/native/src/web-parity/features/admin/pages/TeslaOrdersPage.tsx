// Native parity port of web/src/features/admin/pages/TeslaOrdersPage.tsx.
//
// The web source (32 lines) is a thin page wrapper: it reads the i18n `t` for
// the 'settings' namespace, derives `title = t('orders.title', 'Active Orders')`,
// sets `document.title` via `usePageTitle(title)`, and renders a
// `<PageContainer title subtitle>` whose only child is the shared
// `<ActiveOrdersSection />` (features/settings/components/ActiveOrdersSection) —
// the Tesla "Active Orders" surface (vehicle orders + delivery tracking pulled
// from the linked Tesla account).
//
// `<ActiveOrdersSection />` has no native port yet, and it is a web UI component
// (it imports lucide-react, @/components/ui, framer-motion, @/lib/cn, the Toast
// queue, useDateFormat). Per the conversion contract those cannot be imported
// into native output. Mirroring the sibling admin parity ports (ApiLogsPage /
// FeedbackQueuePage / RbacMatrixPage are all self-contained single files that
// inline their sub-pieces on React Native primitives), this port inlines the
// ActiveOrdersSection UI here, rebuilt with RN primitives + the existing native
// tokens/components, and reuses the already-ported data hooks:
//   * `<PageContainer title subtitle>` -> an inline `PageContainerView` (a
//     `ScrollView` with a title/subtitle header, then the page body stack) —
//     same shape as the sibling ports.
//   * `usePageTitle` -> a no-op `useNativePageTitle` (there is no `document` on
//     native; the page header still renders the title).
//   * react-i18next `useTranslation('settings')` -> a self-contained
//     `useNativeTranslationFallback` returning each English fallback and
//     reproducing i18next `{{var}}` interpolation. Every key + fallback the web
//     used is preserved verbatim (orders.title, orders.subtitle, orders.refresh,
//     orders.lastSynced, orders.orderId, orders.vin, orders.deliveryDate,
//     orders.upgradable, orders.noOrders, orders.noData).
//   * `<FadeIn>` (framer-motion) -> a passthrough `View`; the web entrance
//     animation carries no behavioural contract.
//   * `<GlassPanel className="p-6 space-y-4">` -> the shared native `GlassPanel`
//     with the matching padding/gap (the section card).
//   * `<IconBox color="cyan"><ShoppingCart/>` -> `<SemanticIcon name="shoppingCart">`
//     (the nearest repo glyph). The boxed shoppingCart icon carries a warning
//     (amber) tone rather than the web IconBox cyan; the shopping-cart semantics
//     are preserved — documented native-safe tone adaptation, consistent with the
//     RbacMatrix lucide->SemanticIcon mapping.
//   * `<Button variant="secondary" size="sm" icon={<RefreshCw/>}>` -> an inline
//     `RefreshButton` (Pressable) whose leading slot is an `ActivityIndicator`
//     while the refresh mutation is pending (the web `animate-spin`) and a
//     `refresh` `SemanticIcon` otherwise.
//   * `<Badge variant>` (info/success/warning/danger/neutral) -> an inline
//     `Badge` pill using the matching token surfaces — the same approach as the
//     sibling ports. The status->variant + status->label mapping functions
//     (`orderStatusVariant` / `formatOrderStatus`) are ported verbatim.
//   * `<EmptyState icon={<Info/>} message>` -> an inline `EmptyOrders` (a centred
//     `info` `SemanticIcon` above the muted message). The web EmptyState renders
//     an icon + message and no title, so the shared native EmptyState (which
//     mandates a title) is not used; the icon + message are preserved.
//   * The lucide `Package` (per-order) -> `package` SemanticIcon; the tiny
//     12px lucide `Calendar` in the delivery-date value is rendered text-only
//     (the boxed SemanticIcon does not suit a caption-sized inline mark — the
//     same precedent the RbacMatrix port set for its 12px ShieldCheck).
//   * `useToast` + the `mutate(undefined, { onSuccess, onError })` toast wiring
//     -> the native `useRefreshTeslaOrders` hook already bakes the success
//     ('Orders refreshed') / error ('Failed to refresh orders') Alert feedback
//     in via `useMutationToast`, so the section just calls `ordersRefresh.mutate()`;
//     the web `toast.ordersRefreshed` / `toast.ordersFailed` English intent is
//     preserved by the hook's baked-in strings (documented mapping).
//   * `@/lib/dateFormat` `formatDateTime` (the "Synced …" stamp) -> the shared
//     native `lib/format.formatDateTime`. `useDateFormat().formatDate` (the
//     delivery date) -> a local `formatDeliveryDate` (date-only `Intl`); there is
//     no native user date-format settings provider yet (documented).
//   * `@/lib/cn` (the conditional spin class) -> dropped; the spin state is
//     expressed by swapping the leading icon for an `ActivityIndicator`.
//   * The web responsive `grid grid-cols-1 sm:grid-cols-2` order grid -> a
//     `flexWrap` row that is single-column on phones and two-up at width >= 640
//     (the `sm` breakpoint), preserving the layout intent.
//
// `useTeslaUserOrders` / `useRefreshTeslaOrders` and the `TeslaOrder` type are
// reused from the existing native api/hooks/useUser port (the same
// `/tesla/user/orders` GET + `/tesla/user/orders/refresh` POST and identical
// snake_case shape the web imported from @/api/hooks/useUser). The native
// request() port keeps snake_case keys, so every `ordersData.fetched_at` /
// `order.order_id` / `order.model` / `order.status` / `order.vin` /
// `order.delivery_date` / `order.is_upgradable` access reads identically to the
// web source.
//
// No DOM, no lucide-react, no Recharts/Leaflet, no react-router, no
// framer-motion, and no web UI components are imported.

import { useCallback, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';

import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { formatDateTime } from '../../../../lib/format';
import {
  useRefreshTeslaOrders,
  useTeslaUserOrders,
  type TeslaOrder,
} from '../../../api/hooks/useUser';

/* ------------------------------------------------------------------ */
/*  i18n + native-safe helpers                                         */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

// The web page read `t` from react-i18next ('settings' namespace). Native parity
// has no i18n runtime wired yet, so this returns the English fallback string and
// reproduces i18next's `{{name}}` interpolation, preserving every key + fallback.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  }, []);
}

// Native no-op for the web `usePageTitle` (which set `document.title`). There is
// no document on native; the page header still renders the title.
function useNativePageTitle(_title: string): void {
  // Intentionally empty — see note above.
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// The Tailwind `sm:` breakpoint (640px) that flips the order grid to two-up.
const SM_BREAKPOINT = 640;

/* ------------------------------------------------------------------ */
/*  Status helpers (ported verbatim from the web source)               */
/* ------------------------------------------------------------------ */

type OrderStatusVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

function orderStatusVariant(
  status: string | undefined | null,
): OrderStatusVariant {
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

// Native parity for the web `useDateFormat().formatDate` (date-only). There is
// no native user date-format settings provider yet, so this renders a sensible
// locale-default `Intl` date (year / short month / day).
function formatDeliveryDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/* ------------------------------------------------------------------ */
/*  Inline native chrome                                               */
/* ------------------------------------------------------------------ */

// FadeIn: web framer-motion entrance wrapper. The animation carries no
// behavioural contract, so this preserves the wrapper structurally.
function FadeIn({ children }: { children: ReactNode }) {
  return <View>{children}</View>;
}

// Native parity for the web <PageContainer title subtitle>: a scrollable page
// with a title (+ optional subtitle) header, then the body stack.
function PageContainerView({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.pageRoot}
    >
      <View style={styles.pageHeader}>
        <AppText variant="display" weight="bold">
          {title}
        </AppText>
        {subtitle ? <AppText tone="secondary">{subtitle}</AppText> : null}
      </View>
      <View style={styles.pageBody}>{children}</View>
    </ScrollView>
  );
}

// Native parity for the shared web Badge (info/success/warning/danger/neutral).
function Badge({
  variant = 'neutral',
  size = 'md',
  children,
}: {
  variant?: OrderStatusVariant;
  size?: 'sm' | 'md';
  children: ReactNode;
}) {
  return (
    <View
      style={[
        styles.badge,
        size === 'sm' && styles.badgeSm,
        badgeToneStyles[variant],
      ]}
    >
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold"
      >
        {children}
      </AppText>
    </View>
  );
}

// Native parity for the web <Button variant="secondary" size="sm" icon={<RefreshCw/>}>.
// The leading slot is an ActivityIndicator while the mutation is pending (the web
// `animate-spin`) and a refresh SemanticIcon otherwise.
function RefreshButton({
  label,
  pending,
  onPress,
}: {
  label: string;
  pending: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: pending }}
      disabled={pending}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        styles.btnSecondary,
        pending && styles.btnDisabled,
        pressed && !pending && styles.btnPressed,
      ]}
    >
      {pending ? (
        <ActivityIndicator color={colors.textPrimary} size="small" />
      ) : (
        <SemanticIcon decorative name="refresh" size="sm" />
      )}
      <AppText style={styles.btnGhostText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// Native parity for the web <EmptyState icon={<Info/>} message>: a centred info
// icon above the muted message (no title, mirroring the web EmptyState usage).
function EmptyOrders({ message }: { message: string }) {
  return (
    <View style={styles.emptyWrap}>
      <SemanticIcon decorative name="info" size="lg" />
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// One label/value row inside an order card (web `flex justify-between text-xs`).
function OrderRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <View style={styles.kvRow}>
      <AppText tone="muted" variant="caption">
        {label}
      </AppText>
      <AppText
        style={mono ? styles.monoValue : styles.kvValue}
        variant="caption"
      >
        {value}
      </AppText>
    </View>
  );
}

// Native parity for one order card (web `rounded-lg bg-white/[0.02] border p-4`).
function OrderCard({
  order,
  t,
  twoUp,
}: {
  order: TeslaOrder;
  t: NativeTFunction;
  twoUp: boolean;
}) {
  return (
    <View
      style={[styles.orderCard, twoUp ? styles.cardTwoUp : styles.cardOneUp]}
    >
      <View style={styles.orderHeader}>
        <View style={styles.orderHeaderLeft}>
          <SemanticIcon decorative name="package" size="sm" />
          <AppText weight="semibold">{order.model || '—'}</AppText>
        </View>
        <Badge variant={orderStatusVariant(order.status)}>
          {formatOrderStatus(order.status)}
        </Badge>
      </View>

      <View style={styles.orderBody}>
        <OrderRow
          label={t('orders.orderId', 'Order ID')}
          mono
          value={order.order_id}
        />
        {order.vin ? (
          <OrderRow label={t('orders.vin', 'VIN')} mono value={order.vin} />
        ) : null}
        {order.delivery_date ? (
          <OrderRow
            label={t('orders.deliveryDate', 'Delivery Date')}
            value={formatDeliveryDate(order.delivery_date)}
          />
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
  );
}

/* ------------------------------------------------------------------ */
/*  ActiveOrdersSection (inlined web shared section)                   */
/* ------------------------------------------------------------------ */

function ActiveOrdersSection() {
  const t = useNativeTranslationFallback();
  const { width } = useWindowDimensions();
  const twoUp = width >= SM_BREAKPOINT;
  const { data: ordersData } = useTeslaUserOrders();
  const ordersRefresh = useRefreshTeslaOrders();

  const orders = ordersData?.orders ?? [];
  const syncedAt = ordersData?.fetched_at;

  return (
    <FadeIn>
      <GlassPanel style={styles.sectionPanel}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderLeft}>
            <SemanticIcon decorative name="shoppingCart" size="md" />
            <View style={styles.sectionTitleWrap}>
              <AppText variant="body" weight="semibold">
                {t('orders.title', 'Active Orders')}
              </AppText>
              <AppText tone="muted" variant="caption">
                {t(
                  'orders.subtitle',
                  'Vehicle orders and delivery tracking from Tesla',
                )}
              </AppText>
            </View>
          </View>
          <View style={styles.sectionHeaderRight}>
            {syncedAt ? (
              <AppText tone="muted" variant="caption">
                {`${t('orders.lastSynced', 'Synced')} ${formatDateTime(
                  syncedAt,
                )}`}
              </AppText>
            ) : null}
            <RefreshButton
              label={t('orders.refresh', 'Refresh')}
              onPress={() => ordersRefresh.mutate()}
              pending={ordersRefresh.isPending}
            />
          </View>
        </View>

        {orders.length > 0 ? (
          <View style={styles.ordersGrid}>
            {orders.map(order => (
              <OrderCard
                key={order.order_id}
                order={order}
                t={t}
                twoUp={twoUp}
              />
            ))}
          </View>
        ) : (
          <EmptyOrders
            message={
              syncedAt
                ? t('orders.noOrders', 'No active orders found.')
                : t(
                    'orders.noData',
                    'No order data yet. Click Refresh to fetch from Tesla.',
                  )
            }
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function TeslaOrdersPage() {
  const t = useNativeTranslationFallback();
  const title = t('orders.title', 'Active Orders');
  useNativePageTitle(title);

  return (
    <PageContainerView
      subtitle={t(
        'orders.subtitle',
        'Vehicle orders and delivery tracking from Tesla',
      )}
      title={title}
    >
      <ActiveOrdersSection />
    </PageContainerView>
  );
}

TeslaOrdersPage.displayName = 'TeslaOrdersPage';

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  // Page container
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageBody: {
    gap: spacing.lg,
  },

  // Section panel (web GlassPanel p-6 space-y-4)
  sectionPanel: {
    gap: spacing.md,
    padding: 24,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  sectionHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.md,
  },
  sectionTitleWrap: {
    flexShrink: 1,
    gap: 2,
  },
  sectionHeaderRight: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },

  // Order grid + cards
  ordersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  cardOneUp: {
    width: '100%',
  },
  cardTwoUp: {
    width: '48%',
  },
  orderCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.md,
    padding: 16,
  },
  orderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  orderHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  orderBody: {
    gap: 6,
  },
  kvRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  kvValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  monoValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontFamily: MONO_FONT,
    textAlign: 'right',
  },
  upgradableRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // Badge
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeSm: {
    paddingHorizontal: spacing.xs,
  },

  // Refresh button
  btn: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  btnSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
  btnDisabled: {
    opacity: 0.48,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnGhostText: {
    color: colors.textPrimary,
  },
});

const badgeToneStyles = StyleSheet.create({
  info: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create({
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
