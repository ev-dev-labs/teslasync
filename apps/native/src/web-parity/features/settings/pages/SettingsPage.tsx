// Native parity port of web/src/features/settings/pages/SettingsPage.tsx.
//
// The web page is the top-level /settings surface: a <PageContainer title
// subtitle loading> wrapping a settings-search box, a cross-tab edit-conflict
// banner, four settings sections (General / Appearance / Advanced / Reset), and
// three link/action cards (Data Export, Onboarding Tour, Setup Checklist). It
// also wires two browser-only effects (a legacy `/settings#ai` ->
// `/integrations/helix` redirect and a hash-anchor smooth-scroll) and claims a
// cross-tab edit lease.
//
// Per the conversion contract, the DOM/web-only pieces are replaced with
// native-safe equivalents and every unavailable browser behaviour is surfaced
// explicitly (see nativeSettingsPageCapabilities) instead of silently dropped:
//   * react-router useLocation/useNavigate + the two hash effects -> there is no
//     URL hash, document, scrollIntoView, or setTimeout-driven anchor scroll on
//     native, so the effects are omitted and their intent is documented as
//     unavailable; navigation is surfaced via the optional onNavigate callback.
//   * react-i18next useTranslation('settings') -> useNativeTranslationFallback,
//     returning each English fallback verbatim and reproducing i18next `{{var}}`
//     interpolation. Every key + fallback the web used is preserved.
//   * usePageTitle (document.title) -> no-op useNativePageTitle; the title still
//     renders in the page header.
//   * useEditLease / <EditConflictBanner> (BroadcastChannel + localStorage,
//     cross-tab) -> a no-op useNativeEditLease + an EditConflictBanner that
//     renders null (its default no-conflict state); both preserve their props.
//   * <PageContainer> -> inline PageContainerView (ScrollView + title/subtitle
//     header + loading spinner) mirroring the web loading-vs-children behaviour.
//   * <GlassPanel> -> shared native GlassPanel. <Button variant="ghost" icon> ->
//     inline GhostButton (Pressable + leading SemanticIcon + label). <IconBox>
//     + lucide-react (Download/ExternalLink/PlayCircle/Rocket) -> SemanticIcon
//     glyphs (download / externalLink / play / sparkles); the boxed glyph tones
//     stand in for the web IconBox green/cyan (documented tone adaptation,
//     consistent with the sibling admin parity ports). <FadeIn> (framer-motion)
//     -> a passthrough View; the entrance animation carries no behavioural
//     contract.
//   * dispatchTourLauncherOpen() (window CustomEvent) -> the optional
//     onOpenTourLauncher callback. restartChecklist() (localStorage) -> the
//     optional onRestartChecklist callback, with the web toast.success replaced
//     by Alert.alert (the native feedback primitive used by useMutationToast).
//   * GeneralSettings / AppearanceSettings / AdvancedSettings / SettingsSearch
//     are imported from the existing native '../components' barrel (native-safe
//     "native port pending" placeholders). ResetSection has no native module at
//     '../components/ResetSection', so its section renders a local placeholder
//     with the same visual as the barrel placeholders (the section stays
//     visible, never hidden).
//
// No DOM, no lucide-react, no Recharts/Leaflet, no react-router, no
// framer-motion, and no web UI components are imported.

import { useCallback, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { useSettings } from '../../../api/hooks/useSettings';
import {
  AdvancedSettings,
  AppearanceSettings,
  GeneralSettings,
  SettingsSearch,
} from '../components';

/* ------------------------------------------------------------------ */
/*  i18n + native-safe hook ports                                      */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

// The web page read `t` from react-i18next ('settings' namespace). Native parity
// has no i18n runtime wired yet, so this returns the English fallback string and
// reproduces i18next's `{{var}}` interpolation, preserving every key + fallback.
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

// Native no-op for the web `useEditLease`. The web hook claimed a cross-tab edit
// lease (BroadcastChannel + localStorage) so a second tab editing the same
// settings would see a conflict banner before saving. Native has no cross-tab
// surface, so this is a no-op; the lease key is preserved for documentation.
function useNativeEditLease(_leaseKey: string): void {
  // Intentionally empty — see note above.
}

/* ------------------------------------------------------------------ */
/*  Navigation + capability surface                                    */
/* ------------------------------------------------------------------ */

/** Route the web Data Export card linked to via `<a href="/data-export">`. */
export const SETTINGS_DATA_EXPORT_ROUTE_ID = '/data-export';

/**
 * Target of the web legacy `/settings#ai` -> `/integrations/helix` redirect.
 * Surfaced for parity even though native has no URL hash to trigger it.
 */
export const SETTINGS_AI_REDIRECT_ROUTE_ID = '/integrations/helix';

/**
 * Records which web capabilities the source relied on that are unavailable on
 * native, so the unavailable state is explicit and programmatically
 * inspectable (parity-contract rule 7).
 */
export const nativeSettingsPageCapabilities = {
  // usePageTitle set document.title; native has no document.
  documentTitleAvailable: false,
  // useLocation/useNavigate; native has no react-router.
  reactRouterAvailable: false,
  // The hash-anchor smooth-scroll effect (document.getElementById +
  // scrollIntoView + setTimeout); native has no DOM anchors.
  hashAnchorScrollAvailable: false,
  // The legacy `/settings#ai` -> SETTINGS_AI_REDIRECT_ROUTE_ID redirect; native
  // has no URL hash to react to.
  legacyAiHashRedirectAvailable: false,
  // useEditLease + EditConflictBanner (BroadcastChannel + localStorage).
  editLeaseAvailable: false,
  // dispatchTourLauncherOpen (window CustomEvent) -> onOpenTourLauncher.
  tourLauncherDispatchAvailable: false,
  // restartChecklist (localStorage) -> onRestartChecklist.
  checklistRestartAvailable: false,
  // `<a href>` navigation -> onNavigate.
  anchorNavigationAvailable: false,
} as const;

export interface SettingsPageProps {
  /**
   * Navigation handler. Parity for the web `<a href="/data-export">`; callers
   * should route to {@link SETTINGS_DATA_EXPORT_ROUTE_ID}. Omitted -> the card
   * is inert (still rendered), matching how the native shell may not yet own a
   * route table.
   */
  onNavigate?: (routeId: string) => void;
  /**
   * Parity for the web `dispatchTourLauncherOpen()` (a window CustomEvent the
   * tour launcher listens for). Omitted -> the Tour button is inert.
   */
  onOpenTourLauncher?: () => void;
  /**
   * Parity for the web `restartChecklist()` (clears the localStorage flags that
   * re-trigger the dashboard setup checklist). Omitted -> only the confirmation
   * Alert is shown.
   */
  onRestartChecklist?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Inline native chrome                                               */
/* ------------------------------------------------------------------ */

// FadeIn: web framer-motion entrance wrapper. The animation carries no
// behavioural contract, so this preserves the wrapper structurally. `delay`
// (0.18 / 0.2 / 0.22) is accepted to keep the web call sites but is inert.
function FadeIn({ children }: { children: ReactNode; delay?: number }) {
  return <View>{children}</View>;
}

// Native parity for the web <PageContainer title subtitle loading>: a scrollable
// page with a title (+ optional subtitle) header that swaps the body for a
// spinner while loading (mirroring the web Spinner-vs-children behaviour).
function PageContainerView({
  title,
  subtitle,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.pageRoot}
    >
      <View style={styles.pageHeader}>
        <AppText variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? <AppText tone="muted">{subtitle}</AppText> : null}
      </View>
      {loading ? (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <View style={styles.pageBody}>{children}</View>
      )}
    </ScrollView>
  );
}

// Native parity for the web cross-tab <EditConflictBanner>. It detects a second
// tab editing the same resource via BroadcastChannel + localStorage and renders
// a warning banner only on conflict. Native has no cross-tab surface, so there
// is never a conflict to surface: render nothing (the web banner's default
// no-conflict state). Props are preserved for documentation/parity.
function EditConflictBanner(_props: {
  resourceKey: string;
  resourceLabel: string;
}): ReactNode {
  return null;
}

// Native parity for a web settings section that has no dedicated native port yet
// (ResetSection). Mirrors the '../components' barrel placeholders so the section
// stays visible with an explicit "native port pending" state.
function SectionPlaceholder({ section }: { section: string }) {
  return (
    <GlassPanel style={styles.placeholderPanel}>
      <AppText style={styles.placeholderKicker} tone="muted" variant="caption">
        Settings
      </AppText>
      <AppText weight="semibold">{section}</AppText>
      <AppText tone="muted" variant="caption">
        Native port pending
      </AppText>
    </GlassPanel>
  );
}

// Native parity for the web <Button variant="ghost" icon={...}>: a bordered
// Pressable with a leading SemanticIcon and a label.
function GhostButton({
  iconName,
  label,
  onPress,
}: {
  iconName: SemanticIconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghostButton,
        pressed && styles.ghostButtonPressed,
      ]}
    >
      <SemanticIcon decorative name={iconName} size="sm" />
      <AppText
        style={styles.ghostButtonText}
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsPage(props: SettingsPageProps = {}) {
  const { onNavigate, onOpenTourLauncher, onRestartChecklist } = props;
  const t = useNativeTranslationFallback();
  useNativePageTitle(t('title', 'Settings'));
  const { isLoading } = useSettings();

  // The web page claims an edit lease for the whole settings page so a second
  // tab editing the same settings sees a conflict banner before its save can
  // silently overwrite this tab's changes. Key preserved; native no-op.
  const settingsLeaseKey = 'settings/general';
  useNativeEditLease(settingsLeaseKey);

  // The web legacy `/settings#ai` -> /integrations/helix redirect and the
  // hash-anchor smooth-scroll effect are browser-only (URL hash, document,
  // scrollIntoView, setTimeout). They are documented as unavailable in
  // nativeSettingsPageCapabilities and omitted here.

  const handleOpenDataExport = useCallback(() => {
    onNavigate?.(SETTINGS_DATA_EXPORT_ROUTE_ID);
  }, [onNavigate]);

  const handleOpenTourLauncher = useCallback(() => {
    onOpenTourLauncher?.();
  }, [onOpenTourLauncher]);

  const handleRestartChecklist = useCallback(() => {
    onRestartChecklist?.();
    Alert.alert(
      t(
        'checklist.settings.restarted',
        'Setup checklist restarted — re-add the widget from the dashboard customizer if needed.',
      ),
    );
  }, [onRestartChecklist, t]);

  return (
    <PageContainerView
      loading={isLoading}
      subtitle={t(
        'subtitle',
        'Configure TeslaSync preferences and Tesla account connection',
      )}
      title={t('title', 'Settings')}
    >
      <SettingsSearch />

      <EditConflictBanner
        resourceKey={settingsLeaseKey}
        resourceLabel={t('editConflict.resource.settings', 'Your settings')}
      />

      {/* Tesla integration redirect cluster + Fleet API link card were removed
          on web in favour of the Integrations side-nav group; nothing to port. */}

      <GeneralSettings />
      <AppearanceSettings />
      {/* Helix (AI) was promoted out of /settings to /integrations/helix on web;
          the legacy `/settings#ai` hash redirect is browser-only (documented in
          nativeSettingsPageCapabilities + SETTINGS_AI_REDIRECT_ROUTE_ID). */}
      <AdvancedSettings />
      <SectionPlaceholder section="Reset to defaults" />

      {/* Data Export — link card */}
      <FadeIn delay={0.18}>
        <Pressable
          accessibilityRole="link"
          onPress={onNavigate ? handleOpenDataExport : undefined}
          style={({ pressed }) => [pressed && styles.cardPressed]}
        >
          <GlassPanel style={styles.card}>
            <SemanticIcon decorative name="download" size="md" />
            <View style={styles.cardCopy}>
              <AppText weight="semibold">
                {t('export.title', 'Data Export')}
              </AppText>
              <AppText tone="muted" variant="caption">
                {t(
                  'export.subtitle',
                  'Export drives, charging, analytics, or full backup as CSV/JSON',
                )}
              </AppText>
            </View>
            <SemanticIcon decorative name="externalLink" size="sm" />
          </GlassPanel>
        </Pressable>
      </FadeIn>

      {/* Onboarding Tour */}
      <FadeIn delay={0.2}>
        <GlassPanel style={styles.card}>
          <SemanticIcon decorative name="play" size="md" />
          <View style={styles.cardCopy}>
            <AppText weight="semibold">
              {t('tour.title', 'Onboarding Tour')}
            </AppText>
            <AppText tone="muted" variant="caption">
              {t(
                'tour.description',
                'Re-run the guided walkthrough of TeslaSync features',
              )}
            </AppText>
          </View>
          <GhostButton
            iconName="play"
            label={t('tour.restart', 'Open Tour Launcher')}
            onPress={handleOpenTourLauncher}
          />
        </GlassPanel>
      </FadeIn>

      {/* Setup Checklist — restart affordance */}
      <FadeIn delay={0.22}>
        <GlassPanel style={styles.card}>
          <SemanticIcon decorative name="sparkles" size="md" />
          <View style={styles.cardCopy}>
            <AppText weight="semibold">
              {t('checklist.settings.title', 'Setup Checklist')}
            </AppText>
            <AppText tone="muted" variant="caption">
              {t(
                'checklist.settings.description',
                'Restart the first-run checklist widget on your dashboard. If you removed it, re-add the “Setup Checklist” widget from the dashboard customizer.',
              )}
            </AppText>
          </View>
          <GhostButton
            iconName="sparkles"
            label={t('checklist.settings.restart', 'Restart Checklist')}
            onPress={handleRestartChecklist}
          />
        </GlassPanel>
      </FadeIn>
    </PageContainerView>
  );
}

SettingsPage.displayName = 'SettingsPage';

const styles = StyleSheet.create({
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    flexGrow: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageBody: {
    gap: spacing.lg,
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  placeholderPanel: {
    gap: spacing.xs,
    padding: spacing.lg,
  },
  placeholderKicker: {
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  card: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  cardCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  cardPressed: {
    opacity: 0.82,
  },
  ghostButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ghostButtonPressed: {
    opacity: 0.82,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
});
