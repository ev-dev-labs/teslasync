// Native parity port of web/src/components/ui/Select.tsx.
//
// The web module is the labelled form `<select>` primitive: an optional
// <Label> (with required marker + optional <HelpIcon>), a native HTML
// `<select>` with a placeholder + `<option>` list, an optional inline error,
// and an optional hint — across four sizing scales (sm/md/lg/auto). Prop names
// (`options`, `label`, `help`, `error`, `hint`, `placeholder`, `size`,
// `className`, `id`, `required`), the `SelectOption` shape, the
// `selectId = id || label?.toLowerCase().replace(/\s+/g, '-')` derivation, the
// placeholder-as-empty-value-option behavior, and the i18n intent are all
// preserved.
//
// DOM/web-only pieces and their native mappings:
//   - The HTML `<select>` / `<option>` elements (L56-79) have no React Native
//     analog. RN core ships no Picker; the control is reproduced as a tap
//     trigger (showing the selected option label or the placeholder) that opens
//     a transparent <Modal> list of option rows. Selecting a row mirrors the
//     web "pick an option" behavior and closes the sheet, with a ✓ on the
//     current value. The placeholder is rendered as the web `<option value="">`
//     is — a selectable first row whose value is the empty string.
//   - The DOM `onChange(ChangeEvent<HTMLSelectElement>)` callback has no native
//     analog (there is no DOM event / `e.target.value`); it is replaced by the
//     RN-idiomatic `onValueChange(value: string)`. The web `value` /
//     `defaultValue` controlled/uncontrolled contract is preserved, including
//     the DOM default of selecting the first option when uncontrolled with no
//     placeholder and no `defaultValue`.
//   - `forwardRef<HTMLSelectElement>` (L39) -> `forwardRef<View>`; the ref now
//     points at the trigger (the closest native handle to the control).
//   - `react-i18next` is not installed on native; the web <Label>'s
//     `t('form.required', 'required')` is reproduced via a local `translate`
//     shim, preserving the key + English default. The shared web <Label> and
//     <HelpIcon> dependencies (L3-4): <Label> is inlined (it is a thin
//     required-marker wrapper and is not yet ported), and <HelpIcon> uses the
//     already-ported native `./HelpIcon`.
//   - The `cn` class merge (L2), all Tailwind classes (L32-37, L43-81), CSS
//     vars (--text-primary/-secondary/-muted, --surface-1, --glass-border, --bg)
//     and the `focus:ring` / `disabled:cursor-not-allowed` affordances have no
//     native analog: they map to StyleSheet + theme tokens, with the blue focus
//     ring rendered as an accent trigger border while the sheet is open. The DOM
//     a11y hooks (`aria-required`/`aria-invalid`/`aria-describedby`) map to RN
//     `accessibilityLabel` (incl. "required"), `accessibilityValue`, and
//     `accessibilityHint`; `className` is accepted-but-ignored for source
//     compatibility. See the .parity.json sidecar for the line-by-line map.

import React, {forwardRef, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';
import {HelpIcon, type HelpIconProps} from './HelpIcon';

// --- Local i18n shim: preserves the web <Label> `t(key, default)` contract
// without react-i18next (not installed on native). ---
function translate(_key: string, defaultValue: string): string {
  return defaultValue;
}

// Tailwind red-500 / rose-300 are palette colors (not CSS vars), pinned to their
// hex so the error border/text + required marker match the web exactly.
const RED_500 = '#ef4444';
const ROSE_300 = '#fda4af';
// Web focus:ring-blue-500 — rendered as an accent trigger border while open.
const BLUE_500 = '#3b82f6';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Sizing scale. Mirrors the web union; `'auto'` follows the user's `ui_density`
 *  on web via density-aware Tailwind utilities — native has no density sync, so
 *  it falls back to the `'md'` scale. */
export type SelectSize = 'sm' | 'md' | 'lg' | 'auto';

export interface SelectProps {
  options: SelectOption[];
  label?: string;
  /**
   * Optional `<HelpIcon>` rendered immediately after the label. The HelpIcon's
   * `for` defaults to the select's resolved id so assistive tech announces
   * "Help for {{id}}" when the trigger is focused.
   */
  help?: Omit<HelpIconProps, 'for'> & {for?: string};
  error?: string;
  hint?: string;
  placeholder?: string;
  /**
   * Sizing scale. Defaults to `'md'` for back-compat. `'auto'` falls back to
   * `'md'` on native (no density sync).
   */
  size?: SelectSize;
  /** Controlled selected value (matches the web `<select value>`). */
  value?: string;
  /** Uncontrolled initial value (matches the web `<select defaultValue>`). */
  defaultValue?: string;
  /**
   * Native replacement for the DOM `onChange(ChangeEvent)` — there is no DOM
   * event on native, so the picked option's value is passed directly.
   */
  onValueChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  /** Web `<select name>`. Retained for source compatibility; unused on native. */
  name?: string;
  /** Web Tailwind className. Retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `<Select>` — labelled form select primitive (native parity).
 *
 * Renders an optional label (with required marker + HelpIcon), a tap trigger
 * showing the current selection or placeholder, and optional error / hint text.
 * Tapping the trigger opens a modal option list; the web native `<select>`
 * dropdown has no RN analog, so the list is reproduced with RN primitives. See
 * the file header and .parity.json sidecar for the per-line map.
 */
export const Select = forwardRef<View, SelectProps>(function Select(
  {
    options,
    label,
    help,
    error,
    hint,
    placeholder,
    size = 'md',
    value,
    defaultValue,
    onValueChange,
    required,
    disabled,
    name: _name,
    className: _className,
    style,
    testID,
  },
  ref,
) {
  const t = translate;
  const selectId = id(label);
  const [open, setOpen] = useState(false);

  // Mirror the DOM default: an uncontrolled <select> with no placeholder and no
  // defaultValue selects its first option; a placeholder occupies the empty
  // value, so it is the initial selection when present.
  const [internalValue, setInternalValue] = useState<string>(
    defaultValue ??
      (placeholder !== undefined ? '' : options[0]?.value ?? ''),
  );
  const selectedValue = value !== undefined ? value : internalValue;
  const selectedOption = options.find(opt => opt.value === selectedValue);
  const displayText = selectedOption?.label ?? placeholder ?? '';
  const showingPlaceholder = !selectedOption;

  const requiredText = required ? t('form.required', 'required') : '';
  const triggerLabel =
    [label ?? placeholder, requiredText].filter(Boolean).join(', ') ||
    undefined;
  const describedBy = error ?? hint;

  const handleSelect = (next: string) => {
    if (value === undefined) {
      setInternalValue(next);
    }
    onValueChange?.(next);
    setOpen(false);
  };

  return (
    <View style={[styles.root, style]} testID={testID}>
      {label ? (
        <View style={styles.labelRow}>
          <AppText
            nativeID={selectId}
            style={styles.labelText}
            weight="semibold">
            {label}
            {required ? (
              <AppText accessible={false} style={styles.requiredMark}>
                {' *'}
              </AppText>
            ) : null}
          </AppText>
          {help ? <HelpIcon {...help} for={help.for ?? selectId} /> : null}
        </View>
      ) : null}

      <Pressable
        ref={ref}
        accessibilityRole="button"
        accessibilityState={{expanded: open, disabled: Boolean(disabled)}}
        accessibilityLabel={triggerLabel}
        accessibilityValue={{text: displayText}}
        accessibilityHint={describedBy}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({pressed}) => [
          styles.trigger,
          sizeStyles[size],
          open && styles.triggerFocused,
          pressed && !disabled && styles.triggerFocused,
          error ? styles.triggerError : null,
          disabled && styles.triggerDisabled,
        ]}>
        <AppText
          numberOfLines={1}
          style={[
            styles.triggerText,
            textSizeStyles[size],
            showingPlaceholder && styles.placeholderText,
          ]}>
          {displayText}
        </AppText>
        <AppText
          accessible={false}
          style={[styles.chevron, textSizeStyles[size]]}>
          ▾
        </AppText>
      </Pressable>

      {error ? (
        <AppText
          nativeID={selectId ? `${selectId}-error` : undefined}
          style={styles.errorText}>
          {error}
        </AppText>
      ) : null}
      {hint && !error ? (
        <AppText
          nativeID={selectId ? `${selectId}-hint` : undefined}
          style={styles.hintText}>
          {hint}
        </AppText>
      ) : null}

      {open ? (
        <Modal
          transparent
          visible
          animationType="fade"
          onRequestClose={() => setOpen(false)}>
          <Pressable
            style={styles.backdrop}
            accessibilityLabel={t('common.close', 'Close')}
            onPress={() => setOpen(false)}
          />
          <View style={styles.positioner} pointerEvents="box-none">
            <View
              accessibilityRole="menu"
              accessibilityLabel={triggerLabel}
              style={styles.sheet}>
              <ScrollView contentContainerStyle={styles.sheetContent}>
                {placeholder !== undefined ? (
                  <OptionRow
                    label={placeholder}
                    selected={selectedValue === ''}
                    isPlaceholder
                    onPress={() => handleSelect('')}
                  />
                ) : null}
                {options.map(opt => (
                  <OptionRow
                    key={opt.value}
                    label={opt.label}
                    selected={opt.value === selectedValue}
                    disabled={opt.disabled}
                    onPress={() => handleSelect(opt.value)}
                  />
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
});

Select.displayName = 'Select';

/** Resolve the web `id || label?.toLowerCase().replace(/\s+/g, '-')`. */
function id(label?: string): string | undefined {
  return label?.toLowerCase().replace(/\s+/g, '-');
}

interface OptionRowProps {
  label: string;
  selected: boolean;
  disabled?: boolean;
  isPlaceholder?: boolean;
  onPress: () => void;
}

function OptionRow({
  label,
  selected,
  disabled,
  isPlaceholder,
  onPress,
}: OptionRowProps) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityState={{selected, disabled: Boolean(disabled)}}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.optionRow,
        selected && styles.optionRowSelected,
        pressed && !disabled && styles.optionRowPressed,
        disabled && styles.optionRowDisabled,
      ]}>
      <AppText
        numberOfLines={1}
        style={[
          styles.optionLabel,
          isPlaceholder && styles.placeholderText,
        ]}>
        {label}
      </AppText>
      {selected ? (
        <AppText accessible={false} style={styles.check}>
          ✓
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 4, // space-y-1
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4, // gap-1
  },
  labelText: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
    lineHeight: 18,
  },
  requiredMark: {
    color: ROSE_300, // text-rose-300
    fontWeight: '500',
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.surface, // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%', // w-full
  },
  triggerFocused: {
    borderColor: BLUE_500, // focus:ring-blue-500 intent
  },
  triggerError: {
    borderColor: RED_500, // border-red-500
  },
  triggerDisabled: {
    opacity: 0.5, // disabled:opacity-50
  },
  triggerText: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    flexShrink: 1,
  },
  placeholderText: {
    color: colors.textMuted, // --text-muted
  },
  chevron: {
    color: colors.textMuted,
    marginLeft: 8,
  },
  errorText: {
    color: RED_500, // text-red-500
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  hintText: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  positioner: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 8,
    maxHeight: '70%',
    maxWidth: 420,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.4,
    shadowRadius: 16,
    width: '100%',
  },
  sheetContent: {
    paddingVertical: 4,
  },
  optionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionRowSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  optionRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionRowDisabled: {
    opacity: 0.5,
  },
  optionLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
  },
  check: {
    color: colors.accent,
    fontSize: 14,
  },
});

const sizeStyles = StyleSheet.create<Record<SelectSize, ViewStyle>>({
  // px-2 py-1.5
  sm: {paddingHorizontal: 8, paddingVertical: 6},
  // px-3 py-2
  md: {paddingHorizontal: 12, paddingVertical: 8},
  // px-4 py-2.5
  lg: {paddingHorizontal: 16, paddingVertical: 10},
  // density-aware px-d-pad-x/py-d-pad-y -> md fallback on native
  auto: {paddingHorizontal: 12, paddingVertical: 8},
});

const textSizeStyles = StyleSheet.create<Record<SelectSize, TextStyle>>({
  sm: {fontSize: 12}, // text-xs
  md: {fontSize: 14}, // text-sm
  lg: {fontSize: 16}, // text-base
  auto: {fontSize: 14}, // text-d-base -> md fallback
});
