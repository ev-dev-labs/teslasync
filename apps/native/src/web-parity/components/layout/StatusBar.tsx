// Native parity port of web/src/components/layout/StatusBar.tsx.
//
// StatusBar is the always-on footer pinned to the bottom of the viewport with
// five consolidated status segments (API · Live telemetry · Active vehicle ·
// Background jobs · Version) plus a help cluster. This native port preserves the
// StatusBar's OWN responsibilities 1:1:
//   - prefs gate (`enabled` hides the whole bar; `iconOnly` forces compact),
//   - the responsive collapse rule `iconOnly = compact || prefs.iconOnly ||
//     isNarrow` keyed off the same `lg` (1024px) breakpoint Tailwind uses,
//   - the exact segment ordering and divider placement across the two clusters,
//   - the persisted, cross-surface-reactive preferences store built on
//     `useSyncExternalStore`, with `useStatusBarPrefs` / `setStatusBarPrefs`
//     keeping their public contract,
//   - the live-region accessibility intent (role="status" + aria-live="polite").
//
// Web-only pieces are reimplemented native-safe (rules 4/7):
//   - The six segment children live in `./status-bar/*` and are NOT yet ported,
//     each backed by its own data hook (useApiHealth, useLiveConnection,
//     useSelectedVehicle/useVehicleState/useUnits, useBackgroundJobs,
//     useChangelog) + react-router `<Link>` + lucide icons + the shared
//     `<Tooltip>`/`<Modal>`. Following the sibling NotionSidebar precedent
//     (re-derive locally when a child is unported), each segment is represented
//     here by a self-contained native-safe placeholder that keeps the segment's
//     slot, short-label i18n keys, `iconOnly` handling and conditional-visibility
//     contract, while its live data + navigation + modal belong to that file's
//     own future conversion. Placeholders render each segment's quiet default
//     state (Connection "Connecting…", Live "Idle"), and the two conditionally
//     hidden segments (Background work, Active vehicle) return null exactly as
//     the web does when there is no in-flight work / no fleet loaded.
//   - react-i18next `useTranslation` is absent from the native deps; a local
//     fallback `t` returns the inline English copy while referencing every i18n
//     key verbatim (statusBar.aria, statusBar.connection.*, statusBar.live.*,
//     statusBar.version.*, shortcuts.*, tour.launcher.*, feedback.*).
//   - react-router `<Link>` has no native router and StatusBar receives no nav
//     callback, so the status chips are inert indicators (destinations
//     /system-status, /signal-diff documented); the help/version affordances are
//     `<Pressable>`s that preserve the button role + accessible labels and, like
//     the sibling PageContainer CopyLinkButton, surface an explicit "unavailable
//     on this device" accessibilityHint on press since the underlying DOM
//     CustomEvent launchers / provenance Modal have no native analog.
//   - `@/lib/cn` Tailwind merging -> React Native StyleSheet. CSS vars map to
//     theme tokens (--glass-border -> colors.border, --surface-1 -> colors.surface,
//     --text-secondary -> textSecondary, --text-muted -> textMuted). `fixed` ->
//     position:'absolute'; z-[55] -> zIndex 55; backdrop-blur-xl has no native
//     analog and is omitted. The responsive `h-6 lg:h-7` / `bottom-14 lg:bottom-0`
//     / `px-3 lg:px-4` collapse to narrow/wide style variants off the same 1024px
//     breakpoint. The print-only `data-role`/`data-print-hide` hooks are web-only
//     and dropped.
//   - localStorage + the cross-tab `storage` event have no native analog; the
//     prefs store is in-memory by default and exposes an optional injectable
//     `StatusBarPrefsStorage` seam (+ `setStatusBarPrefsStorage`) so a host can
//     wire AsyncStorage/MMKV later — until then persistence is a documented no-op
//     while in-session reactive updates still apply, matching the web's
//     "change still applies in this tab session" fallback.

import React, {
  useCallback,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// The `lg` Tailwind breakpoint (1024px). At/above it the bar is the desktop
// variant (28px tall, pinned to the very bottom, expanded labels); below it the
// bar collapses to icon-only, sits above the mobile tab bar, and is shorter.
const LG_BREAKPOINT = 1024;

// Build-time version injection (VITE_APP_VERSION / VITE_GIT_SHA) is a web/Vite
// concern with no native analog; the placeholder falls back to 'dev' exactly as
// the web VersionSegment does in its worst case. Real provenance + update-check
// belong to that segment's own conversion.
const BUILD_VERSION = 'dev';

type NativeTFunction = (key: string, fallback: string) => string;

// React Native ships no react-i18next runtime; resolve to the inline English
// fallback while keeping every i18n key referenced at the call sites.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export interface StatusBarProps {
  /** Force every segment into its icon-only variant. */
  compact?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function StatusBar({
  compact = false,
  className: _className,
  style,
  testID,
}: StatusBarProps): ReactElement | null {
  const t = useNativeTranslationFallback();
  const prefs = useStatusBarPrefs();
  // Track viewport width so we can swap to icon-only on narrow screens, matching
  // the same `lg` (1024px) breakpoint the web bar uses.
  const isNarrow = useNarrowViewport();

  if (!prefs.enabled) {
    return null;
  }

  const iconOnly = compact || prefs.iconOnly || isNarrow;

  return (
    // role="status" + aria-live="polite" announce notable transitions
    // (offline <-> online) without interrupting other reading flow. RN has no
    // `contentinfo` landmark nor a `status` role; the live-region intent is
    // preserved via accessibilityLiveRegion + a toolbar role for the cluster of
    // controls.
    <View
      accessibilityLabel={t('statusBar.aria', 'Application status')}
      accessibilityLiveRegion="polite"
      accessibilityRole="toolbar"
      style={[styles.bar, isNarrow ? styles.barNarrow : styles.barWide, style]}
      testID={testID ?? 'status-bar'}>
      <View style={styles.cluster}>
        <ConnectionSegment iconOnly={iconOnly} />
        <Divider />
        <LiveTelemetrySegment iconOnly={iconOnly} />
      </View>
      <View style={styles.cluster}>
        <BackgroundWorkSegment iconOnly={iconOnly} />
        {/* Background work + active vehicle segments are conditional (they
            return null when there are no jobs / no fleet), so no dividers wrap
            them — matching the web layout that only renders dividers around
            unconditionally-present segments to keep the layout stable. */}
        <ActiveVehicleSegment iconOnly={iconOnly} />
        <Divider />
        <HelpSegment iconOnly={iconOnly} />
        <Divider />
        <VersionSegment iconOnly={iconOnly} />
      </View>
    </View>
  );
}

StatusBar.displayName = 'StatusBar';

function Divider(): ReactElement {
  return <View accessibilityElementsHidden style={styles.divider} />;
}

// ────────────────────────────────────────────────────────────────────────────
// Segment placeholders (native-safe stand-ins for the unported ./status-bar/*)
// ────────────────────────────────────────────────────────────────────────────

interface SegmentProps {
  iconOnly?: boolean;
}

/** Shared inert status chip: optional state dot + glyph + label. */
function StatusChip({
  accessibilityLabel,
  dot,
  glyph,
  iconOnly,
  label,
}: {
  accessibilityLabel: string;
  dot?: boolean;
  glyph: string;
  iconOnly: boolean;
  label: string;
}): ReactElement {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="text"
      accessible
      style={styles.chip}>
      {dot ? <View style={styles.dot} /> : null}
      <AppText style={styles.glyph} tone="muted">
        {glyph}
      </AppText>
      {iconOnly ? null : (
        <AppText style={styles.chipLabel} tone="muted" weight="semibold">
          {label}
        </AppText>
      )}
    </View>
  );
}

/**
 * API connection health. Web `<Link to="/system-status">` pings `/healthz`; the
 * native placeholder renders the quiet `unknown` ("Connecting…") default state
 * (muted dot + glyph + "API"), with live health + navigation owned by the
 * segment's own conversion.
 */
function ConnectionSegment({iconOnly = false}: SegmentProps): ReactElement {
  const t = useNativeTranslationFallback();
  return (
    <StatusChip
      accessibilityLabel={`${t(
        'statusBar.connection.aria',
        'API connection status',
      )}: ${t('statusBar.connection.unknown', 'Connecting…')}`}
      dot
      glyph="?"
      iconOnly={iconOnly}
      label={t('statusBar.connection.short', 'API')}
    />
  );
}

/**
 * Live telemetry (SSE/MQTT) freshness. Web `<Link to="/signal-diff">` mirrors
 * `<LiveIndicator>`; the placeholder renders the `unknown` ("Idle") default.
 */
function LiveTelemetrySegment({iconOnly = false}: SegmentProps): ReactElement {
  const t = useNativeTranslationFallback();
  return (
    <StatusChip
      accessibilityLabel={`${t(
        'statusBar.live.aria',
        'Live telemetry status',
      )}: ${t('statusBar.live.unknown', 'Idle')}`}
      dot
      glyph="≈"
      iconOnly={iconOnly}
      label={t('statusBar.live.unknown', 'Idle')}
    />
  );
}

/**
 * In-flight background work (CSV exports, settings saves, ad-hoc jobs). Web hides
 * this segment when nothing is running (`if (!hasJobs) return null`). Native has
 * no job source wired here, so it stays quiet by default — same null result.
 */
function BackgroundWorkSegment(_props: SegmentProps): ReactElement | null {
  return null;
}

/**
 * Active vehicle switcher. Web hides this when the fleet has 0 vehicles and
 * during the initial fleet-load. Native has no fleet source wired here, so it
 * returns null — matching the web's hidden state.
 */
function ActiveVehicleSegment(_props: SegmentProps): ReactElement | null {
  return null;
}

/**
 * Help cluster — keyboard shortcuts, tour launcher, bug report. Web dispatches
 * DOM CustomEvents (`toggle-keyboard-shortcuts`, tour launcher, `open-feedback-modal`)
 * which have no native analog; the affordances are preserved as inert buttons
 * that surface an "unavailable on this device" hint on press.
 */
function HelpSegment({iconOnly = false}: SegmentProps): ReactElement {
  const t = useNativeTranslationFallback();
  const hint = t('statusBar.help.unavailable', 'Unavailable on this device');
  return (
    <View style={styles.helpGroup}>
      <InertAction
        accessibilityLabel={t('shortcuts.openAria', 'Open keyboard shortcuts')}
        badge
        glyph="?"
        hint={hint}
        iconOnly={iconOnly}
      />
      <InertAction
        accessibilityLabel={t('tour.launcher.openAria', 'Open tour launcher')}
        glyph="ⓘ"
        hint={hint}
        iconOnly={iconOnly}
      />
      <InertAction
        accessibilityLabel={t(
          'feedback.openAria',
          'Open feedback / bug report form',
        )}
        glyph="⚑"
        hint={hint}
        iconOnly={iconOnly}
      />
    </View>
  );
}

/**
 * Running app version + git SHA. Web opens a provenance `<Modal>` with
 * update-check on click; native renders the version chip and surfaces an
 * "unavailable" hint on press (the modal/update-check belong to this segment's
 * own conversion). SHA falls back to 'dev' and is hidden exactly as the web does.
 */
function VersionSegment({iconOnly = false}: SegmentProps): ReactElement {
  const t = useNativeTranslationFallback();
  return (
    <InertAction
      accessibilityLabel={`${t('statusBar.version.aria', 'TeslaSync version')}: v${BUILD_VERSION}`}
      glyph="#"
      hint={t('statusBar.version.unavailable', 'Build details unavailable on this device')}
      iconOnly={iconOnly}
      text={`v${BUILD_VERSION}`}
    />
  );
}

/**
 * Native-safe inert affordance. Mirrors the sibling PageContainer CopyLinkButton:
 * the button role + accessible label are preserved, and pressing surfaces an
 * explicit "unavailable" accessibilityHint since the underlying web behaviour
 * (DOM CustomEvent / provenance modal) has no native analog.
 */
function InertAction({
  accessibilityLabel,
  badge = false,
  glyph,
  hint,
  iconOnly,
  text,
}: {
  accessibilityLabel: string;
  badge?: boolean;
  glyph: string;
  hint: string;
  iconOnly: boolean;
  text?: string;
}): ReactElement {
  const [notified, setNotified] = useState(false);
  const handlePress = useCallback(() => setNotified(true), []);

  return (
    <Pressable
      accessibilityHint={notified ? hint : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={handlePress}
      style={({pressed}) => [styles.action, pressed ? styles.actionPressed : null]}>
      {badge ? (
        <View style={styles.kbd}>
          <AppText style={styles.kbdText}>{glyph}</AppText>
        </View>
      ) : (
        <AppText style={styles.actionGlyph} tone="muted">
          {glyph}
        </AppText>
      )}
      {!iconOnly && text ? (
        <AppText style={styles.versionText} tone="secondary" weight="semibold">
          {text}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Viewport breakpoint hook
// ────────────────────────────────────────────────────────────────────────────

function useNarrowViewport(): boolean {
  const {width} = useWindowDimensions();
  // Web: matchMedia('(max-width: 1023px)') -> narrow when width < 1024.
  return width < LG_BREAKPOINT;
}

// ────────────────────────────────────────────────────────────────────────────
// Persisted preferences (in-memory store + optional injectable storage seam)
// ────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'teslasync-status-bar-prefs';

export interface StatusBarPrefs {
  /** Show the status bar at all. Defaults to `true`. */
  enabled: boolean;
  /** Force icon-only mode regardless of viewport width. Defaults to `false`. */
  iconOnly: boolean;
}

/**
 * Optional persistence backend. React Native has no localStorage and no
 * cross-tab `storage` event, so a host may inject an AsyncStorage/MMKV-style
 * seam to make preferences durable + shareable across surfaces. Until one is
 * provided the store is in-memory only and persistence is a documented no-op.
 */
export interface StatusBarPrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DEFAULTS: StatusBarPrefs = {enabled: true, iconOnly: false};

let prefsStorage: StatusBarPrefsStorage | null = null;

function readPrefs(): StatusBarPrefs {
  if (!prefsStorage) {
    return DEFAULTS;
  }
  try {
    const raw = prefsStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULTS;
    }
    const parsed = JSON.parse(raw) as Partial<StatusBarPrefs>;
    return {
      enabled:
        typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled,
      iconOnly:
        typeof parsed.iconOnly === 'boolean'
          ? parsed.iconOnly
          : DEFAULTS.iconOnly,
    };
  } catch {
    return DEFAULTS;
  }
}

let cachedPrefs: StatusBarPrefs = readPrefs();
const prefsListeners = new Set<() => void>();

function emitPrefs(): void {
  for (const fn of prefsListeners) {
    fn();
  }
}

function subscribePrefs(fn: () => void): () => void {
  prefsListeners.add(fn);
  return () => {
    prefsListeners.delete(fn);
  };
}

function getPrefsSnapshot(): StatusBarPrefs {
  return cachedPrefs;
}

/**
 * Wire (or clear) the native persistence backend. Re-hydrates the cached
 * preferences from the new store and notifies subscribers — the native analog
 * of the web's cross-tab `storage` event re-sync.
 */
export function setStatusBarPrefsStorage(
  storage: StatusBarPrefsStorage | null,
): void {
  prefsStorage = storage;
  cachedPrefs = readPrefs();
  emitPrefs();
}

/** Reactive read of the persisted status-bar preferences. */
export function useStatusBarPrefs(): StatusBarPrefs {
  return useSyncExternalStore(
    subscribePrefs,
    getPrefsSnapshot,
    getPrefsSnapshot,
  );
}

/** Update one or more preferences and persist them (no-op when no store wired). */
export function setStatusBarPrefs(next: Partial<StatusBarPrefs>): void {
  cachedPrefs = {...cachedPrefs, ...next};
  if (prefsStorage) {
    try {
      prefsStorage.setItem(STORAGE_KEY, JSON.stringify(cachedPrefs));
    } catch {
      // Storage unavailable — change still applies in this session.
    }
  }
  emitPrefs();
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  actionGlyph: {
    fontSize: 12,
    lineHeight: 14,
  },
  actionPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  bar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 55,
  },
  barNarrow: {
    bottom: 56,
    height: 24,
    paddingHorizontal: spacing.md,
  },
  barWide: {
    bottom: 0,
    height: 28,
    paddingHorizontal: 16,
  },
  chip: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipLabel: {
    fontSize: 11,
    lineHeight: 12,
  },
  cluster: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xs,
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    height: 12,
    width: 1,
  },
  dot: {
    backgroundColor: colors.textMuted,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  glyph: {
    fontSize: 11,
    lineHeight: 12,
  },
  helpGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  kbd: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 3,
    justifyContent: 'center',
    minWidth: 16,
    paddingHorizontal: 4,
  },
  kbdText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
  },
  versionText: {
    fontSize: 11,
    lineHeight: 12,
  },
});
