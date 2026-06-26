// Native parity port of web/src/features/driving/components/AddressInput.tsx.
//
// AddressInput — the trip-planner's geocoded address field. The parent owns the
// raw text via `value` / `onChange`; picking a suggestion additionally fires
// `onSelect` with the resolved coordinates ({lat, lng, name}). Typed input is
// debounced (400ms) into the geocode-search query so we don't hammer the
// upstream geocoder on every keystroke.
//
// Web -> native mapping notes (contract rules 4, 5 & 7):
//   - The shared web @/components/forms `Combobox` is a DOM <input role=combobox>
//     + <ul role=listbox> primitive with pointer/keyboard a11y that has no native
//     analogue. It is reimplemented inline with React Native primitives: a
//     TextInput for the editable query plus an absolutely-positioned View that
//     lists the suggestions as Pressables — the same "type to filter then pick"
//     contract. Every Combobox prop AddressInput passes is preserved in behaviour:
//       * inputValue/onInputChange  -> TextInput value/onChangeText (parent-owned).
//       * value={null}              -> no option is ever marked selected.
//       * options={results ?? []}   -> a static array, so the Combobox's
//                                      defaultFilter (case-insensitive substring
//                                      on the option label) is ported verbatim as
//                                      filterByQuery() to keep identical visible
//                                      results.
//       * getOptionLabel            -> r.display_name.
//       * getOptionKey              -> `${lat}-${lng}-${display_name}` (React key).
//       * maxVisibleOptions={5}     -> visibleOptions = filtered.slice(0, 5) with
//                                      the "{n} more — refine search" overflow row.
//       * loading                   -> ActivityIndicator + the "Loading"/"No
//                                      results" listbox states.
//       * noChevron/noClearButton   -> neither affordance is rendered.
//       * allowFreeText             -> the parent owns the text, so free typing is
//                                      never constrained to the option list.
//   - lucide-react MapPin (web L5, L49, L64) -> a decorative "location pin" glyph
//     hidden from assistive tech, matching the RouteDisplay MapPin->glyph parity
//     precedent. Used both as the input's leading affix and per-suggestion marker.
//   - react-i18next useTranslation (web L2, L23) -> inlined
//     useNativeTranslationFallback() returning the web English fallback verbatim,
//     matching the VehicleSelect/DatePresetChips ports. Keys preserved:
//     addressInput.label, combobox.loading, combobox.noResults, combobox.moreHidden.
//   - useGeocodeSearch + GeocodeResult/TripLocation (web @/api/hooks/useDriving /
//     @/types/driving) -> the ported web-parity api/hooks/useDriving, which already
//     re-exports both types and the hook (same /geocode/search?q=…&limit=5 path).
//   - Web closes the popup on outside-click; native has no pointer-out, so the
//     listbox closes on a debounced TextInput blur (a pending suggestion tap wins),
//     and on commit — preserving the web "commit closes the dropdown" behaviour.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported — only react, react-native primitives, and the shared native theme.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useGeocodeSearch,
  type GeocodeResult,
  type TripLocation,
} from '../../../api/hooks/useDriving';

const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 3;
const MAX_VISIBLE_OPTIONS = 5;
const BLUR_CLOSE_DELAY_MS = 150;
const LOCATION_PIN = '\u{1F4CD}';

export interface AddressInputProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (location: TripLocation) => void;
  placeholder?: string;
  label?: string;
  /** Optional pass-through style for the outer wrapper (native-only, additive). */
  style?: StyleProp<ViewStyle>;
  /** Optional test id for the outer wrapper (native-only, additive). */
  testID?: string;
}

/**
 * Inlined react-i18next fallback: returns the web English fallback copy verbatim,
 * matching the VehicleSelect/DatePresetChips parity ports.
 */
function useNativeTranslationFallback(): (
  key: string,
  fallback: string,
) => string {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * Faithful port of the web Combobox `defaultFilter`: case-insensitive substring
 * match on the option label. AddressInput passes the geocoder results as a static
 * array, so the Combobox filters them locally against the typed text.
 */
function filterByQuery(
  options: GeocodeResult[],
  query: string,
): GeocodeResult[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return options;
  }
  return options.filter(o => o.display_name.toLowerCase().includes(q));
}

export function AddressInput({
  value,
  onChange,
  onSelect,
  placeholder,
  label,
  style,
  testID,
}: AddressInputProps) {
  const t = useNativeTranslationFallback();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce typed input -> geocode-search query (400ms) so we don't hammer the
  // upstream geocoder on every keystroke (web L28-31).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(value), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [value]);

  useEffect(
    () => () => {
      if (blurTimer.current) {
        clearTimeout(blurTimer.current);
      }
    },
    [],
  );

  const {data: results, isLoading} = useGeocodeSearch(debouncedQuery);

  const handleSelect = useCallback(
    (result: GeocodeResult | null) => {
      if (!result) {
        return;
      }
      if (blurTimer.current) {
        clearTimeout(blurTimer.current);
        blurTimer.current = null;
      }
      onChange(result.display_name);
      onSelect({lat: result.lat, lng: result.lng, name: result.display_name});
      setFocused(false);
    },
    [onChange, onSelect],
  );

  const handleBlur = useCallback(() => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
    }
    blurTimer.current = setTimeout(() => {
      setFocused(false);
      blurTimer.current = null;
    }, BLUR_CLOSE_DELAY_MS);
  }, []);

  const filtered = useMemo(
    () => filterByQuery(results ?? [], value),
    [results, value],
  );
  const visibleOptions = filtered.slice(0, MAX_VISIBLE_OPTIONS);
  const hiddenCount = filtered.length - visibleOptions.length;
  const loading = isLoading && debouncedQuery.length >= MIN_QUERY_LENGTH;

  const resolvedLabel = label ?? t('addressInput.label', 'Address');
  const showLabel = label != null;

  return (
    <View style={[styles.wrapper, style]} testID={testID}>
      {showLabel ? (
        <AppText style={styles.label} weight="semibold">
          {resolvedLabel}
        </AppText>
      ) : null}

      <View style={styles.field}>
        <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.pin}>
            {LOCATION_PIN}
          </AppText>
          <TextInput
            accessibilityLabel={resolvedLabel}
            onBlur={handleBlur}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={value}
          />
          {loading ? (
            <ActivityIndicator
              color={colors.accent}
              size="small"
              style={styles.spinner}
            />
          ) : null}
        </View>

        {focused ? (
          <View style={styles.dropdown}>
            {visibleOptions.length === 0 && loading ? (
              <View style={styles.emptyRow}>
                <AppText style={styles.emptyText}>
                  {t('combobox.loading', 'Loading')}
                </AppText>
              </View>
            ) : null}

            {visibleOptions.length === 0 && !loading ? (
              <View style={styles.emptyRow}>
                <AppText style={styles.emptyText}>
                  {t('combobox.noResults', 'No results')}
                </AppText>
              </View>
            ) : null}

            {visibleOptions.map(option => (
              <Pressable
                accessibilityLabel={option.display_name}
                accessibilityRole="button"
                key={`${option.lat}-${option.lng}-${option.display_name}`}
                onPress={() => handleSelect(option)}
                style={({pressed}) => [
                  styles.option,
                  pressed && styles.optionPressed,
                ]}>
                <AppText
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.optionPin}>
                  {LOCATION_PIN}
                </AppText>
                <AppText numberOfLines={2} style={styles.optionLabel}>
                  {option.display_name}
                </AppText>
              </Pressable>
            ))}

            {hiddenCount > 0 ? (
              <View style={styles.moreRow}>
                <AppText style={styles.moreText}>
                  {t(
                    'combobox.moreHidden',
                    `${hiddenCount} more \u2014 refine search`,
                  )}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 16,
  },
  field: {
    position: 'relative',
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  inputRowFocused: {
    borderColor: colors.borderAccent,
  },
  pin: {
    color: colors.textMuted,
    fontSize: 14,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    paddingVertical: spacing.sm,
  },
  spinner: {
    marginLeft: spacing.xs,
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 12,
    left: 0,
    marginTop: spacing.xs,
    maxHeight: 256,
    overflow: 'hidden',
    paddingVertical: spacing.xs,
    position: 'absolute',
    right: 0,
    top: '100%',
    zIndex: 30,
  },
  emptyRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  option: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionPin: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  optionLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  moreRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  moreText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
});

export default AddressInput;
