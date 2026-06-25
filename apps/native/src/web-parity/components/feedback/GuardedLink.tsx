// Native parity port of web/src/components/feedback/GuardedLink.tsx.
//
// The web file ships two drop-in replacements for react-router-dom's <Link> and
// <NavLink> that prompt the user when any registered navigation guard
// (useNavigationGuard) reports a dirty form before navigating, cancelling the
// navigation if the user chooses "Keep editing". It preserves replace / state /
// relative / target semantics and bails out for modifier / middle clicks and
// target="_blank" so opening in a new browser tab still works.
//
// Native adaptation (every reduction documented in the .parity.json sidecar):
//   - react-router-dom <Link>/<NavLink>/useNavigate: React Native has no DOM
//     anchor and no browser-history router, so the link renders as a Pressable
//     with accessibilityRole="link" and navigation is delegated to an optional
//     `onNavigate(to, options)` bridge prop wired up by the native navigation
//     shell. Without a bridge a confirmed press is an explicit no-op navigation.
//   - useNavigationGuardContext (web ./NavigationGuardProvider, not yet ported
//     to native): a native-safe NavigationGuardContext is defined here with a
//     no-op default whose confirmIfDirty() resolves true (navigation proceeds),
//     mirroring the web NOOP_CTX used when no provider is mounted. A future
//     native NavigationGuardProvider port can supply a real confirmIfDirty via
//     this exported context, or a caller can pass the confirmIfDirty prop.
//   - MouseEvent modifier/middle-click skip logic: touch gesture events have no
//     metaKey/ctrlKey/shiftKey/altKey and no secondary `button`, so those
//     DOM-only checks are always false on native and are dropped; the
//     meaningful `target` skip (open somewhere other than "_self") is preserved.
//   - The MouseEvent<HTMLAnchorElement> type becomes React Native's
//     GestureResponderEvent, which still exposes preventDefault() /
//     defaultPrevented, so the onClick -> defaultPrevented -> preventDefault ->
//     confirmIfDirty -> navigate flow is ported faithfully.

import React, {
  createContext,
  useCallback,
  useContext,
  type ReactNode,
} from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/** Native analog of react-router-dom's RelativeRoutingType. */
export type GuardedRelativeRoutingType = 'route' | 'path';

/** Options forwarded to the native navigation bridge (mirrors navigate()'s 2nd arg). */
export interface GuardedNavigateOptions {
  replace?: boolean;
  state?: unknown;
  relative?: GuardedRelativeRoutingType;
}

/** Native navigation bridge that performs the route change (replaces useNavigate). */
export type GuardedNavigate = (
  to: string,
  options?: GuardedNavigateOptions,
) => void;

/**
 * Native-safe stand-in for the web NavigationGuardProvider context value. The
 * web provider also exposes `register`, but a link only ever calls
 * `confirmIfDirty`, so that is the single member required here.
 */
export interface NavigationGuardContextValue {
  /**
   * Resolve to true to proceed with navigation, false to cancel ("Keep
   * editing"). The native default resolves true so navigation is never blocked
   * until a host wires in a real guard.
   */
  confirmIfDirty: () => Promise<boolean>;
}

/**
 * Default no-op context used when no native NavigationGuardProvider is mounted.
 * Mirrors the web NOOP_CTX: lets <GuardedLink> / <GuardedNavLink> render inside
 * isolated tests without forcing a provider, and resolves navigation as allowed.
 */
const NOOP_NAVIGATION_GUARD: NavigationGuardContextValue = {
  confirmIfDirty: () => Promise.resolve(true),
};

/**
 * Exported so a future native NavigationGuardProvider port (or a host/test) can
 * supply a real confirmIfDirty implementation. Defaults to the no-op contract.
 */
export const NavigationGuardContext =
  createContext<NavigationGuardContextValue>(NOOP_NAVIGATION_GUARD);

export function useNavigationGuardContext(): NavigationGuardContextValue {
  return useContext(NavigationGuardContext);
}

/**
 * Modifier-clicks (open in new tab/window) and middle-clicks bypass SPA
 * navigation entirely on the web -- the browser handles them natively, so
 * skipping the guard keeps the dirty form mounted and loses no work. On React
 * Native there are no modifier keys and every press is primary, so only the
 * `target` check (a link meant to open somewhere other than the current view)
 * remains meaningful; the DOM-only modifier/button branches are always false.
 */
function shouldSkipGuard(target?: string): boolean {
  if (target && target !== '' && target !== '_self') return true;
  return false;
}

/**
 * Shared confirm-then-navigate step used by both guarded links. Kept as a
 * module-level async helper so the Pressable onPress stays synchronous (no
 * floating async handler) while preserving the web `await confirmIfDirty()`
 * order. Rejections are swallowed so a misbehaving host guard cannot crash the
 * press handler -- the web equivalent leaves the rejection unhandled.
 */
function runGuardedNavigation(
  confirmIfDirty: () => Promise<boolean>,
  onNavigate: GuardedNavigate | undefined,
  to: string,
  options: GuardedNavigateOptions,
): void {
  confirmIfDirty()
    .then(ok => {
      if (ok && onNavigate) onNavigate(to, options);
    })
    .catch(() => {
      // Treat a guard failure as "keep editing": do not navigate.
    });
}

type GuardedLinkChildren = ReactNode;

export interface GuardedLinkProps
  extends Omit<PressableProps, 'onPress' | 'children' | 'style'> {
  /** Destination path handed to the onNavigate bridge. */
  to: string;
  /** Press handler analog of the web anchor onClick; runs before the guard. */
  onClick?: (event: GestureResponderEvent) => void;
  children?: GuardedLinkChildren;
  replace?: boolean;
  state?: unknown;
  relative?: GuardedRelativeRoutingType;
  /** Native analog of anchor target; any non-"_self" value skips the guard. */
  target?: string;
  /** Navigation bridge (replaces react-router-dom useNavigate). */
  onNavigate?: GuardedNavigate;
  /** Optional per-call guard override; falls back to NavigationGuardContext. */
  confirmIfDirty?: () => Promise<boolean>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Drop-in native replacement for react-router-dom's <Link> that prompts the
 * user when any registered {@link useNavigationGuardContext} guard reports dirty
 * before navigating, and cancels navigation if the user chooses "Keep editing".
 *
 * Preserves `replace`, `state`, `relative`, and `target` semantics; bails out
 * for `target` values other than "_self" so a host can route those elsewhere
 * (e.g. external linking) without prompting.
 */
export function GuardedLink({
  to,
  onClick,
  children,
  replace,
  state,
  relative,
  target,
  onNavigate,
  confirmIfDirty: confirmIfDirtyProp,
  style,
  ...rest
}: GuardedLinkProps) {
  const ctx = useNavigationGuardContext();
  const confirmIfDirty = confirmIfDirtyProp ?? ctx.confirmIfDirty;

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (onClick) onClick(event);
      if (event.defaultPrevented) return;
      if (shouldSkipGuard(target)) return;
      event.preventDefault();
      runGuardedNavigation(confirmIfDirty, onNavigate, to, {
        replace,
        state,
        relative,
      });
    },
    [confirmIfDirty, onClick, onNavigate, relative, replace, state, target, to],
  );

  return (
    <Pressable accessibilityRole="link" {...rest} onPress={handlePress} style={style}>
      {children}
    </Pressable>
  );
}

/**
 * State exposed to {@link GuardedNavLink}'s function-as-children and
 * function-as-style props -- the native analog of react-router-dom NavLink's
 * `{ isActive, isPending, isTransitioning }`. Router transition flags have no
 * native equivalent and are always false; `isActive` is derived from the
 * `isActive` / `currentPath` props supplied by the native navigation shell.
 */
export interface GuardedNavLinkState {
  isActive: boolean;
  isPending: boolean;
  isTransitioning: boolean;
}

export interface GuardedNavLinkProps
  extends Omit<PressableProps, 'onPress' | 'children' | 'style'> {
  to: string;
  onClick?: (event: GestureResponderEvent) => void;
  children?:
    | GuardedLinkChildren
    | ((state: GuardedNavLinkState) => GuardedLinkChildren);
  replace?: boolean;
  state?: unknown;
  relative?: GuardedRelativeRoutingType;
  target?: string;
  onNavigate?: GuardedNavigate;
  confirmIfDirty?: () => Promise<boolean>;
  /**
   * Whether this link matches the active route. The web variant derives this
   * from the router; on native pass it (or `currentPath`) from the nav shell.
   * Takes precedence over `currentPath` when provided.
   */
  isActive?: boolean;
  /** Native-safe active derivation: compared against `to`. */
  currentPath?: string;
  /** Match only the exact path (react-router-dom NavLink `end`). */
  end?: boolean;
  style?:
    | StyleProp<ViewStyle>
    | ((state: GuardedNavLinkState) => StyleProp<ViewStyle>);
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function deriveIsActive(
  to: string,
  currentPath: string | undefined,
  end: boolean | undefined,
  override: boolean | undefined,
): boolean {
  if (override !== undefined) return override;
  if (currentPath == null) return false;
  const current = normalizePath(currentPath);
  const dest = normalizePath(to);
  if (end) return current === dest;
  if (current === dest) return true;
  const prefix = dest.endsWith('/') ? dest : `${dest}/`;
  return current.startsWith(prefix);
}

/**
 * Drop-in native replacement for react-router-dom's <NavLink> (the
 * active-styling variant of <Link>). Same guard semantics as
 * {@link GuardedLink}; preserves NavLink's function-as-children and
 * function-as-style API by exposing {@link GuardedNavLinkState}.
 */
export function GuardedNavLink({
  to,
  onClick,
  children,
  replace,
  state,
  relative,
  target,
  onNavigate,
  confirmIfDirty: confirmIfDirtyProp,
  isActive: isActiveProp,
  currentPath,
  end,
  style,
  ...rest
}: GuardedNavLinkProps) {
  const ctx = useNavigationGuardContext();
  const confirmIfDirty = confirmIfDirtyProp ?? ctx.confirmIfDirty;

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (onClick) onClick(event);
      if (event.defaultPrevented) return;
      if (shouldSkipGuard(target)) return;
      event.preventDefault();
      runGuardedNavigation(confirmIfDirty, onNavigate, to, {
        replace,
        state,
        relative,
      });
    },
    [confirmIfDirty, onClick, onNavigate, relative, replace, state, target, to],
  );

  const navState: GuardedNavLinkState = {
    isActive: deriveIsActive(to, currentPath, end, isActiveProp),
    isPending: false,
    isTransitioning: false,
  };

  const resolvedChildren =
    typeof children === 'function' ? children(navState) : children;
  const resolvedStyle =
    typeof style === 'function' ? style(navState) : style;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{selected: navState.isActive}}
      {...rest}
      onPress={handlePress}
      style={resolvedStyle}>
      {resolvedChildren}
    </Pressable>
  );
}
