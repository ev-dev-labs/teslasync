// Native parity port of web/src/features/notifications/pages/BrowserNotificationsPage.tsx.
//
// The web module (24 lines) is a thin notifications page wrapper that promotes
// the browser/OS desktop push-notification setup surface to a first-class page:
// a <PageContainer title subtitle copyLink> whose only child is the shared
// <NotificationSettings /> component
// (web/src/features/settings/components/NotificationSettings.tsx).
//
// Native-safe substitutions (rule 5/7), documented in the parity sidecar:
//   • react-i18next useTranslation -> a local useTranslation(namespace?) whose
//     t(key, fallback?, vars?) returns the English fallback (the parity bundle
//     ships no i18n runtime), preserving every key + copy string verbatim with
//     {{token}} interpolation kept.
//   • usePageTitle(title) -> a native no-op hook (RN has no document.title); the
//     call site and its translated title key are preserved.
//   • The shared web <PageContainer> -> an inlined native PageContainer
//     (ScrollView + header title/subtitle/actions, then loading/error/empty/
//     children branch semantics), matching the GasPriceAutoPollPage port. The
//     web `copyLink` share affordance is accepted but not rendered: RN has no
//     document URL / clipboard-URL concept, so faking a "Copy link" action would
//     be dishonest (the AlertsScreen "no fake success" doctrine).
//   • The shared <NotificationSettings> sibling (its own web file, not yet
//     ported) -> an inlined, faithful native NotificationSettings (rule 7).
//   • useWebPush() -> a native hook reporting isSupported=false: React Native has
//     no window.Notification / Web Push API, so browser push is genuinely
//     unavailable. The component renders its own `browserNotifications.unsupported`
//     branch — honest parity, mirroring the AlertsScreen "native push registration
//     as unavailable, no fake success" evidence. The full permission state machine
//     + per-event push toggles are preserved in the JSX for source fidelity.
//   • useNotificationListener() -> a native in-memory WebPushPreferences store
//     (alerts/exportStatus). The web localStorage persistence + SSE→OS-Notification
//     side effect are browser-only and omitted (push is unavailable on native).
//   • @/lib/notificationSound -> an inlined native store: NOTIFICATION_SOUND_CATEGORIES,
//     useNotificationSoundPrefs/setNotificationSoundPrefs (in-memory useSyncExternalStore;
//     web localStorage + cross-tab `storage` events dropped — no RN equivalent),
//     and playNotificationSound which preserves the master→category→volume pref gate
//     then returns {played:false, reason:'no_audio_context'} (RN has no Web Audio
//     AudioContext). Tab signals (tab_badge_enabled / critical_flash_enabled) stay
//     FULLY functional via the ported useSettings/useSaveSettings.
//   • The shared <GlassPanel>/<IconBox>/<Button>/<Badge>/<Toggle>/<Slider> +
//     lucide Bell/Volume2/Play glyphs -> reused native GlassPanel/AppText/FadeIn +
//     inlined Button/Badge/Toggle(RN Switch)/Slider(stepped) + SemanticIcon
//     notifications/volume/play. All Tailwind className styling -> StyleSheet +
//     theme tokens. data-testid -> testID; data-tour dropped (no native equivalent).
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys). No DOM elements, react-i18next, lucide-react, framer-motion,
// Recharts, Leaflet, react-dom, or web UI-kit modules are imported here.

import React, {
  useCallback,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';

import {
  useSettings,
  useSaveSettings,
  type AppSettings,
} from '../../../api/hooks/useSettings';
import { FadeIn } from '../../../components/motion/FadeIn';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { colors, spacing } from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (web react-i18next useTranslation)                   */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number | null | undefined>;
type TOptions = TVars & { defaultValue?: string };
type TFunc = (key: string, arg2?: string | TOptions, arg3?: TVars) => string;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the `defaultValue`) while
// preserving every key at the call site. The namespace arg is accepted and
// ignored to keep the `useTranslation('settings')` call site verbatim.
function useTranslation(_namespace?: string): { t: TFunc } {
  const t = useCallback<TFunc>((key, arg2, arg3) => {
    let fallback = key;
    let vars: TVars | undefined;
    if (typeof arg2 === 'string') {
      fallback = arg2;
      vars = arg3;
    } else if (arg2 && typeof arg2 === 'object') {
      const { defaultValue, ...rest } = arg2;
      fallback = defaultValue ?? key;
      vars = rest as TVars;
    }
    return interpolate(fallback, vars);
  }, []);
  return { t };
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ------------------------------------------------------------------ */
/*  Inlined @/lib/notificationSound (per-channel notification audio)   */
/* ------------------------------------------------------------------ */

const NOTIFICATION_SOUND_CATEGORIES = [
  'critical_alert',
  'warning_alert',
  'info_alert',
  'charge_complete',
  'drive_complete',
  'automation_run',
  'achievement',
] as const;

type NotificationSoundCategory = (typeof NOTIFICATION_SOUND_CATEGORIES)[number];

interface NotificationSoundPrefs {
  /** Overall sound on/off. When false, every category is muted. */
  master: boolean;
  /** Per-category audio gate. */
  perCategory: Record<NotificationSoundCategory, boolean>;
  /** Output volume in [0, 1]. */
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

// Web persists prefs to localStorage and fans changes out across tabs via the
// `storage` event + useSyncExternalStore. RN has neither localStorage nor cross-
// tab storage events, so the store is in-memory for the session. The stable
// snapshot + listener-set semantics are preserved so useSyncExternalStore returns
// referentially-equal snapshots when nothing changed.
let cachedSoundPrefs: NotificationSoundPrefs = DEFAULT_NOTIFICATION_SOUND_PREFS;
let cachedSoundSerialized = JSON.stringify(cachedSoundPrefs);
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

function useNotificationSoundPrefs(): NotificationSoundPrefs {
  return useSyncExternalStore(
    subscribeSound,
    getSoundSnapshot,
    getSoundSnapshot,
  );
}

interface NotificationSoundPrefsPatch {
  master?: boolean;
  volume?: number;
  perCategory?: Partial<NotificationSoundPrefs['perCategory']>;
}

function setNotificationSoundPrefs(patch: NotificationSoundPrefsPatch): void {
  const nextPerCategory = patch.perCategory
    ? { ...cachedSoundPrefs.perCategory, ...patch.perCategory }
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
  const serialized = JSON.stringify(next);
  if (serialized === cachedSoundSerialized) {
    return;
  }
  cachedSoundPrefs = next;
  cachedSoundSerialized = serialized;
  for (const cb of soundListeners) {
    cb();
  }
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

// Web synthesises a short WebAudio cue per category. React Native has no Web
// Audio AudioContext, so playback is genuinely unavailable: we preserve the
// web pref gate (master -> category -> volume) and then return the same
// structured `no_audio_context` reason the web returns when no AudioContext can
// be resolved. Honest no-op — never plays, never throws.
function playNotificationSound(
  category: NotificationSoundCategory,
  prefs: NotificationSoundPrefs = cachedSoundPrefs,
): PlayResult {
  if (!prefs.master) {
    return { played: false, reason: 'master_off' };
  }
  if (!prefs.perCategory[category]) {
    return { played: false, reason: 'category_off' };
  }
  const volume = clamp(prefs.volume, 0, 1);
  if (volume <= 0) {
    return { played: false, reason: 'volume_zero' };
  }
  // No AudioContext in React Native -> cannot synthesise the cue.
  return { played: false, reason: 'no_audio_context' };
}

/* ------------------------------------------------------------------ */
/*  Inlined @/hooks/useWebPush (browser Notification permission)       */
/* ------------------------------------------------------------------ */

type NotificationPermission = 'default' | 'granted' | 'denied';

interface WebPushState {
  permission: NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  isSupported: boolean;
}

// React Native has no `window.Notification`, so `isSupported` is false (the web
// hook initialises `permission` to 'denied' when unsupported). The component
// renders its own `browserNotifications.unsupported` branch — matching the
// AlertsScreen "native push registration as unavailable, no fake success"
// doctrine. requestPermission resolves 'denied' and never prompts.
function useWebPush(): WebPushState {
  const requestPermission = useCallback(
    async (): Promise<NotificationPermission> => 'denied',
    [],
  );
  return { permission: 'denied', requestPermission, isSupported: false };
}

/* ------------------------------------------------------------------ */
/*  Inlined @/hooks/useNotificationListener (web-push preferences)     */
/* ------------------------------------------------------------------ */

interface WebPushPreferences {
  alerts: boolean;
  exportStatus: boolean;
}

const DEFAULT_PUSH_PREFS: WebPushPreferences = {
  alerts: true,
  exportStatus: true,
};

type PushPrefsUpdater =
  | WebPushPreferences
  | ((prev: WebPushPreferences) => WebPushPreferences);

// Web loads/saves prefs from localStorage and wires SSE listeners that fire OS
// browser Notifications when the tab is hidden. RN has neither localStorage nor
// the browser Notification API, so prefs are in-memory and the SSE->Notification
// side effect is omitted (push delivery is unavailable on native). The
// {prefs,setPrefs} surface the component consumes is preserved.
function useNotificationListener(): {
  prefs: WebPushPreferences;
  setPrefs: (next: PushPrefsUpdater) => void;
} {
  const [prefs, setPrefsState] =
    useState<WebPushPreferences>(DEFAULT_PUSH_PREFS);
  const setPrefs = useCallback((next: PushPrefsUpdater) => {
    setPrefsState(prev => (typeof next === 'function' ? next(prev) : next));
  }, []);
  return { prefs, setPrefs };
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Button                                     */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'ghost';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}

const BUTTON_TONES: Record<
  ButtonVariant,
  { bg: string; border: string; text: string }
> = {
  primary: {
    bg: colors.accent,
    border: colors.accent,
    text: colors.background,
  },
  ghost: {
    bg: 'transparent',
    border: colors.border,
    text: colors.textSecondary,
  },
};

function Button({
  variant = 'primary',
  icon,
  disabled,
  onClick,
  accessibilityLabel,
  children,
}: ButtonProps) {
  const tone = BUTTON_TONES[variant];
  const hasLabel = children != null && children !== false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onClick}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: tone.bg, borderColor: tone.border },
        disabled ? styles.btnDisabled : null,
        pressed && !disabled ? styles.btnPressed : null,
      ]}
    >
      {icon ? (
        <View style={hasLabel ? styles.btnIconWrap : null}>{icon}</View>
      ) : null}
      {hasLabel ? (
        <AppText
          style={[styles.btnText, { color: tone.text }]}
          weight="semibold"
        >
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge                                      */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'success' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

const BADGE_TONES: Record<
  BadgeVariant,
  { bg: string; border: string; text: string }
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
};

function Badge({ variant = 'neutral', children }: BadgeProps) {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone.bg, borderColor: tone.border },
      ]}
    >
      <AppText
        style={[styles.badgeText, { color: tone.text }]}
        weight="semibold"
      >
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Toggle (web checkbox -> RN Switch)         */
/* ------------------------------------------------------------------ */

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Web cosmetic size; accepted for call-site parity, no native scale. */
  size?: 'sm' | 'md';
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <View style={styles.toggleRow}>
      <AppText style={styles.toggleLabel}>{label}</AppText>
      <Switch
        accessibilityRole="switch"
        accessibilityLabel={label}
        value={checked}
        onValueChange={onChange}
        trackColor={{ false: colors.surfaceRaised, true: colors.accentSoft }}
        thumbColor={checked ? colors.accent : colors.textMuted}
        ios_backgroundColor={colors.surfaceRaised}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Slider (web range -> stepped native track) */
/* ------------------------------------------------------------------ */

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  formatValue?: (n: number) => string;
  disabled?: boolean;
}

// RN core ships no <Slider>; a stepped −/track/+ control faithfully reproduces
// the web range's contract (min/max/step/value/onChange/formatValue/disabled).
// The web volume slider is itself stepped (step=5), so this preserves intent.
function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
  disabled,
}: SliderProps) {
  const clampStep = (n: number): number => Math.min(max, Math.max(min, n));
  const pct = max > min ? ((clampStep(value) - min) / (max - min)) * 100 : 0;
  const display = formatValue ? formatValue(value) : String(value);
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={[styles.sliderRoot, disabled ? styles.sliderDisabled : null]}>
      <View style={styles.sliderHeader}>
        <AppText style={styles.fieldLabel} tone="muted">
          {label}
        </AppText>
        <AppText style={styles.sliderValue} weight="semibold">
          {display}
        </AppText>
      </View>
      <View style={styles.sliderControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} decrease`}
          disabled={disabled || atMin}
          onPress={() => onChange(clampStep(value - step))}
          style={({ pressed }) => [
            styles.sliderStep,
            disabled || atMin ? styles.sliderStepDisabled : null,
            pressed ? styles.btnPressed : null,
          ]}
        >
          <AppText style={styles.sliderStepText} weight="bold">
            −
          </AppText>
        </Pressable>
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, { width: `${pct}%` }]} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} increase`}
          disabled={disabled || atMax}
          onPress={() => onChange(clampStep(value + step))}
          style={({ pressed }) => [
            styles.sliderStep,
            disabled || atMax ? styles.sliderStepDisabled : null,
            pressed ? styles.btnPressed : null,
          ]}
        >
          <AppText style={styles.sliderStepText} weight="bold">
            +
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/layout PageContainer                          */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  /**
   * Web "Copy link" share affordance. Accepted for call-site parity; RN has no
   * document URL to copy, so no action is rendered (honest unavailability).
   */
  copyLink?: boolean;
  children: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  empty,
  emptyMessage,
  children,
}: PageContainerProps) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.pageLoading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.pageErrorBox}>
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : empty ? (
        <View style={styles.pageEmpty}>
          <AppText tone="muted" variant="caption">
            {emptyMessage ?? `No ${title.toLowerCase()} found.`}
          </AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined features/settings/components/NotificationSettings          */
/* ------------------------------------------------------------------ */

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

function NotificationSettings(): React.ReactElement {
  const { t } = useTranslation('settings');
  const {
    permission,
    requestPermission,
    isSupported: notificationsSupported,
  } = useWebPush();
  const { prefs: pushPrefs, setPrefs: setPushPrefs } =
    useNotificationListener();
  const { data: settings } = useSettings();
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
    saveSettings.mutate({ ...settings, [key]: value } as AppSettings);
  };

  const handleTestSound = (category: NotificationSoundCategory) => {
    // Force a play even if master is off — the test button is itself a
    // user gesture and serves as the primary way to verify the cue.
    const result = playNotificationSound(category, {
      master: true,
      perCategory: { ...soundPrefs.perCategory, [category]: true },
      volume: soundPrefs.volume <= 0 ? 0.5 : soundPrefs.volume,
    });
    if (!result.played && result.reason === 'no_audio_context') {
      setAutoplayHintDismissed(false);
    }
  };

  const handleMasterToggle = (next: boolean) => {
    setNotificationSoundPrefs({ master: next });
    if (next) {
      // First master-on toggle counts as a user gesture; pre-create the
      // AudioContext so the very next SSE-driven cue is allowed to play.
      playNotificationSound('info_alert', {
        master: true,
        perCategory: { ...soundPrefs.perCategory, info_alert: true },
        volume: 0,
      });
    }
  };

  return (
    <FadeIn delay={0.13}>
      <GlassPanel style={styles.panel}>
        <View style={styles.headerRow}>
          <SemanticIcon name="notifications" size="md" decorative />
          <View style={styles.headerText}>
            <AppText style={styles.h2} weight="semibold">
              {t('browserNotifications.title', 'Browser Notifications')}
            </AppText>
            <AppText style={styles.headerSubtitle} tone="muted">
              {t(
                'browserNotifications.subtitle',
                'Get notified when the app tab is in the background',
              )}
            </AppText>
          </View>
        </View>

        {!notificationsSupported ? (
          <AppText style={styles.mutedXs} tone="muted">
            {t(
              'browserNotifications.unsupported',
              'Browser notifications are not supported in this browser.',
            )}
          </AppText>
        ) : (
          <View style={styles.stack4}>
            <View style={styles.rowGap3}>
              {permission === 'default' && (
                <Button
                  variant="primary"
                  icon={
                    <SemanticIcon name="notifications" size="sm" decorative />
                  }
                  onClick={() => {
                    void requestPermission();
                  }}
                >
                  {t(
                    'browserNotifications.enable',
                    'Enable Browser Notifications',
                  )}
                </Button>
              )}
              {permission === 'granted' && (
                <Badge variant="success">
                  {t('browserNotifications.enabled', 'Enabled')}
                </Badge>
              )}
              {permission === 'denied' && (
                <AppText style={styles.mutedXs} tone="muted">
                  {t(
                    'browserNotifications.blocked',
                    'Notifications are blocked. Enable in your browser settings.',
                  )}
                </AppText>
              )}
            </View>

            {permission === 'granted' && (
              <View style={styles.dividerStack}>
                <AppText style={styles.sectionLabel} tone="muted">
                  {t('browserNotifications.events', 'Notify me about')}
                </AppText>
                <Toggle
                  label={t('browserNotifications.alerts', 'Alerts')}
                  checked={pushPrefs.alerts}
                  onChange={checked =>
                    setPushPrefs(prev => ({ ...prev, alerts: checked }))
                  }
                  size="sm"
                />
                <Toggle
                  label={t(
                    'browserNotifications.exportStatus',
                    'Export completions',
                  )}
                  checked={pushPrefs.exportStatus}
                  onChange={checked =>
                    setPushPrefs(prev => ({ ...prev, exportStatus: checked }))
                  }
                  size="sm"
                />
                <AppText style={styles.hintXs} tone="muted">
                  {t(
                    'browserNotifications.hint',
                    'Notifications only fire when the app tab is in the background.',
                  )}
                </AppText>
              </View>
            )}
          </View>
        )}

        <View style={styles.dividerStack}>
          <AppText style={styles.sectionLabel} tone="muted">
            {t('settings.tab.heading', 'Browser tab signals')}
          </AppText>
          <Toggle
            label={t('settings.tab.badge', 'Show unread count in browser tab')}
            checked={tabBadgeEnabled}
            onChange={checked => updateTabSetting('tab_badge_enabled', checked)}
            size="sm"
          />
          <Toggle
            label={t(
              'settings.tab.flash',
              'Flash tab title on critical alerts',
            )}
            checked={criticalFlashEnabled}
            onChange={checked =>
              updateTabSetting('critical_flash_enabled', checked)
            }
            size="sm"
          />
          <AppText style={styles.hintXs} tone="muted">
            {t(
              'settings.tab.hint',
              'Adds a "(N)" prefix and favicon dot when there are unread notifications. Critical alerts briefly flash "(!) ALERT" when the tab is in the background.',
            )}
          </AppText>
        </View>

        <View style={styles.dividerStack} testID="notification-sounds">
          <View style={styles.headerRow}>
            <SemanticIcon name="volume" size="sm" decorative />
            <View style={styles.headerText}>
              <AppText style={styles.h3} weight="semibold">
                {t('notificationSounds.title', 'Notification sounds')}
              </AppText>
              <AppText style={styles.headerSubtitle} tone="muted">
                {t(
                  'notificationSounds.subtitle',
                  'Play a short cue when an alert or completion event arrives. Plays even while the tab is visible.',
                )}
              </AppText>
            </View>
          </View>

          <Toggle
            label={t('notificationSounds.master', 'Enable notification sounds')}
            checked={soundPrefs.master}
            onChange={handleMasterToggle}
            size="sm"
          />

          {soundPrefs.master && !autoplayHintDismissed && (
            <AppText style={styles.autoplayHint}>
              {t(
                'notificationSounds.autoplayHint',
                'Some browsers require a click before audio is allowed. Use the Test buttons below once to authorise playback.',
              )}
            </AppText>
          )}

          <View style={styles.stack2}>
            <AppText style={styles.sectionLabel} tone="muted">
              {t('notificationSounds.categoriesHeading', 'Channels')}
            </AppText>
            <View style={styles.stack2}>
              {NOTIFICATION_SOUND_CATEGORIES.map(category => (
                <View
                  key={category}
                  style={[
                    styles.categoryRow,
                    !soundPrefs.master ? styles.categoryRowMuted : null,
                  ]}
                >
                  <View style={styles.categoryToggle}>
                    <Toggle
                      label={t(
                        `notificationSounds.category.${category}`,
                        categoryFallback(category),
                      )}
                      checked={soundPrefs.perCategory[category]}
                      onChange={checked =>
                        setNotificationSoundPrefs({
                          perCategory: { [category]: checked },
                        })
                      }
                      size="sm"
                    />
                  </View>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<SemanticIcon name="play" size="sm" decorative />}
                    onClick={() => handleTestSound(category)}
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
                  >
                    {t('notificationSounds.test', 'Test')}
                  </Button>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.volumeWrap}>
            <Slider
              label={t('notificationSounds.volume', 'Volume')}
              min={0}
              max={100}
              step={5}
              value={Math.round(soundPrefs.volume * 100)}
              onChange={next =>
                setNotificationSoundPrefs({ volume: next / 100 })
              }
              formatValue={n => `${n}%`}
              disabled={!soundPrefs.master}
            />
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function BrowserNotificationsPage(): React.ReactElement {
  const { t } = useTranslation();
  usePageTitle(t('notifications.browser.title', 'Browser notifications'));

  return (
    <PageContainer
      title={t('notifications.browser.title', 'Browser notifications')}
      subtitle={t(
        'notifications.browser.subtitle',
        'Native browser push notifications when alerts fire.',
      )}
      copyLink
    >
      <NotificationSettings />
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  /* page container */
  page: { backgroundColor: colors.background, flex: 1 },
  pageContent: { gap: spacing.lg, padding: spacing.lg },
  pageHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderText: { flex: 1, minWidth: 180 },
  pageTitle: { color: colors.textPrimary, fontSize: 24, lineHeight: 30 },
  pageSubtitle: { fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
  pageActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pageLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  pageErrorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  pageErrorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  pageEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },

  /* panel */
  panel: { padding: spacing.lg, gap: spacing.lg },
  headerRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  headerText: { flex: 1, minWidth: 0 },
  h2: { color: colors.textPrimary, fontSize: 16, lineHeight: 22 },
  h3: { color: colors.textPrimary, fontSize: 14, lineHeight: 20 },
  headerSubtitle: { fontSize: 12, lineHeight: 16, marginTop: 2 },

  /* generic stacks + dividers (web space-y-* / border-t) */
  stack2: { gap: spacing.sm },
  stack4: { gap: spacing.md },
  rowGap3: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  dividerStack: {
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  mutedXs: { fontSize: 12, lineHeight: 16 },
  hintXs: { fontSize: 10, lineHeight: 14 },
  autoplayHint: { color: colors.warning, fontSize: 10, lineHeight: 14 },

  /* toggle row */
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },

  /* badge */
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: { fontSize: 12, lineHeight: 16 },

  /* sound category rows */
  categoryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryRowMuted: { opacity: 0.6 },
  categoryToggle: { flex: 1 },

  /* slider */
  volumeWrap: { paddingTop: spacing.xs },
  sliderRoot: { gap: spacing.sm },
  sliderDisabled: { opacity: 0.55 },
  sliderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fieldLabel: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  sliderValue: { color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  sliderControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  sliderStep: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  sliderStepDisabled: { opacity: 0.4 },
  sliderStepText: { color: colors.textPrimary, fontSize: 18, lineHeight: 22 },
  sliderTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  sliderFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },

  /* button */
  btn: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btnIconWrap: { marginRight: 2 },
  btnText: { fontSize: 14, lineHeight: 20 },
  btnDisabled: { opacity: 0.55 },
  btnPressed: { opacity: 0.82 },
});
