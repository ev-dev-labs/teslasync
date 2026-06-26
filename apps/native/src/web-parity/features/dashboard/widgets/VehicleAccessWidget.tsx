// Native parity port of
// web/src/features/dashboard/widgets/VehicleAccessWidget.tsx.
//
// The web module is the dashboard "Vehicle Access" widget. It reads three
// per-vehicle access sources for the selected (or first) vehicle — the
// authorized drivers (GET /api/v1/vehicles/{id}/drivers), the pending
// invitations (GET /api/v1/vehicles/{id}/invitations) and the mobile-access
// flag (GET /api/v1/vehicles/{id}/mobile-enabled) — and renders one of two
// layouts driven by the grid `size.cols`:
//   • Compact (cols <= 1): a single row with a Users glyph + "{n} Drivers" and a
//     status dot (emerald when mobile access is enabled, red when disabled, a
//     muted surface when unknown), the dot carrying the same enabled/disabled/
//     unknown tooltip text as the web `title`.
//   • Standard/Wide (cols >= 2): a "Mobile Access" status row (uppercase label +
//     an Enabled/Disabled/Unknown Badge), an "Authorized Drivers" detail list,
//     and — only when there is at least one — a "Pending Invitations" detail
//     list below a hairline divider.
// Driver rows show the driver name (falling back to email, then "—"), the
// short fetched-at date and an Owner/Driver badge; invitation rows show the
// creator (or "—"), the short created-at date and a Pending/Accepted/Expired
// badge. When all three sources are empty (no drivers, no invitations and an
// unknown mobile flag) the body is a single EmptyState. The title is always
// shown by the shell.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • lucide-react Users -> the app SemanticIcon `users` glyph rendered as a
//     colour-tinted AppText (GlyphIcon). The web lucide icon carries no colour
//     of its own — it inherits the surrounding text colour — so the header glyph
//     is tinted with the accent (web text-cyan-400 -> the theme accent cyan),
//     the compact-row glyph with the secondary token (web text-[var(
//     --text-secondary)]) and the empty-slot glyphs with the muted token (the
//     web EmptyState icon slot is muted).
//   • @/components/ui Badge -> a local native pill (success/warning/danger/
//     neutral) backed by the theme surface/foreground tokens, mirroring the
//     sibling WidgetRankedList port. The web ./shared WidgetDetailCard
//     badgeVariantMap (error -> danger) is preserved; the StandardView mobile
//     badge's success/danger/neutral variants pass through unchanged.
//   • @/components/feedback EmptyState -> the already-ported native parity
//     EmptyState (icon + message + native `style` in place of `className`).
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly
//     the props this call site uses (title/icon/loading/updatedAt/isFetching/
//     isStale/isError/onRefresh/children): a Skeleton while loading, a header row
//     (icon + uppercase title + freshness/refresh chip) and the body.
//   • ./shared WidgetDetailCard + DetailEntry -> a local native WidgetDetailCard
//     (EmptyState when empty, otherwise label/value/badge rows with hairline
//     dividers) + the ported DetailEntry type. The web overflow-y-auto scroll
//     maps to a native ScrollView for the flexible drivers list (web flex-1);
//     the fixed invitations list (web flex-shrink-0) renders as a static View
//     column to avoid an unbounded-height ScrollView. The compact slice (4) and
//     the `mono` value style are ported for type/behaviour parity even though
//     this widget never sets them.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • @/lib/dateFormat formatDateShort -> inlined verbatim ("Apr 4" via
//     {month:'short',day:'numeric'}; "—" for missing/invalid). The web call site
//     passes no FormatOptions, so the host default locale + zone are used, byte
//     identical to the source.
//   • @/api/hooks/useVehicleAccess useVehicleDrivers/useVehicleInvitations and
//     @/api/hooks/useVehicles useVehicleMobileEnabled/useVehicles -> the already
//     ported native hooks (same names / return shapes / field names).
//   • DOM <div>/<span> + Tailwind classes -> React Native View/AppText with
//     StyleSheet tokens. The DataFreshness header indicator is computed once at
//     render (no interval) to avoid a dangling timer under --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {
  useVehicleDrivers,
  useVehicleInvitations,
} from '../../../api/hooks/useVehicleAccess';
import {
  useVehicleMobileEnabled,
  useVehicles,
} from '../../../api/hooks/useVehicles';

// web-only hairline (border-white/[0.06]) — kept literal so the divider tone
// matches the source rather than the heavier theme `border` token.
const HAIRLINE = 'rgba(255, 255, 255, 0.06)';

/* ─── ./types (dashboard widget registry types, ported verbatim) ─────────── */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ─── ./shared DetailEntry (ported verbatim) ─────────────────────────────── */

export interface DetailEntry {
  label: string;
  value: string | number | null;
  badge?: {text: string; variant: 'success' | 'warning' | 'error' | 'neutral'};
  mono?: boolean;
}

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/dateFormat formatDateShort ───────────────────────────── */

// web formatDateShort: short date "Apr 4" ({month:'short',day:'numeric'}); "—"
// for missing/invalid. The web call site passes no FormatOptions, so the host
// default locale + timezone are used (byte identical to the source).
function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/* ─── tinted glyph icon (web lucide-react Users) ─────────────────────────── */

function GlyphIcon({
  name,
  color,
  size,
}: {
  name: SemanticIconName;
  color: string;
  size: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

/* ─── @/components/ui Badge (pill, size="sm") ────────────────────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, fg: colors.textMuted},
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
};

function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

// web ./shared WidgetDetailCard badgeVariantMap (error -> danger).
const badgeVariantMap: Record<
  'success' | 'warning' | 'error' | 'neutral',
  BadgeVariant
> = {
  error: 'danger',
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
};

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// Computed once at render (no interval) to avoid a dangling timer under
// --detectOpenHandles.
function relativeTime(updatedAt: number): string {
  if (!updatedAt || updatedAt <= 0) {
    return 'never';
  }
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  let label: string;
  let dotColor: string;
  if (isError) {
    label = 'Error';
    dotColor = colors.danger;
  } else if (isFetching) {
    label = 'Updating…';
    dotColor = colors.accent;
  } else if (isStale) {
    label = 'Stale';
    dotColor = colors.warning;
  } else {
    label = relativeTime(updatedAt);
    dotColor = colors.success;
  }

  return (
    <Pressable
      accessibilityLabel={`Data ${label}. Refresh.`}
      accessibilityRole="button"
      disabled={!onRefresh}
      onPress={onRefresh}
      style={styles.freshness}
      testID="widget-freshness">
      <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
      {compact ? null : (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/* ─── WidgetShell (web ./WidgetShell, subset used by this widget) ─────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  if (loading) {
    return <Skeleton height={120} rounded style={styles.shellSkeleton} />;
  }

  if (error) {
    return (
      <View style={styles.shellError} testID="widget-error">
        <AppText style={styles.shellErrorText} tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
      updatedAt={updatedAt ?? 0}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellTitleRow}>
            {icon}
            <AppText
              numberOfLines={1}
              style={styles.shellTitle}
              tone="muted"
              variant="caption">
              {title.toUpperCase()}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : (
        freshnessEl && (
          <View pointerEvents="box-none" style={styles.shellFreshnessOverlay}>
            {freshnessEl}
          </View>
        )
      )}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── WidgetDetailCard (web ./shared) ────────────────────────────────────── */

function WidgetDetailCard({
  entries,
  compact = false,
  emptyMessage,
  emptyIcon,
  scroll = false,
  fill = false,
  testID,
}: {
  entries: DetailEntry[];
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  /** Native: render rows inside a ScrollView (web overflow-y-auto). */
  scroll?: boolean;
  /** Native: flex:1 within the section (web flex-1 drivers area). */
  fill?: boolean;
  /** Native-only testing hook; absent from the web source. */
  testID?: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No details available'}
        style={styles.detailEmpty}
        testID={testID}
      />
    );
  }

  const visible = compact ? entries.slice(0, 4) : entries;

  const rows = visible.map((entry, i) => (
    <View
      key={entry.label}
      style={[
        styles.detailRow,
        i < visible.length - 1 ? styles.detailRowDivider : null,
      ]}
      testID="widget-detail-row">
      <AppText numberOfLines={1} style={styles.detailLabel} tone="muted">
        {entry.label}
      </AppText>
      <View style={styles.detailValueWrap}>
        <AppText
          numberOfLines={1}
          style={[styles.detailValue, entry.mono ? styles.detailValueMono : null]}>
          {entry.value ?? '—'}
        </AppText>
        {entry.badge ? (
          <Badge variant={badgeVariantMap[entry.badge.variant]}>
            {entry.badge.text}
          </Badge>
        ) : null}
      </View>
    </View>
  ));

  if (scroll) {
    return (
      <ScrollView
        contentContainerStyle={styles.detailList}
        style={fill ? styles.detailFill : undefined}
        testID={testID}>
        {rows}
      </ScrollView>
    );
  }

  return (
    <View style={styles.detailList} testID={testID}>
      {rows}
    </View>
  );
}

/* ─── Compact layout (1×2) ───────────────────────────────────────────────── */

function CompactView({
  driverCount,
  mobileEnabled,
  t,
}: {
  driverCount: number;
  mobileEnabled: boolean | null;
  t: TFunc;
}) {
  const dotColor =
    mobileEnabled === true
      ? colors.success
      : mobileEnabled === false
        ? colors.danger
        : colors.surfaceRaised;
  const dotLabel =
    mobileEnabled === true
      ? t('widget.vehicleAccessMobileOn', 'Mobile access enabled')
      : mobileEnabled === false
        ? t('widget.vehicleAccessMobileOff', 'Mobile access disabled')
        : t('widget.vehicleAccessMobileUnknown', 'Mobile access unknown');

  return (
    <View style={styles.compactRow}>
      <View style={styles.compactLeft}>
        <GlyphIcon color={colors.textSecondary} name="users" size={14} />
        <AppText numberOfLines={1} style={styles.compactText}>
          {driverCount} {t('widget.vehicleAccessDrivers', 'Drivers')}
        </AppText>
      </View>
      <View
        accessibilityLabel={dotLabel}
        accessible
        style={[styles.statusDot, {backgroundColor: dotColor}]}
        testID="vehicle-access-mobile-dot"
      />
    </View>
  );
}

/* ─── Standard / Wide layout ─────────────────────────────────────────────── */

function StandardView({
  mobileEnabled,
  driverEntries,
  invitationEntries,
  isCompact,
  t,
}: {
  mobileEnabled: boolean | null;
  driverEntries: DetailEntry[];
  invitationEntries: DetailEntry[];
  isCompact: boolean;
  t: TFunc;
}) {
  const mobileVariant: BadgeVariant =
    mobileEnabled === true
      ? 'success'
      : mobileEnabled === false
        ? 'danger'
        : 'neutral';
  const mobileText =
    mobileEnabled === true
      ? t('widget.vehicleAccessEnabled', 'Enabled')
      : mobileEnabled === false
        ? t('widget.vehicleAccessDisabled', 'Disabled')
        : t('widget.vehicleAccessUnknown', 'Unknown');

  return (
    <View style={styles.standardRoot}>
      {/* Mobile access status */}
      <View style={styles.mobileRow}>
        <AppText style={styles.mobileLabel} tone="muted" variant="caption">
          {t('widget.vehicleAccessMobile', 'Mobile Access')}
        </AppText>
        <Badge variant={mobileVariant}>{mobileText}</Badge>
      </View>

      {/* Drivers section */}
      <View style={styles.driversSection}>
        <AppText style={styles.sectionLabel} tone="muted" variant="caption">
          {t('widget.vehicleAccessAuthorized', 'Authorized Drivers')}
        </AppText>
        <WidgetDetailCard
          compact={isCompact}
          emptyIcon={<GlyphIcon color={colors.textMuted} name="users" size={18} />}
          emptyMessage={t('widget.vehicleAccessNoDrivers', 'No authorized drivers')}
          entries={driverEntries}
          fill
          scroll
          testID="vehicle-access-drivers"
        />
      </View>

      {/* Invitations section */}
      {invitationEntries.length > 0 ? (
        <View style={styles.invitationsSection}>
          <AppText style={styles.sectionLabel} tone="muted" variant="caption">
            {t('widget.vehicleAccessPending', 'Pending Invitations')}
          </AppText>
          <WidgetDetailCard
            compact={isCompact}
            emptyMessage={t(
              'widget.vehicleAccessNoInvitations',
              'No pending invitations',
            )}
            entries={invitationEntries}
            testID="vehicle-access-invitations"
          />
        </View>
      ) : null}
    </View>
  );
}

/* ─── Main widget ────────────────────────────────────────────────────────── */

export default function VehicleAccessWidget({vehicleId, size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const {
    data: drivers,
    isLoading: driversLoading,
    isFetching: driversFetching,
    isStale: driversStale,
    isError: driversError,
    dataUpdatedAt: driversUpdatedAt,
    refetch: refetchDrivers,
  } = useVehicleDrivers(vidStr);

  const {
    data: invitations,
    isLoading: invitationsLoading,
    isFetching: invitationsFetching,
    isStale: invitationsStale,
    isError: invitationsError,
    dataUpdatedAt: invitationsUpdatedAt,
    refetch: refetchInvitations,
  } = useVehicleInvitations(vidStr);

  const {
    data: mobileData,
    isLoading: mobileLoading,
    isFetching: mobileFetching,
    isStale: mobileStale,
    isError: mobileError,
    dataUpdatedAt: mobileUpdatedAt,
    refetch: refetchMobile,
  } = useVehicleMobileEnabled(vidStr);

  const isCompact = size.cols <= 1;

  const safeDrivers = useMemo(() => drivers ?? [], [drivers]);
  const safeInvitations = useMemo(() => invitations ?? [], [invitations]);
  const mobileEnabled = mobileData?.data?.enabled ?? null;

  const driverEntries = useMemo<DetailEntry[]>(
    () =>
      safeDrivers.map(d => ({
        label: d.driver_name ?? d.driver_email ?? '—',
        value: formatDateShort(d.fetched_at),
        badge: {
          text:
            d.role === 'owner'
              ? t('widget.vehicleAccessOwner', 'Owner')
              : t('widget.vehicleAccessDriver', 'Driver'),
          variant: (d.role === 'owner' ? 'success' : 'neutral') as
            | 'success'
            | 'neutral',
        },
      })),
    [safeDrivers, t],
  );

  const invitationEntries = useMemo<DetailEntry[]>(
    () =>
      safeInvitations.map(inv => ({
        label: inv.created_by ?? '—',
        value: formatDateShort(inv.created_at),
        badge: {
          text:
            inv.status === 'pending'
              ? t('widget.vehicleAccessPendingStatus', 'Pending')
              : inv.status === 'accepted'
                ? t('widget.vehicleAccessAccepted', 'Accepted')
                : t('widget.vehicleAccessExpired', 'Expired'),
          variant: (inv.status === 'pending'
            ? 'warning'
            : inv.status === 'accepted'
              ? 'success'
              : 'error') as 'warning' | 'success' | 'error',
        },
      })),
    [safeInvitations, t],
  );

  const isLoading = driversLoading || invitationsLoading || mobileLoading;
  const isFetching = driversFetching || invitationsFetching || mobileFetching;
  const isStale = driversStale || invitationsStale || mobileStale;
  const isError = driversError || invitationsError || mobileError;
  const updatedAt = Math.max(
    driversUpdatedAt ?? 0,
    invitationsUpdatedAt ?? 0,
    mobileUpdatedAt ?? 0,
  );

  const hasData =
    safeDrivers.length > 0 ||
    safeInvitations.length > 0 ||
    mobileEnabled !== null;

  return (
    <WidgetShell
      icon={<GlyphIcon color={colors.accent} name="users" size={13} />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => {
        refetchDrivers();
        refetchInvitations();
        refetchMobile();
      }}
      title={t('widget.vehicleAccess', 'Vehicle Access')}
      updatedAt={updatedAt}>
      {hasData ? (
        isCompact ? (
          <CompactView
            driverCount={safeDrivers.length}
            mobileEnabled={mobileEnabled}
            t={t}
          />
        ) : (
          <StandardView
            driverEntries={driverEntries}
            invitationEntries={invitationEntries}
            isCompact={isCompact}
            mobileEnabled={mobileEnabled}
            t={t}
          />
        )
      ) : (
        <EmptyState
          icon={<GlyphIcon color={colors.textMuted} name="users" size={18} />}
          message={t('widget.vehicleAccessNoData', 'No access data available')}
          style={styles.bodyEmpty}
          testID="vehicle-access-empty"
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // WidgetShell
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellSkeleton: {
    height: '100%',
    minHeight: 120,
  },
  shellError: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellErrorText: {
    textAlign: 'center',
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // DataFreshness
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  freshnessLabel: {
    fontSize: 10,
  },
  // Badge (web Badge size="sm")
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  // CompactView (web flex items-center justify-between gap-2 min-h-[44px])
  compactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 44,
  },
  compactLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  compactText: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  // web h-2.5 w-2.5 rounded-full status dot.
  statusDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  // StandardView (web flex flex-col gap-3 h-full)
  standardRoot: {
    flex: 1,
    gap: spacing.md,
  },
  // web flex items-center justify-between gap-2 min-h-[44px]
  mobileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 44,
  },
  // web text-xs text-[var(--text-muted)] uppercase tracking-wide
  mobileLabel: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // web flex-1 min-h-0 overflow-y-auto
  driversSection: {
    flex: 1,
    minHeight: 0,
  },
  // web flex-shrink-0 border-t border-white/[0.06] pt-2
  invitationsSection: {
    borderTopColor: HAIRLINE,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  // web text-[10px] uppercase text-[var(--text-muted)] tracking-wide mb-1
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  // WidgetDetailCard
  detailFill: {
    flex: 1,
  },
  detailList: {
    flexGrow: 0,
  },
  // web EmptyState className="py-4" override (py-16 default).
  detailEmpty: {
    paddingVertical: spacing.md,
  },
  // web flex items-center justify-between gap-3 py-2 px-1
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  // web border-b border-white/[0.06]
  detailRowDivider: {
    borderBottomColor: HAIRLINE,
    borderBottomWidth: 1,
  },
  // web min-w-0 truncate text-[10px] uppercase text-[var(--text-muted)]
  detailLabel: {
    flexShrink: 1,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  // web flex min-w-0 items-center gap-2
  detailValueWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  // web truncate text-sm text-[var(--text-primary)]
  detailValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  // web font-mono
  detailValueMono: {
    fontFamily: 'monospace',
  },
  // no-data EmptyState (web className="py-4").
  bodyEmpty: {
    paddingVertical: spacing.md,
  },
});
