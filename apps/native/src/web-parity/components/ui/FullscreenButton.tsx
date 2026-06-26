// Native parity port of web/src/components/ui/FullscreenButton.tsx.
//
// On the web `FullscreenButton` wraps the browser Fullscreen API
// (`requestFullscreen` / `exitFullscreen` / the `fullscreenchange` document
// event / `document.fullscreenEnabled`) behind a compact ghost icon-button. It
// toggles element-level fullscreen on `targetRef.current`, hides itself when
// `document.fullscreenEnabled` is false, and sources `isFullscreen` from the
// `fullscreenchange` event so the icon, `aria-label`, `title`, and
// `aria-pressed` stay honest when the user presses Esc or another component
// grabs the lock.
//
// React Native has NO Fullscreen API surface (rules 4/7): there is no
// `document`, no element-level `requestFullscreen`/`exitFullscreen`, and no
// `fullscreenchange` event to subscribe to. Element fullscreen is therefore
// permanently UNAVAILABLE on native. The native-safe mapping mirrors the web's
// own "unsupported -> render nothing" branch:
//   - `probeSupport()` returns false (web read `document.fullscreenEnabled`,
//     which is likewise false on iOS Safari / sandboxed iframes — the exact
//     cases the web button already hides for), so by default the button renders
//     null. This is the explicit unavailable state required by rule 7.
//   - The `testHookSupported` test seam is preserved verbatim so callers/tests
//     can still force the button to render (or assert it is hidden) without
//     monkey-patching a `document` that does not exist.
//   - `readFullscreenElement()` returns null (no native fullscreen element), so
//     the sync effect always settles `isFs` to false. The `fullscreenchange`
//     listener has no native event source and is omitted; the `target.contains`
//     descendant branch has no DOM analog and is omitted. The effect structure
//     + its `[targetRef]` dependency are retained for hook-order/render parity.
//   - `toggle` is a documented native-safe no-op: there is nothing to request
//     and nothing to exit. The web `targetRef.current` null-guard is preserved.
//
// Visual intent (rendered only via the test seam / any future native fullscreen
// shim): a `variant="ghost"` icon-button. The web `<Button>` host + lucide
// `Maximize`/`Minimize` icons + Tailwind classes become a `Pressable` with a
// glyph in `AppText`. Tailwind -> px / tokens: ghost = transparent fill with a
// subtle pressed surface tint (web `hover:bg-gray-100 dark:hover:bg-gray-800` ->
// colors.surfaceHover), `rounded-md` = 6, sm `!h-7 !w-7 !p-0` = 28x28 padding 0,
// md `h-10 px-4` = 40 / 16, lg `h-12 px-6` = 48 / 24, icon `h-3.5 w-3.5` = 14.
// The lucide glyphs map to Unicode: Maximize -> '⤢' (NE-SW expand arrow),
// Minimize -> '⤡' (NW-SE contract arrow); the ghost icon uses the secondary
// text tone (web ghost inherits the surrounding text colour). `cn` is dropped
// (no className on native) and `className` is retained for source compatibility
// but ignored (`_className`), matching the Badge port.
//
// Accessibility mapping: web `aria-label`/`title` -> `accessibilityLabel`;
// `aria-pressed={isFs}` -> `accessibilityState={{selected: isFs}}`; the
// `aria-hidden` icon is covered by the Pressable grouping its label;
// `data-testid="fullscreen-button"` -> `testID`; `data-fullscreen-state`
// (on/off) is surfaced through `accessibilityState.selected`. The
// `forced-colors` / `focus-visible:ring` web affordances have no React Native
// analog and are intentionally omitted (documented in the sidecar).

import React, {forwardRef, useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {colors} from '../../../theme/tokens';
import {AppText} from '../../../components/ui/AppText';

export interface FullscreenButtonProps {
  /**
   * Ref to the element that should be made fullscreen. The ref's `.current`
   * is read at press-time. Native has no Fullscreen API, so the read is
   * preserved for parity but the toggle is a documented no-op (see header).
   */
  targetRef: React.RefObject<unknown>;
  /**
   * Override the "Enter fullscreen" accessible label. Defaults to
   * `t('common.fullscreen.enter', 'Enter fullscreen')`.
   */
  ariaLabelEnter?: string;
  /**
   * Override the "Exit fullscreen" accessible label. Defaults to
   * `t('common.fullscreen.exit', 'Exit fullscreen')`.
   */
  ariaLabelExit?: string;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /**
   * Footprint preset. Defaults to `sm`, which renders the compact 28x28
   * chart-toolbar density (web `!h-7 !w-7 !p-0`).
   */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Test seam — when defined, overrides the (always-false) native support
   * probe so tests can render the button (or assert it is hidden) without
   * monkey-patching a `document` that does not exist on native.
   */
  testHookSupported?: boolean;
  /** Native style override merged onto the underlying Pressable. */
  style?: StyleProp<ViewStyle>;
  /** Maps the web `data-testid="fullscreen-button"`. */
  testID?: string;
}

// ── Local i18n fallback ───────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation()` so the call sites are unchanged.
type TFn = (key: string, fallback: string) => string;

function useTranslation(): {t: TFn} {
  const t = useCallback<TFn>((_key, fallback) => fallback, []);
  return {t};
}

// Web probed `document.fullscreenEnabled`. React Native has no `document` and
// no element-level Fullscreen API, so element fullscreen is always unavailable.
// Returning false mirrors the web behaviour on iOS Safari / sandboxed iframes,
// where the button likewise hides itself.
function probeSupport(): boolean {
  return false;
}

// Web read `document.fullscreenElement`. React Native has no `document` and no
// fullscreen element concept, so there is never an active fullscreen element.
function readFullscreenElement(): unknown {
  return null;
}

/**
 * `<FullscreenButton>` (native parity).
 *
 * Renders a single ghost icon-button that would toggle fullscreen on
 * `targetRef.current`. On native the Fullscreen API is unavailable, so the
 * button hides itself by default and the toggle is a no-op. See the module
 * header for the full contract.
 */
export const FullscreenButton = forwardRef<View, FullscreenButtonProps>(
  function FullscreenButton(
    {
      targetRef,
      ariaLabelEnter,
      ariaLabelExit,
      className: _className,
      size = 'sm',
      testHookSupported,
      style,
      testID,
    },
    ref,
  ) {
    const {t} = useTranslation();
    const [supported, setSupported] = useState<boolean>(() =>
      testHookSupported !== undefined ? testHookSupported : probeSupport(),
    );
    const [isFs, setIsFs] = useState<boolean>(false);

    useEffect(() => {
      if (testHookSupported !== undefined) {
        setSupported(testHookSupported);
        return;
      }
      setSupported(probeSupport());
    }, [testHookSupported]);

    useEffect(() => {
      const sync = () => {
        const target = targetRef.current;
        const el = readFullscreenElement();
        // Web also treated a descendant of `target` being fullscreen as active
        // via `target.contains(el)`; native refs expose no DOM `contains`, and
        // `el` is always null here, so the containment branch is unreachable
        // and omitted — `isFs` is false whenever there is no fullscreen element.
        const active = target != null && el != null && el === target;
        setIsFs(active);
      };
      sync();
      // Web subscribed to `document.addEventListener('fullscreenchange', sync)`.
      // React Native has no such event source, so there is no listener to add
      // or remove; `sync()` runs once and `isFs` settles to false.
      return undefined;
    }, [targetRef]);

    const toggle = useCallback(() => {
      const target = targetRef.current;
      if (target == null) {
        return;
      }
      // Web arbitrated `document.exitFullscreen()` / `target.requestFullscreen()`
      // here (releasing any foreign fullscreen lock first, then requesting on
      // the target, inside a try/catch that warned on rejection). React Native
      // exposes none of these APIs — element fullscreen is unavailable — so
      // there is nothing to request or exit. Documented native-safe no-op;
      // `isFs` stays false (see the sync effect above).
    }, [targetRef]);

    if (!supported) {
      return null;
    }

    const enterLabel =
      ariaLabelEnter ?? t('common.fullscreen.enter', 'Enter fullscreen');
    const exitLabel =
      ariaLabelExit ?? t('common.fullscreen.exit', 'Exit fullscreen');
    const label = isFs ? exitLabel : enterLabel;
    const sizing = sizeStyles[size] ?? sizeStyles.sm;

    return (
      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{selected: isFs}}
        testID={testID ?? 'fullscreen-button'}
        onPress={toggle}
        style={({pressed}) => [
          styles.base,
          sizing,
          pressed ? styles.pressed : null,
          style,
        ]}>
        <AppText allowFontScaling={false} style={styles.icon}>
          {isFs ? '⤡' : '⤢'}
        </AppText>
      </Pressable>
    );
  },
);

FullscreenButton.displayName = 'FullscreenButton';

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6, // rounded-md
    backgroundColor: 'transparent', // ghost
  },
  pressed: {
    // web hover:bg-gray-100 dark:hover:bg-gray-800
    backgroundColor: colors.surfaceHover,
  },
  icon: {
    fontSize: 14, // h-3.5 w-3.5
    lineHeight: 14,
    color: colors.textSecondary,
  },
});

const sizeStyles = StyleSheet.create<Record<'sm' | 'md' | 'lg', ViewStyle>>({
  // sm `!h-7 !w-7 !p-0`
  sm: {height: 28, width: 28, padding: 0},
  // md `h-10 px-4`
  md: {height: 40, paddingHorizontal: 16},
  // lg `h-12 px-6`
  lg: {height: 48, paddingHorizontal: 24},
});

export default FullscreenButton;
