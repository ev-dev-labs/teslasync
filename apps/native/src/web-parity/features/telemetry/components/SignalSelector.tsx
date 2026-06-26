/**
 * SignalSelector — native parity port of
 * web/src/features/telemetry/components/SignalSelector.tsx.
 *
 * The web file is a thin wrapper around the `ComboboxMulti` form primitive
 * specialised for signal names: it adds the standard "Signals (N / max)"
 * label, a search icon, mono-font option rendering, the optional layer-help
 * tooltip, and the optional cap (default 5) that keeps the chart legible.
 *
 * Neither `@/components/forms` `ComboboxMulti` nor `@/components/ui`
 * `HelpTooltip` has a native parity port yet, so — following the
 * VehicleMultiSelect / SignalQueryControls "reproduce the dependency locally"
 * precedent — a minimal native-safe multi-select and help affordance are
 * reproduced here, preserving every SignalSelector prop, state name, the cap
 * slice logic, the i18n keys, and the visual intent:
 *   - react-i18next `useTranslation`: replaced by a native-safe
 *     `t(key, fallback?, params?)` that interpolates i18next-style `{{name}}`
 *     placeholders, keeping every translation key + i18n intent.
 *   - lucide-react `Search`: rendered as a decorative AppText glyph (the
 *     established native inline-icon stand-in).
 *   - `@/lib/cn` + the outer `className`: Tailwind merging is meaningless on
 *     RN, so the outer-wrapper `className` becomes a native `style` prop applied
 *     to the root View (the `w-full` base maps to `width: '100%'`).
 *   - `HelpTooltip` (hover/focus/tap reveal): RN has no hover, so the `?`
 *     trigger toggles an inline help panel on tap (placement="bottom" intent)
 *     and the help body is also exposed via accessibilityHint so screen readers
 *     get it without opening. The i18nKey/defaultValue/ariaLabel are preserved.
 *   - The `ComboboxMulti` behaviour reproduced: removable selected chips, the
 *     case-insensitive filter that always hides already-selected options, the
 *     50-option visible cap with a "N more — refine search" footer, the
 *     maxItems/atMax gate (disabled when `max` is null → no cap), the
 *     "Maximum reached" / "No results" empty rows, Backspace-at-empty removes
 *     the trailing chip, and the cap slice on every change. The web `document`
 *     mousedown click-outside listener is DOM-only and dropped; the dropdown
 *     instead closes on select or via the chevron toggle (the web primary close
 *     paths).
 */
import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

/* ── monospace font (web `font-mono`) ── */

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/* ── inline icon glyphs (native-safe stand-ins for lucide-react) ── */

const ICON = {
  search: '\u2315',
  close: '\u00D7',
  help: '?',
  chevronDown: '\u2304',
} as const;

/** Web `ComboboxMulti` caps the visible dropdown to 50 options for perf. */
const MAX_VISIBLE_OPTIONS = 50;

export interface SignalSelectorProps {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Hard cap. Defaults to 5. Pass `null` for no cap. */
  max?: number | null;
  /** Show the layer-help tooltip next to the label. Default true. */
  showLayerHelp?: boolean;
  /** Override the label (defaults to "Signals (N / max)"). */
  labelOverride?: string;
  /** Native analog of the web outer-wrapper `className` (web base: `w-full`). */
  style?: StyleProp<ViewStyle>;
}

export function SignalSelector({
  options,
  value,
  onChange,
  max = 5,
  showLayerHelp = true,
  labelOverride,
  style,
}: SignalSelectorProps) {
  const t = useNativeTranslationFallback();
  const cap = max ?? Number.POSITIVE_INFINITY;

  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const atMax = Number.isFinite(cap) && value.length >= cap;

  const selectedSet = useMemo(() => new Set(value), [value]);

  /* Filtered + selected-removed options (web defaultFilter + selectedKeys). */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? options.filter(o => o.toLowerCase().includes(q))
      : options;
    return base.filter(o => !selectedSet.has(o));
  }, [options, search, selectedSet]);

  const visible = useMemo(
    () => filtered.slice(0, MAX_VISIBLE_OPTIONS),
    [filtered],
  );

  /* Single onChange wrapper — preserves the web cap slice exactly. */
  const commit = useCallback(
    (next: string[]) =>
      onChange(Number.isFinite(cap) ? next.slice(0, cap) : next),
    [onChange, cap],
  );

  const addSignal = useCallback(
    (sig: string) => {
      if (atMax) {
        return;
      }
      if (selectedSet.has(sig)) {
        return;
      }
      commit([...value, sig]);
      setSearch('');
    },
    [atMax, selectedSet, commit, value],
  );

  const removeSignal = useCallback(
    (sig: string) => {
      commit(value.filter(s => s !== sig));
    },
    [commit, value],
  );

  /* Backspace at an empty input removes the trailing chip (web parity). */
  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (
        e.nativeEvent.key === 'Backspace' &&
        search.length === 0 &&
        value.length > 0
      ) {
        removeSignal(value[value.length - 1]);
      }
    },
    [search, value, removeSignal],
  );

  const labelText =
    labelOverride ??
    (max != null
      ? `${t('Signals')} (${value.length} / ${max})`
      : `${t('Signals')} (${value.length})`);

  const helpBody = t(
    'help.signal.layers',
    'TeslaSync exposes three live-state layers: L1 (in-process), L2 (Redis shared), and log (TimescaleDB history).',
  );
  const helpAria = t(
    'help.signal.layers.aria',
    'More info about signal layers (L1, L2, log)',
  );

  const placeholder: string | undefined =
    value.length === 0
      ? t('Search signals…')
      : atMax
        ? t('combobox.maxReached', 'Maximum reached')
        : undefined;

  const hiddenCount = filtered.length - visible.length;

  let optionContent: ReactNode;
  if (visible.length === 0) {
    optionContent = (
      <AppText style={styles.dropdownEmpty} testID="signal-selector-empty">
        {atMax
          ? t('combobox.maxReached', 'Maximum reached')
          : t('combobox.noResults', 'No results')}
      </AppText>
    );
  } else {
    optionContent = (
      <>
        {visible.map(sig => (
          <Pressable
            accessibilityRole="button"
            key={sig}
            onPress={() => {
              addSignal(sig);
              setOpen(false);
            }}
            style={({pressed}) => [
              styles.dropdownItem,
              pressed && styles.dropdownItemPressed,
              atMax && styles.dropdownItemDisabled,
            ]}
            testID={`signal-selector-option-${sig}`}>
            <AppText style={styles.optionText}>{sig}</AppText>
          </Pressable>
        ))}
        {hiddenCount > 0 ? (
          <AppText style={styles.dropdownMore}>
            {t('combobox.moreHidden', '{{count}} more — refine search', {
              count: hiddenCount,
            })}
          </AppText>
        ) : null}
      </>
    );
  }

  return (
    <View style={[styles.root, style]} testID="signal-selector">
      <View style={styles.labelRow}>
        <AppText style={styles.label}>{labelText}</AppText>
        {showLayerHelp ? (
          <Pressable
            accessibilityHint={helpBody}
            accessibilityLabel={helpAria}
            accessibilityRole="button"
            accessibilityState={{expanded: helpOpen}}
            hitSlop={6}
            onPress={() => setHelpOpen(o => !o)}
            style={styles.helpTrigger}
            testID="signal-selector-help-toggle">
            <AppText style={styles.helpGlyph}>{ICON.help}</AppText>
          </Pressable>
        ) : null}
      </View>

      {showLayerHelp && helpOpen ? (
        <View
          accessibilityRole="summary"
          style={styles.helpPanel}
          testID="signal-selector-help-panel">
          <AppText style={styles.helpText}>{helpBody}</AppText>
        </View>
      ) : null}

      {value.length > 0 ? (
        <View style={styles.chipRow}>
          {value.map(sig => (
            <View
              key={sig}
              style={styles.chip}
              testID={`signal-selector-chip-${sig}`}>
              <AppText style={styles.chipText}>{sig}</AppText>
              <Pressable
                accessibilityLabel={t('combobox.removeChip', 'Remove {{label}}', {
                  label: sig,
                })}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => removeSignal(sig)}
                style={styles.chipRemove}
                testID={`signal-selector-chip-remove-${sig}`}>
                <AppText style={styles.chipRemoveGlyph}>{ICON.close}</AppText>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <View style={styles.inputRow}>
          <View style={styles.inputIcon}>
            <AppText style={styles.searchGlyph}>{ICON.search}</AppText>
          </View>
          <TextInput
            accessibilityLabel={t('Signals')}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!atMax || value.length === 0}
            onChangeText={v => {
              setSearch(v);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyPress={handleKeyPress}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            style={styles.inputField}
            testID="signal-selector-input"
            value={search}
          />
          <Pressable
            accessibilityLabel={
              open
                ? t('combobox.closeListAria', 'Hide options')
                : t('combobox.openListAria', 'Show options')
            }
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => setOpen(o => !o)}
            style={styles.chevron}
            testID="signal-selector-chevron">
            <AppText
              style={[styles.chevronGlyph, open && styles.chevronGlyphOpen]}>
              {ICON.chevronDown}
            </AppText>
          </Pressable>
        </View>
        {open ? (
          <View style={styles.dropdown} testID="signal-selector-dropdown">
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.dropdownScroll}>
              {optionContent}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  helpTrigger: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  helpGlyph: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
  },
  helpPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  helpText: {
    color: colors.textPrimary,
    fontSize: 11,
    lineHeight: 15,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: {
    color: colors.accent,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  chipRemove: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRemoveGlyph: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 16,
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  inputIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
  },
  searchGlyph: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 16,
  },
  inputField: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  chevron: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
  },
  chevronGlyph: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 18,
  },
  chevronGlyphOpen: {
    transform: [{rotate: '180deg'}],
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    overflow: 'hidden',
  },
  dropdownScroll: {
    maxHeight: 256,
  },
  dropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  dropdownItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  dropdownItemDisabled: {
    opacity: 0.5,
  },
  optionText: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  dropdownEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  dropdownMore: {
    color: colors.textMuted,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    fontSize: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
});
