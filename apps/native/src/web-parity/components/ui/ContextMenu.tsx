// Native parity port of web/src/components/ui/ContextMenu.tsx.
//
// Shared `<ContextMenu>` primitive. On the web this surfaced a right-click
// (`onContextMenu`) action menu on data-table rows, map markers, and other
// anchor surfaces, portal-rendered onto `document.body`. The vendor-agnostic
// half — the module-level pub/sub store (`openContextMenu`/`closeContextMenu`/
// `subscribe`/`getSnapshot`/`__resetContextMenuForTests`), the monotonic
// `nonce` re-open counter, the empty-items short-circuit, the deferred
// focus-restore via `queueMicrotask`, and the `useContextMenu()` hook contract
// (`contextMenuProps` / `openMenu` / `close`) — is ported verbatim. Only the
// rendering + browser-event layer is re-expressed with React Native primitives:
//
//   - There is no right-click on touch surfaces, so the web `onContextMenu`
//     trigger binding becomes the native long-press analogue: `contextMenuProps`
//     now exposes `{ onLongPress }`, which reads the gesture's `pageX/pageY`
//     (the `clientX/clientY` analogue) and opens the menu. The web
//     `e.preventDefault()` / `e.stopPropagation()` have no native analogue
//     (long-press is a discrete gesture) and are dropped.
//   - `react-dom` `createPortal(..., document.body)` (web L47) -> a transparent
//     React Native `Modal`, which is itself the portal/overlay analogue and
//     additionally captures the Android hardware-back / desktop-Escape gesture
//     via `onRequestClose` (the web Escape-to-close handler).
//   - `react-i18next` `useTranslation` (web L48) -> an inlined
//     `useNativeTranslationFallback()` returning the literal fallback string,
//     matching the sibling ConfirmDialog port (the native parity tree has no
//     i18n runtime).
//   - `@/lib/cn` className composition (web L49) -> RN `StyleSheet` style arrays
//     + per-variant style maps.
//   - Viewport overflow flip: the web measured `getBoundingClientRect()` against
//     `window.innerWidth/Height` inside a `useLayoutEffect` and mutated
//     `el.style.left/top` directly. Native measures the menu via `onLayout` and
//     compares against `Dimensions.get('window')`, flipping the anchor edge
//     (right-edge -> x, bottom-edge -> y) with the same `VIEWPORT_MARGIN = 8`.
//   - Outside-press + Escape close: the web document-level `pointerdown` /
//     `keydown(Escape)` / `resize` / `scroll` listeners become (a) a
//     full-screen backdrop `Pressable` whose `onPress` closes (outside press),
//     (b) the Modal `onRequestClose` (Escape / back), and (c) a `Dimensions`
//     `change` subscription (resize/orientation). The global `scroll`-to-close
//     and the inside-menu `contextmenu` re-prevent have no portable RN analogue
//     and are dropped.
//   - Arrow/Home/End/Tab keyboard roving focus and the container auto-focus
//     (web L314-387) rely on DOM `focus()` + key events that React Native core
//     does not expose portably across iOS/Android/Windows/macOS; they are
//     dropped. The `role="menu"` / `role="menuitem"` semantics are preserved via
//     `accessibilityRole`, so screen readers still traverse items in order and
//     activation (double-tap) maps to the item's `onPress` (the Enter/Space
//     analogue). The `restoreFocusEl: HTMLElement` focus target is re-typed to a
//     native-safe duck-typed `{ focus(): void }` and the `document.body.contains`
//     guard + `{ preventScroll: true }` option are dropped.
//   - The `<ul>/<li>/<button>` markup, `data-destructive` attribute,
//     `forced-colors:` high-contrast fallback, `z-[100]`, `focus-visible:` ring,
//     and `transition-colors` have no RN analogue; the menu is a `View` of
//     `Pressable` rows whose pressed/disabled/destructive variants are expressed
//     with token-backed `StyleSheet` styles, `numberOfLines={1}` replaces
//     `truncate`, and `aria-hidden` icon/shortcut map to
//     `importantForAccessibility` so the item's accessible name stays the label.

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { colors, shadows } from '../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ContextMenuItem {
  /** Stable identifier used as React key. */
  id: string;
  /** Display label rendered inline inside the menu row. */
  label: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Action invoked when the user presses / activates the item.
   *  The menu auto-closes after the handler runs (sync or async). */
  onClick: () => void;
  /** When true, the item is rendered visibly but is non-interactive. */
  disabled?: boolean;
  /** When true, the item is tinted red (e.g. Delete, Archive). */
  destructive?: boolean;
  /** Optional right-aligned shortcut hint (e.g. "⌘⇧D"). */
  shortcut?: string;
}

/**
 * Minimal duck-typed focus target. The web stored the right-clicked
 * `HTMLElement` so close() could restore DOM focus; React Native has no
 * `HTMLElement`, so callers may pass any object exposing `focus()` (e.g. a
 * `TextInput` ref) and close() will invoke it. Defaults to null.
 */
export interface ContextMenuFocusTarget {
  focus: () => void;
}

interface MenuState {
  items: ContextMenuItem[];
  x: number;
  y: number;
  /** Target that had focus when the menu opened. Restored on close. */
  restoreFocusEl: ContextMenuFocusTarget | null;
  /** Monotonic open-counter so re-opens with identical (items,x,y) still
   *  re-render the menu (e.g. user long-presses twice in the same spot). */
  nonce: number;
}

type Listener = (s: MenuState | null) => void;

/* ------------------------------------------------------------------ */
/*  Module-level store                                                 */
/* ------------------------------------------------------------------ */

let state: MenuState | null = null;
let nonceCounter = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) {
    fn(state);
  }
}

/** Subscribe to menu-state changes. Returns an unsubscribe function. */
function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): MenuState | null {
  return state;
}

/** Imperatively open the context menu at viewport coordinates. */
export function openContextMenu(
  items: ContextMenuItem[],
  x: number,
  y: number,
  restoreFocusEl: ContextMenuFocusTarget | null = null,
): void {
  if (!items || items.length === 0) {
    return;
  }
  nonceCounter += 1;
  state = { items, x, y, restoreFocusEl, nonce: nonceCounter };
  emit();
}

/** Close the context menu (no-op when already closed). */
export function closeContextMenu(): void {
  if (state === null) {
    return;
  }
  const prev = state;
  state = null;
  emit();
  // Restore focus to the trigger so keyboard / screen-reader users don't lose
  // their place. Defer one microtask so React's commit (which removed the menu
  // overlay) has a chance to settle first. The web used queueMicrotask (a DOM
  // global TypeScript does not type in the RN lib set) plus a
  // `document.body.contains(...)` guard and `{ preventScroll: true }`; the
  // microtask is expressed here with Promise.resolve().then and the two
  // DOM-only options have no native analogue, so we simply invoke focus().
  if (prev.restoreFocusEl) {
    Promise.resolve().then(() => prev.restoreFocusEl?.focus());
  }
}

/** Test-only — wipe store between tests. */
export function __resetContextMenuForTests(): void {
  state = null;
  nonceCounter = 0;
  listeners.clear();
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseContextMenuReturn {
  /** Spread onto a trigger element to capture a long-press and open the menu
   *  with the items resolved at press time. The native analogue of the web
   *  right-click (`onContextMenu`) binding. Only meaningful when the hook was
   *  given an items source. */
  contextMenuProps: { onLongPress: (e: GestureResponderEvent) => void };
  /** Imperative open — useful when items depend on the long-pressed target
   *  (e.g. the data-table row). */
  openMenu: (items: ContextMenuItem[], x: number, y: number) => void;
  /** Imperative close. */
  close: () => void;
}

/**
 * Hook that returns a stable `openMenu`/`close` plus an optional
 * `contextMenuProps` convenience for trigger elements that have a fixed
 * (or lazily resolvable) item set.
 *
 * @example imperative
 * ```tsx
 * const { openMenu } = useContextMenu();
 * <Pressable onLongPress={(e) => {
 *   const items = buildRowMenu(row);
 *   if (items.length === 0) return;
 *   openMenu(items, e.nativeEvent.pageX, e.nativeEvent.pageY);
 * }} />
 * ```
 *
 * @example bound
 * ```tsx
 * const { contextMenuProps } = useContextMenu(() => buildItems());
 * <Pressable {...contextMenuProps} />
 * ```
 */
export function useContextMenu(
  itemsOrGetter?: ContextMenuItem[] | (() => ContextMenuItem[]),
): UseContextMenuReturn {
  const itemsRef = useRef(itemsOrGetter);
  itemsRef.current = itemsOrGetter;

  const onLongPress = useCallback((e: GestureResponderEvent) => {
    const source = itemsRef.current;
    if (!source) {
      return;
    }
    const items = typeof source === 'function' ? source() : source;
    if (!items || items.length === 0) {
      return;
    }
    // The native long-press gesture reports absolute screen coordinates via
    // pageX/pageY — the analogue of the web event's clientX/clientY.
    const { pageX, pageY } = e.nativeEvent;
    openContextMenu(items, pageX, pageY, null);
  }, []);

  const openMenu = useCallback(
    (items: ContextMenuItem[], x: number, y: number) => {
      // The web captured document.activeElement so close() could restore it;
      // React Native has no document-level active element, so no focus target
      // is captured here.
      openContextMenu(items, x, y, null);
    },
    [],
  );

  const close = useCallback(() => closeContextMenu(), []);

  return { contextMenuProps: { onLongPress }, openMenu, close };
}

/* ------------------------------------------------------------------ */
/*  Root overlay renderer                                              */
/* ------------------------------------------------------------------ */

const VIEWPORT_MARGIN = 8;

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * Mount this component once near the top of the React tree. It subscribes to
 * the module-level menu store and renders the active menu inside a transparent
 * `Modal` (the React Native portal/overlay analogue of the web
 * `createPortal(..., document.body)`). Keyed by `nonce` so each open
 * re-measures for the overflow flip.
 */
export function ContextMenuRoot(): React.ReactElement | null {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!snapshot) {
    return null;
  }
  return (
    <Modal
      animationType="none"
      onRequestClose={closeContextMenu}
      transparent
      visible
    >
      <ContextMenuView key={snapshot.nonce} state={snapshot} />
    </Modal>
  );
}

interface ContextMenuViewProps {
  state: MenuState;
}

function ContextMenuView({
  state: menu,
}: ContextMenuViewProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const menuId = useId();
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  // Resize / orientation change closes the menu (web window 'resize' handler).
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => closeContextMenu());
    return () => sub.remove();
  }, []);

  // Position: initial layout uses (menu.x, menu.y); once the menu has measured
  // itself via onLayout we flip the anchor edge if either side would overflow
  // the viewport (right-edge flips to x, bottom-edge flips to y). Mirrors the
  // web measure-and-flip useLayoutEffect.
  const { width: viewportW, height: viewportH } = Dimensions.get('window');
  let left = menu.x;
  let top = menu.y;
  if (size) {
    if (left + size.width + VIEWPORT_MARGIN > viewportW) {
      left = Math.max(VIEWPORT_MARGIN, menu.x - size.width);
    }
    if (top + size.height + VIEWPORT_MARGIN > viewportH) {
      top = Math.max(VIEWPORT_MARGIN, menu.y - size.height);
    }
  }

  const invoke = (item: ContextMenuItem) => {
    if (item.disabled) {
      return;
    }
    closeContextMenu();
    // Run the handler after closeContextMenu() so navigations and re-renders
    // triggered by the action see the menu already torn down. The web deferred
    // with queueMicrotask; Promise.resolve().then is the typed, native-safe
    // microtask equivalent.
    Promise.resolve().then(() => {
      try {
        item.onClick();
      } catch (err) {
        // Surface unexpected handler errors but don't break the menu lifecycle.
        console.error('[ContextMenu] item handler threw', err);
      }
    });
  };

  return (
    <Pressable onPress={() => closeContextMenu()} style={styles.backdrop}>
      <Pressable
        accessibilityLabel={t('contextMenu.menuLabel', 'Context menu')}
        accessibilityRole="menu"
        nativeID={menuId}
        onLayout={e => {
          const { width, height } = e.nativeEvent.layout;
          setSize(prev =>
            prev && prev.width === width && prev.height === height
              ? prev
              : { width, height },
          );
        }}
        onPress={() => undefined}
        style={[styles.menu, { left, top }]}
        testID="context-menu"
      >
        {menu.items.map(item => (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="menuitem"
            accessibilityState={{ disabled: item.disabled ?? false }}
            disabled={item.disabled}
            key={item.id}
            onPress={() => invoke(item)}
            style={({ pressed }) => [
              styles.item,
              item.disabled && styles.itemDisabled,
              pressed &&
                !item.disabled &&
                (item.destructive
                  ? styles.itemDestructivePressed
                  : styles.itemDefaultPressed),
            ]}
            testID={`context-menu-item-${item.id}`}
          >
            {item.icon !== undefined ? (
              <View
                importantForAccessibility="no-hide-descendants"
                style={styles.icon}
              >
                {item.icon}
              </View>
            ) : null}
            <AppText
              numberOfLines={1}
              style={[
                styles.label,
                item.disabled
                  ? styles.labelDisabled
                  : item.destructive
                  ? styles.labelDestructive
                  : styles.labelDefault,
              ]}
            >
              {item.label}
            </AppText>
            {item.shortcut ? (
              <AppText importantForAccessibility="no" style={styles.shortcut}>
                {item.shortcut}
              </AppText>
            ) : null}
          </Pressable>
        ))}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  icon: {
    alignItems: 'center',
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  item: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  itemDefaultPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  itemDestructivePressed: {
    backgroundColor: colors.dangerSurface,
  },
  itemDisabled: {
    opacity: 0.6,
  },
  label: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  labelDefault: {
    color: colors.textSecondary,
  },
  labelDestructive: {
    color: colors.danger,
  },
  labelDisabled: {
    color: colors.textMuted,
  },
  menu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    maxWidth: 320,
    minWidth: 192,
    padding: 4,
    position: 'absolute',
    ...shadows.panel,
  },
  shortcut: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1,
    marginLeft: 8,
    textTransform: 'uppercase',
  },
});
