// Native parity port of web/src/components/ui/Label.tsx.
//
// The web `Label` (L42-65) is a form `<label>` primitive with visible +
// accessible required indicators. It renders an HTML `<label>` (L50) carrying
// `{children}`; when `required` (L52) is set it appends (1) a red `*` glyph in a
// `<span aria-hidden="true" className="text-rose-300">` (L55-57) so screen
// readers don't announce "asterisk", and (2) a `<VisuallyHidden>` span (L58)
// holding the i18n string `form.required` so the paired control's accessible
// name reads e.g. "Email required" (WCAG 3.3.2). The module doc (L1-24) also
// notes this is semantically distinct from the span-based Typography `Label`.
//
// Native-safe mapping (rules 4/5/7):
//   - DOM types/elements have no native analog. `LabelHTMLAttributes<HTMLLabelElement>`
//     (L26/L32) -> `Omit<ViewProps,'style'>` + an explicit web-compat surface
//     (className/htmlFor/id/onClick/data-testid) retained for source
//     compatibility. The `<label>` host (L50) -> a `<View>` (the label block).
//   - `cn` from @/lib/cn (L30) is dropped: React Native has no className, so the
//     consumer's Tailwind classes (e.g. the Input port passes
//     "text-sm font-medium text-[var(--text-secondary)]") map to the native
//     `style` prop applied to the label text. `className` is kept on props but
//     ignored (`_className`), matching the Badge / FullscreenButton ports. The
//     web `<label>` itself has no intrinsic typography, so the native label text
//     inherits the AppText body defaults unless the caller supplies `style`.
//   - react-i18next `useTranslation` (L27) is absent from apps/native deps -> a
//     local fallback hook returning the inline English fallback, with the same
//     `const { t } = useTranslation()` call shape (same approach as the
//     FullscreenButton / DataTable ports). The `form.required` key is referenced
//     verbatim so i18n intent is preserved.
//   - `VisuallyHidden` from @/components/a11y (L29) -> the already-ported native
//     `VisuallyHidden` (../a11y/VisuallyHidden), which reproduces the sr-only
//     intent with an absolutely-positioned 1x1 opacity-0 Text that screen
//     readers still announce. Rendered as a sibling under the root View (not
//     nested inside the label Text) so its absolute positioning takes it cleanly
//     out of flow without disturbing the inline label.
//   - The aria-hidden `*` (L55-57) -> a sibling `AppText` glyph tinted
//     text-rose-300 (#fda4af) and flagged `accessibilityElementsHidden` +
//     `importantForAccessibility="no-hide-descendants"` (the native equivalent
//     of aria-hidden) so it is not announced. The web `{' '}` whitespace text
//     node (L54) between the label and the glyph maps to a 4px `marginLeft`.
//
// Accessibility note: the web label ties to a control via `htmlFor`, so the
// control announces the single concatenated name "<label> required". React
// Native has no `htmlFor` label-control association, so the label text and the
// sr-only "required" are exposed as adjacent accessible elements ("<label>",
// then "required") near the control — the closest native approximation. The
// `*` glyph stays visible-but-unannounced, preserving the visible + a11y
// required-marker intent. `htmlFor` is retained on props but is a documented
// no-op; `id` maps to the root View `nativeID`.

import React, {useCallback, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewProps,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {VisuallyHidden} from '../a11y/VisuallyHidden';

// ── Local i18n fallback ───────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation()` so the call site is unchanged.
type TFn = (key: string, fallback: string) => string;

function useTranslation(): {t: TFn} {
  const t = useCallback<TFn>((_key, fallback) => fallback, []);
  return {t};
}

export interface LabelProps extends Omit<ViewProps, 'style'> {
  /**
   * When true, renders a visible `*` (not announced) AND a screen-reader-only
   * "required" string so the label reads "<label> required".
   */
  required?: boolean;
  children?: ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /**
   * Web `<label htmlFor>` control association. React Native has no label↔control
   * id association, so this is retained for source compatibility but is a no-op.
   */
  htmlFor?: string;
  /** Web `id`; maps to the root View `nativeID`. */
  id?: string;
  /**
   * Web `onClick` retained for source compatibility. A native form label is
   * non-interactive (there is no control to focus), so this is not wired.
   */
  onClick?: (event: GestureResponderEvent) => void;
  /** Native style override applied to the label text. */
  style?: StyleProp<TextStyle>;
  /** Maps the web `data-testid`. */
  'data-testid'?: string;
}

export function Label({
  required,
  children,
  className: _className,
  htmlFor: _htmlFor,
  id,
  nativeID,
  onClick: _onClick,
  style,
  testID,
  'data-testid': dataTestID,
  ...rest
}: LabelProps) {
  const {t} = useTranslation();
  return (
    <View
      {...rest}
      nativeID={id ?? nativeID}
      testID={testID ?? dataTestID}
      style={styles.root}>
      <AppText style={style}>{children}</AppText>
      {required ? (
        <>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.asterisk}>
            *
          </AppText>
          <VisuallyHidden>{` ${t('form.required', 'required')}`}</VisuallyHidden>
        </>
      ) : null}
    </View>
  );
}

Label.displayName = 'Label';

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
  },
  asterisk: {
    color: '#fda4af', // text-rose-300
    marginLeft: 4, // the web `{' '}` whitespace node between label and glyph
  },
});

export default Label;
