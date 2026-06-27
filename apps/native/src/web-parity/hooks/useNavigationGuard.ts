/**
 * useNavigationGuard / useGuardedNavigate — native-safe port of
 * web/src/hooks/useNavigationGuard.ts.
 *
 * Web parity source: web/src/hooks/useNavigationGuard.ts.
 *
 * On the web these two hooks let a form register its "dirty" (unsaved edits)
 * state with the global <NavigationGuardProvider> so that in-app navigations
 * (GuardedLink / GuardedNavLink / useGuardedNavigate) and the browser
 * back/forward buttons surface a confirm dialog before discarding the edits.
 *   - useNavigationGuard(isDirty, message?) registers the caller's dirty flag
 *     (read live via refs) and unregisters on unmount.
 *   - useGuardedNavigate() is a drop-in useNavigate() that first awaits
 *     confirmIfDirty(); it cancels (returns false) when the user keeps editing,
 *     otherwise navigates and returns true.
 *
 * Native adaptation (every reduction documented in the .parity.json sidecar):
 *   - react-router-dom useNavigate / To / NavigateOptions: React Native has no
 *     browser-history router, so navigation is delegated to an injectable
 *     module-level navigator seam (setGuardedNavigator) wired up by the native
 *     navigation shell — the hook analog of the GuardedLink onNavigate bridge.
 *     Until a host installs one, a confirmed navigate is an explicit no-op (the
 *     promise still resolves true, i.e. "navigation allowed").
 *   - useNavigationGuardContext (web ./NavigationGuardProvider, not yet ported
 *     to native): the provider's register + confirmIfDirty core is reproduced
 *     here as a tiny in-process guard registry (registerNavigationGuard /
 *     findDirtyNavigationGuard) plus an injectable confirm seam
 *     (setNavigationGuardConfirmHandler). This keeps the web end-to-end
 *     behaviour — an imperative guarded navigate consults the very guards
 *     registered by useNavigationGuard — instead of splitting them apart.
 *   - The web ConfirmDialog has no equivalent inside this hook; when a guard is
 *     dirty and no confirm handler is installed the registry resolves true
 *     (navigation proceeds), exactly like the web NOOP_CTX used when no
 *     <NavigationGuardProvider> is mounted. A future native
 *     NavigationGuardProvider port (or an Alert.alert-based handler) can supply
 *     the real prompt via setNavigationGuardConfirmHandler. See
 *     {@link nativeNavigationGuardCapabilities}.
 *   - The web provider's popstate (browser back/forward) interception has no
 *     in-hook counterpart; the native back gesture is the navigation shell's
 *     responsibility and can route through useGuardedNavigate / the registry.
 *
 * No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
 * components are imported here.
 */
import { useCallback, useEffect, useId, useRef } from 'react';

/**
 * Capability descriptor for the native navigation-guard seam. Mirrors the
 * explicit "unavailable" pattern used by the sibling web-parity ports so
 * callers can branch on what the platform can actually do instead of
 * discovering it via a thrown error.
 */
export const nativeNavigationGuardCapabilities = {
  /** No react-router-dom useNavigate on native. */
  reactRouterNavigateAvailable: false,
  /** No browser popstate / back-forward interception inside this hook. */
  browserPopstateGuardAvailable: false,
  /** Dirty-state guards are tracked in an in-process registry. */
  guardRegistryAvailable: true,
  /** Navigation is delegated to an injectable navigator seam. */
  injectableNavigatorAvailable: true,
  /** The confirm prompt is delegated to an injectable handler seam. */
  injectableConfirmHandlerAvailable: true,
} as const;

/**
 * One registered "form is dirty" guard. Mirrors the web
 * NavigationGuardProvider's NavigationGuardEntry: the isDirty / getMessage
 * callbacks read from refs so the registration effect need not re-run every
 * render.
 */
export interface NavigationGuardEntry {
  /** Stable per-mount id — typically useId() from the consumer hook. */
  id: string;
  /** Returns true when the consumer has unsaved edits. */
  isDirty: () => boolean;
  /**
   * Optional caller-localized prompt body shown when THIS guard is the one
   * blocking navigation. When undefined, the confirm handler falls back to the
   * generic forms.unsavedWarning copy.
   */
  getMessage: () => string | undefined;
}

/** Native analog of react-router-dom's Path (the object form of To). */
export interface GuardedNavigatePath {
  pathname?: string;
  search?: string;
  hash?: string;
}

/** Native analog of react-router-dom's To: a path string or Path object. */
export type GuardedNavigateTarget = string | GuardedNavigatePath;

/** Native analog of react-router-dom's NavigateOptions (navigate()'s 2nd arg). */
export interface GuardedNavigateOptions {
  replace?: boolean;
  state?: unknown;
  relative?: 'route' | 'path';
  preventScrollReset?: boolean;
}

/**
 * Native navigation bridge that performs the route change (replaces
 * useNavigate). A numeric target is a history delta (e.g. -1 = back); a
 * string / Path target is an absolute or relative destination.
 */
export type GuardedNavigator = (
  to: GuardedNavigateTarget | number,
  options?: GuardedNavigateOptions,
) => void;

/**
 * Confirm seam invoked when a guarded navigation is attempted while a guard is
 * dirty. Resolves true to proceed (discard edits) or false to cancel (keep
 * editing) — the native analog of the web ConfirmDialog the provider shows.
 */
export type NavigationGuardConfirmHandler = (
  message: string | undefined,
) => Promise<boolean>;

/* ------------------------------------------------------------------ */
/*  native-safe guard registry (web NavigationGuardProvider core)      */
/* ------------------------------------------------------------------ */

// In-process analog of the provider's Map<id, GuardEntry>, living for the JS
// runtime's lifetime. registerNavigationGuard adds an entry and returns an
// unregister fn (called from the useEffect cleanup), exactly like the web
// provider's register().
const guardRegistry = new Map<string, NavigationGuardEntry>();

/**
 * Register a dirty-state guard. Returns an unregister function — call it from a
 * useEffect cleanup. Exported so a future native NavigationGuardProvider port
 * can own / observe the same registry.
 */
export function registerNavigationGuard(
  entry: NavigationGuardEntry,
): () => void {
  guardRegistry.set(entry.id, entry);
  return () => {
    guardRegistry.delete(entry.id);
  };
}

/**
 * Return the first registered guard reporting dirty, or null when none are.
 * Native analog of the provider's findDirty(). Exported so a future provider or
 * confirm handler can read the dirty state and its localized message.
 */
export function findDirtyNavigationGuard(): NavigationGuardEntry | null {
  for (const entry of guardRegistry.values()) {
    if (entry.isDirty()) {
      return entry;
    }
  }
  return null;
}

// Injectable navigator seam (web useNavigate). The native navigation shell
// installs the real navigator once; until then guarded navigations resolve
// true but perform no route change (the GuardedLink "no bridge" semantics).
let activeNavigator: GuardedNavigator | null = null;

/** Install (or clear with null) the navigator used by useGuardedNavigate. */
export function setGuardedNavigator(next: GuardedNavigator | null): void {
  activeNavigator = next;
}

// Injectable confirm seam (web ConfirmDialog via the provider). Absent by
// default so dirty guards resolve true (proceed), matching the web NOOP_CTX
// behaviour when no <NavigationGuardProvider> is mounted.
let activeConfirmHandler: NavigationGuardConfirmHandler | null = null;

/** Install (or clear with null) the prompt shown when a guard is dirty. */
export function setNavigationGuardConfirmHandler(
  handler: NavigationGuardConfirmHandler | null,
): void {
  activeConfirmHandler = handler;
}

/**
 * Resolve immediately to true when no guard is dirty; otherwise defer to the
 * installed confirm handler (true = discard / navigate, false = keep editing /
 * cancel). With no handler installed it resolves true, mirroring the web
 * NOOP_CTX. Native analog of the provider's confirmIfDirty().
 */
export function confirmNavigationGuardIfDirty(): Promise<boolean> {
  const dirty = findDirtyNavigationGuard();
  if (!dirty) {
    return Promise.resolve(true);
  }
  if (!activeConfirmHandler) {
    return Promise.resolve(true);
  }
  return activeConfirmHandler(dirty.getMessage());
}

/**
 * Register the calling component's dirty-state with the native navigation-guard
 * registry (the analog of the web <NavigationGuardProvider>).
 *
 * Pair with react-hook-form's formState.isDirty, a useFormDraft diff, or any
 * other "user has unsaved edits" boolean. Until the form is saved or reset,
 * guarded navigations (GuardedLink, GuardedNavLink, useGuardedNavigate, and the
 * native back gesture once the shell routes it through the registry) surface a
 * confirm prompt.
 *
 * @param isDirty - True when the form has pending edits.
 * @param message - Optional localized prompt body (e.g. "You have an unsaved
 *   alert rule."). Falls back to the generic forms.unsavedWarning copy at the
 *   confirm handler.
 *
 * @example
 *   const {isDirty} = formMethods.formState;
 *   useNavigationGuard(isDirty, t('alerts.unsavedRule', 'You have an unsaved alert rule.'));
 */
export function useNavigationGuard(isDirty: boolean, message?: string): void {
  const id = useId();
  const isDirtyRef = useRef(isDirty);
  const messageRef = useRef(message);
  isDirtyRef.current = isDirty;
  messageRef.current = message;

  useEffect(() => {
    return registerNavigationGuard({
      id,
      isDirty: () => isDirtyRef.current,
      getMessage: () => messageRef.current,
    });
  }, [id]);
}

/**
 * Drop-in native replacement for useNavigate() that consults the guard registry
 * before navigating. Use for imperative navigations from button handlers,
 * post-mutation redirects, etc., so they don't bypass the same confirm prompt
 * <GuardedLink> shows.
 *
 * Returns an async navigate(to, options?) that resolves false when the user
 * keeps editing (no navigation happens) and true once navigation is allowed
 * (and the installed navigator, if any, has been invoked). A numeric target is
 * a history delta; a string / Path target is forwarded with its options.
 *
 * @example
 *   const guardedNavigate = useGuardedNavigate();
 *   const onCancel = () => guardedNavigate('/automations');
 */
export function useGuardedNavigate() {
  return useCallback(
    async (
      to: GuardedNavigateTarget | number,
      options?: GuardedNavigateOptions,
    ): Promise<boolean> => {
      const ok = await confirmNavigationGuardIfDirty();
      if (!ok) {
        return false;
      }
      if (activeNavigator) {
        if (typeof to === 'number') {
          activeNavigator(to);
        } else {
          activeNavigator(to, options);
        }
      }
      return true;
    },
    [],
  );
}
