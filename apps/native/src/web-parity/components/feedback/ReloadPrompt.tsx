// Native parity port of web/src/components/feedback/ReloadPrompt.tsx.
//
// The web component is a Progressive Web App update banner. It mounts
// vite-plugin-pwa's `useRegisterSW` (virtual:pwa-register/react) for one useful
// side effect — a periodic `registration.update()` that makes the browser fetch
// the manifest every 5 minutes so freshly deployed builds are picked up — and,
// when a new service worker is waiting (`needRefresh`), shows a non-intrusive
// banner that counts down 3s then reloads the page to activate the new build,
// with a "Later" opt-out and a "Reload Now" button.
//
// React Native has NO service worker / PWA platform, so the entire
// `virtual:pwa-register/react` dependency is browser-only and unavailable here
// (conversion contract rule 7). The banner is reproduced natively with RN
// primitives + the shared GlassPanel/AppText/theme tokens, and the
// service-worker plumbing is replaced by an explicit host bridge:
//   - `useRegisterSW` -> the local `useNativeRegisterSW` hook, which exposes the
//     SAME shape (`{ needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker }`)
//     so the countdown/dismiss/reload logic below is preserved verbatim.
//   - `needRefresh` (set true by the SW's onNeedRefresh, which autoUpdate mode
//     never fires in prod) -> the `updateReady` prop, supplied by the host
//     (expo-updates / CodePush / store check). It DEFAULTS TO FALSE, so the
//     banner stays hidden — the explicit "unavailable" state, matching the web
//     prod behavior where this banner is effectively dead code.
//   - `updateServiceWorker(true)` (skipWaiting + page reload) -> the `onReload`
//     bridge prop (apply staged update + restart the app).
//   - the 5-minute `registration.update()` poll -> the `onCheckForUpdate` bridge
//     prop, invoked on the same UPDATE_CHECK_INTERVAL_MS cadence (no-op until
//     the host wires it; there is no ServiceWorkerRegistration to poll).
//   - `onRegisterError` console.error -> no SW registration exists natively, so
//     there is no error path to log; dropped.
//   - lucide-react `RefreshCw` (animate-spin) -> a native ActivityIndicator (same
//     "spinning refresh" intent) inside the cyan-tinted badge.
//   - `../ui/Button` (ghost + primary, size="sm") -> the internal compact
//     `PromptButton` Pressables.
//   - react-i18next `useTranslation` -> the shared native fallback hook (key +
//     English fallback + {{var}} interpolation); every t() key + fallback is
//     copied verbatim, including the {{seconds}} interpolation.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../theme/tokens';

const COUNTDOWN_SECONDS = 3;
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// bg-neon-cyan/10 badge + border-neon-cyan/30 panel edge from the web banner.
const ACCENT_BADGE_BG = 'rgba(53, 213, 255, 0.1)';
const ACCENT_BORDER = 'rgba(53, 213, 255, 0.3)';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function interpolate(template: string, values: TranslationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, values) =>
      values ? interpolate(fallback, values) : fallback,
    [],
  );
}

// ---- Native-safe service-worker registration (web useRegisterSW) ------------

interface NativeRegisterSWOptions {
  /**
   * Host-supplied "a new build is staged" signal. Replaces the web
   * `needRefresh` flag that vite-plugin-pwa would set from `onNeedRefresh`.
   */
  updateReady: boolean;
  /** Replaces `updateServiceWorker(true)`: apply the staged update + restart. */
  onReload?: () => void;
  /** Replaces the periodic `registration.update()` poll. */
  onCheckForUpdate?: () => void;
}

interface NativeRegisterSWResult {
  needRefresh: [boolean, (value: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => void;
}

/**
 * Native stand-in for `useRegisterSW` from `virtual:pwa-register/react`. There
 * is no service worker on native, so the "update ready" signal comes from the
 * host via `updateReady`, the periodic manifest check is delegated to
 * `onCheckForUpdate`, and the skip-waiting page reload becomes `onReload`. The
 * returned shape mirrors the web hook exactly so the consumer logic is
 * unchanged.
 */
function useNativeRegisterSW({
  updateReady,
  onReload,
  onCheckForUpdate,
}: NativeRegisterSWOptions): NativeRegisterSWResult {
  const [needRefresh, setNeedRefresh] = useState(updateReady);

  useEffect(() => {
    setNeedRefresh(updateReady);
  }, [updateReady]);

  // Native replacement for the web onRegisteredSW side effect:
  //   setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS)
  // Runs the host's update check (if wired) on the same 5-minute cadence.
  useEffect(() => {
    if (!onCheckForUpdate) {
      return;
    }
    const interval = setInterval(onCheckForUpdate, UPDATE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [onCheckForUpdate]);

  const updateServiceWorker = useCallback(
    (reloadPage?: boolean) => {
      if (reloadPage) {
        onReload?.();
      }
    },
    [onReload],
  );

  return {needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker};
}

export interface ReloadPromptProps {
  /**
   * Host bridge replacing the web service worker's `needRefresh` flag. Set true
   * when a new build is staged (expo-updates / CodePush / store check). Defaults
   * to false so the banner stays hidden — the explicit native "unavailable"
   * state, matching the web autoUpdate prod behavior.
   */
  updateReady?: boolean;
  /** Apply the staged update + restart the app (web `updateServiceWorker(true)`). */
  onReload?: () => void;
  /** Periodic update check (web `registration.update()` every 5 minutes). */
  onCheckForUpdate?: () => void;
  /** Invoked when the user taps "Later" (dismisses the banner). */
  onDismiss?: () => void;
  /** Native style escape hatch applied to the absolute anchor. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Shows a non-intrusive banner when a new app build is staged. Counts down then
 * auto-reloads so users always run the latest version, but exposes a "Later"
 * button to opt out (cancels the countdown and hides the banner). On native the
 * "update ready" trigger and the reload action are delegated to the host via
 * props; with no host wiring the banner never appears (unavailable state).
 */
export default function ReloadPrompt({
  updateReady = false,
  onReload,
  onCheckForUpdate,
  onDismiss,
  style,
  testID,
}: ReloadPromptProps) {
  const t = useNativeTranslationFallback();
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useNativeRegisterSW({updateReady, onReload, onCheckForUpdate});

  const clearCountdown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const doReload = useCallback(() => {
    clearCountdown();
    updateServiceWorker(true);
  }, [updateServiceWorker, clearCountdown]);

  const dismiss = useCallback(() => {
    clearCountdown();
    setNeedRefresh(false);
    onDismiss?.();
  }, [clearCountdown, setNeedRefresh, onDismiss]);

  useEffect(() => {
    if (!needRefresh) {
      return;
    }

    setCountdown(COUNTDOWN_SECONDS);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearCountdown();
          updateServiceWorker(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return clearCountdown;
  }, [needRefresh, updateServiceWorker, clearCountdown]);

  if (!needRefresh) {
    return null;
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      pointerEvents="box-none"
      style={[styles.anchor, style]}
      testID={testID}>
      <GlassPanel style={styles.panel}>
        <View style={styles.iconBadge}>
          <ActivityIndicator color={colors.accent} size="small" />
        </View>
        <View style={styles.copy}>
          <AppText style={styles.title} weight="semibold">
            {t('pwa.newVersion', 'New version available')}
          </AppText>
          <AppText style={styles.subtitle}>
            {t('pwa.reloadingIn', 'Reloading in {{seconds}}s...', {
              seconds: countdown,
            })}
          </AppText>
        </View>
        <PromptButton
          label={t('pwa.later', 'Later')}
          onPress={dismiss}
          testID="reload-prompt-later"
          variant="ghost"
        />
        <PromptButton
          label={t('pwa.reloadNow', 'Reload Now')}
          onPress={doReload}
          testID="reload-prompt-reload"
          variant="primary"
        />
      </GlassPanel>
    </View>
  );
}
ReloadPrompt.displayName = 'ReloadPrompt';

// ---- Internal compact button (web ../ui/Button ghost + primary, size="sm") --

interface PromptButtonProps {
  label: string;
  onPress: () => void;
  variant: 'ghost' | 'primary';
  testID?: string;
}

function PromptButton({label, onPress, variant, testID}: PromptButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonGhost,
        pressed &&
          (isPrimary ? styles.buttonPrimaryPressed : styles.buttonGhostPressed),
      ]}
      testID={testID}>
      <AppText
        style={isPrimary ? styles.buttonPrimaryText : styles.buttonGhostText}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  anchor: {
    bottom: 16,
    position: 'absolute',
    right: 16,
    zIndex: 9999,
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonGhostPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  buttonGhostText: {
    color: colors.textSecondary,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonPrimaryPressed: {
    opacity: 0.82,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: ACCENT_BADGE_BG,
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  panel: {
    alignItems: 'center',
    borderColor: ACCENT_BORDER,
    elevation: 12,
    flexDirection: 'row',
    gap: spacing.md,
    maxWidth: 384,
    padding: 16,
    shadowColor: colors.accent,
    shadowOffset: {height: 10, width: 0},
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
});
