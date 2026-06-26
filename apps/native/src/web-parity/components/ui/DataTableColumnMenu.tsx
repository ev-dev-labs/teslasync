// Native parity port of web/src/components/ui/DataTableColumnMenu.tsx.
//
// The web module is the combined column visibility + reorder menu: an
// icon-button trigger plus a popover with one row per column
// ([checkbox] Header  ↑ ↓), a "Reset to defaults" action, and the
// "at least one column must stay visible" guardrail. Behavior, state names
// (`open`, `orderedKeys`, `visibleCount`, `ensureLayout`, `effectiveHidden`,
// `handleToggle`, `handleMove`, `triggerLabel`), the `data-testid` hooks, and
// the i18n keys/intent are all preserved.
//
// DOM/web-only pieces and their native mappings:
//   - `lucide-react` icons (ArrowUp/ArrowDown/Columns3/RotateCcw) have no
//     native package here; the app's SemanticIcon badge system is sized for
//     larger feature glyphs, so these small inline button icons are rendered as
//     unicode glyphs (↑ ↓ ▦ ↺ ✓) inside <AppText>.
//   - `react-i18next` is not installed on native; `useTranslation().t` is
//     replaced by a local `translate(key, fallback, vars)` helper that returns
//     the source's English fallback and performs the same `{{col}}`
//     interpolation, preserving every i18n key + default string as intent.
//   - `@/lib/columnOrderStore` is a DOM-free transform module not yet ported to
//     native; the five pure helpers this component depends on
//     (effectiveColumnOrder, applyColumnLayout, defaultColumnLayout,
//     moveColumn, toggleHiddenColumn) and the `ColumnLayout` type are inlined
//     verbatim as a native-safe local port. The store's localStorage round-trip
//     stays the caller's responsibility, exactly as on web.
//   - The web popover closes on `document` mousedown-outside + Escape (the
//     `containerRef`/useEffect listeners). Native has no document; the popover
//     renders inside a transparent RN <Modal> whose full-screen backdrop
//     Pressable reproduces "tap outside to close" and whose `onRequestClose`
//     (Android hardware back) reproduces the Escape dismissal. The exact
//     `absolute right-0 mt-1` trigger anchoring is approximated as a top-right
//     anchored sheet because RN cannot position relative to the trigger without
//     measuring it. The `cn` class merge helper and all hover/focus-visible
//     affordances (no native pointer/focus-ring) are dropped; `className` props
//     are accepted-but-ignored for source compatibility. See the .parity.json
//     sidecar for the line-by-line map.

import React, {useState, type ReactNode} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

// --- Native-safe local port of the pure transforms from
// web/src/lib/columnOrderStore.ts (DOM-free; localStorage helpers omitted). ---

export interface ColumnLayout {
  /** Column-key order. Keys not present here keep their default position
   *  AFTER any keys that are present (in source-column order). */
  order: string[];
  /** Column keys hidden by the user. */
  hidden: string[];
}

/** Compute the effective ordered visible columns for rendering. Mirrors
 *  applyColumnLayout in columnOrderStore: drop hidden keys, place layout.order
 *  first, append remaining columns in source order, and fall back to the
 *  default-visible set so the table never renders zero columns. */
function applyColumnLayout<C extends {key: string; defaultVisible?: boolean}>(
  columns: readonly C[],
  layout: ColumnLayout | null,
): C[] {
  if (!layout) {
    return columns.filter((c) => c.defaultVisible !== false);
  }
  const knownKeys = new Set(columns.map((c) => c.key));
  const hiddenSet = new Set(layout.hidden.filter((k) => knownKeys.has(k)));
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const k of layout.order) {
    if (knownKeys.has(k) && !seen.has(k)) {
      orderedKeys.push(k);
      seen.add(k);
    }
  }
  for (const c of columns) {
    if (!seen.has(c.key)) {
      orderedKeys.push(c.key);
      seen.add(c.key);
    }
  }
  const visibleKeys = orderedKeys.filter((k) => !hiddenSet.has(k));
  if (visibleKeys.length === 0) {
    return columns.filter((c) => c.defaultVisible !== false);
  }
  const byKey = new Map(columns.map((c) => [c.key, c] as const));
  return visibleKeys
    .map((k) => byKey.get(k))
    .filter((c): c is C => Boolean(c));
}

/** Build the full ordered key list (visible + hidden) used to render rows in
 *  effective layout order. Mirrors effectiveColumnOrder in columnOrderStore. */
function effectiveColumnOrder<C extends {key: string}>(
  columns: readonly C[],
  layout: ColumnLayout | null,
): string[] {
  if (!layout || layout.order.length === 0) {
    return columns.map((c) => c.key);
  }
  const knownKeys = new Set(columns.map((c) => c.key));
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const k of layout.order) {
    if (knownKeys.has(k) && !seen.has(k)) {
      ordered.push(k);
      seen.add(k);
    }
  }
  for (const c of columns) {
    if (!seen.has(c.key)) {
      ordered.push(c.key);
      seen.add(c.key);
    }
  }
  return ordered;
}

/** Move `key` to position `toIndex` in `currentOrder`, returning the new full
 *  order array. Mirrors moveColumn in columnOrderStore. */
function moveColumn(
  currentOrder: readonly string[],
  key: string,
  toIndex: number,
): string[] {
  const fromIndex = currentOrder.indexOf(key);
  if (fromIndex < 0) {
    return currentOrder.slice();
  }
  const next = currentOrder.slice();
  next.splice(fromIndex, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, key);
  return next;
}

/** Toggle a column's hidden state, returning a fresh layout. Mirrors
 *  toggleHiddenColumn in columnOrderStore. */
function toggleHiddenColumn(layout: ColumnLayout, key: string): ColumnLayout {
  const isHidden = layout.hidden.includes(key);
  return {
    order: layout.order.slice(),
    hidden: isHidden
      ? layout.hidden.filter((k) => k !== key)
      : [...layout.hidden, key],
  };
}

/** Build the initial layout for a table the first time the column menu opens.
 *  Mirrors defaultColumnLayout in columnOrderStore. */
function defaultColumnLayout<C extends {key: string; defaultVisible?: boolean}>(
  columns: readonly C[],
): ColumnLayout {
  return {
    order: columns.map((c) => c.key),
    hidden: columns.filter((c) => c.defaultVisible === false).map((c) => c.key),
  };
}

// --- Local i18n shim: preserves the web `t(key, fallback, vars)` contract and
// `{{var}}` interpolation without react-i18next (not installed on native). ---

type TranslateVars = Record<string, string | number>;

function translate(_key: string, fallback: string, vars?: TranslateVars): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Combined column visibility and reorder menu — native parity of the web
 * DataTableColumnMenu. Renders an icon-button trigger + popover with one row
 * per column:
 *   [✓] Header                         ↑   ↓
 * - Checkbox toggles visibility (with the same "at least one must stay
 *   visible" guardrail as the legacy menu).
 * - ↑ / ↓ buttons are the keyboard fallback for drag-to-reorder; they move the
 *   column up / down within the effective order list.
 * - "Reset to defaults" clears the persisted layout so the table reverts to its
 *   source-defined order + `defaultVisible` visibility.
 * The component is deliberately storage-agnostic — the table owns the
 * persistence round-trip and feeds us the current `layout` + a controlled
 * `onChange`.
 */

interface ColumnDescriptor {
  key: string;
  header: string;
  /** When true, the column cannot be hidden (e.g. selection / expand columns).
   *  Reorder is unaffected. */
  required?: boolean;
  /** Default visibility for the "Reset" computation. Defaults to true. */
  defaultVisible?: boolean;
}

interface DataTableColumnMenuProps {
  columns: ColumnDescriptor[];
  layout: ColumnLayout | null;
  onChange: (next: ColumnLayout) => void;
  onReset: () => void;
  /** When false, ↑/↓ buttons are hidden and the menu acts as a pure visibility
   *  checklist (matches legacy `showColumnsMenu` behavior). */
  reorderable?: boolean;
  /** When false, checkboxes are hidden and the menu acts as a pure reorder
   *  list. */
  toggleable?: boolean;
  trigger?: (open: () => void) => ReactNode;
  /** Web Tailwind className. Retained for source compatibility; ignored on
   *  native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DataTableColumnMenu({
  columns,
  layout,
  onChange,
  onReset,
  reorderable = true,
  toggleable = true,
  trigger,
  className: _className,
  style,
  testID,
}: DataTableColumnMenuProps) {
  const t = translate;
  const [open, setOpen] = useState(false);

  const orderedKeys = effectiveColumnOrder(columns, layout);
  const colByKey = new Map(columns.map((c) => [c.key, c] as const));
  const visibleCount = applyColumnLayout(columns, layout).length;

  const ensureLayout = (): ColumnLayout => layout ?? defaultColumnLayout(columns);

  // Effective hidden set used to drive checkbox `checked` state. When the user
  // hasn't touched anything yet, we honor `defaultVisible: false` so the menu
  // reflects the table's initial render.
  const effectiveHidden = new Set(
    (layout ?? defaultColumnLayout(columns)).hidden,
  );

  const handleToggle = (key: string) => {
    const base = ensureLayout();
    const isHidden = base.hidden.includes(key);
    // Don't allow hiding the last visible column.
    if (!isHidden && visibleCount <= 1) {
      return;
    }
    onChange(toggleHiddenColumn(base, key));
  };

  const handleMove = (key: string, direction: -1 | 1) => {
    const base = ensureLayout();
    const currentOrder = effectiveColumnOrder(columns, base);
    const fromIndex = currentOrder.indexOf(key);
    if (fromIndex < 0) {
      return;
    }
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= currentOrder.length) {
      return;
    }
    const nextOrder = moveColumn(currentOrder, key, toIndex);
    onChange({order: nextOrder, hidden: base.hidden.slice()});
  };

  const triggerLabel = reorderable
    ? t('table.columns.menuReorder', 'Reorder or hide columns')
    : t('table.columns.menu', 'Show or hide columns');

  const toggleOpen = () => setOpen((v) => !v);
  const close = () => setOpen(false);

  return (
    <View style={[styles.root, style]} testID={testID}>
      {trigger ? (
        trigger(toggleOpen)
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{expanded: open}}
          accessibilityLabel={triggerLabel}
          onPress={toggleOpen}
          style={({pressed}) => [styles.trigger, pressed && styles.triggerPressed]}>
          <AppText style={styles.triggerGlyph} accessible={false}>
            ▦
          </AppText>
          <AppText style={styles.triggerLabel}>
            {t('table.columns.button', 'Columns')}
          </AppText>
        </Pressable>
      )}

      {open && (
        <Modal
          transparent
          visible
          animationType="fade"
          onRequestClose={close}>
          <Pressable
            style={styles.backdrop}
            accessibilityLabel={t('table.columns.dismiss', 'Close column menu')}
            onPress={close}
          />
          <View style={styles.menuPositioner}>
            <View
              accessibilityRole="menu"
              accessibilityLabel={triggerLabel}
              testID="datatable-column-menu"
              style={styles.menu}>
              <View style={styles.menuHeader}>
                <AppText style={styles.menuHeading}>
                  {reorderable
                    ? t('table.columns.headingReorder', 'Columns')
                    : t('table.columns.heading', 'Visible columns')}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('table.columns.reset', 'Reset')}
                  onPress={() => {
                    onReset();
                  }}
                  testID="datatable-column-menu-reset"
                  style={styles.resetButton}>
                  <AppText style={styles.resetGlyph} accessible={false}>
                    ↺
                  </AppText>
                  <AppText style={styles.resetLabel}>
                    {t('table.columns.reset', 'Reset')}
                  </AppText>
                </Pressable>
              </View>
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                {orderedKeys.map((key, idx) => {
                  const col = colByKey.get(key);
                  if (!col) {
                    return null;
                  }
                  const isHidden = effectiveHidden.has(key);
                  const checked = !isHidden;
                  const checkboxDisabled =
                    Boolean(col.required) || (checked && visibleCount <= 1);
                  const upDisabled = idx === 0;
                  const downDisabled = idx === orderedKeys.length - 1;
                  const label = col.header || col.key;
                  return (
                    <View key={col.key} style={styles.row}>
                      {toggleable && (
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{
                            checked,
                            disabled: checkboxDisabled,
                          }}
                          accessibilityLabel={t(
                            'table.columns.toggleColumn',
                            'Show or hide {{col}}',
                            {col: label},
                          )}
                          disabled={checkboxDisabled}
                          onPress={() => handleToggle(col.key)}
                          style={[
                            styles.checkbox,
                            checked && styles.checkboxChecked,
                            checkboxDisabled && styles.disabled,
                          ]}>
                          {checked && (
                            <AppText style={styles.checkboxGlyph} accessible={false}>
                              ✓
                            </AppText>
                          )}
                        </Pressable>
                      )}
                      <AppText style={styles.rowLabel} numberOfLines={1}>
                        {label}
                      </AppText>
                      {reorderable && (
                        <View style={styles.reorderControls}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{disabled: upDisabled}}
                            accessibilityLabel={t(
                              'table.columns.moveUp',
                              'Move {{col}} up',
                              {col: label},
                            )}
                            disabled={upDisabled}
                            onPress={() => handleMove(col.key, -1)}
                            testID={`datatable-column-menu-up-${col.key}`}
                            style={[styles.iconButton, upDisabled && styles.iconButtonDisabled]}>
                            <AppText style={styles.iconButtonGlyph} accessible={false}>
                              ↑
                            </AppText>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{disabled: downDisabled}}
                            accessibilityLabel={t(
                              'table.columns.moveDown',
                              'Move {{col}} down',
                              {col: label},
                            )}
                            disabled={downDisabled}
                            onPress={() => handleMove(col.key, 1)}
                            testID={`datatable-column-menu-down-${col.key}`}
                            style={[styles.iconButton, downDisabled && styles.iconButtonDisabled]}>
                            <AppText style={styles.iconButtonGlyph} accessible={false}>
                              ↓
                            </AppText>
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

DataTableColumnMenu.displayName = 'DataTableColumnMenu';

const subtleBorder = 'rgba(255, 255, 255, 0.08)';
const subtleSurface = 'rgba(255, 255, 255, 0.04)';

const styles = StyleSheet.create({
  root: {
    alignSelf: 'flex-start',
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: subtleSurface,
    borderColor: subtleBorder,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6, // gap-1.5
    paddingHorizontal: 8, // px-2
    paddingVertical: 4, // py-1
  },
  triggerPressed: {
    backgroundColor: colors.surfaceHover,
  },
  triggerGlyph: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 16,
  },
  triggerLabel: {
    color: colors.textSecondary,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  menuPositioner: {
    alignItems: 'flex-end', // right-0
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 56, // approximate anchored-below-trigger inset (native has no DOM anchor)
    pointerEvents: 'box-none',
  },
  menu: {
    backgroundColor: colors.surface, // --surface-elevated
    borderColor: subtleBorder,
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    elevation: 12, // shadow-xl
    maxWidth: '100%',
    padding: 8, // p-2
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.34,
    shadowRadius: 24,
    width: 288, // w-72
  },
  menuHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8, // mb-2
    paddingHorizontal: 4, // px-1
  },
  menuHeading: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    fontWeight: '500',
    letterSpacing: 0.8, // tracking-wider
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  resetButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4, // gap-1
  },
  resetGlyph: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 14,
  },
  resetLabel: {
    color: colors.accent, // text-cyan-300
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 14,
  },
  list: {
    maxHeight: 288, // max-h-72
  },
  listContent: {
    gap: 2, // space-y-0.5
  },
  row: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: 8, // gap-2
    paddingHorizontal: 8, // px-2
    paddingVertical: 6, // py-1.5
  },
  rowLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 14, // text-sm
    lineHeight: 18,
  },
  checkbox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised, // --surface-2
    borderColor: colors.border, // --border-strong
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxChecked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxGlyph: {
    color: colors.accent, // text-cyan-500
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  disabled: {
    opacity: 0.5, // opacity-50 cursor-not-allowed
  },
  reorderControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2, // gap-0.5
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 4,
    height: 24, // h-6
    justifyContent: 'center',
    width: 24, // w-6
  },
  iconButtonDisabled: {
    opacity: 0.3, // disabled:opacity-30
  },
  iconButtonGlyph: {
    color: colors.textMuted,
    fontSize: 14, // h-3.5 w-3.5
    lineHeight: 16,
  },
});
