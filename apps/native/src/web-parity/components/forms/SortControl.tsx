// Native parity port of web/src/components/forms/SortControl.tsx.
//
// The web control is a `[▾ Field name] [↓]` cluster: a `<Select>` dropdown that
// changes which field a list is sorted by, plus a direction toggle button whose
// arrow (lucide `ArrowUp` / `ArrowDown`) lets the user read the current
// asc/desc state at a glance. It is reproduced here with React Native
// primitives:
//
//   - The web `@/components/ui/Select` (a DOM `<select>`) is browser-only and is
//     replaced by a trigger `Pressable` that shows the active option label plus
//     a caret, opening a `Modal` option list (the same pattern as the native
//     ChartExportMenu port). Picking an option fires `onFieldChange`, preserving
//     the web `onChange` behaviour.
//   - The lucide `ArrowUp` / `ArrowDown` icons become semantic arrow glyphs
//     (`↑` / `↓`) rendered in an `AppText`, matching the native TransitionArrow
//     approach (lucide is unavailable in native parity).
//   - react-i18next `useTranslation` is unavailable in native parity; the
//     fallback copy is rendered directly via a local t() shim so the visible
//     strings and i18n keys are preserved verbatim.
//   - The web `title` tooltip (current direction) has no native equivalent and
//     is mapped to the toggle's `accessibilityHint` so the state is still
//     announced. The Tailwind `className` override is retained for source
//     compatibility but ignored on native; callers pass `style` instead.

import React, {useCallback, useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

export type SortDirection = 'asc' | 'desc';

export interface SortOption<F extends string = string> {
  /** Stable field key (also used in URL state). */
  value: F;
  /** Localised, user-visible label. */
  label: string;
}

export interface SortControlProps<F extends string = string> {
  /** Currently selected sort field. */
  field: F;
  /** Currently selected direction. */
  direction: SortDirection;
  options: readonly SortOption<F>[];
  onFieldChange: (field: F) => void;
  onDirectionChange: (dir: SortDirection) => void;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override on the outer row. */
  style?: StyleProp<ViewStyle>;
  testId?: string;
  /** Optional explicit accessible label for the direction button. */
  directionAriaLabel?: string;
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * `SortControl` — field dropdown + direction toggle (with arrow indicator).
 *
 * Renders as: [▾ Field name] [↓]
 *   - Field dropdown changes which column the list is sorted by
 *   - Direction toggle flips ascending / descending and shows an arrow
 *     (so users can read the current state at a glance, per UX critique)
 *
 * Generic over the field type so callers can use a string-literal union
 * (e.g. `'date' | 'distance' | 'score'`) for type-safety on URL parsing.
 */
export function SortControl<F extends string = string>({
  field,
  direction,
  options,
  onFieldChange,
  onDirectionChange,
  className: _className,
  style,
  testId,
  directionAriaLabel,
}: SortControlProps<F>) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);

  const flip = useCallback(
    () => onDirectionChange(direction === 'asc' ? 'desc' : 'asc'),
    [direction, onDirectionChange],
  );

  const dirLabel =
    direction === 'asc'
      ? t('sortControl.ascending', 'Ascending')
      : t('sortControl.descending', 'Descending');

  const fieldLabel = t('sortControl.fieldLabel', 'Sort by');
  const selected = options.find(option => option.value === field);
  const selectedLabel = selected?.label ?? field;
  const directionLabel =
    directionAriaLabel ??
    `${t('sortControl.direction', 'Sort direction')}: ${dirLabel}`;

  const close = useCallback(() => setOpen(false), []);
  const pick = useCallback(
    (value: F) => {
      onFieldChange(value);
      setOpen(false);
    },
    [onFieldChange],
  );

  return (
    <View style={[styles.root, style]} testID={testId}>
      <Pressable
        accessibilityLabel={fieldLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        hitSlop={4}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.field, pressed && styles.pressed]}
        testID={testId ? `${testId}-field` : undefined}>
        <AppText
          numberOfLines={1}
          style={styles.fieldText}
          variant="caption"
          weight="semibold">
          {selectedLabel}
        </AppText>
        <AppText style={styles.caret} variant="caption">
          {'\u25BE'}
        </AppText>
      </Pressable>

      <Pressable
        accessibilityHint={dirLabel}
        accessibilityLabel={directionLabel}
        accessibilityRole="button"
        hitSlop={4}
        onPress={flip}
        style={({pressed}) => [styles.direction, pressed && styles.pressed]}
        testID={testId ? `${testId}-direction` : undefined}>
        <AppText style={styles.arrow} variant="caption" weight="bold">
          {direction === 'asc' ? '\u2191' : '\u2193'}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel={t('sortControl.closeMenu', 'Close sort options')}
            accessibilityRole="button"
            onPress={close}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={fieldLabel}
            accessibilityRole="menu"
            style={styles.menu}
            testID={testId ? `${testId}-options` : undefined}>
            {options.map(option => {
              const active = option.value === field;
              return (
                <Pressable
                  accessibilityLabel={option.label}
                  accessibilityRole="menuitem"
                  accessibilityState={{selected: active}}
                  key={option.value}
                  onPress={() => pick(option.value)}
                  style={({pressed}) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.optionPressed,
                  ]}
                  testID={
                    testId ? `${testId}-option-${option.value}` : undefined
                  }>
                  <AppText
                    numberOfLines={1}
                    style={[
                      styles.optionText,
                      active && styles.optionTextActive,
                    ]}
                    variant="caption"
                    weight="semibold">
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

SortControl.displayName = 'SortControl';

const styles = StyleSheet.create({
  arrow: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 18,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  caret: {
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
  direction: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  field: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    maxWidth: 220,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  fieldText: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  menu: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.xs,
    maxWidth: 320,
    minWidth: 220,
    padding: spacing.xs,
    width: '78%',
  },
  option: {
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textSecondary,
  },
  optionTextActive: {
    color: colors.accent,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
