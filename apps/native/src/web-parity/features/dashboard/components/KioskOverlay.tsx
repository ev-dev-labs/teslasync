// Native parity port of web/src/features/dashboard/components/KioskOverlay.tsx.
//
// The web module is the Kiosk-mode chrome overlay: a set of `fixed inset-0`
// layers stacked above the dashboard — an ambient screen-dim wallpaper, a
// cursor-hiding CSS injector, an optional corner clock, a dashboard-rotation
// dot indicator, and a top-right "Exit Kiosk" button that fades in on pointer
// interaction. None of the ambient layers are interactive (pointer-events-none)
// so the dashboard underneath stays usable; only the exit button takes input.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() (L2) -> a local English-fallback
//     useTranslation() hook whose t(key, fallback?, values?) returns the
//     fallback and interpolates {{token}} placeholders, preserving both
//     translation keys ('kiosk.exit', 'kiosk.exitLabel') verbatim. Matches the
//     precedent set by the sibling admin ports.
//   • lucide-react <X/> (L3) -> an inline '\u2715' glyph rendered in AppText,
//     mirroring the small (h-3.5 w-3.5) inline icon inside the exit button.
//   • cn() from @/lib/cn (L4) -> conditional RN style arrays; there is no
//     className in React Native.
//   • The shared web <Button variant="ghost" size="sm"> (L5) -> an inline
//     Pressable styled as a translucent pill (text-secondary -> textPrimary on
//     press, mirroring the web hover), following the FleetApiSection Button
//     precedent. backdrop-blur-sm has no RN equivalent and is dropped; the
//     translucent `colors.surface` stands in for --surface-overlay.
//   • The KioskConfig type (L6, imported from the not-yet-ported useKioskMode
//     hook) is inlined verbatim, the same precedent the admin ports use for
//     not-yet-ported types.
//   • useDateFormat() (L7) -> a local native useDateFormat() returning stable
//     formatTime/formatDateWithDay callbacks built on Intl.DateTimeFormat with
//     the exact same option objects as web/src/lib/dateFormat.ts. The web
//     hook's settings-bound locale + timezone aren't ported here (useSettings/
//     useTimezone are out of scope), so the device locale/zone is used.
//   • The `fixed inset-0 z-[...]` layers -> an absolute-fill `pointerEvents`
//     "box-none" root with absolutely-positioned children; z-order is render
//     order. The ambient layers carry pointerEvents="none" exactly like the web
//     pointer-events-none classes, so the dashboard stays interactive.
//   • Cursor-hiding (isCursorHidden, L69-76) is a browser-only CSS affordance
//     (`cursor: none`); native touch devices have no cursor, so the branch
//     renders an inert layer and is otherwise a no-op.
//   • The exit button reveal: web listens on window 'mousemove'/'touchstart'
//     (L46-47). RN has no global pointer stream, so the overlay root's
//     onTouchStart reveals the hint; the 3s auto-hide timer + cleanup are kept
//     verbatim. As on web, the button is never pointer-events-none, so it stays
//     tappable even while the opacity hint is 0.
// No DOM elements, lucide-react, framer-motion, Recharts, Leaflet, react-dom,
// or web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TranslationValues = Record<string, string | number>;

type TFunc = (
  key: string,
  fallback?: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site and interpolating {{token}} placeholders.
function useTranslation(): { t: TFunc } {
  const t = useCallback<TFunc>((key, fallback, values) => {
    const base = fallback ?? key;
    if (!values) {
      return base;
    }
    return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
      values[token] === undefined ? match : String(values[token]),
    );
  }, []);
  return { t };
}

/* ─── native useDateFormat (web @/hooks/useDateFormat) ─────────────────── */

const EM_DASH = '\u2014';

function formatTime(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    return EM_DASH;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function formatDateWithDay(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    return EM_DASH;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(value);
}

// Native useDateFormat: the web hook binds locale + timezone to user settings
// (useSettings/useTimezone, not in scope here), so this port uses the device
// locale/zone while preserving the exact Intl option objects from
// web/src/lib/dateFormat.ts. Stable callbacks mirror the web hook's identity.
function useDateFormat(): {
  formatTime: (value: Date) => string;
  formatDateWithDay: (value: Date) => string;
} {
  const time = useCallback((value: Date) => formatTime(value), []);
  const dateWithDay = useCallback((value: Date) => formatDateWithDay(value), []);
  return { formatTime: time, formatDateWithDay: dateWithDay };
}

/* ─── inlined ../hooks/useKioskMode KioskConfig ────────────────────────── */

type ClockPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface KioskConfig {
  rotateInterval: number;
  dashboardIds: string[];
  hideCursor: boolean;
  cursorTimeout: number;
  dimAfter: number;
  dimLevel: number;
  showClock: boolean;
  clockPosition: ClockPosition;
  /** Widget panel opacity: 0.3 (transparent) to 1.0 (solid/readable) */
  widgetOpacity: number;
  /** Page background opacity: 0.0 (transparent) to 1.0 (solid) */
  backgroundOpacity: number;
}

/* ─── KioskOverlay ─────────────────────────────────────────────────────── */

interface KioskOverlayProps {
  config: KioskConfig;
  isDimmed: boolean;
  isCursorHidden: boolean;
  dashboardCount: number;
  currentIndex: number;
  onExit: () => void;
}

export function KioskOverlay({
  config,
  isDimmed,
  isCursorHidden,
  dashboardCount,
  currentIndex,
  onExit,
}: KioskOverlayProps) {
  const { t } = useTranslation();
  const { formatTime: fmtTime, formatDateWithDay: fmtDateWithDay } =
    useDateFormat();
  const [now, setNow] = useState(new Date());
  const [showExit, setShowExit] = useState(false);

  // Clock tick
  useEffect(() => {
    if (!config.showClock) {
      return;
    }
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [config.showClock]);

  // Brief exit hint on any interaction. The web binds window mousemove/touchstart
  // listeners; RN has no global pointer stream, so the overlay root's
  // onTouchStart drives `reveal`. The 3s auto-hide + cleanup are preserved.
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const reveal = useCallback((_event?: GestureResponderEvent) => {
    setShowExit(true);
    if (exitTimer.current) {
      clearTimeout(exitTimer.current);
    }
    exitTimer.current = setTimeout(() => setShowExit(false), 3000);
  }, []);
  useEffect(() => {
    return () => {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
      }
    };
  }, []);

  return (
    <View
      onTouchStart={reveal}
      pointerEvents="box-none"
      style={styles.root}
      testID="kiosk-root"
    >
      {/* Dim overlay — non-interactive so it doesn't block interaction */}
      {isDimmed ? (
        <View
          pointerEvents="none"
          style={[styles.dim, { opacity: 1 - config.dimLevel }]}
          testID="kiosk-dim"
        />
      ) : null}

      {/* Cursor hiding is a browser-only affordance (CSS `cursor: none`); native
          touch devices have no cursor, so this layer is inert. */}
      {isCursorHidden ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          testID="kiosk-cursor-hide"
        />
      ) : null}

      {/* Clock overlay */}
      {config.showClock ? (
        <View
          pointerEvents="none"
          style={[styles.clock, clockPositionStyles[config.clockPosition]]}
          testID="kiosk-clock"
        >
          <AppText style={styles.clockTime}>{fmtTime(now)}</AppText>
          <AppText style={styles.clockDate}>{fmtDateWithDay(now)}</AppText>
        </View>
      ) : null}

      {/* Dashboard rotation indicator dots */}
      {dashboardCount > 1 && config.rotateInterval > 0 ? (
        <View pointerEvents="none" style={styles.dots} testID="kiosk-dots">
          {Array.from({ length: dashboardCount }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === currentIndex ? styles.dotActive : styles.dotInactive,
              ]}
              testID="kiosk-dot"
            />
          ))}
        </View>
      ) : null}

      {/* Exit button — fades in on interaction, always tappable (opacity-only
          hint, never pointer-events-none, matching the web button). */}
      <View
        pointerEvents="box-none"
        style={[styles.exitWrap, showExit ? styles.exitVisible : styles.exitHidden]}
        testID="kiosk-exit-wrap"
      >
        <Pressable
          accessibilityLabel={t('kiosk.exit', 'Exit kiosk mode')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onExit}
          style={({ pressed }) => [
            styles.exitBtn,
            pressed ? styles.exitBtnPressed : null,
          ]}
          testID="kiosk-exit"
        >
          <AppText style={styles.exitLabel} weight="bold">
            {'\u2715'}
          </AppText>
          <AppText style={styles.exitLabel}>
            {t('kiosk.exitLabel', 'Exit Kiosk')}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const clockPositionStyles = StyleSheet.create<Record<ClockPosition, ViewStyle>>({
  'top-left': {
    left: spacing.md,
    top: spacing.md,
  },
  'top-right': {
    right: spacing.md,
    top: spacing.md,
  },
  'bottom-left': {
    bottom: spacing.md,
    left: spacing.md,
  },
  'bottom-right': {
    bottom: spacing.md,
    right: spacing.md,
  },
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
  },
  dim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  clock: {
    position: 'absolute',
  },
  clockTime: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 24,
    fontVariant: ['tabular-nums'],
    lineHeight: 30,
  },
  clockDate: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
  dots: {
    alignItems: 'center',
    bottom: spacing.md,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  dot: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 6,
  },
  dotActive: {
    width: 24,
  },
  dotInactive: {
    width: 6,
  },
  exitWrap: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
  },
  exitVisible: {
    opacity: 1,
  },
  exitHidden: {
    opacity: 0,
  },
  exitBtn: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  exitBtnPressed: {
    backgroundColor: colors.surfaceHover,
  },
  exitLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
});
