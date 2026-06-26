// Native parity port of web/src/features/settings/pages/HelixPage.tsx.
//
// HelixPage — dedicated home for the Helix AI integration. Helix is
// TeslaSync's optional, default-off AI integration; because it is a *service
// connection* (external LLM provider, credentials, a daily cost cap, and
// ~60 per-feature opt-in toggles) it lives under the Integrations side-nav
// group rather than inside /settings. ADR-015 §I7 is satisfied as long as the
// opt-in surface is stable, discoverable, and always rendered — not by it
// living at a specific route.
//
// Every web behavior and state name is preserved: the `useSettings()` query ->
// `{ isLoading }`, the page title `t('helix.page.title', 'Helix')`, the
// subtitle copy, and the `breadcrumbLabels` ({ integrations, helix }) object
// with its exact `helix.breadcrumb.integrations` / `helix.page.title` i18n
// keys. The web DOM/Tailwind stack is replaced with React Native primitives +
// the native parity component library:
//
//   - `@/components/layout` `PageContainer` (title/subtitle/loading/
//     breadcrumbLabels) has no native parity component, so a local ScrollView
//     screen scaffold reproduces the header (title + subtitle), the
//     loading->Spinner branch (web renders the spinner *instead of* children
//     while loading) via a centered `ActivityIndicator`, and the
//     breadcrumbLabels — which the web pushes to the global Layout breadcrumb
//     via BreadcrumbOverridesContext — as an inline "Integrations / Helix"
//     breadcrumb row so the same labels stay discoverable. Precedent:
//     DiskForecastPage / SlowQueriesPage / AutomationListPage local scaffolds.
//   - `../components` `AISettings` (web 669-line stateful component with its
//     own `components/__tests__/AISettings.test.tsx` suite) is a *separate*
//     conversion target and is not yet ported to native. Like the heavy
//     Recharts/Leaflet dependencies elsewhere (which the native barrels render
//     as an explicit "unavailable" placeholder), HelixPage renders a
//     native-safe, always-mounted Helix surface here: the ADR-015 stable
//     opt-in surface is preserved (always rendered, discoverable, names the
//     four sub-panels AIProviderSection / AIFeatureToggleList / AIRestorePanel
//     / AIUsageCard from the web layout tree), with an explicit note that the
//     interactive configuration controls are managed in the TeslaSync web app
//     and not yet exposed in this native build. This is documented in the
//     sidecar; when AISettings.tsx is ported it replaces this placeholder.
//   - `@/components/branding/HelixMark` (web SVG brand glyph) has no native
//     vector dependency; it becomes a small themed "H" mark badge — the
//     heading text carries the meaning.
//   - `@/hooks/usePageTitle` (sets document.title) is a native no-op shim — RN
//     has no document — but the `t()` title call is preserved.
//   - react-i18next `useTranslation` is unavailable in native parity; a local
//     fallback shim returns the English fallback (and interpolates `{{token}}`)
//     so every i18n key + copy is preserved verbatim.
//   - `@/api/hooks/useSettings` `useSettings()` reuses the already-ported
//     native parity hook (same `/settings` query); only `isLoading` is read,
//     matching the web destructure exactly.

import React, {useCallback} from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useSettings} from '../../../api/hooks/useSettings';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, vars?: TranslationVars) => {
      if (vars == null) {
        return fallback;
      }
      return fallback.replace(
        /\{\{\s*([^}\s]+)\s*\}\}/g,
        (match, name: string) =>
          Object.prototype.hasOwnProperty.call(vars, name)
            ? String(vars[name])
            : match,
      );
    },
    [],
  );
}

/* ─── usePageTitle (web sets document.title; native has no document) ───────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── AISettings (web `../components` AISettings — separate target, not yet ──
 * ported). Native-safe, always-mounted Helix opt-in surface preserving the
 * ADR-015 stable-surface contract and naming the four web sub-panels. */

interface HelixPanel {
  key: string;
  title: string;
  desc: string;
}

function AISettings({t}: {t: NativeTFunction}) {
  const panels: HelixPanel[] = [
    {
      key: 'provider',
      title: t('helix.native.panels.provider.title', 'Provider, key & model'),
      desc: t(
        'helix.native.panels.provider.desc',
        'Pick an LLM provider, store the API key, choose a model, and validate the connection.',
      ),
    },
    {
      key: 'features',
      title: t('helix.native.panels.features.title', 'Per-feature opt-ins'),
      desc: t(
        'helix.native.panels.features.desc',
        'Each AI feature starts off and must be turned on individually — nothing runs until you opt in.',
      ),
    },
    {
      key: 'restore',
      title: t('helix.native.panels.restore.title', 'Restore from archive'),
      desc: t(
        'helix.native.panels.restore.desc',
        'Re-enable a previously archived selection — explicit confirmation, no silent restore.',
      ),
    },
    {
      key: 'usage',
      title: t('helix.native.panels.usage.title', "Today's spend vs. cap"),
      desc: t(
        'helix.native.panels.usage.desc',
        "Track today's AI spend against the configured daily cost cap.",
      ),
    },
  ];

  return (
    <GlassPanel style={styles.panel} testID="settings-ai">
      <View style={styles.panelHeader}>
        <View style={styles.helixMark}>
          <AppText style={styles.helixMarkText} tone="accent" weight="bold">
            H
          </AppText>
        </View>
        <View style={styles.panelHeaderCopy}>
          <AppText variant="title" weight="bold">
            {t('helix.native.heading', 'Helix AI integration')}
          </AppText>
          <AppText style={styles.panelHeaderSub} tone="muted" variant="caption">
            {t(
              'helix.page.subtitle',
              'Optional AI integration. Off by default — nothing runs until you opt in here.',
            )}
          </AppText>
        </View>
      </View>

      <View style={styles.panelList}>
        {panels.map(panel => (
          <View key={panel.key} style={styles.panelListRow}>
            <AppText style={styles.bullet} tone="accent">
              •
            </AppText>
            <View style={styles.panelListCopy}>
              <AppText weight="semibold">{panel.title}</AppText>
              <AppText tone="muted" variant="caption">
                {panel.desc}
              </AppText>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.notice}>
        <AppText tone="muted" variant="caption">
          {t(
            'helix.native.managedOnWeb',
            'AI provider configuration, the per-feature opt-in toggles, restore-from-archive, and usage are managed in the TeslaSync web app. This native build surfaces the Helix integration but does not yet expose its configuration controls.',
          )}
        </AppText>
      </View>
    </GlassPanel>
  );
}

AISettings.displayName = 'AISettings';

/* ─── HelixPage ────────────────────────────────────────────────────────────── */

export default function HelixPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('helix.page.title', 'Helix'));
  const {isLoading} = useSettings();

  const breadcrumbLabels = {
    integrations: t('helix.breadcrumb.integrations', 'Integrations'),
    helix: t('helix.page.title', 'Helix'),
  };

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="settings-helix">
      <View style={styles.breadcrumbRow}>
        <AppText tone="muted" variant="caption">
          {breadcrumbLabels.integrations}
        </AppText>
        <AppText style={styles.breadcrumbSep} tone="muted" variant="caption">
          /
        </AppText>
        <AppText tone="secondary" variant="caption">
          {breadcrumbLabels.helix}
        </AppText>
      </View>

      <View style={styles.header}>
        <AppText style={styles.pageTitle} variant="title" weight="bold">
          {t('helix.page.title', 'Helix')}
        </AppText>
        <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
          {t(
            'helix.page.subtitle',
            'Optional AI integration. Off by default — nothing runs until you opt in here.',
          )}
        </AppText>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <AISettings t={t} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  breadcrumbRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  breadcrumbSep: {
    opacity: 0.6,
  },
  header: {
    gap: spacing.xs,
  },
  pageTitle: {
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    maxWidth: 560,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  panel: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  panelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  helixMark: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  helixMarkText: {
    fontSize: 20,
    lineHeight: 24,
  },
  panelHeaderCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  panelHeaderSub: {
    maxWidth: 480,
  },
  panelList: {
    gap: spacing.md,
  },
  panelListRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bullet: {
    lineHeight: 22,
  },
  panelListCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  notice: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
  },
});
