// Native parity port of web/src/components/feedback/ChangelogModal.tsx.
//
// Mounts at the app root and surfaces "what's new since last visit". Two
// activation paths are preserved from the web component:
//
//   1. Auto-show — fires once per 24h when the user has unseen entries AND has
//      finished onboarding AND no tour is currently active. Stamps lastShownAt
//      on display so the throttle takes effect even if the user dismisses
//      without acknowledging.
//
//   2. Manual open — listens for the OPEN_CHANGELOG_MODAL_EVENT broadcast.
//      Fired by the command palette ("What's new"), the footer status-bar
//      version segment, and any other surface that needs to pop the modal
//      imperatively.
//
// Closing via "Got it" marks the latest version as seen (so the unseen-dot
// disappears across the app). Closing via backdrop / hardware-back leaves the
// seen-version untouched but stamps the throttle.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - The web `@/hooks/useChangelog` hook persists seen/last-shown state in
//     localStorage and cross-syncs browser tabs via the `storage` event.
//     Native has neither, so the acknowledgement store below keeps an
//     in-process snapshot with the same public contract; cross-restart
//     persistence is intentionally unavailable here.
//   - The imperative `window` CustomEvent bus is replaced by a module-level
//     listener set (openChangelogModal -> subscribeOpenChangelog).
//   - The `document.querySelector('[data-tour-active]')` tour probe has no DOM
//     equivalent; isTourOverlayActive() is inert (always "no active tour").
//   - `window.open(...)` becomes Linking.openURL(...).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';
import {
  CHANGELOG,
  LATEST_VERSION,
  type ChangelogBadge,
  type ChangelogChangeType,
  type ChangelogEntry,
} from '../../generated/changelog';

// ── i18n fallback ────────────────────────────────────────────────────────────
// The web component uses react-i18next's t(key, fallback, options); native
// renders the fallback copy directly and interpolates {{count}} so visual and
// i18n intent are preserved without bundling the web i18n runtime.

type TranslationOptions = {count?: number};

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: TranslationOptions,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, options) => {
    if (!options) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = options[name as keyof TranslationOptions];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

// ── Native-safe changelog acknowledgement store ──────────────────────────────

const AUTO_SHOW_THROTTLE_MS = 24 * 60 * 60 * 1000;

interface ChangelogState {
  seenVersion: string | null;
  lastShownAt: number | null;
}

let storeState: ChangelogState = {seenVersion: null, lastShownAt: null};
// Native-safe stand-in for the web `teslasync-onboarded` localStorage flag.
let onboardingCompleted = false;
const storeListeners = new Set<() => void>();

function getChangelogSnapshot(): ChangelogState {
  return storeState;
}

function subscribeChangelog(callback: () => void): () => void {
  storeListeners.add(callback);
  return () => {
    storeListeners.delete(callback);
  };
}

function notifyChangelog(): void {
  for (const callback of storeListeners) {
    callback();
  }
}

function writeSeenVersion(version: string | null): void {
  storeState = {...storeState, seenVersion: version};
  notifyChangelog();
}

function writeLastShownAt(timestamp: number | null): void {
  storeState = {...storeState, lastShownAt: timestamp};
  notifyChangelog();
}

/** Record that the user has finished onboarding (native auto-show gate). */
export function setChangelogOnboardingCompleted(completed: boolean): void {
  onboardingCompleted = completed;
  notifyChangelog();
}

/**
 * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Pre-release tags sort BEFORE the release ("1.0.0-beta.1" < "1.0.0").
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  if (a === b) {
    return 0;
  }
  const parse = (
    v: string,
  ): {core: [number, number, number]; pre: string | null} | null => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+](.+))?$/);
    if (!match) {
      return null;
    }
    return {
      core: [Number(match[1]), Number(match[2]), Number(match[3])],
      pre: match[4] ?? null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) {
      return pa.core[i] < pb.core[i] ? -1 : 1;
    }
  }
  if (pa.pre === null && pb.pre !== null) {
    return 1;
  }
  if (pa.pre !== null && pb.pre === null) {
    return -1;
  }
  if (pa.pre === null && pb.pre === null) {
    return 0;
  }
  return (pa.pre as string) < (pb.pre as string)
    ? -1
    : (pa.pre as string) > (pb.pre as string)
      ? 1
      : 0;
}

export interface UseChangelogResult {
  /** All releases (newest first) — re-export of the generated CHANGELOG. */
  entries: readonly ChangelogEntry[];
  /** Topmost version, e.g. "0.7.0". */
  latestVersion: string;
  /** Highest version the user has acknowledged, or null if never seen. */
  seenVersion: string | null;
  /** True when latestVersion > seenVersion (or seenVersion is null). */
  hasUnseen: boolean;
  /** Entries that shipped after seenVersion (or all if first visit). */
  newEntries: readonly ChangelogEntry[];
  /** Mark the current latest as seen and stamp the auto-show throttle. */
  markSeen: () => void;
  /** Stamp the auto-show throttle WITHOUT marking seen (manual open). */
  stampShown: () => void;
  /** True when enough time has passed since the last auto-show. */
  canAutoShow: boolean;
  /** True if the user has finished onboarding at least once. */
  hasCompletedOnboarding: boolean;
}

export function useChangelog(): UseChangelogResult {
  const state = useSyncExternalStore(
    subscribeChangelog,
    getChangelogSnapshot,
    getChangelogSnapshot,
  );

  const newEntries = useMemo<readonly ChangelogEntry[]>(() => {
    if (!state.seenVersion) {
      return CHANGELOG;
    }
    return CHANGELOG.filter(
      e => compareVersions(e.version, state.seenVersion as string) > 0,
    );
  }, [state.seenVersion]);

  const hasUnseen = newEntries.length > 0;

  const canAutoShow = useMemo(() => {
    if (!hasUnseen) {
      return false;
    }
    if (state.lastShownAt == null) {
      return true;
    }
    return Date.now() - state.lastShownAt >= AUTO_SHOW_THROTTLE_MS;
  }, [hasUnseen, state.lastShownAt]);

  const hasCompletedOnboarding = onboardingCompleted;

  const markSeen = useCallback(() => {
    writeSeenVersion(LATEST_VERSION);
    writeLastShownAt(Date.now());
  }, []);

  const stampShown = useCallback(() => {
    writeLastShownAt(Date.now());
  }, []);

  return {
    entries: CHANGELOG,
    latestVersion: LATEST_VERSION,
    seenVersion: state.seenVersion,
    hasUnseen,
    newEntries,
    markSeen,
    stampShown,
    canAutoShow,
    hasCompletedOnboarding,
  };
}

// ── Imperative-open bus (native replacement for the window CustomEvent) ───────

/** Identifier kept for parity with the web custom-event contract. */
export const OPEN_CHANGELOG_MODAL_EVENT = 'teslasync:changelog:open';

const openListeners = new Set<() => void>();

/** Pop the modal imperatively (command palette, version segment, etc). */
export function openChangelogModal(): void {
  for (const callback of openListeners) {
    callback();
  }
}

function subscribeOpenChangelog(callback: () => void): () => void {
  openListeners.add(callback);
  return () => {
    openListeners.delete(callback);
  };
}

// Native has no DOM tour overlay, so the web `[data-tour-active]` probe is
// inert here and always reports "no active tour" (the safe default).
function isTourOverlayActive(): boolean {
  return false;
}

const AUTO_SHOW_DELAY_MS = 2_000;

export function ChangelogModal() {
  const t = useNativeTranslationFallback();
  const {
    entries,
    newEntries,
    hasUnseen,
    canAutoShow,
    hasCompletedOnboarding,
    markSeen,
    stampShown,
  } = useChangelog();

  const [open, setOpen] = useState(false);
  // Track whether the user explicitly acknowledged the modal so the close
  // handler knows whether to write the seen-version stamp.
  const [acknowledged, setAcknowledged] = useState(false);

  // Auto-show on app boot once the gating predicate flips true. The 2s settle
  // delay mirrors the web tour-settle window before evaluating eligibility.
  useEffect(() => {
    if (open) {
      return;
    }
    if (!hasUnseen) {
      return;
    }
    if (!hasCompletedOnboarding) {
      return;
    }
    if (!canAutoShow) {
      return;
    }
    const timer = setTimeout(() => {
      // Re-check at fire time — anything could have changed since schedule.
      if (isTourOverlayActive()) {
        return;
      }
      setOpen(true);
      setAcknowledged(false);
      stampShown();
    }, AUTO_SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, hasUnseen, hasCompletedOnboarding, canAutoShow, stampShown]);

  // Imperative-open via the global broadcast.
  useEffect(() => {
    const handler = () => {
      setOpen(true);
      setAcknowledged(false);
      stampShown();
    };
    return subscribeOpenChangelog(handler);
  }, [stampShown]);

  const handleClose = () => {
    if (acknowledged) {
      markSeen();
    }
    setOpen(false);
    setAcknowledged(false);
  };

  const handleGotIt = () => {
    setAcknowledged(true);
    // Mark seen synchronously so the unseen-dot clears even if state batching
    // delays the close-effect by a frame.
    markSeen();
    setOpen(false);
  };

  const handleViewFull = () => {
    setAcknowledged(true);
    markSeen();
    setOpen(false);
    Linking.openURL('https://github.com/ev-dev-labs/teslasync/releases').catch(
      () => undefined,
    );
  };

  // The list shown inside the modal is the unseen subset when there is one;
  // first-time visitors (seenVersion === null) will see the entire history,
  // which is also the right onboarding behaviour.
  const visibleEntries: readonly ChangelogEntry[] =
    newEntries.length > 0 ? newEntries : entries;
  const isFirstVisit = newEntries.length === entries.length;

  const title = t('changelog.modal.title', "What's new in TeslaSync");

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={open}>
      <View
        accessibilityViewIsModal
        accessibilityLabel={title}
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={handleClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="changelog-modal">
          <View style={styles.header}>
            <AppText style={styles.title} variant="title" weight="bold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel={t('changelog.modal.close', 'Close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={handleClose}
              style={({pressed}) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
              testID="changelog-modal-close">
              <AppText style={styles.closeGlyph} tone="muted">
                {'\u00d7'}
              </AppText>
            </Pressable>
          </View>

          {isFirstVisit ? (
            <AppText style={styles.subtitle} tone="muted">
              {t(
                'changelog.modal.subtitleFirstVisit',
                "Welcome! Here's a quick tour of what TeslaSync ships with right now.",
              )}
            </AppText>
          ) : (
            <AppText style={styles.subtitle} tone="muted">
              {t(
                'changelog.modal.subtitleSinceLastVisit',
                '{{count}} new release(s) since your last visit.',
                {count: visibleEntries.length},
              )}
            </AppText>
          )}

          <ScrollView
            contentContainerStyle={styles.entryListContent}
            style={styles.entryList}>
            {visibleEntries.map((entry, idx) => (
              <ChangelogModalEntry
                defaultOpen={idx < 2}
                entry={entry}
                key={entry.version}
              />
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <FooterButton
              label={t('changelog.modal.viewFull', 'View full changelog')}
              onPress={handleViewFull}
              testID="changelog-view-full"
              variant="ghost"
            />
            <FooterButton
              label={t('changelog.modal.gotIt', 'Got it')}
              onPress={handleGotIt}
              testID="changelog-got-it"
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

ChangelogModal.displayName = 'ChangelogModal';

// ── Internal: footer action button ───────────────────────────────────────────

function FooterButton({
  label,
  onPress,
  testID,
  variant,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'ghost' | 'primary';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.footerButton,
        variant === 'primary' ? styles.footerPrimary : styles.footerGhost,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={
          variant === 'primary'
            ? styles.footerPrimaryText
            : styles.footerGhostText
        }
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ── Internal: collapsible entry ──────────────────────────────────────────────

const SECTION_ORDER: readonly ChangelogChangeType[] = [
  'added',
  'changed',
  'fixed',
  'removed',
  'deprecated',
  'security',
];

const SECTION_KEY: Record<ChangelogChangeType, string> = {
  added: 'changelog.sections.added',
  changed: 'changelog.sections.changed',
  fixed: 'changelog.sections.fixed',
  removed: 'changelog.sections.removed',
  deprecated: 'changelog.sections.deprecated',
  security: 'changelog.sections.security',
};

const SECTION_FALLBACK: Record<ChangelogChangeType, string> = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed',
  removed: 'Removed',
  deprecated: 'Deprecated',
  security: 'Security',
};

// Toned-down semantic dots, mirroring the web bg-{emerald,cyan,amber,rose,
// purple}-400/70 mapping onto the native palette.
const SECTION_DOT: Record<ChangelogChangeType, string> = {
  added: colors.success,
  changed: colors.accent,
  fixed: colors.warning,
  removed: colors.danger,
  deprecated: colors.violet,
  security: colors.danger,
};

type BadgePalette = {background: string; border: string; text: string};

// Mirrors the web BADGE_VARIANT mapping (latest=success, stable=info,
// beta=warning) onto native chip colours.
const BADGE_PALETTE: Record<ChangelogBadge, BadgePalette> = {
  latest: {
    background: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  stable: {
    background: colors.accentSoft,
    border: colors.borderAccent,
    text: colors.accent,
  },
  beta: {
    background: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
};

const BADGE_KEY: Record<ChangelogBadge, string> = {
  latest: 'changelog.badges.latest',
  stable: 'changelog.badges.stable',
  beta: 'changelog.badges.beta',
};

const BADGE_FALLBACK: Record<ChangelogBadge, string> = {
  latest: 'Latest',
  stable: 'Stable',
  beta: 'Beta',
};

interface EntryProps {
  entry: ChangelogEntry;
  defaultOpen: boolean;
}

function ChangelogModalEntry({entry, defaultOpen}: EntryProps) {
  const t = useNativeTranslationFallback();
  const [expanded, setExpanded] = useState(defaultOpen);

  // Group changes by canonical type. The generator already emits them in
  // section order, but we re-group here so empty sections don't render.
  const grouped = SECTION_ORDER.map(type => ({
    type,
    items: entry.changes.filter(c => c.type === type),
  })).filter(g => g.items.length > 0);

  const badgePalette = BADGE_PALETTE[entry.badge];

  return (
    <View style={styles.entryCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded}}
        onPress={() => setExpanded(v => !v)}
        style={({pressed}) => [
          styles.entryHeader,
          pressed && styles.entryHeaderPressed,
        ]}
        testID={`changelog-entry-${entry.version}`}>
        <View style={styles.entryHeaderLeft}>
          <AppText style={styles.entryVersion} weight="semibold">
            v{entry.version}
          </AppText>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: badgePalette.background,
                borderColor: badgePalette.border,
              },
            ]}>
            <AppText
              style={[styles.badgeText, {color: badgePalette.text}]}
              variant="caption"
              weight="semibold">
              {t(BADGE_KEY[entry.badge], BADGE_FALLBACK[entry.badge])}
            </AppText>
          </View>
          <AppText numberOfLines={1} style={styles.entryDate} tone="muted">
            {entry.date}
          </AppText>
        </View>
        <AppText style={styles.entryChevron} tone="muted">
          {expanded ? '\u25be' : '\u25b8'}
        </AppText>
      </Pressable>

      {expanded ? (
        <View style={styles.entryBody}>
          {grouped.map(group => (
            <View key={group.type} style={styles.section}>
              <AppText
                style={styles.sectionLabel}
                variant="caption"
                weight="semibold">
                {t(SECTION_KEY[group.type], SECTION_FALLBACK[group.type])}
              </AppText>
              <View style={styles.sectionItems}>
                {group.items.map((item, i) => (
                  <View key={i} style={styles.itemRow}>
                    <View
                      style={[
                        styles.itemDot,
                        {backgroundColor: SECTION_DOT[group.type]},
                      ]}
                    />
                    <AppText style={styles.itemText} tone="secondary">
                      {item.text}
                    </AppText>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  closeButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  closeGlyph: {
    fontSize: 22,
    lineHeight: 24,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxHeight: '86%',
    maxWidth: 640,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  entryBody: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  entryCard: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  entryChevron: {
    fontSize: typography.caption,
  },
  entryDate: {
    flexShrink: 1,
    fontSize: typography.caption,
  },
  entryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  entryHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  entryHeaderPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  entryList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  entryListContent: {
    paddingRight: spacing.xs,
  },
  entryVersion: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: typography.body,
  },
  footer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.md,
  },
  footerButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  footerGhost: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  footerGhostText: {
    color: colors.textPrimary,
  },
  footerPrimary: {
    backgroundColor: colors.accent,
  },
  footerPrimaryText: {
    color: colors.background,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  itemDot: {
    borderRadius: 999,
    height: 6,
    marginTop: 7,
    width: 6,
  },
  itemRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  itemText: {
    flex: 1,
    fontSize: typography.body,
    lineHeight: 22,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  section: {
    gap: spacing.xs,
  },
  sectionItems: {
    gap: spacing.xs,
  },
  sectionLabel: {
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontSize: typography.body,
    lineHeight: 22,
  },
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
});
