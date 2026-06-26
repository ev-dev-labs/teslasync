// Native parity port of web/src/components/ui/DataTableBulkBar.tsx.
//
// The web component is the selection toolbar shown above a table when at least
// one row is selected: a `role="region"` <div> styled by `tableTokens.bulkBar`
// that holds a `{{count}} selected` <span aria-live="polite">, a caller-supplied
// `children` slot for bulk actions (Export/Delete/Archive/…), and a trailing
// "Clear selection" <button> (lucide `X` glyph + label). It is reproduced here
// with React Native primitives:
//
//   - The DOM `<div role="region">` becomes a styled `View` with
//     `accessibilityRole="toolbar"` (RN has no `region` landmark; `toolbar` is
//     the closest semantic for a bulk-action bar) plus the preserved
//     `aria-label` -> `accessibilityLabel`. It is intentionally NOT marked
//     `accessible`, so the caller's `children` action buttons + the Clear button
//     stay individually focusable (matching the web region, which does not trap
//     focus).
//   - `tableTokens.bulkBar`
//     (`flex flex-wrap items-center gap-2 px-3 py-2 mb-2 rounded-lg
//      border border-cyan-500/20 bg-cyan-500/[0.06] text-sm
//      text-[var(--text-primary)]`) becomes the `styles.bar` StyleSheet. The
//     web's explicit cyan-500 is preserved verbatim as literal rgba (border .2,
//     surface .06) the same way the native Button port kept Tailwind hex.
//   - The `<span aria-live="polite">` count becomes an `AppText` with
//     `accessibilityLiveRegion="polite"` (the direct RN analog) at text-sm 14px
//     font-medium 500. The i18next interpolation `t(key, '{{count}} selected',
//     { count })` is preserved by a local t() shim that returns the English
//     fallback and resolves `{{count}}` — react-i18next is unavailable in native
//     parity, so keys + fallback copy are kept verbatim.
//   - The `ml-auto flex flex-wrap items-center gap-2` wrapper becomes
//     `styles.actions` (marginLeft:'auto' pushes it to the trailing edge); the
//     `children` slot renders as-is.
//   - The DOM `<button>` becomes a `Pressable` (accessibilityRole="button" +
//     the preserved aria-label). `hover:text/bg` (no native hover) map to the
//     Pressable `pressed` state; `focus-visible:ring*`/`transition-colors` are
//     browser-only and dropped. The lucide `X` (`h-3 w-3`, aria-hidden) becomes
//     a decorative `\u2715` glyph in an `AppText` flagged
//     `importantForAccessibility="no"`.
//   - The web `className` styling channel is retained on props for source
//     compatibility (ignored on native) and replaced by a native `style` prop
//     merged last so callers win.

import React, {useCallback, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

type TranslationValues = {count?: number};

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

export interface DataTableBulkBarProps {
  count: number;
  onClear: () => void;
  children?: ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override merged last onto the bar container. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the i18n keys and `{{count}}` intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name as keyof TranslationValues];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

/**
 * Selection toolbar shown above the table when at least one row is selected.
 * The consumer renders bulk actions (Export, Delete, Archive, …) into the
 * `children` slot. Always provides a "Clear selection" button + count.
 *
 * Wrap destructive bulk actions in a native confirmation flow (see the native
 * BulkActionsToolbar port / TABLE_GUIDELINES.md).
 */
export function DataTableBulkBar({
  count,
  onClear,
  children,
  className: _className,
  style,
  testID,
}: DataTableBulkBarProps) {
  const t = useNativeTranslationFallback();

  if (count <= 0) {
    return null;
  }

  const clearLabel = t('table.bulkActions.clear', 'Clear selection');

  return (
    <View
      accessibilityLabel={t('table.bulkActions.region', 'Bulk actions')}
      accessibilityRole="toolbar"
      style={[styles.bar, style]}
      testID={testID}>
      <AppText accessibilityLiveRegion="polite" style={styles.count}>
        {t('table.bulkActions.selected', '{{count}} selected', {count})}
      </AppText>
      <View style={styles.actions}>
        {children}
        <Pressable
          accessibilityLabel={clearLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onClear}
          style={({pressed}) => [styles.clear, pressed && styles.clearPressed]}>
          {({pressed}) => (
            <>
              <AppText
                importantForAccessibility="no"
                style={[styles.clearIcon, pressed && styles.clearTextPressed]}>
                {'\u2715'}
              </AppText>
              <AppText
                style={[styles.clearText, pressed && styles.clearTextPressed]}>
                {clearLabel}
              </AppText>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

DataTableBulkBar.displayName = 'DataTableBulkBar';

// cyan-500 from the web `tableTokens.bulkBar`, preserved as literal rgba.
const CYAN_500_BORDER = 'rgba(6, 182, 212, 0.2)';
const CYAN_500_SURFACE = 'rgba(6, 182, 212, 0.06)';
// hover:bg-white/[0.06] -> the Pressable pressed surface.
const HOVER_SURFACE = 'rgba(255, 255, 255, 0.06)';

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginLeft: 'auto',
  },
  bar: {
    alignItems: 'center',
    backgroundColor: CYAN_500_SURFACE,
    borderColor: CYAN_500_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  clear: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  clearIcon: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  clearPressed: {
    backgroundColor: HOVER_SURFACE,
  },
  clearText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  clearTextPressed: {
    color: colors.textPrimary,
  },
  count: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
