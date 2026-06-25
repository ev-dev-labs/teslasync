// Native parity port of web/src/components/forms/ComboboxMulti.tsx.
//
// The web source is a WAI-ARIA multi-select combobox built on DOM <div>/<input>/
// <ul>/<li>/<button>/<span>, lucide-react ChevronDown/X glyphs, Tailwind utility
// classes + CSS custom properties, the @/lib/cn class merger, the useAnnouncer
// screen-reader hook, the @/components/a11y VisuallyHidden primitive, and a
// document-level mousedown listener for outside-click dismissal.
//
// This port reproduces the same behaviour, state machine, async-loader contract,
// and visual intent with React Native View/Pressable/TextInput/ScrollView/
// ActivityIndicator primitives, the design tokens, AppText, the native a11y
// VisuallyHidden + announce() helpers, and small AppText glyphs for the inline
// chevron / chip-remove icons -- with no DOM, no lucide-react, no recharts/
// leaflet, and no web UI components.
//
// Native-safe adaptations (documented in the sidecar):
//   * No `document` exists, so the outside-mousedown close listener is replaced
//     by the TextInput blur handler (guarded so internal taps do not close) plus
//     the explicit chevron toggle.
//   * DOM keyboard navigation (ArrowUp/Down, Home/End, Escape, Tab, Backspace)
//     is wired through TextInput `onKeyPress`, which fires on hardware-keyboard
//     targets (react-native-windows / -macos); Enter is committed via
//     `onSubmitEditing`. Touch is the primary interaction on phones/tablets:
//     tap an option to add it, tap a chip's x to remove, tap the chevron to
//     toggle the list.
//   * aria-* / role wiring becomes the equivalent React Native accessibility*
//     props. `describedBy`, `className`, and `chipClassName` are web-only and
//     are accepted for source compatibility but have no native effect.

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
  type TextInputKeyPressEventData,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';
import {VisuallyHidden} from '../a11y';
import {announce} from '../a11y/AnnouncerRegion';

/* ── i18n fallback ─────────────────────────────────────────────── */

type TranslationVars = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function interpolate(template: string, vars: TranslationVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

/**
 * The web component read `t` from react-i18next. Native parity has no i18n
 * runtime wired yet, so this returns the English fallback string, applying the
 * same `{{var}}` interpolation react-i18next would (preserving i18n intent).
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, vars) => {
    if (!vars) {
      return fallback;
    }
    return interpolate(fallback, vars);
  }, []);
}

/* ── Shared types ──────────────────────────────────────────────── */

/**
 * Options can be a static array or an async loader. The loader receives the
 * current input text and an `AbortSignal` that fires when a newer keystroke
 * arrives -- implementations MUST forward the signal to fetch / cancellable
 * APIs to avoid races. Mirrors `ComboboxOptions<T>` from the web Combobox; the
 * Combobox.tsx native port (not yet present) will re-home this type.
 */
export type ComboboxOptions<T> =
  | readonly T[]
  | ((query: string, signal: AbortSignal) => Promise<readonly T[]>);

export interface ComboboxMultiProps<T> {
  /** Currently selected options. */
  value: T[];
  /** Fired when a chip is added or removed. */
  onChange: (next: T[]) => void;
  /** Static array OR async loader. See {@link ComboboxOptions}. */
  options: ComboboxOptions<T>;
  /** Returns the visible label for an option / chip. */
  getOptionLabel: (option: T) => string;
  /** Returns a stable string key for an option (for React keys + a11y ids). */
  getOptionKey: (option: T) => string;
  /** Override the chip label (defaults to `getOptionLabel`). */
  getChipLabel?: (option: T) => string;
  /** Required visible OR accessibility label. */
  label: string;
  /** When true, label is rendered visually-hidden. */
  hideLabel?: boolean;
  /** ID of an element that further describes the field (web-only, ignored). */
  describedBy?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Cap visible dropdown options for performance. Defaults to 50. */
  maxVisibleOptions?: number;
  /** Maximum number of chips allowed. */
  maxItems?: number;
  /** Async fetch debounce in ms. Defaults to 200. Static-array case ignores. */
  asyncDebounceMs?: number;
  /** Custom option renderer. */
  renderOption?: (option: T, state: {active: boolean}) => ReactNode;
  /** Outer wrapper className (web-only, ignored on native). */
  className?: string;
  /** Optional leading icon shown before the chips. */
  icon?: ReactNode;
  /** Hide the trailing chevron toggle. */
  noChevron?: boolean;
  /** Chip colour-family className (web-only, ignored on native). */
  chipClassName?: string;
}

/* ── Static-array filter ─────────────────────────────────────── */

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

/* ── Component ────────────────────────────────────────────────── */

export function ComboboxMulti<T>(props: ComboboxMultiProps<T>) {
  const {
    value,
    onChange,
    options,
    getOptionLabel,
    getOptionKey,
    getChipLabel,
    label,
    hideLabel = false,
    placeholder,
    disabled = false,
    loading: loadingProp = false,
    maxVisibleOptions = 50,
    maxItems,
    asyncDebounceMs = 200,
    renderOption,
    icon,
    noChevron = false,
  } = props;

  const t = useNativeTranslationFallback();

  const inputRef = useRef<TextInput>(null);
  // Mirrors the web onMouseDown(preventDefault) trick: internal taps blur the
  // TextInput, so this flag lets the blur handler skip the close in that case.
  const suppressBlurRef = useRef(false);
  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const labelId = `${generatedId}-label`;
  const listboxId = `${generatedId}-listbox`;
  const statusId = `${generatedId}-status`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [inputText, setInputText] = useState('');
  const [asyncOptions, setAsyncOptions] = useState<readonly T[] | null>(null);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const lastAnnouncedRef = useRef<string>('');

  const isAsync = typeof options === 'function';

  /* Keys of already-selected options so we can hide them from the dropdown.
   * Memoised against `value` so chip removals trigger recomputation. */
  const selectedKeys = useMemo(
    () => new Set(value.map(v => getOptionKey(v))),
    [value, getOptionKey],
  );

  const atMax = maxItems !== undefined && value.length >= maxItems;

  /* Async options: re-fetch on inputText change with debounced
   * abort-on-keystroke. */
  useEffect(() => {
    if (!isAsync) {
      setAsyncOptions(null);
      setAsyncLoading(false);
      return;
    }
    if (!open && !inputText) {
      return;
    }
    const controller = new AbortController();
    const debounceId = setTimeout(() => {
      setAsyncLoading(true);
      Promise.resolve(
        (options as (q: string, signal: AbortSignal) => Promise<readonly T[]>)(
          inputText,
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
        .catch(err => {
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
  }, [isAsync, options, inputText, open, asyncDebounceMs]);

  const loading = loadingProp || asyncLoading;

  /* Filtered + selected-removed options. */
  const filteredOptions = useMemo<readonly T[]>(() => {
    const base: readonly T[] = isAsync
      ? asyncOptions ?? []
      : defaultFilter(options as readonly T[], inputText, getOptionLabel);
    return base.filter(o => !selectedKeys.has(getOptionKey(o)));
  }, [
    isAsync,
    asyncOptions,
    options,
    inputText,
    getOptionLabel,
    selectedKeys,
    getOptionKey,
  ]);

  const visibleOptions = useMemo<readonly T[]>(
    () => filteredOptions.slice(0, maxVisibleOptions),
    [filteredOptions, maxVisibleOptions],
  );

  /* Announce result count for SR. */
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

  /* Reset active index whenever the visible options change. */
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

  const addOption = useCallback(
    (opt: T) => {
      if (atMax) {
        return;
      }
      if (selectedKeys.has(getOptionKey(opt))) {
        return;
      }
      onChange([...value, opt]);
      setInputText('');
      setActiveIndex(-1);
      // Keep dropdown open for rapid multi-select; user closes via blur or
      // the chevron toggle.
      inputRef.current?.focus();
    },
    [atMax, selectedKeys, getOptionKey, onChange, value],
  );

  const removeAt = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= value.length) {
        return;
      }
      const next = value.slice();
      const [removed] = next.splice(idx, 1);
      onChange(next);
      announce(
        t('combobox.removedChip', 'Removed {{label}}', {
          label: (getChipLabel ?? getOptionLabel)(removed),
        }),
      );
    },
    [value, onChange, t, getChipLabel, getOptionLabel],
  );

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  /* ── Event handlers ────────────────────────────────────────── */

  const handleInputChange = useCallback(
    (text: string) => {
      setInputText(text);
      if (!open) {
        setOpen(true);
      }
    },
    [open],
  );

  const handleInputFocus = useCallback(() => {
    if (disabled) {
      return;
    }
    setOpen(true);
  }, [disabled]);

  // Native analogue of the web `handleWrapperBlur` + document-mousedown close:
  // when focus genuinely leaves the field, close the dropdown. Internal taps
  // (option / chip remove / chevron) set `suppressBlurRef` first so they do not
  // trip this close.
  const handleInputBlur = useCallback(() => {
    if (suppressBlurRef.current) {
      suppressBlurRef.current = false;
      return;
    }
    closeDropdown();
  }, [closeDropdown]);

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
          closeDropdown();
          return;
        }
        case 'Backspace': {
          // Backspace at an empty input removes the trailing chip.
          if (inputText.length === 0 && value.length > 0) {
            removeAt(value.length - 1);
          }
          return;
        }
        case 'Tab': {
          if (open && activeIndex >= 0 && activeIndex < visibleOptions.length) {
            addOption(visibleOptions[activeIndex]);
          } else {
            closeDropdown();
          }
          return;
        }
        default:
          return;
      }
    },
    [
      disabled,
      open,
      visibleOptions,
      activeIndex,
      addOption,
      inputText,
      value,
      removeAt,
      closeDropdown,
    ],
  );

  // Web committed the highlighted option on Enter from the key switch; on native
  // the reliable single-line return event is `onSubmitEditing`.
  const handleSubmit = useCallback(() => {
    if (open && activeIndex >= 0 && activeIndex < visibleOptions.length) {
      addOption(visibleOptions[activeIndex]);
    }
  }, [open, activeIndex, visibleOptions, addOption]);

  /* ── Render ────────────────────────────────────────────────── */

  const getChip = getChipLabel ?? getOptionLabel;

  const labelNode = (
    <AppText variant="caption" tone="secondary" weight="semibold">
      {label}
      {maxItems !== undefined ? (
        <AppText variant="caption" tone="muted">
          {` (${value.length}/${maxItems})`}
        </AppText>
      ) : null}
    </AppText>
  );

  return (
    <View style={styles.wrapper}>
      {hideLabel ? (
        <VisuallyHidden as="label" id={labelId} htmlFor={inputId}>
          {labelNode}
        </VisuallyHidden>
      ) : (
        <View nativeID={labelId} style={styles.labelRow}>
          {labelNode}
        </View>
      )}

      <Pressable
        accessibilityState={{disabled}}
        disabled={disabled}
        onPress={() => {
          if (!disabled) {
            inputRef.current?.focus();
          }
        }}
        style={[
          styles.field,
          open && styles.fieldFocused,
          disabled && styles.fieldDisabled,
        ]}>
        {icon ? (
          <View pointerEvents="none" style={styles.leadingIcon}>
            {icon}
          </View>
        ) : null}

        {value.map((opt, i) => (
          <View key={getOptionKey(opt)} style={styles.chip}>
            <AppText
              numberOfLines={1}
              style={styles.chipText}
              weight="semibold">
              {getChip(opt)}
            </AppText>
            <Pressable
              accessibilityLabel={t('combobox.removeChip', 'Remove {{label}}', {
                label: getChip(opt),
              })}
              accessibilityRole="button"
              disabled={disabled}
              hitSlop={8}
              onPressIn={() => {
                suppressBlurRef.current = true;
              }}
              onPress={() => {
                removeAt(i);
                inputRef.current?.focus();
              }}
              style={styles.chipRemove}>
              <AppText style={styles.chipRemoveGlyph}>×</AppText>
            </Pressable>
          </View>
        ))}

        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityState={{disabled: disabled || atMax, expanded: open}}
          autoCapitalize="none"
          autoCorrect={false}
          blurOnSubmit={false}
          editable={!disabled}
          nativeID={inputId}
          onBlur={handleInputBlur}
          onChangeText={handleInputChange}
          onFocus={handleInputFocus}
          onKeyPress={handleKeyPress}
          onSubmitEditing={handleSubmit}
          placeholder={
            value.length === 0
              ? placeholder
              : atMax
              ? t('combobox.maxReached', 'Maximum reached')
              : undefined
          }
          placeholderTextColor={colors.textMuted}
          spellCheck={false}
          style={styles.input}
          value={inputText}
        />

        <View style={styles.trailing}>
          {loading ? (
            <ActivityIndicator
              accessibilityLabel={t('combobox.loading', 'Loading')}
              color={colors.textMuted}
              size="small"
            />
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
              onPressIn={() => {
                suppressBlurRef.current = true;
              }}
              onPress={() => {
                if (disabled) {
                  return;
                }
                if (open) {
                  closeDropdown();
                } else {
                  setOpen(true);
                  inputRef.current?.focus();
                }
              }}
              style={styles.chevron}>
              <AppText style={styles.chevronGlyph} tone="muted">
                {open ? '▴' : '▾'}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </Pressable>

      <VisuallyHidden id={statusId}>
        {loading ? t('combobox.loading', 'Loading') : ''}
      </VisuallyHidden>

      {open ? (
        <View style={styles.listbox} testID={listboxId}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.listScroll}>
            {visibleOptions.length === 0 && !loading ? (
              <View style={styles.placeholderRow}>
                <AppText style={styles.placeholderText}>
                  {atMax
                    ? t('combobox.maxReached', 'Maximum reached')
                    : t('combobox.noResults', 'No results')}
                </AppText>
              </View>
            ) : null}
            {visibleOptions.length === 0 && loading ? (
              <View style={styles.placeholderRow}>
                <AppText style={styles.placeholderText}>
                  {t('combobox.loading', 'Loading')}
                </AppText>
              </View>
            ) : null}
            {visibleOptions.map((opt, i) => {
              const optionId = `${listboxId}-opt-${getOptionKey(opt)}`;
              const isActive = i === activeIndex;
              return (
                <Pressable
                  key={getOptionKey(opt)}
                  accessibilityRole="button"
                  accessibilityState={{disabled: atMax, selected: false}}
                  disabled={atMax}
                  onPressIn={() => {
                    suppressBlurRef.current = true;
                    setActiveIndex(i);
                  }}
                  onPress={() => addOption(opt)}
                  style={[
                    styles.option,
                    isActive && styles.optionActive,
                    atMax && styles.optionDisabled,
                  ]}
                  testID={optionId}>
                  {renderOption ? (
                    renderOption(opt, {active: isActive})
                  ) : (
                    <AppText style={styles.optionText}>
                      {getOptionLabel(opt)}
                    </AppText>
                  )}
                </Pressable>
              );
            })}
            {filteredOptions.length > visibleOptions.length ? (
              <View style={styles.moreRow}>
                <AppText style={styles.moreText}>
                  {t('combobox.moreHidden', '{{count}} more — refine search', {
                    count: filteredOptions.length - visibleOptions.length,
                  })}
                </AppText>
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

ComboboxMulti.displayName = 'ComboboxMulti';

const styles = StyleSheet.create({
  chevron: {
    alignItems: 'center',
    borderRadius: 6,
    justifyContent: 'center',
    padding: 2,
  },
  chevronGlyph: {
    fontSize: typography.body,
    lineHeight: typography.body + 2,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipRemove: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
  },
  chipRemoveGlyph: {
    color: colors.accent,
    fontSize: typography.body,
    lineHeight: typography.body,
  },
  chipText: {
    color: colors.accent,
    fontSize: typography.caption,
    maxWidth: 160,
  },
  field: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  fieldDisabled: {
    opacity: 0.5,
  },
  fieldFocused: {
    borderColor: colors.borderAccent,
  },
  input: {
    color: colors.textPrimary,
    flexGrow: 1,
    fontSize: typography.body,
    margin: 0,
    minWidth: 96,
    paddingVertical: 0,
  },
  labelRow: {
    marginBottom: spacing.xs,
  },
  leadingIcon: {
    marginRight: spacing.xs,
  },
  listScroll: {
    maxHeight: 256,
  },
  listbox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    left: 0,
    marginTop: spacing.xs,
    paddingVertical: spacing.xs,
    position: 'absolute',
    right: 0,
    top: '100%',
    zIndex: 30,
    ...shadows.panel,
  },
  moreRow: {
    borderColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  moreText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  option: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  optionActive: {
    backgroundColor: colors.surfaceHover,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionText: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  placeholderRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  trailing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginLeft: 'auto',
  },
  wrapper: {
    position: 'relative',
    width: '100%',
  },
});
