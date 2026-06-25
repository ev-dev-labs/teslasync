// Native parity port of web/src/components/feedback/InstallPrompt.tsx.
//
// The web component is a Progressive-Web-App install banner: it listens for the
// browser `beforeinstallprompt` event, stashes the deferred prompt, and renders
// a bottom-docked card that lets the user add TeslaSync to their home screen.
// None of that machinery exists on React Native — the binary IS the installed,
// standalone experience the web prompt is trying to talk the user into. So this
// port preserves the component contract, state names, constants, dismiss logic,
// i18n strings, and the cross-surface "dismissed" bus, while substituting the
// browser-only pieces with native-safe equivalents that carry an explicit
// unavailable state (see nativeInstallPromptCapabilities and the parity sidecar).
//
// Native-safe substitutions (documented in the parity sidecar):
//   - `window.addEventListener('beforeinstallprompt' | 'appinstalled')` has no
//     native source, so it becomes a module-level install-offer bus
//     (offerInstallPrompt / markAppInstalled -> subscribeInstallOffer /
//     subscribeAppInstalled). Nothing emits on it by default, so the banner is
//     never surfaced at runtime — the faithful "already installed" outcome.
//   - `window.matchMedia('(display-mode: standalone)')` and
//     `navigator.standalone` have no native equivalent; isStandaloneMode()
//     returns true because a native app is always the standalone form.
//   - `localStorage` dismiss persistence becomes the react-native-web
//     `globalThis.localStorage` when present (web target) and an in-process
//     fallback otherwise; cross-restart persistence is intentionally
//     unavailable on a pure native runtime.
//   - The `@/lib/broadcast` cross-tab bus becomes a module listener set
//     (broadcastInstallDismissed / subscribeInstallDismiss); cross-device /
//     cross-tab fan-out is web-only and intentionally unavailable.
//   - framer-motion's AnimatePresence + motion.div spring become an
//     Animated.View enter/exit spring that honours the reduce-motion setting.
//   - lucide-react Download / X glyphs and the web `Button` become native
//     glyph chips and compact Pressable controls (the shared AppButton's 44pt
//     min height does not fit the compact banner, matching the ErrorBoundary
//     parity precedent).

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

// ── i18n fallback ────────────────────────────────────────────────────────────
// The web component reads copy through react-i18next's t(key, fallback). Native
// renders the English fallback directly so visual + i18n intent are preserved
// without bundling the web i18n runtime.

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ── Native-safe deferred-prompt + install bus ────────────────────────────────
// Mirrors the relevant surface of the browser BeforeInstallPromptEvent so the
// install control flow ports verbatim. Because native has no PWA install event,
// these buses have no default emitter; offerInstallPrompt / markAppInstalled are
// exported so a host integration (or test) can drive the banner explicitly.

export interface DeferredInstallPrompt {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}

type InstallOfferListener = (prompt: DeferredInstallPrompt) => void;
type AppInstalledListener = () => void;

const installOfferListeners = new Set<InstallOfferListener>();
const appInstalledListeners = new Set<AppInstalledListener>();
const installDismissListeners = new Set<() => void>();

/** Native stand-in for the browser `beforeinstallprompt` event. */
export function offerInstallPrompt(prompt: DeferredInstallPrompt): void {
  for (const listener of installOfferListeners) {
    listener(prompt);
  }
}

/** Native stand-in for the browser `appinstalled` event. */
export function markAppInstalled(): void {
  for (const listener of appInstalledListeners) {
    listener();
  }
}

/** Native stand-in for `broadcast({ type: 'install.dismissed' })`. */
export function broadcastInstallDismissed(): void {
  for (const listener of installDismissListeners) {
    listener();
  }
}

function subscribeInstallOffer(listener: InstallOfferListener): () => void {
  installOfferListeners.add(listener);
  return () => {
    installOfferListeners.delete(listener);
  };
}

function subscribeAppInstalled(listener: AppInstalledListener): () => void {
  appInstalledListeners.add(listener);
  return () => {
    appInstalledListeners.delete(listener);
  };
}

function subscribeInstallDismiss(listener: () => void): () => void {
  installDismissListeners.add(listener);
  return () => {
    installDismissListeners.delete(listener);
  };
}

/** Explicit capability matrix for the native install surface. */
export const nativeInstallPromptCapabilities = {
  beforeInstallPromptEventAvailable: false,
  appInstalledEventAvailable: false,
  displayModeStandaloneDetectionAvailable: false,
  navigatorStandaloneDetectionAvailable: false,
  crossTabBroadcastAvailable: false,
  durableDismissPersistenceAvailable: false,
} as const;

const DISMISS_KEY = 'teslasync-pwa-install-dismissed';
const DISMISS_DAYS = 14;

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// react-native-web exposes the real localStorage; a pure native runtime does
// not, so we keep an in-process timestamp as the fallback transport.
let inMemoryDismissedAt: number | null = null;

function getWebStorage(): WebStorageLike | undefined {
  const candidate = (
    globalThis as typeof globalThis & {localStorage?: WebStorageLike}
  ).localStorage;
  return candidate && typeof candidate.getItem === 'function'
    ? candidate
    : undefined;
}

function readDismissedAt(): number | null {
  const store = getWebStorage();
  if (store) {
    try {
      const raw = store.getItem(DISMISS_KEY);
      return raw == null ? null : Number(raw);
    } catch {
      return inMemoryDismissedAt;
    }
  }
  return inMemoryDismissedAt;
}

function writeDismissedAt(timestamp: number): void {
  inMemoryDismissedAt = timestamp;
  const store = getWebStorage();
  if (store) {
    try {
      store.setItem(DISMISS_KEY, String(timestamp));
    } catch {
      // Ignore storage failures; dismissing still hides the prompt for this render.
    }
  }
}

function wasDismissedRecently(): boolean {
  const ts = readDismissedAt();
  return (
    ts != null &&
    Number.isFinite(ts) &&
    Date.now() - ts < DISMISS_DAYS * 86_400_000
  );
}

// A React Native binary is always the installed, standalone experience — the
// exact condition under which the web component suppresses the install banner.
// There is no display-mode media query and no navigator.standalone flag on
// native, so this is statically true and the prompt is never offered.
function isStandaloneMode(): boolean {
  return true;
}

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

export default function InstallPrompt() {
  const t = useNativeTranslationFallback();
  const [deferredPrompt, setDeferredPrompt] =
    useState<DeferredInstallPrompt | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandaloneMode() || wasDismissedRecently()) {
      return;
    }

    const handler = (prompt: DeferredInstallPrompt) => {
      if (isStandaloneMode()) {
        return;
      }
      setDeferredPrompt(prompt);
      setVisible(true);
    };

    const installedHandler = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };

    const unsubscribeOffer = subscribeInstallOffer(handler);
    const unsubscribeInstalled = subscribeAppInstalled(installedHandler);
    return () => {
      unsubscribeOffer();
      unsubscribeInstalled();
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return;
    }
    await deferredPrompt.prompt();
    const {outcome} = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
    }
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    setDeferredPrompt(null);
    writeDismissedAt(Date.now());
    broadcastInstallDismissed();
  }, []);

  // When another surface dismisses the install prompt, hide it here too so the
  // user does not have to dismiss it from every entry point.
  useEffect(() => {
    return subscribeInstallDismiss(() => {
      setVisible(false);
      setDeferredPrompt(null);
    });
  }, []);

  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const renderedRef = useRef(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;

    if (visible) {
      renderedRef.current = true;
      setRendered(true);
      if (reduceMotion) {
        progress.setValue(1);
      } else {
        animation = Animated.spring(progress, {
          toValue: 1,
          stiffness: 400,
          damping: 30,
          mass: 1,
          useNativeDriver: true,
        });
        animation.start();
      }
    } else if (renderedRef.current) {
      if (reduceMotion) {
        progress.setValue(0);
        renderedRef.current = false;
        setRendered(false);
      } else {
        animation = Animated.spring(progress, {
          toValue: 0,
          stiffness: 400,
          damping: 30,
          mass: 1,
          useNativeDriver: true,
        });
        animation.start(({finished}) => {
          if (finished) {
            renderedRef.current = false;
            setRendered(false);
          }
        });
      }
    }

    return () => {
      animation?.stop();
    };
  }, [visible, reduceMotion, progress]);

  if (!rendered) {
    return null;
  }

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [60, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.container, animatedStyle]}
      testID="install-prompt">
      <View style={styles.card}>
        <View pointerEvents="none" style={styles.iconChip}>
          <AppText style={styles.iconGlyph} weight="bold">
            {'\u2913'}
          </AppText>
        </View>
        <View style={styles.copy}>
          <AppText style={styles.title} weight="semibold">
            {t('installPrompt.title', 'Install TeslaSync')}
          </AppText>
          <AppText style={styles.subtitle} tone="secondary">
            {t(
              'installPrompt.subtitle',
              'Add to home screen for native experience',
            )}
          </AppText>
        </View>
        <Pressable
          accessibilityLabel={t('installPrompt.install', 'Install')}
          accessibilityRole="button"
          onPress={handleInstall}
          style={({pressed}) => [
            styles.installButton,
            pressed && styles.pressed,
          ]}
          testID="install-prompt-install">
          <AppText style={styles.installText} weight="semibold">
            {t('installPrompt.install', 'Install')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityLabel={t(
            'installPrompt.dismiss',
            'Dismiss install prompt',
          )}
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleDismiss}
          style={({pressed}) => [
            styles.dismissButton,
            pressed && styles.pressed,
          ]}
          testID="install-prompt-dismiss">
          <AppText style={styles.dismissGlyph} tone="muted">
            {'\u00d7'}
          </AppText>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// 4.5rem clearance above the bottom navigation, mirroring the web
// bottom-[calc(4.5rem+env(safe-area-inset-bottom))] offset. The safe-area inset
// is folded into the constant because native exposes no env() CSS variable here.
const BOTTOM_OFFSET = 72;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: BOTTOM_OFFSET,
    alignSelf: 'center',
    maxWidth: 448,
    zIndex: 9998,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...shadows.panel,
  },
  iconChip: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  iconGlyph: {
    fontSize: 20,
    lineHeight: 24,
    color: '#ffffff',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  installButton: {
    height: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.accent,
  },
  installText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#ffffff',
  },
  dismissButton: {
    width: 32,
    height: 32,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  dismissGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.82,
  },
});
