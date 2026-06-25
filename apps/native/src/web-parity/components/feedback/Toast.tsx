// Native parity port of web/src/components/feedback/Toast.tsx.
//
// Toast — transient mutation feedback (auto-dismisses after 4s). The provider
// owns the toast queue + the success/error/info/warning convenience API and the
// throwing `useToast()` / non-throwing `useOptionalToast()` consumers. That
// queue, the id generation (`toast-${++toastCounter}`), the max-5 cap
// (`prev.slice(-4)`), the per-type duration default (4000ms), and the action
// precedence (navigation `to` wins over callback `onClick`) are vendor-agnostic
// and ported verbatim — only the rendering layer is re-expressed with React
// Native primitives.
//
// Six web dependencies are NOT in the native parity manifest, so native-safe
// equivalents are inlined here and documented:
//
//   - framer-motion `motion` / `AnimatePresence` (web L2): there is no DOM
//     motion engine on React Native, so the spring entrance (opacity 0->1,
//     y 20->0, scale 0.95->1) and the slide-out exit (opacity->0, x 80) are
//     reimplemented with the `Animated` API. AnimatePresence's deferred-unmount
//     is reproduced with a per-toast `leaving` flag: `dismiss(id)` marks the
//     toast leaving (running the exit animation) and the item calls back to
//     truly remove itself once the animation finishes, so the exit animation is
//     preserved instead of an instant pop. Reduced motion collapses both to the
//     web behaviour (no entrance, opacity-only exit).
//   - react-router-dom `Link` (web L3): the native web-parity tree has NO
//     in-app router, so the navigation action (`{ label, to }`) is routed
//     through an inlined `useNativeHrefNavigation()` that hands the href to the
//     platform URL handler via `Linking.openURL` on a best-effort basis
//     (unresolvable web routes are swallowed), mirroring the QueryError port.
//   - lucide-react `X` / `CheckCircle` / `AlertCircle` / `Info` /
//     `AlertTriangle` (web L4): no native icon module. The web card tints every
//     icon with the toast type's own colour (the shared SemanticIcon bakes a
//     fixed per-name tone that would break that per-type unity), so each icon is
//     rendered as a small type-coloured glyph (CheckCircle->✓, AlertCircle->!,
//     Info->i, AlertTriangle->▲, dismiss X->✕) — the inline glyph approach used
//     by the QueryError / ImpersonationBanner ports.
//   - clsx (web L5): className composition is replaced by RN `StyleSheet` style
//     arrays + per-type style maps (the SemanticIcon `toneStyles[tone]` pattern).
//   - `@/hooks/useMotionPreference` (web L6): framer-motion's reduced-motion
//     hook has no native module, so it is inlined with `AccessibilityInfo`
//     (`isReduceMotionEnabled` + the `reduceMotionChanged` subscription),
//     returning the same `{ reduce, durationMs }` contract.
//
// The web `role="alert"` (error) / `role="status"` (others) + the implied
// assertive/polite `aria-live` map to RN `accessibilityRole` +
// `accessibilityLiveRegion`. The `fixed bottom-4 right-4 z-[100]`
// pointer-events-none overlay becomes an absolutely-positioned `box-none`
// toast layer pinned bottom-right inside a `flex:1` provider root. The web
// `aria-atomic`, `backdrop-blur-xl`, the `forced-colors:` high-contrast border
// fallback, and the `safe-bottom` helper have no RN analogue and are dropped;
// `line-clamp-2` maps to `numberOfLines={2}`.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

type ToastType = 'success' | 'error' | 'info' | 'warning';

/**
 * Optional action rendered in the toast body.
 *
 * Two flavours, discriminated by which field is set:
 *
 *  - Navigation action: `{ label, to }` hands the target to the platform URL
 *    handler (best-effort `Linking.openURL`). On web this rendered a React
 *    Router `<Link>`; the native web-parity tree has no in-app router.
 *
 *  - Callback action: `{ label, onClick }` renders a Pressable that fires the
 *    supplied handler then dismisses the toast. Used by undoable bulk
 *    operations where clicking "Undo" must run arbitrary mutation code rather
 *    than navigate.
 *
 * Exactly one of `to` / `onClick` should be supplied; if both are present the
 * navigation form wins so existing call-sites stay intact.
 */
export interface ToastAction {
  /** Visible label, e.g. "View" or "Undo". */
  label: string;
  /** Navigation target (path + query). Mutually exclusive with `onClick`. */
  to?: string;
  /**
   * Callback invoked when the action is pressed. The toast auto-dismisses after
   * firing so the caller doesn't need to do that manually. Mutually exclusive
   * with `to`.
   */
  onClick?: () => void;
}

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: ToastAction;
}

interface InternalToast extends Toast {
  /** True once the toast has been requested to dismiss (exit animation runs). */
  leaving: boolean;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

/**
 * useOptionalToast — non-throwing variant of {@link useToast} that returns
 * `null` when no `<ToastProvider>` is mounted in the tree. Useful for
 * primitives that want to surface a toast when available but should not crash in
 * isolated component tests that don't wrap with the provider.
 */
export function useOptionalToast(): ToastContextValue | null {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// useMotionPreference — native-safe port of web/src/hooks/useMotionPreference.ts.
// framer-motion's useReducedMotion() has no native module, so the OS
// reduced-motion preference is read via AccessibilityInfo. Returns the same
// `{ reduce, durationMs }` contract the web hook exposes.
// ---------------------------------------------------------------------------

interface MotionPreference {
  /** True when the user has requested reduced motion. */
  reduce: boolean;
  /** Recommended transition duration in milliseconds (0 when reduced). */
  durationMs: number;
}

function useMotionPreference(defaultMs = 280): MotionPreference {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduce(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduce,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return {reduce, durationMs: reduce ? 0 : defaultMs};
}

// ---------------------------------------------------------------------------
// useNativeHrefNavigation — native-safe replacement for react-router-dom Link.
// The native web-parity tree has no in-app router, so web route strings are
// handed to the platform URL handler on a best-effort basis. Unresolvable
// routes are swallowed so a failed navigation never crashes the toast.
// ---------------------------------------------------------------------------

function useNativeHrefNavigation(): (href: string) => void {
  return useCallback((href: string) => {
    Promise.resolve()
      .then(() => Linking.openURL(href))
      .catch(() => undefined);
  }, []);
}

// Lucide icon -> type-coloured glyph. The colour comes from `iconTypeStyles`
// (matching the web card, which tints every icon with the toast type's shade).
const toastGlyphs: Record<ToastType, string> = {
  success: '\u2713', // CheckCircle
  error: '!', // AlertCircle
  info: 'i', // Info
  warning: '\u25B2', // AlertTriangle
};

// Errors get an assertive live-region (web role="alert"); informational toasts
// get a polite one (web role="status").
const toastRole: Record<ToastType, 'alert' | 'status'> = {
  success: 'status',
  error: 'alert',
  info: 'status',
  warning: 'status',
};

let toastCounter = 0;

interface ToastItemProps {
  toast: InternalToast;
  reduce: boolean;
  durationMs: number;
  dismiss: (id: string) => void;
  onExited: (id: string) => void;
  navigate: (href: string) => void;
}

function ToastItem({
  toast,
  reduce,
  durationMs,
  dismiss,
  onExited,
  navigate,
}: ToastItemProps): React.ReactElement {
  const enter = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const leave = useRef(new Animated.Value(0)).current;

  // Entrance: collapses to an instant transition under reduced motion (web
  // initial={false}).
  useEffect(() => {
    if (reduce) {
      enter.setValue(1);
      return;
    }
    const animation = Animated.timing(enter, {
      duration: durationMs,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [durationMs, enter, reduce]);

  // Exit: web AnimatePresence plays the exit animation before unmount; reproduce
  // it by animating `leave` then calling onExited to truly remove the toast.
  const {id, leaving} = toast;
  useEffect(() => {
    if (!leaving) {
      return;
    }
    const animation = Animated.timing(leave, {
      duration: reduce ? 120 : Math.round(durationMs * 0.7),
      easing: Easing.in(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start(({finished}) => {
      if (finished) {
        onExited(id);
      }
    });
    return () => animation.stop();
  }, [durationMs, id, leave, leaving, onExited, reduce]);

  const opacity = Animated.multiply(
    enter,
    leave.interpolate({inputRange: [0, 1], outputRange: [1, 0]}),
  );
  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });
  const translateX = reduce
    ? 0
    : leave.interpolate({inputRange: [0, 1], outputRange: [0, 80]});
  const scale = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

  const animatedStyle = {
    opacity,
    transform: [{translateY}, {translateX}, {scale}],
  };

  const role = toastRole[toast.type];
  const accessibleLabel = toast.message
    ? `${toast.title}. ${toast.message}`
    : toast.title;

  const action = toast.action;
  const navigationAction = action?.to ? action : undefined;
  const callbackAction =
    !navigationAction && action?.onClick ? action : undefined;

  return (
    <Animated.View
      accessibilityLiveRegion={role === 'alert' ? 'assertive' : 'polite'}
      accessibilityRole={role === 'alert' ? 'alert' : undefined}
      style={[styles.card, cardTypeStyles[toast.type], animatedStyle]}
      testID="toast">
      <View style={styles.row}>
        <AppText
          style={[styles.icon, iconTypeStyles[toast.type]]}
          weight="bold">
          {toastGlyphs[toast.type]}
        </AppText>
        <View style={styles.content}>
          <View accessible accessibilityLabel={accessibleLabel}>
            <AppText style={styles.title} weight="semibold">
              {toast.title}
            </AppText>
            {toast.message ? (
              <AppText numberOfLines={2} style={styles.message}>
                {toast.message}
              </AppText>
            ) : null}
          </View>
          {navigationAction ? (
            <Pressable
              accessibilityLabel={navigationAction.label}
              accessibilityRole="link"
              onPress={() => {
                navigate(navigationAction.to as string);
                dismiss(toast.id);
              }}
              style={({pressed}) => [pressed && styles.pressed]}
              testID="toast-action">
              <AppText
                style={[styles.actionLabel, iconTypeStyles[toast.type]]}
                weight="semibold">
                {`${navigationAction.label} \u2192`}
              </AppText>
            </Pressable>
          ) : callbackAction ? (
            <Pressable
              accessibilityLabel={callbackAction.label}
              accessibilityRole="button"
              onPress={() => {
                callbackAction.onClick?.();
                dismiss(toast.id);
              }}
              style={({pressed}) => [pressed && styles.pressed]}
              testID="toast-action">
              <AppText
                style={[styles.actionLabel, iconTypeStyles[toast.type]]}
                weight="semibold">
                {callbackAction.label}
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Dismiss notification"
          accessibilityRole="button"
          onPress={() => dismiss(toast.id)}
          style={({pressed}) => [styles.closeButton, pressed && styles.pressed]}
          testID="toast-dismiss">
          <AppText style={styles.closeGlyph} weight="bold">
            {'\u2715'}
          </AppText>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export function ToastProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const [toasts, setToasts] = useState<InternalToast[]>([]);
  const {reduce, durationMs} = useMotionPreference();
  const navigate = useNativeHrefNavigation();
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: string) => {
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  // Mark a toast as leaving so its exit animation runs; the item removes itself
  // via onExited once the animation finishes. Mirrors the web `dismiss` which
  // filtered the toast out and let AnimatePresence play the exit.
  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts(prev =>
        prev.map(t => (t.id === id ? {...t, leaving: true} : t)),
      );
    },
    [clearTimer],
  );

  const onExited = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback(
    (opts: Omit<Toast, 'id'>) => {
      const id = `toast-${++toastCounter}`;
      const duration = opts.duration ?? 4000;
      setToasts(prev => [...prev.slice(-4), {...opts, id, leaving: false}]);
      if (duration > 0) {
        const handle = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, handle);
      }
    },
    [dismiss],
  );

  // Clear any outstanding auto-dismiss timers on unmount.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(handle => clearTimeout(handle));
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: addToast,
      success: (title, message) =>
        addToast({type: 'success', title, message}),
      error: (title, message) => addToast({type: 'error', title, message}),
      info: (title, message) => addToast({type: 'info', title, message}),
      warning: (title, message) =>
        addToast({type: 'warning', title, message}),
      dismiss,
    }),
    [addToast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        <View pointerEvents="box-none" style={styles.toastLayer}>
          {toasts.map(t => (
            <ToastItem
              dismiss={dismiss}
              durationMs={durationMs}
              key={t.id}
              navigate={navigate}
              onExited={onExited}
              reduce={reduce}
              toast={t}
            />
          ))}
        </View>
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  actionLabel: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.sm,
    textDecorationLine: 'underline',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    elevation: 8,
    maxWidth: 380,
    padding: 16,
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.18,
    shadowRadius: 16,
    width: '100%',
  },
  closeButton: {
    borderRadius: 10,
    flexShrink: 0,
    padding: 6,
  },
  closeGlyph: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 16,
  },
  content: {
    flex: 1,
  },
  icon: {
    fontSize: 17,
    lineHeight: 22,
    marginTop: 1,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  root: {
    flex: 1,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  toastLayer: {
    alignItems: 'flex-end',
    bottom: spacing.lg,
    gap: spacing.md,
    left: spacing.lg,
    position: 'absolute',
    right: spacing.lg,
  },
});

const cardTypeStyles = StyleSheet.create<Record<ToastType, ViewStyle>>({
  error: {borderColor: colors.dangerBorder, shadowColor: colors.danger},
  info: {borderColor: colors.borderAccent, shadowColor: colors.accent},
  success: {borderColor: colors.successBorder, shadowColor: colors.success},
  warning: {borderColor: colors.warningBorder, shadowColor: colors.warning},
});

const iconTypeStyles = StyleSheet.create<Record<ToastType, TextStyle>>({
  error: {color: colors.danger},
  info: {color: colors.accent},
  success: {color: colors.success},
  warning: {color: colors.warning},
});

export default ToastProvider;
