// Native parity port of web/src/features/settings/pages/SafetyPage.tsx.
//
// SafetyPage is the Helix safety-setting explainer host page. It renders the
// deterministic, AI-OFF-safe listing of every safety-related TeslaSync setting
// (notification quiet hours, alert digest mode, critical-flash signalling,
// tab-badge signalling, and the API-suspended operational gate) with each
// setting's current value and a short plain-English explanation. The listing is
// rendered from `useSettings()` — no AI is required to view it, and the page
// works fully when `ai_mode='off'`. Above the listing, the opt-in
// `<AISafetySettingExplainer>` panel renders ONLY when the user has enabled the
// `safety-setting-explainer` feature; in off mode the panel is absent from the
// tree entirely (ADR-015 §I5 hidden UI). The AI panel NEVER changes settings —
// to update a value the user follows the docs link below each row.
//
// The web original leans on browser-only infrastructure that has no native
// analogue, so — following the established conversion idiom (GlancePage /
// GeneralSettings) — every such dependency is reproduced with React Native
// primitives + the shared native building blocks and documented in the sidecar:
//
//   - react-i18next `useTranslation` is not wired in native; i18next returns the
//     supplied default when a translation is missing, so a native English-default
//     `t(key, fallback)` keeps every safetySettings.* key verbatim. No call site
//     uses interpolation.
//   - usePageTitle(title) sets document.title — no native analogue — so it is
//     dropped; the same translated title renders in the on-screen header.
//   - @/components/layout PageContainer (title + subtitle scaffold) is inlined as
//     a ScrollView + header (title + subtitle), preserving the exact strings.
//   - @/components/ui GlassPanel -> the already-ported native GlassPanel (bordered
//     glass surface). The web usage passed no `padding` prop; native adds card
//     padding so the listing does not clip the rounded border (the established
//     native GlassPanel idiom). @/components/ui Badge variant="info" size="sm" ->
//     a local info chip (rounded-full, blue tint + blue-200 text) preserving the
//     value testID.
//   - @/components/motion FadeIn (framer-motion) renders at its rest state (a
//     plain View) — the established native idiom, no entrance animation.
//   - @/components/ai AISafetySettingExplainer is the already-converted native
//     component and is imported unchanged (it gates itself on ai_mode + the
//     per-feature flag exactly like the web wrapper, rendering null when off).
//   - The DOM `<a href target="_blank">` docs link has no native analogue; it
//     becomes a Pressable (accessibilityRole="link") whose onPress opens the
//     anchor via Linking.openURL. The relative `/docs/...` anchors are resolved
//     against getApiBase() so a tap forms an absolute URL on device.
//   - Tailwind utility classes + CSS custom properties (var(--text-primary/
//     secondary/muted), text-cyan-300, divide-white/5) resolve to StyleSheet
//     styles against the native theme tokens; the responsive
//     `sm:grid-cols-[1fr_auto]` row renders as the phone-breakpoint single
//     stacked column (title block, then docs link).
//
// SAFETY_ROWS (the deterministic hard-coded listing), the renderValue logic, the
// section order, and every snake_case field read + testID are preserved. The
// useSettings hook is read as `{data: settings}` (native TanStack Query shape)
// and every renderValue is null-safe for the loading (`settings === undefined`)
// window. No DOM, react-i18next, framer-motion, Recharts, Leaflet, or old web UI
// components are imported.

import React from 'react';
import {Linking, Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {getApiBase} from '../../../api/client';
import {useSettings, type AppSettings} from '../../../api/hooks/useSettings';
import {AISafetySettingExplainer} from '../../../components/ai/AISafetySettingExplainer';

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every safetySettings.* key verbatim. No call site interpolates.
function t(_key: string, fallback: string): string {
  return fallback;
}

// The web docs link is an `<a href="/docs/...">`; on native we resolve the
// relative anchor against the API base so Linking.openURL has an absolute URL.
function resolveDocsUrl(anchor: string): string {
  if (/^https?:\/\//i.test(anchor)) {
    return anchor;
  }
  const base = getApiBase().replace(/\/+$/, '');
  return `${base}${anchor.startsWith('/') ? '' : '/'}${anchor}`;
}

// SafetySettingRow describes one row in the deterministic listing. The listing
// is hard-coded at module scope so the page renders the same set of safety
// toggles across users (the per-install live values come from `useSettings()` at
// render time). Keeping the metadata (title / description / docsAnchor) here
// matches the AI tool's projection in
// `internal/api/ai_safety_setting_explainer_handler.go` so human reviewers can
// cross-check the two surfaces in code review.
interface SafetySettingRow {
  /** i18n key for the row's title (English fallback supplied). */
  titleKey: string;
  titleFallback: string;
  /** i18n key for the row's plain-English description. */
  descKey: string;
  descFallback: string;
  /** Documentation link the user can open to read more. */
  docsAnchor: string;
  /** Renders the current value as a string for the badge. */
  renderValue: (s: AppSettings | undefined) => string;
}

// Safety-related settings ordered to mirror the
// `internal/api/ai_safety_setting_explainer_handler.go`
// `projectSafetySettingsEnvelope` projection. The SET of settings MUST stay
// identical so the off-mode static-help surface lists everything Helix would
// explain on-mode.
const SAFETY_ROWS: SafetySettingRow[] = [
  {
    titleKey: 'safetySettings.rows.quietHoursEnabled.title',
    titleFallback: 'Quiet hours',
    descKey: 'safetySettings.rows.quietHoursEnabled.description',
    descFallback:
      'When ON, TeslaSync defers non-critical notifications during the configured quiet-hours window. Critical alerts are always delivered.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    renderValue: s => (s?.quiet_hours_enabled ? 'On' : 'Off'),
  },
  {
    titleKey: 'safetySettings.rows.quietHoursStart.title',
    titleFallback: 'Quiet-hours window start',
    descKey: 'safetySettings.rows.quietHoursStart.description',
    descFallback:
      'Window start in HH:MM (24-hour) local time. Effective only when quiet hours are ON.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    renderValue: s => s?.quiet_hours_start ?? '—',
  },
  {
    titleKey: 'safetySettings.rows.quietHoursEnd.title',
    titleFallback: 'Quiet-hours window end',
    descKey: 'safetySettings.rows.quietHoursEnd.description',
    descFallback:
      'Window end in HH:MM (24-hour) local time. Effective only when quiet hours are ON.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    renderValue: s => s?.quiet_hours_end ?? '—',
  },
  {
    titleKey: 'safetySettings.rows.alertDigestMode.title',
    titleFallback: 'Alert digest mode',
    descKey: 'safetySettings.rows.alertDigestMode.description',
    descFallback:
      'How alerts are batched. Instant delivers each alert as it fires; Hourly batches into one digest per hour; Daily batches into one digest per day.',
    docsAnchor: '/docs/notifications/digest.md',
    renderValue: s => s?.alert_digest_mode ?? 'instant',
  },
  {
    titleKey: 'safetySettings.rows.criticalFlashEnabled.title',
    titleFallback: 'Critical-alert tab flash',
    descKey: 'safetySettings.rows.criticalFlashEnabled.description',
    descFallback:
      'When ON, TeslaSync briefly flashes the browser tab title when a critical alert arrives while the tab is in the background. Honours the OS-level reduce-motion preference.',
    docsAnchor: '/docs/notifications/tab-signalling.md',
    renderValue: s => (s?.critical_flash_enabled ? 'On' : 'Off'),
  },
  {
    titleKey: 'safetySettings.rows.tabBadgeEnabled.title',
    titleFallback: 'Unread tab badge',
    descKey: 'safetySettings.rows.tabBadgeEnabled.description',
    descFallback:
      'When ON, TeslaSync prefixes the browser tab title with (N) and paints a coloured dot on the favicon for unread notifications.',
    docsAnchor: '/docs/notifications/tab-signalling.md',
    renderValue: s => (s?.tab_badge_enabled ? 'On' : 'Off'),
  },
  {
    titleKey: 'safetySettings.rows.apiSuspended.title',
    titleFallback: 'API kill-switch',
    descKey: 'safetySettings.rows.apiSuspended.description',
    descFallback:
      'Operational kill-switch. When ON, TeslaSync stops issuing requests to the Tesla Fleet API; existing telemetry streams continue. Used during outage triage so the install does not pile up rate-limited retries.',
    docsAnchor: '/docs/operations/api-suspended.md',
    renderValue: s => (s?.api_suspended ? 'Suspended' : 'Active'),
  },
];

interface SafetyRowItemProps {
  row: SafetySettingRow;
  settings: AppSettings | undefined;
  divided: boolean;
}

function SafetyRowItem({row, settings, divided}: SafetyRowItemProps) {
  const value = row.renderValue(settings);
  const onOpenDocs = () => {
    void Linking.openURL(resolveDocsUrl(row.docsAnchor)).catch(() => undefined);
  };

  return (
    <View
      style={[styles.row, divided && styles.rowDivided]}
      testID={`safety-settings-row-${row.titleKey}`}>
      <View style={styles.rowMain}>
        <View style={styles.rowTitleLine}>
          <AppText style={styles.rowTitle} weight="semibold">
            {t(row.titleKey, row.titleFallback)}
          </AppText>
          <View
            style={styles.badge}
            testID={`safety-settings-value-${row.titleKey}`}>
            <AppText style={styles.badgeText} weight="semibold">
              {value}
            </AppText>
          </View>
        </View>
        <AppText style={styles.rowDesc}>
          {t(row.descKey, row.descFallback)}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="link"
        onPress={onOpenDocs}
        style={styles.docsLink}
        testID={`safety-settings-docs-${row.titleKey}`}>
        <AppText style={styles.docsLinkText} weight="semibold">
          {t('safetySettings.listing.docsLink', 'Docs')}
        </AppText>
      </Pressable>
    </View>
  );
}

export default function SafetyPage() {
  // usePageTitle(t('safetySettings.pageTitle')) sets document.title on web — no
  // native analogue, so the same translated title renders in the header below.
  const pageTitle = t('safetySettings.pageTitle', 'Safety settings');
  const {data: settings} = useSettings();

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={styles.screen}
      testID="safety-page">
      {/* PageContainer title + subtitle scaffold, inlined. */}
      <View style={styles.header}>
        <AppText variant="title" weight="bold">
          {pageTitle}
        </AppText>
        <AppText style={styles.subtitle}>
          {t(
            'safetySettings.pageSubtitle',
            'Notification quiet hours, alert digest mode, critical-flash signalling, tab-badge signalling, and the API kill-switch. Use the links below each row to change a value.',
          )}
        </AppText>
      </View>

      {/* FadeIn -> rest state. Absent from the tree when AI is off. */}
      <View style={styles.section}>
        <AISafetySettingExplainer />
      </View>

      {/* FadeIn -> rest state. */}
      <View style={styles.section}>
        <GlassPanel style={styles.panel} testID="safety-settings-listing">
          <View style={styles.listingBody}>
            <View style={styles.listingHeader}>
              <AppText style={styles.listingTitle} weight="semibold">
                {t(
                  'safetySettings.listing.title',
                  'Your safety-related settings',
                )}
              </AppText>
              <AppText style={styles.listingSubtitle}>
                {t(
                  'safetySettings.listing.subtitle',
                  'Each row shows the current value on this install and links to the canonical Settings page where you can change it.',
                )}
              </AppText>
            </View>

            <View style={styles.rows} testID="safety-settings-rows">
              {SAFETY_ROWS.map((row, index) => (
                <SafetyRowItem
                  divided={index > 0}
                  key={row.titleKey}
                  row={row}
                  settings={settings}
                />
              ))}
            </View>

            <AppText style={styles.changeHint}>
              {t(
                'safetySettings.listing.changeHint',
                'To change a value, open the main Settings page. This page is read-only and never changes a setting on its own.',
              )}
            </AppText>
          </View>
        </GlassPanel>
      </View>
    </ScrollView>
  );
}

// Resolved palette. The web uses Tailwind tokens / CSS vars; native carries the
// literal hexes / token references so the visual intent survives without
// Tailwind.
const DIVIDE_WHITE_5 = 'rgba(255, 255, 255, 0.05)'; // divide-white/5
const BADGE_INFO_BG = 'rgba(30, 58, 138, 0.55)'; // bg-blue-900 (info, on glass)
const BADGE_INFO_BORDER = 'rgba(96, 165, 250, 0.32)'; // blue-400/32 outline
const BADGE_INFO_TEXT = '#bfdbfe'; // text-blue-200
const CYAN_300 = '#67e8f9'; // text-cyan-300 (docs link)

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  section: {
    width: '100%',
  },
  panel: {
    padding: spacing.lg,
  },
  listingBody: {
    gap: spacing.md,
  },
  listingHeader: {
    gap: spacing.xs,
  },
  listingTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  listingSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  rows: {
    width: '100%',
  },
  row: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DIVIDE_WHITE_5,
  },
  rowMain: {
    gap: spacing.xs,
  },
  rowTitleLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BADGE_INFO_BORDER,
    backgroundColor: BADGE_INFO_BG,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
    color: BADGE_INFO_TEXT,
  },
  rowDesc: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  docsLink: {
    alignSelf: 'flex-start',
  },
  docsLinkText: {
    fontSize: 12,
    lineHeight: 16,
    color: CYAN_300,
  },
  changeHint: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    paddingTop: spacing.xs,
  },
});
