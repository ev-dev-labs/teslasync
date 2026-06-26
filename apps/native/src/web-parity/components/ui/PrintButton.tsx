// Native parity port of web/src/components/ui/PrintButton.tsx.
//
// On the web `PrintButton` opens the browser print dialog via `window.print()`
// from inside a `requestAnimationFrame` callback, after awaiting an optional
// `beforePrint` setup hook (used to expand collapsed panels / switch tabs so
// the right content lands on paper). It renders the shared ghost `<Button>`
// with a lucide `Printer` icon and carries `data-print-hide` so the web
// `@media print` stylesheet hides the trigger itself.
//
// React Native has NO `window.print` and no `@media print` stylesheet (rules
// 4/7): on a true native target (iOS / Android / Windows / macOS) there is no
// system print dialog reachable from JS, so printing is UNAVAILABLE. The
// native-safe mapping makes that explicit rather than silently pretending to
// print:
//   - `performPrint()` invokes the real global `print()` ONLY when it exists.
//     Under react-native-web (`npm run web:dev`) the DOM `window.print` is
//     present and is called verbatim, so the exact web behaviour is preserved
//     where a DOM exists. On true native `print` is absent, so `performPrint()`
//     returns false — the explicit unavailable state required by rule 7 — and
//     the optional `onUnavailable` callback fires so callers can surface a
//     "printing isn't available here" affordance.
//   - The full control flow is preserved verbatim: the `printing` re-entrancy
//     guard, `setPrinting(true)`, the awaited `beforePrint()`, the
//     `requestAnimationFrame` one-paint-cycle deferral (via `scheduleFrame`,
//     which falls back to a microtask in runtimes/tests without frame
//     scheduling, mirroring the useLogStream port), the `try/finally` that
//     always runs `setPrinting(false)`, and the `catch` that logs
//     `console.error('PrintButton: beforePrint failed', err)`. State names
//     (`printing` / `setPrinting`) and the i18n key+fallback
//     (`common.printButton.print` / 'Print') are kept identical.
//
// Visual intent: the web shared `<Button variant="ghost" size="sm">` host +
// lucide `Printer` icon + Tailwind classes become a `Pressable` containing an
// `AppText` printer glyph ('⎙', U+2399 PRINT SCREEN SYMBOL — monochrome, in
// keeping with the FullscreenButton glyph approach) and an optional `AppText`
// label. Tailwind -> px / tokens: base `inline-flex items-center justify-center
// gap-2 rounded-md font-medium` = row + center + gap 8 + radius 6 + weight 500;
// ghost `bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800` = transparent
// fill with a `colors.surfaceHover` pressed tint (matching the FullscreenButton
// port); `disabled:opacity-50` = opacity 0.5; icon `h-3.5 w-3.5` = 14. The
// `variant` / `size` overrides are honoured for every web value (primary /
// secondary / outline / danger / ghost; sm / md / lg / auto) so the prop
// contract is faithful. `cn` is dropped (no className on native); `className`
// is retained for source compatibility but ignored (`_className`), matching the
// Badge / FullscreenButton ports.
//
// Accessibility mapping: web `aria-label={resolvedAriaLabel}` (which is
// `ariaLabel ?? (iconOnly ? printLabel : undefined)`) -> `accessibilityLabel`
// with the identical resolution; when not iconOnly the visible label text
// supplies the accessible name. `disabled` -> Pressable `disabled` +
// `accessibilityState.disabled` + opacity 0.5. The web `type="button"` (form
// semantics) and `data-print-hide` (`@media print` hide) have no React Native
// analog and are intentionally omitted (documented in the sidecar).

import React, {useCallback, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {colors} from '../../../theme/tokens';
import {AppText} from '../../../components/ui/AppText';

// Web `variant` / `size` were typed off the shared Button's prop union. Native
// has no ported Button host, so the unions are reproduced locally with the same
// member names to keep the PrintButton prop contract identical.
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'danger'
  | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'auto';

export interface PrintButtonProps {
  /** Override the default "Print" label. */
  label?: string;
  /** Show only the printer icon (no text). */
  iconOnly?: boolean;
  /**
   * Optional setup hook. Run before opening the print dialog (e.g. expand
   * collapsed sections). Sync or async — printing is deferred to the next
   * animation frame so state updates have a chance to commit.
   */
  beforePrint?: () => void | Promise<void>;
  /** Variant override; defaults to 'ghost'. */
  variant?: ButtonVariant;
  /** Size override; defaults to 'sm'. */
  size?: ButtonSize;
  /** Optional aria-label override (auto-derived from label in iconOnly mode). */
  ariaLabel?: string;
  /** Disable the trigger (e.g. while data is still loading). */
  disabled?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override merged onto the underlying Pressable. */
  style?: StyleProp<ViewStyle>;
  /** Maps the web button host; surfaced for native test/automation hooks. */
  testID?: string;
  /**
   * Native-only escape hatch. Invoked when printing is UNAVAILABLE on the
   * current platform (true native has no `window.print`). Lets callers show a
   * "printing isn't available on this device" affordance. No-op where a real
   * print dialog exists (react-native-web), since `window.print()` runs instead.
   */
  onUnavailable?: () => void;
}

// ── Local i18n fallback ───────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation()` so the call site is unchanged.
type TFn = (key: string, fallback: string) => string;

function useTranslation(): {t: TFn} {
  const t = useCallback<TFn>((_key, fallback) => fallback, []);
  return {t};
}

// Web called `window.print()`. React Native has no `window.print`: on a true
// native target printing is unavailable, so this returns false (the rule-7
// explicit unavailable state). Under react-native-web the real global `print`
// is present and is invoked verbatim, preserving the exact web behaviour where
// a DOM exists. Returns true only when a print dialog was actually opened.
function performPrint(): boolean {
  const printer = (globalThis as typeof globalThis & {print?: unknown}).print;
  if (typeof printer === 'function') {
    (printer as () => void)();
    return true;
  }
  return false;
}

// Mirrors the web `requestAnimationFrame(() => window.print())` deferral so
// React is given one paint cycle to flush pre-print state (expanded panels /
// switched tabs) before printing. Uses the global rAF when present (RN and
// react-native-web both provide it); falls back to a microtask in
// runtimes/tests without frame scheduling so `setPrinting(false)` still runs.
// Same shape as the useLogStream frame-scheduler port.
function scheduleFrame(callback: () => void): void {
  const raf = (
    globalThis as typeof globalThis & {requestAnimationFrame?: unknown}
  ).requestAnimationFrame;
  if (typeof raf === 'function') {
    (raf as (frame: () => void) => unknown)(() => {
      callback();
    });
    return;
  }
  void Promise.resolve().then(callback);
}

/**
 * `<PrintButton>` (native parity).
 *
 * Renders a ghost icon/label button that opens the print dialog for the current
 * view. On true native there is no `window.print`, so printing is a documented
 * unavailable operation (`onUnavailable` fires); under react-native-web the real
 * `window.print()` runs exactly as on the web. See the module header for the
 * full contract.
 */
export function PrintButton({
  label,
  iconOnly = false,
  beforePrint,
  variant = 'ghost',
  size = 'sm',
  ariaLabel,
  disabled,
  className: _className,
  style,
  testID,
  onUnavailable,
}: PrintButtonProps) {
  const {t} = useTranslation();
  const [printing, setPrinting] = useState(false);

  const printLabel = label ?? t('common.printButton.print', 'Print');

  const handleClick = useCallback(async () => {
    if (printing) {
      return;
    }
    setPrinting(true);
    try {
      if (beforePrint) {
        await beforePrint();
      }
      // Give React one paint cycle to flush any pre-print state updates
      // (expanded panels, switched tabs) before the print snapshot.
      scheduleFrame(() => {
        try {
          const printed = performPrint();
          if (!printed) {
            // No global print on this platform (true native): printing is
            // unavailable. Surface the explicit unavailable state to the caller.
            onUnavailable?.();
          }
        } finally {
          setPrinting(false);
        }
      });
    } catch (err) {
      console.error('PrintButton: beforePrint failed', err);
      setPrinting(false);
    }
  }, [beforePrint, printing, onUnavailable]);

  const resolvedAriaLabel = ariaLabel ?? (iconOnly ? printLabel : undefined);

  const tint = variants[variant] ?? variants.ghost;
  const sizing = sizes[size] ?? sizes.sm;
  const labelStyle: StyleProp<TextStyle> = {
    color: tint.text,
    fontSize: sizing.fontSize,
    lineHeight: sizing.lineHeight,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={resolvedAriaLabel}
      accessibilityState={{disabled: Boolean(disabled)}}
      disabled={disabled}
      onPress={handleClick}
      testID={testID}
      style={({pressed}) => [
        styles.base,
        {
          backgroundColor: pressed && !disabled ? tint.pressedBg : tint.bg,
          paddingHorizontal: sizing.paddingHorizontal,
          height: sizing.height,
          minHeight: sizing.minHeight,
        },
        tint.borderColor
          ? {borderWidth: 1, borderColor: tint.borderColor}
          : null,
        disabled ? styles.disabled : null,
        style,
      ]}>
      <AppText allowFontScaling={false} style={[styles.icon, {color: tint.text}]}>
        {'\u2399'}
      </AppText>
      {iconOnly ? null : (
        <AppText style={[styles.label, labelStyle]}>{printLabel}</AppText>
      )}
    </Pressable>
  );
}

PrintButton.displayName = 'PrintButton';

interface VariantStyle {
  /** Native fill (web variant `bg-*`). */
  bg: string;
  /** Pressed fill (web `hover:bg-*`). */
  pressedBg: string;
  /** Icon + label colour (web variant `text-*`, inherited for ghost/outline). */
  text: string;
  /** Outline border colour (web `border-*`); omitted for fill variants. */
  borderColor?: string;
}

// Dark-mode Tailwind hex for each web Button variant — the native app renders
// on a dark surface, so the `dark:` tints are the canonical render.
const variants: Record<ButtonVariant, VariantStyle> = {
  // bg-blue-600 text-white hover:bg-blue-700
  primary: {bg: '#2563eb', pressedBg: '#1d4ed8', text: '#ffffff'},
  // dark:bg-gray-700 dark:text-gray-100 hover:bg-gray-200
  secondary: {bg: '#374151', pressedBg: '#4b5563', text: '#f3f4f6'},
  // border dark:border-gray-600 bg-transparent hover:bg-gray-50
  outline: {
    bg: 'transparent',
    pressedBg: colors.surfaceHover,
    text: colors.textPrimary,
    borderColor: '#4b5563',
  },
  // bg-red-600 text-white hover:bg-red-700
  danger: {bg: '#dc2626', pressedBg: '#b91c1c', text: '#ffffff'},
  // bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 (ghost inherits text)
  ghost: {bg: 'transparent', pressedBg: colors.surfaceHover, text: colors.textSecondary},
};

interface SizeStyle {
  /** Fixed row height (web `h-*`); undefined for the density-aware `auto`. */
  height?: number;
  /** Minimum row height for `auto` (web `min-h-d-row`). */
  minHeight?: number;
  paddingHorizontal: number;
  fontSize: number;
  lineHeight: number;
}

const sizes: Record<ButtonSize, SizeStyle> = {
  // h-8 px-3 text-xs
  sm: {height: 32, paddingHorizontal: 12, fontSize: 12, lineHeight: 16},
  // h-10 px-4 text-sm
  md: {height: 40, paddingHorizontal: 16, fontSize: 14, lineHeight: 20},
  // h-12 px-6 text-base
  lg: {height: 48, paddingHorizontal: 24, fontSize: 16, lineHeight: 24},
  // Density-aware on web (min-h-d-row px-d-pad-x text-d-base). Native has no
  // CSS-variable density cascade, so it resolves to the default "comfortable"
  // density (row 40, pad-x 1rem = 16, base 14).
  auto: {minHeight: 40, paddingHorizontal: 16, fontSize: 14, lineHeight: 20},
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center', // items-center
    flexDirection: 'row',
    gap: 8, // gap-2
    justifyContent: 'center', // justify-center
    borderRadius: 6, // rounded-md
  },
  disabled: {
    opacity: 0.5, // disabled:opacity-50
  },
  icon: {
    fontSize: 14, // h-3.5 w-3.5
    lineHeight: 14,
  },
  label: {
    fontWeight: '500', // font-medium
  },
});

export default PrintButton;
