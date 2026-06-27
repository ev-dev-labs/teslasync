// Native parity port of
// web/src/features/dashboard/widgets/SubscriptionsWidget.tsx.
//
// The web widget is a dashboard "Subscriptions" tile. It resolves the active
// vehicle (vehicleId prop, else the first vehicle, else 0 -> stringId undefined
// when not > 0), fetches the subscription envelope via
// useVehicleSubscriptions(stringId) (VehicleInfoEnvelope<Record<string,unknown>>),
// and parses it through the pure parseSubscriptions() helper into ParsedSub[]:
//   - for each of the six SUBSCRIPTION_TYPES (premium_connectivity,
//     full_self_driving, enhanced_autopilot, standard_connectivity,
//     data_sharing, satellite_connectivity) it reads data[key]; skips null /
//     false / '' values; derives expiryDate from `${key}_expiry_date` ??
//     `${key}_expiry` (via asString), daysLeft from daysUntil(expiryDate), and
//     active = expiryDate ? (days != null && days > 0) : Boolean(val); plus a
//     renewalType from `${key}_renewal` ?? `${key}_renewal_type`.
//   - it then folds in any generic data.subscriptions[] array (name ?? type ??
//     'Unknown', expiry_date ?? expiry ?? end_date, status-or-expiry-based
//     active, renewal_type ?? renewal), de-duped against the known types by
//     case-insensitive name.
// It derives activeCount (parsed.filter active), nextExpiry (the soonest active
// subscription with daysLeft > 0), and entries: DetailEntry[] (label = name,
// value = formatDate(expiryDate) ?? em-dash OR renewalType ?? em-dash, badge =
// Active/Expired success|error). It renders one of two layouts inside a
// <WidgetShell>:
//   1. Compact (size.cols <= 1): a title-less shell whose body centers a sky
//      CreditCard glyph, the big activeCount, an "active" eyebrow and (when a
//      nextExpiry exists) a neutral Badge of formatDate(nextExpiry.expiryDate);
//      a CreditCard EmptyState ("No subscriptions") when parsed is empty.
//   2. Standard: a titled shell ("Subscriptions" + sky CreditCard) wrapping a
//      <WidgetDetailCard> of every entry (Active/Expired badges) with a
//      CreditCard EmptyState fallback.
// Combined query freshness (loading / fetching / stale / error / dataUpdatedAt)
// and a manual refresh feed the shell header.
//
// This native port preserves that contract 1:1 — the same numericId/stringId
// derivation, the same useVehicleSubscriptions(stringId) query, the same
// asString / daysUntil / SUBSCRIPTION_TYPES / ParsedSub / parseSubscriptions
// logic byte-for-byte (incl. the known-type loop, the generic subscriptions[]
// fallback and the case-insensitive de-dup), the same activeCount / nextExpiry /
// entries derivations, the same isCompact branch, the same i18n keys + English
// defaults, and the same visual intent — using React Native primitives, the
// existing native AppText + design tokens and the already-ported web-parity
// useVehicles / useVehicleSubscriptions hooks.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     (fallback ?? key), preserving every key + English default. None of this
//     widget's t() calls use interpolation.
//   - lucide-react CreditCard (web L3): DOM SVG icon -> emoji glyph stand-in
//     (credit card), tinted sky-400 (#38bdf8) in the title/compact-hero slots
//     and muted in the EmptyState slot.
//   - @/components/ui Badge (web L4): reproduced as a native-safe <Badge> with
//     the same variant palette (neutral/success/warning/danger -> the web
//     gray-700/green-900/yellow-900/red-900 dark chips) and a `centered` flag
//     mirroring the compact min-h/min-w-[44px] centered chip.
//   - @/components/feedback EmptyState (web L5): reproduced as a native-safe
//     <EmptyState> (centered glyph + muted message).
//   - @/api/hooks/useVehicles useVehicleSubscriptions / useVehicles (web L6):
//     the already-ported web-parity hooks (same /vehicles/{id}/subscriptions
//     path, queryKey ['vehicle-subscriptions', id], enabled !!id, staleTime;
//     and the data: Vehicle[] list with `.id`).
//   - @/hooks/useDateFormat useDateFormat().formatDate (web L7): not yet ported
//     -> reproduced as a scoped native useDateFormat() exposing a
//     useCallback-memoized formatDate (toLocaleDateString year/short-month/day
//     -> "Apr 4, 2026"; nullish / invalid -> em-dash), matching the web
//     formatDate contract.
//   - ./WidgetShell (web L8): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the pulse-on-update effect, and the inline
//     DataFreshness chip (dot-only `compact` when title-less).
//   - ./shared WidgetDetailCard + DetailEntry (web L9): reproduced as a
//     native-safe <WidgetDetailCard> (the same DetailEntry shape, the empty ->
//     EmptyState branch, the compact slice(0,4), the label / value / mono /
//     badge row with a bottom divider between rows).
//   - ./types WidgetProps (web L10): the dashboard widget types module is not
//     yet ported, so the consumed subset (WidgetSize { cols, rows } +
//     WidgetProps) is mirrored as local interfaces.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {
  useVehicleSubscriptions,
  useVehicles,
} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-in (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_CREDIT_CARD = '\uD83D\uDCB3'; // 💳 (CreditCard)

// text-sky-400 — the CreditCard tint in the title + compact hero slots.
const SKY = '#38bdf8';

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  scoped native useDateFormat (web @/hooks/useDateFormat .formatDate) */
/* ------------------------------------------------------------------ */

type NativeDateFormatter = (value: string | null | undefined) => string;

/** Port of web useDateFormat().formatDate — "Apr 4, 2026"; nullish/invalid → "—". */
function useDateFormat(): {formatDate: NativeDateFormatter} {
  const formatDate = useCallback<NativeDateFormatter>(value => {
    if (!value) {
      return '\u2014';
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return '\u2014';
    }
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, []);
  return useMemo(() => ({formatDate}), [formatDate]);
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse on data change (web L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={[styles.body, !title ? styles.bodyTopPad : null]}>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
}

function EmptyState({icon, message}: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Badge (web @/components/ui Badge)                            */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

// web Badge dark-mode variant palette (bg / text).
const BADGE_BG: Record<BadgeVariant, string> = {
  success: '#14532d', // green-900
  warning: '#713f12', // yellow-900
  danger: '#7f1d1d', // red-900
  neutral: '#374151', // gray-700
};

const BADGE_TEXT: Record<BadgeVariant, string> = {
  success: '#bbf7d0', // green-200
  warning: '#fef08a', // yellow-200
  danger: '#fecaca', // red-200
  neutral: '#e5e7eb', // gray-200
};

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  /** Mirrors the compact min-h/min-w-[44px] centered chip on the hero. */
  centered?: boolean;
}

function Badge({children, variant = 'neutral', centered}: BadgeProps) {
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: BADGE_BG[variant]},
        centered ? styles.badgeCentered : null,
      ]}>
      <AppText
        numberOfLines={1}
        style={[styles.badgeText, {color: BADGE_TEXT[variant]}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetDetailCard + DetailEntry (web ./shared)               */
/* ------------------------------------------------------------------ */

export interface DetailEntry {
  label: string;
  value: string | number | null;
  badge?: {
    text: string;
    variant: 'success' | 'warning' | 'error' | 'neutral';
  };
  mono?: boolean;
}

// web badgeVariantMap: success→success, warning→warning, error→danger,
// neutral→neutral.
const badgeVariantMap: Record<
  NonNullable<DetailEntry['badge']>['variant'],
  BadgeVariant
> = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
};

interface WidgetDetailCardProps {
  entries: DetailEntry[];
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

function WidgetDetailCard({
  entries,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetDetailCardProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No details available'}
      />
    );
  }

  const visible = compact ? entries.slice(0, 4) : entries;

  return (
    <View style={styles.detailList}>
      {visible.map((entry, i) => (
        <View
          key={entry.label}
          style={[
            styles.detailRow,
            i < visible.length - 1 ? styles.detailRowDivider : null,
          ]}>
          <AppText numberOfLines={1} style={styles.detailLabel}>
            {entry.label}
          </AppText>
          <View style={styles.detailValueRow}>
            <AppText
              numberOfLines={1}
              style={[styles.detailValue, entry.mono ? styles.detailMono : null]}>
              {entry.value ?? '\u2014'}
            </AppText>
            {entry.badge ? (
              <Badge variant={badgeVariantMap[entry.badge.variant]}>
                {entry.badge.text}
              </Badge>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  ported helpers (web L12-107)                                       */
/* ------------------------------------------------------------------ */

/** Safely extract a string from an unknown value (web L13-18). */
function asString(val: unknown): string | null {
  if (val == null) {
    return null;
  }
  if (typeof val === 'string' && val.length > 0) {
    return val;
  }
  if (typeof val === 'number') {
    return String(val);
  }
  return null;
}

/** Compute days until an expiry date string (web L21-27). */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) {
    return null;
  }
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) {
    return null;
  }
  const now = new Date();
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Known subscription types to extract from the data envelope (web L30-37). */
const SUBSCRIPTION_TYPES = [
  {
    key: 'premium_connectivity',
    labelKey: 'widget.subscriptions.premiumConnectivity',
    fallback: 'Premium Connectivity',
  },
  {
    key: 'full_self_driving',
    labelKey: 'widget.subscriptions.fsd',
    fallback: 'Full Self-Driving',
  },
  {
    key: 'enhanced_autopilot',
    labelKey: 'widget.subscriptions.enhancedAutopilot',
    fallback: 'Enhanced Autopilot',
  },
  {
    key: 'standard_connectivity',
    labelKey: 'widget.subscriptions.standardConnectivity',
    fallback: 'Standard Connectivity',
  },
  {
    key: 'data_sharing',
    labelKey: 'widget.subscriptions.dataSharing',
    fallback: 'Data Sharing',
  },
  {
    key: 'satellite_connectivity',
    labelKey: 'widget.subscriptions.satellite',
    fallback: 'Satellite Connectivity',
  },
] as const;

interface ParsedSub {
  name: string;
  active: boolean;
  expiryDate: string | null;
  renewalType: string | null;
  daysLeft: number | null;
}

function parseSubscriptions(
  data: Record<string, unknown> | null | undefined,
  t: (k: string, f: string) => string,
): ParsedSub[] {
  if (!data) {
    return [];
  }
  const subs: ParsedSub[] = [];

  for (const sub of SUBSCRIPTION_TYPES) {
    const val = data[sub.key];
    if (val == null || val === false || val === '') {
      continue;
    }

    const expiryDate = asString(
      (data as Record<string, unknown>)[`${sub.key}_expiry_date`] ??
        (data as Record<string, unknown>)[`${sub.key}_expiry`],
    );
    const days = daysUntil(expiryDate);
    const active = expiryDate ? days != null && days > 0 : Boolean(val);

    const renewalRaw = asString(
      (data as Record<string, unknown>)[`${sub.key}_renewal`] ??
        (data as Record<string, unknown>)[`${sub.key}_renewal_type`],
    );

    subs.push({
      name: t(sub.labelKey, sub.fallback),
      active,
      expiryDate,
      renewalType: renewalRaw,
      daysLeft: days,
    });
  }

  // Fallback: handle any generic subscriptions array in the data
  const subscriptions = data.subscriptions;
  if (Array.isArray(subscriptions)) {
    for (const item of subscriptions) {
      if (item == null || typeof item !== 'object') {
        continue;
      }
      const rec = item as Record<string, unknown>;
      const name =
        asString(rec.name) ??
        asString(rec.type) ??
        t('widget.subscriptions.unknown', 'Unknown');
      const expiryDate =
        asString(rec.expiry_date) ??
        asString(rec.expiry) ??
        asString(rec.end_date);
      const days = daysUntil(expiryDate);
      const status = asString(rec.status);
      const active = status
        ? status.toLowerCase() === 'active'
        : expiryDate
          ? days != null && days > 0
          : true;

      // Avoid duplicates from known types
      if (subs.some(s => s.name.toLowerCase() === name.toLowerCase())) {
        continue;
      }

      subs.push({
        name,
        active,
        expiryDate,
        renewalType: asString(rec.renewal_type) ?? asString(rec.renewal),
        daysLeft: days,
      });
    }
  }

  return subs;
}

/* ------------------------------------------------------------------ */
/*  SubscriptionsWidget (web L109-221)                                 */
/* ------------------------------------------------------------------ */

export default function SubscriptionsWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const numericId = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const stringId = numericId > 0 ? String(numericId) : undefined;
  const {formatDate: fmtDate} = useDateFormat();

  const {
    data: envelope,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleSubscriptions(stringId);

  const subsData = envelope?.data ?? null;
  const isCompact = size.cols <= 1;

  const parsed = useMemo(() => parseSubscriptions(subsData, t), [subsData, t]);

  const activeCount = useMemo(
    () => parsed.filter(s => s.active).length,
    [parsed],
  );

  const nextExpiry = useMemo(() => {
    const upcoming = parsed
      .filter(s => s.active && s.daysLeft != null && s.daysLeft > 0)
      .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
    return upcoming[0] ?? null;
  }, [parsed]);

  const entries: DetailEntry[] = useMemo(() => {
    return parsed.map(sub => ({
      label: sub.name,
      value: sub.expiryDate
        ? fmtDate(sub.expiryDate) ?? '\u2014'
        : sub.renewalType ?? '\u2014',
      badge: {
        text: sub.active
          ? t('widget.subscriptions.active', 'Active')
          : t('widget.subscriptions.expired', 'Expired'),
        variant: sub.active ? ('success' as const) : ('error' as const),
      },
    }));
  }, [parsed, t, fmtDate]);

  const shellProps = {
    loading: isLoading,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact layout (1×2): active count + next expiry ──
  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        <View style={styles.compactCenter}>
          {parsed.length > 0 ? (
            <>
              <AppText style={styles.compactIcon}>{ICON_CREDIT_CARD}</AppText>
              <AppText style={styles.compactValue}>{activeCount}</AppText>
              <AppText style={styles.compactLabel}>
                {t('widget.subscriptions.activeCount', 'active')}
              </AppText>
              {nextExpiry ? (
                <Badge variant="neutral" centered>
                  {fmtDate(nextExpiry.expiryDate) ?? '\u2014'}
                </Badge>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={<AppText style={styles.emptyGlyph}>{ICON_CREDIT_CARD}</AppText>}
              message={t('widget.subscriptions.noData', 'No subscriptions')}
            />
          )}
        </View>
      </WidgetShell>
    );
  }

  // ── Standard layout (2×4): full subscription list ──
  return (
    <WidgetShell
      title={t('widget.subscriptions.title', 'Subscriptions')}
      icon={<AppText style={styles.titleIcon}>{ICON_CREDIT_CARD}</AppText>}
      {...shellProps}>
      <WidgetDetailCard
        entries={entries}
        compact={isCompact}
        emptyMessage={t('widget.subscriptions.noData', 'No subscriptions')}
        emptyIcon={<AppText style={styles.emptyGlyph}>{ICON_CREDIT_CARD}</AppText>}
      />
    </WidgetShell>
  );
}

SubscriptionsWidget.displayName = 'SubscriptionsWidget';

// shadow-[0_0_12px_rgba(34,197,94,0.15)] pulse-on-update glow.
const PULSE_GLOW = '#22c55e';

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeCentered: {
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
    maxWidth: '100%',
    minHeight: 44,
    minWidth: 44,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    textAlign: 'center',
  },
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  compactCenter: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: spacing.md,
    rowGap: 6,
  },
  compactIcon: {
    color: SKY,
    fontSize: 16,
    lineHeight: 20,
  },
  compactLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  detailLabel: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 10,
    letterSpacing: 0.4,
    minWidth: 0,
    textTransform: 'uppercase',
  },
  detailList: {
    width: '100%',
  },
  detailMono: {
    fontFamily: 'monospace',
  },
  detailRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  detailRowDivider: {
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: 1,
  },
  detailValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
    minWidth: 0,
  },
  detailValueRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexShrink: 1,
    minWidth: 0,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
  titleIcon: {
    color: SKY,
    fontSize: 14,
    lineHeight: 16,
  },
});
