// Native parity port of web/src/features/settings/components/NotificationSettings.tsx.
//
// The web component (source L18-244) is the Settings → notifications panel. It
// has four stacked sections inside a GlassPanel:
//   1. Browser notifications header + permission flow (source L69-130): an
//      "Enable" Button when permission is 'default', an "Enabled" Badge when
//      'granted', a "blocked" hint when 'denied', and — once granted — the
//      per-event push Toggles (alerts / export completions).
//   2. Browser-tab signals (source L132-151): tab_badge_enabled +
//      critical_flash_enabled Toggles persisted through the settings API.
//   3. Notification sounds (source L153-240): a master Toggle, an autoplay
//      hint, a per-category Toggle + Test Button grid, and a volume Slider.
//   4. The categoryFallback() label helper (source L246-263).
//
// Native-safe translation of every browser-only dependency (documented in the
// .parity.json sidecar):
//   - react-i18next `useTranslation('settings')` (source L2,19): the native app
//     has no i18next runtime, so this uses the established native-safe
//     `useNativeTranslationFallback` shim — `t(key, default, params?)` returns
//     the English default with `{{token}}` interpolation (the NotificationChannelsView
//     / AIRestorePanel precedent). Every translation key + intent is preserved.
//   - `@/components/ui` `GlassPanel` (source L3): the existing native primitive.
//     `IconBox` (source L3): the native parity port. `Button` / `Badge` /
//     `Toggle` / `Slider` (source L3): no native parity ports exist yet, so
//     minimal native-safe equivalents are reproduced locally (the
//     NotificationChannelsView precedent). The web `Toggle` becomes a Pressable
//     switch; `Slider` becomes a −/＋ stepper over a filled track (no
//     `@react-native-community/slider` dependency, the SmartChargePage precedent).
//   - `@/components/motion` `FadeIn` (source L4): no native port; rendered as a
//     plain View wrapper (delay ignored — reduced-motion final state), matching
//     the NotificationChannelsView FadeIn stand-in.
//   - `@/hooks/useWebPush` (source L5): the browser Notification API + Web Push
//     (VAPID / service workers) do not exist in React Native, so it is
//     reproduced locally as an explicit "unavailable" hook (isSupported:false,
//     permission:'denied', no-op requestPermission) — contract rule 7. The panel
//     therefore renders the "not supported" message exactly as a browser without
//     Notification support would.
//   - `@/hooks/useNotificationListener` (source L6): its SSE listener + browser
//     Notification firing are browser-only; the native stand-in keeps only the
//     `{ prefs, setPrefs }` WebPushPreferences contract (in-memory, no
//     localStorage). `WebPushPreferences` is preserved verbatim.
//   - `@/api/hooks/useSettings` `useSettings` / `useSaveSettings` (source L7):
//     imported from the native parity hooks mirror (already ported).
//   - `@/lib/notificationSound` (source L8-14): the per-channel sound prefs store
//     is reproduced locally as an in-memory reactive store (useSyncExternalStore)
//     preserving NOTIFICATION_SOUND_CATEGORIES, NotificationSoundCategory, the
//     prefs shape/defaults, useNotificationSoundPrefs, and the partial-patch
//     setNotificationSoundPrefs semantics. localStorage persistence is dropped
//     (no Web Storage on native — documented). `playNotificationSound` keeps the
//     web's early-return guard ordering but the WebAudio AudioContext is
//     unavailable on native, so a successful play resolves to
//     `{ played:false, reason:'no_audio_context' }` — which is exactly what
//     handleTestSound branches on (source L48-50) to keep the autoplay hint up.
//   - `@/lib/cn` `cn()` (source L15): Tailwind class merging is meaningless on
//     RN; the one conditional class (`!master && 'opacity-60'`, source L194)
//     becomes a conditional StyleSheet style.
//   - `lucide-react` `Bell` / `Volume2` / `Play` (source L16): RN has no lucide;
//     rendered as decorative AppText glyphs (the sibling-port convention).

import React, {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {IconBox} from '../../../components/ui/IconBox';
import {Caption, Label, PanelTitle, Text} from '../../../components/ui/Typography';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useSettings,
  useSaveSettings,
  type AppSettings,
} from '../../../api/hooks/useSettings';

/* ── resolved Tailwind colours behind the web classes ── */
const DIVIDER = 'rgba(255, 255, 255, 0.06)'; // border-white/[0.06]
const CATEGORY_BORDER = 'rgba(255, 255, 255, 0.04)'; // border-white/[0.04]
const AMBER_300_80 = 'rgba(252, 211, 77, 0.8)'; // text-amber-300/80

/* ── decorative glyphs (lucide-react icon stand-ins, source L16) ── */
const BELL_GLYPH = '\uD83D\uDD14'; // 🔔 Bell
const VOLUME_GLYPH = '\uD83D\uDD0A'; // 🔊 Volume2
const PLAY_GLYPH = '\u25B6'; // ▶ Play

/* ── native translation fallback (native-safe port of react-i18next, source L2,19) ── */
type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValue: string,
  params?: NativeTParams,
) => string;

function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback<NativeTFunction>(
    (_key, defaultValue, params) => interpolate(defaultValue, params),
    [],
  );
}

/* ── native-safe useWebPush (web @/hooks/useWebPush, source L5,20) ── */
// The browser Notification API + Web Push (PushManager / service workers) have
// no React Native equivalent and no native push module is wired up, so the
// honest native state is "unsupported": permission stays 'denied' and
// requestPermission is a no-op. Only the `permission` / `requestPermission` /
// `isSupported` surface used by this component is reproduced.
type NotificationPermission = 'default' | 'granted' | 'denied';

interface NativeWebPush {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  isSupported: boolean;
}

function useWebPush(): NativeWebPush {
  const requestPermission = useCallback(
    async (): Promise<NotificationPermission> => 'denied',
    [],
  );
  return useMemo<NativeWebPush>(
    () => ({
      permission: 'denied' as NotificationPermission,
      requestPermission,
      isSupported: false,
    }),
    [requestPermission],
  );
}

/* ── native-safe useNotificationListener (web @/hooks/useNotificationListener, source L6,21) ── */
// The SSE subscription + browser Notification firing are browser-only. The
// native stand-in keeps only the `{ prefs, setPrefs }` WebPushPreferences
// contract this component consumes (source L21,114-122). localStorage
// persistence is dropped — state is in-memory for the session.
export interface WebPushPreferences {
  alerts: boolean;
  exportStatus: boolean;
}

const DEFAULT_WEB_PUSH_PREFS: WebPushPreferences = {
  alerts: true,
  exportStatus: true,
};

type WebPushPrefsUpdater =
  | WebPushPreferences
  | ((prev: WebPushPreferences) => WebPushPreferences);

function useNotificationListener(): {
  prefs: WebPushPreferences;
  setPrefs: (next: WebPushPrefsUpdater) => void;
} {
  const [prefs, setPrefsState] = useState<WebPushPreferences>(
    DEFAULT_WEB_PUSH_PREFS,
  );
  const setPrefs = useCallback((next: WebPushPrefsUpdater) => {
    setPrefsState(prev => (typeof next === 'function' ? next(prev) : next));
  }, []);
  return {prefs, setPrefs};
}

/* ── native-safe notification-sound store (web @/lib/notificationSound, source L8-14) ── */

export const NOTIFICATION_SOUND_CATEGORIES = [
  'critical_alert',
  'warning_alert',
  'info_alert',
  'charge_complete',
  'drive_complete',
  'automation_run',
  'achievement',
] as const;

export type NotificationSoundCategory =
  (typeof NOTIFICATION_SOUND_CATEGORIES)[number];

interface NotificationSoundPrefs {
  master: boolean;
  perCategory: Record<NotificationSoundCategory, boolean>;
  volume: number;
}

const DEFAULT_NOTIFICATION_SOUND_PREFS: NotificationSoundPrefs = {
  master: false,
  perCategory: {
    critical_alert: true,
    warning_alert: true,
    info_alert: false,
    charge_complete: true,
    drive_complete: false,
    automation_run: false,
    achievement: false,
  },
  volume: 0.6,
};

// Web `clamp` helper (source notificationSound L60-65) ported verbatim.
function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) {
    return min;
  }
  if (n < min) {
    return min;
  }
  if (n > max) {
    return max;
  }
  return n;
}

function perCategoryEqual(
  a: NotificationSoundPrefs['perCategory'],
  b: NotificationSoundPrefs['perCategory'],
): boolean {
  for (const category of NOTIFICATION_SOUND_CATEGORIES) {
    if (a[category] !== b[category]) {
      return false;
    }
  }
  return true;
}

interface NotificationSoundPrefsPatch {
  master?: boolean;
  volume?: number;
  perCategory?: Partial<NotificationSoundPrefs['perCategory']>;
}

// Module-level reactive store. Mirrors the web useSyncExternalStore store but
// without the localStorage/window `storage`-event layer (no Web Storage on
// native): state lives in-memory and notifies mounted hooks on every patch.
let cachedSoundPrefs: NotificationSoundPrefs = DEFAULT_NOTIFICATION_SOUND_PREFS;
const soundListeners = new Set<() => void>();

function getSoundSnapshot(): NotificationSoundPrefs {
  return cachedSoundPrefs;
}

function subscribeSound(cb: () => void): () => void {
  soundListeners.add(cb);
  return () => {
    soundListeners.delete(cb);
  };
}

// Imperatively patch sound prefs (web setNotificationSoundPrefs, source
// notificationSound L170-195): partial updates, `perCategory` merges shallowly,
// volume is clamped to [0,1], and an unchanged patch skips the notify so
// getSnapshot keeps returning a referentially-stable value.
export function setNotificationSoundPrefs(
  patch: NotificationSoundPrefsPatch,
): void {
  const nextPerCategory = patch.perCategory
    ? {...cachedSoundPrefs.perCategory, ...patch.perCategory}
    : cachedSoundPrefs.perCategory;
  const next: NotificationSoundPrefs = {
    master:
      typeof patch.master === 'boolean'
        ? patch.master
        : cachedSoundPrefs.master,
    perCategory: nextPerCategory,
    volume:
      typeof patch.volume === 'number'
        ? clamp(patch.volume, 0, 1)
        : cachedSoundPrefs.volume,
  };
  const unchanged =
    next.master === cachedSoundPrefs.master &&
    next.volume === cachedSoundPrefs.volume &&
    perCategoryEqual(next.perCategory, cachedSoundPrefs.perCategory);
  if (unchanged) {
    return;
  }
  cachedSoundPrefs = next;
  for (const cb of soundListeners) {
    cb();
  }
}

export function useNotificationSoundPrefs(): NotificationSoundPrefs {
  return useSyncExternalStore(
    subscribeSound,
    getSoundSnapshot,
    getSoundSnapshot,
  );
}

interface PlayResult {
  played: boolean;
  reason?:
    | 'master_off'
    | 'category_off'
    | 'unknown_category'
    | 'no_audio_context'
    | 'volume_zero'
    | 'play_failed';
}

// Native-safe playNotificationSound (web source notificationSound L364-406).
// The pref-gate ordering is preserved so callers branch identically, but the
// WebAudio AudioContext does not exist on React Native — a play that the web
// would have performed resolves to `no_audio_context` instead. handleTestSound
// (source L48-50) relies on exactly this reason to keep the autoplay hint up.
function playNotificationSound(
  category: NotificationSoundCategory,
  prefs: NotificationSoundPrefs,
): PlayResult {
  if (!prefs.master) {
    return {played: false, reason: 'master_off'};
  }
  if (!prefs.perCategory[category]) {
    return {played: false, reason: 'category_off'};
  }
  if (clamp(prefs.volume, 0, 1) <= 0) {
    return {played: false, reason: 'volume_zero'};
  }
  return {played: false, reason: 'no_audio_context'};
}

/* ── native FadeIn stand-in (web @/components/motion FadeIn, source L4,67) ── */
function FadeIn({
  children,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

/* ── native Badge stand-in (web @/components/ui Badge, source L3,96) ── */
function Badge({children, testID}: {children: React.ReactNode; testID?: string}) {
  return (
    <View style={styles.badge} testID={testID}>
      <AppText style={styles.badgeText} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ── native Button stand-in (web @/components/ui Button, source L3,87,210) ── */
function Button({
  variant = 'primary',
  size = 'md',
  glyph,
  onPress,
  children,
  accessibilityLabel,
  testID,
}: {
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
  glyph?: string;
  onPress: () => void;
  children: React.ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : styles.buttonMd,
        variant === 'primary' ? styles.buttonPrimary : styles.buttonGhost,
        pressed && styles.buttonPressed,
      ]}
      testID={testID}>
      {glyph ? (
        <AppText
          style={[
            styles.buttonGlyph,
            variant === 'primary' ? styles.buttonPrimaryText : styles.buttonGhostText,
          ]}>
          {glyph}
        </AppText>
      ) : null}
      <AppText
        style={
          variant === 'primary' ? styles.buttonPrimaryText : styles.buttonGhostText
        }
        weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

/* ── native Toggle stand-in (web @/components/ui Toggle, source L3,112) ── */
function Toggle({
  label,
  checked,
  onChange,
  style,
  testID,
}: {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked}}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={[styles.toggleRow, style]}
      testID={testID}>
      <View style={[styles.toggleTrack, checked && styles.toggleTrackOn]}>
        <View style={[styles.toggleThumb, checked && styles.toggleThumbOn]} />
      </View>
      {label != null ? (
        <AppText style={styles.toggleLabel}>{label}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ── native Slider stand-in (web @/components/ui Slider — stepper reduction, source L3,229) ── */
// No `@react-native-community/slider` dependency, so the range control becomes
// −/＋ steppers over a filled track. label/min/max/step/value/onChange/
// formatValue/disabled are preserved (the SmartChargePage precedent).
function clampStep(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  const clamped = Math.min(max, Math.max(min, value));
  const stepped = Math.round((clamped - min) / step) * step + min;
  return Math.min(max, Math.max(min, stepped));
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
  disabled = false,
  testID,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (n: number) => string;
  disabled?: boolean;
  testID?: string;
}) {
  const display = formatValue ? formatValue(value) : String(value);
  const fillPct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const atMin = disabled || value <= min;
  const atMax = disabled || value >= max;

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityState={{disabled}}
      accessibilityValue={{text: display}}
      style={styles.sliderField}
      testID={testID}>
      <View style={styles.sliderLabelRow}>
        <Text color="secondary" size="sm">
          {label}
        </Text>
        <AppText style={styles.sliderValue}>{display}</AppText>
      </View>
      <View style={styles.sliderRow}>
        <Pressable
          accessibilityLabel={`Decrease ${label}`}
          accessibilityRole="button"
          disabled={atMin}
          hitSlop={6}
          onPress={() => onChange(clampStep(value - step, min, max, step))}
          style={[styles.stepButton, atMin && styles.stepButtonDisabled]}
          testID={testID ? `${testID}-dec` : undefined}>
          <AppText style={styles.stepButtonText}>{'\u2212'}</AppText>
        </Pressable>
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, {width: `${fillPct}%`}]} />
        </View>
        <Pressable
          accessibilityLabel={`Increase ${label}`}
          accessibilityRole="button"
          disabled={atMax}
          hitSlop={6}
          onPress={() => onChange(clampStep(value + step, min, max, step))}
          style={[styles.stepButton, atMax && styles.stepButtonDisabled]}
          testID={testID ? `${testID}-inc` : undefined}>
          <AppText style={styles.stepButtonText}>{'+'}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

export function NotificationSettings() {
  const t = useNativeTranslationFallback();
  const {
    permission,
    requestPermission,
    isSupported: notificationsSupported,
  } = useWebPush();
  const {prefs: pushPrefs, setPrefs: setPushPrefs} = useNotificationListener();
  const {data: settings} = useSettings();
  const saveSettings = useSaveSettings();
  const soundPrefs = useNotificationSoundPrefs();
  const [autoplayHintDismissed, setAutoplayHintDismissed] = useState(false);

  // Default toggles to ON when the field is missing from the response
  // (e.g. very old DBs without the seeded rows). This matches the
  // backend `settingsDefaults()` and the frontend `defaults` constant.
  const tabBadgeEnabled = settings?.tab_badge_enabled !== false;
  const criticalFlashEnabled = settings?.critical_flash_enabled !== false;

  const updateTabSetting = (
    key: 'tab_badge_enabled' | 'critical_flash_enabled',
    value: boolean,
  ) => {
    if (!settings) {
      return;
    }
    // Send the full settings object so the server-side full-replace
    // upsert does not zero-value any unrelated fields.
    saveSettings.mutate({...(settings as AppSettings), [key]: value});
  };

  const handleTestSound = (category: NotificationSoundCategory) => {
    // Force a play even if master is off — the test button is itself a
    // user gesture and serves as the primary way to verify the cue.
    const result = playNotificationSound(category, {
      master: true,
      perCategory: {...soundPrefs.perCategory, [category]: true},
      volume: soundPrefs.volume <= 0 ? 0.5 : soundPrefs.volume,
    });
    if (!result.played && result.reason === 'no_audio_context') {
      setAutoplayHintDismissed(false);
    }
  };

  const handleMasterToggle = (next: boolean) => {
    setNotificationSoundPrefs({master: next});
    if (next) {
      // First master-on toggle counts as a user gesture; pre-create the
      // AudioContext so the very next SSE-driven cue is allowed to play.
      playNotificationSound('info_alert', {
        master: true,
        perCategory: {...soundPrefs.perCategory, info_alert: true},
        volume: 0,
      });
    }
  };

  return (
    <FadeIn delay={0.13}>
      <GlassPanel style={styles.card} testID="settings-notifications">
        <View style={styles.headerRow}>
          <IconBox color="cyan">{BELL_GLYPH}</IconBox>
          <View style={styles.headerText}>
            <PanelTitle>
              {t('browserNotifications.title', 'Browser Notifications')}
            </PanelTitle>
            <Caption>
              {t(
                'browserNotifications.subtitle',
                'Get notified when the app tab is in the background',
              )}
            </Caption>
          </View>
        </View>

        {!notificationsSupported ? (
          <Caption testID="browser-notifications-unsupported">
            {t(
              'browserNotifications.unsupported',
              'Browser notifications are not supported in this browser.',
            )}
          </Caption>
        ) : (
          <View style={styles.sectionGap4}>
            <View style={styles.permissionRow}>
              {permission === 'default' && (
                <Button
                  glyph={BELL_GLYPH}
                  onPress={requestPermission}
                  variant="primary">
                  {t(
                    'browserNotifications.enable',
                    'Enable Browser Notifications',
                  )}
                </Button>
              )}
              {permission === 'granted' && (
                <Badge testID="browser-notifications-enabled">
                  {t('browserNotifications.enabled', 'Enabled')}
                </Badge>
              )}
              {permission === 'denied' && (
                <Caption>
                  {t(
                    'browserNotifications.blocked',
                    'Notifications are blocked. Enable in your browser settings.',
                  )}
                </Caption>
              )}
            </View>

            {permission === 'granted' && (
              <View style={[styles.subSection, styles.sectionGap3]}>
                <Label>
                  {t('browserNotifications.events', 'Notify me about')}
                </Label>
                <Toggle
                  checked={pushPrefs.alerts}
                  label={t('browserNotifications.alerts', 'Alerts')}
                  onChange={checked =>
                    setPushPrefs((prev: WebPushPreferences) => ({
                      ...prev,
                      alerts: checked,
                    }))
                  }
                  size="sm"
                />
                <Toggle
                  checked={pushPrefs.exportStatus}
                  label={t(
                    'browserNotifications.exportStatus',
                    'Export completions',
                  )}
                  onChange={checked =>
                    setPushPrefs((prev: WebPushPreferences) => ({
                      ...prev,
                      exportStatus: checked,
                    }))
                  }
                  size="sm"
                />
                <Text color="muted" size="2xs">
                  {t(
                    'browserNotifications.hint',
                    'Notifications only fire when the app tab is in the background.',
                  )}
                </Text>
              </View>
            )}
          </View>
        )}

        <View style={[styles.section, styles.sectionGap3]}>
          <Label>{t('settings.tab.heading', 'Browser tab signals')}</Label>
          <Toggle
            checked={tabBadgeEnabled}
            label={t('settings.tab.badge', 'Show unread count in browser tab')}
            onChange={checked => updateTabSetting('tab_badge_enabled', checked)}
            size="sm"
            testID="tab-badge-toggle"
          />
          <Toggle
            checked={criticalFlashEnabled}
            label={t('settings.tab.flash', 'Flash tab title on critical alerts')}
            onChange={checked =>
              updateTabSetting('critical_flash_enabled', checked)
            }
            size="sm"
            testID="tab-flash-toggle"
          />
          <Text color="muted" size="2xs">
            {t(
              'settings.tab.hint',
              'Adds a "(N)" prefix and favicon dot when there are unread notifications. Critical alerts briefly flash "(!) ALERT" when the tab is in the background.',
            )}
          </Text>
        </View>

        <View
          style={[styles.section, styles.sectionGap4]}
          testID="notification-sounds">
          <View style={styles.headerRow}>
            <IconBox color="cyan">{VOLUME_GLYPH}</IconBox>
            <View style={styles.headerText}>
              <Text color="primary" size="sm" weight="semibold">
                {t('notificationSounds.title', 'Notification sounds')}
              </Text>
              <Caption>
                {t(
                  'notificationSounds.subtitle',
                  'Play a short cue when an alert or completion event arrives. Plays even while the tab is visible.',
                )}
              </Caption>
            </View>
          </View>

          <Toggle
            checked={soundPrefs.master}
            label={t('notificationSounds.master', 'Enable notification sounds')}
            onChange={handleMasterToggle}
            size="sm"
            testID="notification-sound-master"
          />

          {soundPrefs.master && !autoplayHintDismissed && (
            <AppText style={styles.autoplayHint}>
              {t(
                'notificationSounds.autoplayHint',
                'Some browsers require a click before audio is allowed. Use the Test buttons below once to authorise playback.',
              )}
            </AppText>
          )}

          <View style={styles.sectionGap2}>
            <Label>{t('notificationSounds.categoriesHeading', 'Channels')}</Label>
            <View style={styles.sectionGap2}>
              {NOTIFICATION_SOUND_CATEGORIES.map(category => (
                <View
                  key={category}
                  style={[
                    styles.categoryRow,
                    !soundPrefs.master && styles.categoryRowDisabled,
                  ]}
                  testID={`notification-sound-category-${category}`}>
                  <Toggle
                    checked={soundPrefs.perCategory[category]}
                    label={t(
                      `notificationSounds.category.${category}`,
                      categoryFallback(category),
                    )}
                    onChange={checked =>
                      setNotificationSoundPrefs({
                        perCategory: {[category]: checked},
                      })
                    }
                    size="sm"
                    style={styles.categoryToggle}
                    testID={`notification-sound-toggle-${category}`}
                  />
                  <Button
                    accessibilityLabel={t(
                      'notificationSounds.testAria',
                      'Test {{name}} sound',
                      {
                        name: t(
                          `notificationSounds.category.${category}`,
                          categoryFallback(category),
                        ),
                      },
                    )}
                    glyph={PLAY_GLYPH}
                    onPress={() => handleTestSound(category)}
                    size="sm"
                    testID={`notification-sound-test-${category}`}
                    variant="ghost">
                    {t('notificationSounds.test', 'Test')}
                  </Button>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.volumeRow}>
            <Slider
              disabled={!soundPrefs.master}
              formatValue={(n: number) => `${n}%`}
              label={t('notificationSounds.volume', 'Volume')}
              max={100}
              min={0}
              onChange={(next: number) =>
                setNotificationSoundPrefs({volume: next / 100})
              }
              step={5}
              testID="notification-sound-volume"
              value={Math.round(soundPrefs.volume * 100)}
            />
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

// Web categoryFallback (source L246-263): per-category default label used when
// the i18n key is absent. Ported verbatim.
function categoryFallback(category: NotificationSoundCategory): string {
  switch (category) {
    case 'critical_alert':
      return 'Critical alerts';
    case 'warning_alert':
      return 'Warning alerts';
    case 'info_alert':
      return 'Informational alerts';
    case 'charge_complete':
      return 'Charge complete';
    case 'drive_complete':
      return 'Drive complete';
    case 'automation_run':
      return 'Automation runs';
    case 'achievement':
      return 'Achievements';
  }
}

const styles = StyleSheet.create({
  autoplayHint: {
    color: AMBER_300_80,
    fontSize: 10,
    lineHeight: 14,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.success,
    fontSize: 12,
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  buttonGhostText: {
    color: colors.textPrimary,
  },
  buttonGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  buttonMd: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  buttonSm: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  card: {
    gap: spacing.lg,
    padding: 24,
  },
  categoryRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: CATEGORY_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryRowDisabled: {
    opacity: 0.6,
  },
  categoryToggle: {
    flex: 1,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  permissionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  section: {
    borderTopColor: DIVIDER,
    borderTopWidth: 1,
    paddingTop: 16,
  },
  sectionGap2: {
    gap: spacing.sm,
  },
  sectionGap3: {
    gap: spacing.md,
  },
  sectionGap4: {
    gap: 16,
  },
  sliderField: {
    gap: spacing.xs,
  },
  sliderFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 8,
  },
  sliderLabelRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  sliderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sliderTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 8,
    overflow: 'hidden',
  },
  sliderValue: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  stepButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  stepButtonText: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 20,
  },
  subSection: {
    borderTopColor: DIVIDER,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  toggleLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 14,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleThumb: {
    backgroundColor: colors.textMuted,
    borderRadius: 999,
    height: 14,
    width: 14,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  toggleTrack: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 36,
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  volumeRow: {
    paddingTop: spacing.xs,
  },
});
