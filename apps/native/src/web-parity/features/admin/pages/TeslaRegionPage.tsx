/**
 * Native parity port of
 * web/src/features/admin/pages/TeslaRegionPage.tsx.
 *
 * The web file (30 lines) is a thin page wrapper that promotes the Tesla
 * account "Region & Fleet API endpoint" surface to a first-class page under the
 * Integrations sidebar group: it resolves a translated title
 * (`t('region.title', 'Region & API')`), pushes it through `usePageTitle`, and
 * renders a `<PageContainer>` (title + subtitle) whose only child is the shared
 * `<RegionSettings />` component. This native port preserves that contract 1:1 —
 * the same `region.title` / `region.subtitle` keys, the same usePageTitle call,
 * and the same scaffold-wraps-RegionSettings structure — using React Native
 * primitives + the existing native AppText / GlassPanel / IconBox + tokens.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation('settings')` (web L12): native-safe
 *     `t(key, fallback?)` fallback (the FleetAPIPage / ApiPlaygroundPage
 *     precedent) returning the English default else the key. The 'settings'
 *     namespace is informational on native; every web key is preserved verbatim.
 *   - `@/components/layout` `PageContainer` (web L13): no native parity port
 *     exists yet, so a minimal native-safe `PageScaffold` is reproduced locally
 *     (title / subtitle / children — the only props this page uses), the
 *     established "reproduce locally when no native parity port exists"
 *     precedent (FleetAPIPage / ApiPlaygroundPage).
 *   - `@/hooks/usePageTitle` (web L14): `document.title` is browser-only, so the
 *     native hook is a documented no-op (the native navigator owns the title).
 *   - `@/features/settings/components/RegionSettings` (web L15): the shared
 *     RegionSettings component has no native parity port yet (its own future
 *     conversion target), so it is reproduced locally here as a native-safe
 *     `RegionSettings` — wired to the already-ported native region hooks
 *     (../../../api/hooks/useUser `useTeslaUserRegion` / `useRefreshTeslaRegion`,
 *     same `/tesla/user/region` + `/tesla/user/region/refresh` paths and the
 *     same `TeslaConfigEnvelope<TeslaRegionData>` response shape), the native
 *     GlassPanel / IconBox / AppText + tokens, a local native-safe Button /
 *     EmptyState / FadeIn, a local native-safe `useToast` bridging to
 *     `Alert.alert`, and a local native-safe `formatDateTime` mirroring
 *     web/src/lib/dateFormat formatDateTime. Its full web source (region card +
 *     fleet-API-URL card + refresh button + last-synced label + Info empty
 *     state) is preserved verbatim; the lucide Globe / RefreshCw / Info icons
 *     become decorative AppText glyphs and the `animate-spin` refresh animation
 *     is a static glyph (visual-only, dropped).
 */
import React, {useEffect, useMemo, type ReactNode} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {IconBox} from '../../../components/ui/IconBox';
import {
  useRefreshTeslaRegion,
  useTeslaUserRegion,
} from '../../../api/hooks/useUser';

/* ─── decorative glyph stand-ins for the lucide-react icons ───────────────── */

const GLOBE_GLYPH = '\uD83C\uDF10'; // 🌐 (lucide Globe)
const REFRESH_GLYPH = '\u21BB'; // ↻ (lucide RefreshCw)
const INFO_GLYPH = '\u24D8'; // ⓘ (lucide Info)

/* ─── native translation fallback (native-safe port of react-i18next) ─────── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ─── native-safe usePageTitle (web document.title is browser-only) ───────── */

function usePageTitle(title: string): void {
  useEffect(() => {
    // The web hook writes document.title; on native the navigator owns the
    // header title, so the resolved title is intentionally not applied here.
    void title;
  }, [title]);
}

/* ─── native-safe useToast (web @/components/feedback/Toast) ───────────────── */

interface NativeToast {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

/**
 * The web `useToast()` enqueues a transient in-app toast. The native parity
 * layer has no Toast provider yet, so feedback bridges to React Native
 * `Alert.alert(title, message?)` (the FleetAPIPage `_toastHelpers` precedent),
 * preserving the component's `success(title)` / `error(title, message)` calls.
 */
function useToast(): NativeToast {
  return useMemo<NativeToast>(
    () => ({
      success: (title, message) => Alert.alert(title, message),
      error: (title, message) => Alert.alert(title, message),
    }),
    [],
  );
}

/* ─── native-safe formatDateTime (web @/lib/dateFormat) ───────────────────── */

/**
 * Mirrors the web `formatDateTime(iso)`: returns the "—" placeholder for a
 * nullish / unparseable timestamp, else the local "Apr 4, 2026, 2:30 AM"
 * rendering via `toLocaleString` with the same field set.
 */
function formatDateTime(iso: string | null | undefined): string {
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

/* ─── native FadeIn stand-in (`@/components/motion` FadeIn) ────────────────── */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

/* ─── native Button stand-in (`@/components/ui` Button) ───────────────────── */

interface ButtonProps {
  onPress: () => void;
  children: string;
  icon?: ReactNode;
  disabled?: boolean;
  testID?: string;
}

/** Secondary / sm Button — the only variant+size this page uses (web L36-37). */
function Button({onPress, children, icon, disabled, testID}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={[styles.button, disabled && styles.buttonDisabled]}
      testID={testID}>
      {icon ? <View style={styles.buttonIcon}>{icon}</View> : null}
      <AppText style={styles.buttonText} variant="caption" weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

/* ─── native EmptyState stand-in (`@/components/feedback` EmptyState) ──────── */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  testID?: string;
}

function EmptyState({icon, message, testID}: EmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ─── native-safe page scaffold (web @/components/layout PageContainer) ────── */

interface PageScaffoldProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

function PageScaffold({title, subtitle, children}: PageScaffoldProps) {
  return (
    <ScrollView contentContainerStyle={styles.scaffold} testID="tesla-region-page">
      <View style={styles.scaffoldHeader}>
        <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.scaffoldSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.scaffoldBody}>{children}</View>
    </ScrollView>
  );
}

/* ─── RegionSettings (local native-safe port of the shared web component) ──── */

/**
 * Native parity reproduction of
 * web/src/features/settings/components/RegionSettings.tsx — the panel the web
 * TeslaRegionPage renders. Preserves the web contract 1:1: the
 * useTeslaUserRegion / useRefreshTeslaRegion hooks, the region + fleet-API-URL
 * cards, the last-synced label, the Refresh button mutation (with the verbatim
 * success/error toast callbacks), and the Info empty state.
 */
function RegionSettings() {
  const t = useNativeTranslationFallback();
  const toast = useToast();
  const {data: regionConfig} = useTeslaUserRegion();
  const regionRefresh = useRefreshTeslaRegion();

  return (
    <FadeIn delay={0.04}>
      <GlassPanel style={styles.regionPanel}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <IconBox color="green">{GLOBE_GLYPH}</IconBox>
            <View style={styles.headerLeftText}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('region.title', 'Region & API')}
              </AppText>
              <AppText style={styles.panelSubtitle} tone="muted" variant="caption">
                {t('region.subtitle', 'Tesla account region and Fleet API endpoint')}
              </AppText>
            </View>
          </View>
          <View style={styles.headerRight}>
            {regionConfig?.fetched_at ? (
              <AppText
                style={styles.lastSynced}
                testID="tesla-region-last-synced"
                tone="muted"
                variant="caption">
                {`${t('region.lastSynced', 'Synced')} ${formatDateTime(
                  regionConfig.fetched_at,
                )}`}
              </AppText>
            ) : null}
            <Button
              disabled={regionRefresh.isPending}
              icon={
                <AppText
                  importantForAccessibility="no-hide-descendants"
                  style={styles.refreshGlyph}>
                  {REFRESH_GLYPH}
                </AppText>
              }
              onPress={() =>
                regionRefresh.mutate(undefined, {
                  onSuccess: () =>
                    toast.success(t('toast.regionRefreshed', 'Region info refreshed')),
                  onError: (err: Error) =>
                    toast.error(
                      t('toast.regionFailed', 'Failed to refresh region'),
                      err.message,
                    ),
                })
              }
              testID="tesla-region-refresh">
              {t('region.refresh', 'Refresh')}
            </Button>
          </View>
        </View>

        {regionConfig?.data?.region ? (
          <View style={styles.grid}>
            <View style={styles.card}>
              <AppText style={styles.cardLabel} tone="muted" variant="caption">
                {t('region.regionCode', 'Region')}
              </AppText>
              <AppText
                style={styles.cardValueLg}
                testID="tesla-region-code"
                weight="semibold">
                {regionConfig.data.region}
              </AppText>
            </View>
            <View style={styles.card}>
              <AppText style={styles.cardLabel} tone="muted" variant="caption">
                {t('region.fleetApiUrl', 'Fleet API Base URL')}
              </AppText>
              <AppText style={styles.cardValueMono} testID="tesla-region-fleet-url">
                {regionConfig.data.fleet_api_base_url ?? '—'}
              </AppText>
            </View>
          </View>
        ) : (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available beyond Refresh.
          <EmptyState
            icon={
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={styles.emptyGlyph}
                tone="muted">
                {INFO_GLYPH}
              </AppText>
            }
            message={t(
              'region.noData',
              'No region data yet. Click Refresh to fetch from Tesla.',
            )}
            testID="tesla-region-empty"
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ─── Page component (web TeslaRegionPage default export) ──────────────────── */

export default function TeslaRegionPage() {
  const t = useNativeTranslationFallback();
  const title = t('region.title', 'Region & API');
  usePageTitle(title);

  return (
    <PageScaffold
      subtitle={t('region.subtitle', 'Tesla account region and Fleet API endpoint')}
      title={title}>
      <RegionSettings />
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scaffoldHeader: {
    gap: spacing.xs,
  },
  scaffoldTitle: {
    letterSpacing: -0.5,
  },
  scaffoldSubtitle: {
    fontSize: typography.caption,
  },
  scaffoldBody: {
    gap: spacing.lg,
  },
  regionPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  headerLeftText: {
    flexShrink: 1,
    minWidth: 0,
  },
  panelTitle: {
    fontSize: typography.body,
  },
  panelSubtitle: {
    fontSize: 11,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 0,
  },
  lastSynced: {
    fontSize: 11,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: colors.textPrimary,
  },
  refreshGlyph: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  grid: {
    gap: spacing.md,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    padding: spacing.md,
  },
  cardLabel: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  cardValueLg: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  cardValueMono: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyStateIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  emptyGlyph: {
    fontSize: 32,
    lineHeight: 38,
  },
});
