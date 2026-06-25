// Native parity port of web/src/components/forms/SearchInput.tsx.
//
// `SearchInput` is a debounced search field with a leading magnifier icon, a
// trailing clear button, and an optional per-scope "recent searches" dropdown
// that appears when the field is focused while empty. The `value` prop is
// controlled by the parent; local typing is buffered until `debounceMs`
// elapses, then `onChange` fires. The clear button resets to '' immediately.
//
// The web source pulls four browser/web-only modules with no native parity
// surface (rule 4/7), so a native-safe implementation is built:
//   - react-i18next `useTranslation` is absent from the native deps, so it
//     becomes a local fallback hook returning the inline English string. It
//     also interpolates `{{token}}` params (the source's removeAria copy uses
//     `{{query}}`), reusing the same interpolate() approach as the
//     ChartContainer / ReauthDialog ports. All i18n keys (common.clear,
//     search.history.*) are referenced verbatim so intent is preserved.
//   - lucide-react `Search` / `X` SVG icons have no native analog. `Search`
//     becomes a small decorative View-drawn magnifier glyph (ring + handle);
//     `X` becomes a decorative '\u00d7' AppText glyph (same text-glyph approach
//     as the InlineCallout chevron). Both are flagged decorative (web
//     `aria-hidden`).
//   - the shared web `<Input>` (icon + suffix slots) is reproduced directly
//     with a bordered View shell wrapping a React Native `TextInput`, a leading
//     glyph, and a trailing clear `Pressable`, matching Input.tsx styling
//     (rounded-md, --glass-border, --surface-1, text-sm, --text-muted
//     placeholder) so visual intent stays consistent.
//   - `@/lib/searchHistory` is localStorage-backed (browser-only). It is
//     replaced by an in-process, synchronous module-level store with the
//     IDENTICAL logic (CAP 12, MIN_QUERY_LEN 2, case-insensitive newest-first
//     dedup, FIFO eviction), mirroring how the ChartContainer port replaced its
//     localStorage annotation-hidden prefs with an in-memory Map. The only
//     behavioural delta is that history does not persist across app restarts on
//     native (no localStorage / AsyncStorage dependency) — documented in the
//     sidecar as the explicit unavailable state.
//
// Behaviour preserved: debounce window, external value re-sync, the dropdown
// visibility predicate (historyScope + showHistoryOnFocus + isFocused + empty +
// non-empty entries), record-on-blur / record-on-Enter, explicit selection
// skipping the debounce, per-entry removal with active-index clamping, and
// clear-all. The web keydown handler (Escape closes, Enter selects/records,
// ArrowUp/ArrowDown move the active index) is split across `onKeyPress`
// (hardware-keyboard Escape/Arrow keys on RNW/macOS/Windows) and
// `onSubmitEditing` (the Enter affordance on every platform incl. soft
// keyboards); `e.preventDefault()` is a no-op on native and dropped. DOM-only
// ARIA relationships (listbox id, aria-controls/activedescendant) collapse to
// the combobox role + expanded state. The `className` Tailwind sizing hook is
// kept on props for source compatibility but ignored on native, with a `style`
// override added for native consumers.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
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

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

// --- Native-safe recent-search history -------------------------------------
// In-process replacement for the localStorage-backed @/lib/searchHistory.
// Same logic, same caps, synchronous API; the store lives at module scope so it
// survives re-mounts within a session (it does not persist across app restarts
// on native — see the header / sidecar).

/** Maximum entries kept per scope; oldest entries are evicted FIFO. */
const SEARCH_HISTORY_CAP = 12;
/** Minimum length (after trim) for a query to be recorded. */
const MIN_QUERY_LEN = 2;
/** Default number of entries returned by getRecentSearches. */
const DEFAULT_RETURN = 8;

interface HistoryEntry {
  /** Original-cased text the user submitted. */
  q: string;
  /** Wall-clock ms of the most recent submission. */
  ts: number;
}

const searchHistoryStore = new Map<string, HistoryEntry[]>();

function recordSearch(scope: string, query: string): void {
  if (!scope) {
    return;
  }
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LEN) {
    return;
  }
  const existing = searchHistoryStore.get(scope) ?? [];
  const lower = trimmed.toLowerCase();
  const filtered = existing.filter(e => e.q.toLowerCase() !== lower);
  const next: HistoryEntry[] = [{q: trimmed, ts: Date.now()}, ...filtered].slice(
    0,
    SEARCH_HISTORY_CAP,
  );
  searchHistoryStore.set(scope, next);
}

function getRecentSearches(scope: string, max: number = DEFAULT_RETURN): string[] {
  if (!scope) {
    return [];
  }
  const entries = searchHistoryStore.get(scope) ?? [];
  const limit = Math.max(0, Math.min(max, SEARCH_HISTORY_CAP));
  return entries.slice(0, limit).map(e => e.q);
}

function removeSearch(scope: string, query: string): void {
  if (!scope) {
    return;
  }
  const lower = query.trim().toLowerCase();
  if (!lower) {
    return;
  }
  const existing = searchHistoryStore.get(scope);
  if (!existing) {
    return;
  }
  const next = existing.filter(e => e.q.toLowerCase() !== lower);
  if (next.length === existing.length) {
    return;
  }
  if (next.length === 0) {
    searchHistoryStore.delete(scope);
  } else {
    searchHistoryStore.set(scope, next);
  }
}

function clearScope(scope: string): void {
  if (!scope) {
    return;
  }
  searchHistoryStore.delete(scope);
}

// --- i18n fallback ----------------------------------------------------------
// react-i18next has no native parity module; resolve to the inline English
// fallback and interpolate {{token}} params so the i18n key + copy intent
// survive (same pattern as the ChartContainer / ReauthDialog ports).
type NativeTFunction = (
  key: string,
  fallback: string,
  params?: Record<string, string | number>,
) => string;

function interpolate(
  fallback: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return fallback;
  }
  return fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
}

function useTranslation(): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>(
    (_key, fallback, params) => interpolate(fallback, params),
    [],
  );
  return {t};
}

export interface SearchInputProps {
  /** Current committed value (controlled). */
  value: string;
  /** Called with the new value once the debounce window elapses. */
  onChange: (value: string) => void;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /** Debounce window in milliseconds. Defaults to 250ms. */
  debounceMs?: number;
  /** Auto-focus the field on mount. */
  autoFocus?: boolean;
  /**
   * Web Tailwind sizing class retained for source compatibility; ignored on
   * native. Use `style` for native sizing.
   */
  className?: string;
  /** Optional accessible label for the clear button. */
  clearLabel?: string;
  /**
   * Enables the recent-searches dropdown. The string is the storage scope
   * (e.g. `'drives'`, `'admin:audit'`); each scope has its own independent
   * history. Omit to keep the field history-less.
   */
  historyScope?: string;
  /**
   * When `historyScope` is set, controls whether focusing the empty field
   * shows the recent-searches dropdown. Defaults to `true`.
   */
  showHistoryOnFocus?: boolean;
  /**
   * Maximum number of history entries to render in the dropdown. Defaults
   * to 8. Capped internally by the storage capacity.
   */
  maxHistory?: number;
  /** Native style override for parity consumers (outer wrapper). */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testId?: string;
}

/**
 * Debounced search input with leading magnifier glyph and trailing clear
 * button.
 *
 * The `value` prop is controlled by the parent. Local typing state is buffered
 * until `debounceMs` elapses, then `onChange` fires with the latest text. The
 * clear button immediately resets to an empty string and emits `onChange('')`.
 *
 * When `historyScope` is set, the field also exposes a "recent searches"
 * dropdown that shows when the input is focused with an empty value. Entries
 * are recorded automatically on submit / blur (>= MIN_QUERY_LEN chars, after
 * trimming) and persist for the lifetime of the running app.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  debounceMs = 250,
  autoFocus,
  className: _className,
  clearLabel,
  historyScope,
  showHistoryOnFocus = true,
  maxHistory = 8,
  style,
  testId,
}: SearchInputProps) {
  const {t} = useTranslation();
  const [local, setLocal] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const [entries, setEntries] = useState<string[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<TextInput>(null);

  // Re-sync from the parent if the controlled value changes externally
  // (e.g. consumer resets the filter).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Debounce: only emit onChange once the user stops typing for `debounceMs`.
  useEffect(() => {
    if (local === value) {
      return;
    }
    const id = setTimeout(() => onChange(local), debounceMs);
    return () => clearTimeout(id);
  }, [local, value, debounceMs, onChange]);

  const refreshEntries = useCallback(() => {
    if (!historyScope) {
      setEntries([]);
      return;
    }
    setEntries(getRecentSearches(historyScope, maxHistory));
  }, [historyScope, maxHistory]);

  const dropdownVisible = useMemo(
    () =>
      Boolean(historyScope) &&
      showHistoryOnFocus &&
      isFocused &&
      local === '' &&
      entries.length > 0,
    [historyScope, showHistoryOnFocus, isFocused, local, entries.length],
  );

  const handleClear = useCallback(() => {
    setLocal('');
    setActiveIdx(-1);
    refreshEntries();
  }, [refreshEntries]);

  const handleFocus = useCallback(() => {
    refreshEntries();
    setIsFocused(true);
    setActiveIdx(-1);
  }, [refreshEntries]);

  const commitToHistory = useCallback(() => {
    if (!historyScope) {
      return;
    }
    if (local.trim().length >= MIN_QUERY_LEN) {
      recordSearch(historyScope, local);
    }
  }, [historyScope, local]);

  // Native analog of the web wrapper onBlur. There is no relatedTarget on
  // native, so the dropdown closes when the input loses focus; row presses are
  // still delivered because the dropdown ScrollView uses
  // keyboardShouldPersistTaps="handled". commitToHistory is a no-op while the
  // field is empty (the only time the dropdown is open), matching the web.
  const handleBlur = useCallback(() => {
    setIsFocused(false);
    setActiveIdx(-1);
    commitToHistory();
  }, [commitToHistory]);

  const selectEntry = useCallback(
    (entry: string) => {
      setLocal(entry);
      // Skip the debounce for an explicit selection so the parent sees the
      // chosen query immediately.
      onChange(entry);
      if (historyScope) {
        recordSearch(historyScope, entry);
      }
      setActiveIdx(-1);
      // Keep input focus so the user can refine without re-tapping; the
      // dropdown hides naturally once `local !== ''`.
      inputRef.current?.focus();
    },
    [historyScope, onChange],
  );

  const handleRemoveEntry = useCallback(
    (entry: string) => {
      if (!historyScope) {
        return;
      }
      removeSearch(historyScope, entry);
      const next = getRecentSearches(historyScope, maxHistory);
      setEntries(next);
      setActiveIdx(prev => Math.min(prev, next.length - 1));
      inputRef.current?.focus();
    },
    [historyScope, maxHistory],
  );

  const handleClearAll = useCallback(() => {
    if (!historyScope) {
      return;
    }
    clearScope(historyScope);
    setEntries([]);
    setActiveIdx(-1);
    inputRef.current?.focus();
  }, [historyScope]);

  // Enter is handled by onSubmitEditing below (the cross-platform affordance),
  // so this mirrors only the Escape / ArrowDown / ArrowUp branches of the web
  // keydown handler. Hardware keyboards on RNW / macOS / Windows surface these
  // through onKeyPress; e.preventDefault() has no native equivalent.
  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;
      if (key === 'Escape') {
        if (dropdownVisible) {
          setIsFocused(false);
          setActiveIdx(-1);
        }
        return;
      }
      if (key === 'Enter') {
        return;
      }
      if (!dropdownVisible) {
        return;
      }
      if (key === 'ArrowDown') {
        setActiveIdx(prev => Math.min(prev + 1, entries.length - 1));
      } else if (key === 'ArrowUp') {
        setActiveIdx(prev => Math.max(prev - 1, -1));
      }
    },
    [dropdownVisible, entries.length],
  );

  // Native Enter affordance — mirrors the web keydown Enter branch.
  const handleSubmitEditing = useCallback(() => {
    if (dropdownVisible && activeIdx >= 0 && activeIdx < entries.length) {
      selectEntry(entries[activeIdx]);
    } else if (historyScope && local.trim().length >= MIN_QUERY_LEN) {
      recordSearch(historyScope, local);
    }
  }, [dropdownVisible, activeIdx, entries, historyScope, local, selectEntry]);

  const handleChangeText = useCallback((text: string) => {
    setLocal(text);
    setActiveIdx(-1);
  }, []);

  const label = clearLabel ?? t('common.clear', 'Clear');
  const historyEnabled = Boolean(historyScope);

  return (
    <View style={[styles.wrapper, style]} testID={testId}>
      <View style={styles.inputShell}>
        <View pointerEvents="none" style={styles.leadingIcon}>
          <SearchGlyph color={colors.textMuted} size={16} />
        </View>
        <TextInput
          ref={inputRef}
          accessibilityRole={historyEnabled ? 'combobox' : 'search'}
          accessibilityState={
            historyEnabled ? {expanded: dropdownVisible} : undefined
          }
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          onBlur={historyEnabled ? handleBlur : undefined}
          onChangeText={handleChangeText}
          onFocus={historyEnabled ? handleFocus : undefined}
          onKeyPress={historyEnabled ? handleKeyPress : undefined}
          onSubmitEditing={historyEnabled ? handleSubmitEditing : undefined}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          style={styles.input}
          testID={testId ? `${testId}-input` : undefined}
          value={local}
        />
        {local ? (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleClear}
            style={({pressed}) => [styles.clearButton, pressed && styles.pressed]}
            testID={testId ? `${testId}-clear` : undefined}>
            <AppText style={[styles.clearGlyph, {color: colors.textMuted}]}>
              {'\u00d7'}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      {dropdownVisible ? (
        <View style={styles.dropdown}>
          <AppText style={styles.dropdownHeader}>
            {t('search.history.title', 'Recent searches')}
          </AppText>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.dropdownList}>
            {entries.map((entry, i) => {
              const isActive = i === activeIdx;
              return (
                <View key={`${entry}-${i}`} style={styles.optionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{selected: isActive}}
                    onPress={() => selectEntry(entry)}
                    style={[styles.optionSelect, isActive && styles.optionActive]}>
                    <SearchGlyph color={colors.textMuted} size={14} />
                    <AppText numberOfLines={1} style={styles.optionLabel}>
                      {entry}
                    </AppText>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={t(
                      'search.history.removeAria',
                      'Remove "{{query}}" from search history',
                      {query: entry},
                    )}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => handleRemoveEntry(entry)}
                    style={({pressed}) => [
                      styles.optionRemove,
                      pressed && styles.pressed,
                    ]}>
                    <AppText style={[styles.removeGlyph, {color: colors.textMuted}]}>
                      {'\u00d7'}
                    </AppText>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.dropdownFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={handleClearAll}
              style={({pressed}) => [styles.clearAll, pressed && styles.pressed]}>
              <AppText style={styles.clearAllLabel}>
                {t('search.history.clear', 'Clear history')}
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

SearchInput.displayName = 'SearchInput';

// Decorative View-drawn stand-in for the lucide-react `Search` glyph: a ring
// (the lens) plus a 45deg handle. pointerEvents=none + lives inside a
// non-accessible slot, mirroring the web `aria-hidden`.
function SearchGlyph({color, size}: {color: string; size: number}) {
  const ring = Math.round(size * 0.62);
  const handle = Math.round(size * 0.4);
  return (
    <View
      pointerEvents="none"
      style={[styles.glyphBox, {height: size, width: size}]}>
      <View
        style={[
          styles.glyphRing,
          {borderColor: color, borderRadius: ring / 2, height: ring, width: ring},
        ]}
      />
      <View style={[styles.glyphHandle, {backgroundColor: color, width: handle}]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    width: '100%',
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#0e1727', // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md, // px-3
  },
  leadingIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  input: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    flex: 1,
    fontSize: 14, // text-sm
    paddingHorizontal: 0,
    paddingVertical: 8, // py-2
  },
  clearButton: {
    alignItems: 'center',
    borderRadius: 4,
    justifyContent: 'center',
    marginLeft: spacing.sm,
    padding: 2,
  },
  clearGlyph: {
    fontSize: 16,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.6,
  },
  dropdown: {
    backgroundColor: '#0e1727', // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    left: 0,
    marginTop: 4, // mt-1
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: '100%',
    zIndex: 30, // z-30
    ...shadows.panel, // shadow-lg
  },
  dropdownHeader: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 11, // text-[11px]
    letterSpacing: 1, // tracking-wider
    paddingHorizontal: spacing.md, // px-3
    paddingVertical: 6, // py-1.5
    textTransform: 'uppercase',
  },
  dropdownList: {
    maxHeight: 256, // max-h-64
    paddingVertical: 4, // py-1
  },
  optionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4, // gap-1
    paddingHorizontal: 8, // px-2
  },
  optionSelect: {
    alignItems: 'center',
    borderRadius: 4, // rounded
    flex: 1,
    flexDirection: 'row',
    gap: 8, // gap-2
    paddingHorizontal: 8, // px-2
    paddingVertical: 6, // py-1.5
  },
  optionActive: {
    backgroundColor: '#151621', // bg-[var(--surface-2)]
  },
  optionLabel: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    flex: 1,
    fontSize: 14, // text-sm
  },
  optionRemove: {
    alignItems: 'center',
    borderRadius: 4,
    justifyContent: 'center',
    padding: 4, // p-1
  },
  removeGlyph: {
    fontSize: 14,
    lineHeight: 16,
  },
  dropdownFooter: {
    borderTopColor: colors.border, // border-t border-[var(--glass-border)]
    borderTopWidth: 1,
    paddingHorizontal: 8, // px-2
    paddingVertical: 4, // py-1
  },
  clearAll: {
    borderRadius: 4,
    paddingHorizontal: 8, // px-2
    paddingVertical: 4, // py-1
  },
  clearAllLabel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
  },
  glyphBox: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  glyphRing: {
    borderWidth: 1.5,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  glyphHandle: {
    bottom: 1,
    height: 1.5,
    position: 'absolute',
    right: 0,
    transform: [{rotate: '45deg'}],
  },
});

export default SearchInput;
