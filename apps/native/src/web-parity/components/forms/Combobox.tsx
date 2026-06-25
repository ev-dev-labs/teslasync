// Native parity port of web/src/components/forms/Combobox.tsx.
//
// WAI-ARIA combobox / autocomplete primitive. Implements the shared
// "type to filter then pick" pattern for signal pickers, geocoded address
// inputs, vehicle pickers, and similar UI. Centralising it gives us one place
// to get the keyboard and screen-reader contract right.
//
// The web a11y/selection contract is preserved as faithfully as the platform
// allows:
//   - role="combobox" / aria-expanded -> a TextInput carrying
//     accessibilityState={{expanded}} plus accessibilityLabel.
//   - role="listbox" + role="option" + aria-selected -> a View with
//     accessibilityRole="list" whose option rows are Pressables carrying
//     accessibilityState={{selected}}.
//   - The result-count live region keeps using the established native
//     announcer (announce(message) === polite priority).
//   - Selection / cancellation semantics are identical: the active descendant
//     defaults to the first row, Enter (onSubmitEditing) commits the
//     highlighted option or — when allowFreeText — the typed text, and closing
//     without committing reverts the visible text for uncontrolled inputs.
//   - On platforms that surface hardware key events through TextInput.onKeyPress
//     (RN-Windows / RN-macOS / RN-Web) the ArrowUp/ArrowDown/Home/End/Escape/Tab
//     contract is wired through as well; touch platforms drive the same state
//     by tapping rows, the chevron toggle, and the clear button.
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so the web useTranslation() `t` is
//     replaced by a native fallback that returns the English defaultValue and
//     interpolates `{{count}}` — the same i18n keys/copy are preserved.
//   - lucide-react ChevronDown / X (browser-only SVGs) become small text
//     glyphs inside accessible Pressables; aria-hidden -> accessible={false}.
//   - The @/lib/cn class-merge + Tailwind utility classes become React Native
//     StyleSheet styles + theme tokens; the optional `className` /
//     `inputClassName` overrides are accepted-but-ignored for source
//     compatibility and mirrored by native `style` / `inputStyle` props.
//   - The browser-only `document.addEventListener('mousedown', …)` outside-click
//     handler and the onBlur relatedTarget guard collapse into a single native
//     idiom: input blur schedules a deferred close that internal-control
//     onPressIn handlers cancel, so tapping a row / chevron / clear never closes
//     the list before its press resolves while a tap elsewhere still closes it.
//   - The async loader branch keeps its AbortController-per-keystroke contract.

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';
import {announce} from '../a11y/AnnouncerRegion';
import {VisuallyHidden} from '../a11y/VisuallyHidden';

/* ── Shared types ──────────────────────────────────────────────── */

/**
 * Options can be a static array or an async loader. The loader receives the
 * current input text and an `AbortSignal` that fires when a newer keystroke
 * arrives — implementations MUST forward the signal to fetch / cancellable
 * APIs to avoid races.
 */
export type ComboboxOptions<T> =
  | readonly T[]
  | ((query: string, signal: AbortSignal) => Promise<readonly T[]>);

export interface ComboboxProps<T> {
  /** Currently selected option (`null` = nothing selected). */
  value: T | null;
  /** Fired when the user picks an option (or clears the selection). */
  onChange: (value: T | null) => void;
  /** Static array OR async loader (see `ComboboxOptions`). */
  options: ComboboxOptions<T>;
  /** Returns the visible label for an option. */
  getOptionLabel: (option: T) => string;
  /** Returns a stable string key for an option (for React keys + ids). */
  getOptionKey: (option: T) => string;
  /**
   * Equality test used to highlight the currently-selected option in the
   * dropdown. Defaults to comparing keys via `getOptionKey`.
   */
  isOptionEqualToValue?: (a: T, b: T) => boolean;
  /**
   * Required visible OR accessibility label. Pair with `hideLabel` when the
   * surrounding context already names the field (e.g. inside a panel header).
   */
  label: string;
  /** When true, label is rendered visually-hidden (still announced). */
  hideLabel?: boolean;
  /** ID of an element that further describes the field (web parity only). */
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  /**
   * Override the loading indicator. When the options prop is a function this is
   * also derived from in-flight fetches; pass explicit `loading` for
   * parent-driven loading state.
   */
  loading?: boolean;
  /**
   * When true, submitting without an active option commits the raw typed text
   * via {@link onFreeTextCommit}. Used by inputs whose value is not constrained
   * to the options list (tag entry, address geocoding fallback).
   */
  allowFreeText?: boolean;
  /** Fired on free-text commit. Only meaningful when allowFreeText is true. */
  onFreeTextCommit?: (text: string) => void;
  /**
   * Controlled input text. When omitted, the component manages its own internal
   * text and resets to the selected option's label on close.
   */
  inputValue?: string;
  /** Fires whenever the user types (or clears). */
  onInputChange?: (text: string) => void;
  /** Cap visible options for performance. Defaults to 50. */
  maxVisibleOptions?: number;
  /** Custom option renderer (defaults to `getOptionLabel`). */
  renderOption?: (
    option: T,
    state: {active: boolean; selected: boolean},
  ) => ReactNode;
  /** Async fetch debounce in ms. Defaults to 200. Ignored for static arrays. */
  asyncDebounceMs?: number;
  /** Web wrapper className retained for source compatibility; ignored on native. */
  className?: string;
  /** Web input className retained for source compatibility; ignored on native. */
  inputClassName?: string;
  /** Native container style (RN equivalent of the web `className`). */
  style?: StyleProp<ViewStyle>;
  /** Native input style (RN equivalent of the web `inputClassName`). */
  inputStyle?: StyleProp<TextStyle>;
  /** Optional leading icon shown inside the input. */
  icon?: ReactNode;
  /** Hide the trailing chevron toggle. */
  noChevron?: boolean;
  /** When true, the input's clear (×) button is hidden. */
  noClearButton?: boolean;
}

type TranslationVars = Record<string, string | number | undefined>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

const CHEVRON_GLYPH = '\u25BE'; // ▾ — matches the lucide ChevronDown affordance.
const CLEAR_GLYPH = '\u2715'; // ✕ — matches the lucide X affordance.

/**
 * Native i18n fallback: react-i18next is not wired in native, so this returns
 * the English defaultValue and interpolates any `{{name}}` placeholders from
 * the optional vars — preserving the web i18n keys and copy verbatim.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TranslationVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = vars[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

/* ── Static-array filter (default behaviour) ──────────────────── */

function defaultFilter<T>(
  options: readonly T[],
  query: string,
  getLabel: (o: T) => string,
): readonly T[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return options;
  }
  return options.filter(o => getLabel(o).toLowerCase().includes(q));
}

/* ── Component ─────────────────────────────────────────────────── */

export function Combobox<T>({
  value,
  onChange,
  options,
  getOptionLabel,
  getOptionKey,
  isOptionEqualToValue,
  label,
  hideLabel = false,
  describedBy: _describedBy,
  placeholder,
  disabled = false,
  loading: loadingProp = false,
  allowFreeText = false,
  onFreeTextCommit,
  inputValue: inputValueProp,
  onInputChange,
  maxVisibleOptions = 50,
  renderOption,
  asyncDebounceMs = 200,
  className: _className,
  inputClassName: _inputClassName,
  style,
  inputStyle,
  icon,
  noChevron = false,
  noClearButton = false,
}: ComboboxProps<T>) {
  const t = useNativeTranslationFallback();

  const inputRef = useRef<TextInput>(null);
  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const labelId = `${generatedId}-label`;
  const listboxId = `${generatedId}-listbox`;
  const statusId = `${generatedId}-status`;

  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [internalText, setInternalText] = useState<string>(
    value ? getOptionLabel(value) : '',
  );
  const [asyncOptions, setAsyncOptions] = useState<readonly T[] | null>(null);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const lastAnnouncedRef = useRef<string>('');
  const blurCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Controlled vs uncontrolled input text. */
  const isInputControlled = inputValueProp !== undefined;
  const inputValue = isInputControlled ? inputValueProp ?? '' : internalText;

  /* Sync uncontrolled internal text when the selected value changes (e.g.
   * parent reset). Only runs while the input is closed so the user's
   * in-progress typing is never clobbered. */
  useEffect(() => {
    if (isInputControlled) {
      return;
    }
    if (open) {
      return;
    }
    setInternalText(value ? getOptionLabel(value) : '');
  }, [value, open, isInputControlled, getOptionLabel]);

  const isAsync = typeof options === 'function';

  /* Async options: re-fetch on inputValue change with debounced
   * abort-on-keystroke. Static-array branch never runs this effect. */
  useEffect(() => {
    if (!isAsync) {
      setAsyncOptions(null);
      setAsyncLoading(false);
      return;
    }
    if (!open && !inputValue) {
      // Don't fire fetches before the user opens the dropdown.
      return;
    }
    const controller = new AbortController();
    const debounceId = setTimeout(() => {
      setAsyncLoading(true);
      Promise.resolve(
        (options as (q: string, signal: AbortSignal) => Promise<readonly T[]>)(
          inputValue,
          controller.signal,
        ),
      )
        .then(next => {
          if (controller.signal.aborted) {
            return;
          }
          setAsyncOptions(next ?? []);
          setAsyncLoading(false);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          if (err && (err as {name?: string}).name === 'AbortError') {
            return;
          }
          setAsyncOptions([]);
          setAsyncLoading(false);
        });
    }, asyncDebounceMs);
    return () => {
      clearTimeout(debounceId);
      controller.abort();
    };
  }, [isAsync, options, inputValue, open, asyncDebounceMs]);

  const loading = loadingProp || asyncLoading;

  /* Compute the options visible in the dropdown right now. For the static-array
   * case we filter locally; the async case renders whatever the loader returned
   * (loaders own their own filtering). */
  const filteredOptions = useMemo<readonly T[]>(() => {
    if (isAsync) {
      return asyncOptions ?? [];
    }
    return defaultFilter(options as readonly T[], inputValue, getOptionLabel);
  }, [isAsync, asyncOptions, options, inputValue, getOptionLabel]);

  const visibleOptions = useMemo<readonly T[]>(
    () => filteredOptions.slice(0, maxVisibleOptions),
    [filteredOptions, maxVisibleOptions],
  );

  /* Announce result count (debounced via the natural async cycle) so
   * screen-reader users get "5 results" feedback as they type. */
  useEffect(() => {
    if (!open) {
      return;
    }
    if (loading) {
      return;
    }
    const count = filteredOptions.length;
    const message =
      count === 0
        ? t('combobox.noResults', 'No results')
        : count === 1
          ? t('combobox.resultsCountOne', '1 result')
          : t('combobox.resultsCount', '{{count}} results', {count});
    if (message !== lastAnnouncedRef.current) {
      lastAnnouncedRef.current = message;
      announce(message);
    }
  }, [open, loading, filteredOptions.length, t]);

  const eq = useCallback(
    (a: T, b: T): boolean => {
      if (isOptionEqualToValue) {
        return isOptionEqualToValue(a, b);
      }
      return getOptionKey(a) === getOptionKey(b);
    },
    [isOptionEqualToValue, getOptionKey],
  );

  /* Reset the active index whenever the visible options change so we never
   * point at a now-missing row. Default to first option when dropdown is open
   * and there are options. */
  useEffect(() => {
    if (!open || visibleOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(prev => {
      if (prev >= 0 && prev < visibleOptions.length) {
        return prev;
      }
      return 0;
    });
  }, [open, visibleOptions]);

  /* ── Imperative helpers ────────────────────────────────────── */

  const cancelBlurClose = useCallback(() => {
    if (blurCloseTimer.current) {
      clearTimeout(blurCloseTimer.current);
      blurCloseTimer.current = null;
    }
  }, []);

  useEffect(() => cancelBlurClose, [cancelBlurClose]);

  const updateInputText = useCallback(
    (next: string) => {
      if (!isInputControlled) {
        setInternalText(next);
      }
      onInputChange?.(next);
    },
    [isInputControlled, onInputChange],
  );

  const commitOption = useCallback(
    (opt: T) => {
      cancelBlurClose();
      onChange(opt);
      updateInputText(getOptionLabel(opt));
      setOpen(false);
      setActiveIndex(-1);
    },
    [cancelBlurClose, onChange, updateInputText, getOptionLabel],
  );

  const commitFreeText = useCallback(
    (text: string) => {
      cancelBlurClose();
      onFreeTextCommit?.(text);
      // Free-text commit clears any structured selection — the value no longer
      // matches the typed text.
      onChange(null);
      setOpen(false);
      setActiveIndex(-1);
    },
    [cancelBlurClose, onFreeTextCommit, onChange],
  );

  const closeWithoutCommit = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    if (!isInputControlled) {
      setInternalText(value ? getOptionLabel(value) : '');
    }
  }, [isInputControlled, value, getOptionLabel]);

  const handleClear = useCallback(() => {
    cancelBlurClose();
    onChange(null);
    updateInputText('');
    setActiveIndex(-1);
    inputRef.current?.focus();
    setOpen(true);
  }, [cancelBlurClose, onChange, updateInputText]);

  /* ── Event handlers ────────────────────────────────────────── */

  const handleInputChange = useCallback(
    (text: string) => {
      updateInputText(text);
      if (!open) {
        setOpen(true);
      }
    },
    [updateInputText, open],
  );

  const handleInputFocus = useCallback(() => {
    cancelBlurClose();
    setFocused(true);
    if (disabled) {
      return;
    }
    setOpen(true);
  }, [cancelBlurClose, disabled]);

  /* Native equivalent of the web wrapper onBlur relatedTarget guard +
   * document mousedown-outside handler: defer the close so an internal-control
   * press (option / chevron / clear) can cancel it; a tap elsewhere lets the
   * timer fire and closes without committing. */
  const handleInputBlur = useCallback(() => {
    setFocused(false);
    cancelBlurClose();
    blurCloseTimer.current = setTimeout(() => {
      blurCloseTimer.current = null;
      closeWithoutCommit();
    }, 0);
  }, [cancelBlurClose, closeWithoutCommit]);

  const handleSubmitEditing = useCallback(() => {
    if (disabled) {
      return;
    }
    if (open && activeIndex >= 0 && activeIndex < visibleOptions.length) {
      const opt = visibleOptions[activeIndex];
      if (opt !== undefined) {
        commitOption(opt);
      }
    } else if (allowFreeText && inputValue.trim().length > 0) {
      commitFreeText(inputValue.trim());
    }
  }, [
    disabled,
    open,
    activeIndex,
    visibleOptions,
    commitOption,
    allowFreeText,
    inputValue,
    commitFreeText,
  ]);

  /* Hardware-keyboard navigation for the platforms that surface key events
   * through TextInput.onKeyPress (RN-Windows / RN-macOS / RN-Web). Enter is
   * handled by onSubmitEditing to avoid a double commit. preventDefault has no
   * native analog, but the navigation keys never insert text. */
  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (disabled) {
        return;
      }
      switch (e.nativeEvent.key) {
        case 'ArrowDown': {
          if (!open) {
            setOpen(true);
            return;
          }
          if (visibleOptions.length === 0) {
            return;
          }
          setActiveIndex(prev =>
            prev < visibleOptions.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        case 'ArrowUp': {
          if (!open) {
            setOpen(true);
            return;
          }
          if (visibleOptions.length === 0) {
            return;
          }
          setActiveIndex(prev =>
            prev > 0 ? prev - 1 : visibleOptions.length - 1,
          );
          return;
        }
        case 'Home': {
          if (!open) {
            return;
          }
          setActiveIndex(0);
          return;
        }
        case 'End': {
          if (!open) {
            return;
          }
          setActiveIndex(visibleOptions.length - 1);
          return;
        }
        case 'Escape': {
          if (!open) {
            return;
          }
          closeWithoutCommit();
          return;
        }
        case 'Tab': {
          // Commit a highlighted option on Tab so the user can keep moving
          // through the form without losing their pick.
          if (open && activeIndex >= 0 && activeIndex < visibleOptions.length) {
            const opt = visibleOptions[activeIndex];
            if (opt !== undefined) {
              commitOption(opt);
            }
          } else {
            closeWithoutCommit();
          }
          return;
        }
        default:
          return;
      }
    },
    [disabled, open, visibleOptions, activeIndex, commitOption, closeWithoutCommit],
  );

  const handleChevronPress = useCallback(() => {
    if (disabled) {
      return;
    }
    if (open) {
      closeWithoutCommit();
    } else {
      setOpen(true);
      inputRef.current?.focus();
    }
  }, [disabled, open, closeWithoutCommit]);

  /* ── Render ────────────────────────────────────────────────── */

  const showClear =
    !noClearButton && !disabled && (value !== null || inputValue.length > 0);

  return (
    <View style={[styles.container, style]}>
      {hideLabel ? (
        <VisuallyHidden>{label}</VisuallyHidden>
      ) : (
        <AppText
          nativeID={labelId}
          style={styles.label}
          tone="secondary"
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      )}

      <View
        style={[
          styles.inputRow,
          focused && styles.inputRowFocused,
          disabled && styles.disabledRow,
        ]}>
        {icon ? <View style={styles.leadingIcon}>{icon}</View> : null}
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityState={{disabled, expanded: open}}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          editable={!disabled}
          nativeID={inputId}
          onBlur={handleInputBlur}
          onChangeText={handleInputChange}
          onFocus={handleInputFocus}
          onKeyPress={handleKeyPress}
          onSubmitEditing={handleSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          spellCheck={false}
          style={[styles.inputField, inputStyle]}
          testID={`${inputId}-input`}
          value={inputValue}
        />
        <View style={styles.trailing}>
          {loading ? (
            <ActivityIndicator
              accessibilityLabel={t('combobox.loading', 'Loading')}
              color={colors.textMuted}
              size="small"
            />
          ) : null}
          {showClear ? (
            <Pressable
              accessibilityLabel={t('combobox.clearAria', 'Clear selection')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={handleClear}
              onPressIn={cancelBlurClose}
              style={styles.iconButton}>
              <AppText accessible={false} style={styles.trailingGlyph} tone="muted">
                {CLEAR_GLYPH}
              </AppText>
            </Pressable>
          ) : null}
          {!noChevron ? (
            <Pressable
              accessibilityLabel={
                open
                  ? t('combobox.closeListAria', 'Hide options')
                  : t('combobox.openListAria', 'Show options')
              }
              accessibilityRole="button"
              disabled={disabled}
              hitSlop={8}
              onPress={handleChevronPress}
              onPressIn={cancelBlurClose}
              style={styles.iconButton}>
              <AppText
                accessible={false}
                style={[styles.trailingGlyph, open && styles.chevronOpen]}
                tone="muted">
                {CHEVRON_GLYPH}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* SR status announcement target — kept in sync via the announcer but a
       * static fallback still helps assistive tech pick up "loading" hints. */}
      <VisuallyHidden id={statusId}>
        {loading ? t('combobox.loading', 'Loading') : ''}
      </VisuallyHidden>

      {open ? (
        <View
          accessibilityLabel={label}
          accessibilityRole="list"
          nativeID={listboxId}
          style={styles.dropdown}>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            style={styles.dropdownScroll}>
            {visibleOptions.length === 0 && !loading ? (
              <AppText style={styles.emptyOption} tone="muted">
                {t('combobox.noResults', 'No results')}
              </AppText>
            ) : null}
            {visibleOptions.length === 0 && loading ? (
              <AppText style={styles.loadingOption} tone="muted">
                {t('combobox.loading', 'Loading')}
              </AppText>
            ) : null}
            {visibleOptions.map((opt, i) => {
              const optionId = `${listboxId}-opt-${getOptionKey(opt)}`;
              const isActive = i === activeIndex;
              const isSelected = value !== null && eq(opt, value);
              return (
                <Pressable
                  key={getOptionKey(opt)}
                  accessibilityLabel={getOptionLabel(opt)}
                  accessibilityRole="menuitem"
                  accessibilityState={{selected: isSelected}}
                  onPress={() => commitOption(opt)}
                  onPressIn={() => {
                    cancelBlurClose();
                    setActiveIndex(i);
                  }}
                  style={[styles.optionRow, isActive && styles.optionRowActive]}
                  testID={optionId}>
                  {renderOption ? (
                    renderOption(opt, {active: isActive, selected: isSelected})
                  ) : (
                    <AppText
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                      ]}>
                      {getOptionLabel(opt)}
                    </AppText>
                  )}
                </Pressable>
              );
            })}
            {filteredOptions.length > visibleOptions.length ? (
              <AppText style={styles.moreOption} tone="muted">
                {t('combobox.moreHidden', '{{count}} more — refine search', {
                  count: filteredOptions.length - visibleOptions.length,
                })}
              </AppText>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chevronOpen: {
    transform: [{rotate: '180deg'}],
  },
  container: {
    position: 'relative',
  },
  disabledRow: {
    opacity: 0.5,
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    left: 0,
    marginTop: 4,
    maxHeight: 256,
    overflow: 'hidden',
    paddingVertical: 4,
    position: 'absolute',
    right: 0,
    top: '100%',
    zIndex: 30,
  },
  dropdownScroll: {
    maxHeight: 248,
  },
  emptyOption: {
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 4,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  inputField: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    paddingHorizontal: 0,
    paddingVertical: 8,
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  inputRowFocused: {
    borderColor: colors.accent,
  },
  label: {
    marginBottom: 4,
  },
  leadingIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  loadingOption: {
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  moreOption: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    fontSize: 11,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  optionRow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceRaised,
  },
  optionText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  optionTextSelected: {
    fontWeight: '600',
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    marginLeft: 4,
  },
  trailingGlyph: {
    fontSize: 14,
  },
});
