// Native parity port of web/src/components/layout/status-bar/VersionSegment.tsx.
//
// The web source is a footer status-bar segment: a lucide <Tag> + version label
// (+ short git SHA) trigger button wrapped in a hover <Tooltip>, that opens a
// shared <Modal> ("About this build") with a <dl> of version provenance
// (app version, commit, Helm chart, Go runtime, platform, server uptime), an
// "update available" banner, and three actions — "What's new" (opens the
// changelog), "Release notes" (github.com/.../releases), and "Close". It pulls
// /system/version + /system/update-check via TanStack Query and folds in the
// localStorage-backed useChangelog() unseen-release state. Every browser-only
// piece is adapted to React Native primitives (see the parity sidecar for the
// full line-by-line mapping):
//   • useQuery(/system/version, /system/update-check) -> kept verbatim, but the
//     queryFn now calls the native request() client. Same queryKeys
//     ('version-info' / 'update-check'), staleTime, and refetchInterval.
//   • <Tooltip> (hover/focus popover)  -> the rich provenance string is folded
//                                          into the trigger's accessibilityHint
//                                          (React Native has no hover affordance).
//   • shared <Modal> (createPortal)    -> a React Native <Modal> overlay (renders
//                                          above everything, so no portal) with a
//                                          backdrop Pressable (tap-outside close),
//                                          a header (title + close ✕), and a
//                                          scrollable body. onRequestClose wires
//                                          Android-back / esc to close.
//   • window.open(releases, _blank)    -> Linking.openURL(sameUrl); native opens
//                                          the system browser.
//   • lucide-react Tag/X/ExternalLink/Sparkles -> decorative text glyphs (native
//                                          ships no SVG icon set): Tag 🏷, X ✕,
//                                          ExternalLink ↗, Sparkles ✨.
//   • import.meta.env.VITE_APP_VERSION / VITE_GIT_SHA -> globalThis-injected
//                                          TESLASYNC_APP_VERSION / TESLASYNC_GIT_SHA
//                                          (the native build-time injection hook),
//                                          each falling back to 'dev' — the same
//                                          resolution order as the web source.
//   • useChangelog() + openChangelogModal() -> BROWSER-ONLY (localStorage
//                                          seen-version tracking + a generated
//                                          CHANGELOG feed + a window CustomEvent
//                                          bus + a separate ChangelogModal that is
//                                          not part of the native app). Ported as a
//                                          native-safe inline useChangelog() that
//                                          reports an explicit empty/unavailable
//                                          state (hasUnseen=false, newEntries=[]),
//                                          so the unseen-release dot/hint code paths
//                                          are preserved verbatim and light up the
//                                          moment a native changelog feed exists.
//                                          openChangelogModal() becomes an injectable
//                                          onOpenChangelog?: () => void callback prop.
//   • react-i18next t()                -> an inline English-default t(key, fallback,
//                                          vars?) with {{var}} interpolation (no
//                                          i18next provider ships in native); all
//                                          keys + fallbacks preserved verbatim.
//   • cn() Tailwind classes            -> StyleSheet + theme tokens.
//
// Behavior, state names (open/versionInfo/updateCheck/appVersion/sha/
// updateAvailable/uptime/hasUnseen/newEntries), API paths, and the version
// resolution order are all preserved. No DOM modules, browser HTML elements,
// Recharts, Leaflet, or old web UI components are imported. No unit-suffixed
// fields or unit conversions are involved.

import React, {useCallback, useState} from 'react';
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import type {UpdateCheckResult, VersionInfo} from '../../../api/types';

/** Native parity ships no react-i18next provider; return the English default. */
function t(_key: string, fallback: string, vars?: Record<string, unknown>): string {
  if (vars) {
    return fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      name in vars ? String(vars[name]) : `{{${name}}}`,
    );
  }
  return fallback;
}

/** Text-glyph stand-ins for the lucide icons (native ships no SVG icon set). */
const GLYPH = {
  tag: '\uD83C\uDFF7', // Tag (label)
  close: '\u2715', // X
  externalLink: '\u2197', // ExternalLink (north-east arrow)
  sparkles: '\u2728', // Sparkles
} as const;

/** GitHub releases page the web "Release notes" button opens via window.open. */
const RELEASES_URL = 'https://github.com/ev-dev-labs/teslasync/releases';

// Native cross-platform monospace stack for the version-provenance values
// (the web source uses Tailwind's `font-mono`).
const MONO_FONT = Platform.select({
  ios: 'Courier',
  macos: 'Courier',
  default: 'monospace',
});

declare global {
  // Native build-time injection hook, the analog of the web's
  // import.meta.env.VITE_APP_VERSION / VITE_GIT_SHA. Left undefined in dev.
  // eslint-disable-next-line no-var
  var TESLASYNC_APP_VERSION: string | undefined;
  // eslint-disable-next-line no-var
  var TESLASYNC_GIT_SHA: string | undefined;
}

const BUILD_VERSION: string = globalThis.TESLASYNC_APP_VERSION || 'dev';
const BUILD_SHA: string = globalThis.TESLASYNC_GIT_SHA || 'dev';

/**
 * uptimeLabel — ported verbatim from the web source. Renders a coarse human
 * label ("3d 4h" / "4h 12m" / "9m") from a server-reported uptime in seconds,
 * or null for missing / non-finite / non-positive input.
 */
function uptimeLabel(seconds: number | undefined | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Native-safe analog of @/hooks/useChangelog.
 *
 * The web hook tracks the highest acknowledged changelog version in
 * localStorage and diffs it against a build-generated CHANGELOG feed to surface
 * "unseen release(s)". None of that exists in the native app: there is no DOM
 * localStorage, no generated changelog module, no cross-tab StorageEvent bus,
 * and no ChangelogModal. So this returns an explicit empty/unavailable state.
 * The unseen-release dot + tooltip-hint code paths in VersionSegment are kept
 * verbatim against this shape, so they light up unchanged the moment a native
 * changelog feed is wired in.
 */
interface NativeChangelogState {
  hasUnseen: boolean;
  newEntries: readonly unknown[];
}

function useChangelog(): NativeChangelogState {
  return {hasUnseen: false, newEntries: []};
}

interface VersionSegmentProps {
  iconOnly?: boolean;
  /**
   * Native analog of the web `openChangelogModal()` window-event dispatch. Fires
   * when the user taps "What's new"; the host wires it to a native changelog
   * surface. No-op if unwired.
   */
  onOpenChangelog?: () => void;
  /** Native composition hook replacing the web `className`. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * VersionSegment.
 *
 * Footer status-bar segment that surfaces the running app version + git SHA.
 * Tapping it opens a modal with full version provenance and (when available) an
 * "update available" hint linking to the changelog.
 *
 * Resolution order for the version label:
 *   1. `versionInfo.app_version` from `/system/version`      (server-truth)
 *   2. `globalThis.TESLASYNC_APP_VERSION` (build-time inject) (build-time)
 *   3. `'dev'`                                                (worst case)
 *
 * Resolution order for the short SHA:
 *   1. `globalThis.TESLASYNC_GIT_SHA` (build-time `git rev-parse --short HEAD`)
 *   2. `'dev'`
 */
export function VersionSegment({
  iconOnly = false,
  onOpenChangelog,
  style,
  testID,
}: VersionSegmentProps = {}) {
  const [open, setOpen] = useState(false);
  const {hasUnseen, newEntries} = useChangelog();

  const {data: versionInfo} = useQuery({
    queryKey: ['version-info'],
    queryFn: () => request<VersionInfo>('/system/version'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const {data: updateCheck} = useQuery({
    queryKey: ['update-check'],
    queryFn: () => request<UpdateCheckResult>('/system/update-check'),
    staleTime: 3_600_000,
    refetchInterval: 3_600_000,
  });

  const appVersion =
    (versionInfo?.app_version && versionInfo.app_version !== 'unknown'
      ? versionInfo.app_version
      : BUILD_VERSION) || 'dev';
  const sha = BUILD_SHA;
  const updateAvailable = !!updateCheck?.update_available;
  const uptime = uptimeLabel(versionInfo?.uptime_seconds);

  const close = useCallback(() => setOpen(false), []);

  const handleOpenChangelog = useCallback(() => {
    setOpen(false);
    onOpenChangelog?.();
  }, [onOpenChangelog]);

  const handleOpenReleases = useCallback(() => {
    void Linking.openURL(RELEASES_URL).catch(() => {
      // The system browser may be unavailable (e.g. a headless CI device);
      // swallow so a failed deep-link never crashes the status bar.
    });
  }, []);

  // The web hover-tooltip body, folded into a single accessibilityHint string
  // (React Native has no hover affordance): "TeslaSync version · v… · sha · up … · N new release(s)".
  const tooltip = [
    `${t('statusBar.version.tooltip', 'TeslaSync version')} \u00B7 v${appVersion}`,
    sha && sha !== 'dev' ? ` \u00B7 ${sha}` : '',
    uptime ? ` \u00B7 ${t('statusBar.version.uptime', 'up {{uptime}}', {uptime})}` : '',
    hasUnseen
      ? ` \u00B7 ${t('changelog.unseenHint', '{{count}} new release(s)', {
          count: newEntries.length,
        })}`
      : '',
  ].join('');

  const ariaLabel = `${t('statusBar.version.aria', 'TeslaSync version')}: v${appVersion}${
    sha && sha !== 'dev' ? ` (${sha})` : ''
  }${hasUnseen ? `, ${t('changelog.unseenAria', 'unseen changelog')}` : ''}`;

  return (
    <View style={[styles.root, style]} testID={testID ?? 'version-segment'}>
      <Pressable
        accessibilityHint={tooltip}
        accessibilityLabel={ariaLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.trigger, pressed && styles.triggerPressed]}
        testID="version-segment-trigger">
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.tagGlyph}>
          {GLYPH.tag}
        </AppText>
        {!iconOnly ? (
          <>
            <AppText
              style={styles.versionText}
              testID="version-segment-version-text"
              weight="semibold">
              v{appVersion}
            </AppText>
            {sha && sha !== 'dev' ? (
              <AppText style={styles.shaText}>{`\u00B7 ${sha}`}</AppText>
            ) : null}
            {updateAvailable ? (
              <View
                accessibilityLabel={t(
                  'statusBar.version.updateAvailable',
                  'Update available',
                )}
                style={[styles.dot, styles.dotUpdate]}
                testID="version-segment-update-dot"
              />
            ) : null}
            {hasUnseen && !updateAvailable ? (
              <View
                accessibilityLabel={t('changelog.unseenAria', 'unseen changelog')}
                style={[styles.dot, styles.dotUnseen]}
                testID="version-segment-unseen-dot"
              />
            ) : null}
          </>
        ) : null}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityElementsHidden
            accessibilityLabel={t('statusBar.version.close', 'Close')}
            importantForAccessibility="no-hide-descendants"
            onPress={close}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={t('statusBar.version.modalTitle', 'About this build')}
            accessibilityViewIsModal
            style={styles.panel}
            testID="version-segment-modal">
            <View style={styles.header}>
              <AppText numberOfLines={1} style={styles.modalTitle} weight="semibold">
                {t('statusBar.version.modalTitle', 'About this build')}
              </AppText>
              <Pressable
                accessibilityLabel={t('statusBar.version.close', 'Close')}
                accessibilityRole="button"
                onPress={close}
                style={({pressed}) => [
                  styles.closeButton,
                  pressed && styles.closeButtonPressed,
                ]}
                testID="version-segment-modal-close">
                <AppText style={styles.closeGlyph}>{GLYPH.close}</AppText>
              </Pressable>
            </View>

            <ScrollView
              bounces={false}
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}>
              <View style={styles.dl}>
                <ProvenanceRow
                  label={t('statusBar.version.appVersion', 'App version')}
                  value={`v${appVersion}`}
                  mono
                />
                <ProvenanceRow
                  label={t('statusBar.version.commit', 'Commit')}
                  value={sha}
                  mono
                />
                {versionInfo?.chart_version &&
                versionInfo.chart_version !== 'unknown' ? (
                  <ProvenanceRow
                    label={t('statusBar.version.chart', 'Helm chart')}
                    value={`v${versionInfo.chart_version}`}
                    mono
                  />
                ) : null}
                {versionInfo?.go_version ? (
                  <ProvenanceRow
                    label={t('statusBar.version.go', 'Go runtime')}
                    value={versionInfo.go_version}
                    mono
                  />
                ) : null}
                {versionInfo?.os || versionInfo?.arch ? (
                  <ProvenanceRow
                    label={t('statusBar.version.platform', 'Platform')}
                    value={[versionInfo?.os, versionInfo?.arch]
                      .filter(Boolean)
                      .join('/')}
                    mono
                  />
                ) : null}
                {uptime ? (
                  <ProvenanceRow
                    label={t('statusBar.version.uptimeLabel', 'Server uptime')}
                    value={uptime}
                  />
                ) : null}
              </View>

              {updateAvailable ? (
                <View style={styles.updateBanner} testID="version-segment-update-banner">
                  <AppText style={styles.updateBannerTitle} weight="semibold">
                    {t(
                      'statusBar.version.updateBanner',
                      'A newer release is available',
                    )}
                    {updateCheck?.latest ? `: v${updateCheck.latest}` : ''}
                  </AppText>
                  {updateCheck?.message ? (
                    <AppText style={styles.updateBannerMessage}>
                      {updateCheck.message}
                    </AppText>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.actions}>
                <ActionButton
                  glyph={GLYPH.sparkles}
                  label={t('changelog.openModal', "What's new")}
                  onPress={handleOpenChangelog}
                  showDot={hasUnseen}
                  testID="version-segment-whats-new"
                  variant="ghost"
                />
                <ActionButton
                  glyph={GLYPH.externalLink}
                  label={t('statusBar.version.changelog', 'Release notes')}
                  onPress={handleOpenReleases}
                  testID="version-segment-release-notes"
                  variant="ghost"
                />
                <ActionButton
                  glyph={GLYPH.close}
                  label={t('statusBar.version.close', 'Close')}
                  onPress={close}
                  testID="version-segment-close"
                  variant="primary"
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

VersionSegment.displayName = 'VersionSegment';

export default VersionSegment;

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

interface ProvenanceRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

/** One <dt>/<dd> pair from the web `<dl>` provenance grid. */
function ProvenanceRow({label, value, mono = false}: ProvenanceRowProps) {
  return (
    <View style={styles.dlRow}>
      <AppText style={styles.dlLabel}>{label}</AppText>
      <AppText style={[styles.dlValue, mono && styles.dlValueMono]}>{value}</AppText>
    </View>
  );
}

interface ActionButtonProps {
  glyph: string;
  label: string;
  onPress: () => void;
  variant: 'ghost' | 'primary';
  showDot?: boolean;
  testID?: string;
}

/**
 * One shared-<Button> action from the modal footer. Mirrors the web Button's
 * ghost/primary variants with a leading decorative glyph, the i18n label, and
 * (for "What's new") a trailing unseen-changelog dot.
 */
function ActionButton({
  glyph,
  label,
  onPress,
  variant,
  showDot = false,
  testID,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        variant === 'ghost' ? styles.actionGhost : styles.actionPrimary,
        pressed && styles.actionPressed,
      ]}
      testID={testID}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.actionGlyph,
          variant === 'ghost' ? styles.actionGhostText : styles.actionPrimaryText,
        ]}>
        {glyph}
      </AppText>
      <AppText
        style={variant === 'ghost' ? styles.actionGhostText : styles.actionPrimaryText}
        weight="semibold">
        {label}
      </AppText>
      {showDot ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.dot, styles.dotUnseen, styles.actionDot]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
  },
  trigger: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  triggerPressed: {
    backgroundColor: colors.surfaceHover,
  },
  tagGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
  },
  versionText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 13,
  },
  shaText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
  },
  dot: {
    borderRadius: 999,
    height: 6,
    marginLeft: 4,
    width: 6,
  },
  dotUpdate: {
    backgroundColor: colors.warning,
  },
  dotUnseen: {
    backgroundColor: '#22d3ee',
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 4, 9, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: '90%',
    maxWidth: 512,
    overflow: 'hidden',
    width: '100%',
    ...shadows.panel,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  modalTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  closeButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  closeGlyph: {
    color: colors.textSecondary,
    fontSize: 18,
    lineHeight: 22,
  },
  body: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  dl: {
    gap: spacing.sm,
  },
  dlRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  dlLabel: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    width: 120,
  },
  dlValue: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  dlValueMono: {
    fontFamily: MONO_FONT,
  },
  updateBanner: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
  },
  updateBannerTitle: {
    color: '#fde68a',
    fontSize: 14,
    lineHeight: 20,
  },
  updateBannerMessage: {
    color: 'rgba(254, 243, 199, 0.8)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 16,
  },
  actionGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  actionPrimary: {
    backgroundColor: colors.accent,
  },
  actionPressed: {
    opacity: 0.82,
  },
  actionGlyph: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionGhostText: {
    color: colors.textPrimary,
  },
  actionPrimaryText: {
    color: colors.background,
  },
  actionDot: {
    marginLeft: 0,
  },
});
