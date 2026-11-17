import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { captureAppDesignOrigin, type AppDesignOriginSnapshot } from '../ui/appDesignOrigin'
import { Button } from '../ui/Button'
import { AlertBanner } from './AlertBanner'
import { isFocusRestorable } from '@/hooks/useDialogFocus'
import { reportFrontendError } from '@/lib/errorReporter'

/**
 * One registered "form is dirty" guard.
 *
 * Created by {@link useNavigationGuard}; the entry's `isDirty` and
 * `getMessage` callbacks read from refs so the registration effect doesn't
 * have to re-run every render. The provider owns the `Map<id, GuardEntry>`.
 */
export interface NavigationGuardEntry {
  /** Stable per-mount id — typically `useId()` from the consumer hook. */
  id: string
  /** Returns true when the consumer has unsaved edits. */
  isDirty: () => boolean
  /**
   * Optional caller-localized prompt text shown in the confirm dialog when
   * THIS guard is the one blocking navigation. When omitted, the provider
   * falls back to the generic `forms.unsavedWarning` translation.
   */
  getMessage: () => string | undefined
}

interface PendingConfirm {
  resolve: (ok: boolean) => void
  message?: string
  originSnapshot: AppDesignOriginSnapshot
}

function captureConfirmationOrigin() {
  const active = document.activeElement
  return captureAppDesignOrigin(active instanceof HTMLElement && active !== document.body && active !== document.documentElement
    ? active : null)
}

interface NavigationGuardContextValue {
  /**
   * Register a dirty-state callback. Returns an unregister function — call it
   * from a `useEffect` cleanup.
   */
  register: (entry: NavigationGuardEntry) => () => void
  /**
   * Resolve immediately to `true` if no guards are dirty; otherwise show the
   * confirm dialog and resolve to the user's choice (`true` = discard /
   * navigate; `false` = keep editing / cancel navigation).
   *
   * If a confirm is already in flight (e.g. a popstate dialog is already
   * open and the user clicks a {@link GuardedLink}), the existing promise is
   * returned — the same dialog answers both call sites instead of stacking.
   */
  confirmIfDirty: () => Promise<boolean>
}

const Ctx = createContext<NavigationGuardContextValue | null>(null)

/**
 * Default no-op context used when no `<NavigationGuardProvider>` is mounted.
 * Lets `<GuardedLink>`, `<GuardedNavLink>`, and `useNavigationGuard` render
 * inside isolated component tests / Storybook without forcing the consumer
 * to wrap every test in the full provider tree. In production the provider
 * is mounted in `main.tsx`, so the real implementation always wins.
 */
const NOOP_CTX: NavigationGuardContextValue = {
  register: () => () => {},
  confirmIfDirty: () => Promise.resolve(true),
}

/**
 * Provides in-app unsaved-changes guarding for the entire React tree.
 *
 * MUST be mounted INSIDE `<BrowserRouter>` (uses `useNavigate` /
 * `useLocation`). Mount it directly under the router so every route, link,
 * and back-button press is covered.
 *
 * The provider listens for `popstate` (browser back / forward) and exposes a
 * `confirmIfDirty()` API used by {@link GuardedLink}, {@link GuardedNavLink},
 * and {@link useGuardedNavigate}. When any registered guard reports dirty, a
 * `<ConfirmDialog>` is shown; the user's choice resolves the awaited promise
 * so the caller can complete or abandon the navigation.
 *
 * Coexists with `useDirtyForm`'s `beforeunload` listener — that hook handles
 * tab close / reload / external links, this provider handles in-app SPA
 * navigation that bypasses `beforeunload`.
 */
export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const guards = useRef<Map<string, NavigationGuardEntry>>(new Map())
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)
  const [Dialog, setDialog] = useState<typeof ConfirmDialog | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const loadingRef = useRef<HTMLDivElement>(null)
  // Re-use the in-flight confirm when both popstate AND a click intercept
  // race: the second caller awaits the same dialog instead of orphaning.
  const pendingPromiseRef = useRef<Promise<boolean> | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const lastLocationRef = useRef(location)
  // Set immediately before our own programmatic navigate(-1) so the resulting
  // popstate isn't intercepted again (preventing an infinite re-prompt loop).
  const skipNextPopstateRef = useRef(false)

  useEffect(() => {
    lastLocationRef.current = location
  }, [location])

  const register = useCallback((entry: NavigationGuardEntry) => {
    guards.current.set(entry.id, entry)
    return () => {
      guards.current.delete(entry.id)
    }
  }, [])

  const findDirty = useCallback((): NavigationGuardEntry | null => {
    for (const e of guards.current.values()) {
      if (e.isDirty()) return e
    }
    return null
  }, [])

  const confirmIfDirty = useCallback((): Promise<boolean> => {
    if (pendingPromiseRef.current) return pendingPromiseRef.current
    const dirty = findDirty()
    if (!dirty) return Promise.resolve(true)
    const promise = new Promise<boolean>((resolve) => {
      const request = { resolve, message: dirty.getMessage(), originSnapshot: captureConfirmationOrigin() }
      pendingRef.current = request
      setPending(request)
    })
    pendingPromiseRef.current = promise
    return promise
  }, [findDirty])

  // popstate handler — intercept browser back/forward when any guard is
  // dirty, push the URL back to the pre-navigation location, then defer to
  // the confirm dialog. On discard, programmatically replay the back
  // navigation; on keep-editing, do nothing (URL already restored).
  //
  // BrowserRouter has its own popstate listener that updates internal
  // location to whatever window.location currently points at. We capture the
  // last-known-good URL in a ref BEFORE any handler runs (kept in sync via
  // the location effect above), then schedule a resync via state so the
  // navigate() call lands inside the next render cycle instead of inside the
  // popstate event itself — that decouples it from BrowserRouter's own
  // popstate processing and avoids "setState during render" warnings.
  const [resyncUrl, setResyncUrl] = useState<string | null>(null)
  useEffect(() => {
    if (resyncUrl == null) return
    navigate(resyncUrl, { replace: true })
    setResyncUrl(null)
  }, [resyncUrl, navigate])

  useEffect(() => {
    const handler = () => {
      if (skipNextPopstateRef.current) {
        skipNextPopstateRef.current = false
        return
      }
      const dirty = findDirty()
      if (!dirty) return

      const old = lastLocationRef.current
      const oldUrl = old.pathname + old.search + old.hash
      // Roll the browser URL back synchronously so the address bar matches
      // what the user is still seeing.
      window.history.pushState(null, '', oldUrl)
      // Roll react-router's state back via the resync state — runs in a
      // useEffect, NOT inside the popstate dispatch, to avoid re-entrancy.
      setResyncUrl(oldUrl)

      if (pendingPromiseRef.current) return
      const message = dirty.getMessage()
      const promise = new Promise<boolean>((resolve) => {
        const request: PendingConfirm = {
          resolve: (ok) => {
            if (ok) {
              skipNextPopstateRef.current = true
              navigate(-1)
            }
            resolve(ok)
          },
          message,
          originSnapshot: captureConfirmationOrigin(),
        }
        pendingRef.current = request
        setPending(request)
      })
      pendingPromiseRef.current = promise
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [findDirty, navigate])

  const ctxValue = useMemo<NavigationGuardContextValue>(
    () => ({ register, confirmIfDirty }),
    [register, confirmIfDirty],
  )

  // The request ref is set before scheduling its render so an immediate
  // unmount can still cancel it. handleConfirm/handleCancel can
  // resolve the awaited promise WITHOUT calling navigate(-1) inside a
  // setState updater. Calling navigate inside an updater triggers a setState
  // on MemoryRouter while React is mid-render, producing a "setState during
  // render" warning. The ref + plain setPending(null) lets the resolve side
  // effect run as a normal event-handler setState, which React batches
  // safely with the pending=null update.
  const handleConfirm = useCallback(() => {
    const current = pendingRef.current
    pendingRef.current = null
    pendingPromiseRef.current = null
    setPending(null)
    if (current) current.resolve(true)
  }, [])

  const handleCancel = useCallback(() => {
    const current = pendingRef.current
    pendingRef.current = null
    pendingPromiseRef.current = null
    setPending(null)
    const origin = current?.originSnapshot.origin
    if (loadingRef.current?.contains(document.activeElement) && isFocusRestorable(origin)) {
      origin.focus()
    }
    if (current) current.resolve(false)
  }, [])

  useEffect(() => {
    if (!pending || Dialog) return
    let cancelled = false
    setLoadFailed(false)
    void import('../ui/ConfirmDialog').then(module => {
      if (!cancelled) setDialog(() => module.ConfirmDialog)
    }, error => {
      if (cancelled) return
      reportFrontendError(error, 'react')
      setLoadFailed(true)
    })
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      handleCancel()
    }
    window.addEventListener('keydown', cancel)
    return () => { cancelled = true; window.removeEventListener('keydown', cancel) }
  }, [pending, Dialog, loadAttempt, handleCancel])

  useEffect(() => () => {
    pendingRef.current?.resolve(false)
    pendingRef.current = null
    pendingPromiseRef.current = null
  }, [])

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      {pending && (Dialog ? <Dialog
        open
        originSnapshot={pending.originSnapshot}
        title={t('forms.unsavedTitle', 'Unsaved changes')}
        message={pending.message ?? t('forms.unsavedWarning', 'You have unsaved changes. Discard them?')}
        confirmLabel={t('forms.discard', 'Discard changes')}
        cancelLabel={t('forms.keepEditing', 'Keep editing')}
        variant="warning"
        silenceKey="unsaved-navigation"
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      /> : <div ref={loadingRef}>
        <AlertBanner variant={loadFailed ? 'danger' : 'info'} role={loadFailed ? 'alert' : 'status'}
          aria-label={t('forms.unsavedTitle', 'Unsaved changes')}>
          {loadFailed ? t('errorBoundary.inlineTitle', 'Component failed to load') : t('a11y.loading', 'Loading')}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleCancel}>{t('common.cancel', 'Cancel')}</Button>
            {loadFailed && <Button variant="secondary" onClick={() => setLoadAttempt(attempt => attempt + 1)}>
              {t('error.retry', 'Retry')}
            </Button>}
          </div>
        </AlertBanner>
      </div>)}
    </Ctx.Provider>
  )
}

export function useNavigationGuardContext(): NavigationGuardContextValue {
  const ctx = useContext(Ctx)
  return ctx ?? NOOP_CTX
}
