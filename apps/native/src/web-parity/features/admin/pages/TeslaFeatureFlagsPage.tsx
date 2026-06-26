// Native parity port of web/src/features/admin/pages/TeslaFeatureFlagsPage.tsx.
//
// TeslaFeatureFlagsPage — dedicated page wrapper for the Tesla account Feature
// Flags surface. Previously rendered as an inline section on /settings; promoted
// to a first-class page under the Integrations sidebar group so it has a stable
// URL and is discoverable from the sidebar/command palette without scrolling
// through /settings. (web doc-comment, L1-11.)
//
// The web page is a thin wrapper: useTranslation('settings') + a page title +
// a <PageContainer title/subtitle> hosting the shared <FeatureToggles />
// component (features/settings/components/FeatureToggles). React Native has no
// DOM, Tailwind, lucide SVGs, framer-motion, or wired react-i18next, and the
// FeatureToggles component is NOT part of the native conversion manifest, so —
// exactly as the sibling FeatureFlagsPage port did with its sub-components —
// FeatureToggles is inlined here verbatim-by-behaviour. Every state name, hook,
// API path, predicate, and i18n key/default is preserved; see the colocated
// .parity.json sidecar for the line-by-line mapping.

import React, {useCallback, useMemo} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useRefreshTeslaFeatureConfig,
  useTeslaFeatureConfig,
} from '../../../api/hooks/useUser';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type TFunc = (key: string, defaultValue?: string) => string;

// react-i18next is not wired in native. The web page/component call
// t('featureConfig.title', 'Feature Flags') etc. — a dotted key within the
// 'settings' namespace plus an English default — and i18next returns the
// default when the key is unresolved. This fallback therefore returns
// `defaultValue ?? key`. Keys are kept verbatim so a future i18n wiring can
// resolve them unchanged.
function useT(): TFunc {
  return useCallback((key: string, defaultValue?: string) => defaultValue ?? key, []);
}

/* ─── Constants ───────────────────────────────────────────────────────── */

const FALLBACK = '\u2014'; // — universal missing-value placeholder
const REFRESH_GLYPH = '\u21BB'; // ↻ — lucide RefreshCw (Refresh action)

/* ─── Inlined helper (web @/lib/dateFormat formatDateTime) ────────────── */

// web FeatureToggles renders `Synced {formatDateTime(featureConfig.fetched_at)}`.
// formatDateTime produces "Apr 4, 2026, 02:30 AM" in the host locale/timezone
// and the universal "—" for null/unparseable input. The lib is not ported to
// native, so this inlines that absolute formatting faithfully.
function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) {
    return FALLBACK;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return FALLBACK;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── Derived feature-flag entry (web FeatureToggles useMemo) ──────────── */

interface FeatureEntry {
  key: string;
  enabled: boolean;
  details: string | null;
}

// web FeatureToggles featureEntries useMemo (L18-32), verbatim logic: for each
// [key, value] in the Tesla feature-config object, `enabled` is value.enabled
// when value is an object else the value itself (Boolean-coerced), and `details`
// joins the non-`enabled` entries as `k: JSON.stringify(v)` (null for primitives).
function buildFeatureEntries(data: unknown): FeatureEntry[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  return Object.entries(data as Record<string, unknown>).map(([key, value]) => {
    const isObj = typeof value === 'object' && value !== null;
    const enabled = isObj ? (value as Record<string, unknown>).enabled : value;
    const details = isObj
      ? Object.entries(value as Record<string, unknown>)
          .filter(([k]) => k !== 'enabled')
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(', ')
      : null;
    return {key, enabled: Boolean(enabled), details};
  });
}

/* ─── RefreshButton (web Button variant="secondary" size="sm") ────────── */

interface RefreshButtonProps {
  label: string;
  glyph: string;
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
  testID?: string;
}

function RefreshButton({label, glyph, onPress, loading, disabled, testID}: RefreshButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
      testID={testID}>
      {loading ? (
        // web spins the RefreshCw icon (animate-spin) while the mutation is
        // pending; native surfaces that busy state as a spinner.
        <ActivityIndicator color={colors.textPrimary} size="small" />
      ) : (
        <AppText style={styles.buttonGlyph}>{glyph}</AppText>
      )}
      <AppText style={styles.buttonLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── StatusBadge (web Badge success / neutral) ───────────────────────── */

function StatusBadge({enabled, label, testID}: {enabled: boolean; label: string; testID?: string}) {
  return (
    <View
      style={[styles.badge, enabled ? styles.badgeSuccess : styles.badgeNeutral]}
      testID={testID}>
      <AppText
        style={[styles.badgeText, enabled ? styles.badgeTextSuccess : styles.badgeTextNeutral]}
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ─── FeatureTogglesView (web FeatureToggles component) ────────────────── */

// Verbatim-by-behaviour port of web FeatureToggles
// (features/settings/components/FeatureToggles). The web original composes a
// FadeIn (framer-motion) > GlassPanel with: an IconBox+Flag header, the title /
// subtitle, an optional "Synced <when>" stamp, a secondary Refresh Button, and
// either a 3-column Feature/Status/Details grid of Badge rows or an EmptyState.
// FadeIn -> plain View; IconBox+lucide Flag -> SemanticIcon name="flag"; the
// CSS grid/Tailwind table -> a header row + per-feature rows; Badge -> StatusBadge;
// the EmptyState(Info icon + message) -> an inline info block (the native shared
// EmptyState requires a title the web variant does not provide). The refresh
// mutation toasts are handled inside the unchanged native useRefreshTeslaFeatureConfig
// hook, so the web page's explicit onSuccess/onError callbacks (same English
// 'Feature config refreshed' / 'Failed to refresh feature config' messages) are
// not re-passed — re-passing would double-fire the toast.
function FeatureTogglesView({t}: {t: TFunc}) {
  const {data: featureConfig} = useTeslaFeatureConfig();
  const featureConfigRefresh = useRefreshTeslaFeatureConfig();

  const featureEntries = useMemo(
    () => buildFeatureEntries(featureConfig?.data),
    [featureConfig?.data],
  );

  return (
    <View>
      <GlassPanel style={styles.panel} testID="tesla-feature-config-panel">
        <View style={styles.panelHeader}>
          <View style={styles.panelHeaderLeft}>
            <SemanticIcon decorative name="flag" size="sm" />
            <View style={styles.panelHeaderText}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('featureConfig.title', 'Feature Flags')}
              </AppText>
              <AppText tone="muted" variant="caption">
                {t('featureConfig.subtitle', 'Tesla account feature configuration')}
              </AppText>
            </View>
          </View>
          <View style={styles.panelHeaderActions}>
            {featureConfig?.fetched_at ? (
              <AppText tone="muted" variant="caption" testID="tesla-feature-config-synced">
                {t('featureConfig.lastSynced', 'Synced')}{' '}
                {formatDateTime(featureConfig.fetched_at)}
              </AppText>
            ) : null}
            <RefreshButton
              disabled={featureConfigRefresh.isPending}
              glyph={REFRESH_GLYPH}
              label={t('featureConfig.refresh', 'Refresh')}
              loading={featureConfigRefresh.isPending}
              onPress={() => featureConfigRefresh.mutate()}
              testID="tesla-feature-config-refresh"
            />
          </View>
        </View>

        {featureEntries.length > 0 ? (
          <View style={styles.table} testID="tesla-feature-config-table">
            <View style={styles.tableHeader}>
              <AppText style={[styles.cellCaption, styles.colFeature]} tone="muted" variant="caption">
                {t('featureConfig.feature', 'Feature')}
              </AppText>
              <AppText style={[styles.cellCaption, styles.colStatus]} tone="muted" variant="caption">
                {t('featureConfig.status', 'Status')}
              </AppText>
              <AppText style={[styles.cellCaption, styles.colDetails]} tone="muted" variant="caption">
                {t('featureConfig.details', 'Details')}
              </AppText>
            </View>
            {featureEntries.map(entry => (
              <View key={entry.key} style={styles.row} testID={`tesla-feature-row-${entry.key}`}>
                <AppText style={[styles.colFeature, styles.featureKey]} weight="semibold">
                  {entry.key}
                </AppText>
                <View style={styles.colStatus}>
                  <StatusBadge
                    enabled={entry.enabled}
                    label={
                      entry.enabled
                        ? t('featureConfig.enabled', 'Enabled')
                        : t('featureConfig.disabled', 'Disabled')
                    }
                    testID={`tesla-feature-status-${entry.key}`}
                  />
                </View>
                <AppText
                  numberOfLines={2}
                  style={[styles.colDetails, styles.featureDetails]}
                  tone="muted"
                  variant="caption">
                  {entry.details ?? FALLBACK}
                </AppText>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.empty} testID="tesla-feature-config-empty">
            <SemanticIcon decorative name="info" size="md" />
            <AppText style={styles.emptyText} tone="muted">
              {t(
                'featureConfig.noData',
                'No feature config data yet. Click Refresh to fetch from Tesla.',
              )}
            </AppText>
          </View>
        )}
      </GlassPanel>
    </View>
  );
}

/* ─── Page (web TeslaFeatureFlagsPage + PageContainer) ────────────────── */

// web TeslaFeatureFlagsPage (L18-31): useTranslation('settings'), a page title
// from t('featureConfig.title','Feature Flags'), usePageTitle(title) (drives
// document.title — no RN analogue, so the translated title is surfaced as the
// on-screen accessibilityRole="header" page header), and a PageContainer with
// title + subtitle hosting <FeatureToggles />. The web page deliberately repeats
// the same title/subtitle the FeatureToggles panel also shows, so both headers
// are reproduced here.
export default function TeslaFeatureFlagsPage() {
  const t = useT();
  const title = t('featureConfig.title', 'Feature Flags');

  return (
    <View style={styles.page} testID="tesla-feature-flags-page">
      <ScrollView contentContainerStyle={styles.scrollContent} style={styles.scroll}>
        <View style={styles.header}>
          <AppText accessibilityRole="header" style={styles.pageTitle}>
            {title}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted">
            {t('featureConfig.subtitle', 'Tesla account feature configuration')}
          </AppText>
        </View>

        <FeatureTogglesView t={t} />
      </ScrollView>
    </View>
  );
}

TeslaFeatureFlagsPage.displayName = 'TeslaFeatureFlagsPage';

/* ─── Styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    rowGap: spacing.lg,
  },
  header: {
    rowGap: spacing.xs,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  pageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },

  panel: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  panelHeader: {
    alignItems: 'flex-start',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  panelHeaderLeft: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flex: 1,
    flexDirection: 'row',
    minWidth: 180,
  },
  panelHeaderText: {
    flexShrink: 1,
    rowGap: 2,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  panelHeaderActions: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },

  /* refresh button */
  button: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    columnGap: spacing.xs,
    flexDirection: 'row',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonGlyph: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  buttonLabel: {
    color: colors.textPrimary,
    fontSize: 13,
  },

  /* status badge */
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  badgeText: {
    fontSize: 11,
  },
  badgeTextSuccess: {
    color: colors.success,
  },
  badgeTextNeutral: {
    color: colors.textSecondary,
  },

  /* feature table */
  table: {
    rowGap: spacing.sm,
  },
  tableHeader: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    columnGap: spacing.md,
    flexDirection: 'row',
    paddingBottom: spacing.xs,
  },
  cellCaption: {
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  row: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  colFeature: {
    flex: 1,
    minWidth: 90,
  },
  colStatus: {
    width: 84,
  },
  colDetails: {
    flex: 2,
    minWidth: 90,
  },
  featureKey: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  featureDetails: {
    fontSize: 12,
  },

  /* empty state */
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    rowGap: spacing.sm,
  },
  emptyText: {
    textAlign: 'center',
  },
});
