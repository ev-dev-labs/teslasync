// Native parity port of
// web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx.
//
// A dashboard widget that surfaces a vehicle's available software/hardware
// upgrades alongside its active drive share links. It resolves the vehicle id
// (explicit `vehicleId` prop, else the first fleet vehicle, else 0), reads the
// upgrades envelope for that vehicle, finds the most-recent drive to look up
// its share links, then renders one of two layouts:
//
//   - Compact (size.cols <= 1): a centred column with an up-arrow glyph over
//     either the eligible-upgrade count + an "available" caption, or — when
//     there are no upgrades — a green "Up to date" badge sized as a 44pt tap
//     target.
//   - Standard / Wide (size.cols >= 3 unlocks the per-row eligibility caption):
//     an "Available Upgrades" section (each upgrade row shows the name, an
//     optional "$price" neutral badge, an optional description, a wide-only
//     eligibility caption, and a success/neutral Eligible badge; or a centred
//     "All upgrades applied" line when empty) above a divider and a
//     "Share Links" section (active-link count + nearest-expiry warning badge,
//     or an EmptyState when there are none).
//
// Following the established conversion idiom for this directory
// (TripSummaryWidget / RecentDrivesListWidget / SafetyHistoryWidget), every
// web-only dependency is reproduced native-safe with React Native primitives +
// the shared native building blocks and documented here + in the sidecar:
//
//   - ./WidgetShell (web L10) -> the real native WidgetShell parity port
//     (./WidgetShell), imported unchanged. Web imports this exact module, and
//     the native port is a faithful, tested full port that already renders the
//     loading skeleton, the icon + uppercase muted title header, and the
//     query-freshness chip (including the title-less compact overlay this
//     widget's compact branch relies on). Only the props this widget passes
//     are used (title, icon, loading, updatedAt, isFetching, isStale, isError,
//     onRefresh, children); the `shellProps` object + the compact branch's
//     redundant prop overrides are preserved verbatim.
//   - @/api/hooks/useVehicles useVehicleUpgrades/useVehicles (web L6) -> the
//     native useVehicles hooks (../../../api/hooks/useVehicles), imported
//     unchanged. Same `['vehicle-upgrades', vehicleId]` query hitting
//     `/vehicles/{id}/upgrades` and the `/vehicles` list; the destructured
//     state names (envelope, upgradesLoading, upgradesFetching, upgradesStale,
//     upgradesError, upgradesUpdatedAt, refetchUpgrades) are preserved.
//   - @/api/hooks/useSharing useShareLinks (web L7) -> native useShareLinks
//     (../../../api/hooks/useSharing); same `['shares', driveId]` query hitting
//     `/drives/{driveId}/shares`, returning `ShareToken[]` whose `expires_at`
//     drives the active-link + nearest-expiry logic.
//   - @/api/hooks/useDriving useDrives (web L8) -> native useDrives
//     (../../../api/hooks/useDriving); same `/drives?vehicle_id={id}` query.
//     Only `drives[0].id` (the most-recent drive) is read, exactly as web.
//   - @/hooks/useDateFormat useDateFormat (web L9) -> the native useDateFormat
//     hook (../../../hooks/useDateFormat); `formatDate` is destructured as
//     `fmtDate` and binds the user's locale + timezone exactly as web.
//   - @/components/feedback EmptyState (web L5) -> shared native EmptyState
//     (web `message` -> native EmptyState `title`, empty `message`). The web
//     `icon` (Link2) + `className` ("py-2") have no native EmptyState slot and
//     are dropped; the "Share Links" heading glyph preserves the link signal.
//   - @/components/ui Badge (web L4) -> inline `Badge`: a rounded-full pill
//     honouring the web `success` (green), `neutral` (gray), and `warning`
//     (amber) variants used here; the web `size="sm"` maps to the badge's fixed
//     compact padding, and an optional `style` carries the compact branch's
//     44pt tap-target override.
//   - lucide-react ArrowUpCircle/Link2 (web L3) have no native icon font; they
//     become small tintable glyphs: ArrowUpCircle -> "\u2B06" tinted emerald
//     (the widget identity, used as the shell icon and the compact glyph);
//     Link2 -> "\u29C9" (two joined squares) muted in the "Share Links"
//     heading. The web "\u2705" check mark in the "All upgrades applied" row is
//     kept verbatim.
//   - react-i18next useTranslation('dashboard') (web L1-2, L68) -> a native
//     English-default `t` that keeps every widget.upgrades.* key + {{var}}
//     interpolation intact (the freshness.*/a11y.* keys live in WidgetShell).
//   - ./types WidgetProps (web L11) -> a local WidgetSize/WidgetProps subset
//     (vehicleId + size are read; size.cols drives the compact/wide layout).
//
// The pure helpers (asString, parseUpgrades, daysUntil) and the ParsedUpgrade
// interface are ported verbatim, and every state/derived name (numericId,
// stringId, recentDriveId, upgradesData, isCompact, isWide, upgrades,
// shareLinks, eligibleCount, activeShareLinks, nearestExpiry, shellProps) is
// preserved. No DOM, react-router, framer-motion, lucide-react, Recharts,
// Leaflet, or old web UI components are imported into the native output.

import React, {useMemo} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {useShareLinks} from '../../../api/hooks/useSharing';
import {useDrives} from '../../../api/hooks/useDriving';
import {useVehicleUpgrades, useVehicles} from '../../../api/hooks/useVehicles';
import {useDateFormat} from '../../../hooks/useDateFormat';
import {WidgetShell} from './WidgetShell';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this returns that default while
// keeping every widget.upgrades.* key verbatim and applying the same {{var}}
// interpolation as the web `t` (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Glyph substitutes for lucide-react icons ────────────────────────────── */

// lucide ArrowUpCircle -> "\u2B06" (upwards arrow) tinted emerald, the widget
// identity glyph. lucide Link2 -> "\u29C9" (two joined squares) for the
// "Share Links" heading. The web "\u2705" check mark is kept verbatim.
const ARROW_UP_GLYPH = '\u2B06';
const LINK_GLYPH = '\u29C9';
const CHECK_GLYPH = '\u2705';

/* ─── Widget contract types (web ./types.ts subset) ───────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── Badge (web @/components/ui Badge — success / neutral / warning, sm) ──── */

type BadgeVariant = 'success' | 'neutral' | 'warning';

// web Badge is a rounded-full pill; the variants below mirror the green /
// gray / amber colours this widget uses, on the dark glass surface. The web
// `size="sm"` maps to the fixed compact padding here.
function Badge({
  variant = 'neutral',
  children,
  style,
}: {
  variant?: BadgeVariant;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, badgeSurface[variant], style]}>
      <AppText numberOfLines={1} style={[styles.badgeText, badgeText[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── Pure helpers (ported verbatim from the web source) ──────────────────── */

/** Safely extract a string from an unknown value */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number') return String(val);
  return null;
}

interface ParsedUpgrade {
  name: string;
  price: string | null;
  description: string | null;
  eligible: boolean;
}

function parseUpgrades(
  data: Record<string, unknown> | null | undefined,
): ParsedUpgrade[] {
  if (!data) return [];

  // Handle an "upgrades" array in the envelope
  const upgrades = data.upgrades;
  if (Array.isArray(upgrades)) {
    return upgrades
      .filter((u): u is Record<string, unknown> => u != null && typeof u === 'object')
      .map(u => ({
        name: asString(u.name) ?? asString(u.title) ?? 'Unknown Upgrade',
        price: asString(u.price) ?? asString(u.cost),
        description: asString(u.description) ?? asString(u.summary),
        eligible: u.eligible !== false,
      }));
  }

  // Fallback: treat top-level keys as individual upgrades
  const result: ParsedUpgrade[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val == null || typeof val !== 'object') continue;
    const rec = val as Record<string, unknown>;
    result.push({
      name: asString(rec.name) ?? key,
      price: asString(rec.price) ?? asString(rec.cost),
      description: asString(rec.description) ?? asString(rec.summary),
      eligible: rec.eligible !== false,
    });
  }
  return result;
}

/** Compute days until an expiry date */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/* ─── VehicleUpgradesWidget ───────────────────────────────────────────────── */

export default function VehicleUpgradesWidget({vehicleId, size}: WidgetProps) {
  const {formatDate: fmtDate} = useDateFormat();
  const {data: vehicles} = useVehicles();
  const numericId = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const stringId = numericId > 0 ? String(numericId) : undefined;

  const {
    data: envelope,
    isLoading: upgradesLoading,
    isFetching: upgradesFetching,
    isStale: upgradesStale,
    isError: upgradesError,
    dataUpdatedAt: upgradesUpdatedAt,
    refetch: refetchUpgrades,
  } = useVehicleUpgrades(stringId);

  // Get the most recent drive to show share links
  const {data: drivesData} = useDrives(stringId);
  const recentDriveId = useMemo(() => {
    const drives = drivesData ?? [];
    return drives.length > 0 ? String(drives[0].id) : '';
  }, [drivesData]);

  const {data: shareLinksData} = useShareLinks(recentDriveId);

  const upgradesData = envelope?.data ?? null;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const upgrades = useMemo(() => parseUpgrades(upgradesData), [upgradesData]);
  // Memoized (vs the web's plain `shareLinksData ?? []`) so the new-array
  // reference doesn't churn the activeShareLinks useMemo deps every render —
  // matching the sibling idiom (TripSummaryWidget's `trips` memo). Value is
  // identical to the web source.
  const shareLinks = useMemo(() => shareLinksData ?? [], [shareLinksData]);

  const eligibleCount = useMemo(
    () => upgrades.filter(u => u.eligible).length,
    [upgrades],
  );

  const activeShareLinks = useMemo(
    () =>
      shareLinks.filter(l => {
        if (!l.expires_at) return true;
        const days = daysUntil(l.expires_at);
        return days == null || days > 0;
      }),
    [shareLinks],
  );

  const nearestExpiry = useMemo(() => {
    const withExpiry = activeShareLinks
      .filter(l => l.expires_at)
      .sort(
        (a, b) =>
          (daysUntil(a.expires_at) ?? Infinity) -
          (daysUntil(b.expires_at) ?? Infinity),
      );
    return withExpiry[0] ?? null;
  }, [activeShareLinks]);

  const shellProps = {
    loading: upgradesLoading,
    updatedAt: upgradesUpdatedAt ?? 0,
    isFetching: upgradesFetching,
    isStale: upgradesStale,
    isError: upgradesError,
    onRefresh: () => refetchUpgrades(),
  };

  // ── Compact layout (1×2): upgrade count ──
  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={upgradesUpdatedAt}
        isFetching={upgradesFetching}
        isStale={upgradesStale}
        isError={upgradesError}
        onRefresh={() => refetchUpgrades()}>
        <View style={styles.compactBody} testID="vehicle-upgrades-compact">
          <AppText accessibilityElementsHidden style={styles.compactArrow}>
            {ARROW_UP_GLYPH}
          </AppText>
          {upgrades.length > 0 ? (
            <>
              <AppText weight="bold" style={styles.compactCount}>
                {String(eligibleCount)}
              </AppText>
              <AppText tone="muted" style={styles.compactLabel}>
                {t('widget.upgrades.available', 'available')}
              </AppText>
            </>
          ) : (
            <Badge variant="success" style={styles.compactBadge}>
              {t('widget.upgrades.upToDate', 'Up to date')}
            </Badge>
          )}
        </View>
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell
      title={t('widget.upgrades.title', 'Upgrades & Sharing')}
      icon={
        <AppText accessibilityElementsHidden style={styles.headerIcon}>
          {ARROW_UP_GLYPH}
        </AppText>
      }
      {...shellProps}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        testID="vehicle-upgrades-body">
        {/* Upgrades section */}
        <View>
          <AppText tone="muted" style={styles.sectionHeading}>
            {t('widget.upgrades.upgradesHeading', 'Available Upgrades')}
          </AppText>
          {upgrades.length > 0 ? (
            <View style={styles.upgradeList}>
              {upgrades.map((upgrade, index) => (
                <View
                  key={upgrade.name}
                  style={[
                    styles.upgradeRow,
                    index < upgrades.length - 1 ? styles.upgradeRowBorder : null,
                  ]}>
                  <View style={styles.upgradeMain}>
                    <View style={styles.upgradeNameRow}>
                      <AppText numberOfLines={1} style={styles.upgradeName}>
                        {upgrade.name}
                      </AppText>
                      {upgrade.price ? (
                        <Badge variant="neutral">{`$${upgrade.price}`}</Badge>
                      ) : null}
                    </View>
                    {upgrade.description ? (
                      <AppText
                        tone="secondary"
                        numberOfLines={1}
                        style={styles.upgradeDescription}>
                        {upgrade.description}
                      </AppText>
                    ) : null}
                    {isWide ? (
                      <AppText tone="muted" style={styles.upgradeEligibility}>
                        {upgrade.eligible
                          ? t('widget.upgrades.eligible', 'Eligible')
                          : t('widget.upgrades.notEligible', 'Not eligible')}
                      </AppText>
                    ) : null}
                  </View>
                  <Badge variant={upgrade.eligible ? 'success' : 'neutral'}>
                    {upgrade.eligible
                      ? t('widget.upgrades.eligible', 'Eligible')
                      : t('widget.upgrades.notEligible', 'Not eligible')}
                  </Badge>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.allApplied}>
              <AppText accessibilityElementsHidden style={styles.checkGlyph}>
                {CHECK_GLYPH}
              </AppText>
              <AppText tone="secondary" style={styles.allAppliedText}>
                {t('widget.upgrades.allApplied', 'All upgrades applied')}
              </AppText>
            </View>
          )}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Share Links section */}
        <View>
          <View style={styles.shareHeadingRow}>
            <AppText accessibilityElementsHidden style={styles.linkGlyph}>
              {LINK_GLYPH}
            </AppText>
            <AppText tone="muted" style={styles.sectionHeading}>
              {t('widget.upgrades.shareLinksHeading', 'Share Links')}
            </AppText>
          </View>
          {activeShareLinks.length > 0 ? (
            <View style={styles.shareList}>
              <View style={styles.shareRow}>
                <AppText tone="muted" style={styles.shareLabel}>
                  {t('widget.upgrades.activeLinks', 'Active links')}
                </AppText>
                <AppText weight="semibold" style={styles.shareCount}>
                  {String(activeShareLinks.length)}
                </AppText>
              </View>
              {nearestExpiry ? (
                <View style={styles.shareRow}>
                  <AppText tone="muted" style={styles.shareLabel}>
                    {t('widget.upgrades.nearestExpiry', 'Nearest expiry')}
                  </AppText>
                  <Badge variant="warning">
                    {fmtDate(nearestExpiry.expires_at) ?? '\u2014'}
                  </Badge>
                </View>
              ) : null}
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available. The web Link2
            // icon + "py-2" className have no native EmptyState slot.
            <EmptyState
              title={t('widget.upgrades.noShareLinks', 'No active share links')}
              message=""
            />
          )}
        </View>
      </ScrollView>
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  /* Compact layout */
  compactBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 6,
    minHeight: 44,
  },
  compactArrow: {
    fontSize: 16,
    lineHeight: 20,
    color: colors.success,
  },
  compactCount: {
    fontSize: 24,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  compactLabel: {
    fontSize: 10,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  compactBadge: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Standard / Wide layout */
  headerIcon: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.success,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    rowGap: spacing.md,
  },
  sectionHeading: {
    fontSize: 10,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },

  /* Upgrades list */
  upgradeList: {
    rowGap: spacing.sm,
  },
  upgradeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
  },
  upgradeRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  upgradeMain: {
    flex: 1,
    flexShrink: 1,
  },
  upgradeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  upgradeName: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  upgradeDescription: {
    fontSize: typography.caption,
    lineHeight: 16,
    marginTop: 2,
  },
  upgradeEligibility: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },

  /* All upgrades applied */
  allApplied: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.sm,
    paddingVertical: spacing.md,
  },
  checkGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  allAppliedText: {
    fontSize: 14,
    lineHeight: 18,
  },

  /* Divider */
  divider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },

  /* Share links */
  shareHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    marginBottom: spacing.sm,
  },
  linkGlyph: {
    fontSize: 11,
    lineHeight: 14,
    color: colors.textMuted,
  },
  shareList: {
    rowGap: spacing.xs,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  shareLabel: {
    fontSize: 10,
    lineHeight: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  shareCount: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },

  /* Badge */
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
});

const badgeSurface = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeText = StyleSheet.create({
  success: {
    color: colors.success,
  },
  neutral: {
    color: colors.textSecondary,
  },
  warning: {
    color: colors.warning,
  },
});
