// Native parity port of
// web/src/features/dashboard/components/LayoutManager.tsx.
//
// The web component is the dashboard "layout switcher": a horizontally
// scrollable strip of saved-dashboard tabs (`overflow-x-auto`) that lets the
// user switch the active layout, rename a layout inline, create a new layout
// (or open the templates picker), reorder layouts by drag-and-drop, and open a
// per-tab context menu (Rename / Duplicate / Settings / ─ / Delete). It is
// reproduced here with React Native primitives, preserving the
// `LayoutManagerProps` contract (all ten callbacks), every state name
// (`editingId`, `editName`, `isCreating`, `newName`, `inputRef`, `dragIndex`,
// `dragOverIndex`, `ctxMenu`), the `dashboard.*` i18n keys + English fallbacks,
// the `d.icon ?? '📊'` default-icon fallback, the `isDefault` "default" badge,
// and the delete-disabled-on-default guard:
//
//   - `useTranslation('dashboard')` (react-i18next) is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the AddWidgetButton /
//     RangeSlider ports), so every key + copy is preserved.
//   - `@/lib/cn` (clsx + tailwind-merge) and the Tailwind/CSS-var class strings
//     are dropped; styling becomes RN StyleSheet records. The CSS-var colors are
//     preserved as literals: `--theme-primary` -> the cyan accent token
//     (active-tab tint/border at /10 + /20), `--surface-2` -> #151621 (inactive
//     tab + input fill), `--bg-secondary` -> a solid #0c121f menu surface (the
//     web translucent var would let the Modal backdrop bleed through),
//     `--border-*` -> the border token, `--text-*` -> the text tokens,
//     red-400 / red-500/10 (danger) and emerald-400 / emerald-500/10 (confirm)
//     -> their literal hex, matching the "keep the web's explicit color" approach
//     the RangeSlider/Button ports took.
//   - `@/components/ui` `Button` is the already-ported native parity Button; the
//     New-Layout / confirm / cancel controls use it (variant="ghost"). The
//     colored confirm (emerald) / cancel (muted) glyphs are passed as element
//     children so the Button renders them as-is instead of re-tinting them.
//   - `@/components/ui` `Input` has no native parity component, so the rename /
//     create inputs become RN `TextInput`s. The web `onChange(e.target.value)`
//     -> `onChangeText`; the `onKeyDown` Enter/Escape handling -> `onSubmitEditing`
//     (Enter -> confirm) + `onKeyPress` (Escape -> cancel); `inputRef`
//     (HTMLInputElement) -> a `TextInput` ref and `inputRef.current?.focus()`
//     works unchanged. `type="text"` is the RN default and is dropped.
//   - lucide icons (Plus / Pencil / Trash2 / Check / X / Copy / Settings) have no
//     native icon dependency; per the AddWidgetButton glyph precedent they become
//     decorative text glyphs in AppText, with the meaning carried by the adjacent
//     label or the control's accessibilityLabel.
//   - The web context menu is an HTML `onContextMenu` (right-click) opening a
//     `position: fixed` div clamped to the viewport, closed by a document
//     mousedown-outside / Escape `useEffect`. Native has no right-click, so it is
//     opened by `onLongPress` (the native secondary-action gesture); the clamp
//     math is preserved verbatim against `Dimensions.get('window')` using the
//     long-press `pageX/pageY`, so the `ctxMenu` state stays `{ x, y, dashId }`.
//     The menu renders in a `Modal` whose full-screen backdrop Pressable replaces
//     the document mousedown-outside listener and whose `onRequestClose`
//     (hardware back) replaces the Escape listener — so the close `useEffect` +
//     `ctxRef` DOM ref are not needed and are dropped (documented in the sidecar).
//   - Drag-and-drop reorder: the web uses the HTML5 Drag API (`draggable`,
//     `onDragStart/Over/Drop/End`, `dataTransfer.setDragImage`), which is
//     browser-only. It is reproduced with a single `PanResponder` on the tab row
//     (the same RN drag primitive the RangeSlider port used): a horizontal drag
//     that begins on a tab claims the gesture (`onMoveShouldSetPanResponder`),
//     `dragIndex` is hit-tested from the grant location, `dragOverIndex` tracks
//     the nearest tab centre as the finger moves, and on release `onReorder`
//     fires for a changed slot — preserving the `onReorder(from, to)` contract
//     and both drag-state names + their visual cues (the dragged tab dims to 0.5
//     opacity; the drop-target tab shows the accent left border). Scrolling is
//     locked while a drag is active. `dataTransfer.setDragImage` has no native
//     analog and is dropped (documented).

import React, {useCallback, useRef, useState} from 'react';
import {
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows} from '../../../../theme/tokens';
import {Button} from '../../../components/ui/Button';

/**
 * Subset of the web `../widgets/types` `SavedDashboard` contract consumed by the
 * LayoutManager. Only the identity / label / default-flag fields are read here;
 * the full widget / layout / settings payload is carried opaquely by callers, so
 * it is not re-declared in this native port (a full SavedDashboard remains
 * structurally assignable to this narrower shape).
 */
export interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  isDefault?: boolean;
}

export interface LayoutManagerProps {
  dashboards: SavedDashboard[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDuplicate: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onOpenTemplates?: () => void;
}

/* ─── i18n fallback shim ───────────────────────────────────────────────────── */
// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the `dashboard.*` keys.

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── decorative glyphs (lucide stand-ins) ─────────────────────────────────── */
// Decorative only — meaning is carried by the adjacent label / accessibilityLabel.
const PLUS_GLYPH = '+'; // lucide Plus
const CHECK_GLYPH = '\u2713'; // lucide Check ✓
const CLOSE_GLYPH = '\u2715'; // lucide X ✕
const PENCIL_GLYPH = '\u270E'; // lucide Pencil ✎
const COPY_GLYPH = '\u29C9'; // lucide Copy ⧉
const SETTINGS_GLYPH = '\u2699'; // lucide Settings ⚙
const TRASH_GLYPH = '\uD83D\uDDD1'; // lucide Trash2 🗑
const DEFAULT_DASH_ICON = '\uD83D\uDCCA'; // web `d.icon ?? '📊'`

/* ─── color literals (CSS-var intent preserved) ────────────────────────────── */
const THEME_PRIMARY = colors.accent; // --theme-primary
const THEME_PRIMARY_BG = 'rgba(53, 213, 255, 0.1)'; // --theme-primary/10
const THEME_PRIMARY_BORDER = 'rgba(53, 213, 255, 0.2)'; // --theme-primary/20
const SURFACE_2 = '#151621'; // --surface-2
const MENU_BG = '#0c121f'; // --bg-secondary (solid, opaque popover surface)
const RED_400 = '#f87171'; // danger text
const RED_500_10 = 'rgba(239, 68, 68, 0.1)'; // danger pressed bg
const EMERALD_400 = '#34d399'; // confirm text

// Context-menu viewport clamp dimensions, preserved verbatim from the web.
const MENU_W = 180;
const MENU_H = 160;

// Minimum horizontal travel before a tap-on-a-tab becomes a reorder drag.
const REORDER_SLOP = 6;

/* ─── Context menu item ─── */
// Web `CtxItem` was a full-width ghost `<UiButton>` with a leading lucide icon +
// label, optional danger (red) styling and a disabled state. Here it is a
// full-width Pressable row; the lucide icon component prop becomes a `glyph`
// string and the `hover:` background becomes the Pressable `pressed` state.
function CtxItem({
  glyph,
  label,
  onPress,
  danger,
  disabled,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: Boolean(disabled)}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.ctxItem,
        pressed && !disabled
          ? danger
            ? styles.ctxItemPressedDanger
            : styles.ctxItemPressed
          : null,
        disabled ? styles.ctxItemDisabled : null,
      ]}>
      <AppText style={[styles.ctxGlyph, danger ? styles.ctxGlyphDanger : null]}>
        {glyph}
      </AppText>
      <AppText style={[styles.ctxLabel, danger ? styles.ctxLabelDanger : null]}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function LayoutManager({
  dashboards,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onDuplicate,
  onOpenSettings,
  onOpenTemplates,
}: LayoutManagerProps) {
  const t = useNativeTranslationFallback();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<TextInput>(null);

  /* ─── Drag state ─── */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Latest drag indices for the once-created PanResponder to read on release
  // (state is async; refs mirror it synchronously).
  const dragIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  // Per-tab horizontal offsets (content-row coordinate space) for hit-testing.
  const tabLayoutsRef = useRef<Map<number, {x: number; width: number}>>(
    new Map(),
  );
  const startContentXRef = useRef(0);

  /* ─── Context menu state ─── */
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    dashId: string;
  } | null>(null);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  const handleContextMenu = useCallback(
    (dashId: string) => (e: GestureResponderEvent) => {
      // Clamp to viewport bounds (web used window.innerWidth/Height).
      const {width: winW, height: winH} = Dimensions.get('window');
      const x = Math.min(e.nativeEvent.pageX, winW - MENU_W);
      const y = Math.min(e.nativeEvent.pageY, winH - MENU_H);
      setCtxMenu({x: Math.max(0, x), y: Math.max(0, y), dashId});
    },
    [],
  );

  /* ─── Drag handlers ─── */
  // Nearest-centre hit-test against the recorded tab offsets — the RN analog of
  // the browser resolving which element the pointer is over during a drag.
  const hitTest = useCallback((contentX: number): number | null => {
    const layouts = tabLayoutsRef.current;
    if (layouts.size === 0) {
      return null;
    }
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    layouts.forEach((rect, idx) => {
      const center = rect.x + rect.width / 2;
      const dist = Math.abs(center - contentX);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    });
    return best;
  }, []);

  const handleTabLayout = useCallback(
    (index: number) => (e: LayoutChangeEvent) => {
      const {x, width} = e.nativeEvent.layout;
      tabLayoutsRef.current.set(index, {x, width});
    },
    [],
  );

  // Stable closures the once-created PanResponder captures; they read the latest
  // props/refs so the responder never needs re-creating (RangeSlider precedent).
  const stateRef = useRef({onReorder});
  stateRef.current = {onReorder};

  const finishDrag = useCallback(() => {
    const from = dragIndexRef.current;
    const to = dragOverIndexRef.current;
    if (from !== null && to !== null && from !== to) {
      stateRef.current.onReorder(from, to);
    }
    dragIndexRef.current = null;
    dragOverIndexRef.current = null;
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      // Taps/long-presses reach the child tab Pressables; only a horizontal drag
      // claims the gesture for reorder.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > REORDER_SLOP &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: evt => {
        const cx = evt.nativeEvent.locationX;
        startContentXRef.current = cx;
        const idx = hitTest(cx);
        dragIndexRef.current = idx;
        dragOverIndexRef.current = idx;
        setDragIndex(idx);
        setDragOverIndex(idx);
      },
      onPanResponderMove: (_evt, gesture) => {
        const cx = startContentXRef.current + gesture.dx;
        const idx = hitTest(cx);
        if (idx !== dragOverIndexRef.current) {
          dragOverIndexRef.current = idx;
          setDragOverIndex(idx);
        }
      },
      onPanResponderRelease: () => finishDrag(),
      onPanResponderTerminate: () => finishDrag(),
    }),
  ).current;

  /* ─── Rename ─── */
  const startRename = (d: SavedDashboard) => {
    setEditingId(d.id);
    setEditName(d.name);
    setCtxMenu(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmRename = () => {
    if (editingId && editName.trim()) {
      onRename(editingId, editName.trim());
    }
    setEditingId(null);
  };

  /* ─── Create ─── */
  const startCreate = () => {
    if (onOpenTemplates) {
      onOpenTemplates();
      return;
    }
    setIsCreating(true);
    setNewName('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const confirmCreate = () => {
    if (newName.trim()) {
      onCreate(newName.trim());
    }
    setIsCreating(false);
  };

  /* ─── Context menu actions ─── */
  const ctxDash = ctxMenu
    ? dashboards.find(d => d.id === ctxMenu.dashId)
    : null;

  return (
    <>
      <ScrollView
        horizontal
        scrollEnabled={dragIndex === null}
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}>
        <View style={styles.row} {...panResponder.panHandlers}>
          {dashboards.map((d, i) => (
          <View
            key={d.id}
            onLayout={handleTabLayout(i)}
            style={styles.tabWrapper}>
            {editingId === d.id ? (
              <View style={styles.editRow}>
                <TextInput
                  ref={inputRef}
                  onChangeText={setEditName}
                  onKeyPress={(
                    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
                  ) => {
                    if (e.nativeEvent.key === 'Escape') {
                      setEditingId(null);
                    }
                  }}
                  onSubmitEditing={confirmRename}
                  style={styles.input}
                  value={editName}
                />
                <Button
                  accessibilityLabel={t(
                    'dashboard.confirmRename',
                    'Confirm rename',
                  )}
                  onPress={confirmRename}
                  size="sm"
                  style={styles.iconButton}
                  variant="ghost">
                  <AppText style={styles.confirmGlyph}>{CHECK_GLYPH}</AppText>
                </Button>
                <Button
                  accessibilityLabel={t(
                    'dashboard.cancelRename',
                    'Cancel rename',
                  )}
                  onPress={() => setEditingId(null)}
                  size="sm"
                  style={styles.iconButton}
                  variant="ghost">
                  <AppText style={styles.cancelGlyph}>{CLOSE_GLYPH}</AppText>
                </Button>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                onLongPress={handleContextMenu(d.id)}
                onPress={() => onSwitch(d.id)}
                style={[
                  styles.tab,
                  d.id === activeId ? styles.tabActive : styles.tabInactive,
                  dragIndex === i ? styles.tabDragging : null,
                  dragOverIndex === i && dragIndex !== i
                    ? styles.tabDragOver
                    : null,
                ]}>
                <AppText style={styles.tabIcon}>
                  {d.icon ?? DEFAULT_DASH_ICON}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={[
                    styles.tabLabel,
                    d.id === activeId
                      ? styles.tabLabelActive
                      : styles.tabLabelInactive,
                  ]}>
                  {d.name}
                </AppText>
                {d.isDefault ? (
                  <AppText style={styles.defaultBadge}>
                    {t('dashboard.default', 'default')}
                  </AppText>
                ) : null}
              </Pressable>
            )}
          </View>
        ))}

        {/* New layout button / input */}
        {isCreating ? (
          <View style={styles.editRow}>
            <TextInput
              ref={inputRef}
              onChangeText={setNewName}
              onKeyPress={(
                e: NativeSyntheticEvent<TextInputKeyPressEventData>,
              ) => {
                if (e.nativeEvent.key === 'Escape') {
                  setIsCreating(false);
                }
              }}
              onSubmitEditing={confirmCreate}
              placeholder={t('dashboard.newName', 'Layout name...')}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={newName}
            />
            <Button
              accessibilityLabel={t('dashboard.confirmCreate', 'Confirm create')}
              onPress={confirmCreate}
              size="sm"
              style={styles.iconButton}
              variant="ghost">
              <AppText style={styles.confirmGlyph}>{CHECK_GLYPH}</AppText>
            </Button>
            <Button
              accessibilityLabel={t('dashboard.cancelCreate', 'Cancel create')}
              onPress={() => setIsCreating(false)}
              size="sm"
              style={styles.iconButton}
              variant="ghost">
              <AppText style={styles.cancelGlyph}>{CLOSE_GLYPH}</AppText>
            </Button>
          </View>
        ) : (
          <Button
            icon={<AppText style={styles.newGlyph}>{PLUS_GLYPH}</AppText>}
            onPress={startCreate}
            size="auto"
            style={styles.newButton}
            variant="ghost">
            <AppText style={styles.newLabel}>
              {t('dashboard.newLayout', 'New Layout')}
            </AppText>
          </Button>
        )}
        </View>
      </ScrollView>

      {/* Context menu */}
      {ctxMenu && ctxDash ? (
        <Modal
          animationType="fade"
          onRequestClose={closeCtxMenu}
          transparent
          visible>
          <View style={styles.modalRoot}>
            <Pressable
              accessibilityLabel={t('dashboard.closeMenu', 'Close menu')}
              onPress={closeCtxMenu}
              style={styles.backdrop}
            />
            <View style={[styles.menu, {top: ctxMenu.y, left: ctxMenu.x}]}>
              <CtxItem
                glyph={PENCIL_GLYPH}
                label={t('dashboard.rename', 'Rename')}
                onPress={() => startRename(ctxDash)}
              />
              <CtxItem
                glyph={COPY_GLYPH}
                label={t('dashboard.duplicate', 'Duplicate')}
                onPress={() => {
                  onDuplicate(ctxMenu.dashId);
                  setCtxMenu(null);
                }}
              />
              <CtxItem
                glyph={SETTINGS_GLYPH}
                label={t('dashboard.settings', 'Settings')}
                onPress={() => {
                  onOpenSettings(ctxMenu.dashId);
                  setCtxMenu(null);
                }}
              />
              <View style={styles.menuDivider} />
              <CtxItem
                danger
                disabled={Boolean(ctxDash.isDefault)}
                glyph={TRASH_GLYPH}
                label={t('dashboard.delete', 'Delete')}
                onPress={() => {
                  onDelete(ctxMenu.dashId);
                  setCtxMenu(null);
                }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

LayoutManager.displayName = 'LayoutManager';

export default LayoutManager;

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  cancelGlyph: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  confirmGlyph: {
    color: EMERALD_400,
    fontSize: 12,
    lineHeight: 14,
  },
  ctxGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
    width: 16,
  },
  ctxGlyphDanger: {
    color: RED_400,
  },
  ctxItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ctxItemDisabled: {
    opacity: 0.3,
  },
  ctxItemPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  ctxItemPressedDanger: {
    backgroundColor: RED_500_10,
  },
  ctxLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  ctxLabelDanger: {
    color: RED_400,
  },
  defaultBadge: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 11,
  },
  editRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  iconButton: {
    height: 28,
    paddingHorizontal: 6,
  },
  input: {
    backgroundColor: SURFACE_2,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 12,
    height: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
    width: 112,
  },
  menu: {
    backgroundColor: MENU_BG,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 160,
    paddingVertical: 4,
    position: 'absolute',
    ...shadows.panel,
  },
  menuDivider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: 4,
  },
  modalRoot: {
    flex: 1,
  },
  newButton: {
    borderColor: colors.border,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 1,
    height: 30,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newGlyph: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  newLabel: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  row: {
    alignItems: 'center',
    gap: 4,
    paddingBottom: 8,
  },
  scroll: {
    flexGrow: 0,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tabActive: {
    backgroundColor: THEME_PRIMARY_BG,
    borderColor: THEME_PRIMARY_BORDER,
  },
  tabDragOver: {
    borderLeftColor: THEME_PRIMARY,
    borderLeftWidth: 2,
  },
  tabDragging: {
    opacity: 0.5,
  },
  tabIcon: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 16,
  },
  tabInactive: {
    backgroundColor: SURFACE_2,
    borderColor: 'transparent',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    maxWidth: 120,
  },
  tabLabelActive: {
    color: THEME_PRIMARY,
  },
  tabLabelInactive: {
    color: colors.textSecondary,
  },
  tabWrapper: {
    flexShrink: 0,
  },
});
