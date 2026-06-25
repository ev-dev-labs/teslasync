// Native parity port of web/src/components/feedback/KeyboardShortcutsModal.tsx.
//
// The "?" keyboard cheat sheet. Single source of truth for the shortcut list:
// it reads from a shortcut registry so any page/component can declare new
// shortcuts and have them appear here automatically. Surfaces three controls:
//   - a debounced search input (filters by description),
//   - filter chips: All / Global / This page,
//   - and (web-only on the original) a jump to the active page's group.
// The filter selection persists for the app/session so the user's choice
// survives — deliberately a session-scoped default of "All".
//
// Native-safe adaptations (documented in the sidecar):
//   - Keyboard shortcuts are inherently a browser concept: the web registry
//     (`@/hooks/useShortcutRegistry`) wires a delegated DOM `keydown` listener
//     and stores `match`/`handler` callbacks typed against the DOM
//     `KeyboardEvent`. React Native has no global `document`/`KeyboardEvent`,
//     so this file inlines a native-safe, DOM-free shortcut registry that
//     preserves the read contract (`useAllShortcuts`, `ShortcutDefinition`,
//     `registerShortcut`/`unregisterShortcut`) minus the browser-only
//     `match`/`handler` fields. No native component registers shortcuts yet,
//     so the registry is empty by default and the modal renders its explicit
//     empty state — the honest "unavailable on native" surface. Future
//     hardware-keyboard support (iPad / desktop) can populate it via the same
//     register API.
//   - `react-router-dom`'s `useLocation().pathname` has no native equivalent,
//     so the active route used for the "This page" scope filter is supplied by
//     an optional `pageRoute` prop (defaults to '').
//   - `react-i18next` is not wired in native; the i18n keys + English fallbacks
//     are preserved through a native translation fallback.
//   - `window.sessionStorage` (filter persistence) is replaced by an in-memory,
//     session-scoped store. As with other native ports there is no cross-launch
//     persistence — a fresh launch collapses to the "all" default, which is the
//     intended long-term default anyway.
//   - The shared web `Modal`, `SearchInput`, and DOM `div`/`button`/`section`/
//     `h3`/`span`/`kbd`/`p` are replaced by React Native Modal / ScrollView /
//     View / Pressable / TextInput + AppText, styled via StyleSheet against the
//     native theme tokens; `aria-*` -> accessibility props.

import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

/**
 * Scope determines visibility in the cheatsheet:
 *   - `'global'` — always visible
 *   - `'route'`  — visible only when the current route matches `routeMatch`
 *   - `'page'`   — same as `'route'`; semantic shorthand for "this component"
 */
export type ShortcutScope = 'global' | 'route' | 'page';

/**
 * A registered shortcut, in the shape the cheatsheet renders. This is the
 * native-safe subset of the web `ShortcutDefinition`: the display fields are
 * preserved verbatim, while the browser-only `match`/`handler` callbacks (typed
 * against the DOM `KeyboardEvent`, which does not exist in React Native) are
 * intentionally omitted. `priority`/`allowInInput` are kept for parity.
 */
export interface ShortcutDefinition {
  /** Stable id, also used as the cheatsheet React key + dedupe key. */
  id: string;
  /** Key combination as label tokens, e.g. `['?']`, `['Ctrl', 'K']`. */
  keys: string[];
  /** Already-translated description shown in the cheatsheet. */
  description: string;
  /** Group the shortcut renders under (already translated). */
  group: string;
  /** Visibility scope. */
  scope: ShortcutScope;
  /** Required when scope is `'route'` or `'page'`. Route prefix or regex. */
  routeMatch?: string | RegExp;
  /** Priority for resolving multiple matching definitions. Higher wins. */
  priority?: number;
  /** Whether the shortcut fires while a text input is focused. */
  allowInInput?: boolean;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutDefinition[];
}

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Native-safe replacement for the web `useLocation().pathname`. React Native
   * has no global router location, so the active route used by the "This page"
   * scope filter is supplied by the caller. Defaults to '' when unknown.
   */
  pageRoute?: string;
}

type FilterMode = 'all' | 'global' | 'page';

const FILTER_STORAGE_KEY = 'teslasync:shortcuts:filter:v1';

/* ------------------------------------------------------------------ */
/*  Native-safe shortcut registry (read + write contract preserved)    */
/* ------------------------------------------------------------------ */

interface RegistryState {
  entries: Map<string, ShortcutDefinition>;
  listeners: Set<() => void>;
  /** Cached snapshot kept stable so `useSyncExternalStore` skips re-renders. */
  snapshot: ShortcutDefinition[];
}

const store: RegistryState = {
  entries: new Map<string, ShortcutDefinition>(),
  listeners: new Set<() => void>(),
  snapshot: [],
};

function rebuildSnapshot(): void {
  store.snapshot = Array.from(store.entries.values());
}

function emit(): void {
  rebuildSnapshot();
  store.listeners.forEach(listener => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

function getSnapshot(): ShortcutDefinition[] {
  return store.snapshot;
}

/**
 * Imperative register/unregister, preserved from the web registry so future
 * native hardware-keyboard support can populate the cheatsheet through the same
 * single source of truth. Last writer wins (deduped by `id`).
 */
export function registerShortcut(def: ShortcutDefinition): void {
  store.entries.set(def.id, def);
  emit();
}

export function unregisterShortcut(id: string): void {
  if (!store.entries.delete(id)) {
    return;
  }
  emit();
}

/**
 * Read every registered shortcut, ignoring scope. The cheatsheet applies its
 * own scope/search filtering. On native this is empty unless a caller has
 * registered entries via {@link registerShortcut}.
 */
export function useAllShortcuts(): ShortcutDefinition[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* ------------------------------------------------------------------ */
/*  Session-scoped filter persistence (was window.sessionStorage)      */
/* ------------------------------------------------------------------ */

// In-memory, session-scoped store. React Native has no sessionStorage, so the
// selection persists for the life of the JS context (effectively the session)
// but not across cold launches — "all" is the intended long-term default.
let storedFilter: FilterMode | null = null;

function readStoredFilter(): FilterMode {
  const raw = storedFilter;
  if (raw === 'all' || raw === 'global' || raw === 'page') {
    return raw;
  }
  return 'all';
}

function writeStoredFilter(mode: FilterMode): void {
  storedFilter = mode;
}

/**
 * Sort groups so the cheatsheet always reads top-down: navigation → actions
 * → table-ish → page-specific. Anything not in the priority map is alpha-
 * sorted at the bottom (page groups end up there naturally).
 */
const GROUP_PRIORITY: Record<string, number> = {
  navigation: 100,
  actions: 90,
  global: 90,
  commands: 80,
  table: 70,
  bulk: 60,
  form: 50,
  chart: 40,
  dashboard: 30,
  replay: 20,
};

function groupRank(label: string): number {
  const key = label.toLowerCase().split(/\s|[(]/)[0];
  return GROUP_PRIORITY[key] ?? 0;
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ------------------------------------------------------------------ */
/*  Debounced search input (native equivalent of forms/SearchInput)    */
/* ------------------------------------------------------------------ */

function ShortcutSearchInput({
  value,
  onChange,
  placeholder,
  clearLabel,
  debounceMs = 250,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  clearLabel: string;
  debounceMs?: number;
}) {
  const [local, setLocal] = useState(value);

  // Re-sync from the parent if the controlled value changes externally (e.g.
  // the modal resets the filter to '' on close).
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

  return (
    <View style={styles.searchField}>
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setLocal}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        value={local}
      />
      {local ? (
        <Pressable
          accessibilityLabel={clearLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setLocal('')}
          style={({pressed}) => [styles.clearButton, pressed && styles.pressed]}>
          <AppText style={styles.clearButtonText} tone="muted">
            ✕
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function KeyboardShortcutsModal({
  open,
  onClose,
  pageRoute = '',
}: KeyboardShortcutsModalProps) {
  const t = useNativeTranslationFallback();
  const allShortcuts = useAllShortcuts();
  const {height} = useWindowDimensions();
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<FilterMode>(readStoredFilter);

  // Reset the live search box every time the modal closes — it's a noisy input
  // that shouldn't bleed into the next session.
  useEffect(() => {
    if (!open) {
      setSearch('');
    }
  }, [open]);

  const filteredGroups = useMemo<ShortcutGroup[]>(() => {
    const needle = search.trim().toLowerCase();
    const pathname = pageRoute;

    const visible = allShortcuts.filter(def => {
      // Scope filter
      if (mode === 'global' && def.scope !== 'global') {
        return false;
      }
      if (mode === 'page' && def.scope === 'global') {
        return false;
      }
      if (def.scope !== 'global') {
        if (!def.routeMatch) {
          return false;
        }
        const matches =
          typeof def.routeMatch === 'string'
            ? pathname.startsWith(def.routeMatch)
            : def.routeMatch.test(pathname);
        if (!matches) {
          return false;
        }
      }
      // Search filter
      if (needle && !def.description.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });

    // Group by translated label
    const byGroup = new Map<string, ShortcutDefinition[]>();
    for (const def of visible) {
      const list = byGroup.get(def.group);
      if (list) {
        list.push(def);
      } else {
        byGroup.set(def.group, [def]);
      }
    }

    // Sort groups + sort entries inside each by id for stable rendering
    return Array.from(byGroup.entries())
      .map<ShortcutGroup>(([title, shortcuts]) => ({
        title,
        shortcuts: [...shortcuts].sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => {
        const ra = groupRank(a.title);
        const rb = groupRank(b.title);
        if (ra !== rb) {
          return rb - ra;
        }
        return a.title.localeCompare(b.title);
      });
  }, [allShortcuts, mode, search, pageRoute]);

  const handleFilter = (next: FilterMode) => {
    setMode(next);
    writeStoredFilter(next);
  };

  const FILTER_OPTIONS: Array<{id: FilterMode; label: string}> = [
    {id: 'all', label: t('shortcuts.filter.all', 'All')},
    {id: 'global', label: t('shortcuts.filter.global', 'Global')},
    {id: 'page', label: t('shortcuts.filter.page', 'This page')},
  ];

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog}>
          <AppText style={styles.title} variant="title" weight="bold">
            {t('shortcuts.title', 'Keyboard Shortcuts')}
          </AppText>

          <View style={styles.header}>
            <ShortcutSearchInput
              clearLabel={t('common.clear', 'Clear')}
              debounceMs={120}
              onChange={setSearch}
              placeholder={t('shortcuts.search', 'Search shortcuts…')}
              value={search}
            />
            <View
              accessibilityLabel={t('shortcuts.filter.all', 'All')}
              accessibilityRole="tablist"
              style={styles.tablist}>
              {FILTER_OPTIONS.map(opt => {
                const active = opt.id === mode;
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{selected: active}}
                    key={opt.id}
                    onPress={() => handleFilter(opt.id)}
                    style={({pressed}) => [
                      styles.tab,
                      active && styles.tabActive,
                      pressed && !active && styles.pressed,
                    ]}>
                    <AppText
                      style={[styles.tabText, active && styles.tabTextActive]}
                      weight="semibold">
                      {opt.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ScrollView
            contentContainerStyle={styles.groupsContent}
            style={[styles.groupsScroll, {maxHeight: height * 0.6}]}>
            {filteredGroups.length === 0 ? (
              <AppText style={styles.empty} tone="muted">
                {t('shortcuts.empty', 'No shortcuts match your search.')}
              </AppText>
            ) : (
              filteredGroups.map(group => (
                <View key={group.title}>
                  <AppText
                    style={styles.sectionTitle}
                    tone="secondary"
                    weight="semibold">
                    {group.title}
                  </AppText>
                  <View style={styles.shortcutList}>
                    {group.shortcuts.map(s => (
                      <View key={s.id} style={styles.shortcutRow}>
                        <AppText style={styles.shortcutDescription} tone="secondary">
                          {s.description}
                        </AppText>
                        <View style={styles.keysRow}>
                          {s.keys.map((key, i) => (
                            <View key={i} style={styles.keyToken}>
                              {i > 0 ? (
                                <AppText style={styles.plus} tone="muted">
                                  +
                                </AppText>
                              ) : null}
                              <View style={styles.kbd}>
                                <AppText style={styles.kbdText} tone="secondary">
                                  {key}
                                </AppText>
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

KeyboardShortcutsModal.displayName = 'KeyboardShortcutsModal';

// Re-export the storage key so callers/tests can assert the persistence
// identity is preserved from the web component.
export {FILTER_STORAGE_KEY};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  clearButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    minWidth: 28,
  },
  clearButtonText: {
    fontSize: typography.caption,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxHeight: '88%',
    maxWidth: 640,
    padding: spacing.lg,
    width: '92%',
  },
  empty: {
    fontSize: typography.caption,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  groupsContent: {
    gap: spacing.lg,
    paddingRight: spacing.xs,
  },
  groupsScroll: {
    flexGrow: 0,
  },
  header: {
    gap: spacing.md,
  },
  kbd: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 24,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  kbdText: {
    fontFamily: 'monospace',
    fontSize: typography.caption,
    textAlign: 'center',
  },
  keyToken: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  keysRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.xs,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  plus: {
    fontSize: typography.caption,
  },
  pressed: {
    opacity: 0.7,
  },
  searchField: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    minHeight: 40,
    paddingVertical: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.caption,
    marginBottom: spacing.md,
  },
  shortcutDescription: {
    flexShrink: 1,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  shortcutList: {
    gap: spacing.xs,
  },
  shortcutRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  tab: {
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tabActive: {
    backgroundColor: colors.accentSoft,
  },
  tablist: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: 2,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  tabTextActive: {
    color: colors.textPrimary,
  },
  title: {
    color: colors.textPrimary,
  },
});

export default KeyboardShortcutsModal;
