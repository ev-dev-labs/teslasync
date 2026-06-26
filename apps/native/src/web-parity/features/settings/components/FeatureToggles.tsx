// Native parity port of
// web/src/features/settings/components/FeatureToggles.tsx.
//
// The web component renders the "Feature Flags" panel on the Settings page: a
// GlassPanel whose header carries a purple IconBox (lucide Flag) + title +
// subtitle on the left and, on the right, an optional "Synced <timestamp>"
// label plus a secondary "Refresh" Button (lucide RefreshCw that spins while
// the refresh mutation is pending). The body is either a 3-column table
// (Feature / Status / Details) derived from the Tesla feature-config envelope,
// or — when there are no entries — an EmptyState. It is reproduced here with
// React Native primitives, preserving the data derivation, state, API hooks,
// i18n keys + English copy, and visual intent:
//
//   - `@/api/hooks/useUser` useTeslaFeatureConfig / useRefreshTeslaFeatureConfig
//     -> the already-ported native hooks (same /tesla/user/feature-config[ /refresh]
//     paths, same `{ data, fetched_at }` envelope). The `featureEntries`
//     useMemo (Object.entries over the envelope `data`, deriving `enabled` +
//     a comma-joined `key: JSON.stringify(value)` `details` string, skipping
//     the `enabled` key) is carried over verbatim.
//   - `@/components/ui` GlassPanel -> the already-ported native GlassPanel.
//   - `@/components/ui` Button -> the already-ported native parity Button; the
//     web `icon` RefreshCw + `animate-spin` while pending becomes the Button's
//     `loading` prop (an ActivityIndicator that replaces the icon, mirroring
//     the web `{loading ? spinner : icon}` slot) plus a static ↻ glyph icon for
//     the idle state. `variant="secondary"` / `size="sm"` / `disabled` carry over.
//   - `@/components/ui` IconBox (colored ring container) -> an inline native
//     IconBox reproduction; web `color="purple"` maps to the app's violet theme
//     tokens (violetSurface / violetBorder / violet), the same lucide -> glyph +
//     themed-tint approach the ActiveSessionsSection port took (cyan->accent,
//     amber->warning). lucide Flag -> the decorative ⚑ glyph (the panel title
//     carries the meaning).
//   - `@/components/ui` Badge (a DOM <span>) -> an inline native pill;
//     `variant="success"` / `"neutral"` map to the success / raised-surface
//     tints (dark-theme `bg-green-900`/`bg-gray-700` intent), preserving the
//     Enabled / Disabled status rendering.
//   - `@/components/ui` DataTable analog: the web `grid-cols-[1fr_auto_2fr]`
//     "contents" grid (header + per-feature rows) inside `overflow-x-auto`
//     becomes a native header row + data rows inside a horizontal ScrollView
//     with fixed per-column widths — the same approach the ChangesPanel /
//     ActiveSessionsSection table ports took. The `details` cell keeps the web
//     `max-w-xs truncate` as numberOfLines={1}.
//   - `@/components/feedback` EmptyState -> the already-ported native parity
//     EmptyState (which requires title + message); the web EmptyState here is
//     message-only with a lucide Info icon, so the same `featureConfig.noData`
//     key/copy is passed as BOTH title and message (mirroring the
//     QuickMetrics / VampireDrain parity ports) and the decorative Info icon is
//     dropped (the native EmptyState has no icon slot).
//   - `@/components/motion` FadeIn (framer-motion entrance) -> an inline native
//     Animated fade+slide-up that honours reduced motion (delay=0.03 preserved).
//   - `@/lib/dateFormat` formatDateTime -> a local native-safe formatter
//     mirroring the web field set (year/month/day/hour/minute) + the universal
//     "—" fallback; the web threads no locale/tz override at this call site, so
//     the device locale/timezone is used.
//   - react-i18next `useTranslation('settings')` -> a local t() shim returning
//     the English fallback (resolving `{{token}}`), preserving every
//     `featureConfig.*` / `toast.*` key + copy verbatim.
//   - `@/components/feedback/Toast` useToast -> a local useNativeToast() shim
//     surfacing `toast.success(msg)` / `toast.error(msg, detail)` via
//     `Alert.alert`, the established native feedback primitive (ThemePicker
//     precedent); the refresh mutate() success/error toast callbacks are
//     preserved.
//   - `@/lib/cn` (clsx + tailwind-merge) is browser/Tailwind-only and dropped;
//     conditional classes become native style arrays / the Button `loading`
//     prop.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useRefreshTeslaFeatureConfig,
  useTeslaFeatureConfig,
} from '../../../api/hooks/useUser';
import {Button} from '../../../components/ui/Button';

/* ─── i18n fallback shim with `{{token}}` interpolation ────────────────────── */

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

/* ─── toast shim (web `@/components/feedback/Toast` useToast) ───────────────── */

interface NativeToast {
  success: (message: string) => void;
  error: (message: string, detail?: string) => void;
}

// useToast() is unavailable in native parity; the transient web toast becomes an
// `Alert.alert`, the established native feedback primitive (ThemePicker /
// _toastHelpers.ts precedent). `error` shows the detail as the Alert body.
function useNativeToast(): NativeToast {
  return useMemo(
    () => ({
      success: (message: string) => {
        Alert.alert(message);
      },
      error: (message: string, detail?: string) => {
        Alert.alert(message, detail);
      },
    }),
    [],
  );
}

/* ─── date formatter shim (web `@/lib/dateFormat` formatDateTime) ───────────── */

// Mirrors the web formatDateTime field set; the call site threads no
// locale/tz override, so the device locale/timezone is used via Intl.
const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat(undefined, DATE_TIME_FORMAT).format(date);
  } catch {
    return date.toISOString();
  }
}

/* ─── decorative lucide glyphs (the visible labels carry the meaning) ──────── */

const FLAG_GLYPH = '\u2691'; // ⚑ lucide Flag (text-style, respects color)
const REFRESH_GLYPH = '\u21BB'; // ↻ lucide RefreshCw

/* ─── FadeIn (web `@/components/motion` FadeIn) ─────────────────────────────── */

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | undefined;

    AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (cancelled) {
        return;
      }
      if (reduce) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      animation = Animated.parallel([
        Animated.timing(opacity, {
          delay: delay * 1000,
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          delay: delay * 1000,
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]);
      animation.start();
    });

    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [delay, opacity, translateY]);

  return (
    <Animated.View style={[{opacity, transform: [{translateY}]}, style]}>
      {children}
    </Animated.View>
  );
}

FadeIn.displayName = 'FadeIn';

/* ─── IconBox (web `@/components/ui` IconBox, color="purple") ───────────────── */

function IconBox({glyph}: {glyph: string}): React.ReactElement {
  return (
    <View style={styles.iconBox}>
      <AppText importantForAccessibility="no" style={styles.iconGlyph}>
        {glyph}
      </AppText>
    </View>
  );
}

IconBox.displayName = 'IconBox';

/* ─── Badge (web `@/components/ui` Badge) ───────────────────────────────────── */

type BadgeVariant = 'success' | 'neutral';

function Badge({
  children,
  variant,
}: {
  children: ReactNode;
  variant: BadgeVariant;
}): React.ReactElement {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

Badge.displayName = 'Badge';

/* ─── derived row shape (web `featureEntries` useMemo) ──────────────────────── */

interface FeatureEntry {
  key: string;
  enabled: boolean;
  details: string | null;
}

// Web `grid-cols-[1fr_auto_2fr]` -> fixed native column widths inside the
// horizontal ScrollView (Feature 1fr / Status auto / Details 2fr).
const COLUMN_WIDTHS = {
  feature: 168,
  status: 104,
  details: 248,
} as const;

export function FeatureToggles() {
  const t = useNativeTranslationFallback();
  const toast = useNativeToast();
  const {data: featureConfig} = useTeslaFeatureConfig();
  const featureConfigRefresh = useRefreshTeslaFeatureConfig();

  const featureEntries = useMemo<FeatureEntry[]>(() => {
    const data = featureConfig?.data;
    if (!data || typeof data !== 'object') {
      return [];
    }
    return Object.entries(data).map(([key, value]) => {
      const isObj = typeof value === 'object' && value !== null;
      const enabled = isObj
        ? (value as Record<string, unknown>).enabled
        : value;
      const details = isObj
        ? Object.entries(value as Record<string, unknown>)
            .filter(([k]) => k !== 'enabled')
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ')
        : null;
      return {key, enabled: Boolean(enabled), details};
    });
  }, [featureConfig?.data]);

  return (
    <FadeIn delay={0.03}>
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <IconBox glyph={FLAG_GLYPH} />
            <View style={styles.headerText}>
              <AppText style={styles.title} weight="semibold">
                {t('featureConfig.title', 'Feature Flags')}
              </AppText>
              <AppText style={styles.subtitle} tone="muted" variant="caption">
                {t(
                  'featureConfig.subtitle',
                  'Tesla account feature configuration',
                )}
              </AppText>
            </View>
          </View>
          <View style={styles.headerRight}>
            {featureConfig?.fetched_at ? (
              <AppText style={styles.syncedText} tone="muted" variant="caption">
                {`${t('featureConfig.lastSynced', 'Synced')} ${formatDateTime(
                  featureConfig.fetched_at,
                )}`}
              </AppText>
            ) : null}
            <Button
              disabled={featureConfigRefresh.isPending}
              icon={
                <AppText importantForAccessibility="no" style={styles.buttonGlyph}>
                  {REFRESH_GLYPH}
                </AppText>
              }
              loading={featureConfigRefresh.isPending}
              onPress={() =>
                featureConfigRefresh.mutate(undefined, {
                  onSuccess: () =>
                    toast.success(
                      t(
                        'toast.featureConfigRefreshed',
                        'Feature config refreshed',
                      ),
                    ),
                  onError: (err: Error) =>
                    toast.error(
                      t(
                        'toast.featureConfigFailed',
                        'Failed to refresh feature config',
                      ),
                      err.message,
                    ),
                })
              }
              size="sm"
              variant="secondary">
              {t('featureConfig.refresh', 'Refresh')}
            </Button>
          </View>
        </View>

        {featureEntries.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.table}>
              <View style={styles.headerRow}>
                <View style={[styles.headerCell, {width: COLUMN_WIDTHS.feature}]}>
                  <AppText
                    style={styles.columnHeader}
                    tone="muted"
                    variant="caption"
                    weight="semibold">
                    {t('featureConfig.feature', 'Feature')}
                  </AppText>
                </View>
                <View style={[styles.headerCell, {width: COLUMN_WIDTHS.status}]}>
                  <AppText
                    style={styles.columnHeader}
                    tone="muted"
                    variant="caption"
                    weight="semibold">
                    {t('featureConfig.status', 'Status')}
                  </AppText>
                </View>
                <View
                  style={[styles.headerCell, {width: COLUMN_WIDTHS.details}]}>
                  <AppText
                    style={styles.columnHeader}
                    tone="muted"
                    variant="caption"
                    weight="semibold">
                    {t('featureConfig.details', 'Details')}
                  </AppText>
                </View>
              </View>
              {featureEntries.map(entry => (
                <View key={entry.key} style={styles.row}>
                  <View style={[styles.cell, {width: COLUMN_WIDTHS.feature}]}>
                    <AppText style={styles.featureName} weight="semibold">
                      {entry.key}
                    </AppText>
                  </View>
                  <View style={[styles.cell, {width: COLUMN_WIDTHS.status}]}>
                    <Badge variant={entry.enabled ? 'success' : 'neutral'}>
                      {entry.enabled
                        ? t('featureConfig.enabled', 'Enabled')
                        : t('featureConfig.disabled', 'Disabled')}
                    </Badge>
                  </View>
                  <View style={[styles.cell, {width: COLUMN_WIDTHS.details}]}>
                    <AppText
                      numberOfLines={1}
                      style={styles.detailsText}
                      tone="muted"
                      variant="caption">
                      {entry.details ?? '—'}
                    </AppText>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : (
          <EmptyState
            message={t(
              'featureConfig.noData',
              'No feature config data yet. Click Refresh to fetch from Tesla.',
            )}
            title={t(
              'featureConfig.noData',
              'No feature config data yet. Click Refresh to fetch from Tesla.',
            )}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

FeatureToggles.displayName = 'FeatureToggles';

/* ─── styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeNeutralSurface: {
    backgroundColor: colors.surfaceRaised,
  },
  badgeNeutralText: {
    color: colors.textSecondary,
  },
  badgeSuccessSurface: {
    backgroundColor: colors.successSurface,
  },
  badgeSuccessText: {
    color: colors.success,
  },
  buttonGlyph: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 16,
  },
  cell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  columnHeader: {
    letterSpacing: 0.3,
  },
  detailsText: {
    color: colors.textMuted,
  },
  featureName: {
    color: colors.textPrimary,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerCell: {
    justifyContent: 'center',
    paddingBottom: spacing.sm,
    paddingRight: spacing.md,
  },
  headerLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minWidth: 220,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  headerRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  headerText: {
    flex: 1,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    color: colors.violet,
    fontSize: 18,
    lineHeight: 22,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.03)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  subtitle: {
    marginTop: 2,
  },
  syncedText: {
    fontSize: 11,
  },
  table: {
    flexDirection: 'column',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
});

const badgeSurfaceStyles = {
  neutral: styles.badgeNeutralSurface,
  success: styles.badgeSuccessSurface,
} as const;

const badgeTextStyles = {
  neutral: styles.badgeNeutralText,
  success: styles.badgeSuccessText,
} as const;
